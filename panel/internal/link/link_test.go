package link

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danialrahimian/shahkelid/panel/internal/configs"
	"github.com/danialrahimian/shahkelid/panel/internal/fakepanel"
	"github.com/danialrahimian/shahkelid/panel/internal/panels"
	"github.com/danialrahimian/shahkelid/panel/internal/store"
	"github.com/danialrahimian/shahkelid/panel/internal/testdb"
)

func ptr[T any](v T) *T { return &v }

// ------------------------------------------------------------------ apps

func TestWhichAppsGetXrayJSON(t *testing.T) {
	tests := map[string]bool{
		"v2rayNG/1.9.45":                  true,
		"v2rayNG/1.8.29":                  true,
		"v2rayNG/1.8.28":                  false,
		"v2rayN/7.4.2":                    true,
		"v2rayN/6.39":                     false,
		"Streisand/1.6.12":                true,
		"Happ/1.63.1":                     true,
		"Happ/1.50":                       false,
		"v2RayTun/2.1 (Android)":          true,
		"ktor-client":                     true,
		"HiddifyNext/2.5.7":               false,
		"ClashMetaForAndroid/2.11.0":      false,
		"Mozilla/5.0 (X11; Linux x86_64)": false,
		"":                                false,
	}
	for userAgent, want := range tests {
		if got := readsXrayJSON(userAgent); got != want {
			t.Errorf("%q: %v; want %v", userAgent, got, want)
		}
	}
}

func TestLimiter(t *testing.T) {
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l := newLimiter(2, time.Minute, func() time.Time { return at })
	if !l.allow("a") || !l.allow("a") || l.allow("a") {
		t.Fatal("two a minute")
	}
	if !l.allow("b") {
		t.Fatal("each address has its own")
	}
	at = at.Add(time.Minute)
	if !l.allow("a") {
		t.Fatal("a new minute starts again")
	}
}

// ------------------------------------------------------------ the link

type world struct {
	t       *testing.T
	s       *store.Store
	panel   *fakepanel.Panel
	panelID string
	plan    string
	group   string
	server  *httptest.Server
	node    *httptest.Server
	catalog *Catalog
	nodeHit string
}

func newWorld(t *testing.T) *world {
	t.Helper()
	w := &world{t: t, s: testdb.Open(t), panel: fakepanel.New()}
	t.Cleanup(w.panel.Close)
	w.panelID = testdb.Panel(t, w.s, "Panel", w.panel.URL())
	w.plan = testdb.Plan(t, w.s)
	w.group = testdb.Group(t, w.s, "Germany", testdb.Source{PanelID: w.panelID, PanelGroupID: 2, AllHosts: true})
	w.node = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		w.nodeHit = r.URL.Path
		_, _ = io.WriteString(rw, "from node")
	}))
	t.Cleanup(w.node.Close)
	clients := panels.New(testdb.Key)
	w.catalog = &Catalog{Panels: func(p store.Panel) (ProbePanel, error) { return clients.For(p) }}
	handler := &Handler{Store: w.s, Catalog: w.catalog, AppURL: w.node.URL, PublicURL: "https://shop.test"}
	w.server = httptest.NewServer(http.StripPrefix("", handler))
	t.Cleanup(w.server.Close)
	return w
}

// customer makes a live subscription on the fake panel, carrying the group.
func (w *world) customer(groups ...int64) (token, username string) {
	w.t.Helper()
	if len(groups) == 0 {
		groups = []int64{2}
	}
	id, username := testdb.Subscription(w.t, w.s, testdb.Sub{PlanID: w.plan, Limit: ptr(50 * gb), Groups: []string{w.group}, Copies: []testdb.Copy{
		{PanelID: w.panelID, PanelUserID: ptr(int64(1)), Status: "active", Limit: ptr(50 * gb), GroupIDs: groups},
	}})
	w.panel.Mu.Lock()
	user := &fakepanel.User{ID: 900, Username: username, Status: "active", DataLimit: 50 * gb, GroupIDs: groups, Token: "cust" + username}
	w.panel.Users[username] = user
	w.panel.Mu.Unlock()
	url := w.panel.URL() + "/sub/" + user.Token
	if _, err := w.s.Pool.Exec(context.Background(), `update subscription_panels set panel_subscription_url = $2 where subscription_id = $1`, id, url); err != nil {
		w.t.Fatal(err)
	}
	row := testdb.Row(w.t, w.s, `select access_token from subscriptions where id = $1`, id)
	return row["access_token"].(string), username
}

