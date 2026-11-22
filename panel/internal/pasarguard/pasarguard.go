// Package pasarguard talks to a PasarGuard panel (https://github.com/PasarGuard/panel),
// the same way the Node app's driver does (back-end/src/modules/provisioning/pasarguard.ts).
//
// Signing in: an API key goes in the X-Api-Key header. With a panel account
// instead, a token from POST /api/admin/token is kept and reused, and fetched
// again once when the panel says it has expired. Every request has a timeout.
package pasarguard

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const timeout = 10 * time.Second

// Credentials are what the Node app keeps (sealed) in panels.credentials_enc.
type Credentials struct {
	Kind     string `json:"kind"`
	APIKey   string `json:"apiKey"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// Unavailable is returned when the panel could not be reached, timed out,
// or failed on its side. It is worth trying again later.
type Unavailable struct{ Message string }

func (e *Unavailable) Error() string { return e.Message }

// Rejected is returned when the panel answered and said no. Asking again
// will not help.
type Rejected struct {
	Status  int
	Message string
}

func (e *Rejected) Error() string { return e.Message }

// IsRejected reports a refusal from the panel, with its HTTP status.
func IsRejected(err error) (int, bool) {
	var rejected *Rejected
	if errors.As(err, &rejected) {
		return rejected.Status, true
	}
	return 0, false
}

// User is a panel user, as far as the shop reads it.
type User struct {
	ID                    int64
	Username              string
	Status                string
	DataLimitBytes        *int64 // nil: unlimited
	UsedBytes             int64
	LifetimeUsedBytes     int64
	ExpiresAt             *time.Time // nil: no expiry, or on hold
	OnHoldDurationSeconds *int64
	DeviceLimit           *int64
	GroupIDs              []int64
	OnlineAt              *time.Time
	SubscriptionURL       string // absolute
}

// Group is one of the panel's groups. InboundTags is nil when the account
// may not read them.
type Group struct {
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	InboundTags []string `json:"inboundTags,omitempty"`
}

// NewUser describes a user to make. With StartsOnFirstUse the clock starts at the
// first connection (or at StartsAtLatest); otherwise at once, until ExpiresAt
// (nil: never).
type NewUser struct {
	Username         string
	GroupIDs         []int64
	DataLimitBytes   *int64
	DeviceLimit      *int64
	TrafficReset     string
	Note             string
	StartsOnFirstUse bool
	DurationSeconds  int64
	StartsAtLatest   time.Time
	ExpiresAt        *time.Time
}

// Change says what to set on a user; nil fields are left alone. For the
// pointer-to-pointer fields, a non-nil outer pointer holding nil means
// "unlimited" (volume) or "never" (expiry).
type Change struct {
	DataLimitBytes        **int64
	ExpiresAt             **time.Time
	GroupIDs              []int64
	OnHoldDurationSeconds *int64
	Activate              bool
}

// Empty reports whether the change sets nothing.
func (c Change) Empty() bool {
	return c.DataLimitBytes == nil && c.ExpiresAt == nil && c.GroupIDs == nil && c.OnHoldDurationSeconds == nil && !c.Activate
}

var resetStrategy = map[string]string{"no_reset": "no_reset", "daily": "day", "weekly": "week", "monthly": "month"}

// Client talks to one panel. It is safe for concurrent use.
type Client struct {
	base        string
	credentials Credentials
	http        *http.Client

	mu    sync.Mutex
	token string
}

// New returns a client for the panel at baseURL. A nil httpClient means one
// with a ten-second timeout.
func New(baseURL string, credentials Credentials, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: timeout}
	}
	return &Client{base: strings.TrimRight(baseURL, "/"), credentials: credentials, http: httpClient}
}

// ------------------------------------------------------------- transport

func (c *Client) send(ctx context.Context, method, path string, body any, form url.Values, token string) (*http.Response, error) {
	var reader io.Reader
	contentType := ""
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader, contentType = bytes.NewReader(encoded), "application/json"
	} else if form != nil {
		reader, contentType = strings.NewReader(form.Encode()), "application/x-www-form-urlencoded"
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	request, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		cancel()
		return nil, err
	}
	request.Header.Set("accept", "application/json")
	if contentType != "" {
		request.Header.Set("content-type", contentType)
	}
	if c.credentials.Kind == "api_key" {
		request.Header.Set("x-api-key", c.credentials.APIKey)
	} else if token != "" {
		request.Header.Set("authorization", "Bearer "+token)
	}
	response, err := c.http.Do(request)
	if err != nil {
		cancel()
		return nil, &Unavailable{Message: "could not reach the panel: " + err.Error()}
	}
	// The body is read before the deadline's context goes.
	data, err := io.ReadAll(io.LimitReader(response.Body, 64<<20))
	response.Body.Close()
	cancel()
	if err != nil {
		return nil, &Unavailable{Message: "the panel's answer was cut off: " + err.Error()}
	}
	response.Body = io.NopCloser(bytes.NewReader(data))
	return response, nil
}

func (c *Client) signIn(ctx context.Context) (string, error) {
	form := url.Values{"username": {c.credentials.Username}, "password": {c.credentials.Password}}
	response, err := c.send(ctx, http.MethodPost, "/api/admin/token", nil, form, "")
	if err != nil {
		return "", err
	}
	var body struct {
		AccessToken string `json:"access_token"`
	}
	if err := read(response, "sign in", &body); err != nil {
		return "", err
	}
	return body.AccessToken, nil
}

func (c *Client) authorized(ctx context.Context, method, path string, body any) (*http.Response, error) {
	attempt := func() (*http.Response, error) {
		token := ""
		if c.credentials.Kind != "api_key" {
			c.mu.Lock()
			if c.token == "" {
				fresh, err := c.signIn(ctx)
				if err != nil {
					c.mu.Unlock()
					return nil, err
				}
				c.token = fresh
			}
			token = c.token
			c.mu.Unlock()
		}
		return c.send(ctx, method, path, body, nil, token)
	}
	response, err := attempt()
	// An expired token: sign in again, once.
	if err == nil && response.StatusCode == http.StatusUnauthorized && c.credentials.Kind != "api_key" {
		c.mu.Lock()
		c.token = ""
		c.mu.Unlock()
		return attempt()
	}
	return response, err
}

// read decodes a successful answer, or makes the right error of a failed one.
func read(response *http.Response, what string, into any) error {
	data, _ := io.ReadAll(response.Body)
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		if into == nil || response.StatusCode == http.StatusNoContent {
			return nil
		}
		if err := json.Unmarshal(data, into); err != nil {
			return &Unavailable{Message: fmt.Sprintf("%s: the panel's answer is not JSON", what)}
		}
		return nil
	}
	detail := string(data)
	if len(detail) > 300 {
		detail = detail[:300]
	}
	summary := strings.TrimSpace(fmt.Sprintf("%s: HTTP %d %s", what, response.StatusCode, detail))
	if response.StatusCode >= 500 || response.StatusCode == 429 || response.StatusCode == 408 {
		return &Unavailable{Message: summary}
	}
	return &Rejected{Status: response.StatusCode, Message: summary}
}

// ------------------------------------------------------------- the user

type rawUser struct {
	ID                   int64           `json:"id"`
	Username             string          `json:"username"`
	Status               string          `json:"status"`
	DataLimit            *int64          `json:"data_limit"`
	UsedTraffic          int64           `json:"used_traffic"`
	LifetimeUsedTraffic  *int64          `json:"lifetime_used_traffic"`
	Expire               json.RawMessage `json:"expire"`
	OnHoldExpireDuration *int64          `json:"on_hold_expire_duration"`
	HwidLimit            *int64          `json:"hwid_limit"`
	GroupIDs             []int64         `json:"group_ids"`
	OnlineAt             *string         `json:"online_at"`
	SubscriptionURL      string          `json:"subscription_url"`
}

// utcDate reads PasarGuard's datetimes: without a zone they are UTC; a
// number is seconds; 0 or empty is none.
func utcDate(raw json.RawMessage) *time.Time {
	text := strings.TrimSpace(string(raw))
	if text == "" || text == "null" || text == "0" || text == `""` {
		return nil
	}
	var seconds float64
	if err := json.Unmarshal(raw, &seconds); err == nil {
		at := time.Unix(int64(seconds), 0).UTC()
		return &at
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || value == "" {
		return nil
	}
	return parseDate(value)
}

func parseDate(value string) *time.Time {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.999999999", "2006-01-02 15:04:05.999999999"} {
		if at, err := time.Parse(layout, value); err == nil {
			utc := at.UTC()
			return &utc
		}
	}
	return nil
}

func (c *Client) toUser(raw rawUser) User {
	user := User{
		ID:                    raw.ID,
		Username:              raw.Username,
		Status:                raw.Status,
		UsedBytes:             raw.UsedTraffic,
		LifetimeUsedBytes:     raw.UsedTraffic,
		ExpiresAt:             utcDate(raw.Expire),
		OnHoldDurationSeconds: raw.OnHoldExpireDuration,
		GroupIDs:              raw.GroupIDs,
	}
	if raw.DataLimit != nil && *raw.DataLimit != 0 {
		user.DataLimitBytes = raw.DataLimit
	}
	if raw.LifetimeUsedTraffic != nil {
		user.LifetimeUsedBytes = *raw.LifetimeUsedTraffic
	}
	if raw.HwidLimit != nil && *raw.HwidLimit != 0 {
		user.DeviceLimit = raw.HwidLimit
	}
	if user.GroupIDs == nil {
		user.GroupIDs = []int64{}
	}
	if raw.OnlineAt != nil {
		user.OnlineAt = parseDate(*raw.OnlineAt)
	}
	// Relative when the panel has no subscription domain set.
	if base, err := url.Parse(c.base + "/"); err == nil {
		if ref, err := url.Parse(raw.SubscriptionURL); err == nil {
			user.SubscriptionURL = base.ResolveReference(ref).String()
		}
	}
	return user
}

func userPath(username, suffix string) string {
	return "/api/user/by-username/" + url.PathEscape(username) + suffix
}

// ------------------------------------------------------------- operations

// FindUser reads a user; it returns nil and no error when there is none.
func (c *Client) FindUser(ctx context.Context, username string) (*User, error) {
	response, err := c.authorized(ctx, http.MethodGet, userPath(username, ""), nil)
	if err != nil {
		return nil, err
	}
	if response.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	var raw rawUser
	if err := read(response, "read the user", &raw); err != nil {
		return nil, err
	}
	user := c.toUser(raw)
	return &user, nil
}

// CreateUser makes a user.
func (c *Client) CreateUser(ctx context.Context, user NewUser) (User, error) {
	body := map[string]any{
		"username":                  user.Username,
		"data_limit":                int64(0), // 0 is PasarGuard's "unlimited"
		"data_limit_reset_strategy": resetStrategy[orDefault(user.TrafficReset, "no_reset")],
		"hwid_limit":                user.DeviceLimit,
		"group_ids":                 user.GroupIDs,
		"note":                      nilIfEmpty(user.Note),
	}
	if user.DataLimitBytes != nil {
		body["data_limit"] = *user.DataLimitBytes
	}
	if user.StartsOnFirstUse {
		body["status"] = "on_hold"
		body["on_hold_expire_duration"] = user.DurationSeconds
		body["on_hold_timeout"] = user.StartsAtLatest.UTC().Format(time.RFC3339Nano)
		body["expire"] = nil
	} else {
		body["status"] = "active"
		if user.ExpiresAt != nil {
			body["expire"] = user.ExpiresAt.UTC().Format(time.RFC3339Nano)
		} else {
			body["expire"] = nil
		}
	}
	response, err := c.authorized(ctx, http.MethodPost, "/api/user", body)
	if err != nil {
		return User{}, err
	}
	var raw rawUser
	if err := read(response, "create the user", &raw); err != nil {
		return User{}, err
	}
	return c.toUser(raw), nil
}

// UpdateLimits sets what the change says on a user.
func (c *Client) UpdateLimits(ctx context.Context, username string, change Change) (User, error) {
	body := map[string]any{}
	if change.DataLimitBytes != nil {
		if *change.DataLimitBytes == nil {
			body["data_limit"] = 0
		} else {
			body["data_limit"] = **change.DataLimitBytes
		}
	}
	if change.GroupIDs != nil {
		body["group_ids"] = change.GroupIDs
	}
	if change.ExpiresAt != nil {
		if *change.ExpiresAt == nil {
			body["expire"] = 0
		} else {
			body["expire"] = (**change.ExpiresAt).UTC().Format(time.RFC3339Nano)
		}
	}
	if change.OnHoldDurationSeconds != nil {
		body["on_hold_expire_duration"] = *change.OnHoldDurationSeconds
	}
	if change.Activate {
		body["status"] = "active"
	}
	response, err := c.authorized(ctx, http.MethodPut, userPath(username, ""), body)
	if err != nil {
		return User{}, err
	}
	var raw rawUser
	if err := read(response, "change the user", &raw); err != nil {
		return User{}, err
	}
	return c.toUser(raw), nil
}

// SetEnabled switches a user on or off.
func (c *Client) SetEnabled(ctx context.Context, username string, enabled bool) (User, error) {
	response, err := c.authorized(ctx, http.MethodPut, userPath(username, "/disabled"), map[string]bool{"disabled": !enabled})
	if err != nil {
		return User{}, err
	}
	var raw rawUser
	if err := read(response, "enable", &raw); err != nil {
		return User{}, err
	}
	return c.toUser(raw), nil
}

// ListUsers reads one page of the users this account can see.
func (c *Client) ListUsers(ctx context.Context, offset, limit int) ([]User, int, error) {
	query := url.Values{"offset": {fmt.Sprint(offset)}, "limit": {fmt.Sprint(limit)}}
	response, err := c.authorized(ctx, http.MethodGet, "/api/users?"+query.Encode(), nil)
	if err != nil {
		return nil, 0, err
	}
	var body struct {
		Users []rawUser `json:"users"`
		Total int       `json:"total"`
	}
	if err := read(response, "list users", &body); err != nil {
		return nil, 0, err
	}
	users := make([]User, len(body.Users))
	for i, raw := range body.Users {
		users[i] = c.toUser(raw)
	}
	return users, body.Total, nil
}

// ListGroups reads the panel's groups. The full list says which inbounds
// each grants; a reseller's account may read ids and names only.
func (c *Client) ListGroups(ctx context.Context) ([]Group, error) {
	response, err := c.authorized(ctx, http.MethodGet, "/api/groups", nil)
	if err != nil {
		return nil, err
	}
	if response.StatusCode == http.StatusForbidden {
		simple, err := c.authorized(ctx, http.MethodGet, "/api/groups/simple", nil)
		if err != nil {
			return nil, err
		}
		var body struct {
			Groups []Group `json:"groups"`
		}
		if err := read(simple, "list groups", &body); err != nil {
			return nil, err
		}
		for i := range body.Groups {
			body.Groups[i].InboundTags = nil
		}
		return body.Groups, nil
	}
	var body struct {
		Groups []struct {
			ID          int64    `json:"id"`
			Name        string   `json:"name"`
			InboundTags []string `json:"inbound_tags"`
		} `json:"groups"`
	}
	if err := read(response, "list groups", &body); err != nil {
		return nil, err
	}
	groups := make([]Group, len(body.Groups))
	for i, group := range body.Groups {
		tags := group.InboundTags
		if tags == nil {
			tags = []string{}
		}
		groups[i] = Group{ID: group.ID, Name: group.Name, InboundTags: tags}
	}
	return groups, nil
}

// ReadLinks reads a user's configs as links (one per line) from their
// subscription link: the plain list, else the base64 one, else what a links
// app is given (the panel may have switched formats off).
func (c *Client) ReadLinks(ctx context.Context, subscriptionURL string) (string, error) {
	bare := strings.TrimRight(subscriptionURL, "/")
	tries := []struct {
		url       string
		userAgent string
	}{{bare + "/links", ""}, {bare + "/links_base64", ""}, {bare, "v2rayNG/1.9.0"}}
	var last error
	for _, try := range tries {
		requestCtx, cancel := context.WithTimeout(ctx, timeout)
		request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, try.url, nil)
		if err != nil {
			cancel()
			return "", err
		}
		if try.userAgent != "" {
			request.Header.Set("user-agent", try.userAgent)
		}
		response, err := c.http.Do(request)
		if err != nil {
			cancel()
			return "", &Unavailable{Message: "could not read a subscription link: " + err.Error()}
		}
		data, _ := io.ReadAll(io.LimitReader(response.Body, 16<<20))
		response.Body.Close()
		cancel()
		text := string(data)
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			links := text
			if decoded := DecodeBase64Links(text); decoded != "" {
				links = decoded
			}
			if strings.Contains(links, "://") || strings.TrimSpace(text) == "" {
				return links, nil
			}
		}
		if len(text) > 200 {
			text = text[:200]
		}
		last = &Rejected{Status: response.StatusCode, Message: fmt.Sprintf("read a subscription link: HTTP %d %s", response.StatusCode, text)}
	}
	return "", last
}

// DecodeBase64Links decodes a base64 list of links, or gives "" when the
// text is not one.
func DecodeBase64Links(text string) string {
	compact := strings.Join(strings.Fields(text), "")
	if compact == "" {
		return ""
	}
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if decoded, err := encoding.DecodeString(compact); err == nil && strings.Contains(string(decoded), "://") {
			return string(decoded)
		}
	}
	return ""
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}
