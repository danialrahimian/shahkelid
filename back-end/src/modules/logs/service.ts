import type { LogEntryView, LogSource } from "@shah-kelid/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { Db } from "../../platform/db/client";

/**
 * One log of everything that happens in the store, newest first, for the
 * owner: what staff did (the audit log), what happened to each subscription,
 * orders and payments as they move, alerts and other system events, emails
 * to customers, support tickets, and accounts.
 *
 * Nothing new is recorded for it. Each source already keeps its own rows;
 * this reads them side by side, so the log can never disagree with them.
 */

type Row = {
  key: string;
  at: Date;
  /** `at` to the microsecond, as the database has it: a Date keeps only milliseconds. */
  cursor: string;
  source: LogSource;
  kind: string;
  actor: string | null;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  details: unknown;
  problem: boolean;
};

/** Who someone is, in one word: their username, else their email. */
const who = (alias: string) =>
  sql.raw(`coalesce(${alias}.username::text, ${alias}.email::text)`);

/** Every source as rows of the same shape. */
const everything = sql`
  -- What staff, customers and the system did, as the audit log has it.
  select 'audit:' || a.id as key, a.occurred_at as at,
    case when a.actor_kind = 'staff' then 'staff' else 'system' end as source,
    a.action as kind, coalesce(${who("ua")}, a.actor_kind::text) as actor,
    a.entity_type, a.entity_id,
    a.action || ' on ' || a.entity_type || coalesce(' ' || a.entity_id, '') as summary,
    jsonb_build_object('before', a.before, 'after', a.after, 'ip', a.ip::text) as details,
    false as problem
  from audit_logs a left join users ua on ua.id = a.actor_user_id

  union all
  -- Each subscription's history: made, put on the panel, failed, renewed, deleted.
  select 'subscription:' || e.id, e.created_at, 'subscription', e.kind,
    coalesce(${who("ue")}, e.actor_kind::text),
    'subscription', e.subscription_id::text,
    'Subscription ' || e.kind || ' (' || coalesce(${who("owner")}, '?') || ')',
    e.details || jsonb_build_object('orderId', e.order_id),
    e.kind in ('provisioning_failed', 'missing_on_panel')
  from subscription_events e
  join subscriptions s on s.id = e.subscription_id
  left join users owner on owner.id = s.user_id
  left join users ue on ue.id = e.actor_user_id

  union all
  -- Orders as they are placed, paid, made and closed.
  select 'order:' || o.id || ':' || step.kind, step.at, 'order', 'order.' || step.kind,
    ${who("uo")}, 'order', o.id::text,
    'Order ' || o.number || ' ' || step.kind || ' · ' || o.total_toman || ' toman · ' || o.kind,
    jsonb_build_object('number', o.number, 'status', o.status, 'kind', o.kind, 'totalToman', o.total_toman, 'subscriptionId', o.subscription_id),
    step.kind in ('expired', 'cancelled') or (step.kind = 'paid' and o.status = 'paid' and o.kind = 'new')
  from orders o
  join users uo on uo.id = o.user_id
  cross join lateral (values
    ('placed', o.created_at),
    ('paid', o.paid_at),
    ('fulfilled', o.fulfilled_at),
    ('cancelled', o.cancelled_at),
    ('expired', case when o.status = 'expired' then o.expires_at end)
  ) as step(kind, at)
  where step.at is not null

  union all
  -- Payments: started, then succeeded, failed or expired.
  select 'payment:' || p.id || ':' || step.kind, step.at, 'payment', 'payment.' || step.kind,
    case when step.kind = 'started' then ${who("up")} else coalesce(${who("ur")}, 'system') end,
    'payment', p.id::text,
    'Payment ' || step.kind || ' · ' || p.method || ' · ' || p.amount_toman || ' toman · order ' || o.number
      || coalesce(' · ' || p.failure_reason, ''),
    jsonb_build_object('method', p.method, 'status', p.status, 'amountToman', p.amount_toman, 'orderId', p.order_id,
      'reference', p.provider_reference, 'refId', p.provider_ref_id, 'failureReason', p.failure_reason),
    step.kind in ('failed', 'expired')
  from payments p
  join orders o on o.id = p.order_id
  join users up on up.id = p.user_id
  left join users ur on ur.id = p.reviewed_by_user_id
  cross join lateral (values
    ('started', p.created_at),
    ('succeeded', p.succeeded_at),
    ('failed', case when p.status = 'failed' then coalesce(p.reviewed_at, p.updated_at) end),
    ('expired', case when p.status = 'expired' then p.updated_at end)
  ) as step(kind, at)
  where step.at is not null

  union all
  -- Alerts to staff, and every other event the outbox carried (or could not).
  select 'outbox:' || x.id, x.created_at,
    case when x.topic = 'admin.alert' then 'alert' else 'event' end,
    x.topic, 'system', x.aggregate_type, x.aggregate_id::text,
    case when x.topic = 'admin.alert' then coalesce(x.payload->>'subject', 'Alert')
      else x.topic || ' for ' || x.aggregate_type || coalesce(' · not delivered: ' || x.last_error, '') end,
    x.payload || jsonb_build_object('publishedAt', x.published_at, 'attempts', x.attempts, 'lastError', x.last_error),
    x.topic = 'admin.alert' or (x.published_at is null and x.last_error is not null)
  from outbox_events x

  union all
  -- Emails (and other messages) to customers.
  select 'email:' || n.id, n.created_at, 'email', n.template_key || '.' || n.status,
    'system', 'user', n.user_id::text,
    n.template_key || ' to ' || n.recipient || ' · ' || n.status || coalesce(' · ' || n.error, ''),
    jsonb_build_object('channel', n.channel, 'recipient', n.recipient, 'status', n.status, 'error', n.error, 'sentAt', n.sent_at),
    n.status = 'failed'
  from notifications n

  union all
  -- Support: tickets opened, and every message on them.
  select 'ticket:' || t.id, t.created_at, 'support', 'ticket.opened', ${who("ut")}, 'ticket', t.id::text,
    'Ticket ' || t.number || ' opened: ' || t.subject,
    jsonb_build_object('number', t.number, 'priority', t.priority, 'status', t.status),
    false
  from tickets t join users ut on ut.id = t.user_id

  union all
  select 'message:' || m.id, m.created_at, 'support',
    case when m.is_internal then 'ticket.note' else 'ticket.' || m.author_kind || '_message' end,
    coalesce(${who("um")}, m.author_kind::text), 'ticket', t.id::text,
    'Ticket ' || t.number || ': ' || left(m.body, 140),
    jsonb_build_object('internal', m.is_internal),
    false
  from ticket_messages m join tickets t on t.id = m.ticket_id left join users um on um.id = m.author_user_id

  union all
  -- Accounts: made, last signed in, deleted.
  select 'account:' || u.id || ':' || step.kind, step.at, 'account', 'account.' || step.kind,
    ${who("u")}, 'user', u.id::text,
    'Account ' || step.kind || ': ' || coalesce(${who("u")}, u.id::text),
    jsonb_build_object('status', u.status),
    false
  from users u
  cross join lateral (values
    ('created', u.created_at),
    ('signed_in', u.last_login_at),
    ('deleted', u.deleted_at)
  ) as step(kind, at)
  where step.at is not null
`;

