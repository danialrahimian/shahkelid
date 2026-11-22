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
// under these ids, and the link (here) must find them. The same values are
// pinned in back-end/test/configs.test.ts.
func TestHostIDsAreTheNodeAppsOwn(t *testing.T) {
	vmess := "vmess://" + base64.StdEncoding.EncodeToString([]byte(`{"add":"x","ps":"VM","port":"8080","net":"tcp"}`))
	hosts := ProbeHosts(strings.Join([]string{
		"vless://u@a.example.com:443?type=ws&path=%2Fws#DE-1",
		"vless://u@b.example.com:8443?type=ws&path=%2Fws%3Fed%3D2048#DE-1",
		"trojan://p@n.example.com:2083?type=grpc&serviceName=tg#%F0%9F%87%B3%F0%9F%87%B1%20NL%20%E2%88%9E",
		vmess,
		"ss://YWVzLTI1Ni1nY206cA@s.example.com:8388#SS",
		"hysteria2://p@h.example.com:443#HY",
	}, "\n"))
	want := [][2]string{
		{"nQKKpF6UxsQg", "6K3FdTiXmihf"}, {"nQKKpF6UxsQg-2", "vAJjwJ3-3urX-2"}, {"v5CXst6CvdAs", "yWK4Ru09aMKj"},
		{"M4wnKhw10xUp", "FqnAjBweQ0Nb"}, {"TGNMA2wPincl", "iQLNP3-x739d"}, {"wZDR2vid1Avh", "qx9jYoW3P76I"},
	}
	if len(hosts) != len(want) {
		t.Fatalf("read %d hosts", len(hosts))
	}
	for i, host := range hosts {
		if host.ID != want[i][0] || host.LegacyID != want[i][1] {
			t.Errorf("host %d (%s): ids %s, %s; Node's are %s, %s", i, host.Name, host.ID, host.LegacyID, want[i][0], want[i][1])
		}
	}
}

// TestProbeFromXrayJSON: the shop reads its own subscription in PasarGuard's
// Xray format, which carries every host; the ids are those links give.
func TestProbeFromXrayJSON(t *testing.T) {
	xray := `[{"remarks":"DE-1","outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"a.example.com","port":443}]},"streamSettings":{"network":"ws","wsSettings":{"path":"/ws"}}}]},
	{"remarks":"XH","outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"x.example.com","port":443}]},"streamSettings":{"network":"xhttp","xhttpSettings":{"path":"/x"}}}]},
	{"remarks":"HY","outbounds":[{"protocol":"hysteria","settings":{"version":2,"address":"h.example.com","port":443}}]}]`
	hosts := ProbeHosts(xray)
	got := []string{}
	for _, h := range hosts {
		got = append(got, h.ID+" "+h.Name+" "+deref(h.Network))
	}
	if strings.Join(got, ",") != "nQKKpF6UxsQg DE-1 ws,VGCBsn4-Oq0r XH xhttp,wZDR2vid1Avh HY " {
		t.Fatalf("got %v", got)
	}
}

// TestVariablesArePasarGuards: as PasarGuard's setup_format_variables writes
// them; the expected values were made by running its own functions.
func TestVariablesArePasarGuards(t *testing.T) {
	now := time.Date(2026, 12, 1, 5, 30, 0, 0, time.UTC)
	at := func(y int, m time.Month, d, h, min int) *time.Time {
		v := time.Date(y, m, d, h, min, 0, 0, time.UTC)
		return &v
	}
	tests := []struct {
		totals Totals
		want   string
	}{
		{Totals{Status: "active", UsedBytes: 10 * gb, DataLimitBytes: ptr(50 * gb), ExpiresAt: at(2026, 12, 31, 0, 0)}, "10.0 GB|50.0 GB|40.0 GB|20.0|30|29d|2026-12-31|1405-10-10"},
		{Totals{Status: "active", UsedBytes: 0, DataLimitBytes: ptr(50 * gb), ExpiresAt: at(2026, 12, 1, 5, 45)}, "0 B|50.0 GB|50.0 GB|0.0|1|15m|2026-12-01|1405-09-10"},
		{Totals{Status: "active", UsedBytes: 1536, DataLimitBytes: ptr(3*gb + gb/3), ExpiresAt: at(2027, 3, 20, 23, 0)}, "1.5 KB|3.33 GB|3.33 GB|0.0|110|3m 19d|2027-03-20|1405-12-29"},
		{Totals{Status: "expired", UsedBytes: 7 * gb, DataLimitBytes: ptr(5 * gb), ExpiresAt: at(2026, 11, 30, 0, 0)}, "7.0 GB|5.0 GB|0 B|140.0|0|0|2026-11-30|1405-09-09"},
		{Totals{Status: "on_hold", DataLimitBytes: ptr(20 * gb), OnHoldDurationSeconds: ptr(int64(45*86400 + 3600))}, "0 B|20.0 GB|20.0 GB|0.0|45|1m 15d|-|-"},
		{Totals{Status: "on_hold"}, "0 B|∞|∞|∞|∞|∞|∞|∞"},
		{Totals{Status: "active", UsedBytes: 123456789}, "117.74 MB|∞|∞|∞|∞|∞|∞|∞"},
		{Totals{Status: "active", UsedBytes: 1, DataLimitBytes: ptr(int64(1) << 40), ExpiresAt: at(2026, 12, 3, 6, 0)}, "1.0 B|1.0 TB|1024.0 GB|0.0|3|2d|2026-12-03|1405-09-12"},
	}
	for i, test := range tests {
		got := RenderName("{DATA_USAGE}|{DATA_LIMIT}|{DATA_LEFT}|{USAGE_PERCENTAGE}|{DAYS_LEFT}|{TIME_LEFT}|{EXPIRE_DATE}|{JALALI_EXPIRE_DATE}", test.totals, Fingerprint{}, now)
		if got != test.want {
			t.Errorf("case %d:\n got  %s\n want %s", i, got, test.want)
		}
	}
	if got := RenderName("{USERNAME} {STATUS_EMOJI} {PROTOCOL}/{TRANSPORT} {NOPE}", Totals{Username: "sk_a", Status: "limited"}, Fingerprint{Protocol: ptr("vless")}, now); got != "sk_a 🪫 vless/tcp {NOPE}" {
		t.Fatalf("got %q", got)
	}
}

