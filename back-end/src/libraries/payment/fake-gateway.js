"use strict";

const crypto = require("node:crypto");

const config = require("../../config");
const logger = require("../logger");

/**
 * A stand-in for the payment provider, used only when no merchant id is
 * configured and only outside production.
 *
 * Without it the checkout flow cannot be exercised at all on a fresh clone:
 * `zarinpal-checkout` is handed an undefined merchant id, throws before any
 * request leaves the machine, and the API reports "could not reach the payment
 * provider" - which is doubly misleading, because nothing was ever unreachable
 * and nothing was ever configured.
 *
 * It behaves like the real gateway: it hands back an authority and a URL, and
 * that URL is the app's own callback, so following it completes the round trip
 * and the order really is marked paid.
 */

/** Zarinpal authorities are a letter followed by 35 characters. */
const makeAuthority = () =>
  `A${crypto.randomBytes(18).toString("hex").slice(0, 35).toUpperCase()}`;

const createFakeGateway = () => {
  // Remembers what each authority was opened for, so verification can refuse
  // an amount that does not match, exactly as the real provider would.
  const opened = new Map();

  return {
    PaymentRequest: async ({ Amount, CallbackURL }) => {
      const authority = makeAuthority();
      opened.set(authority, Amount);

      const url = `${CallbackURL}?Authority=${authority}&Status=OK`;

      logger.warn(
        { authority, amount: Amount, url },
        "Using the built-in fake payment gateway. Set ZARINPAL_MERCHANT_ID to use the real one.",
      );

      return { status: 100, authority, url };
    },

    PaymentVerification: async ({ Amount, Authority }) => {
      const expected = opened.get(Authority);
      const refId = Number.parseInt(Authority.slice(-9), 36) % 1_000_000_000;

      // -51: the provider does not know this authority.
      if (expected === undefined) {
        return { status: -51 };
      }

      // null means it has been settled once already. This has to be checked
      // before the amount, or a legitimate repeat callback looks like a
      // mismatch rather than "already verified".
      if (expected === null) {
        return { status: 101, RefID: refId };
      }

      // -33: the amount does not match what the payment was opened for.
      if (expected !== Amount) {
        return { status: -33 };
      }

      opened.set(Authority, null);
      return { status: 100, RefID: refId };
    },
  };
};

/**
 * Whether the fake should be used. Production is excluded twice over: the
 * config refuses to start without a merchant id there, and this checks anyway.
 */
const shouldUseFakeGateway = () =>
  !config.isProduction && !config.payment.isConfigured;

module.exports = { createFakeGateway, shouldUseFakeGateway };
