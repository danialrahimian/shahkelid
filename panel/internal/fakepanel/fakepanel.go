// Package fakepanel is a PasarGuard panel in memory, served over HTTP, for
// tests. It answers the endpoints the shop uses the way PasarGuard v5 does
// (as the Node app's contract tests showed), and gives each user's configs
// on their subscription link in the format their app asks for.
package fakepanel

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Host is one config the panel gives every user whose groups grant its inbound.
type Host struct {
	ID       int64
	Remark   string // a template: {USERNAME}, {PROTOCOL}, {DATA_LEFT}…
	Inbound  string
	Address  string
	Port     int
	Priority int
}

// Inbound is an inbound of the panel's core.
type Inbound struct {
	Tag      string
	Protocol string
	Network  string
	Path     string
}

// Group is one of the panel's groups.
type Group struct {
	ID       int64
	Name     string
	Inbounds []string
}

// User is a panel user as the fake keeps it.
type User struct {
	ID             int64
	Username       string
	Status         string
	DataLimit      int64 // 0: unlimited
	Used           int64
	Lifetime       int64
	Expire         *time.Time
	OnHoldDuration *int64
	HwidLimit      int64
	GroupIDs       []int64
	OnlineAt       *time.Time
	Token          string
	Note           string
}

// Panel is the fake. Its fields may be changed by tests between requests,
// holding Mu.
type Panel struct {
	Mu       sync.Mutex
	Server   *httptest.Server
	Users    map[string]*User
	Groups   []Group
	Inbounds []Inbound
	Hosts    []Host
	// Reseller makes the full group list forbidden (PasarGuard's operator role).
	Reseller bool
	// Limited refuses users without a volume and an expiry.
	Limited bool
	// Down answers every API call with 503.
	Down bool
	// XrayOff switches the "xray" subscription format off, as an admin may.
	XrayOff bool
	// SubDown answers every subscription link with 502, as a panel behind
	// a proxy that lost it does.
	SubDown bool
	// LinksOff switches the "links" and "links_base64" formats asked for by
	// name off, as an admin may.
	LinksOff bool
	// Decoy shows browsers (a Mozilla user agent) an HTML page in place of
	// the subscription, as a proxy in front of a panel may.
	Decoy bool
	// CustomJSON gives Xray apps (v2rayNG, v2rayN, Streisand, Happ…) the
	// "xray" format on the link itself, as PasarGuard does when its admin
	// switches on custom JSON for them; otherwise they get base64 links.
	CustomJSON bool
	// HeaderLines writes the headers into the body of a list of links too,
	// as PasarGuard's "header placement" may.
	HeaderLines bool
	// SubRequests holds the last request for each subscription link, by token.
	SubRequests map[string]*http.Request
	// Calls counts requests by "METHOD path" (without the query).
	Calls map[string]int
	// PageSize caps how many users one list request gives.
	PageSize int
	nextID   int64
}

// New starts a fake panel with one group (2, "de") granting a vless and a
// vmess inbound, and one host on each.
func New() *Panel {
	p := &Panel{
		Users: map[string]*User{},
		Groups: []Group{
			{ID: 2, Name: "de", Inbounds: []string{"vless-ws", "vmess-tcp"}},
			{ID: 7, Name: "nl", Inbounds: []string{"trojan-grpc"}},
		},
		Inbounds: []Inbound{
			{Tag: "vless-ws", Protocol: "vless", Network: "ws", Path: "/ws"},
			{Tag: "vmess-tcp", Protocol: "vmess", Network: "tcp"},
			{Tag: "trojan-grpc", Protocol: "trojan", Network: "grpc", Path: "tg"},
		},
		Hosts: []Host{
			{ID: 1, Remark: "🇩🇪 DE-1 {USERNAME}", Inbound: "vless-ws", Address: "de1.example.com", Port: 443, Priority: 1},
			{ID: 2, Remark: "🇩🇪 DE-2 [{PROTOCOL}]", Inbound: "vmess-tcp", Address: "de2.example.com", Port: 8080, Priority: 2},
			{ID: 3, Remark: "🇳🇱 NL {DATA_LEFT}", Inbound: "trojan-grpc", Address: "nl.example.com", Port: 2083, Priority: 3},
		},
		Calls:    map[string]int{},
		PageSize: 1000,
		nextID:   1,
	}
	p.Server = httptest.NewServer(http.HandlerFunc(p.serve))
	return p
}

// URL is the panel's address.
func (p *Panel) URL() string { return p.Server.URL }

