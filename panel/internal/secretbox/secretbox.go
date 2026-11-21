// Package secretbox opens (and seals) what the Node app keeps encrypted in
// the database: AES-256-GCM, laid out as
// version (1 byte) | IV (12) | auth tag (16) | ciphertext.
// A value altered, or sealed with another key, fails to open.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
)

const (
	version  = 1
	ivBytes  = 12
	tagBytes = 16
)

var ErrNotSealed = errors.New("not a sealed value this build can open")

func Open(sealed, key []byte) ([]byte, error) {
	if len(sealed) < 1+ivBytes+tagBytes || sealed[0] != version {
		return nil, ErrNotSealed
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	iv := sealed[1 : 1+ivBytes]
	tag := sealed[1+ivBytes : 1+ivBytes+tagBytes]
	ciphertext := sealed[1+ivBytes+tagBytes:]
	// Go's GCM wants the tag after the ciphertext.
	return gcm.Open(nil, iv, append(append([]byte{}, ciphertext...), tag...), nil)
}

func Seal(plaintext, key []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	iv := make([]byte, ivBytes)
	if _, err := rand.Read(iv); err != nil {
		return nil, err
	}
	out := gcm.Seal(nil, iv, plaintext, nil)
	ciphertext, tag := out[:len(out)-tagBytes], out[len(out)-tagBytes:]
	sealed := append([]byte{version}, iv...)
	sealed = append(sealed, tag...)
	return append(sealed, ciphertext...), nil
}
