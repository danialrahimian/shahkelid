import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { Pool, PoolClient } from "pg";

import {
  backendPid,
  createTestPool,
  resetTestDatabase,
  waitUntilBlocked,
} from "./helpers/postgres";

/**
 * What the database itself refuses, whatever the application code does.
 *
 * Stage 2 designed these rules and tested them on PGlite. These tests run them
 * again on real PostgreSQL through the real migrations, so they also prove the
 * migrations built what was approved. The two concurrency tests at the end
 * could not run on PGlite at all: it has one connection, and "two purchases
 * at the same instant" needs two.
 */

let pool: Pool;

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await pool.query(sql, params)).rows[0] as T;

/** Must be refused. The work runs in a transaction that never commits. */
const refused = async (work: (client: PoolClient) => Promise<unknown>, pattern: RegExp) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    let accepted = false;
    try {
      await work(client);
      // Deferred checks (the ledger balance) only fire here.
      await client.query("commit");
      accepted = true;
    } catch (error) {
      assert.match((error as Error).message, pattern);
    }
    assert.equal(accepted, false, "the database accepted it");
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
};

/**
 * The eventual error of work started now, captured immediately.
 *
 * In a race test the losing transaction's error can reach this process
 * before the winner's COMMIT does. A promise that rejects before anything is
 * listening counts as an unhandled rejection, which failed the test at
 * random depending on which reply arrived first. Attaching the handler at
 * the moment the work starts removes that window.
 */
const outcomeOf = (work: Promise<unknown>): Promise<Error | null> =>
  work.then(
    () => null,
    (error: unknown) => error as Error,
  );

const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const WALLET = "TXYZwalletaddress000000000000000000";

const fixtures = {} as Record<
  "user" | "panel" | "plan" | "sub" | "order" | "revenue" | "gateway" | "wallet" | "rate",
  string
>;

before(async () => {
  await resetTestDatabase();
  pool = createTestPool();

  const id = async (sql: string, params: unknown[] = []) =>
    (await one<{ id: string }>(sql, params)).id;

  fixtures.user = await id(`insert into users (email, email_normalized, referral_code)
    values ('Ali@Example.com', 'ali@example.com', 'ALI001') returning id`);
  fixtures.panel = await id(`insert into panels (name, driver, base_url, credentials_enc)
    values ('test panel', 'pasarguard', 'https://pg.example', '\\x00') returning id`);
  fixtures.plan = await id(`insert into plans (slug, name, data_limit_bytes, duration_days, price_toman)
    values ('50gb-30d', '50 GB, 30 days', 53687091200, 30, 150000) returning id`);
  fixtures.sub = await id(
    `insert into subscriptions (user_id, plan_id, panel_id, panel_username, access_token)
     values ($1, $2, $3, 'sk_0001', 'tok_0001') returning id`,
    [fixtures.user, fixtures.plan, fixtures.panel],
  );
  fixtures.order = await id(
    `insert into orders (user_id, kind, subtotal_toman, total_toman, expires_at, idempotency_key)
     values ($1, 'new', 150000, 150000, now() + interval '1 hour', 'k1') returning id`,
    [fixtures.user],
  );
  fixtures.revenue = await id(`insert into ledger_accounts (kind) values ('revenue') returning id`);
  fixtures.gateway = await id(
    `insert into ledger_accounts (kind) values ('gateway_zarinpal') returning id`,
  );
  fixtures.wallet = await id(
    `insert into ledger_accounts (kind, user_id) values ('customer_wallet', $1) returning id`,
    [fixtures.user],
  );
  fixtures.rate = String(
    (await one<{ id: number }>(
      `insert into exchange_rates (bid_toman, ask_toman) values (252160, 252200) returning id`,
    )).id,
  );
});

after(async () => {
  await pool?.end();
});

/** Posts one ledger transaction of the given entries, in one database transaction. */
const post = async (client: PoolClient, entries: [account: string, amount: number][]) => {
  const tx = (
    await client.query<{ id: string }>(
      `insert into ledger_transactions (kind) values ('manual_adjustment') returning id`,
    )
  ).rows[0]!;
  for (const [account, amount] of entries) {
    await client.query(
      `insert into ledger_entries (transaction_id, account_id, amount_toman) values ($1, $2, $3)`,
      [tx.id, account, amount],
    );
  }
};

const balanceOf = async (account: string) =>
  Number((await one<{ b: string }>(`select balance_toman as b from ledger_accounts where id = $1`, [account])).b);

describe("Accounts", () => {
  it("When an email differs only in case, then it is the same account", async () => {
    await refused(
      (c) =>
        c.query(`insert into users (email, email_normalized, referral_code)
                 values ('ali@example.COM', 'x', 'X2')`),
      /unique/i,
    );
  });
});

