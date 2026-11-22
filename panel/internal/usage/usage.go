// Package usage works out one subscription's volume, time and status from
// what each of its panels counts, and what each panel must be told so that
// all of them agree. It is pure: no database, no network.
//
// The customer has one link and one volume. On each panel there is a panel
// user with the same username, and each panel counts what is used through
// its own configs. So:
//
//   - The subscription's usage is the sum of its panels' usage: 1 GB on one
//     panel and 2 GB on another is 3 GB used.
//   - The subscription's limit is ours (the plan's volume, plus renewals).
//     Each panel is given "what it has counted itself, plus what is left
//     overall" as its limit, so whichever panel the customer uses, it stops
//     them when the whole volume is gone.
//   - The clock is one: when the first panel sees a connection and starts
//     the time, the others are started with the same expiry.
//
// Between two syncs a customer using two panels at once could go over by
// what they use in that time; SlackBytes bounds what is tolerated on top.
//
// The Node app keeps the same rules (back-end/src/modules/subscriptions/members.ts)
// for what it does on request; the two are tested against the same cases.
package usage

import "time"

// SlackBytes is the smallest difference in a panel's limit worth setting.
const SlackBytes = 16 * 1024 * 1024

// Missing is the error kept on a panel's row when its user is gone from it.
const Missing = "Not found on the panel"

// Synced lists the statuses the panels decide, and so the ones kept in step with them.
var Synced = []string{"on_hold", "active", "limited", "expired", "disabled"}

// IsSynced reports whether the panels decide a subscription of this status.
func IsSynced(status string) bool {
	for _, s := range Synced {
		if s == status {
			return true
		}
	}
	return false
}

// Member is one panel's copy of a subscription (a subscription_panels row).
type Member struct {
	SubscriptionID        string
	PanelID               string
	PanelUserID           *int64
	PanelSubscriptionURL  *string
	PanelStatus           *string
	DataLimitBytes        *int64
	UsedBytes             int64
	LifetimeUsedBytes     int64
	ExpiresAt             *time.Time
	OnHoldDurationSeconds *int64
	OnlineAt              *time.Time
	LastError             *string
	GroupIDs              []int64
}

// Made reports whether the user exists on this panel (as far as we know).
func (m Member) Made() bool { return m.PanelUserID != nil }

func (m Member) status() string {
	if m.PanelStatus == nil {
		return ""
	}
	return *m.PanelStatus
}

// IsMissing reports whether the panel said its user is gone.
func (m Member) IsMissing() bool { return m.LastError != nil && *m.LastError == Missing }

// Totals is the subscription as a whole.
type Totals struct {
	Status                string
	UsedBytes             int64
	LifetimeUsedBytes     int64
	OnlineAt              *time.Time
	ExpiresAt             *time.Time
	OnHoldDurationSeconds *int64
}

// TotalsOf adds up a subscription's panels: usage summed, one status, one
// expiry. dataLimit is ours (nil: unlimited).
func TotalsOf(dataLimit *int64, members []Member, now time.Time) Totals {
	var made, enabled []Member
	var totals Totals
	for _, m := range members {
		if !m.Made() {
			continue
		}
		made = append(made, m)
		totals.UsedBytes += m.UsedBytes
		totals.LifetimeUsedBytes += m.LifetimeUsedBytes
		if m.OnlineAt != nil && (totals.OnlineAt == nil || m.OnlineAt.After(*totals.OnlineAt)) {
			totals.OnlineAt = m.OnlineAt
		}
		// A panel switched off by hand does not decide for the others.
		if m.status() != "disabled" {
			enabled = append(enabled, m)
		}
	}

	allOnHold := true
	for _, m := range enabled {
		if m.status() != "on_hold" {
			allOnHold = false
		}
	}

	switch {
	case len(made) > 0 && len(enabled) == 0:
		totals.Status = "disabled"
		for _, m := range made {
			if m.ExpiresAt != nil {
				totals.ExpiresAt = m.ExpiresAt
				break
			}
		}
	case allOnHold:
		totals.Status = "on_hold"
		for _, m := range enabled {
			if m.OnHoldDurationSeconds != nil && (totals.OnHoldDurationSeconds == nil || *m.OnHoldDurationSeconds > *totals.OnHoldDurationSeconds) {
				totals.OnHoldDurationSeconds = m.OnHoldDurationSeconds
			}
		}
	default:
		// Started: the clock is the first panel's to have started it.
		var started []Member
		for _, m := range enabled {
			if m.status() != "on_hold" {
				started = append(started, m)
			}
		}
		anyExpired, allLimited := false, true
		for _, m := range started {
			if m.ExpiresAt != nil && (totals.ExpiresAt == nil || m.ExpiresAt.Before(*totals.ExpiresAt)) {
				totals.ExpiresAt = m.ExpiresAt
			}
			anyExpired = anyExpired || m.status() == "expired"
			allLimited = allLimited && m.status() == "limited"
		}
		outOfTime := (totals.ExpiresAt != nil && !totals.ExpiresAt.After(now)) || anyExpired
		outOfVolume := allLimited
		if dataLimit != nil {
			outOfVolume = totals.UsedBytes >= *dataLimit
		}
		switch {
		case outOfTime:
			totals.Status = "expired"
		case outOfVolume:
			totals.Status = "limited"
		default:
			totals.Status = "active"
		}
	}
	return totals
}

