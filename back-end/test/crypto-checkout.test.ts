import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import config from "../src/config";
import {
  handleNowPaymentsIpn,
  ipnSignature,
  setNowPayments,
  type NowPayment,
  type NowPaymentsApi,
} from "../src/modules/billing/nowpayments";
import { refreshRate, setRateFetcher } from "../src/modules/billing/rates";
import { cryptoInvoices, cryptoTransfers, exchangeRates, orders, payments } from "../src/modules/billing/schema";
import { setTronSource, TronGrid, type IncomingTransfer, type TronSource } from "../src/modules/billing/tron";
import { baseUnits, expireUsdtInvoices, scanUsdt } from "../src/modules/billing/usdt-checkout";
import { balanceOf } from "../src/modules/ledger/ledger";
import { outboxEvents } from "../src/platform/db/platform-schema";
import { createClient } from "./helpers/api-client";
import { captureEmails, closeDatabase, database, signedInCustomer, signedInStaff } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { aStore, installFakePanels, owner, type Store } from "./helpers/store";
import { getBaseUrl, startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * Paying in crypto: the USDT rate, direct USDT on TRON (matched by exact
 * amount), NOWPayments, and the review queue for money that matches nothing.
 *
 * TronGrid, Nobitex and NOWPayments are fakes here; the real TRON path is
 * exercised on the Nile testnet by test/m5-acceptance.contract.test.ts.
 */

const SHOP = "/api/v1/shop";
const STAFF = "/api/v1/staff";
const WALLET = "TGBCcHD7f7eeVpzpy6rE9FcgAgg4CWugVT";
const USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const FAKE_USDT = "TFakeTokenNamedUSDTxxxxxxxxxxxxxxx";
const RATE = 100_000; // toman per USDT: 150,000 toman is 1.50 USDT

/** Transfers "on the chain", as TronGrid would list them. */
class FakeChain implements TronSource {
  transfers: IncomingTransfer[] = [];
  async incoming() {
    return this.transfers;
  }
  async blockNumberOf() {
    return 123;
  }
  send(units: number, { contract = USDT, at = new Date(), from = "TSenderxxxxxxxxxxxxxxxxxxxxxxxxxx" } = {}) {
    const transfer = {
      txHash: randomBytes(32).toString("hex"),
      eventIndex: 0,
      from,
      to: WALLET,
      tokenContract: contract,
      units,
      blockTime: at,
    };
    this.transfers.push(transfer);
    return transfer;
  }
}

/** Invoice and payment ids are unique across the whole run, as NOWPayments' are. */
let nowPaymentsIds = 4_000_000;

class FakeNowPayments implements NowPaymentsApi {
  invoices = new Map<string, { orderId: string; priceUsd: string }>();
  payments = new Map<string, NowPayment>();
  async createInvoice(input: { priceUsd: string; orderId: string }) {
    const id = String(nowPaymentsIds++);
    this.invoices.set(id, input);
    return { id, invoiceUrl: `https://nowpayments.test/invoice/?iid=${id}` };
  }
  async getPayment(paymentId: string) {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error("no such payment");
    return payment;
  }
  /** The customer pays (or half pays) at NOWPayments. */
  pay(invoiceId: string, status: NowPayment["payment_status"]) {
    const invoice = this.invoices.get(invoiceId)!;
    const paymentId = String(nowPaymentsIds++);
    this.payments.set(paymentId, {
      payment_id: paymentId,
      invoice_id: invoiceId,
      order_id: invoice.orderId,
      payment_status: status,
      price_amount: Number(invoice.priceUsd),
      price_currency: "usd",
      pay_currency: "usdttrc20",
    });
    return paymentId;
  }
}

let emails: ReturnType<typeof captureEmails>;
let chain: FakeChain;
let now: FakeNowPayments;
const savedCrypto = { ...config.crypto };

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  emails = captureEmails();
  installFakePanels();
  Object.assign(config.crypto, {
    tronAddress: WALLET,
    usdtContract: USDT,
    nowpaymentsApiKey: "test-key",
    nowpaymentsIpnSecret: "test-ipn-secret",
  });
  setRateFetcher(async () => ({ bidToman: RATE, askToman: RATE + 50 }));
});