describe("Orders and payments", () => {
  it("When the first order is placed, then its number is 100001", async () => {
    const { number } = await one<{ number: string }>(`select number from orders where id = $1`, [
      fixtures.order,
    ]);
    assert.equal(Number(number), 100001);
  });

  it("When an order's total does not equal subtotal minus discount, then it is refused", async () => {
    await refused(
      (c) =>
        c.query(
          `insert into orders (user_id, kind, subtotal_toman, discount_toman, total_toman, expires_at)
           values ($1, 'new', 100, 10, 100, now())`,
          [fixtures.user],
        ),
      /orders_total_adds_up/,
    );
  });

  it("When a renewal names no subscription, then it is refused", async () => {
    await refused(
      (c) =>
        c.query(
          `insert into orders (user_id, kind, subtotal_toman, total_toman, expires_at)
           values ($1, 'renewal', 100, 100, now())`,
          [fixtures.user],
        ),
      /orders_target_subscription/,
    );
  });

  it("When a checkout is retried with the same idempotency key, then no second order is made", async () => {
    await refused(
      (c) =>
        c.query(
          `insert into orders (user_id, kind, subtotal_toman, total_toman, expires_at, idempotency_key)
           values ($1, 'new', 1, 1, now(), 'k1')`,
          [fixtures.user],
        ),
      /unique/i,
    );
  });

  it("When an order is paid, then a second successful payment for it is refused", async () => {
    await pool.query(
      `insert into payments (order_id, user_id, method, status, amount_toman, provider_reference, succeeded_at)
       values ($1, $2, 'zarinpal', 'succeeded', 150000, 'A000001', now())`,
      [fixtures.order, fixtures.user],
    );
    await refused(
      (c) =>
        c.query(
          `insert into payments (order_id, user_id, method, status, amount_toman, provider_reference, succeeded_at)
           values ($1, $2, 'card_transfer', 'succeeded', 150000, 'T-99', now())`,
          [fixtures.order, fixtures.user],
        ),
      /payments_one_success_idx/,
    );
  });

  it("When a gateway calls back twice with the same reference, then it is recorded once", async () => {
    await refused(
      (c) =>
        c.query(
          `insert into payments (order_id, user_id, method, amount_toman, provider_reference)
           values ($1, $2, 'zarinpal', 150000, 'A000001')`,
          [fixtures.order, fixtures.user],
        ),
      /payments_provider_ref_idx/,
    );
  });

  it("When a payment is marked succeeded, then it must say when", async () => {
    await refused(
      (c) =>
        c.query(
          `insert into payments (order_id, user_id, method, status, amount_toman)
           values ($1, $2, 'wallet', 'succeeded', 5)`,
          [fixtures.order, fixtures.user],
        ),
      /payments_success_is_timestamped/,
    );
  });
});

describe("Crypto", () => {
  const tronPayment = async () =>
    (
      await one<{ id: string }>(
        `insert into payments (order_id, user_id, method, amount_toman)
         values ($1, $2, 'usdt_tron', 1200000) returning id`,
        [fixtures.order, fixtures.user],
      )
    ).id;

  const invoice = (runner: Pool | PoolClient, paymentId: string, units: number) =>
    runner.query(
      `insert into crypto_invoices
         (payment_id, token_contract, amount_units, rate_toman_per_asset, exchange_rate_id, pay_address, expires_at)
       values ($1, $2, $3, 252160, $4, $5, now() + interval '30 minutes')`,
      [paymentId, USDT, units, fixtures.rate, WALLET],
    );

  it("When a rate's bid is above its ask, then it is refused as corrupt", async () => {
    await refused(
      (c) => c.query(`insert into exchange_rates (bid_toman, ask_toman) values (260000, 250000)`),
      /exchange_rates_bid_not_above_ask/,
    );
  });

  it("When a crypto invoice names no rate, then it is refused", async () => {
    await refused(
      (c) =>
        c.query(
          `insert into crypto_invoices (payment_id, token_contract, amount_units, rate_toman_per_asset, pay_address, expires_at)
           values (uuidv7(), $1, 1, 1, 'x', now())`,
          [USDT],
        ),
      /exchange_rate_id/,
    );
  });

  it("When two open TRON invoices would wait for the same amount, then the second is refused", async () => {
    const first = await tronPayment();
    await invoice(pool, first, 12000347);
    const second = await tronPayment();
    await refused((c) => invoice(c, second, 12000347), /crypto_invoices_open_amount_idx/);

    // Once the first closes, its amount can be quoted again.
    await pool.query(`update crypto_invoices set closed_at = now() where payment_id = $1`, [first]);
    await invoice(pool, second, 12000347);
  });

  const transfer = (runner: Pool | PoolClient, index: number, match = "unmatched", paymentId: string | null = null) =>
    runner.query(
      `insert into crypto_transfers
         (token_contract, tx_hash, event_index, from_address, to_address, amount_units,
          block_number, block_time, confirmed, match, payment_id)
       values ($1, 'abc123', $2, 'Tsender', $3, 5000000, 1000, now(), true, $4, $5)`,
      [USDT, index, WALLET, match, paymentId],
    );

  it("When a transfer matches no invoice, then it is kept for review, and recorded only once", async () => {
    await transfer(pool, 0);
    await refused((c) => transfer(c, 0), /crypto_transfers_network_tx_hash_event_index_key/);
    // a second transfer inside the same transaction is its own record
    await transfer(pool, 1);
  });

  it("When a transfer is marked matched, then it must name the payment", async () => {
    await refused((c) => transfer(c, 2, "matched", null), /crypto_transfers_matched_has_payment/);
  });

  it("When a payment is settled by a transfer, then no second transfer can settle it", async () => {
    const payment = await tronPayment();
    await transfer(pool, 3, "matched", payment);
    await refused((c) => transfer(c, 4, "matched", payment), /unique/i);
  });
});

