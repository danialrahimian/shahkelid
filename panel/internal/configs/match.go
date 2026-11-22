package configs

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Fingerprint is what identifies a config apart from whose it is.
type Fingerprint struct {
	Name     string
	Protocol *string
	Server   *string
	Port     *int64
	Network  *string
	Path     *string
	SNI      *string
}

// Host is a host as read from the shop's own subscription on a panel
// group: a config with an id of ours that stays the same while the host does.
type Host struct {
	Fingerprint
	ID string
	// LegacyID is the id earlier releases gave it (with its port and path):
	// picks saved under it are found again.
	LegacyID string
}

// protocolAliases: one name per protocol, whatever the format calls it.
// PasarGuard's "hysteria" is Hysteria 2 (it makes no other).
var protocolAliases = map[string]string{"ss": "shadowsocks", "hy2": "hysteria2", "hysteria": "hysteria2", "wg": "wireguard"}

// ProtocolName is a protocol's one name: ss is shadowsocks, and so on.
func ProtocolName(name string) string {
	lower := strings.ToLower(name)
	if alias, ok := protocolAliases[lower]; ok {
		return alias
	}
	return lower
}

func text(v any) *string {
	if s, ok := v.(string); ok && s != "" {
		return &s
	}
	return nil
}

func portOf(v any) *int64 {
	var port int64
	switch value := v.(type) {
	case string:
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			return nil
		}
		port = parsed
	case json.Number:
		parsed, err := value.Int64()
		if err != nil {
			return nil
		}
		port = parsed
	case float64:
		port = int64(value)
	case int:
		port = int64(value)
	case int64:
		port = value
	default:
		return nil
	}
	if port <= 0 {
		return nil
	}
	return &port
}

// networkName: tcp and raw are what no transport means.
func networkName(v any) *string {
	name, _ := v.(string)
	name = strings.ToLower(name)
	if name == "" || name == "tcp" || name == "raw" || name == "none" {
		return nil
	}
	return &name
}

// pathName leaves out early-data and other query parts: the path itself is
// what matters.
func pathName(v any) *string {
	value, ok := v.(string)
	if !ok || value == "" {
		return nil
	}
	path, _, _ := strings.Cut(value, "?")
	if decoded, err := url.PathUnescape(path); err == nil {
		path = decoded
	}
	path = strings.TrimRight(path, "/")
	if path == "" {
		return nil
	}
	return &path
}

func first(values ...*string) *string {
	for _, v := range values {
		if v != nil {
			return v
		}
	}
	return nil
}

// FingerprintOfLink reads a config link (vless://, vmess://, trojan://, ss://…).
func FingerprintOfLink(line string) Fingerprint {
	scheme, _, _ := strings.Cut(line, "://")
	scheme = strings.ToLower(scheme)
	if scheme == "vmess" {
		if body := vmessJSON(line); body != nil {
			protocol := "vmess"
			return Fingerprint{
				Name:     fmt.Sprint(orEmpty(body["ps"])),
				Protocol: &protocol,
				Server:   text(body["add"]),
				Port:     portOf(body["port"]),
				Network:  networkName(body["net"]),
				Path:     pathName(body["path"]),
				SNI:      first(text(body["sni"]), text(body["host"])),
			}
		}
	}
	rest, fragment, hasName := strings.Cut(line, "#")
	name := ""
	if hasName {
		if decoded, err := url.PathUnescape(fragment); err == nil {
			name = decoded
		} else {
			name = fragment
		}
	}
	protocol := ProtocolName(scheme)
	f := Fingerprint{Name: name, Protocol: &protocol}
	parsed, err := url.Parse(rest)
	if err != nil {
		return f
	}
	if host := strings.Trim(parsed.Hostname(), "[]"); host != "" {
		f.Server = &host
	}
	f.Port = portOf(parsed.Port())
	query := parsed.Query()
	f.Network = networkName(query.Get("type"))
	path := query.Get("path")
	if path == "" {
		path = query.Get("serviceName")
	}
	f.Path = pathName(path)
	f.SNI = first(text(query.Get("sni")), text(query.Get("host")))
	return f
}

func orEmpty(v any) any {
	if v == nil {
		return ""
	}
	return v
}

func vmessJSON(line string) map[string]any {
	encoded := line[len("vmess://"):]
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if decoded, err := encoding.DecodeString(encoded); err == nil {
			var body map[string]any
			decoder := json.NewDecoder(strings.NewReader(string(decoded)))
			decoder.UseNumber()
			if decoder.Decode(&body) == nil {
				return body
			}
		}
	}
	return nil
}

func digest(parts ...string) string {
	sum := sha1.Sum([]byte(strings.Join(parts, "\x00")))
	return base64.RawURLEncoding.EncodeToString(sum[:])[:12]
}

