// Package panels gives a PasarGuard client for each panel row, made from its
// sealed credentials and kept between uses, so a panel account signs in once
// rather than on every request. A kept client is replaced when the row's
// address or credentials change.
package panels

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/danialrahimian/shahkelid/panel/internal/pasarguard"
	"github.com/danialrahimian/shahkelid/panel/internal/secretbox"
	"github.com/danialrahimian/shahkelid/panel/internal/store"
)

// Clients hands out clients. It is safe for concurrent use.
type Clients struct {
	key  []byte
	mu   sync.Mutex
	kept map[string]kept
}

type kept struct {
	version string
	client  *pasarguard.Client
}

// New returns Clients that open credentials with key (APP_ENCRYPTION_KEY).
func New(key []byte) *Clients {
	return &Clients{key: key, kept: map[string]kept{}}
}

// For returns the client of a panel.
func (c *Clients) For(p store.Panel) (*pasarguard.Client, error) {
	if p.Driver != "pasarguard" {
		return nil, fmt.Errorf("there is no driver for %s panels yet", p.Driver)
	}
	version := p.Driver + "|" + p.BaseURL + "|" + string(p.CredentialsSealed)
	c.mu.Lock()
	defer c.mu.Unlock()
	if k, ok := c.kept[p.ID]; ok && k.version == version {
		return k.client, nil
	}
	opened, err := secretbox.Open(p.CredentialsSealed, c.key)
	if err != nil {
		return nil, fmt.Errorf("panel %s: its credentials do not open with this APP_ENCRYPTION_KEY: %w", p.Name, err)
	}
	var credentials pasarguard.Credentials
	if err := json.Unmarshal(opened, &credentials); err != nil {
		return nil, fmt.Errorf("panel %s: its credentials are not readable: %w", p.Name, err)
	}
	client := pasarguard.New(p.BaseURL, credentials, nil)
	c.kept[p.ID] = kept{version: version, client: client}
	return client, nil
}