beforeEach(async () => {
  chain = new FakeChain();
  setTronSource(chain);
  now = new FakeNowPayments();
  setNowPayments(now);
  await refreshRate(database());
});

after(async () => {
  Object.assign(config.crypto, savedCrypto);
  setRateFetcher(null);
  setTronSource(null);
  setNowPayments(null);
  emails.stop();
  await closeDatabase();
  await stopTestServer();
});

// ----------------------------------------------------------------- arrange

type Buyer = Awaited<ReturnType<typeof signedInCustomer>>;

const anOrder = async (buyer: Buyer, store: Store) => {
  const response = await buyer.client.post(`${SHOP}/orders`, { planId: store.planId }, { headers: { "idempotency-key": randomUUID() } });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data as { id: string };
};

const payWithUsdt = async (buyer: Buyer, store: Store) => {
  const order = await anOrder(buyer, store);
  const response = await buyer.client.post(`${SHOP}/orders/${order.id}/pay/usdt`);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return { order, quote: response.data.payment.crypto as { amountUnits: number; amount: string; address: string; expiresAt: string } };
};

const orderStatus = async (id: string) => (await database().select().from(orders).where(eq(orders.id, id)))[0]!.status;

const transferRow = async (txHash: string) =>
  (await database().select().from(cryptoTransfers).where(eq(cryptoTransfers.txHash, txHash)))[0];

const signedIpn = (body: Record<string, unknown>) =>
  fetch(`${getBaseUrl()}/api/v1/payments/nowpayments/ipn`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nowpayments-sig": ipnSignature(body, "test-ipn-secret") },
    body: JSON.stringify(body),
  });

// ------------------------------------------------------------------- rate

describe("The USDT rate", () => {
  it("When Nobitex quotes in rial, then the rate is stored in toman", async () => {
    setRateFetcher(null);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: "ok", stats: { "usdt-rls": { bestBuy: "2576000", bestSell: "2576960", isClosed: false } } }))) as typeof fetch;
    try {
      const row = await refreshRate(database());
      assert.equal(row.bidToman, 257_600);
      assert.equal(row.askToman, 257_696);
    } finally {
      globalThis.fetch = realFetch;
      setRateFetcher(async () => ({ bidToman: RATE, askToman: RATE + 50 }));
    }
  });

  it("When the rate is nonsense (buying above selling), then it is refused", async () => {
    setRateFetcher(async () => ({ bidToman: 200, askToman: 100 }));
    try {
      await assert.rejects(refreshRate(database()), /broken rate/);
    } finally {
      setRateFetcher(async () => ({ bidToman: RATE, askToman: RATE + 50 }));
    }
  });

  it("[acceptance] When the rate goes stale, then crypto disappears from checkout and cannot be started", async () => {
    const withRate = await createClient().get(`${SHOP}/payment-methods`);
    assert.deepEqual(
      withRate.data.map((m: { method: string }) => m.method).sort(),
      ["nowpayments", "usdt_tron", "zarinpal"],
    );

    await database().update(exchangeRates).set({ fetchedAt: new Date(Date.now() - 60 * 60_000) });

    const stale = await createClient().get(`${SHOP}/payment-methods`);
    assert.deepEqual(stale.data.map((m: { method: string }) => m.method), ["zarinpal"]);
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, await aStore());
    const refused = await buyer.client.post(`${SHOP}/orders/${order.id}/pay/usdt`);
    assert.equal(refused.status, 503);
    assert.equal(refused.data.error.code, "RATE_UNAVAILABLE");
  });
});

// ------------------------------------------------------------- USDT direct

