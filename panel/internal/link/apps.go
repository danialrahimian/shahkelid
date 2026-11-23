package link

import "strings"

// routes are the parts of a link PasarGuard answers (app/routers/
// subscription.py): the page's own (info, raw, apps, usage) and each
// format asked for by name (ConfigFormat). Any other part is not found.
var routes = map[string]bool{
	"info": true, "raw": true, "apps": true, "usage": true,
	"links": true, "links_base64": true, "xray": true, "wireguard": true, "sing_box": true,
	"clash": true, "clash_meta": true, "outline": true, "block": true,
}

// shaped are the parts whose answer is a list of configs, shaped by the
// customer's groups like the link itself.
var shaped = map[string]bool{
	"": true, "links": true, "links_base64": true, "xray": true, "sing_box": true,
	"clash": true, "clash_meta": true, "outline": true,
}

// wantsPage reports a browser asking for the subscription page rather than
// an app asking for configs: as PasarGuard tells them apart, by "text/html"
// in what it accepts. Every app is given what the panel gives it: the
// panel's own rules (by app and version) choose the format, as they would
// for its own link.
func wantsPage(accept string) bool {
	return strings.Contains(accept, "text/html")
}
