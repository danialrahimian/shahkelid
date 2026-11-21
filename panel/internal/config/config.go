// Package config reads the service's settings from the environment, the
// same variables the Node app reads, so one .env serves both.
package config

import (
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	// PostgreSQL, shared with the Node app.
	PostgresURL string
	// APP_ENCRYPTION_KEY: opens the panels' credentials (32 bytes).
	EncryptionKey []byte
	// Where this service listens: the customer's link (/s/…) and /health.
	Listen string
	// The Node app, for what the link serves from the shop's records (the
	// subscription page, /info, /apps).
	AppURL string
	// {PublicURL}/s/{token} is the customer's link, unless a panel names
	// its own subscription domain.
	PublicURL string
	// How often every panel is read; 0 turns the sync off (tests).
	SyncEvery time.Duration
	// Panels read at once, and limit changes sent at once to one panel.
	PanelsAtOnce  int
	ChangesAtOnce int
	// A panel user not connected by then starts its clock anyway.
	FirstUseDeadline time.Duration
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func number(name string, fallback int) (int, error) {
	raw := env(name, "")
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("%s must be a whole number, got %q", name, raw)
	}
	return value, nil
}

// Load reads the environment. Missing required settings are an error, said
// in words an operator can act on.
func Load() (Config, error) {
	cfg := Config{
		PostgresURL: env("POSTGRES_URL", ""),
		Listen:      env("PANEL_LISTEN", ":7000"),
		AppURL:      strings.TrimRight(env("PANEL_APP_URL", "http://localhost:5000"), "/"),
		PublicURL:   strings.TrimRight(env("PUBLIC_API_URL", "http://localhost:5000"), "/"),
	}
	if cfg.PostgresURL == "" {
		return cfg, fmt.Errorf("POSTGRES_URL is not set")
	}
	key, err := base64.StdEncoding.DecodeString(env("APP_ENCRYPTION_KEY", ""))
	if err != nil || len(key) != 32 {
		return cfg, fmt.Errorf("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded")
	}
	cfg.EncryptionKey = key

	syncMs, err := number("USAGE_SYNC_EVERY_MS", 5*60*1000)
	if err != nil {
		return cfg, err
	}
	cfg.SyncEvery = time.Duration(syncMs) * time.Millisecond
	if cfg.PanelsAtOnce, err = number("PANEL_SYNC_PANELS_AT_ONCE", 8); err != nil {
		return cfg, err
	}
	if cfg.ChangesAtOnce, err = number("PANEL_SYNC_CHANGES_AT_ONCE", 16); err != nil {
		return cfg, err
	}
	days, err := number("FIRST_USE_DEADLINE_DAYS", 30)
	if err != nil {
		return cfg, err
	}
	cfg.FirstUseDeadline = time.Duration(days) * 24 * time.Hour
	if cfg.PanelsAtOnce < 1 {
		cfg.PanelsAtOnce = 1
	}
	if cfg.ChangesAtOnce < 1 {
		cfg.ChangesAtOnce = 1
	}
	return cfg, nil
}