export const logEntries = async (
  db: Db,
  filters: { source?: LogSource; q?: string; problems?: boolean; before?: { at: string; key: string }; limit: number },
) => {
  const where: SQL[] = [];
  if (filters.source) where.push(sql`source = ${filters.source}`);
  if (filters.problems) where.push(sql`problem`);
  if (filters.q) {
    const like = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(sql`(summary ilike ${like} or kind ilike ${like} or actor ilike ${like} or entity_id ilike ${like})`);
  }
  if (filters.before) where.push(sql`(at, key) < (${filters.before.at}::timestamptz, ${filters.before.key})`);

  const { rows } = await db.execute<Row>(sql`
    select *, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor
    from (${everything}) as log
    ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``}
    order by at desc, key desc
    limit ${filters.limit}
  `);

  const entries = rows.map(
    (row): LogEntryView => ({
      key: row.key,
      at: new Date(row.at).toISOString(),
      source: row.source,
      kind: row.kind,
      actor: row.actor,
      entity: row.entity_type && row.entity_id ? { type: row.entity_type, id: row.entity_id } : null,
      summary: row.summary,
      details: row.details,
      problem: row.problem,
    }),
  );
  const last = rows.at(-1);
  return {
    entries,
    next: entries.length === filters.limit && last ? { beforeAt: last.cursor, beforeKey: last.key } : null,
  };
};
