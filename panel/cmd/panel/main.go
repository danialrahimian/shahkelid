// Command panel is the shop's panel service: it serves customers'
// subscription links (/s/…) and keeps usage, time and status in step with
// the VPN panels. The Node app does the rest (the shop, payments, staff
// pages) on the same database.
//
// Settings come from the environment (see internal/config). It stops
// cleanly on SIGINT or SIGTERM: requests in flight finish, the sync in
// progress ends at its next step.
//
// With -health it asks a running service's /health and exits 0 when it
// answers: the container's health check, in an image without a shell.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/danialrahimian/shahkelid/panel/internal/config"
	"github.com/danialrahimian/shahkelid/panel/internal/link"
	"github.com/danialrahimian/shahkelid/panel/internal/panels"
	"github.com/danialrahimian/shahkelid/panel/internal/store"
	"github.com/danialrahimian/shahkelid/panel/internal/syncer"
)

func main() {
	health := flag.Bool("health", false, "ask the running service's /health and exit 0 if it is healthy")
	flag.Parse()
	if *health {
		os.Exit(checkHealth())
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("the panel service stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := store.Open(ctx, cfg.PostgresURL)
	if err != nil {
		return err
	}
	defer db.Close()

	clients := panels.New(cfg.EncryptionKey)
	usageSync := &syncer.Syncer{
		Store:            db,
		Panels:           func(p store.Panel) (syncer.Panel, error) { return clients.For(p) },
		PanelsAtOnce:     cfg.PanelsAtOnce,
		ChangesAtOnce:    cfg.ChangesAtOnce,
		FirstUseDeadline: cfg.FirstUseDeadline,
		Log:              log,
	}
	links := &link.Handler{
		Store:     db,
		Catalog:   &link.Catalog{Panels: func(p store.Panel) (link.ProbePanel, error) { return clients.For(p) }, Log: log},
		AppURL:    cfg.AppURL,
		PublicURL: cfg.PublicURL,
		Log:       log,
	}

	mux := http.NewServeMux()
	mux.Handle("/s/", links)
	// Caddy asks before it takes a certificate for a subscription domain.
	mux.HandleFunc("GET /internal/tls-ask", links.ServeTLSAsk)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		if err := db.Pool.Ping(r.Context()); err != nil {
			http.Error(w, "database unreachable", http.StatusServiceUnavailable)
			return
		}
		fmt.Fprintln(w, "ok")
	})
	server := &http.Server{
		Addr:              cfg.Listen,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		// Room for every panel's ten seconds, and the shaping.
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  2 * time.Minute,
	}

	if cfg.SyncEvery > 0 {
		go usageSync.Every(ctx, cfg.SyncEvery)
		go housekeeping(ctx, db, log)
	}

	failed := make(chan error, 1)
	go func() {
		log.Info("listening", "address", cfg.Listen, "sync_every", cfg.SyncEvery.String())
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			failed <- err
		}
	}()

	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return server.Shutdown(shutdown)
}

// housekeeping prunes, once a day, what deleted subscriptions leave behind.
func housekeeping(ctx context.Context, db *store.Store, log *slog.Logger) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		if removed, err := db.PruneDeleted(ctx, 30*24*time.Hour); err != nil {
			log.Error("pruning deleted subscriptions' copies", "err", err)
		} else if removed > 0 {
			log.Info("pruned deleted subscriptions' copies", "rows", removed)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// checkHealth asks the service listening on PANEL_LISTEN (default :7000).
func checkHealth() int {
	listen := os.Getenv("PANEL_LISTEN")
	if listen == "" {
		listen = ":7000"
	}
	if listen[0] == ':' {
		listen = "127.0.0.1" + listen
	}
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://" + listen + "/health")
	if err != nil {
		return 1
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
