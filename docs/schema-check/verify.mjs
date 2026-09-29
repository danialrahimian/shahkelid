// Loads docs/02-schema.sql into a real PostgreSQL (PGlite) and tries every
// thing the design says the database itself refuses.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";

const schemaPath = process.argv[2];
const db = new PGlite({ extensions: { citext } });

let passed = 0;
let failed = 0;
const report = (ok, name, detail = "") => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/** Must succeed. */
const allows = async (name, fn) => {
  try {
    await fn();
    report(true, name);
  } catch (error) {
    report(false, name, `refused: ${error.message}`);
  }
};

/** Must be refused by the database. Runs in a transaction that is rolled back. */
const refuses = async (name, fn, pattern) => {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
    });
    report(false, name, "the database ACCEPTED it");
  } catch (error) {
    const ok = pattern ? pattern.test(error.message) : true;
    report(ok, name, ok ? error.message.split("\n")[0] : `wrong error: ${error.message}`);
  }
};

const one = async (sql, params) => (await db.query(sql, params)).rows[0];

// ---------------------------------------------------------------- load
await db.exec(readFileSync(schemaPath, "utf8"));
const counts = await one(`
  select
    (select count(*) from information_schema.tables where table_schema = 'public')::int as tables,
    (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typtype = 'e')::int as enums,
    (select count(*) from pg_indexes where schemaname = 'public')::int as indexes,
    (select count(*) from information_schema.table_constraints
       where table_schema = 'public' and constraint_type = 'FOREIGN KEY')::int as foreign_keys`);
console.log(`schema loaded: ${counts.tables} tables, ${counts.enums} enums, ${counts.indexes} indexes, ${counts.foreign_keys} foreign keys\n`);

// ---------------------------------------------------------------- fixtures
const user = await one(`insert into users (email, email_normalized, referral_code)
  values ('Ali@Example.com', 'ali@example.com', 'ALI001') returning id`);
const panel = await one(`insert into panels (name, driver, base_url, credentials_enc)
  values ('PG test', 'pasarguard', 'https://pg.example', '\\x00') returning id`);
const plan = await one(`insert into plans (slug, name, data_limit_bytes, duration_days, price_toman)
  values ('50gb-30d', '50GB 30 days', 53687091200, 30, 150000) returning id`);
const sub = await one(`insert into subscriptions (user_id, plan_id, panel_id, panel_username, access_token)
  values ($1, $2, $3, 'sk_0001', 'tok_0001') returning id`, [user.id, plan.id, panel.id]);
const order = await one(`insert into orders (user_id, kind, subtotal_toman, total_toman, expires_at, idempotency_key)
  values ($1, 'new', 150000, 150000, now() + interval '1 hour', 'k1') returning id, number`, [user.id]);
const revenue = await one(`insert into ledger_accounts (kind) values ('revenue') returning id`);
const gateway = await one(`insert into ledger_accounts (kind) values ('gateway_zarinpal') returning id`);
const wallet = await one(`insert into ledger_accounts (kind, user_id) values ('customer_wallet', $1) returning id`, [user.id]);

console.log("— identity");
await refuses("email is unique regardless of case", (tx) =>
  tx.query(`insert into users (email, email_normalized, referral_code) values ('ali@example.COM', 'x', 'X2')`),
  /unique/i);

console.log("\n— orders and payments");
report(Number(order.number) === 100001, "order numbers start at 100001", `got ${order.number}`);
await refuses("order total must equal subtotal minus discount", (tx) =>
  tx.query(`insert into orders (user_id, kind, subtotal_toman, discount_toman, total_toman, expires_at)
    values ($1, 'new', 100, 10, 100, now())`, [user.id]), /check/i);
await refuses("a renewal must name the subscription it renews", (tx) =>
  tx.query(`insert into orders (user_id, kind, subtotal_toman, total_toman, expires_at)
    values ($1, 'renewal', 100, 100, now())`, [user.id]), /check/i);
await refuses("a retried checkout with the same idempotency key cannot create a second order", (tx) =>
  tx.query(`insert into orders (user_id, kind, subtotal_toman, total_toman, expires_at, idempotency_key)
    values ($1, 'new', 1, 1, now(), 'k1')`, [user.id]), /unique/i);

await allows("a first successful payment settles the order", () =>
  db.query(`insert into payments (order_id, user_id, method, status, amount_toman, provider_reference, succeeded_at)
    values ($1, $2, 'zarinpal', 'succeeded', 150000, 'A000001', now())`, [order.id, user.id]));
await refuses("a second successful payment for the same order is refused", (tx) =>
  tx.query(`insert into payments (order_id, user_id, method, status, amount_toman, provider_reference, succeeded_at)
    values ($1, $2, 'card_transfer', 'succeeded', 150000, 'T-99', now())`, [order.id, user.id]), /unique/i);