func TestReadableSizeIsPasarGuards(t *testing.T) {
	for bytes, want := range map[int64]string{0: "0 B", 1: "1.0 B", 1023: "1023.0 B", 1024: "1.0 KB", 1536: "1.5 KB", gb: "1.0 GB", 50 * gb: "50.0 GB", 1 << 40: "1.0 TB", 999999999999: "931.32 GB", -5: "0 B"} {
		if got := ReadableSize(bytes); got != want {
			t.Errorf("%d: %s; want %s", bytes, got, want)
		}
	}
}

func TestPersianDates(t *testing.T) {
	tests := map[string]string{
		"2026-03-21T12:00:00Z": "1405-01-01", // Nowruz
		"2026-03-20T22:00:00Z": "1404-12-29", // PasarGuard takes the date in UTC
		"2025-03-20T12:00:00Z": "1403-12-30", // a leap year's last day
		"2024-12-31T12:00:00Z": "1403-10-11",
		"2027-09-22T12:00:00Z": "1406-06-31",
	}
	for at, want := range tests {
		expires, _ := time.Parse(time.RFC3339, at)
		got := RenderName("{JALALI_EXPIRE_DATE}", Totals{ExpiresAt: &expires}, Fingerprint{}, time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC))
		if got != want {
			t.Errorf("%s: %s; want %s", at, got, want)
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
	t.Run("a port picked at random is the same host; another transport is not", func(t *testing.T) {
		hosts := probe(l("DE"))
		if got := MatchHosts([]Fingerprint{fp("DE", func(f *Fingerprint) { f.Port = ptr(int64(8443)) })}, hosts, nil); got[0] == nil {
			t.Fatal("another port of the same host")
		}
		if got := MatchHosts([]Fingerprint{fp("DE", func(f *Fingerprint) { f.Network = ptr("grpc") })}, hosts, nil); got[0] != nil {
			t.Fatalf("got %v", names(got))
		}
	})
	t.Run("names made of variables are told apart by their fixed part", func(t *testing.T) {
		hosts := probe(l("🇳🇱 NL ∞ | ∞ days"), l("🇩🇪 DE ∞ | ∞ days"))
		got := MatchHosts([]Fingerprint{fp("🇩🇪 DE 40.0 GB | 29 days", nil), fp("🇳🇱 NL 40.0 GB | 29 days", nil), fp("🇹🇷 TR 40.0 GB", nil)}, hosts, nil)
		if got[0] == nil || got[0].Name != "🇩🇪 DE ∞ | ∞ days" || got[1] == nil || got[1].Name != "🇳🇱 NL ∞ | ∞ days" || got[2] != nil {
			t.Fatalf("got %v", names(got))
		}
	})
	t.Run("a config like no host takes nobody's place", func(t *testing.T) {
		if got := MatchHosts([]Fingerprint{fp("Mystery", nil)}, probe(l("DE-1"), l("DE-2")), nil); got[0] != nil {
			t.Fatalf("got %v", names(got))
		}
	})
	t.Run("an address or port picked at random does not change a host's id", func(t *testing.T) {
		first := probe(strings.Replace(l("DE"), "a.example", "x.example", 1))
		again := probe(strings.Replace(strings.Replace(l("DE"), "a.example", "y.example", 1), ":443", ":8443", 1))
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
	if strings.Join(linkNames(t, got), ",") != "NL,Germany 40.0 GB" {
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
