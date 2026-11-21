// Command panel is the shop's panel service: it serves customers'
// subscription links (/s/…) and keeps usage, time and status in step with
// the VPN panels. The Node app does the rest (the shop, payments, staff
// pages) on the same database.
//
// Settings come from the environment (see internal/config). It stops
// cleanly on SIGINT or SIGTERM: requests in flight finish, the sync in
// progress ends at its next step.
package main

import (
	"context"
	"errors"
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
	sync := &syncer.Syncer{
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
		go sync.Every(ctx, cfg.SyncEvery)
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
