package configs

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strings"

	"gopkg.in/yaml.v3"
)

// Format is how a panel's answer is written.
type Format int

const (
	// Unknown is an answer in no format read here.
	Unknown Format = iota
	// Links is a list of links, plain or base64 (v2rayNG, Streisand…).
	Links
	// XrayJSON is a list of full Xray configs (PasarGuard's "xray" format).
	XrayJSON
	// SingBox is a sing-box profile (Hiddify, SFA…).
	SingBox
	// Clash is a Clash or Clash Meta profile.
	Clash
	// Outline is one Shadowsocks config as JSON (PasarGuard's "outline").
	Outline
)

func (f Format) String() string {
	return [...]string{"unknown", "links", "xray", "sing-box", "clash", "outline"}[f]
}

func linesOf(text string) []string {
	var out []string
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			out = append(out, line)
		}
	}
	return out
}

func isLink(line string) bool {
	scheme, _, found := strings.Cut(line, "://")
	if !found || scheme == "" {
		return false
	}
	for i, r := range scheme {
		letter := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
		if !letter && (i == 0 || !((r >= '0' && r <= '9') || r == '+' || r == '.' || r == '-')) {
			return false
		}
	}
	return true
}

func decodeBase64(text string) (string, bool) {
	compact := strings.Join(strings.Fields(text), "")
	if compact == "" {
		return "", false
	}
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if decoded, err := encoding.DecodeString(compact); err == nil && strings.Contains(string(decoded), "://") {
			return string(decoded), true
		}
	}
	return "", false
}

// proxyTypes are the outbound types that are configs (not selectors, direct…).
var proxyTypes = map[string]bool{
	"vless": true, "vmess": true, "trojan": true, "shadowsocks": true, "ss": true, "hysteria": true,
	"hysteria2": true, "tuic": true, "wireguard": true, "shadowtls": true, "socks": true, "socks5": true,
	"http": true, "ssh": true, "anytls": true, "naive": true,
}

// parsed is one answer, read: its format, its configs with their
// fingerprints, and what the configs sit in.
type parsed struct {
	format  Format
	configs []Fingerprint
	// Links: the lines, whether the answer was base64, and the lines that
	// are not links: PasarGuard can write its headers into the body
	// ("#profile-title: …"), before or after the links.
	lines  []string
	base64 bool
	head   []string
	tail   []string
	// XrayJSON: the configs.
	xray []map[string]any
	// SingBox: the profile, and its configs: proxy outbounds, and endpoints
	// (WireGuard, from sing-box 1.11), marked by inEndpoints.
	singBox     map[string]any
	proxies     []map[string]any
	inEndpoints []bool
	// Outline: the one config.
	outline map[string]any
	// Clash: the document, and its proxies.
	clash        *yaml.Node
	clashProxies []*yaml.Node
}

func decodeJSON(body string) (any, bool) {
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, false
	}
	if decoder.More() {
		return nil, false
	}
	return value, true
}

func parse(body string) parsed {
	if decoded, ok := decodeBase64(body); ok {
		if answer, ok := linksAnswer(decoded, true); ok {
			return answer
		}
	}
	if answer, ok := linksAnswer(body, false); ok {
		return answer
	}
	if value, ok := decodeJSON(body); ok {
		switch json := value.(type) {
		case map[string]any:
			if _, ok := json["outbounds"].([]any); ok {
				return singBoxAnswer(json)
			}
			_, server := json["server"]
			_, method := json["method"]
			if server && method {
				return outlineAnswer(json)
			}
		case []any:
			return xrayAnswer(json)
		}
		return parsed{}
	}
	return clashAnswer(body)
}

// linksAnswer reads a list of links. Comment lines ("#key: value", where
// PasarGuard may put its headers) are kept apart, to go back where they
// were; any other line that is not a link means it is not a list of links.
func linksAnswer(text string, encoded bool) (parsed, bool) {
	p := parsed{format: Links, base64: encoded}
	for _, line := range linesOf(text) {
		switch {
		case isLink(line):
			p.lines = append(p.lines, line)
			p.configs = append(p.configs, FingerprintOfLink(line))
		case strings.HasPrefix(line, "#") && len(p.lines) == 0:
			p.head = append(p.head, line)
		case strings.HasPrefix(line, "#"):
			p.tail = append(p.tail, line)
		default:
			return parsed{}, false
		}
	}
	if len(p.lines) == 0 {
		return parsed{}, false
	}
	return p, true
}

