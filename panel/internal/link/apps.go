package link

import (
	"regexp"
	"strconv"
	"strings"
)

// An xrayApp is an app built on Xray-core that reads PasarGuard's "xray"
// format: full Xray configs, which carry what a link cannot (fragment and
// noise against filtering, mux, xhttp's extra settings) and keep the
// panel's own routing. PasarGuard gives these apps plain links unless its
// admin switches the format on for each; the shop asks for it for them.
//
// Each needs a version that reads the format; older ones, and apps not
// listed, get what the panel gives by default.
type xrayApp struct {
	pattern *regexp.Regexp
	// since is the first version that reads Xray JSON subscriptions; nil:
	// every version.
	since []int
}

var xrayApps = []xrayApp{
	// Before v2rayN: "v2rayNG/1.9" also starts with "v2rayN".
	{regexp.MustCompile(`^[Vv]2ray[Nn][Gg]/(\d+(?:\.\d+)*)`), []int{1, 8, 29}},
	{regexp.MustCompile(`^[Vv]2ray[Nn]/(\d+(?:\.\d+)*)`), []int{6, 40}},
	{regexp.MustCompile(`^[Ss]treisand/?(\d+(?:\.\d+)*)`), []int{1, 6, 12}},
	{regexp.MustCompile(`^[Hh]app/(\d+(?:\.\d+)*)`), []int{1, 63, 1}},
	{regexp.MustCompile(`^v2[Rr]ay[Tt]un`), nil},
	// NapsternetV, as PasarGuard's own rule names it.
	{regexp.MustCompile(`^[Kk]tor-client`), nil},
}

// readsXrayJSON reports whether the app asking reads Xray JSON.
func readsXrayJSON(userAgent string) bool {
	for _, app := range xrayApps {
		match := app.pattern.FindStringSubmatch(userAgent)
		if match == nil {
			continue
		}
		if app.since == nil {
			return true
		}
		return len(match) > 1 && atLeast(match[1], app.since)
	}
	return false
}

// atLeast compares a dotted version with a minimum, part by part.
func atLeast(version string, minimum []int) bool {
	parts := strings.Split(version, ".")
	for i, want := range minimum {
		got := 0
		if i < len(parts) {
			n, err := strconv.Atoi(parts[i])
			if err != nil {
				return false
			}
			got = n
		}
		if got != want {
			return got > want
		}
	}
	return true
}

// wantsPage reports a browser asking for the subscription page rather than
// an app asking for configs.
func wantsPage(accept, userAgent string) bool {
	return strings.Contains(accept, "text/html") && strings.HasPrefix(userAgent, "Mozilla/")
}
