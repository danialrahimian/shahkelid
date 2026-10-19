"use strict";

const nodemailer = require("nodemailer");
const { current } = require("../../modules/settings/live");
const logger = require("../logger");

/**
 * Mail transport. Credentials come from config, never from source
 * (best practice 6.3) - the previous version had the SMTP username and
 * password committed in this file.
 */

let transport;
let transportFor;
let fixedTransport = false;

/**
 * The transport for the mail settings as they are now (saved in the staff
 * area, or .env): made again when they change, so a corrected password
 * takes effect without a restart.
 */
const getTransport = () => {
  if (fixedTransport) return transport;
  const mail = current("mail");
  const fingerprint = JSON.stringify([mail.host, mail.port, mail.user, mail.password]);
  if (!transport || transportFor !== fingerprint) {
    transport = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      // 465 speaks TLS from the first byte; every other port starts plain
      // and is upgraded with STARTTLS when the server offers it.
      secure: mail.port === 465,
      auth: { user: mail.user, pass: mail.password },
    });
    transportFor = fingerprint;
  }
  return transport;
};

/**
 * Sends an email. Failures are logged and swallowed on purpose: a password
 * reset request should not 500 because the mail provider is down, and the
 * caller has already persisted the token.
 */
const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const info = await getTransport().sendMail({
      from: current("mail").from,
      to,
      subject,
      text,
      html,
    });
    logger.info({ messageId: info.messageId, to }, "Email sent");
    return { delivered: true, messageId: info.messageId };
  } catch (error) {
    logger.error({ err: error, to }, "Failed to send email");
    // The provider's own words ("535 Authentication failed"): the settings
    // page shows them to staff testing their mail.
    return { delivered: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/** Test seam: lets a suite install a fake transport. */
const setTransport = (fake) => {
  transport = fake;
  fixedTransport = Boolean(fake);
};

module.exports = { sendEmail, setTransport };
