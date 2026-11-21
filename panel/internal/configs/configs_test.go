package configs

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

const gb = int64(1 << 30)

func ptr[T any](v T) *T { return &v }

var now = time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)

var totals = Totals{Username: "sk_abc", Status: "active", UsedBytes: 10 * gb, DataLimitBytes: ptr(50 * gb), ExpiresAt: ptr(time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC))}

// ------------------------------------------------- the same as the Node app

// TestHostIDsAreTheNodeAppsOwn: the staff pages (Node) save picks and names
// under these ids, and the link (here) must find them.
func TestHostIDsAreTheNodeAppsOwn(t *testing.T) {
	vmess := "vmess://" + base64.StdEncoding.EncodeToString([]byte(`{"add":"x","ps":"VM","port":"8080","net":"tcp"}`))
	hosts := ProbeHosts(strings.Join([]string{
		"vless://u@a.example.com:443?type=ws&path=%2Fws#DE-1",
		"vless://u@b.example.com:443?type=ws&path=%2Fws%3Fed%3D2048#DE-1",
		"trojan://p@n.example.com:2083?type=grpc&serviceName=tg#%F0%9F%87%B3%F0%9F%87%B1%20NL%20%E2%88%9E",
		vmess,
		"ss://YWVzLTI1Ni1nY206cA@s.example.com:8388#SS",
	}, "\n"))
	// As back-end/src/modules/subscriptions/configs.ts gives them.
	want := []string{"6K3FdTiXmihf", "6K3FdTiXmihf-2", "yWK4Ru09aMKj", "FqnAjBweQ0Nb", "iQLNP3-x739d"}
	if len(hosts) != len(want) {
		t.Fatalf("read %d hosts", len(hosts))
	}
	for i, host := range hosts {
		if host.ID != want[i] {
			t.Errorf("host %d (%s): id %s; Node's is %s", i, host.Name, host.ID, want[i])
		}
	}
	if *hosts[2].Path != "tg" || *hosts[1].Path != "/ws" || hosts[3].Network != nil || *hosts[4].Protocol != "shadowsocks" {
		t.Fatalf("fingerprints %+v", hosts)
	}
}

func TestVariablesAreTheNodeAppsOwn(t *testing.T) {
	got := RenderName("{USERNAME}|{DATA_USAGE}|{DATA_LIMIT}|{DATA_LEFT}|{USAGE_PERCENTAGE}|{DAYS_LEFT}|{TIME_LEFT}|{EXPIRE_DATE}|{JALALI_EXPIRE_DATE}|{STATUS_EMOJI}|{NOPE}",
		totals, Fingerprint{Protocol: ptr("vless"), Network: ptr("ws"), Server: ptr("1.2.3.4")}, time.Date(2026, 12, 1, 5, 30, 0, 0, time.UTC))
	if want := "sk_abc|10 GB|50 GB|40 GB|20|29|29d 18h|2026-12-31|1405/10/10|✅|{NOPE}"; got != want {
		t.Fatalf("got  %s\nwant %s", got, want)
	}
}

func TestPersianDates(t *testing.T) {
	tests := map[string]string{
		"2026-03-20T22:00:00Z": "1405/01/01", // Nowruz, already in Tehran
		"2026-03-21T12:00:00Z": "1405/01/01",
		"2025-03-20T12:00:00Z": "1403/12/30", // a leap year's last day
		"2024-12-31T12:00:00Z": "1403/10/11",
		"2027-09-22T12:00:00Z": "1406/06/31",
	}
	for at, want := range tests {
		expires, _ := time.Parse(time.RFC3339, at)
		got := RenderName("{JALALI_EXPIRE_DATE}", Totals{ExpiresAt: &expires}, Fingerprint{}, now)
		if got != want {
			t.Errorf("%s: %s; want %s", at, got, want)
		}
	}
}

func TestUnlimitedAndOnHold(t *testing.T) {
	waiting := Totals{Status: "on_hold", OnHoldDurationSeconds: ptr(int64(7 * 86400))}
	if got := RenderName("{DATA_LEFT} {DATA_LIMIT} {DAYS_LEFT} {EXPIRE_DATE} {STATUS_EMOJI}", waiting, Fingerprint{}, now); got != "∞ ∞ 7 ∞ 🔌" {
		t.Fatalf("got %q", got)
	}
}

