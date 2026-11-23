package link

import (
	"container/list"
	"net/http"
	"sync"
	"time"
)

// recall keeps each panel's last good answer to a link, by what was asked
// (the address and the app), for when the panel is slow or down: a link
// then gets the answer it got a moment ago rather than nothing. Bounded by
// total size; the least recently used go first.
type recall struct {
	maxBytes int
	maxAge   time.Duration
	now      func() time.Time

	mu    sync.Mutex
	bytes int
	order *list.List // of *remembered, most recent first
	byKey map[string]*list.Element
}

type remembered struct {
	key    string
	status int
	header http.Header
	body   []byte
	at     time.Time
}

func newRecall(maxBytes int, maxAge time.Duration, now func() time.Time) *recall {
	return &recall{maxBytes: maxBytes, maxAge: maxAge, now: now, order: list.New(), byKey: map[string]*list.Element{}}
}

func (r *recall) put(key string, a *answer) {
	size := len(a.body) + len(key)
	if size > r.maxBytes/8 {
		return // too big to keep
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if e, ok := r.byKey[key]; ok {
		r.bytes -= len(e.Value.(*remembered).body) + len(key)
		r.order.Remove(e)
	}
	r.byKey[key] = r.order.PushFront(&remembered{key: key, status: a.response.StatusCode, header: a.response.Header.Clone(), body: a.body, at: r.now()})
	r.bytes += size
	for r.bytes > r.maxBytes {
		oldest := r.order.Back()
		gone := oldest.Value.(*remembered)
		r.order.Remove(oldest)
		delete(r.byKey, gone.key)
		r.bytes -= len(gone.body) + len(gone.key)
	}
}

func (r *recall) get(key string) (*remembered, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.byKey[key]
	if !ok {
		return nil, false
	}
	m := e.Value.(*remembered)
	if r.now().Sub(m.at) > r.maxAge {
		return nil, false
	}
	return m, true
}
