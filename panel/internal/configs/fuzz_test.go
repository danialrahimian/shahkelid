package configs

import (
	"testing"
	"time"
)

func FuzzShape(f *testing.F) {
	for _, seed := range []string{
		b64(l("DE-1"), l("DE-2")),
		`[{"remarks":"DE-1","outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"a","port":443}]}}]}]`,
		`{"outbounds":[{"type":"vless","tag":"DE-1","server":"a","server_port":443}]}`,
		"proxies:\n  - name: DE-1\n    type: vless\n    server: a\n    port: 443\n",
		`{"method":"x","password":"p","server":"s","server_port":1}`,
		"vmess://e30=", "hysteria2://a@b#x", "ss://@:0#", "vless://u@[::1:443#",
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, body string) {
		hosts := ProbeHosts(body)
		Shape([]string{body, body}, []Plan{plan(deHosts, map[string]Wanted{"DE-1": {Name: "{DATA_LEFT} {USERNAME}"}}, false), {Hosts: hosts, Known: true}}, totals, time.Now(), []string{"u"})
		Merge([]string{body, body})
		SetHeaderLine(body, "subscription-userinfo", "x")
	})
}
