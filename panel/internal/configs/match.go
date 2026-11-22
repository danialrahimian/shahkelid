package configs

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
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
}

var protocolAliases = map[string]string{"ss": "shadowsocks", "hy2": "hysteria2", "wg": "wireguard"}

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

func hostID(f Fingerprint) string {
	parts := []string{deref(f.Protocol), "", deref(f.Network), deref(f.Path), f.Name}
	if f.Port != nil {
		parts[1] = strconv.FormatInt(*f.Port, 10)
	}
	// The same input the Node app hashed, so ids saved by either agree.
	sum := sha1.Sum([]byte(strings.Join(parts, "\x00")))
	return base64.RawURLEncoding.EncodeToString(sum[:])[:12]
}

// ProbeHosts reads the hosts a subscription's links stand for, each with an
// id that stays the same as long as the host does (its name, protocol,
// port, transport and path). Two configs alike in all of those are told
// apart by their place.
func ProbeHosts(links string) []Host {
	seen := map[string]int{}
	var hosts []Host
	for _, line := range linesOf(links) {
		if !isLink(line) {
			continue
		}
		f := FingerprintOfLink(line)
		base := hostID(f)
		seen[base]++
		id := base
		if seen[base] > 1 {
			id = fmt.Sprintf("%s-%d", base, seen[base])
		}
		hosts = append(hosts, Host{Fingerprint: f, ID: id})
	}
	return hosts
}

func loose(name string, usernames []string) string {
	out := strings.ToLower(name)
	for _, username := range usernames {
		if username != "" {
			out = strings.ReplaceAll(out, strings.ToLower(username), "")
		}
	}
	return out
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
// protocol, port, transport and path can be it (a part one side does not
// say is not held against it); of those, the one with the closest name,
// then the same address and server name, then the first not taken; and
// only if the name is at least half alike (or the same address and server
// name back it). A config like no host is nil: one the panel added since is
// not given someone else's place.
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
			if !sameOrUnsaid(config.Port, host.Port) || !sameOrUnsaid(config.Network, host.Network) || !sameOrUnsaid(config.Path, host.Path) {
				continue
			}
			score := 3 * likeness(loose(config.Name, usernames), loose(host.Name, usernames))
			if config.Name == host.Name {
				score = 4
			}
			if equal(config.Server, host.Server) {
				score++
			}
			if equal(config.SNI, host.SNI) {
				score += 0.5
			}
			if score >= enough && score > bestScore {
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