// hostID is what a host is known by: its protocol, transport and name.
// Not its address, port, server name or path: PasarGuard picks those at
// random from a host's lists on every request, and fills variables in a
// path, so they are not the host's. A renamed host is found again from what
// was saved about it (Rekey).
func hostID(f Fingerprint) string {
	return digest(deref(f.Protocol), deref(f.Network), f.Name)
}

// legacyHostID is the id earlier releases gave a host (with its port and path).
func legacyHostID(f Fingerprint) string {
	port := ""
	if f.Port != nil {
		port = strconv.FormatInt(*f.Port, 10)
	}
	return digest(deref(f.Protocol), port, deref(f.Network), deref(f.Path), f.Name)
}

// ProbeHosts reads the hosts the shop's own subscription gives: from
// PasarGuard's Xray JSON (which carries every host, whatever its
// transport), or from a list of links. Each gets an id that stays the same
// as long as the host does; two alike in protocol, transport and name are
// told apart by their place.
func ProbeHosts(body string) []Host {
	var configs []Fingerprint
	if answer := parse(body); answer.format == XrayJSON || answer.format == Links {
		configs = answer.configs
	}
	seen := map[string]int{}
	var hosts []Host
	for _, f := range configs {
		base := hostID(f)
		seen[base]++
		id, legacy := base, legacyHostID(f)
		if seen[base] > 1 {
			id = fmt.Sprintf("%s-%d", base, seen[base])
			legacy = fmt.Sprintf("%s-%d", legacy, seen[base])
		}
		hosts = append(hosts, Host{Fingerprint: f, ID: id, LegacyID: legacy})
	}
	return hosts
}

// variablePart matches what PasarGuard's variables write in a name: sizes
// ("40.0 GB"), counts and percentages, dates, time left ("1m 15d"), "∞" and
// "-". In a name they differ between the customer and the shop's own
// subscription, so they are set aside when names are compared.
var variablePart = regexp.MustCompile(`(?i)\d+(?:[.,]\d+)?(?:\s*(?:[kmgtp]?b|bytes|%|[mdh]\b))?|∞`)

// loose is a name as compared: lower case, without the usernames, its
// variable parts each one "#".
func loose(name string, usernames []string) string {
	out := strings.ToLower(name)
	for _, username := range usernames {
		if username != "" {
			out = strings.ReplaceAll(out, strings.ToLower(username), "")
		}
	}
	return variablePart.ReplaceAllString(out, "#")
}

// likeness is how alike two names are, 0 to 1: their common start and end
// against the longer, counted in characters.
func likeness(a, b string) float64 {
	if a == b {
		return 1
	}
	x, y := []rune(a), []rune(b)
	longest := max(len(x), len(y))
	if longest == 0 {
		return 1
	}
	start := 0
	for start < len(x) && start < len(y) && x[start] == y[start] {
		start++
	}
	end := 0
	for end < len(x)-start && end < len(y)-start && x[len(x)-1-end] == y[len(y)-1-end] {
		end++
	}
	return float64(start+end) / float64(longest)
}

// enough is how alike a config must be to a host to be it.
const enough = 1.5

func sameOrUnsaid[T comparable](a, b *T) bool { return a == nil || b == nil || *a == *b }

func equal(a, b *string) bool { return a != nil && b != nil && *a == *b }

// MatchHosts says which host each config is. Only a host of the same
// protocol and transport can be it (a part one side does not say is not
// held against it); of those, the one whose name is at least half alike,
// compared without the usernames and the parts PasarGuard's variables
// write (sizes, days, dates); the closest first, then the one whose
// address, server name, port and path also agree. A config like no host
// is nil: one the panel added since is not given someone else's place.
//
// Address, port and path only help to choose: PasarGuard picks them at
// random from a host's lists on every request.
func MatchHosts(configs []Fingerprint, hosts []Host, usernames []string) []*Host {
	used := make([]bool, len(hosts))
	out := make([]*Host, len(configs))
	for i, config := range configs {
		best, bestScore := -1, -1.0
		for j, host := range hosts {
			if used[j] {
				continue
			}
			if config.Protocol != nil && host.Protocol != nil && *config.Protocol != *host.Protocol {
				continue
			}
			if !sameOrUnsaid(config.Network, host.Network) {
				continue
			}
			score := 3 * likeness(loose(config.Name, usernames), loose(host.Name, usernames))
			if config.Name == host.Name {
				score = 4
			}
			if score < enough {
				continue
			}
			if equal(config.Server, host.Server) {
				score++
			}
			if equal(config.SNI, host.SNI) {
				score += 0.5
			}
			if config.Port != nil && host.Port != nil && *config.Port == *host.Port {
				score += 0.5
			}
			if equal(config.Path, host.Path) {
				score += 0.5
			}
			if score > bestScore {
				best, bestScore = j, score
			}
		}
		if best >= 0 {
			used[best] = true
			out[i] = &hosts[best]
		}
	}
	return out
}

