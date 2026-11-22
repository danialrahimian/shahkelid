package panels

import (
	"bytes"
	"strings"
	"testing"

	"github.com/danialrahimian/shahkelid/panel/internal/secretbox"
	"github.com/danialrahimian/shahkelid/panel/internal/store"
)

var key = bytes.Repeat([]byte{3}, 32)

func row(t *testing.T, credentials string) store.Panel {
	t.Helper()
	sealed, err := secretbox.Seal([]byte(credentials), key)
	if err != nil {
		t.Fatal(err)
	}
	return store.Panel{ID: "p", Name: "Panel", Driver: "pasarguard", BaseURL: "https://panel.test", CredentialsSealed: sealed}
}

func TestAClientIsKeptUntilItsPanelChanges(t *testing.T) {
	clients := New(key)
	p := row(t, `{"kind":"api_key","apiKey":"one"}`)
	first, err := clients.For(p)
	if err != nil {
		t.Fatal(err)
	}
	again, _ := clients.For(p)
	if first != again {
		t.Fatal("a new client for the same panel: it would sign in again")
	}
	changed := row(t, `{"kind":"api_key","apiKey":"two"}`)
	if next, _ := clients.For(changed); next == first {
		t.Fatal("new credentials kept the old client")
	}
	moved := p
	moved.BaseURL = "https://elsewhere.test"
	if next, _ := clients.For(moved); next == first {
		t.Fatal("a new address kept the old client")
	}
}

func TestCredentialsThatDoNotOpen(t *testing.T) {
	p := row(t, `{"kind":"api_key","apiKey":"one"}`)
	if _, err := New(bytes.Repeat([]byte{4}, 32)).For(p); err == nil || !strings.Contains(err.Error(), "APP_ENCRYPTION_KEY") {
		t.Fatalf("got %v", err)
	}
	broken := row(t, `not json`)
	if _, err := New(key).For(broken); err == nil {
		t.Fatal("unreadable credentials were used")
	}
}

func TestOnlyPasarGuard(t *testing.T) {
	p := row(t, `{"kind":"api_key","apiKey":"one"}`)
	p.Driver = "marzban"
	if _, err := New(key).For(p); err == nil || !strings.Contains(err.Error(), "marzban") {
		t.Fatalf("got %v", err)
	}
}