// Close stops the server.
func (p *Panel) Close() { p.Server.Close() }

// Use moves a user's usage forward as if they had been online: an on-hold
// user starts, and one past their volume is limited.
func (p *Panel) Use(username string, bytes int64) {
	p.Mu.Lock()
	defer p.Mu.Unlock()
	user := p.Users[username]
	user.Used += bytes
	user.Lifetime += bytes
	// PasarGuard keeps seconds.
	now := time.Now().UTC().Truncate(time.Second)
	user.OnlineAt = &now
	if user.Status == "on_hold" {
		user.Status = "active"
		end := now.Add(time.Duration(*user.OnHoldDuration) * time.Second)
		user.Expire = &end
		user.OnHoldDuration = nil
	}
	if user.DataLimit > 0 && user.Used >= user.DataLimit {
		user.Status = "limited"
	}
}

// User returns a copy of a user, or nil.
func (p *Panel) User(username string) *User {
	p.Mu.Lock()
	defer p.Mu.Unlock()
	user, ok := p.Users[username]
	if !ok {
		return nil
	}
	copy := *user
	copy.GroupIDs = append([]int64(nil), user.GroupIDs...)
	return &copy
}

// CallCount returns how many times "METHOD path" was asked for.
func (p *Panel) CallCount(key string) int {
	p.Mu.Lock()
	defer p.Mu.Unlock()
	return p.Calls[key]
}

// -------------------------------------------------------------------- HTTP

var userPath = regexp.MustCompile(`^/api/user/by-username/([^/]+)(/disabled)?$`)
var subPath = regexp.MustCompile(`^/sub/([^/]+)/?(links|links_base64|xray|usage)?$`)

func (p *Panel) serve(w http.ResponseWriter, r *http.Request) {
	p.Mu.Lock()
	defer p.Mu.Unlock()
	p.Calls[r.Method+" "+r.URL.Path]++

	if match := subPath.FindStringSubmatch(r.URL.Path); match != nil {
		p.subscription(w, r, match[1], match[2])
		return
	}
	if p.Down {
		http.Error(w, "down", http.StatusServiceUnavailable)
		return
	}
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/admin/token":
		writeJSON(w, http.StatusOK, map[string]string{"access_token": "token"})
	case r.Method == http.MethodGet && r.URL.Path == "/api/groups":
		if p.Reseller {
			writeJSON(w, http.StatusForbidden, map[string]string{"detail": "Permission denied: groups.read"})
			return
		}
		groups := []map[string]any{}
		for _, group := range p.Groups {
			groups = append(groups, map[string]any{"id": group.ID, "name": group.Name, "inbound_tags": group.Inbounds})
		}
		writeJSON(w, http.StatusOK, map[string]any{"groups": groups, "total": len(groups)})
	case r.Method == http.MethodGet && r.URL.Path == "/api/groups/simple":
		groups := []map[string]any{}
		for _, group := range p.Groups {
			groups = append(groups, map[string]any{"id": group.ID, "name": group.Name})
		}
		writeJSON(w, http.StatusOK, map[string]any{"groups": groups, "total": len(groups)})
	case r.Method == http.MethodGet && r.URL.Path == "/api/users":
		p.listUsers(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/user":
		p.createUser(w, r)
	default:
		match := userPath.FindStringSubmatch(r.URL.Path)
		if match == nil {
			http.NotFound(w, r)
			return
		}
		username, _ := url.PathUnescape(match[1])
		user, ok := p.Users[username]
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"detail": "User not found"})
			return
		}
		switch {
		case r.Method == http.MethodGet:
			writeJSON(w, http.StatusOK, p.raw(user))
		case r.Method == http.MethodPut && match[2] == "/disabled":
			var body struct{ Disabled bool }
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.Disabled {
				user.Status = "disabled"
			} else {
				user.Status = "active"
			}
			writeJSON(w, http.StatusOK, p.raw(user))
		case r.Method == http.MethodPut:
			p.modifyUser(w, r, user)
		default:
			http.NotFound(w, r)
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (p *Panel) raw(user *User) map[string]any {
	var expire any
	if user.Expire != nil {
		// PasarGuard sends datetimes without a zone.
		expire = user.Expire.UTC().Format("2006-01-02T15:04:05")
	}
	var online any
	if user.OnlineAt != nil {
		online = user.OnlineAt.UTC().Format("2006-01-02T15:04:05")
	}
	return map[string]any{
		"id": user.ID, "username": user.Username, "status": user.Status,
		"data_limit": user.DataLimit, "used_traffic": user.Used, "lifetime_used_traffic": user.Lifetime,
		"expire": expire, "on_hold_expire_duration": user.OnHoldDuration, "hwid_limit": user.HwidLimit,
		"group_ids": user.GroupIDs, "online_at": online,
		// Relative, as when the panel has no subscription domain set.
		"subscription_url": "/sub/" + user.Token,
	}
}

func (p *Panel) listUsers(w http.ResponseWriter, r *http.Request) {
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > p.PageSize {
		limit = p.PageSize
	}
	names := make([]string, 0, len(p.Users))
	for name := range p.Users {
		names = append(names, name)
	}
	sort.Strings(names)
	page := []map[string]any{}
	for i := offset; i < len(names) && i < offset+limit; i++ {
		page = append(page, p.raw(p.Users[names[i]]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": page, "total": len(names)})
}

func (p *Panel) createUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username             string  `json:"username"`
		Status               string  `json:"status"`
		DataLimit            int64   `json:"data_limit"`
		Expire               *string `json:"expire"`
		OnHoldExpireDuration *int64  `json:"on_hold_expire_duration"`
		HwidLimit            *int64  `json:"hwid_limit"`
		GroupIDs             []int64 `json:"group_ids"`
		Note                 *string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"detail": err.Error()})
		return
	}
	if _, taken := p.Users[body.Username]; taken {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "User already exists"})
		return
	}
	if p.Limited && (body.DataLimit == 0 || (body.Status == "active" && body.Expire == nil)) {
		writeJSON(w, http.StatusForbidden, map[string]string{"detail": "Data limit and expiry are required for this admin"})
		return
	}
	user := &User{
		ID: p.nextID, Username: body.Username, Status: body.Status, DataLimit: body.DataLimit,
		OnHoldDuration: body.OnHoldExpireDuration, GroupIDs: body.GroupIDs,
		Token: fmt.Sprintf("tok%d%s", p.nextID, body.Username),
	}
	p.nextID++
	if body.HwidLimit != nil {
		user.HwidLimit = *body.HwidLimit
	}
	if body.Note != nil {
		user.Note = *body.Note
	}
	if body.Expire != nil {
		if at, err := time.Parse(time.RFC3339Nano, *body.Expire); err == nil {
			user.Expire = &at
		}
	}
	p.Users[user.Username] = user
	writeJSON(w, http.StatusOK, p.raw(user))
}

