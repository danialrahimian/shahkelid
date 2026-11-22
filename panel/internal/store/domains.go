package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// PrimarySubscriptionDomain is the shop's domain for customers' links
// (subscription_domains, kept by the Node app's staff pages), or "" when
// links are made on the site's own address.
func (s *Store) PrimarySubscriptionDomain(ctx context.Context) (string, error) {
	var domain string
	err := s.Pool.QueryRow(ctx, `select domain from subscription_domains where is_primary`).Scan(&domain)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return domain, err
}

// ServesLinksOn reports whether host is one of the shop's subscription
// domains, or a panel's own subscription domain: one the web server may
// take a certificate for and answer links on.
func (s *Store) ServesLinksOn(ctx context.Context, host string) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `
		select exists (select 1 from subscription_domains where domain = $1)
		    or exists (select 1 from panels
		               where lower(substring(subscription_base_url from '^[A-Za-z]+://([^/:?#]+)')) = $1)`, host).Scan(&ok)
	return ok, err
}
