import type {
  CustomerDetail,
  CustomerPage,
  CustomerSegments,
  CustomerSort,
  CustomerStage,
  CustomerSummary,
  CustomerTag,
} from "@shah-kelid/contracts";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { Db, Executor } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { notFound } from "../../platform/http/api-error";
import { writeAudit } from "../access/audit";
import { users } from "../identity/schema";
import { listSubscriptions } from "../subscriptions/service";
import { customerNotes, customerProfiles, customerTags, tags } from "./schema";

/**
 * The customer list and each customer's record.
 *
 * Everything measurable (what they paid, their live services, their stage)
 * is worked out from orders and subscriptions when it is read, never stored:
 * a stored lifetime value starts drifting the moment something happens
 * elsewhere. Only what a person decides is stored: a stage set by hand,
 * notes and tags.
 */

const AT_RISK_DAYS = 7;

type Filters = { search?: string; stage?: CustomerStage; tagId?: string; userId?: string };

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * One row per customer with its facts and stage. The stage rule, in order:
 * a live service is "active" (or "at-risk" when it ends within a week or has
 * run out of volume); without one, never paid is a "lead" and paid before is
 * "churned". A hand-set stage wins over all of it.
 */
const staged = ({ search, userId }: Filters) => {
  const where: SQL[] = [sql`u.deleted_at is null`];
  if (userId) where.push(sql`u.id = ${userId}`);
  if (search?.trim()) {
    const pattern = `%${escapeLike(search.trim())}%`;
    where.push(sql`(u.email ilike ${pattern} or u.display_name ilike ${pattern})`);
  }
  // Services and orders are added up once, grouped by customer, and joined:
  // with 10,000 customers, a subquery per customer took half a second. For
  // one customer's page the sums are kept to that customer.
  const onlyOne = userId ? sql`where user_id = ${userId}` : sql``;
  const onlyOneAnd = userId ? sql`and user_id = ${userId}` : sql``;
  return sql`
    with services as (
      select user_id,
        count(*) filter (where status in ('provisioning', 'on_hold', 'active', 'limited'))::int as live,
        bool_or(status = 'limited'
          or (status = 'active' and expires_at < now() + make_interval(days => ${AT_RISK_DAYS}))) as at_risk
      from subscriptions ${onlyOne}
      group by user_id
    ),
    paid_orders as (
      select user_id, sum(total_toman) as value, count(*) as paid, max(paid_at) as last_paid
      from orders
      where status in ('paid', 'fulfilled') and kind <> 'wallet_topup' ${onlyOneAnd}
      group by user_id
    ),
    facts as (
      select
        u.id, u.email, u.display_name, u.status, u.created_at, u.last_login_at,
        coalesce(o.value, 0)::bigint as value,
        coalesce(o.paid, 0)::int as paid,
        o.last_paid,
        coalesce(s.live, 0) as live,
        coalesce(s.at_risk, false) as at_risk,
        cp.stage_override
      from users u
      left join services s on s.user_id = u.id
      left join paid_orders o on o.user_id = u.id
      left join customer_profiles cp on cp.user_id = u.id
      where ${sql.join(where, sql` and `)}
    ),
    staged as (
      select facts.*,
        case
          when live > 0 and at_risk then 'at-risk'
          when live > 0 then 'active'
          when paid = 0 then 'lead'
          else 'churned'
        end as computed
      from facts
    )
    select staged.*, coalesce(stage_override, computed) as stage from staged`;
};

type Row = {
  id: string;
  email: string;
  display_name: string;
  status: string;
  created_at: Date | string;
  last_login_at: Date | string | null;
  value: string | number;
  paid: number;
  last_paid: Date | string | null;
  live: number;
  stage_override: CustomerStage | null;
  computed: CustomerStage;
  stage: CustomerStage;
};

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

const tagsOf = async (executor: Executor, userIds: string[]) => {
  const byUser = new Map<string, CustomerTag[]>();
  if (!userIds.length) return byUser;
  const rows = await executor
    .select({ userId: customerTags.userId, id: tags.id, name: tags.name, color: tags.color })
    .from(customerTags)
    .innerJoin(tags, eq(tags.id, customerTags.tagId))
    .where(inArray(customerTags.userId, userIds))
    .orderBy(tags.name);
  for (const { userId, ...tag } of rows) byUser.set(userId, [...(byUser.get(userId) ?? []), tag]);
  return byUser;
};

const summaryOf = (row: Row, customerTagList: CustomerTag[]): CustomerSummary => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  status: row.status,
  createdAt: iso(row.created_at)!,
  lastLoginAt: iso(row.last_login_at),
  liveSubscriptions: Number(row.live),
  lifetimeValueToman: Number(row.value),
  paidOrders: Number(row.paid),
  lastPaidAt: iso(row.last_paid),
  stage: row.stage,
  computedStage: row.computed,
  stageOverride: row.stage_override,
  tags: customerTagList,
});

const ORDER_BY: Record<CustomerSort, SQL> = {
  joined: sql`created_at desc`,
  value: sql`value desc, created_at desc`,
  recent: sql`last_paid desc nulls last, created_at desc`,
};