describe("Paying USDT on TRON", () => {
  it("When a quote is made, then it is the price in USDT rounded up to the cent, plus a unique tail", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);

    const first = await payWithUsdt(buyer, store);
    const second = await payWithUsdt(buyer, store);

    const base = baseUnits(150_000, RATE);
    assert.equal(base, 1_500_000);
    for (const { quote } of [first, second]) {
      assert.ok(quote.amountUnits > base && quote.amountUnits < base + 10_000);
      assert.equal(quote.address, WALLET);
    }
    assert.notEqual(first.quote.amountUnits, second.quote.amountUnits, "two open quotes never share an amount");
  });

  it("[acceptance] When the exact amount arrives, then the order is paid, recorded and fulfilled", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const { order, quote } = await payWithUsdt(buyer, store);
    const gatewayBefore = await balanceOf(database(), "gateway_usdt_tron");

    const transfer = chain.send(quote.amountUnits);
    await scanUsdt(database());

    assert.equal(await orderStatus(order.id), "fulfilled");
    assert.equal((await transferRow(transfer.txHash))!.match, "matched");
    assert.equal((await balanceOf(database(), "gateway_usdt_tron")) - gatewayBefore, -150_000);
    const view = (await buyer.client.get(`${SHOP}/orders/${order.id}`)).data;
    assert.equal(view.payment.refId, transfer.txHash);
  });

  it("[acceptance] When a wrong amount arrives, then it waits in the review queue and staff are told", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const { order, quote } = await payWithUsdt(buyer, store);

    const transfer = chain.send(quote.amountUnits - 1);
    await scanUsdt(database());

    assert.equal(await orderStatus(order.id), "pending");
    const row = await transferRow(transfer.txHash);
    assert.equal(row!.match, "unmatched");
    const alerts = await database()
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.topic, "admin.alert"), eq(outboxEvents.aggregateId, row!.id)));
    assert.equal(alerts.length, 1);

    const accountant = await signedInStaff(["accountant"]);
    const queue = await accountant.client.get(`${STAFF}/crypto-transfers`);
    assert.ok(queue.data.some((entry: { txHash: string }) => entry.txHash === transfer.txHash));
    const refunded = await accountant.client.post(`${STAFF}/crypto-transfers/${row!.id}/review`, {
      decision: "refunded",
      note: "به آدرس فرستنده برگردانده شد",
    });
    assert.equal(refunded.data.match, "refunded");
  });

  it("[acceptance] When a token named USDT from another contract arrives, then it is ignored entirely", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const { order, quote } = await payWithUsdt(buyer, store);

    const fake = chain.send(quote.amountUnits, { contract: FAKE_USDT });
    await scanUsdt(database());

    assert.equal(await orderStatus(order.id), "pending");
    assert.equal(await transferRow(fake.txHash), undefined, "not even recorded");
  });

  it("When TronGrid lists a fake token named USDT, then the TronGrid reader drops it too", async () => {
    const realFetch = globalThis.fetch;
    const rows = [
      { transaction_id: "a".repeat(64), token_info: { address: USDT, symbol: "USDT", decimals: 6 }, block_timestamp: Date.now(), from: "TFrom", to: WALLET, type: "Transfer", value: "1500123" },
      { transaction_id: "b".repeat(64), token_info: { address: FAKE_USDT, symbol: "USDT", decimals: 6 }, block_timestamp: Date.now(), from: "TFrom", to: WALLET, type: "Transfer", value: "1500123" },
    ];
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: rows, meta: {} }))) as typeof fetch;
    try {
      const found = await new TronGrid("https://nile.test", "").incoming(WALLET, USDT, new Date(0));
      assert.deepEqual(found.map((t) => t.txHash), ["a".repeat(64)]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("When the same transfer is seen on every scan, then it is recorded and settled once", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const { quote } = await payWithUsdt(buyer, store);
    const transfer = chain.send(quote.amountUnits);

    await scanUsdt(database());
    await scanUsdt(database());

    const rows = await database().select().from(cryptoTransfers).where(eq(cryptoTransfers.txHash, transfer.txHash));
    assert.equal(rows.length, 1);
  });

  it("When the transfer was made in time but the scan ran after the quote closed, then it still counts", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const { order, quote } = await payWithUsdt(buyer, store);
    // Sent just before the quote expired...
    chain.send(quote.amountUnits, { at: new Date(Date.parse(quote.expiresAt) - 1000) });
    // ...and the quote closed before the watcher saw it.
    await database()
      .update(cryptoInvoices)
      .set({ expiresAt: new Date(Date.now() - 500) })
      .where(eq(cryptoInvoices.amountUnits, quote.amountUnits));
    chain.transfers[0]!.blockTime = new Date(Date.now() - 1000);
    await expireUsdtInvoices(database());

    await scanUsdt(database());

    assert.equal(await orderStatus(order.id), "fulfilled");
  });

  it("When the exact amount arrives after the quote expired, then it waits as late, and staff can settle that order", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const { order, quote } = await payWithUsdt(buyer, store);
    await database()
      .update(cryptoInvoices)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(cryptoInvoices.amountUnits, quote.amountUnits));
    await expireUsdtInvoices(database());

    const transfer = chain.send(quote.amountUnits);
    await scanUsdt(database());

    const row = await transferRow(transfer.txHash);
    assert.equal(row!.match, "late");
    const staff = await owner();
    const [late] = (await staff.client.get(`${STAFF}/crypto-transfers`)).data.filter((t: { id: string }) => t.id === row!.id);
    assert.equal(late.suspected.orderId, order.id);

    const settled = await staff.client.post(`${STAFF}/crypto-transfers/${row!.id}/review`, { decision: "settle" });
    assert.equal(settled.status, 200, JSON.stringify(settled.data));
    assert.equal(settled.data.match, "matched");
    assert.equal(await orderStatus(order.id), "fulfilled");

    const twice = await staff.client.post(`${STAFF}/crypto-transfers/${row!.id}/review`, { decision: "ignored" });
    assert.equal(twice.status, 409);
  });
});

