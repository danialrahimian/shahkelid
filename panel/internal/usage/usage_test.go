package usage

import (
	"testing"
	"time"
)

const gb = int64(1 << 30)

var now = time.Date(2026, 11, 21, 12, 0, 0, 0, time.UTC)

func ptr[T any](v T) *T { return &v }

func made(panel, status string, used int64, limit *int64, expires *time.Time) Member {
	return Member{SubscriptionID: "s", PanelID: panel, PanelUserID: ptr(int64(1)), PanelStatus: ptr(status), UsedBytes: used, LifetimeUsedBytes: used, DataLimitBytes: limit, ExpiresAt: expires}
}

func TestTotals(t *testing.T) {
	soon := now.Add(48 * time.Hour)
	later := now.Add(96 * time.Hour)
	past := now.Add(-time.Hour)
	onHold := func(panel string, seconds int64) Member {
		m := made(panel, "on_hold", 0, ptr(50*gb), nil)
		m.OnHoldDurationSeconds = ptr(seconds)
		return m
	}

	tests := []struct {
		name    string
		limit   *int64
		members []Member
		status  string
		used    int64
		expires *time.Time
		hold    *int64
	}{
		{"usage on each panel adds up", ptr(50 * gb), []Member{made("a", "active", gb, ptr(50*gb), &soon), made("b", "active", 2*gb, ptr(50*gb), &soon)}, "active", 3 * gb, &soon, nil},
		{"the whole volume used across panels is limited, though no panel says so", ptr(50 * gb), []Member{made("a", "active", 30*gb, ptr(50*gb), &soon), made("b", "active", 20*gb, ptr(50*gb), &soon)}, "limited", 50 * gb, &soon, nil},
		{"the clock is the first panel's to start", ptr(50 * gb), []Member{made("a", "active", gb, nil, &later), made("b", "active", gb, nil, &soon)}, "active", 2 * gb, &soon, nil},
		{"past its expiry is expired", ptr(50 * gb), []Member{made("a", "active", gb, nil, &past)}, "expired", gb, &past, nil},
		{"one panel saying expired is enough", ptr(50 * gb), []Member{made("a", "active", gb, nil, &soon), made("b", "expired", 0, nil, &soon)}, "expired", gb, &soon, nil},
		{"on hold everywhere: the longest wait is kept", ptr(50 * gb), []Member{onHold("a", 86400), onHold("b", 2*86400)}, "on_hold", 0, nil, ptr(int64(2 * 86400))},
		{"started on one panel: started", ptr(50 * gb), []Member{onHold("a", 86400), made("b", "active", gb, nil, &soon)}, "active", gb, &soon, nil},
		{"switched off everywhere: disabled, keeping an expiry", ptr(50 * gb), []Member{made("a", "disabled", gb, nil, &soon)}, "disabled", gb, &soon, nil},
		{"one panel switched off by hand does not decide", ptr(50 * gb), []Member{made("a", "disabled", gb, nil, nil), made("b", "active", gb, nil, &soon)}, "active", 2 * gb, &soon, nil},
		{"unlimited: limited only when every started panel says so", nil, []Member{made("a", "limited", gb, nil, &soon), made("b", "active", gb, nil, &soon)}, "active", 2 * gb, &soon, nil},
		{"unlimited, every panel limited", nil, []Member{made("a", "limited", gb, nil, &soon)}, "limited", gb, &soon, nil},
		{"a panel not made yet counts nothing", ptr(50 * gb), []Member{made("a", "active", gb, nil, &soon), {PanelID: "b", UsedBytes: 9 * gb}}, "active", gb, &soon, nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := TotalsOf(test.limit, test.members, now)
			if got.Status != test.status || got.UsedBytes != test.used || !equalTimes(got.ExpiresAt, test.expires) || !equalLimits(got.OnHoldDurationSeconds, test.hold) {
				t.Fatalf("got %s used %d expires %v hold %v; want %s %d %v %v", got.Status, got.UsedBytes, got.ExpiresAt, deref(got.OnHoldDurationSeconds), test.status, test.used, test.expires, deref(test.hold))
			}
		})
	}
}

func deref(v *int64) any {
	if v == nil {
		return nil
	}
	return *v
}

func TestLimitFor(t *testing.T) {
	if LimitFor(nil, Member{}, 0) != nil {
		t.Fatal("unlimited stays unlimited")
	}
	if got := *LimitFor(ptr(50*gb), Member{UsedBytes: 10 * gb}, 30*gb); got != 30*gb {
		t.Fatalf("its own 10 + 20 left = 30 GB, got %d", got)
	}
	if got := *LimitFor(ptr(50*gb), Member{UsedBytes: 0}, 60*gb); got != 1 {
		t.Fatalf("never 0 (the panels' unlimited), got %d", got)
	}
}

