package secretbox

import (
	"bytes"
	"encoding/base64"
	"testing"
)

// Sealed by the Node app (back-end/src/platform/crypto/secret-box.ts) with a
// key of 32 bytes of 7: what this service must be able to open.
const sealedByNode = "AWi0TmUJQh+xH4+Cx4aOpjxXCeZhxB8/brnl/fgJMWQLyYniilYD4fJcrTMRHHq4bIxhsVVRQ7UnDfvVv19KhpxGD71TSLXpT2Y60ycqEHd3q2XXisvO3AU="

func TestOpensWhatNodeSealed(t *testing.T) {
	sealed, _ := base64.StdEncoding.DecodeString(sealedByNode)
	opened, err := Open(sealed, bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	if string(opened) != `{"kind":"password","username":"operator","password":"right"}` {
		t.Fatalf("opened %q", opened)
	}
}

func TestRoundTripAndTampering(t *testing.T) {
	key := make([]byte, 32)
	sealed, err := Seal([]byte("secret"), key)
	if err != nil {
		t.Fatal(err)
	}
	if opened, err := Open(sealed, key); err != nil || string(opened) != "secret" {
		t.Fatalf("opened %q, %v", opened, err)
	}
	other := bytes.Repeat([]byte{1}, 32)
	if _, err := Open(sealed, other); err == nil {
		t.Fatal("opened with another key")
	}
	altered := append([]byte{}, sealed...)
	altered[len(altered)-1] ^= 1
	if _, err := Open(altered, key); err == nil {
		t.Fatal("opened an altered value")
	}
	if _, err := Open([]byte{2, 0}, key); err != ErrNotSealed {
		t.Fatal("opened a value of another version")
	}
}
