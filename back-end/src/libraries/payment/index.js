"use strict";

const zarinpalCheckout = require("zarinpal-checkout");
const config = require("../../config");
const logger = require("../logger");
const { badGateway } = require("../errors/app-error");
const {
  createFakeGateway,
  shouldUseFakeGateway,
} = require("./fake-gateway");

/**
 * Thin wrapper around the payment provider.
 *
 * The rest of the app talks to this interface, not to zarinpal-checkout
 * directly, which keeps the provider swappable and gives the tests one seam to
 * fake instead of intercepting a third-party client's internals.
 */

let client;

const getClient = () => {
  if (client) return client;

  // No merchant id and not in production: stand in for the provider so the
  // checkout flow can be walked end to end locally. Production cannot reach
  // this branch - the config refuses to start there without a merchant id.
  if (shouldUseFakeGateway()) {
    client = createFakeGateway();
    return client;
  }

  try {
    client = zarinpalCheckout.create(
      config.payment.merchantId,
      config.payment.sandbox,
    );
  } catch (error) {
    // The library reads the merchant id's length on construction, so a
    // malformed one surfaces here as an unrelated TypeError. Say what is
    // actually wrong instead of blaming the network.
    logger.error({ err: error }, "Could not build the payment client");
    throw badGateway(
      "The payment provider is not configured correctly. Check ZARINPAL_MERCHANT_ID.",
    );
  }

  return client;
};

/**
 * Opens a payment and returns where to send the customer.
 * @returns {Promise<{authority: string, url: string, status: number}>}
 */
const requestPayment = async ({ amount, email, description }) => {
  let response;
  try {
    response = await getClient().PaymentRequest({
      Amount: amount,
      CallbackURL: config.payment.callbackUrl,
      Description: description,
      Email: email,
    });
  } catch (error) {
    logger.error({ err: error }, "Payment request failed");
    throw badGateway("Could not reach the payment provider");
  }

  // 100 = created, 101 = already created. Anything else is a refusal, which
  // the old code ignored - it simply never responded, leaving clients hanging.
  if (response?.status !== 100 && response?.status !== 101) {
    throw badGateway(
      `The payment provider refused the request (status ${response?.status})`,
    );
  }

  return {
    status: response.status,
    authority: response.authority,
    url: response.url,
  };
};

/**
 * Confirms a payment with the provider.
 * @returns {Promise<{verified: boolean, refId?: string|number}>}
 */
const verifyPayment = async ({ amount, authority }) => {
  let response;
  try {
    response = await getClient().PaymentVerification({
      Amount: amount,
      Authority: authority,
    });
  } catch (error) {
    logger.error({ err: error }, "Payment verification failed");
    throw badGateway("Could not reach the payment provider");
  }

  const verified = response?.status === 100 || response?.status === 101;
  return { verified, refId: response?.RefID ?? response?.refId };
};

/** Test seam: lets a suite install a fake provider. */
const setClient = (fake) => {
  client = fake;
};

module.exports = { requestPayment, verifyPayment, setClient };