// ------------------------------------------------------------- NOWPayments

describe("Paying with NOWPayments", () => {
  it("When the customer starts, then they are sent to a NOWPayments invoice priced in USD from the rate", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);

    const started = await buyer.client.post(`${SHOP}/orders/${order.id}/pay/nowpayments`);

    assert.equal(started.status, 200, JSON.stringify(started.data));
    assert.match(started.data.payUrl, /^https:\/\/nowpayments\.test\/invoice/);
    const [invoice] = [...now.invoices.values()];
    assert.equal(invoice!.priceUsd, "1.500000");
  });

  it("When NOWPayments reports the payment finished, then the order is fulfilled", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await buyer.client.post(`${SHOP}/orders/${order.id}/pay/nowpayments`);
    const [invoiceId, invoice] = [...now.invoices.entries()][0]!;
    const paymentId = now.pay(invoiceId, "finished");

    const response = await signedIpn({ payment_id: paymentId, order_id: invoice.orderId, payment_status: "finished" });

    assert.equal(response.status, 200);
    assert.equal(await orderStatus(order.id), "fulfilled");
  });

  it("When an IPN's signature is wrong, then it is refused and nothing happens", async () => {
    const response = await fetch(`${getBaseUrl()}/api/v1/payments/nowpayments/ipn`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nowpayments-sig": "00".repeat(64) },
      body: JSON.stringify({ payment_id: "1", order_id: randomUUID(), payment_status: "finished" }),
    });
    assert.equal(response.status, 401);
  });

  it("When a correctly signed IPN says finished but NOWPayments' own record says waiting, then nothing is settled", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await buyer.client.post(`${SHOP}/orders/${order.id}/pay/nowpayments`);
    const [invoiceId, invoice] = [...now.invoices.entries()][0]!;
    const paymentId = now.pay(invoiceId, "waiting");

    await signedIpn({ payment_id: paymentId, order_id: invoice.orderId, payment_status: "finished" });

    assert.equal(await orderStatus(order.id), "pending");
  });

  it("When the customer pays only part, then the payment fails and staff are told", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await buyer.client.post(`${SHOP}/orders/${order.id}/pay/nowpayments`);
    const [invoiceId, invoice] = [...now.invoices.entries()][0]!;
    const paymentId = now.pay(invoiceId, "partially_paid");

    const outcome = await handleNowPaymentsIpn(database(), { payment_id: paymentId, order_id: invoice.orderId });

    assert.equal(outcome, "partial");
    const [payment] = await database().select().from(payments).where(eq(payments.id, invoice.orderId));
    assert.equal(payment!.failureReason, "partially_paid");
  });
});
