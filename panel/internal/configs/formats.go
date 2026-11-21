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
)

func (f Format) String() string {
	return [...]string{"unknown", "links", "xray", "sing-box", "clash"}[f]
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
	// Links: the lines, and whether the answer was base64.
	lines  []string
	base64 bool
	// XrayJSON: the configs.
	xray []map[string]any
	// SingBox: the profile, and its proxy outbounds.
	singBox map[string]any
	proxies []map[string]any
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
		if lines := linesOf(decoded); allLinks(lines) {
			return linksAnswer(lines, true)
		}
	}
	if lines := linesOf(body); allLinks(lines) {
		return linksAnswer(lines, false)
	}
	if value, ok := decodeJSON(body); ok {
		switch json := value.(type) {
		case map[string]any:
			if outbounds, ok := json["outbounds"].([]any); ok {
				return singBoxAnswer(json, outbounds)
			}
		case []any:
			return xrayAnswer(json)
		}
		return parsed{}
	}
	return clashAnswer(body)
}

func allLinks(lines []string) bool {
	if len(lines) == 0 {
		return false
	}
	for _, line := range lines {
		if !isLink(line) {
			return false
		}
	}
	return true
}

func linksAnswer(lines []string, encoded bool) parsed {
	p := parsed{format: Links, lines: lines, base64: encoded}
	for _, line := range lines {
		p.configs = append(p.configs, FingerprintOfLink(line))
	}
	return p
}

func singBoxAnswer(profile map[string]any, outbounds []any) parsed {
	p := parsed{format: SingBox, singBox: profile}
	for _, item := range outbounds {
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
		p.proxies = append(p.proxies, outbound)
		p.configs = append(p.configs, Fingerprint{
			Name: tag, Protocol: &protocol, Server: text(outbound["server"]), Port: portOf(outbound["server_port"]),
			Network: networkName(transport["type"]), Path: pathName(path), SNI: first(text(tls["server_name"]), text(headers["Host"])),
		})
	}
	return p
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
