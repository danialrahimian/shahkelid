package link

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestRecallKeepsTheRecentWithinItsSize(t *testing.T) {
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	r := newRecall(100, time.Hour, func() time.Time { return at })
	put := func(key, body string) {
		r.put(key, &answer{response: &http.Response{StatusCode: 200, Header: http.Header{}}, body: []byte(body)})
	}
	put("a", strings.Repeat("x", 10))
	put("b", strings.Repeat("y", 10))
	put("c", strings.Repeat("z", 10))
	if _, ok := r.get("a"); !ok {
		t.Fatal("kept")
	}
	for i := 0; i < 10; i++ {
		put(string(rune('d'+i)), strings.Repeat("w", 10))
	}
	if _, ok := r.get("b"); ok {
		t.Fatal("the least recently used go first when it is full")
	}
	if r.bytes > 100 {
		t.Fatalf("over its size: %d", r.bytes)
	}
	put("big", strings.Repeat("q", 60))
	if _, ok := r.get("big"); ok {
		t.Fatal("too big to keep")
	}
	at = at.Add(2 * time.Hour)
	if _, ok := r.get("m"); ok {
		t.Fatal("too old")
	}
}