func (p *Panel) modifyUser(w http.ResponseWriter, r *http.Request, user *User) {
	var body map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"detail": err.Error()})
		return
	}
	if raw, ok := body["data_limit"]; ok {
		_ = json.Unmarshal(raw, &user.DataLimit)
	}
	if raw, ok := body["group_ids"]; ok {
		_ = json.Unmarshal(raw, &user.GroupIDs)
	}
	if raw, ok := body["expire"]; ok {
		var text string
		if json.Unmarshal(raw, &text) == nil {
			if at, err := time.Parse(time.RFC3339Nano, text); err == nil {
				user.Expire = &at
			}
		} else {
			user.Expire = nil
		}
	}
	if raw, ok := body["on_hold_expire_duration"]; ok {
		var seconds int64
		_ = json.Unmarshal(raw, &seconds)
		user.OnHoldDuration = &seconds
	}
	if raw, ok := body["status"]; ok {
		var status string
		_ = json.Unmarshal(raw, &status)
		// Given an expiry, a user on hold starts; "active" also brings back limited and expired ones.
		if status == "active" && (user.Status != "on_hold" || user.Expire != nil) {
			user.Status = "active"
			user.OnHoldDuration = nil
		}
	}
	if user.Status == "active" && user.DataLimit > 0 && user.Used >= user.DataLimit {
		user.Status = "limited"
	}
	writeJSON(w, http.StatusOK, p.raw(user))
}

// --------------------------------------------------------- subscriptions

type config struct {
	host    Host
	inbound Inbound
	remark  string
}

func (p *Panel) configsOf(user *User) []config {
	granted := map[string]bool{}
	for _, group := range p.Groups {
		for _, id := range user.GroupIDs {
			if id == group.ID {
				for _, tag := range group.Inbounds {
					granted[tag] = true
				}
			}
		}
	}
	hosts := append([]Host(nil), p.Hosts...)
	sort.SliceStable(hosts, func(i, j int) bool { return hosts[i].Priority < hosts[j].Priority })
	var out []config
	for _, host := range hosts {
		if !granted[host.Inbound] {
			continue
		}
		for _, inbound := range p.Inbounds {
			if inbound.Tag == host.Inbound {
				out = append(out, config{host: host, inbound: inbound, remark: remarkOf(host.Remark, user, inbound)})
			}
		}
	}
	return out
}

