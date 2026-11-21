package config

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestLoad(t *testing.T) {
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	t.Setenv("POSTGRES_URL", "postgres://x")
	t.Setenv("APP_ENCRYPTION_KEY", key)
	t.Setenv("USAGE_SYNC_EVERY_MS", "60000")
	t.Setenv("PANEL_APP_URL", "http://app:5000/")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SyncEvery != time.Minute || cfg.AppURL != "http://app:5000" || cfg.Listen != ":7000" || cfg.PanelsAtOnce != 8 {
		t.Fatalf("got %+v", cfg)
	}
	if cfg.FirstUseDeadline != 30*24*time.Hour {
		t.Fatalf("deadline %v", cfg.FirstUseDeadline)
	}
}

func TestLoadSaysWhatIsWrong(t *testing.T) {
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	tests := map[string]map[string]string{
		"POSTGRES_URL":        {"POSTGRES_URL": "", "APP_ENCRYPTION_KEY": key},
		"APP_ENCRYPTION_KEY":  {"POSTGRES_URL": "postgres://x", "APP_ENCRYPTION_KEY": "short"},
		"USAGE_SYNC_EVERY_MS": {"POSTGRES_URL": "postgres://x", "APP_ENCRYPTION_KEY": key, "USAGE_SYNC_EVERY_MS": "soon"},
	}
	for want, env := range tests {
		for name, value := range env {
			t.Setenv(name, value)
		}
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: got %v", want, err)
		}
		t.Setenv("USAGE_SYNC_EVERY_MS", "")
	}
}
