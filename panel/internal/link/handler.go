// Package link serves the customer's subscription link, GET|HEAD /s/{token}.
//
// The VPN app (v2rayNG, Hiddify, Streisand…) fetches it every few hours.
// The request goes to each of the subscription's panels' own links at once,
// and their answers come back as one, shaped by the customer's groups
// (package configs), so:
//
//   - the panels' addresses are never given to customers;
//   - a subscription on several panels has one link;
//   - a subscription can move panels without its link changing;
//   - revoking a link here stops it, whatever the panels do.
//
// Apps built on Xray-core are given full Xray configs where they read them
// (see apps.go). The headers apps read (usage, title, update interval…) are
// the panel's, as PasarGuard writes them, with the shop's own link and,
// for several panels, the whole volume. Nothing that names a panel is
// passed on.
//
// Opened in a browser, the link is the shop's subscription page; it and
// what it reads from the shop's records (/info, /apps) are the Node app's,
// passed to it as they came.
package link

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/danialrahimian/shahkelid/panel/internal/configs"
	"github.com/danialrahimian/shahkelid/panel/internal/store"
)

// Handler serves /s/{token}.
type Handler struct {
	Store   *store.Store
	Catalog *Catalog
	// AppURL is the Node app, which serves the page, /info and /apps.
	AppURL string
	// PublicURL makes the shop's link when a panel names no subscription domain.
	PublicURL string
	// HTTP asks the panels' links; nil: a client with a ten-second timeout.
	HTTP *http.Client
	// Limit is how many requests one address may make a minute for one
	// link (0: 120). An address may ask for ten times that across links:
	// mobile carriers put many customers behind one address.
	Limit int
	Now   func() time.Time
	Log   *slog.Logger

	once    sync.Once
	proxy   *httputil.ReverseProxy
	limiter *limiter
	shared  *limiter
}

var token = regexp.MustCompile(`^[A-Za-z0-9_-]{20,64}$`)

// parts are what the subscription page asks for beside the link (PasarGuard's).
var parts = map[string]bool{"info": true, "apps": true, "links": true, "raw": true, "usage": true}

// forwarded are the request headers a panel reads: to recognise a device
// (for the device limit) and to choose a format.
var forwarded = []string{"user-agent", "accept", "x-hwid", "x-device-os", "x-ver-os", "x-device-model"}

// returned are the answer's headers apps read; nothing else of a panel's.
var returned = []string{"content-type", "content-disposition", "subscription-userinfo", "profile-title",
	"profile-update-interval", "support-url", "announce", "announce-url", "routing"}

func (h *Handler) setup() {
	h.once.Do(func() {
		if h.HTTP == nil {
			h.HTTP = &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		}
		if h.Now == nil {
			h.Now = time.Now
		}
		if h.Log == nil {
			h.Log = slog.Default()
		}
		if h.Limit <= 0 {
			h.Limit = 120
		}
		h.limiter = newLimiter(h.Limit, time.Minute, h.Now)
		h.shared = newLimiter(10*h.Limit, time.Minute, h.Now)
		if target, err := url.Parse(h.AppURL); err == nil {
			h.proxy = httputil.NewSingleHostReverseProxy(target)
		}
	})
}