describe("Ledger", () => {
  it("When a balanced transaction commits, then both balances move", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await post(client, [
        [fixtures.gateway, -100000],
        [fixtures.wallet, 100000],
      ]);
      await client.query("commit");
    } finally {
      client.release();
    }
    assert.equal(await balanceOf(fixtures.wallet), 100000);
    assert.equal(await balanceOf(fixtures.gateway), -100000);
  });

  it("When a transaction does not balance, then it is refused at commit", async () => {
    await refused((c) => post(c, [[fixtures.revenue, 500]]), /does not balance/);
  });

  it("When a wallet would go below zero, then it is refused", async () => {
    await refused(
      (c) =>
        post(c, [
          [fixtures.wallet, -150000],
          [fixtures.revenue, 150000],
        ]),
      /ledger_accounts_user_balance_not_negative/,
    );
  });

  it("When the same business event is posted twice, then the second is refused", async () => {
    await pool.query(`insert into ledger_transactions (kind, idempotency_key) values ('wallet_topup', 'topup-1')`);
    await refused(
      (c) => c.query(`insert into ledger_transactions (kind, idempotency_key) values ('wallet_topup', 'topup-1')`),
      /unique/i,
    );
  });

  it("When ledger history is edited or deleted, then it is refused", async () => {
    await refused((c) => c.query(`update ledger_entries set amount_toman = 1`), /append-only/);
    await refused((c) => c.query(`delete from ledger_entries`), /append-only/);
  });

  it("When a second revenue account is created, then it is refused", async () => {
    await refused((c) => c.query(`insert into ledger_accounts (kind) values ('revenue')`), /unique/i);
  });

  it("When a wallet has no owner, then it is refused", async () => {
    await refused(
      (c) => c.query(`insert into ledger_accounts (kind) values ('customer_wallet')`),
      /ledger_accounts_owner/,
    );
  });
});

describe("Invoices and audit", () => {
  it("When an invoice is issued, then it can never be changed", async () => {
    await pool.query(
      `insert into invoices (order_id, user_id, subtotal_toman, discount_toman, total_toman, lines, customer_snapshot)
       values ($1, $2, 150000, 0, 150000, '[]', '{}')`,
      [fixtures.order, fixtures.user],
    );
    await refused((c) => c.query(`update invoices set total_toman = 1`), /append-only/);
  });

  it("When an audit entry is written, then it can never be edited or deleted", async () => {
    await pool.query(
      `insert into audit_logs (actor_kind, action, entity_type) values ('staff', 'subscription.reset_usage', 'subscription')`,
    );
    await refused((c) => c.query(`update audit_logs set action = 'nothing'`), /append-only/);
    await refused((c) => c.query(`delete from audit_logs`), /append-only/);
  });
});

