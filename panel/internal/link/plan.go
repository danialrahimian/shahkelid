package link

import (
	"context"
	"sort"
	"strconv"
	"strings"

	"github.com/danialrahimian/shahkelid/panel/internal/configs"
	"github.com/danialrahimian/shahkelid/panel/internal/store"
)

// plans works out what a subscription's groups say about each of its
// panels' answers (the Node app's groups/link-plan.ts and groupHostsOf):
// the hosts each panel may give, the ones picked with their names and
// places, and whether configs matching no host are kept. One plan per
// panel, in the order given; nil for a subscription that carries no group
// (made before groups), whose link is passed on as the panels give it.
func (h *Handler) plans(ctx context.Context, subscriptionID string, panelIDs []string) ([]configs.Plan, []string, error) {
	groups, err := h.Store.GroupsOfSubscription(ctx, subscriptionID)
	if err != nil || len(groups.GroupIDs) == 0 {
		return nil, nil, err
	}

	panels := map[string]store.Panel{}
	probes := map[string][]configs.Host{}
	read := map[string]bool{}
	failed := map[string]bool{}
	hostsOf := func(panelID string, panelGroupID int64) ([]configs.Host, bool) {
		key := panelID + ":" + strconv.FormatInt(panelGroupID, 10)
		if read[key] {
			hosts, ok := probes[key]
			return hosts, ok
		}
		read[key] = true
		p, ok := panels[panelID]
		if !ok {
			found, err := h.Store.FindPanel(ctx, panelID)
			if err != nil {
				return nil, false
			}
			p, panels[panelID] = found, found
		}
		hosts, ok := h.Catalog.Cached(ctx, p, panelGroupID)
		if ok {
			probes[key] = hosts
		}
		return hosts, ok
	}

	rows := map[string]store.GroupHost{}
	for _, row := range groups.Hosts {
		rows[row.GroupID+"|"+row.PanelID+"|"+row.HostID] = row
	}
	for _, groupID := range groups.GroupIDs {
		h.settle(ctx, groupID, groups.Sources, hostsOf, rows)
	}

	type listed struct {
		panelID, hostID, name string
		selected              bool
		place                 *int64
		order                 int
	}
	wanted := map[string]map[string]configs.Wanted{}
	panelGroups := map[string]map[int64]bool{}
	everyHost := map[string]bool{}
	rank := 0
	for _, groupID := range groups.GroupIDs {
		var list []listed
		index := map[string]int{}
		sourceIndex := 0
		for _, source := range groups.Sources {
			if source.GroupID != groupID {
				continue
			}
			if panelGroups[source.PanelID] == nil {
				panelGroups[source.PanelID] = map[int64]bool{}
				everyHost[source.PanelID] = true
			}
			panelGroups[source.PanelID][source.PanelGroupID] = true
			everyHost[source.PanelID] = everyHost[source.PanelID] && source.AllHosts
			at := sourceIndex
			sourceIndex++
			if failed[source.PanelID] {
				continue
			}
			hosts, ok := hostsOf(source.PanelID, source.PanelGroupID)
			if !ok {
				failed[source.PanelID] = true
				continue
			}
			for hostIndex, host := range hosts {
				key := source.PanelID + "|" + host.ID
				if i, seen := index[key]; seen {
					// In two of the group's panel groups: one host, "all" if either takes all.
					list[i].selected = list[i].selected || source.AllHosts
					continue
				}
				row, hasRow := rows[groupID+"|"+source.PanelID+"|"+host.ID]
				item := listed{panelID: source.PanelID, hostID: host.ID, selected: source.AllHosts || (hasRow && row.Selected), order: at*1_000_000 + hostIndex}
				if hasRow {
					item.place = row.SortOrder
					if row.Name != nil {
						item.name = *row.Name
					}
				}
				index[key] = len(list)
				list = append(list, item)
			}
		}
		// Placed by hand first, then the rest as the panels give them.
		sort.SliceStable(list, func(a, b int) bool {
			x, y := list[a], list[b]
			switch {
			case x.place != nil && y.place != nil:
				return *x.place < *y.place
			case x.place != nil:
				return true
			case y.place != nil:
				return false
			default:
				return x.order < y.order
			}
		})
		for _, item := range list {
			if !item.selected {
				continue
			}
			if wanted[item.panelID] == nil {
				wanted[item.panelID] = map[string]configs.Wanted{}
			}
			// A host in two of the customer's groups is given once, where it first comes.
			if _, seen := wanted[item.panelID][item.hostID]; !seen {
				wanted[item.panelID][item.hostID] = configs.Wanted{Rank: rank, Name: item.name}
				rank++
			}
		}
	}

	var usernames []string
	for _, ids := range panelGroups {
		for id := range ids {
			usernames = append(usernames, ProbeUsername(id))
		}
	}
	out := make([]configs.Plan, len(panelIDs))
	for i, panelID := range panelIDs {
		ids, taken := panelGroups[panelID]
		if !taken {
			// No group takes from this panel any more: it gives nothing
			// (the sync takes its groups off the panel user too).
			out[i] = configs.Plan{Known: true}
			continue
		}
		var hosts []configs.Host
		seen := map[string]bool{}
		known := true
		for id := range ids {
			list, ok := hostsOf(panelID, id)
			if !ok {
				known = false
				break
			}
			for _, host := range list {
				if !seen[host.ID] {
					seen[host.ID] = true
					hosts = append(hosts, host)
				}
			}
		}
		if !known {
			out[i] = configs.Plan{KeepUnknown: true}
			continue
		}
		out[i] = configs.Plan{Hosts: hosts, Known: true, Wanted: wanted[panelID], KeepUnknown: everyHost[panelID]}
	}
	return out, usernames, nil
}