func remarkOf(template string, user *User, inbound Inbound) string {
	left := "∞"
	if user.DataLimit > 0 {
		left = fmt.Sprintf("%dB", max(0, user.DataLimit-user.Used))
	}
	return strings.NewReplacer(
		"{USERNAME}", user.Username,
		"{PROTOCOL}", inbound.Protocol,
		"{TRANSPORT}", inbound.Network,
		"{DATA_LEFT}", left,
	).Replace(template)
}

// Link is one config as a link, as PasarGuard writes it.
func link(c config, secret string) string {
	fragment := url.PathEscape(c.remark)
	switch c.inbound.Protocol {
	case "vmess":
		body, _ := json.Marshal(map[string]any{"add": c.host.Address, "id": secret, "net": c.inbound.Network, "port": c.host.Port, "ps": c.remark, "path": c.inbound.Path, "v": "2"})
		return "vmess://" + base64.StdEncoding.EncodeToString(body)
	default:
		query := url.Values{"type": {c.inbound.Network}, "security": {"none"}}
		if c.inbound.Network == "grpc" {
			query.Set("serviceName", c.inbound.Path)
		} else if c.inbound.Path != "" {
			query.Set("path", c.inbound.Path)
		}
		return fmt.Sprintf("%s://%s@%s:%d?%s#%s", c.inbound.Protocol, secret, c.host.Address, c.host.Port, query.Encode(), fragment)
	}
}

var xrayApps = regexp.MustCompile(`^([Vv]2ray[Nn][Gg]|[Vv]2ray[Nn]|[Ss]treisand|[Hh]app|[Kk]tor-client)`)

var singBoxApps = regexp.MustCompile(`^(SFA|SFI|SFM|SFT|[Kk]aring|[Hh]iddify[Nn]ext)|.*[Ss]ing[-b]?ox.*`)
var clashApps = regexp.MustCompile(`^([Cc]lash|[Ss]tash|FlClash|mihomo)`)

