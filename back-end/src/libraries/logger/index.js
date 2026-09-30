"use strict";

const pino = require("pino");
const config = require("../../config");

/**
 * A mature logger, writing structured JSON to stdout (best practices 2.7,
 * 5.18). Nothing in the app calls console.log; shipping logs somewhere is the
 * runtime's job, not the app's.
 */
/**
 * Human-readable output while developing, plain JSON everywhere else.
 *
 * pino-pretty is a development dependency, so an install made with
 * `npm ci --omit=dev` does not have it. NODE_ENV defaults to "development" when
 * nothing sets it, and naming a transport that is not installed makes pino
 * throw while this module is still being required - the process died at boot
 * with "unable to determine transport target" before anything could log why.
 */
const prettyTransport = () => {
  if (config.isProduction || config.isTest) return undefined;
  try {
    require.resolve("pino-pretty");
    return { target: "pino-pretty", options: { colorize: true } };
  } catch {
    return undefined;
  }
};

const logger = pino({
  level: config.logging.level,
  base: { env: config.env },
  redact: {
    // Never let a credential reach the log stream.
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "res.headers[\"set-cookie\"]",
      "password",
      "newPassword",
      "repeatPassword",
      "*.password",
      "user.password",
      "resetPasswordToken",
    ],
    censor: "[redacted]",
  },
  transport: prettyTransport(),
});

module.exports = logger;