func TestReadableSize(t *testing.T) {
	for bytes, want := range map[int64]string{0: "0 B", 1536: "1.5 KB", gb + gb/4: "1.25 GB", -5: "0 B"} {
		if got := ReadableSize(bytes); got != want {
			t.Errorf("%d: %s; want %s", bytes, got, want)
		}
	}
}

// ----------------------------------------------------------------- matching

func fp(name string, change func(*Fingerprint)) Fingerprint {
	f := Fingerprint{Name: name, Protocol: ptr("vless"), Server: ptr("a.example.com"), Port: ptr(int64(443)), Network: ptr("ws"), Path: ptr("/ws")}
	if change != nil {
		change(&f)
	}
	return f
}

func probe(lines ...string) []Host { return ProbeHosts(strings.Join(lines, "\n")) }

func l(name string) string {
	return "vless://id@a.example.com:443?type=ws&path=%2Fws#" + url.PathEscape(name)
}

func names(hosts []*Host) []string {
	var out []string
	for _, h := range hosts {
		if h == nil {
			out = append(out, "<none>")
		} else {
			out = append(out, h.Name)
		}
	}
	return out
}

func TestMatching(t *testing.T) {
	t.Run("names with the customer's own values still find their host", func(t *testing.T) {
		hosts := probe(l("DE skprobe_g2 [∞ left]"), strings.Replace(l("NL skprobe_g2 [∞ left]"), "vless", "trojan", 1))
		got := MatchHosts([]Fingerprint{fp("NL sk_abc [40 GB left]", func(f *Fingerprint) { f.Protocol = ptr("trojan") }), fp("DE sk_abc [40 GB left]", nil)}, hosts, []string{"sk_abc", "skprobe_g2"})
		if strings.Join(names(got), ",") != "NL skprobe_g2 [∞ left],DE skprobe_g2 [∞ left]" {
			t.Fatalf("got %v", names(got))
		}
	})
	t.Run("hosts differing only by name go by name", func(t *testing.T) {
		got := MatchHosts([]Fingerprint{fp("Turkey", nil), fp("Germany 2", nil), fp("Germany 1", nil)}, probe(l("Germany 1"), l("Germany 2"), l("Turkey")), nil)
		if strings.Join(names(got), ",") != "Turkey,Germany 2,Germany 1" {
			t.Fatalf("got %v", names(got))
		}
	})
	t.Run("twins go by address", func(t *testing.T) {
		hosts := probe(strings.Replace(l("Iran"), "a.example", "x.example", 1), strings.Replace(l("Iran"), "a.example", "y.example", 1))
		got := MatchHosts([]Fingerprint{fp("Iran", func(f *Fingerprint) { f.Server = ptr("y.example.com") }), fp("Iran", func(f *Fingerprint) { f.Server = ptr("x.example.com") })}, hosts, nil)
		if *got[0].Server != "y.example.com" || *got[1].Server != "x.example.com" {
			t.Fatalf("got %v %v", *got[0].Server, *got[1].Server)
		}
	})
	t.Run("another port or transport is not that host", func(t *testing.T) {
		hosts := probe(l("DE"))
		if got := MatchHosts([]Fingerprint{fp("DE", func(f *Fingerprint) { f.Port = ptr(int64(8443)) }), fp("DE", func(f *Fingerprint) { f.Network = ptr("grpc") })}, hosts, nil); got[0] != nil || got[1] != nil {
			t.Fatalf("got %v", names(got))
		}
	})
	t.Run("a config like no host takes nobody's place", func(t *testing.T) {
		if got := MatchHosts([]Fingerprint{fp("Mystery", nil)}, probe(l("DE-1"), l("DE-2")), nil); got[0] != nil {
			t.Fatalf("got %v", names(got))
		}
	})
	t.Run("an address picked at random does not change a host's id", func(t *testing.T) {
		first := probe(strings.Replace(l("DE"), "a.example", "x.example", 1))
		again := probe(strings.Replace(l("DE"), "a.example", "y.example", 1))
		if first[0].ID != again[0].ID {
			t.Fatal("ids differ")
		}
	})
}

// ------------------------------------------------------------------ shaping

func plan(hosts []Host, wanted map[string]Wanted, keepUnknown bool) Plan {
	byID := map[string]Wanted{}
	for name, w := range wanted {
		for _, h := range hosts {
			if h.Name == name {
				byID[h.ID] = w
			}
		}
	}
	return Plan{Hosts: hosts, Known: true, Wanted: byID, KeepUnknown: keepUnknown}
}

func b64(lines ...string) string {
	return base64.StdEncoding.EncodeToString([]byte(strings.Join(lines, "\n")))
}

