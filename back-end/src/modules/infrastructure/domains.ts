import type { SubscriptionDomainCheck, SubscriptionDomainsView, subscriptionDomainInput } from "@shah-kelid/contracts";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import config from "../../config";
import type { Db, Executor } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { writeAudit } from "../access/audit";
import { subscriptionDomains } from "./schema";

/**
 * The shop's own domains for customers' subscription links, as PasarGuard's
 * subscription domain: links do not carry the site's address, and the site
 * (sign-in, the staff area, the API) is not reached on them.
 *
 * Staff add a domain here and point it at the server; Caddy takes its
 * certificate on the first visit, once the panel service says the domain is
 * one of these (/internal/tls-ask), and serves only /s/… on it. Links are
 * made on the primary domain; the others keep answering for links given out
 * earlier. With none, links are made on the site's address as before.
 *
 * Each process keeps the primary one in memory, read again with the
 * settings every few seconds (settings/live.ts), so building a link stays
 * synchronous.
 */

let primary: string | null = null;

/** The base of customers' links on the shop's subscription domain, if one is set. */
export const subscriptionBase = () => (primary ? `https://${primary}` : null);

export const loadSubscriptionDomains = async (db: Executor) => {
  const [row] = await db
    .select({ domain: subscriptionDomains.domain })
    .from(subscriptionDomains)
    .where(eq(subscriptionDomains.isPrimary, true));
  primary = row?.domain ?? null;
};

/** Test seam. */
export const resetSubscriptionDomains = () => {
  primary = null;
};

const siteHosts = () =>
  new Set(
    [...config.cors.allowedOrigins, config.provisioning.publicUrl].flatMap((origin) => {
      try {
        return [new URL(origin).hostname.toLowerCase()];
      } catch {
        return [];
      }
    }),
  );

export const listSubscriptionDomains = async (db: Executor): Promise<SubscriptionDomainsView> => {
  const rows = await db
    .select()
    .from(subscriptionDomains)
    .orderBy(desc(subscriptionDomains.isPrimary), asc(subscriptionDomains.createdAt));
  const main = rows.find((row) => row.isPrimary);
  return {
    domains: rows.map((row) => ({ domain: row.domain, isPrimary: row.isPrimary, createdAt: row.createdAt.toISOString() })),
    linkBase: main ? `https://${main.domain}` : config.provisioning.publicUrl,
  };
};

const taken = () =>
  new ApiError(409, "DOMAIN_TAKEN", "That domain is the site's own, or added already", {
    fields: [{ path: "domain", code: "DOMAIN_TAKEN" }],
  });

/** Adds a domain; the first one added is where links are made. */
export const addSubscriptionDomain = async (
  db: Db,
  actor: StaffActor,
  input: z.output<typeof subscriptionDomainInput>,
) => {
  if (siteHosts().has(input.domain)) throw taken();
  await db.transaction(async (tx) => {
    const [{ count }] = (await tx.select({ count: sql<number>`count(*)::int` }).from(subscriptionDomains)) as [{ count: number }];
    const inserted = await tx
      .insert(subscriptionDomains)
      .values({ domain: input.domain, isPrimary: count === 0 })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) throw taken();
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "subscription_domain.added",
      entityType: "subscription_domain",
      entityId: input.domain,
      after: { domain: input.domain, isPrimary: count === 0 },
    });
  });
  await loadSubscriptionDomains(db);
  return listSubscriptionDomains(db);
};

/** Links are made on this domain from now on (links given out on another keep working). */
export const makePrimarySubscriptionDomain = async (db: Db, actor: StaffActor, domain: string) => {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(subscriptionDomains).where(eq(subscriptionDomains.domain, domain)).for("update");
    if (!row) throw notFound("No such subscription domain");
    await tx.update(subscriptionDomains).set({ isPrimary: false }).where(eq(subscriptionDomains.isPrimary, true));
    await tx.update(subscriptionDomains).set({ isPrimary: true }).where(eq(subscriptionDomains.domain, domain));
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "subscription_domain.made_primary",
      entityType: "subscription_domain",
      entityId: domain,
    });
  });
  await loadSubscriptionDomains(db);
  return listSubscriptionDomains(db);
};

/**
 * Removes a domain: links on it stop working. Removing the primary one
 * makes the oldest of the rest primary; with none left, links are made on
 * the site's address again.
 */
export const removeSubscriptionDomain = async (db: Db, actor: StaffActor, domain: string) => {
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(subscriptionDomains).where(eq(subscriptionDomains.domain, domain)).returning();
    if (!row) throw notFound("No such subscription domain");
    if (row.isPrimary) {
      const [next] = await tx
        .select({ domain: subscriptionDomains.domain })
        .from(subscriptionDomains)
        .orderBy(asc(subscriptionDomains.createdAt))
        .limit(1);
      if (next) await tx.update(subscriptionDomains).set({ isPrimary: true }).where(eq(subscriptionDomains.domain, next.domain));
    }
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "subscription_domain.removed",
      entityType: "subscription_domain",
      entityId: domain,
      before: { domain, isPrimary: row.isPrimary },
    });
  });
  await loadSubscriptionDomains(db);
  return listSubscriptionDomains(db);
};

/** What the panel service answers on a subscription domain at /s/_check. */
export const CHECK_ANSWER = "shah-kelid subscription link";

/**
 * Asks the domain, over HTTPS, as an app would: it answers when its DNS
 * points at this server (or at a proxy in front of it) and Caddy has its
 * certificate, which the first such request makes it get.
 */
export const checkSubscriptionDomain = async (
  db: Executor,
  domain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubscriptionDomainCheck> => {
  const [row] = await db.select().from(subscriptionDomains).where(eq(subscriptionDomains.domain, domain));
  if (!row) throw notFound("No such subscription domain");
  try {
    const response = await fetchImpl(`https://${domain}/s/_check`, { signal: AbortSignal.timeout(20_000), redirect: "manual" });
    const text = (await response.text()).trim();
    if (response.ok && text === CHECK_ANSWER) return { ok: true, error: null };
    return { ok: false, error: `It answered, but not as this server: HTTP ${response.status}` };
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    return { ok: false, error: (cause?.code ?? cause?.message ?? (error as Error).message).slice(0, 300) };
  }
};