func (w *world) get(path, userAgent string, header ...string) (*http.Response, string) {
	w.t.Helper()
	request, _ := http.NewRequest(http.MethodGet, w.server.URL+path, nil)
	request.Header.Set("user-agent", userAgent)
	for i := 0; i+1 < len(header); i += 2 {
		request.Header.Set(header[i], header[i+1])
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		w.t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	return response, string(body)
}

func names(t *testing.T, body string) []string {
	t.Helper()
	text := body
	if decoded, err := base64.StdEncoding.DecodeString(body); err == nil {
		text = string(decoded)
	}
	var out []string
	for _, line := range strings.Split(text, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			out = append(out, configs.FingerprintOfLink(line).Name)
		}
	}
	return out
}

// hostID finds our id of a panel host by the start of its name.
func (w *world) hostID(panelGroupID int64, prefix string) string {
	w.t.Helper()
	p, err := w.s.FindPanel(context.Background(), w.panelID)
	if err != nil {
		w.t.Fatal(err)
	}
	hosts, err := w.catalog.Read(context.Background(), p, panelGroupID)
	if err != nil {
		w.t.Fatal(err)
	}
	for _, h := range hosts {
		if strings.HasPrefix(h.Name, prefix) {
			return h.ID
		}
	}
	w.t.Fatalf("no host %q", prefix)
	return ""
}

func (w *world) setHost(hostID string, selected bool, name *string, place *int) {
	w.t.Helper()
	_, err := w.s.Pool.Exec(context.Background(), `insert into group_hosts (group_id, panel_id, host_id, selected, name, sort_order)
		values ($1, $2, $3, $4, $5, $6)
		on conflict (group_id, panel_id, host_id) do update set selected = excluded.selected, name = excluded.name, sort_order = excluded.sort_order`,
		w.group, w.panelID, hostID, selected, name, place)
	if err != nil {
		w.t.Fatal(err)
	}
	w.catalog.Forget()
}

const oldV2rayNG = "v2rayNG/1.8.0"

func TestEveryHostAsThePanelGivesThem(t *testing.T) {
	w := newWorld(t)
	token, username := w.customer()

	response, body := w.get("/s/"+token, oldV2rayNG)

	if response.StatusCode != 200 {
		t.Fatalf("status %d: %s", response.StatusCode, body)
	}
	if got := strings.Join(names(t, body), ","); got != "🇩🇪 DE-1 "+username+",🇩🇪 DE-2 [vmess]" {
		t.Fatalf("names %s", got)
	}
	if strings.Contains(body, w.panel.URL()) || strings.Contains(response.Header.Get("profile-web-page-url"), w.panel.URL()) {
		t.Fatal("the panel's address reached the customer")
	}
	if response.Header.Get("profile-web-page-url") != "https://shop.test/s/"+token || response.Header.Get("cache-control") != "no-store" {
		t.Fatalf("headers %v", response.Header)
	}
	if !strings.Contains(response.Header.Get("subscription-userinfo"), "total=53687091200") {
		t.Fatal("the panel's usage header is passed on")
	}
	if w.panel.User("skprobe_g2") == nil {
		t.Fatal("the group's hosts are read through the shop's own subscription")
	}
}

func TestPickedRenamedAndOrdered(t *testing.T) {
	w := newWorld(t)
	testdb.SetSources(t, w.s, w.group, testdb.Source{PanelID: w.panelID, PanelGroupID: 2, AllHosts: false})
	token, _ := w.customer()
	de1, de2 := w.hostID(2, "🇩🇪 DE-1"), w.hostID(2, "🇩🇪 DE-2")
	w.setHost(de1, true, ptr("Germany {DATA_LEFT}"), ptr(1))
	w.setHost(de2, true, nil, ptr(0))

	_, body := w.get("/s/"+token, oldV2rayNG)

	if got := strings.Join(names(t, body), ","); got != "🇩🇪 DE-2 [vmess],Germany 50 GB" {
		t.Fatalf("names %s", got)
	}

	w.setHost(de2, false, nil, ptr(0))
	_, body = w.get("/s/"+token, oldV2rayNG)
	if got := strings.Join(names(t, body), ","); got != "Germany 50 GB" {
		t.Fatalf("a host left out is not given: %s", got)
	}
}

func TestXrayAppsGetFullXrayConfigs(t *testing.T) {
	w := newWorld(t)
	token, _ := w.customer()
	w.setHost(w.hostID(2, "🇩🇪 DE-2"), false, ptr("Fast"), nil)

	response, body := w.get("/s/"+token, "v2rayNG/1.9.45")

	if !strings.HasPrefix(response.Header.Get("content-type"), "application/json") {
		t.Fatalf("content type %q", response.Header.Get("content-type"))
	}
	var list []map[string]any
	if err := json.Unmarshal([]byte(body), &list); err != nil {
		t.Fatalf("not Xray JSON: %v\n%s", err, body)
	}
	if len(list) != 2 || list[1]["remarks"] != "Fast" {
		t.Fatalf("configs %v", list)
	}
	if !strings.Contains(body, `"dialerProxy": "fragment"`) {
		t.Fatal("the fragment settings a link cannot carry are kept")
	}
}