func (p *Panel) subscription(w http.ResponseWriter, r *http.Request, token, format string) {
	if p.SubDown {
		http.Error(w, "Bad Gateway", http.StatusBadGateway)
		return
	}
	if r.Method != http.MethodGet && !(r.Method == http.MethodHead && format == "") {
		// PasarGuard answers HEAD on the link itself only.
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	if p.SubRequests == nil {
		p.SubRequests = map[string]*http.Request{}
	}
	p.SubRequests[token] = r.Clone(r.Context())
	var user *User
	for _, candidate := range p.Users {
		if candidate.Token == token {
			user = candidate
		}
	}
	if user == nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	configs := p.configsOf(user)
	secret := fmt.Sprintf("uuid-%d", user.ID)
	userAgent := r.Header.Get("user-agent")
	w.Header().Set("subscription-userinfo", fmt.Sprintf("upload=0; download=%d; total=%d; expire=0", user.Used, user.DataLimit))
	w.Header().Set("profile-web-page-url", p.URL()+"/sub/"+token)
	w.Header().Set("x-powered-by-panel", "pasarguard")
	if r.Method == http.MethodHead {
		return
	}
	if p.Decoy && strings.HasPrefix(userAgent, "Mozilla/") {
		w.Header().Set("content-type", "text/html")
		_, _ = w.Write([]byte("<!doctype html>\n<html lang=\"en\">\n<head><script>var a=1;</script></head>\n<body><div id=\"root\"></div></body>\n</html>"))
		return
	}
	if p.LinksOff && (format == "links" || format == "links_base64") {
		writeJSON(w, http.StatusNotAcceptable, map[string]string{"detail": "Client not supported"})
		return
	}
	if format == "usage" {
		writeJSON(w, http.StatusOK, map[string]any{"query": r.URL.RawQuery, "stats": []any{map[string]any{"at": "t", "used": user.Used}}})
		return
	}

	switch {
	case format == "xray" || (format == "" && p.CustomJSON && xrayApps.MatchString(userAgent)):
		if p.XrayOff {
			writeJSON(w, http.StatusNotAcceptable, map[string]string{"detail": "Client not supported"})
			return
		}
		out := []map[string]any{}
		for _, c := range configs {
			stream := map[string]any{"network": c.inbound.Network, "sockopt": map[string]any{"dialerProxy": "fragment"}}
			if c.inbound.Network == "ws" {
				stream["wsSettings"] = map[string]any{"path": c.inbound.Path}
			} else if c.inbound.Network == "grpc" {
				stream["grpcSettings"] = map[string]any{"serviceName": c.inbound.Path}
			}
			var settings map[string]any
			if c.inbound.Protocol == "trojan" {
				settings = map[string]any{"servers": []any{map[string]any{"address": c.host.Address, "port": c.host.Port, "password": secret}}}
			} else {
				settings = map[string]any{"vnext": []any{map[string]any{"address": c.host.Address, "port": c.host.Port, "users": []any{map[string]any{"id": secret}}}}}
			}
			out = append(out, map[string]any{
				"remarks": c.remark,
				"outbounds": []any{
					map[string]any{"protocol": c.inbound.Protocol, "settings": settings, "streamSettings": stream, "tag": "proxy"},
					map[string]any{"protocol": "freedom", "tag": "fragment", "settings": map[string]any{"fragment": map[string]any{"packets": "tlshello"}}},
				},
			})
		}
		writeJSON(w, http.StatusOK, out)
	case format == "" && singBoxApps.MatchString(userAgent):
		var tags []string
		outbounds := []map[string]any{}
		for _, c := range configs {
			tags = append(tags, c.remark)
			outbound := map[string]any{"type": c.inbound.Protocol, "tag": c.remark, "server": c.host.Address, "server_port": c.host.Port, "uuid": secret}
			if c.inbound.Network != "tcp" {
				transport := map[string]any{"type": c.inbound.Network}
				if c.inbound.Network == "grpc" {
					transport["service_name"] = c.inbound.Path
				} else {
					transport["path"] = c.inbound.Path
				}
				outbound["transport"] = transport
			}
			outbounds = append(outbounds, outbound)
		}
		all := append([]map[string]any{
			{"type": "selector", "tag": "Select", "outbounds": append([]string{"Auto"}, tags...)},
			{"type": "urltest", "tag": "Auto", "outbounds": tags},
		}, outbounds...)
		all = append(all, map[string]any{"type": "direct", "tag": "direct"})
		writeJSON(w, http.StatusOK, map[string]any{"log": map[string]string{"level": "warn"}, "outbounds": all})
	case format == "" && clashApps.MatchString(userAgent):
		var out strings.Builder
		out.WriteString("mixed-port: 7890\nproxies:\n")
		var names []string
		for _, c := range configs {
			names = append(names, c.remark)
			fmt.Fprintf(&out, "  - name: %q\n    type: %s\n    server: %s\n    port: %d\n    uuid: %s\n    network: %s\n", c.remark, c.inbound.Protocol, c.host.Address, c.host.Port, secret, c.inbound.Network)
			if c.inbound.Network == "ws" {
				fmt.Fprintf(&out, "    ws-opts:\n      path: %s\n", c.inbound.Path)
			}
		}
		out.WriteString("proxy-groups:\n  - name: Select\n    type: select\n    proxies:\n      - Auto\n")
		for _, name := range names {
			fmt.Fprintf(&out, "      - %q\n", name)
		}
		out.WriteString("  - name: Auto\n    type: url-test\n    proxies:\n")
		for _, name := range names {
			fmt.Fprintf(&out, "      - %q\n", name)
		}
		out.WriteString("rules:\n  - MATCH,Select\n")
		w.Header().Set("content-type", "text/yaml")
		_, _ = w.Write([]byte(out.String()))
	default:
		var lines []string
		for _, c := range configs {
			lines = append(lines, link(c, secret))
		}
		w.Header().Set("content-type", "text/plain; charset=utf-8")
		if p.HeaderLines {
			lines = append([]string{
				"#profile-title: base64:" + base64.StdEncoding.EncodeToString([]byte("Fake")),
				"#" + "subscription-userinfo: " + w.Header().Get("subscription-userinfo"),
				"#profile-web-page-url: " + w.Header().Get("profile-web-page-url"),
			}, lines...)
		}
		text := strings.Join(lines, "\n")
		if format == "links" {
			_, _ = w.Write([]byte(text))
			return
		}
		_, _ = w.Write([]byte(base64.StdEncoding.EncodeToString([]byte(text))))
	}
}