func notFound(w http.ResponseWriter) {
	w.Header().Set("content-type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = io.WriteString(w, "Not found")
}

// ServeHTTP serves /s/{token} and /s/{token}/{part}.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.setup()
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	segments := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/s/"), "/"), "/")
	// Apps read status codes, not JSON: answered in plain text.
	address := clientAddress(r)
	if !h.shared.allow(address) || !h.limiter.allow(address+" "+segments[0]) {
		w.Header().Set("retry-after", "60")
		http.Error(w, "Too many requests", http.StatusTooManyRequests)
		return
	}
	if len(segments) > 2 || !token.MatchString(segments[0]) || (len(segments) == 2 && !parts[segments[1]]) {
		notFound(w)
		return
	}
	part := ""
	if len(segments) == 2 {
		part = segments[1]
	}

	ctx := r.Context()
	sub, err := h.Store.SubscriptionByToken(ctx, segments[0])
	if errors.Is(err, store.ErrNotFound) || (err == nil && len(sub.Panels) == 0) {
		notFound(w)
		return
	}
	if err != nil {
		h.Log.Error("reading a subscription for its link", "err", err)
		http.Error(w, "The service is temporarily unavailable", http.StatusServiceUnavailable)
		return
	}

	// The page and what it reads about the account: the shop's, from the Node app.
	if part == "info" || part == "apps" || (part == "" && r.Method == http.MethodGet && wantsPage(r.Header.Get("accept"), r.Header.Get("user-agent"))) {
		if h.proxy == nil {
			http.Error(w, "The service is temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		h.proxy.ServeHTTP(w, r)
		return
	}

	h.serveConfigs(ctx, w, r, sub, segments[0], part)
}

// ours is the customer's link: on the shop's domain, or the panel's own
// subscription domain when it names one.
func (h *Handler) ours(token string, sub store.LinkSubscription) string {
	base := h.PublicURL
	if sub.SubscriptionBaseURL != nil && *sub.SubscriptionBaseURL != "" {
		base = strings.TrimRight(*sub.SubscriptionBaseURL, "/")
	}
	return base + "/s/" + token
}

type answer struct {
	panel    store.LinkPanel
	response *http.Response
	body     []byte
}

// ask asks every panel's link at once. A panel that does not answer is left
// out: the customer still gets the others' configs.
func (h *Handler) ask(ctx context.Context, r *http.Request, panels []store.LinkPanel, suffix string) []answer {
	answers := make([]answer, len(panels))
	var wg sync.WaitGroup
	for i, p := range panels {
		wg.Add(1)
		go func() {
			defer wg.Done()
			target := strings.TrimRight(p.URL, "/") + suffix
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			// GET for a HEAD too: PasarGuard answers GET only.
			request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
			if err != nil {
				return
			}
			for _, name := range forwarded {
				if value := r.Header.Get(name); value != "" {
					request.Header.Set(name, value)
				}
			}
			response, err := h.HTTP.Do(request)
			if err != nil {
				h.Log.Warn("subscription link: a panel did not answer", "err", err)
				return
			}
			body, err := io.ReadAll(io.LimitReader(response.Body, 32<<20))
			response.Body.Close()
			if err != nil {
				return
			}
			answers[i] = answer{panel: p, response: response, body: body}
		}()
	}
	wg.Wait()
	return answers
}

func (h *Handler) serveConfigs(ctx context.Context, w http.ResponseWriter, r *http.Request, sub store.LinkSubscription, token, part string) {
	suffix := ""
	if part != "" {
		suffix = "/" + part
	}
	// Apps on Xray-core get full Xray configs where they read them; a panel
	// with the format switched off answers as it would anyway.
	xray := part == "" && r.Method == http.MethodGet && readsXrayJSON(r.Header.Get("user-agent"))
	var answers []answer
	if xray {
		answers = h.ask(ctx, r, sub.Panels, "/xray")
		if !allGood(answers) {
			xray = false
		}
	}
	if !xray {
		answers = h.ask(ctx, r, sub.Panels, suffix)
	}

	var reached, good []answer
	for _, a := range answers {
		if a.response == nil {
			continue
		}
		reached = append(reached, a)
		if a.response.StatusCode >= 200 && a.response.StatusCode < 300 {
			good = append(good, a)
		}
	}
	if len(reached) == 0 {
		http.Error(w, "The service is temporarily unavailable", http.StatusBadGateway)
		return
	}
	upstream := reached[0]
	if len(good) > 0 {
		upstream = good[0]
	}
	if upstream.response.StatusCode == http.StatusNotFound {
		notFound(w)
		return
	}

	ours := h.ours(token, sub)
	header := w.Header()
	for _, name := range returned {
		if value := upstream.response.Header.Get(name); value != "" {
			header.Set(name, value)
		}
	}
	// One volume across the panels: the app is told the whole, not one panel's share.
	userinfo := ""
	if len(sub.Panels) > 1 {
		total, expire := int64(0), int64(0)
		if sub.DataLimitBytes != nil {
			total = *sub.DataLimitBytes
		}
		if sub.ExpiresAt != nil {
			expire = sub.ExpiresAt.Unix()
		}
		userinfo = fmt.Sprintf("upload=0; download=%d; total=%d; expire=%d", sub.UsedBytes, total, expire)
		header.Set("subscription-userinfo", userinfo)
	}
	// The panel names its own address here; the customer's page is the shop's link.
	header.Set("profile-web-page-url", ours)
	header.Set("cache-control", "no-store")
	if xray {
		header.Set("content-type", "application/json; charset=utf-8")
	}
	if len(good) > 1 {
		header.Del("content-disposition")
	}

	if r.Method == http.MethodHead {
		w.WriteHeader(upstream.response.StatusCode)
		return
	}
	if len(good) == 0 {
		w.WriteHeader(upstream.response.StatusCode)
		_, _ = w.Write(swapLink(string(upstream.body), upstream.panel.URL, ours))
		return
	}

	bodies := make([]string, len(good))
	panelIDs := make([]string, len(good))
	for i, a := range good {
		bodies[i] = string(swapLink(string(a.body), a.panel.URL, ours))
		panelIDs[i] = a.panel.PanelID
	}

	var out string
	switch part {
	case "", "links":
		out = h.shape(ctx, sub, bodies, panelIDs)
		if userinfo != "" {
			// Where the panel writes its headers into the body too ("header placement").
			out = configs.SetHeaderLine(out, "subscription-userinfo", userinfo)
		}
	case "usage":
		out = bodies[0]
		if len(bodies) > 1 {
			out = mergeUsage(bodies)
		}
	default:
		out = bodies[0]
	}
	w.WriteHeader(upstream.response.StatusCode)
	_, _ = io.WriteString(w, out)
}

// allGood reports that every panel that answered said yes, and one did.
func allGood(answers []answer) bool {
	found := false
	for _, a := range answers {
		if a.response == nil {
			continue
		}
		if a.response.StatusCode < 200 || a.response.StatusCode >= 300 {
			return false
		}
		found = true
	}
	return found
}

// shape gives the configs as the customer's groups say: picked, named, in
// order; or, for a subscription without groups or an answer in no format
// read here, as the panels gave them.
func (h *Handler) shape(ctx context.Context, sub store.LinkSubscription, bodies, panelIDs []string) string {
	plans, usernames, err := h.plans(ctx, sub.ID, panelIDs)
	if err != nil {
		h.Log.Warn("subscription link: the groups could not be read; the panels' answers are given as they are", "err", err)
	}
	if plans != nil {
		totals := configs.Totals{Username: sub.Username, Status: sub.Status, UsedBytes: sub.UsedBytes,
			DataLimitBytes: sub.DataLimitBytes, ExpiresAt: sub.ExpiresAt, OnHoldDurationSeconds: sub.OnHoldDurationSeconds}
		if shaped, _, ok := configs.Shape(bodies, plans, totals, h.Now(), append([]string{sub.Username}, usernames...)); ok {
			return shaped
		}
	}
	if len(bodies) == 1 {
		return bodies[0]
	}
	return configs.Merge(bodies)
}

// swapLink puts the shop's link in place of the panel's, plain and
// URL-encoded, with or without a trailing slash; in a base64 list of
// links too, where the panel may write its headers.
func swapLink(body, panelURL, ours string) []byte {
	bare := strings.TrimRight(panelURL, "/")
	replacer := strings.NewReplacer(
		bare+"/", ours+"/",
		bare, ours,
		url.QueryEscape(bare+"/"), url.QueryEscape(ours+"/"),
		url.QueryEscape(bare), url.QueryEscape(ours),
	)
	return []byte(configs.Rewrite(body, replacer.Replace))
}

// mergeUsage gives several panels' usage history as one list of points;
// the page adds up those of the same time.
func mergeUsage(bodies []string) string {
	var points []any
	for _, body := range bodies {
		var value any
		if json.Unmarshal([]byte(body), &value) != nil {
			continue
		}
		var stats any = value
		if object, ok := value.(map[string]any); ok {
			for _, key := range []string{"stats", "data", "usage"} {
				if inner, ok := object[key]; ok {
					stats = inner
					break
				}
			}
		}
		switch list := stats.(type) {
		case []any:
			points = append(points, list...)
		case map[string]any:
			for _, inner := range list {
				if more, ok := inner.([]any); ok {
					points = append(points, more...)
				}
			}
		}
	}
	if points == nil {
		points = []any{}
	}
	out, _ := json.Marshal(map[string]any{"stats": points})
	return string(out)
}

// clientAddress is the visitor's address: the one Caddy, the only proxy in
// front, puts in X-Forwarded-For, else the connection's.
func clientAddress(r *http.Request) string {
	if forwardedFor := r.Header.Get("x-forwarded-for"); forwardedFor != "" {
		first, _, _ := strings.Cut(forwardedFor, ",")
		return strings.TrimSpace(first)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