func TestXrayFormatOffFallsBackToLinks(t *testing.T) {
	w := newWorld(t)
	token, username := w.customer()
	w.panel.Mu.Lock()
	w.panel.XrayOff = true
	w.panel.Mu.Unlock()

	response, body := w.get("/s/"+token, "v2rayNG/1.9.45")

	if response.StatusCode != 200 || strings.HasPrefix(response.Header.Get("content-type"), "application/json") {
		t.Fatalf("status %d type %q", response.StatusCode, response.Header.Get("content-type"))
	}
	if got := strings.Join(names(t, body), ","); got != "🇩🇪 DE-1 "+username+",🇩🇪 DE-2 [vmess]" {
		t.Fatalf("names %s", got)
	}
}

func TestSingBoxAndClashApps(t *testing.T) {
	w := newWorld(t)
	token, _ := w.customer()
	w.setHost(w.hostID(2, "🇩🇪 DE-2"), false, ptr("Fast"), ptr(0))

	_, body := w.get("/s/"+token, "HiddifyNext/2.5.7")
	var profile struct {
		Outbounds []struct {
			Tag       string   `json:"tag"`
			Outbounds []string `json:"outbounds"`
		} `json:"outbounds"`
	}
	if err := json.Unmarshal([]byte(body), &profile); err != nil {
		t.Fatalf("not sing-box: %v", err)
	}
	if profile.Outbounds[0].Tag != "Select" || profile.Outbounds[0].Outbounds[1] != "Fast" {
		t.Fatalf("selector %+v", profile.Outbounds[0])
	}

	_, clash := w.get("/s/"+token, "ClashMetaForAndroid/2.11.0")
	if !strings.Contains(clash, `name: "Fast"`) || !strings.Contains(clash, "proxy-groups") {
		t.Fatalf("clash %s", clash)
	}
}

func TestAResellersPanel(t *testing.T) {
	w := newWorld(t)
	w.panel.Mu.Lock()
	w.panel.Reseller = true
	w.panel.Limited = true
	w.panel.Mu.Unlock()
	token, _ := w.customer()

	response, body := w.get("/s/"+token, oldV2rayNG)

	if response.StatusCode != 200 || len(names(t, body)) != 2 {
		t.Fatalf("status %d names %v", response.StatusCode, names(t, body))
	}
	probe := w.panel.User("skprobe_g2")
	if probe == nil || probe.DataLimit != gb || probe.Expire == nil {
		t.Fatalf("probe %+v; want the least a limited account may make", probe)
	}
}

func TestLinksNotServed(t *testing.T) {
	w := newWorld(t)
	token, _ := w.customer()

	for _, path := range []string{"/s/short", "/s/" + strings.Repeat("x", 30), "/s/" + token + "/nope"} {
		if response, _ := w.get(path, oldV2rayNG); response.StatusCode != 404 {
			t.Errorf("%s: %d", path, response.StatusCode)
		}
	}
	if _, err := w.s.Pool.Exec(context.Background(), `update subscriptions set status = 'deleted' where access_token = $1`, token); err != nil {
		t.Fatal(err)
	}
	if response, _ := w.get("/s/"+token, oldV2rayNG); response.StatusCode != 404 {
		t.Fatalf("a deleted subscription's link: %d", response.StatusCode)
	}
}

func TestThePageIsTheShops(t *testing.T) {
	w := newWorld(t)
	token, _ := w.customer()

	_, page := w.get("/s/"+token, "Mozilla/5.0", "accept", "text/html")
	_, info := w.get("/s/"+token+"/info", oldV2rayNG)
	if page != "from node" || info != "from node" || w.nodeHit != "/s/"+token+"/info" {
		t.Fatalf("page %q info %q hit %q", page, info, w.nodeHit)
	}
}

func TestTooManyRequests(t *testing.T) {
	w := newWorld(t)
	token, _ := w.customer()
	handler := &Handler{Store: w.s, Catalog: w.catalog, AppURL: w.node.URL, PublicURL: "https://shop.test", Limit: 2}
	server := httptest.NewServer(handler)
	defer server.Close()
	var last int
	for range 3 {
		response, err := http.Get(server.URL + "/s/" + token)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		last = response.StatusCode
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("third request: %d", last)
	}
}

func TestHeadAsksOnlyForHeaders(t *testing.T) {
	w := newWorld(t)
	token, _ := w.customer()
	response, err := http.Head(w.server.URL + "/s/" + token)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || response.Header.Get("subscription-userinfo") == "" {
		t.Fatalf("status %d headers %v", response.StatusCode, response.Header)
	}
}