func singBoxAnswer(profile map[string]any) parsed {
	p := parsed{format: SingBox, singBox: profile}
	read := func(list []any, endpoints bool) {
		for _, item := range list {
			outbound, ok := item.(map[string]any)
			if !ok {
				continue
			}
			kind, _ := outbound["type"].(string)
			tag, isTag := outbound["tag"].(string)
			if !proxyTypes[kind] || !isTag {
				continue
			}
			transport, _ := outbound["transport"].(map[string]any)
			tls, _ := outbound["tls"].(map[string]any)
			headers, _ := transport["headers"].(map[string]any)
			protocol := ProtocolName(kind)
			path := transport["path"]
			if path == nil {
				path = transport["service_name"]
			}
			server := text(outbound["server"])
			port := portOf(outbound["server_port"])
			if endpoints {
				// A WireGuard endpoint names its server among its peers.
				if peers, ok := outbound["peers"].([]any); ok && len(peers) > 0 {
					if peer, ok := peers[0].(map[string]any); ok {
						server, port = text(peer["address"]), portOf(peer["port"])
					}
				}
			}
			p.proxies = append(p.proxies, outbound)
			p.inEndpoints = append(p.inEndpoints, endpoints)
			p.configs = append(p.configs, Fingerprint{
				Name: tag, Protocol: &protocol, Server: server, Port: port,
				Network: networkName(transport["type"]), Path: pathName(path), SNI: first(text(tls["server_name"]), text(headers["Host"])),
			})
		}
	}
	outbounds, _ := profile["outbounds"].([]any)
	endpoints, _ := profile["endpoints"].([]any)
	read(outbounds, false)
	read(endpoints, true)
	return p
}

// outlineAnswer reads PasarGuard's Outline answer: one Shadowsocks config.
func outlineAnswer(config map[string]any) parsed {
	protocol := "shadowsocks"
	return parsed{format: Outline, outline: config, configs: []Fingerprint{{
		Name: stringOf(config["tag"]), Protocol: &protocol, Server: text(config["server"]), Port: portOf(config["server_port"]),
	}}}
}

func xrayAnswer(items []any) parsed {
	if len(items) == 0 {
		return parsed{}
	}
	p := parsed{format: XrayJSON}
	for _, item := range items {
		config, ok := item.(map[string]any)
		if !ok {
			return parsed{}
		}
		if _, ok := config["remarks"]; !ok {
			return parsed{}
		}
		p.xray = append(p.xray, config)
		p.configs = append(p.configs, xrayFingerprint(config))
	}
	return p
}

// xrayFingerprint reads a full Xray config: its first outbound is the proxy.
func xrayFingerprint(config map[string]any) Fingerprint {
	f := Fingerprint{Name: stringOf(config["remarks"])}
	outbounds, _ := config["outbounds"].([]any)
	if len(outbounds) == 0 {
		return f
	}
	outbound, _ := outbounds[0].(map[string]any)
	if protocol, ok := outbound["protocol"].(string); ok {
		name := ProtocolName(protocol)
		f.Protocol = &name
	}
	settings, _ := outbound["settings"].(map[string]any)
	target := settings
	for _, key := range []string{"vnext", "servers"} {
		if list, ok := settings[key].([]any); ok && len(list) > 0 {
			target, _ = list[0].(map[string]any)
		}
	}
	f.Server = text(target["address"])
	f.Port = portOf(target["port"])
	stream, _ := outbound["streamSettings"].(map[string]any)
	f.Network = networkName(stream["network"])
	if f.Network != nil {
		transport, _ := stream[*f.Network+"Settings"].(map[string]any)
		path := transport["path"]
		if path == nil {
			path = transport["serviceName"]
		}
		f.Path = pathName(path)
	}
	security, _ := stream["tlsSettings"].(map[string]any)
	if security == nil {
		security, _ = stream["realitySettings"].(map[string]any)
	}
	f.SNI = text(security["serverName"])
	return f
}

func stringOf(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// mapValue finds a key of a YAML mapping.
func mapValue(node *yaml.Node, key string) *yaml.Node {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1]
		}
	}
	return nil
}

func scalar(node *yaml.Node) any {
	if node == nil || node.Kind != yaml.ScalarNode {
		return nil
	}
	return node.Value
}

func clashAnswer(body string) parsed {
	var document yaml.Node
	if err := yaml.Unmarshal([]byte(body), &document); err != nil || len(document.Content) == 0 {
		return parsed{}
	}
	root := document.Content[0]
	proxies := mapValue(root, "proxies")
	if proxies == nil || proxies.Kind != yaml.SequenceNode {
		return parsed{}
	}
	p := parsed{format: Clash, clash: &document}
	for _, proxy := range proxies.Content {
		name := mapValue(proxy, "name")
		if name == nil || name.Kind != yaml.ScalarNode {
			continue
		}
		f := Fingerprint{Name: name.Value, Server: text(scalar(mapValue(proxy, "server"))), Port: portOf(scalar(mapValue(proxy, "port"))),
			Network: networkName(scalar(mapValue(proxy, "network")))}
		if kind := scalar(mapValue(proxy, "type")); kind != nil {
			protocol := ProtocolName(kind.(string))
			f.Protocol = &protocol
		}
		var path any
		if ws := mapValue(proxy, "ws-opts"); ws != nil {
			path = scalar(mapValue(ws, "path"))
		} else if grpc := mapValue(proxy, "grpc-opts"); grpc != nil {
			path = scalar(mapValue(grpc, "grpc-service-name"))
		}
		f.Path = pathName(path)
		f.SNI = first(text(scalar(mapValue(proxy, "servername"))), text(scalar(mapValue(proxy, "sni"))))
		p.clashProxies = append(p.clashProxies, proxy)
		p.configs = append(p.configs, f)
	}
	return p
}

// writeJSON writes JSON as the panels do, without escaping < > &.
func writeJSON(value any, indent bool) string {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if indent {
		encoder.SetIndent("", "  ")
	}
	_ = encoder.Encode(value)
	return strings.TrimRight(out.String(), "\n")
}