export const listCustomers = async (
  db: Db,
  filters: Filters & { sort: CustomerSort; limit: number; offset: number },
): Promise<CustomerPage> => {
  const where: SQL[] = [sql`true`];
  if (filters.stage) where.push(sql`stage = ${filters.stage}`);
  if (filters.tagId) {
    where.push(sql`exists (select 1 from customer_tags ct where ct.user_id = listed.id and ct.tag_id = ${filters.tagId})`);
  }
  const { rows } = await db.execute<Row & { total: number; segment_value: string }>(sql`
    select listed.*, count(*) over ()::int as total, sum(value) over () as segment_value
    from (${staged(filters)}) listed
    where ${sql.join(where, sql` and `)}
    order by ${ORDER_BY[filters.sort]}
    limit ${filters.limit} offset ${filters.offset}`);
  const tagged = await tagsOf(
    db,
    rows.map((row) => row.id),
  );
  return {
    customers: rows.map((row) => summaryOf(row, tagged.get(row.id) ?? [])),
    total: rows[0] ? Number(rows[0].total) : 0,
    segmentValueToman: rows[0] ? Number(rows[0].segment_value) : 0,
  };
};

export const customerDetail = async (db: Db, userId: string): Promise<CustomerDetail> => {
  const { rows } = await db.execute<Row>(staged({ userId }));
  const row = rows[0];
  if (!row) throw notFound("No such customer");
  const [tagged, subscriptions, notes] = await Promise.all([
    tagsOf(db, [userId]),
    listSubscriptions(db, { userId, limit: 100, offset: 0 }),
    db
      .select()
      .from(customerNotes)
      .where(eq(customerNotes.userId, userId))
      .orderBy(desc(customerNotes.createdAt))
      .limit(200),
  ]);
  return {
    ...summaryOf(row, tagged.get(userId) ?? []),
    subscriptions,
    notes: notes.map((note) => ({
      id: note.id,
      authorName: note.authorName,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
    })),
  };
};

export const segments = async (db: Db): Promise<CustomerSegments> => {
  const { rows } = await db.execute<{ stage: CustomerStage; customers: number; value: string }>(sql`
    select stage, count(*)::int as customers, coalesce(sum(value), 0) as value
    from (${staged({})}) listed group by stage`);
  const tagRows = await db.execute<CustomerTag & { customers: number }>(sql`
    select t.id, t.name, t.color, count(ct.user_id)::int as customers
    from tags t left join customer_tags ct on ct.tag_id = t.id
    group by t.id order by customers desc, t.name`);
  return {
    stages: rows.map((row) => ({ stage: row.stage, customers: row.customers, valueToman: Number(row.value) })),
    tags: tagRows.rows,
  };
};

// -------------------------------------------------------- what staff record

const existingCustomer = async (executor: Executor, userId: string) => {
  const [user] = await executor.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) throw notFound("No such customer");
};

const nameOf = async (executor: Executor, userId: string) => {
  const [user] = await executor
    .select({ displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return user?.displayName || user?.email || "—";
};

export const addNote = async (db: Db, actor: StaffActor, userId: string, body: string) =>
  db.transaction(async (tx) => {
    await existingCustomer(tx, userId);
    const [note] = await tx
      .insert(customerNotes)
      .values({ userId, authorUserId: actor.userId, authorName: await nameOf(tx, actor.userId), body })
      .returning();
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "customer.note_added",
      entityType: "user",
      entityId: userId,
      after: { noteId: note!.id },
    });
  });

export const deleteNote = async (db: Db, actor: StaffActor, userId: string, noteId: string) =>
  db.transaction(async (tx) => {
    const [note] = await tx
      .delete(customerNotes)
      .where(and(eq(customerNotes.id, noteId), eq(customerNotes.userId, userId)))
      .returning();
    if (!note) throw notFound("No such note");
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "customer.note_deleted",
      entityType: "user",
      entityId: userId,
      before: { authorName: note.authorName, body: note.body },
    });
  });

export const setStage = async (db: Db, actor: StaffActor, userId: string, stage: CustomerStage | null) =>
  db.transaction(async (tx) => {
    await existingCustomer(tx, userId);
    const [before] = await tx.select().from(customerProfiles).where(eq(customerProfiles.userId, userId));
    await tx
      .insert(customerProfiles)
      .values({ userId, stageOverride: stage })
      .onConflictDoUpdate({ target: customerProfiles.userId, set: { stageOverride: stage } });
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "customer.stage_set",
      entityType: "user",
      entityId: userId,
      before: { stage: before?.stageOverride ?? null },
      after: { stage },
    });
  });

/** Replaces the customer's tags with these names. A name not yet a tag becomes one. */
export const setTags = async (db: Db, actor: StaffActor, userId: string, names: string[]) =>
  db.transaction(async (tx) => {
    await existingCustomer(tx, userId);
    if (names.length) await tx.insert(tags).values(names.map((name) => ({ name }))).onConflictDoNothing();
    // citext: "VIP" finds "vip".
    const wanted = names.length
      ? await tx
          .select({ id: tags.id, name: tags.name })
          .from(tags)
          .where(sql`${tags.name} = any(${sql.param(names)}::citext[])`)
      : [];
    await tx.delete(customerTags).where(eq(customerTags.userId, userId));
    if (wanted.length) {
      await tx.insert(customerTags).values(wanted.map((tag) => ({ userId, tagId: tag.id, addedBy: actor.userId })));
    }
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "customer.tags_set",
      entityType: "user",
      entityId: userId,
      after: { tags: wanted.map((tag) => tag.name) },
    });
  });
