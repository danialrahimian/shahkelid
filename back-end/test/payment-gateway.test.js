"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";

const {
  createFakeGateway,
  shouldUseFakeGateway,
} = require("../src/libraries/payment/fake-gateway");
const config = require("../src/config");

/**
 * The stand-in gateway used when no merchant id is configured.
 *
 * Without it a fresh clone could not reach the end of checkout at all: the
 * provider library reads the merchant id's length while being constructed, so
 * an undefined one threw a TypeError that the wrapper reported as "could not
 * reach the payment provider" - a message that blamed the network for a
 * missing setting.
 */
describe("Fake payment gateway", () => {
  let gateway;

  beforeEach(() => {
    gateway = createFakeGateway();
  });

  it("When no merchant id is set outside production, then the fake is chosen", () => {
    assert.equal(config.payment.isConfigured, false);
    assert.equal(shouldUseFakeGateway(), true);
  });

  it("When production is configured, then the fake is never chosen", () => {
    // Belt and braces: the config already refuses to boot in production
    // without a merchant id, and this checks the second guard independently.
    const original = config.isProduction;
    try {
      config.isProduction = true;
      assert.equal(shouldUseFakeGateway(), false);
    } finally {
      config.isProduction = original;
    }
  });

  it("When a payment is opened, then it returns an authority and a callback url", async () => {
    const response = await gateway.PaymentRequest({
      Amount: 250,
      CallbackURL: "http://localhost:5173/verify-payment",
    });

    assert.equal(response.status, 100);
    assert.match(response.authority, /^A[0-9A-F]{35}$/);
    // Following the url has to complete the round trip, which is the whole
    // point of the stand-in.
    assert.ok(response.url.includes(`Authority=${response.authority}`));
    assert.ok(response.url.includes("Status=OK"));
  });

  it("When the amount matches, then verification succeeds with a reference", async () => {
    const opened = await gateway.PaymentRequest({
      Amount: 250,
      CallbackURL: "http://localhost:5173/verify-payment",
    });

    const verified = await gateway.PaymentVerification({
      Amount: 250,
      Authority: opened.authority,
    });

    assert.equal(verified.status, 100);
    assert.ok(verified.RefID);
  });

  it("When the same authority is verified twice, then the second says already verified", async () => {
    const opened = await gateway.PaymentRequest({
      Amount: 250,
      CallbackURL: "http://localhost:5173/verify-payment",
    });
    await gateway.PaymentVerification({
      Amount: 250,
      Authority: opened.authority,
    });

    const replay = await gateway.PaymentVerification({
      Amount: 250,
      Authority: opened.authority,
    });

    assert.equal(replay.status, 101);
  });

  it("When the amount does not match, then verification is refused", async () => {
    // The real provider refuses this, and so must the stand-in, or a bug that
    // sends the wrong amount would pass unnoticed in development.
    const opened = await gateway.PaymentRequest({
      Amount: 250,
      CallbackURL: "http://localhost:5173/verify-payment",
    });

    const verified = await gateway.PaymentVerification({
      Amount: 1,
      Authority: opened.authority,
    });

    assert.equal(verified.status, -33);
  });

  it("When the authority is unknown, then verification is refused", async () => {
    const verified = await gateway.PaymentVerification({
      Amount: 250,
      Authority: "A00000000000000000000000000000000000",
    });

    assert.equal(verified.status, -51);
  });
});
