"use strict";

const nodemailer = require("nodemailer");
const config = require("../../config");
const logger = require("../logger");

/**
 * Mail transport. Credentials come from config, never from source
 * (best practice 6.3) - the previous version had the SMTP username and
 * password committed in this file.
 */

let transport;

const getTransport = () => {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      auth: { user: config.mail.user, pass: config.mail.password },
    });
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
      from: config.mail.from,
      to,
      subject,
      text,
      html,
    });
    logger.info({ messageId: info.messageId, to }, "Email sent");
    return { delivered: true, messageId: info.messageId };
  } catch (error) {
    logger.error({ err: error, to }, "Failed to send email");
    return { delivered: false };
  }
};

/** Test seam: lets a suite install a fake transport. */
const setTransport = (fake) => {
  transport = fake;
};

module.exports = { sendEmail, setTransport };