// Saved is what was saved about a host along with a group's settings for
// it, to find it again when the panel renames it.
type Saved struct {
	HostID string
	Fingerprint
}

// Rekey finds which new hosts (free) the settings of hosts that are gone
// (orphans) now belong to: a host the panel renamed gets a new id, and
// what was saved about the old one finds it again. A setting goes only to
// a host of the same protocol and transport whose name is much like the
// saved one or whose address or server name is the saved one, and only
// when plainly the one: the only such host, or clearly the most alike. It
// returns orphan host id → new host id. The Node app does the same
// (configs.rekey).
func Rekey(orphans []Saved, free []Host) map[string]string {
	out := map[string]string{}
	taken := make([]bool, len(free))
	for _, orphan := range orphans {
		if orphan.Protocol == nil {
			continue // saved before fingerprints were kept
		}
		type candidate struct {
			index int
			score float64
		}
		var candidates []candidate
		for j, host := range free {
			if taken[j] || host.Protocol == nil || *host.Protocol != *orphan.Protocol || !sameOrUnsaid(orphan.Network, host.Network) {
				continue
			}
			if (orphan.Network == nil) != (host.Network == nil) {
				continue
			}
			alike := likeness(strings.ToLower(orphan.Name), strings.ToLower(host.Name))
			sameServer, sameSNI := equal(orphan.Server, host.Server), equal(orphan.SNI, host.SNI)
			if alike < 0.5 && !sameServer && !sameSNI {
				continue
			}
			score := 3 * alike
			if sameServer {
				score++
			}
			if orphan.Port != nil && host.Port != nil && *orphan.Port == *host.Port {
				score += 0.5
			}
			if equal(orphan.Path, host.Path) {
				score += 0.5
			}
			if sameSNI {
				score += 0.5
			}
			candidates = append(candidates, candidate{j, score})
		}
		if len(candidates) == 0 {
			continue
		}
		sort.SliceStable(candidates, func(a, b int) bool { return candidates[a].score > candidates[b].score })
		best := candidates[0]
		clear := len(candidates) == 1 && best.score >= 1
		if len(candidates) > 1 {
			clear = best.score >= 1.5 && best.score-candidates[1].score >= 1
		}
		if !clear {
			continue
		}
		taken[best.index] = true
		out[orphan.HostID] = free[best.index].ID
	}
	return out
}

// Settlement is what settling a group's saved hosts against what a panel
// gives now changes.
type Settlement struct {
	// Moves: a saved host's id → the id its host has now (the id earlier
	// releases gave it, or renamed on the panel).
	Moves map[string]string
	// Fresh: hosts the group has not seen before, to be recorded.
	Fresh []Host
	// Fill: saved hosts given now whose fingerprint was not kept yet.
	Fill []string
}

// Settled reports whether there is nothing to change.
func (s Settlement) Settled() bool { return len(s.Moves) == 0 && len(s.Fresh) == 0 && len(s.Fill) == 0 }

// Settle settles what a group has saved about one panel's hosts (rows)
// against what that panel gives now. The group keeps a row for every host
// it has seen, so a host that is gone is told apart from one that is new:
// a row whose host is gone is moved only to a host never seen before
// (renamed on the panel, or under the id earlier releases gave), never to
// one the group already knows, so a host deleted on the panel leaves its
// siblings' settings alone. A row whose host is gone and not found again
// stays, for if it comes back. The Node app does the same (configs.settle).
func Settle(rows []Saved, hosts []Host) Settlement {
	ids := map[string]bool{}
	for _, host := range hosts {
		ids[host.ID] = true
	}
	saved := map[string]bool{}
	for _, row := range rows {
		saved[row.HostID] = true
	}
	out := Settlement{Moves: map[string]string{}}
	claimed := map[string]bool{}
	for _, host := range hosts {
		if saved[host.ID] || claimed[host.ID] {
			continue
		}
		if _, moved := out.Moves[host.LegacyID]; saved[host.LegacyID] && !ids[host.LegacyID] && !moved {
			out.Moves[host.LegacyID] = host.ID
			claimed[host.ID] = true
		}
	}
	var orphans []Saved
	for _, row := range rows {
		if _, moved := out.Moves[row.HostID]; !ids[row.HostID] && !moved {
			orphans = append(orphans, row)
		}
	}
	var unseen []Host
	for _, host := range hosts {
		if !saved[host.ID] && !claimed[host.ID] {
			unseen = append(unseen, host)
		}
	}
	for from, to := range Rekey(orphans, unseen) {
		out.Moves[from] = to
		claimed[to] = true
	}
	for _, host := range unseen {
		if !claimed[host.ID] {
			out.Fresh = append(out.Fresh, host)
		}
	}
	for _, row := range rows {
		if ids[row.HostID] && row.Protocol == nil {
			out.Fill = append(out.Fill, row.HostID)
		}
	}
	return out
}