describe("Subscriptions and plans", () => {
  it("When a retry creates the same panel user again, then it is refused, not duplicated", async () => {
    await refused(
      (c) =>
        c.query(
          `insert into subscriptions (user_id, plan_id, panel_id, panel_username, access_token)
           values ($1, $2, $3, 'sk_0001', 'tok_other')`,
          [fixtures.user, fixtures.plan, fixtures.panel],
        ),
      /subscriptions_panel_username_key/,
    );
  });

  it("When a reminder was sent this cycle, then it cannot be sent again until the next", async () => {
    const send = (runner: Pool | PoolClient, cycle: string) =>
      runner.query(
        `insert into subscription_alerts_sent (subscription_id, alert, cycle_key) values ($1, 'expiry_3d', $2)`,
        [fixtures.sub, cycle],
      );
    await send(pool, "2026-10-30");
    await refused((c) => send(c, "2026-10-30"), /duplicate key/);
    await send(pool, "2026-11-29"); // renewed: a new cycle
  });

  it("When a second free trial plan is offered, then it is refused; a trial cannot have a price", async () => {
    await pool.query(`insert into plans (slug, name, data_limit_bytes, duration_days, price_toman, is_trial)
                      values ('trial', 'Trial', 1073741824, 1, 0, true)`);
    await refused(
      (c) =>
        c.query(`insert into plans (slug, name, data_limit_bytes, duration_days, price_toman, is_trial)
                 values ('trial-2', 'Trial 2', 1073741824, 1, 0, true)`),
      /plans_single_trial_idx/,
    );
    await refused(
      (c) =>
        c.query(`insert into plans (slug, name, duration_days, price_toman, is_trial, is_active)
                 values ('trial-3', 'Trial 3', 1, 5000, true, false)`),
      /plans_trial_is_free/,
    );
  });
});

describe("Support", () => {
  it("When the first ticket is opened, then its number is 1001; a customer cannot write an internal note", async () => {
    const ticket = await one<{ id: string; number: string }>(
      `insert into tickets (user_id, subject) values ($1, 'Cannot connect') returning id, number`,
      [fixtures.user],
    );
    assert.equal(Number(ticket.number), 1001);
    await refused(
      (c) =>
        c.query(
          `insert into ticket_messages (ticket_id, author_kind, body, is_internal) values ($1, 'customer', 'hi', true)`,
          [ticket.id],
        ),
      /ticket_messages_internal_is_staff/,
    );
  });
});

describe("Two things at the same instant", () => {
  it("When two purchases spend the same wallet at once, then only one of them goes through", async () => {
    // A fresh wallet holding exactly 100,000 toman.
    const user = (
      await one<{ id: string }>(`insert into users (email, email_normalized, referral_code)
        values ('race@example.com', 'race@example.com', 'RACE01') returning id`)
    ).id;
    const wallet = (
      await one<{ id: string }>(
        `insert into ledger_accounts (kind, user_id) values ('customer_wallet', $1) returning id`,
        [user],
      )
    ).id;
    const topUp = await pool.connect();
    await topUp.query("begin");
    await post(topUp, [
      [fixtures.gateway, -100000],
      [wallet, 100000],
    ]);
    await topUp.query("commit");
    topUp.release();

    const first = await pool.connect();
    const second = await pool.connect();
    const secondPid = await backendPid(second);
    try {
      // Each tries to spend 80,000 of the same 100,000.
      await first.query("begin");
      await post(first, [
        [wallet, -80000],
        [fixtures.revenue, 80000],
      ]);

      await second.query("begin");
      const secondSpend = outcomeOf(
        post(second, [
          [wallet, -80000],
          [fixtures.revenue, 80000],
        ]).then(() => second.query("commit")),
      );

      // The second is genuinely waiting on the first's lock, not just late.
      await waitUntilBlocked(pool, secondPid);
      await first.query("commit");

      const error = await secondSpend;
      assert.match(error?.message ?? "the second spend went through", /ledger_accounts_user_balance_not_negative/);
      await second.query("rollback");
    } finally {
      first.release();
      second.release();
    }

    assert.equal(await balanceOf(wallet), 20000);
  });

  it("When two payments for one order succeed at once, then only one of them counts", async () => {
    const order = (
      await one<{ id: string }>(
        `insert into orders (user_id, kind, subtotal_toman, total_toman, expires_at)
         values ($1, 'new', 150000, 150000, now() + interval '1 hour') returning id`,
        [fixtures.user],
      )
    ).id;
    const succeed = (client: PoolClient, reference: string) =>
      client.query(
        `insert into payments (order_id, user_id, method, status, amount_toman, provider_reference, succeeded_at)
         values ($1, $2, 'zarinpal', 'succeeded', 150000, $3, now())`,
        [order, fixtures.user, reference],
      );

    const first = await pool.connect();
    const second = await pool.connect();
    const secondPid = await backendPid(second);
    try {
      await first.query("begin");
      await succeed(first, "RACE-A");

      await second.query("begin");
      const secondSuccess = outcomeOf(succeed(second, "RACE-B"));

      await waitUntilBlocked(pool, secondPid);
      await first.query("commit");

      const error = await secondSuccess;
      assert.match(error?.message ?? "the second payment counted", /payments_one_success_idx/);
      await second.query("rollback");
    } finally {
      first.release();
      second.release();
    }

    const { count } = await one<{ count: string }>(
      `select count(*) from payments where order_id = $1 and status = 'succeeded'`,
      [order],
    );
    assert.equal(Number(count), 1);
  });
});
