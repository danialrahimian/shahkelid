package configs

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// TestRekeyIsTheNodeAppsOwn: settings saved for a host the panel renamed go
// to the same host again. Node re-keys on the staff pages and must agree;
// the same cases are in back-end/test/configs.test.ts.
func TestRekeyIsTheNodeAppsOwn(t *testing.T) {
	hosts := ProbeHosts(strings.Join([]string{
		"vless://u@a.example.com:443?type=ws&path=%2Fws#Germany 1",
		"vless://u@b.example.com:443?type=ws&path=%2Fws#Turkey",
		"trojan://p@a.example.com:443?type=ws&path=%2Fws#NL",
	}, "\n"))
	saved := func(id, name, server, protocol string) Saved {
		return Saved{HostID: id, Fingerprint: Fingerprint{Name: name, Server: ptr(server), Protocol: ptr(protocol), Network: ptr("ws"), Port: ptr(int64(443)), Path: ptr("/ws")}}
	}
	tests := []struct {
		name   string
		orphan Saved
		free   []Host
		want   string
	}{
		{"renamed, at the same address", saved("old-de", "DE-1", "a.example.com", "vless"), hosts, "uhHlaNq-U-ud"},
		{"two others alike: not guessed", saved("old-x", "Unrelated", "z.example.com", "vless"), hosts[:2], ""},
		{"the only host of its protocol and transport, at its address", saved("old-nl", "Holland", "a.example.com", "trojan"), hosts, "ookVR1Escfj5"},
		{"nothing but its protocol agrees", saved("old-nl", "Holland", "q.example.com", "trojan"), hosts, ""},
		{"saved before fingerprints were kept", Saved{HostID: "old-nofp"}, hosts, ""},
	}
	for _, test := range tests {
		got := Rekey([]Saved{test.orphan}, test.free)[test.orphan.HostID]
		if got != test.want {
			t.Errorf("%s: %q; want %q", test.name, got, test.want)
		}
	}
	if hosts[0].ID != "uhHlaNq-U-ud" || hosts[2].ID != "ookVR1Escfj5" {
		t.Fatalf("ids %s %s", hosts[0].ID, hosts[2].ID)
	}
	two := Rekey([]Saved{saved("a", "DE-1", "a.example.com", "vless"), saved("b", "DE-2", "a.example.com", "vless")}, hosts[:1])
	if len(two) != 1 {
		t.Fatalf("one host goes to one setting only: %v", two)
	}
}

// TestSettleIsTheNodeAppsOwn: the same cases as back-end/test/configs.test.ts.
func TestSettleIsTheNodeAppsOwn(t *testing.T) {
	hosts := ProbeHosts(strings.Join([]string{
		"vless://u@de1.example.com:443?type=ws&path=%2Fws#DE-1",
		"vless://u@de2.example.com:443?type=ws&path=%2Fws#DE-2",
		"trojan://p@nl.example.com:443?type=ws&path=%2Fws#NL",
	}, "\n"))
	row := func(host Host) Saved { return Saved{HostID: host.ID, Fingerprint: host.Fingerprint} }
	all := []Saved{row(hosts[0]), row(hosts[1]), row(hosts[2])}

	first := Settle([]Saved{row(hosts[0])}, hosts)
	if len(first.Moves) != 0 || len(first.Fresh) != 2 || first.Fresh[0].Name != "DE-2" || len(first.Fill) != 0 {
		t.Fatalf("records what it has not seen: %+v", first)
	}
	if !Settle(all, hosts).Settled() {
		t.Fatal("nothing changed, nothing to do")
	}
	if gone := Settle(all, []Host{hosts[0], hosts[2]}); !gone.Settled() {
		t.Fatalf("a host deleted on the panel leaves its siblings alone: %+v", gone)
	}
	renamed := ProbeHosts("vless://u@de2.example.com:443?type=ws&path=%2Fws#DE-2 Fast")[0]
	moved := Settle(all, []Host{hosts[0], renamed, hosts[2]})
	if len(moved.Moves) != 1 || moved.Moves[hosts[1].ID] != renamed.ID || len(moved.Fresh) != 0 {
		t.Fatalf("a renamed host takes its settings along: %+v", moved)
	}
	legacy := Settle([]Saved{{HostID: hosts[2].LegacyID}}, hosts)
	if legacy.Moves[hosts[2].LegacyID] != hosts[2].ID || len(legacy.Fresh) != 2 {
		t.Fatalf("an old id is moved: %+v", legacy)
	}
	if fill := Settle([]Saved{{HostID: hosts[0].ID}}, hosts).Fill; len(fill) != 1 || fill[0] != hosts[0].ID {
		t.Fatalf("a row without a fingerprint gets its host's: %v", fill)
	}
}

// PasarGuard can write its headers into the body ("Header placement").
const headLines = "#profile-title: base64:U2hvcA==\n#subscription-userinfo: upload=0; download=1; total=2; expire=0\n#profile-web-page-url: https://panel.test/sub/x"

