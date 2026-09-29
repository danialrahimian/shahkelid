"use strict";

/**
 * Fakes for the two services that live outside this process: the SMTP server
 * and the payment provider.
 *
 * Tests must never reach a real third party (testing practice 5.1): it makes
 * them slow and flaky, and here it also made the reset-password tests wait
 * seconds for an SMTP connection to time out. Each fake records what it was
 * asked to do so a test can assert on the outgoing call, which is one of the
 * five exit doors worth checking (practice 1.4).
 */

const mailer = require("../../src/libraries/mailer");
const paymentGateway = require("../../src/libraries/payment");

const createMailFake = () => {
  const sent = [];
  const transport = {
    sendMail: async (message) => {
      sent.push(message);
      return { messageId: `fake-${sent.length}` };
    },
  };

  return {
    transport,
    sent,
    /** The most recent message, or undefined when nothing was sent. */
    last: () => sent.at(-1),
    reset: () => sent.splice(0, sent.length),
  };
};

const createPaymentFake = () => {
  const requests = [];
  const verifications = [];

  // Defaults describe the happy path; a test overrides them to rehearse a
  // refusal or an outage.
  let requestResponse = {
    status: 100,
    authority: "A00000000000000000000000000000000001",
    url: "https://sandbox.zarinpal.com/pg/StartPay/fake",
  };
  let verifyResponse = { status: 100, RefID: 123456 };

  const client = {
    PaymentRequest: async (payload) => {
      requests.push(payload);
      if (requestResponse instanceof Error) throw requestResponse;
      return requestResponse;
    },
    PaymentVerification: async (payload) => {
      verifications.push(payload);
      if (verifyResponse instanceof Error) throw verifyResponse;
      return verifyResponse;
    },
  };

  return {
    client,
    requests,
    verifications,
    /** Decides what the provider answers next. Pass an Error to simulate an outage. */
    respondToRequestWith: (response) => {
      requestResponse = response;
    },
    respondToVerificationWith: (response) => {
      verifyResponse = response;
    },
    reset: () => {
      requests.splice(0, requests.length);
      verifications.splice(0, verifications.length);
      requestResponse = {
        status: 100,
        authority: "A00000000000000000000000000000000001",
        url: "https://sandbox.zarinpal.com/pg/StartPay/fake",
      };
      verifyResponse = { status: 100, RefID: 123456 };
    },
  };
};

const mail = createMailFake();
const payments = createPaymentFake();

/** Points the app's outgoing adapters at the fakes. */
const installFakes = () => {
  mailer.setTransport(mail.transport);
  paymentGateway.setClient(payments.client);
  return { mail, payments };
};

module.exports = { installFakes, mail, payments };