await refuses("the same gateway reference cannot be recorded twice (double callback)", (tx) =>
  tx.query(`insert into payments (order_id, user_id, method, amount_toman, provider_reference)
    values ($1, $2, 'zarinpal', 150000, 'A000001')`, [order.id, user.id]), /unique/i);
await refuses("a succeeded payment must carry the time it succeeded", (tx) =>
  tx.query(`insert into payments (order_id, user_id, method, status, amount_toman)
    values ($1, $2, 'wallet', 'succeeded', 5)`, [order.id, user.id]), /check/i);

console.log("\n— crypto");
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const WALLET_ADDRESS = "TXYZwalletaddress000000000000000000";
const cryptoOrder = await one(`insert into orders (user_id, kind, subtotal_toman, total_toman, expires_at)
  values ($1, 'new', 1200000, 1200000, now() + interval '1 hour') returning id`, [user.id]);
const newTronPayment = async () =>
  one(`insert into payments (order_id, user_id, method, amount_toman)
    values ($1, $2, 'usdt_tron', 1200000) returning id`, [cryptoOrder.id, user.id]);
const openInvoice = (paymentId, units, runner = db) =>
  runner.query(`insert into crypto_invoices
      (payment_id, token_contract, amount_units, rate_toman_per_asset, exchange_rate_id, pay_address, expires_at)
    values ($1, $2, $3, 252160, $4, $5, now() + interval '30 minutes')`,
    [paymentId, USDT, units, rate.id, WALLET_ADDRESS]);

await refuses("a rate whose bid is above its ask is refused (corrupt quote)", (tx) =>
  tx.query(`insert into exchange_rates (bid_toman, ask_toman) values (260000, 250000)`), /check/i);
await refuses("a rate of zero is refused", (tx) =>
  tx.query(`insert into exchange_rates (bid_toman, ask_toman) values (0, 250000)`), /check/i);
// Nobitex quotes rial; stored as toman (2,521,600 rial = 252,160 toman).
const rate = await one(`insert into exchange_rates (bid_toman, ask_toman) values (252160, 252200) returning id`);
await refuses("a crypto invoice must name the quote it used", (tx) =>
  tx.query(`insert into crypto_invoices
      (payment_id, token_contract, amount_units, rate_toman_per_asset, pay_address, expires_at)
    values (gen_random_uuid(), $1, 1, 1, 'x', now())`, [USDT]), /null|foreign/i);

const p1 = await newTronPayment();
await allows("a TRON invoice waits for an exact amount (12.000347 USDT)", () => openInvoice(p1.id, 12000347));
const p2 = await newTronPayment();
await refuses("two open invoices cannot wait for the same amount at the same address", (tx) =>
  openInvoice(p2.id, 12000347, tx), /unique/i);
await db.query(`update crypto_invoices set closed_at = now() where payment_id = $1`, [p1.id]);
await allows("once the first invoice closes, its amount can be quoted again", () => openInvoice(p2.id, 12000347));

const transfer = (index, match = "unmatched", paymentId = null, runner = db) =>
  runner.query(`insert into crypto_transfers
      (token_contract, tx_hash, event_index, from_address, to_address, amount_units,
       block_number, block_time, confirmed, match, payment_id)
    values ($1, 'abc123', $2, 'Tsender', $3, 5000000, 1000, now(), true, $4, $5)`,
    [USDT, index, WALLET_ADDRESS, match, paymentId]);

await allows("a transfer with no matching invoice is kept for review, not dropped", () => transfer(0));
await refuses("the watcher cannot record the same transfer twice", (tx) => transfer(0, "unmatched", null, tx), /unique/i);
await allows("a second transfer inside the same transaction is its own record", () => transfer(1));
await refuses("a transfer cannot be marked matched without the payment it matched", (tx) =>
  transfer(2, "matched", null, tx), /check/i);
await allows("a transfer can be matched to its payment", () => transfer(3, "matched", p2.id));
await refuses("one payment cannot be settled by two transfers", (tx) =>
  transfer(4, "matched", p2.id, tx), /unique/i);

console.log("\n— ledger");
await allows("a balanced transaction commits and moves both balances", () =>
  db.transaction(async (tx) => {
    const t = (await tx.query(`insert into ledger_transactions (kind, idempotency_key)
      values ('wallet_topup', 'topup-1') returning id`)).rows[0];
    await tx.query(`insert into ledger_entries (transaction_id, account_id, amount_toman) values ($1, $2, -100000)`, [t.id, gateway.id]);
    await tx.query(`insert into ledger_entries (transaction_id, account_id, amount_toman) values ($1, $2, 100000)`, [t.id, wallet.id]);
  }));
const balances = await one(`select
  (select balance_toman from ledger_accounts where id = $1)::bigint as wallet,
  (select balance_toman from ledger_accounts where id = $2)::bigint as gateway`, [wallet.id, gateway.id]);
report(Number(balances.wallet) === 100000 && Number(balances.gateway) === -100000,
  "cached balances follow the entries", `wallet ${balances.wallet}, gateway ${balances.gateway}`);