func TestHeaderLinesInTheBody(t *testing.T) {
	plain := headLines + "\n" + l("DE-1") + "\n" + l("DE-2") + "\n#announce: hi"
	got, format, ok := Shape([]string{plain}, []Plan{plan(deHosts, map[string]Wanted{"DE-2": {Name: "Fast"}}, false)}, totals, now, nil)
	if !ok || format != Links {
		t.Fatal("a list of links with header lines is still shaped")
	}
	lines := strings.Split(got, "\n")
	if len(lines) != 5 || lines[0] != "#profile-title: base64:U2hvcA==" || lines[4] != "#announce: hi" || FingerprintOfLink(lines[3]).Name != "Fast" {
		t.Fatalf("got %q", got)
	}

	encoded := base64.StdEncoding.EncodeToString([]byte(plain))
	got, _, ok = Shape([]string{encoded}, []Plan{plan(deHosts, map[string]Wanted{"DE-1": {}}, false)}, totals, now, nil)
	decoded, err := base64.StdEncoding.DecodeString(got)
	if !ok || err != nil || !strings.HasPrefix(string(decoded), "#profile-title") || strings.Count(string(decoded), "://") != 2 {
		t.Fatalf("base64 with header lines: %q", decoded)
	}

	set := SetHeaderLine(encoded, "subscription-userinfo", "upload=0; download=9; total=10; expire=0")
	back, _ := base64.StdEncoding.DecodeString(set)
	if !strings.Contains(string(back), "#subscription-userinfo: upload=0; download=9; total=10; expire=0") || strings.Contains(string(back), "download=1;") {
		t.Fatalf("got %q", back)
	}
	if SetHeaderLine(b64(l("A")), "subscription-userinfo", "x") != b64(l("A")) {
		t.Fatal("a body without the line is left as it is")
	}
}

func TestSingBoxEndpoints(t *testing.T) {
	profile := `{"endpoints":[{"type":"wireguard","tag":"WG","peers":[{"address":"w.example.com","port":51820}]}],
	"outbounds":[{"type":"selector","tag":"Select","outbounds":["DE-1","WG"]},
	{"type":"vless","tag":"DE-1","server":"a.example.com","server_port":443,"transport":{"type":"ws","path":"/ws"}},
	{"type":"direct","tag":"direct"}]}`
	wg := "wireguard://k@w.example.com:51820#WG"
	hosts := probe(l("DE-1"), wg)

	got, _, ok := Shape([]string{profile}, []Plan{plan(hosts, map[string]Wanted{"WG": {Name: "Home"}}, false)}, totals, now, nil)
	if !ok {
		t.Fatal("not shaped")
	}
	var out struct {
		Endpoints []struct{ Tag string } `json:"endpoints"`
		Outbounds []struct {
			Tag       string   `json:"tag"`
			Outbounds []string `json:"outbounds"`
		} `json:"outbounds"`
	}
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Endpoints) != 1 || out.Endpoints[0].Tag != "Home" || strings.Join(out.Outbounds[0].Outbounds, ",") != "Home" || len(out.Outbounds) != 2 {
		t.Fatalf("got %s", got)
	}
}

func TestOutline(t *testing.T) {
	config := `{"method":"chacha20-ietf-poly1305","password":"p","server":"s.example.com","server_port":8388,"tag":"SS"}`
	hosts := probe("ss://YWVzLTI1Ni1nY206cA@s.example.com:8388#SS")
	got, format, ok := Shape([]string{config}, []Plan{plan(hosts, map[string]Wanted{"SS": {Name: "Fast SS"}}, false)}, totals, now, nil)
	if !ok || format != Outline || !strings.Contains(got, `"tag":"Fast SS"`) || !strings.Contains(got, `"password":"p"`) {
		t.Fatalf("got %s", got)
	}
	none, _, _ := Shape([]string{config}, []Plan{plan(hosts, map[string]Wanted{}, false)}, totals, now, nil)
	if none != "{}" {
		t.Fatalf("a host left out gives nothing: %s", none)
	}
}

func TestExpiredCustomersKeepThePanelsNotice(t *testing.T) {
	notice := "vless://u@0.0.0.0:1?type=ws#⚠️ Your service has expired"
	body := b64(l("DE-1"), notice)
	expired := totals
	expired.Status = "expired"
	got, _, _ := Shape([]string{body}, []Plan{plan(deHosts, map[string]Wanted{"DE-1": {}}, false)}, expired, time.Now(), nil)
	if strings.Join(linkNames(t, got), ",") != "DE-1,⚠️ Your service has expired" {
		t.Fatalf("got %v", linkNames(t, got))
	}
	active, _, _ := Shape([]string{body}, []Plan{plan(deHosts, map[string]Wanted{"DE-1": {}}, false)}, totals, time.Now(), nil)
	if strings.Join(linkNames(t, active), ",") != "DE-1" {
		t.Fatalf("an active customer gets only what the groups pick: %v", linkNames(t, active))
	}
}

// TestNoneRecognisedIsNotAnEmptyLink: hosts are picked but the panel's
// configs are none of them (its answer differs from the probe's): given
// as they are, not as an empty link the app reads as "no servers".
func TestNoneRecognisedIsNotAnEmptyLink(t *testing.T) {
	body := b64(l("Somewhere else"), l("Other place"))
	if _, _, ok := Shape([]string{body}, []Plan{plan(deHosts, map[string]Wanted{"DE-1": {}}, false)}, totals, now, nil); ok {
		t.Fatal("not shaped: the panel's configs are given as they are")
	}
	explained := Explain([]string{body}, []Plan{plan(deHosts, map[string]Wanted{"DE-1": {}}, false)}, nil)
	if !strings.Contains(explained, `config "Somewhere else" (vless/ws) -> -`) || !strings.Contains(explained, `host "DE-1" (vless/ws) picked=true`) {
		t.Fatalf("explained:\n%s", explained)
	}
	// Nothing picked on purpose: nothing given.
	got, _, ok := Shape([]string{b64(l("DE-1"))}, []Plan{plan(deHosts, map[string]Wanted{}, false)}, totals, now, nil)
	if !ok || len(linkNames(t, got)) != 0 {
		t.Fatalf("nothing picked gives nothing: %q", got)
	}
}