func linkNames(t *testing.T, body string) []string {
	t.Helper()
	text := body
	if decoded, err := base64.StdEncoding.DecodeString(body); err == nil {
		text = string(decoded)
	}
	var out []string
	for _, line := range linesOf(text) {
		out = append(out, FingerprintOfLink(line).Name)
	}
	return out
}

var trojan = "trojan://id@a.example.com:443?type=ws&path=%2Fws#NL"
var deHosts = probe(l("DE-1"), l("DE-2"), trojan)

func TestShapingLinks(t *testing.T) {
	body := b64(l("DE-1"), l("DE-2"), trojan)

	got, format, ok := Shape([]string{body}, []Plan{plan(deHosts, map[string]Wanted{"NL": {Rank: 0}, "DE-1": {Rank: 1, Name: "Germany {DATA_LEFT}"}}, false)}, totals, now, nil)
	if !ok || format != Links {
		t.Fatal("not shaped")
	}
	if strings.Join(linkNames(t, got), ",") != "NL,Germany 40 GB" {
		t.Fatalf("got %v", linkNames(t, got))
	}
	if _, err := base64.StdEncoding.DecodeString(got); err != nil {
		t.Fatal("a base64 answer stays base64")
	}

	plain, _, _ := Shape([]string{l("DE-1") + "\n" + l("DE-2")}, []Plan{plan(deHosts, map[string]Wanted{"DE-2": {}}, false)}, totals, now, nil)
	if plain != l("DE-2") {
		t.Fatalf("a plain answer stays plain, got %q", plain)
	}
}

func TestRenamingVmess(t *testing.T) {
	vmess := "vmess://" + base64.StdEncoding.EncodeToString([]byte(`{"add":"x","ps":"VM","port":1,"net":"tcp","id":"u"}`))
	got, _, _ := Shape([]string{vmess}, []Plan{plan(probe(vmess), map[string]Wanted{"VM": {Name: "Renamed"}}, false)}, totals, now, nil)
	if name := FingerprintOfLink(got).Name; name != "Renamed" {
		t.Fatalf("name %q", name)
	}
	if body := vmessJSON(got); body["id"] != "u" {
		t.Fatalf("the rest of the config is kept: %v", body)
	}
}

func TestUnknownConfigs(t *testing.T) {
	body := b64(l("DE-1"), l("Mystery"))
	strict, _, _ := Shape([]string{body}, []Plan{plan(deHosts, map[string]Wanted{"DE-1": {}}, false)}, totals, now, nil)
	every, _, _ := Shape([]string{body}, []Plan{plan(deHosts, map[string]Wanted{"DE-1": {}}, true)}, totals, now, nil)
	if strings.Join(linkNames(t, strict), ",") != "DE-1" || strings.Join(linkNames(t, every), ",") != "DE-1,Mystery" {
		t.Fatalf("got %v and %v", linkNames(t, strict), linkNames(t, every))
	}
}

func TestPanelsTogether(t *testing.T) {
	unreadable := Plan{}
	got, _, _ := Shape([]string{b64(l("Far")), b64(l("DE-1"), l("DE-2"))}, []Plan{unreadable, plan(deHosts, map[string]Wanted{"DE-2": {}}, false)}, totals, now, nil)
	if strings.Join(linkNames(t, got), ",") != "DE-2,Far" {
		t.Fatalf("a panel that cannot be read gives its configs as they are, after the others: %v", linkNames(t, got))
	}
	ordered, _, _ := Shape([]string{b64(l("DE-1")), b64(trojan)}, []Plan{plan(deHosts, map[string]Wanted{"DE-1": {Rank: 1}}, false), plan(deHosts, map[string]Wanted{"NL": {Rank: 0}}, false)}, totals, now, nil)
	if strings.Join(linkNames(t, ordered), ",") != "NL,DE-1" {
		t.Fatalf("two panels are one list in the groups' order: %v", linkNames(t, ordered))
	}
	if _, _, ok := Shape([]string{"<html>"}, []Plan{{}}, totals, now, nil); ok {
		t.Fatal("an unreadable answer is not shaped")
	}
	if _, _, ok := Shape([]string{b64(l("A")), `{"outbounds":[]}`}, []Plan{{}, {}}, totals, now, nil); ok {
		t.Fatal("answers in two formats are not shaped")
	}
}