func TestChangeFor(t *testing.T) {
	soon := now.Add(48 * time.Hour)
	limit := ptr(50 * gb)

	t.Run("a panel whose limit is right is left alone", func(t *testing.T) {
		m := made("a", "active", 10*gb, ptr(50*gb), &soon)
		if c := ChangeFor(limit, m, TotalsOf(limit, []Member{m}, now)); !c.Empty() {
			t.Fatalf("got %+v", c)
		}
	})

	t.Run("two panels each get their share of what is left", func(t *testing.T) {
		a := made("a", "active", 10*gb, ptr(50*gb), &soon)
		b := made("b", "active", 20*gb, ptr(50*gb), &soon)
		totals := TotalsOf(limit, []Member{a, b}, now)
		c := ChangeFor(limit, a, totals)
		if c.DataLimitBytes == nil || **c.DataLimitBytes != 30*gb {
			t.Fatalf("a: 10 + 20 left = 30 GB, got %+v", c)
		}
	})

	t.Run("a small difference waits, unless the volume is nearly gone", func(t *testing.T) {
		m := made("a", "active", 10*gb, ptr(50*gb+SlackBytes/2), &soon)
		if c := ChangeFor(limit, m, TotalsOf(limit, []Member{m}, now)); !c.Empty() {
			t.Fatalf("got %+v", c)
		}
		nearly := made("a", "active", 50*gb-SlackBytes/2, ptr(50*gb+SlackBytes/4), &soon)
		other := made("b", "active", 0, ptr(50*gb), &soon)
		c := ChangeFor(limit, nearly, TotalsOf(limit, []Member{nearly, other}, now))
		if c.DataLimitBytes == nil {
			t.Fatal("near the end every byte counts")
		}
	})

	t.Run("a panel stopped while volume is left is let go again", func(t *testing.T) {
		a := made("a", "limited", 5*gb, ptr(5*gb), &soon)
		b := made("b", "active", 10*gb, ptr(50*gb), &soon)
		c := ChangeFor(limit, a, TotalsOf(limit, []Member{a, b}, now))
		if !c.Activate || c.DataLimitBytes == nil || **c.DataLimitBytes != 40*gb {
			t.Fatalf("got %+v", c)
		}
	})

	t.Run("a panel still on hold starts when another saw the first connection", func(t *testing.T) {
		waiting := Member{PanelID: "a", PanelUserID: ptr(int64(1)), PanelStatus: ptr("on_hold"), DataLimitBytes: ptr(50 * gb), OnHoldDurationSeconds: ptr(int64(86400))}
		started := made("b", "active", gb, ptr(50*gb), &soon)
		totals := TotalsOf(limit, []Member{waiting, started}, now)
		c := ChangeFor(limit, waiting, totals)
		if !c.Activate || c.ExpiresAt == nil || !(*c.ExpiresAt).Equal(soon) {
			t.Fatalf("got %+v", c)
		}
	})

	t.Run("an expiry out of step is set to the whole's", func(t *testing.T) {
		later := soon.Add(time.Hour)
		a := made("a", "active", gb, ptr(50*gb), &later)
		b := made("b", "active", gb, ptr(50*gb), &soon)
		c := ChangeFor(limit, a, TotalsOf(limit, []Member{a, b}, now))
		if c.ExpiresAt == nil || !(*c.ExpiresAt).Equal(soon) {
			t.Fatalf("got %+v", c)
		}
	})

	t.Run("a panel switched off by hand is not touched", func(t *testing.T) {
		m := made("a", "disabled", 60*gb, ptr(gb), nil)
		if c := ChangeFor(limit, m, TotalsOf(limit, []Member{m}, now)); !c.Empty() {
			t.Fatalf("got %+v", c)
		}
	})
}

func TestSubscriptionFrom(t *testing.T) {
	soon := now.Add(time.Hour)
	a := made("a", "active", gb, nil, &soon)
	a.PanelUserID, a.PanelSubscriptionURL = ptr(int64(7)), ptr("https://a/sub/1")
	b := made("b", "active", gb, nil, &soon)
	b.LastError = ptr(Missing)

	got := SubscriptionFrom(ptr(50*gb), "a", []Member{b, a}, now)
	if *got.PanelUserID != 7 || *got.PanelSubscriptionURL != "https://a/sub/1" {
		t.Fatalf("the main panel's user and link, got %+v", got)
	}
	if got.LastError == nil || *got.LastError != Missing {
		t.Fatal("a panel whose user is gone is said")
	}
	if got.UsedBytes != 2*gb {
		t.Fatalf("a panel whose user is gone keeps its last count in the total, got %d", got.UsedBytes)
	}
}