// settle keeps a group's saved settings on their hosts as the panels
// change them (configs.Settle; the Node app does the same on the staff
// pages): for each panel the group takes from and that could be read, the
// hosts it gives now against the group's rows. Most links find nothing to
// change and write nothing; a change is saved (store.SettleHosts), or,
// when it cannot be, used for this link only.
func (h *Handler) settle(ctx context.Context, groupID string, sources []store.GroupSource,
	hostsOf func(string, int64) ([]configs.Host, bool), rows map[string]store.GroupHost) {
	current := map[string][]configs.Host{}
	seen := map[string]bool{}
	unread := map[string]bool{}
	var order []string
	for _, source := range sources {
		if source.GroupID != groupID || unread[source.PanelID] {
			continue
		}
		hosts, ok := hostsOf(source.PanelID, source.PanelGroupID)
		if !ok {
			unread[source.PanelID] = true
			continue
		}
		if _, known := current[source.PanelID]; !known {
			order = append(order, source.PanelID)
			current[source.PanelID] = []configs.Host{}
		}
		for _, host := range hosts {
			if key := source.PanelID + "|" + host.ID; !seen[key] {
				seen[key] = true
				current[source.PanelID] = append(current[source.PanelID], host)
			}
		}
	}
	for _, panelID := range order {
		if unread[panelID] {
			continue // part of what it gives is not known: nothing is moved
		}
		prefix := groupID + "|" + panelID + "|"
		var saved []configs.Saved
		for key, row := range rows {
			if strings.HasPrefix(key, prefix) {
				saved = append(saved, row.Saved())
			}
		}
		settlement := configs.Settle(saved, current[panelID])
		if settlement.Settled() {
			continue
		}
		now, err := h.Store.SettleHosts(ctx, groupID, panelID, current[panelID])
		if err != nil {
			if h.Log != nil {
				h.Log.Warn("a group's hosts could not be settled", "group", groupID, "panel", panelID, "err", err)
			}
			for from, to := range settlement.Moves {
				row := rows[prefix+from]
				delete(rows, prefix+from)
				row.HostID = to
				rows[prefix+to] = row
			}
			continue
		}
		for key := range rows {
			if strings.HasPrefix(key, prefix) {
				delete(rows, key)
			}
		}
		for _, row := range now {
			rows[prefix+row.HostID] = row
		}
	}
}