func TestShapingXrayJSON(t *testing.T) {
	xray := `[{"remarks":"DE-1","outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"a.example.com","port":443}]},"streamSettings":{"network":"ws","wsSettings":{"path":"/ws"}}}],"routing":{"rules":[]}},
	{"remarks":"NL","outbounds":[{"protocol":"trojan","settings":{"servers":[{"address":"a.example.com","port":443}]},"streamSettings":{"network":"ws","wsSettings":{"path":"/ws?ed=2048"},"sockopt":{"dialerProxy":"fragment"}}}]}]`
	got, format, ok := Shape([]string{xray}, []Plan{plan(deHosts, map[string]Wanted{"NL": {Name: "Holland"}}, false)}, totals, now, nil)
	if !ok || format != XrayJSON {
		t.Fatal("not shaped")
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(got), &configs); err != nil {
		t.Fatal(err)
	}
	if len(configs) != 1 || configs[0]["remarks"] != "Holland" {
		t.Fatalf("got %v", configs)
	}
	if !strings.Contains(got, `"dialerProxy": "fragment"`) {
		t.Fatal("the rest of an Xray config (fragment, mux…) is kept")
	}
}

func TestShapingSingBox(t *testing.T) {
	profile := `{"log":{"level":"warn"},"outbounds":[
		{"type":"selector","tag":"Select","outbounds":["Auto","DE-1","DE-2"],"default":"DE-1"},
		{"type":"urltest","tag":"Auto","outbounds":["DE-1","DE-2"]},
		{"type":"vless","tag":"DE-1","server":"a.example.com","server_port":443,"transport":{"type":"ws","path":"/ws"}},
		{"type":"vless","tag":"DE-2","server":"a.example.com","server_port":443,"transport":{"type":"ws","path":"/ws"}},
		{"type":"direct","tag":"direct"}]}`
	got, _, ok := Shape([]string{profile}, []Plan{plan(deHosts, map[string]Wanted{"DE-1": {Rank: 0, Name: "Germany"}, "DE-2": {Rank: 1, Name: "Germany"}}, false)}, totals, now, nil)
	if !ok {
		t.Fatal("not shaped")
	}
	var out struct {
		Outbounds []struct {
			Tag       string   `json:"tag"`
			Outbounds []string `json:"outbounds"`
			Default   *string  `json:"default"`
		} `json:"outbounds"`
	}
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatal(err)
	}
	var tags []string
	for _, o := range out.Outbounds {
		tags = append(tags, o.Tag)
	}
	if strings.Join(tags, ",") != "Select,Auto,Germany,Germany 2,direct" {
		t.Fatalf("tags %v", tags)
	}
	if strings.Join(out.Outbounds[0].Outbounds, ",") != "Auto,Germany,Germany 2" || out.Outbounds[0].Default != nil {
		t.Fatalf("selector %+v", out.Outbounds[0])
	}
}

func TestShapingClash(t *testing.T) {
	clash := `mixed-port: 7890
proxies:
  - name: "DE-1"
    type: vless
    server: a.example.com
    port: 443
    network: ws
    ws-opts: {path: /ws}
  - name: "NL"
    type: trojan
    server: a.example.com
    port: 443
    network: ws
    ws-opts: {path: /ws}
proxy-groups:
  - name: Select
    type: select
    proxies: [DE-1, NL, DIRECT]
rules:
  - MATCH,Select
`
	got, _, ok := Shape([]string{clash}, []Plan{plan(deHosts, map[string]Wanted{"NL": {}}, false)}, totals, now, nil)
	if !ok {
		t.Fatal("not shaped")
	}
	var out struct {
		Port    int `yaml:"mixed-port"`
		Proxies []struct {
			Name string `yaml:"name"`
		} `yaml:"proxies"`
		Groups []struct {
			Proxies []string `yaml:"proxies"`
		} `yaml:"proxy-groups"`
		Rules []string `yaml:"rules"`
	}
	if err := yaml.Unmarshal([]byte(got), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Proxies) != 1 || out.Proxies[0].Name != "NL" || strings.Join(out.Groups[0].Proxies, ",") != "NL,DIRECT" {
		t.Fatalf("got %+v", out)
	}
	if out.Port != 7890 || out.Rules[0] != "MATCH,Select" {
		t.Fatal("the rest of the profile is kept, in order")
	}
}

func TestEncodeURIComponent(t *testing.T) {
	if got := encodeURIComponent("🇩🇪 DE (1)! a+b~c*'"); got != "%F0%9F%87%A9%F0%9F%87%AA%20DE%20(1)!%20a%2Bb~c*'" {
		t.Fatalf("got %s", got)
	}
}
