package pasarguard_test

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danialrahimian/shahkelid/panel/internal/fakepanel"
	"github.com/danialrahimian/shahkelid/panel/internal/pasarguard"
)

var ctx = context.Background()

func client(p *fakepanel.Panel) *pasarguard.Client {
	return pasarguard.New(p.URL(), pasarguard.Credentials{Kind: "password", Username: "operator", Password: "right"}, nil)
}

func ptr[T any](v T) *T { return &v }

func TestCreateFindAndChangeAUser(t *testing.T) {
	p := fakepanel.New()
	defer p.Close()
	c := client(p)

	made, err := c.CreateUser(ctx, pasarguard.NewUser{
		Username: "sk_one", GroupIDs: []int64{2}, DataLimitBytes: ptr(int64(50 << 30)), DeviceLimit: ptr(int64(2)),
		StartsOnFirstUse: true, DurationSeconds: 30 * 86400, StartsAtLatest: time.Now().Add(720 * time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if made.Status != "on_hold" || *made.DataLimitBytes != 50<<30 || *made.OnHoldDurationSeconds != 30*86400 {
		t.Fatalf("made %+v", made)
	}
	if !strings.HasPrefix(made.SubscriptionURL, p.URL()+"/sub/") {
		t.Fatalf("a relative subscription link is made absolute, got %q", made.SubscriptionURL)
	}

	found, err := c.FindUser(ctx, "sk_one")
	if err != nil || found == nil || found.ID != made.ID {
		t.Fatalf("found %+v, %v", found, err)
	}
	missing, err := c.FindUser(ctx, "nobody")
	if err != nil || missing != nil {
		t.Fatalf("a missing user is nil without an error, got %+v, %v", missing, err)
	}

	end := time.Date(2027, 1, 2, 3, 4, 5, 0, time.UTC)
	limit := ptr(int64(80 << 30))
	changed, err := c.UpdateLimits(ctx, "sk_one", pasarguard.Change{DataLimitBytes: &limit, ExpiresAt: ptr(&end), Activate: true, GroupIDs: []int64{2, 7}})
	if err != nil {
		t.Fatal(err)
	}
	if changed.Status != "active" || !changed.ExpiresAt.Equal(end) || *changed.DataLimitBytes != 80<<30 || len(changed.GroupIDs) != 2 {
		t.Fatalf("changed %+v", changed)
	}

	var unlimited *int64
	open, err := c.UpdateLimits(ctx, "sk_one", pasarguard.Change{DataLimitBytes: &unlimited})
	if err != nil || open.DataLimitBytes != nil {
		t.Fatalf("0 on the panel reads as unlimited, got %+v, %v", open.DataLimitBytes, err)
	}

	off, err := c.SetEnabled(ctx, "sk_one", false)
	if err != nil || off.Status != "disabled" {
		t.Fatalf("disabled %+v, %v", off, err)
	}
}

func TestListsUsersPageByPage(t *testing.T) {
	p := fakepanel.New()
	defer p.Close()
	c := client(p)
	for _, name := range []string{"a", "b", "c"} {
		if _, err := c.CreateUser(ctx, pasarguard.NewUser{Username: name, GroupIDs: []int64{2}}); err != nil {
			t.Fatal(err)
		}
	}
	users, total, err := c.ListUsers(ctx, 1, 2)
	if err != nil || total != 3 || len(users) != 2 || users[0].Username != "b" {
		t.Fatalf("page %+v of %d, %v", users, total, err)
	}
}

func TestErrorsSayWhetherToTryAgain(t *testing.T) {
	p := fakepanel.New()
	defer p.Close()
	c := client(p)

	if _, err := c.CreateUser(ctx, pasarguard.NewUser{Username: "a"}); err != nil {
		t.Fatal(err)
	}
	_, err := c.CreateUser(ctx, pasarguard.NewUser{Username: "a"})
	if status, rejected := pasarguard.IsRejected(err); !rejected || status != http.StatusConflict {
		t.Fatalf("a taken name is a refusal (409), got %v", err)
	}

	p.Mu.Lock()
	p.Down = true
	p.Mu.Unlock()
	_, err = c.FindUser(ctx, "a")
	var unavailable *pasarguard.Unavailable
	if _, rejected := pasarguard.IsRejected(err); rejected || err == nil || !asUnavailable(err, &unavailable) {
		t.Fatalf("a panel that is down is worth trying again, got %v", err)
	}

	gone := pasarguard.New("http://127.0.0.1:1", pasarguard.Credentials{Kind: "api_key", APIKey: "k"}, nil)
	if _, err := gone.FindUser(ctx, "a"); !asUnavailable(err, &unavailable) {
		t.Fatalf("a panel that cannot be reached is worth trying again, got %v", err)
	}
}

func asUnavailable(err error, target **pasarguard.Unavailable) bool {
	u, ok := err.(*pasarguard.Unavailable)
	*target = u
	return ok
}

func TestSignsInOnceAndAgainWhenTheTokenExpires(t *testing.T) {
	signIns, expired := 0, true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/admin/token":
			signIns++
			_, _ = w.Write([]byte(`{"access_token":"t"}`))
		default:
			if r.Header.Get("authorization") != "Bearer t" {
				t.Errorf("asked without the token: %q", r.Header.Get("authorization"))
			}
			if expired {
				expired = false
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	c := pasarguard.New(server.URL, pasarguard.Credentials{Kind: "password", Username: "u", Password: "p"}, nil)

	for range 3 {
		if _, err := c.FindUser(ctx, "x"); err != nil {
			t.Fatal(err)
		}
	}
	if signIns != 2 {
		t.Fatalf("signed in %d times; want once, and once more after the token expired", signIns)
	}
}

func TestAPIKeyGoesInItsHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "secret" || r.URL.Path == "/api/admin/token" {
			t.Errorf("api key %q, path %s", r.Header.Get("x-api-key"), r.URL.Path)
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()
	c := pasarguard.New(server.URL, pasarguard.Credentials{Kind: "api_key", APIKey: "secret"}, nil)
	if _, err := c.FindUser(ctx, "x"); err != nil {
		t.Fatal(err)
	}
}

func TestGroupsWithAResellersAccount(t *testing.T) {
	p := fakepanel.New()
	defer p.Close()
	c := client(p)

	full, err := c.ListGroups(ctx)
	if err != nil || len(full) != 2 || len(full[0].InboundTags) != 2 {
		t.Fatalf("an owner's account reads the inbounds, got %+v, %v", full, err)
	}

	p.Mu.Lock()
	p.Reseller = true
	p.Mu.Unlock()
	simple, err := c.ListGroups(ctx)
	if err != nil || len(simple) != 2 || simple[1].Name != "nl" || simple[0].InboundTags != nil {
		t.Fatalf("a reseller's account reads ids and names, got %+v, %v", simple, err)
	}
}

func TestReadsLinksInTheFormatThePanelAllows(t *testing.T) {
	links := "vless://u@a.example.com:443?type=ws#DE\ntrojan://p@b.example.com:443?type=grpc#NL"
	tests := []struct {
		name   string
		routes map[string]func(*http.Request) (int, string)
		want   string
		fails  bool
	}{
		{
			name:   "plain list",
			routes: map[string]func(*http.Request) (int, string){"/sub/x/links": func(*http.Request) (int, string) { return 200, links }},
			want:   links,
		},
		{
			name: "plain switched off: base64",
			routes: map[string]func(*http.Request) (int, string){
				"/sub/x/links":        func(*http.Request) (int, string) { return 406, `{"detail":"Client not supported"}` },
				"/sub/x/links_base64": func(*http.Request) (int, string) { return 200, base64.StdEncoding.EncodeToString([]byte(links)) },
			},
			want: links,
		},
		{
			name: "both off: as a links app reads it",
			routes: map[string]func(*http.Request) (int, string){
				"/sub/x/links":        func(*http.Request) (int, string) { return 406, "" },
				"/sub/x/links_base64": func(*http.Request) (int, string) { return 406, "" },
				"/sub/x": func(r *http.Request) (int, string) {
					if strings.HasPrefix(r.Header.Get("user-agent"), "v2rayNG") {
						return 200, base64.StdEncoding.EncodeToString([]byte(links))
					}
					return 200, "<html>"
				},
			},
			want: links,
		},
		{
			name: "nothing readable is an error, not an empty group",
			routes: map[string]func(*http.Request) (int, string){
				"/sub/x/links":        func(*http.Request) (int, string) { return 406, "" },
				"/sub/x/links_base64": func(*http.Request) (int, string) { return 406, "" },
				"/sub/x":              func(*http.Request) (int, string) { return 200, "<html>" },
			},
			fails: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				route, ok := test.routes[r.URL.Path]
				if !ok {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				status, body := route(r)
				w.WriteHeader(status)
				_, _ = w.Write([]byte(body))
			}))
			defer server.Close()
			c := pasarguard.New(server.URL, pasarguard.Credentials{Kind: "api_key", APIKey: "k"}, nil)
			got, err := c.ReadLinks(ctx, server.URL+"/sub/x/")
			if test.fails {
				if err == nil {
					t.Fatalf("read %q, want an error", got)
				}
				return
			}
			if err != nil || got != test.want {
				t.Fatalf("read %q, %v", got, err)
			}
		})
	}
}

func TestDatesWithoutAZoneAreUTC(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":1,"username":"a","status":"active","data_limit":0,"used_traffic":5,
			"expire":"2027-01-02T03:04:05","online_at":"2026-11-20T10:00:00.123456","group_ids":null,"subscription_url":"https://sub.example/x"}`))
	}))
	defer server.Close()
	c := pasarguard.New(server.URL, pasarguard.Credentials{Kind: "api_key", APIKey: "k"}, nil)
	user, err := c.FindUser(ctx, "a")
	if err != nil {
		t.Fatal(err)
	}
	if !user.ExpiresAt.Equal(time.Date(2027, 1, 2, 3, 4, 5, 0, time.UTC)) || user.OnlineAt.Nanosecond() != 123456000 {
		t.Fatalf("dates %v %v", user.ExpiresAt, user.OnlineAt)
	}
	if user.DataLimitBytes != nil || user.LifetimeUsedBytes != 5 || user.GroupIDs == nil || user.SubscriptionURL != "https://sub.example/x" {
		t.Fatalf("user %+v", user)
	}
}
