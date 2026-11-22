package link

import (
	"sync"
	"time"
)

// limiter allows each address a number of requests a window (a fixed
// window per address). Apps refresh every few hours; opening the page asks
// for about six things at once, so a few reloads a minute still fit.
type limiter struct {
	max    int
	window time.Duration
	now    func() time.Time

	mu      sync.Mutex
	windows map[string]*window
	swept   time.Time
}

type window struct {
	start time.Time
	count int
}

func newLimiter(max int, every time.Duration, now func() time.Time) *limiter {
	return &limiter{max: max, window: every, now: now, windows: map[string]*window{}}
}

func (l *limiter) allow(address string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	// Old windows are dropped now and then, so the map does not grow forever.
	if now.Sub(l.swept) > l.window {
		for key, w := range l.windows {
			if now.Sub(w.start) >= l.window {
				delete(l.windows, key)
			}
		}
		l.swept = now
	}
	w, ok := l.windows[address]
	if !ok || now.Sub(w.start) >= l.window {
		l.windows[address] = &window{start: now, count: 1}
		return true
	}
	w.count++
	return w.count <= l.max
}
