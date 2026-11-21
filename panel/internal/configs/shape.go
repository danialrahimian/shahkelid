// Package configs shapes what the panels answer to a customer's link by
// the customer's groups (the Node app's subscriptions/configs.ts, ported).
//
// A panel gives a user one config per host of its groups. Our groups say
// which of those the customer gets, under what name, and in what order. So
// each config in the panel's answer is matched to a host, then:
//
//   - a host the groups did not pick is left out;
//   - a host with a name of ours is renamed (PasarGuard's variables, like
//     {DATA_LEFT}, filled in from the subscription as a whole);
//   - the configs are put in the groups' order, the hosts' order within each.
//
// The answer keeps its format: a list of links (plain or base64), Xray
// JSON, a sing-box profile or a Clash profile. In the last two the
// profile's selectors are kept, listing the configs that are left, renamed
// and in order.
package configs

import (
	"encoding/base64"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Wanted is what our groups say about a host they picked.
type Wanted struct {
	Rank int
	// Name is our name for it; empty: the panel's.
	Name string
}

// Plan is what a customer's groups say about one panel's answer.
type Plan struct {
	// Hosts the panel may give the customer; nil: unknown (the panel's
	// groups could not be read), and its configs are given as they are.
	Hosts []Host
	// Known says Hosts is known (an empty, known list gives nothing).
	Known bool
	// Wanted holds the hosts picked, by host id.
	Wanted map[string]Wanted
	// KeepUnknown keeps a config that matches no host: where the groups
	// take every host the panel gives.
	KeepUnknown bool
}

type kept struct {
	index  int // which answer
	item   int // which config in it
	name   string
	rank   int64
	rename bool
}

// Shape gives the panels' answers (one per panel, the main panel first) as
// one answer shaped by the plans. It returns false when an answer is in no
// format read here, or the panels answered in different formats: the
// caller then passes the answers on as they are.
func Shape(bodies []string, plans []Plan, totals Totals, now time.Time, usernames []string) (string, Format, bool) {
	answers := make([]parsed, len(bodies))
	for i, body := range bodies {
		answers[i] = parse(body)
		if answers[i].format == Unknown || answers[i].format != answers[0].format {
			return "", Unknown, false
		}
	}
	format := answers[0].format

	var list []kept
	for i, answer := range answers {
		plan := plans[i]
		var matched []*Host
		if plan.Known {
			matched = MatchHosts(answer.configs, plan.Hosts, usernames)
		}
		for j, config := range answer.configs {
			fallback := int64(1e12) + int64(i)*1e6 + int64(j)
			switch {
			case !plan.Known:
				list = append(list, kept{i, j, config.Name, fallback, false})
			case matched[j] == nil:
				if plan.KeepUnknown {
					list = append(list, kept{i, j, config.Name, fallback, false})
				}
			default:
				wanted, ok := plan.Wanted[matched[j].ID]
				if !ok {
					continue
				}
				name := config.Name
				if wanted.Name != "" {
					shown := config
					if shown.Protocol == nil {
						shown.Protocol = matched[j].Protocol
					}
					if shown.Network == nil {
						shown.Network = matched[j].Network
					}
					name = RenderName(wanted.Name, totals, shown, now)
				}
				list = append(list, kept{i, j, name, int64(wanted.Rank)*1e6 + int64(j), name != config.Name})
			}
		}
	}
	sort.SliceStable(list, func(a, b int) bool { return list[a].rank < list[b].rank })

	switch format {
	case Links:
		return shapeLinks(answers, list), Links, true
	case XrayJSON:
		out := make([]map[string]any, 0, len(list))
		for _, k := range list {
			config := answers[k.index].xray[k.item]
			if k.rename {
				config = copyMap(config)
				config["remarks"] = k.name
			}
			out = append(out, config)
		}
		return writeJSON(out, true), XrayJSON, true
	case SingBox:
		return shapeSingBox(answers, list), SingBox, true
	default:
		return shapeClash(answers, list), Clash, true
	}
}

func copyMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func renameLink(line, name string) string {
	if strings.HasPrefix(strings.ToLower(line), "vmess://") {
		if body := vmessJSON(line); body != nil {
			body["ps"] = name
			return "vmess://" + base64.StdEncoding.EncodeToString([]byte(writeJSON(body, false)))
		}
	}
	rest, _, _ := strings.Cut(line, "#")
	return rest + "#" + encodeURIComponent(name)
}

// encodeURIComponent escapes as JavaScript's does, as panels write names.
func encodeURIComponent(s string) string {
	return strings.NewReplacer("+", "%20", "%21", "!", "%2A", "*", "%27", "'", "%28", "(", "%29", ")").Replace(url.QueryEscape(s))
}

func shapeLinks(answers []parsed, list []kept) string {
	seen := map[string]bool{}
	var lines []string
	for _, k := range list {
		line := answers[k.index].lines[k.item]
		if k.rename {
			line = renameLink(line, k.name)
		}
		if !seen[line] {
			seen[line] = true
			lines = append(lines, line)
		}
	}
	text := strings.Join(lines, "\n")
	if answers[0].base64 {
		return base64.StdEncoding.EncodeToString([]byte(text))
	}
	return text
}

// uniqueNames: names must be unique inside a profile, so a second
// "Germany" becomes "Germany 2".
func uniqueNames(list []kept) []string {
	seen := map[string]int{}
	out := make([]string, len(list))
	for i, k := range list {
		seen[k.name]++
		if seen[k.name] == 1 {
			out[i] = k.name
		} else {
			out[i] = fmt.Sprintf("%s %d", k.name, seen[k.name])
		}
	}
	return out
}

// relist replaces, in a selector's references, the configs with the ones
// kept: in their order, where the first config stood. Other references
// (another selector, "direct") stay.
func relist(refs []string, wasConfig map[string]bool, names []string) []string {
	var out []string
	placed := false
	for _, ref := range refs {
		if wasConfig[ref] {
			if !placed {
				out = append(out, names...)
				placed = true
			}
			continue
		}
		out = append(out, ref)
	}
	return out
}

func configNames(answers []parsed) map[string]bool {
	names := map[string]bool{}
	for _, answer := range answers {
		for _, config := range answer.configs {
			names[config.Name] = true
		}
	}
	return names
}

func shapeSingBox(answers []parsed, list []kept) string {
	names := uniqueNames(list)
	wasConfig := configNames(answers)
	proxies := make([]any, len(list))
	for i, k := range list {
		outbound := copyMap(answers[k.index].proxies[k.item])
		outbound["tag"] = names[i]
		proxies[i] = outbound
	}
	base := copyMap(answers[0].singBox)
	outbounds, _ := base["outbounds"].([]any)
	var out []any
	placed := false
	for _, item := range outbounds {
		outbound, ok := item.(map[string]any)
		if !ok {
			out = append(out, item)
			continue
		}
		kind, _ := outbound["type"].(string)
		tag, _ := outbound["tag"].(string)
		if proxyTypes[kind] && wasConfig[tag] {
			if !placed {
				out = append(out, proxies...)
				placed = true
			}
			continue
		}
		if refs, ok := outbound["outbounds"].([]any); ok {
			next := copyMap(outbound)
			next["outbounds"] = toAny(relist(toStrings(refs), wasConfig, names))
			if def, ok := next["default"].(string); ok && wasConfig[def] && !contains(names, def) {
				delete(next, "default")
			}
			out = append(out, next)
			continue
		}
		out = append(out, outbound)
	}
	if !placed {
		out = append(out, proxies...)
	}
	base["outbounds"] = out
	return writeJSON(base, true)
}

func shapeClash(answers []parsed, list []kept) string {
	names := uniqueNames(list)
	wasConfig := configNames(answers)
	document := answers[0].clash
	root := document.Content[0]
	proxies := mapValue(root, "proxies")
	proxies.Content = nil
	for i, k := range list {
		proxy := cloneNode(answers[k.index].clashProxies[k.item])
		if name := mapValue(proxy, "name"); name != nil {
			name.Value = names[i]
			name.Style = yaml.DoubleQuotedStyle
		}
		proxies.Content = append(proxies.Content, proxy)
	}
	if groups := mapValue(root, "proxy-groups"); groups != nil && groups.Kind == yaml.SequenceNode {
		for _, group := range groups.Content {
			refs := mapValue(group, "proxies")
			if refs == nil || refs.Kind != yaml.SequenceNode {
				continue
			}
			var current []string
			for _, ref := range refs.Content {
				current = append(current, ref.Value)
			}
			refs.Content = nil
			for _, name := range relist(current, wasConfig, names) {
				refs.Content = append(refs.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: name, Style: yaml.DoubleQuotedStyle})
			}
		}
	}
	out, err := yaml.Marshal(document)
	if err != nil {
		return ""
	}
	return string(out)
}

func cloneNode(node *yaml.Node) *yaml.Node {
	copy := *node
	copy.Content = make([]*yaml.Node, len(node.Content))
	for i, child := range node.Content {
		copy.Content[i] = cloneNode(child)
	}
	return &copy
}

func toStrings(values []any) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func toAny(values []string) []any {
	out := make([]any, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
}

func contains(list []string, value string) bool {
	for _, v := range list {
		if v == value {
			return true
		}
	}
	return false
}
