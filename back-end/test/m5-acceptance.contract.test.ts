import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";
import { TronWeb } from "tronweb";

import config from "../src/config";
import { refreshRate } from "../src/modules/billing/rates";
import { cryptoTransfers, orders } from "../src/modules/billing/schema";
import { setTronSource } from "../src/modules/billing/tron";
import { scanUsdt } from "../src/modules/billing/usdt-checkout";
import { captureEmails, closeDatabase, database, signedInCustomer, signedInStaff } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { installFakePanels } from "./helpers/store";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * M5's acceptance on the TRON Nile testnet, with real transfers:
 *
 *   an order quoted in USDT at Nobitex's live rate → the exact amount is sent
 *   from a test wallet → TronGrid reports it confirmed → the order is paid and
 *   fulfilled; a wrong amount lands in the review queue instead.
 *
 *   npm run test:contract
 *
 * Needs the Nile wallets in .env (TRON_TEST_*) and test TRX and USDT on the
 * sender, from https://nileex.io. Skipped, with the reason, when they are not
 * there. The panel is a fake here: delivery to a real panel is M3's and M4's
 * acceptance; this one is about the money.
 */

const NILE = "https://nile.trongrid.io";
const NILE_USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const receiver = process.env.TRON_TEST_RECEIVER_ADDRESS;
const senderKey = process.env.TRON_TEST_SENDER_KEY;
const sender = process.env.TRON_TEST_SENDER_ADDRESS;
const configured = process.env.PASARGUARD_CONTRACT === "1" && receiver && senderKey && sender;

const tron = configured ? new TronWeb({ fullHost: NILE, privateKey: senderKey! }) : undefined;

const fundsOnSender = async () => {
  if (!tron) return { trx: 0, usdt: 0 };
  const contract = await tron.contract().at(NILE_USDT);
  const [trx, usdt] = await Promise.all([tron.trx.getBalance(sender!), contract.balanceOf(sender!).call()]);
  return { trx: trx / 1e6, usdt: Number(usdt) / 1e6 };
};

/** Sends `units` of Nile USDT from the test sender to our wallet; returns the transaction id. */
const send = async (units: number) => {
  const contract = await tron!.contract().at(NILE_USDT);
  return contract.transfer(receiver!, units).send({ feeLimit: 100_000_000 }) as Promise<string>;
};

/** Scans until `done` holds, as the worker would every 20 seconds (a Nile transfer solidifies in about a minute). */
const scanUntil = async (done: () => Promise<boolean>, timeoutMs = 4 * 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await scanUsdt(database());
    if (await done()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return false;
};

describe("M5 acceptance on the TRON Nile testnet", { skip: !configured && "run with npm run test:contract and the Nile wallets in .env" }, () => {
  const saved = { ...config.crypto };
  let emails: ReturnType<typeof captureEmails>;

  before(async () => {
    await resetTestDatabase();
    await startTestServer();
    emails = captureEmails();
    installFakePanels();
    Object.assign(config.crypto, { tronAddress: receiver, tronGridUrl: NILE, usdtContract: NILE_USDT });
    setTronSource(null); // the real TronGrid, on Nile
    await refreshRate(database()); // the real Nobitex rate
  });

  after(async () => {
    Object.assign(config.crypto, saved);
    emails.stop();
    await closeDatabase();
    await stopTestServer();
  });

  it("[acceptance] The exact amount on Nile pays the order; a wrong amount waits for review", { timeout: 10 * 60_000 }, async (t) => {
    const funds = await fundsOnSender();
    if (funds.trx < 60 || funds.usdt < 1) {
      t.skip(`fund the Nile sender ${sender} with test TRX and USDT at https://nileex.io (it has ${funds.trx} TRX, ${funds.usdt} USDT)`);
      return;
    }
    const staff = await signedInStaff(["owner"]);
    const tag = randomBytes(3).toString("hex");
    const baseUrl = `https://panel-${tag}.test`;
    const panel = await staff.client.post("/api/v1/staff/panels", {
      name: "fake",
      driver: "pasarguard",
      baseUrl,
      credentials: { kind: "password", username: "u", password: "p" },
    });
    const location = await staff.client.post("/api/v1/staff/locations", { code: "DE", nameFa: "آلمان", nameEn: "Germany" });
    await staff.client.post("/api/v1/staff/servers", {
      panelId: panel.data.id,
      locationId: location.data.id,
      name: "s1",
      host: "s1.example.com",
      panelGroupId: 1,
      capacityUsers: 10,
    });
    // 3000 toman: about a cent of test USDT per payment.
    const plan = await staff.client.post("/api/v1/staff/plans", {
      slug: `m5-${tag}`,
      name: "آزمون ارز دیجیتال",
      dataLimitGb: 1,
      durationDays: 1,
      deviceLimit: 1,
      priceToman: 3000,
      panels: [{ panelId: panel.data.id, groupIds: [] }],
    });
    assert.equal(plan.status, 201, JSON.stringify(plan.data));

    const buyer = await signedInCustomer(emails);
    const quoteFor = async () => {
      const order = await buyer.client.post("/api/v1/shop/orders", { planId: plan.data.id }, { headers: { "idempotency-key": randomUUID() } });
      const paid = await buyer.client.post(`/api/v1/shop/orders/${order.data.id}/pay/usdt`);
      assert.equal(paid.status, 200, JSON.stringify(paid.data));
      return { orderId: order.data.id as string, units: paid.data.payment.crypto.amountUnits as number };
    };

    const right = await quoteFor();
    const wrong = await quoteFor();
    const rightTx = await send(right.units);
    const wrongTx = await send(wrong.units - 1);
    console.log(`  sent ${right.units} units (${rightTx}) and ${wrong.units - 1} units (${wrongTx})`);

    const statusOf = async (id: string) => (await database().select().from(orders).where(eq(orders.id, id)))[0]!.status;
    const seen = await scanUntil(async () => {
      const both = await database().select().from(cryptoTransfers);
      return both.some((t) => t.txHash === rightTx) && both.some((t) => t.txHash === wrongTx);
    });
    assert.ok(seen, "both transfers were read from Nile");

    assert.equal(await statusOf(right.orderId), "fulfilled", "the exact amount paid the order");
    assert.equal(await statusOf(wrong.orderId), "pending", "the wrong amount did not");
    const queue = await staff.client.get("/api/v1/staff/crypto-transfers");
    assert.ok(queue.data.some((t: { txHash: string }) => t.txHash === wrongTx), "the wrong amount waits for review");
  });
});