// LimitFor is the limit one panel should have: what it counted itself, plus
// what is left overall. Never 0, which is "unlimited" to the panels.
func LimitFor(dataLimit *int64, member Member, totalUsed int64) *int64 {
	if dataLimit == nil {
		return nil
	}
	limit := member.UsedBytes + max(0, *dataLimit-totalUsed)
	limit = max(1, limit)
	return &limit
}

// Change is what one panel must be told to agree with the whole. A nil
// field is left alone; for the double pointers, a non-nil outer pointer
// holding nil means "unlimited" or "never".
type Change struct {
	DataLimitBytes **int64
	ExpiresAt      **time.Time
	Activate       bool
}

// Empty reports whether nothing needs telling.
func (c Change) Empty() bool { return c.DataLimitBytes == nil && c.ExpiresAt == nil && !c.Activate }

func equalLimits(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func equalTimes(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	// The panels keep seconds; ours may keep more.
	return a.Truncate(time.Millisecond).Equal(b.Truncate(time.Millisecond))
}

// ChangeFor says what one panel must be told for it to agree with the
// whole, or an empty Change.
func ChangeFor(dataLimit *int64, member Member, totals Totals) Change {
	var change Change
	if member.status() == "disabled" {
		return change
	}

	wanted := LimitFor(dataLimit, member, totals.UsedBytes)
	has := member.DataLimitBytes
	remainingKnown := dataLimit != nil
	var remaining int64
	if remainingKnown {
		remaining = max(0, *dataLimit-totals.UsedBytes)
	}
	wronglyStopped := member.status() == "limited" && (wanted == nil || member.UsedBytes < *wanted)
	if !equalLimits(wanted, has) {
		far := wanted == nil || has == nil || abs(*wanted-*has) > SlackBytes
		nearlyGone := remainingKnown && remaining <= SlackBytes
		if far || nearlyGone || wronglyStopped {
			change.DataLimitBytes = &wanted
		}
	}
	if wronglyStopped {
		change.Activate = true
	}

	if totals.Status != "on_hold" && totals.Status != "disabled" {
		if member.status() == "on_hold" {
			// Another panel saw the first connection: this one's clock starts with it.
			expires := totals.ExpiresAt
			change.ExpiresAt = &expires
			change.Activate = true
		} else if !equalTimes(member.ExpiresAt, totals.ExpiresAt) {
			expires := totals.ExpiresAt
			change.ExpiresAt = &expires
		}
	}
	return change
}

func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// Subscription is the subscription's own columns, as its panels make them.
type Subscription struct {
	Totals
	PanelUserID          *int64
	PanelSubscriptionURL *string
	LastError            *string
}

// SubscriptionFrom works out a subscription's columns from its panels. The
// main panel gives the panel user and link it shows.
func SubscriptionFrom(dataLimit *int64, mainPanelID string, members []Member, now time.Time) Subscription {
	out := Subscription{Totals: TotalsOf(dataLimit, members, now)}
	var primary *Member
	for i := range members {
		if members[i].PanelID == mainPanelID {
			primary = &members[i]
			break
		}
	}
	if primary == nil && len(members) > 0 {
		primary = &members[0]
	}
	if primary != nil {
		out.PanelUserID = primary.PanelUserID
		out.PanelSubscriptionURL = primary.PanelSubscriptionURL
	}
	for _, m := range members {
		if m.IsMissing() {
			missing := Missing
			out.LastError = &missing
			break
		}
	}
	return out
}