await refuses("an unbalanced transaction is refused at commit", async (tx) => {
  const t = (await tx.query(`insert into ledger_transactions (kind) values ('manual_adjustment') returning id`)).rows[0];
  await tx.query(`insert into ledger_entries (transaction_id, account_id, amount_toman) values ($1, $2, 500)`, [t.id, revenue.id]);
}, /does not balance/);
await refuses("a wallet cannot be spent below zero", async (tx) => {
  const t = (await tx.query(`insert into ledger_transactions (kind) values ('wallet_purchase') returning id`)).rows[0];
  await tx.query(`insert into ledger_entries (transaction_id, account_id, amount_toman) values ($1, $2, -150000)`, [t.id, wallet.id]);
  await tx.query(`insert into ledger_entries (transaction_id, account_id, amount_toman) values ($1, $2, 150000)`, [t.id, revenue.id]);
}, /check/i);
await refuses("the same business event cannot be posted twice", (tx) =>
  tx.query(`insert into ledger_transactions (kind, idempotency_key) values ('wallet_topup', 'topup-1')`), /unique/i);
await refuses("ledger history cannot be edited", (tx) =>
  tx.query(`update ledger_entries set amount_toman = 1`), /append-only/);
await refuses("ledger history cannot be deleted", (tx) =>
  tx.query(`delete from ledger_entries`), /append-only/);
await refuses("there is exactly one revenue account", (tx) =>
  tx.query(`insert into ledger_accounts (kind) values ('revenue')`), /unique/i);
await refuses("a wallet must belong to a user", (tx) =>
  tx.query(`insert into ledger_accounts (kind) values ('customer_wallet')`), /check/i);

console.log("\n— invoices and audit");
await allows("an invoice can be issued", () =>
  db.query(`insert into invoices (order_id, user_id, subtotal_toman, discount_toman, total_toman, lines, customer_snapshot)
    values ($1, $2, 150000, 0, 150000, '[]', '{}')`, [order.id, user.id]));
await refuses("an issued invoice cannot be changed", (tx) =>
  tx.query(`update invoices set total_toman = 1`), /append-only/);
await allows("an audit entry can be written", () =>
  db.query(`insert into audit_logs (actor_kind, action, entity_type) values ('staff', 'subscription.reset_usage', 'subscription')`));
await refuses("audit entries cannot be edited", (tx) =>
  tx.query(`update audit_logs set action = 'nothing'`), /append-only/);
await refuses("audit entries cannot be deleted", (tx) =>
  tx.query(`delete from audit_logs`), /append-only/);

console.log("\n— subscriptions and plans");
await refuses("a panel username is unique on its panel (a retry finds, never duplicates)", (tx) =>
  tx.query(`insert into subscriptions (user_id, plan_id, panel_id, panel_username, access_token)
    values ($1, $2, $3, 'sk_0001', 'tok_other')`, [user.id, plan.id, panel.id]), /unique/i);
await allows("a reminder is recorded for a cycle", () =>
  db.query(`insert into subscription_alerts_sent (subscription_id, alert, cycle_key) values ($1, 'expiry_3d', '2026-10-30')`, [sub.id]));
await refuses("the same reminder cannot be sent twice in one cycle", (tx) =>
  tx.query(`insert into subscription_alerts_sent (subscription_id, alert, cycle_key) values ($1, 'expiry_3d', '2026-10-30')`, [sub.id]), /duplicate|unique/i);
await allows("after a renewal (new cycle) the same reminder can fire again", () =>
  db.query(`insert into subscription_alerts_sent (subscription_id, alert, cycle_key) values ($1, 'expiry_3d', '2026-11-29')`, [sub.id]));
await allows("one free-trial plan can be on offer", () =>
  db.query(`insert into plans (slug, name, data_limit_bytes, duration_days, price_toman, is_trial)
    values ('trial', 'Trial', 1073741824, 1, 0, true)`));
await refuses("a second active trial plan is refused", (tx) =>
  tx.query(`insert into plans (slug, name, data_limit_bytes, duration_days, price_toman, is_trial)
    values ('trial-2', 'Trial 2', 1073741824, 1, 0, true)`), /unique/i);
await refuses("a trial plan cannot have a price", (tx) =>
  tx.query(`insert into plans (slug, name, duration_days, price_toman, is_trial, is_active)
    values ('trial-3', 'Trial 3', 1, 5000, true, false)`), /check/i);

console.log("\n— support");
const ticket = await one(`insert into tickets (user_id, subject) values ($1, 'Cannot connect') returning id, number`, [user.id]);
report(Number(ticket.number) === 1001, "ticket numbers start at 1001", `got ${ticket.number}`);
await refuses("a customer's message cannot be marked internal", (tx) =>
  tx.query(`insert into ticket_messages (ticket_id, author_kind, body, is_internal)
    values ($1, 'customer', 'hi', true)`, [ticket.id]), /check/i);

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
process.exitCode = failed === 0 ? 0 : 1;
