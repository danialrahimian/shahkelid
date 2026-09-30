"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const pinoHttp = require("pino-http");
const crypto = require("node:crypto");

const config = require("./config");
const logger = require("./libraries/logger");
const { createV1Router, createSubscriptionLinkRouter } = require("./http/v1");

/**
 * Builds the express application.
 *
 * This module never listens on a port. Creating the app and running a server
 * are separate concerns, which is what lets the tests start it on a random
 * port and shut it down cleanly.
 */
const createApp = () => {
  const app = express();

  // Behind a reverse proxy in production, so secure cookies and the client IP
  // used for rate limiting are read from the forwarding headers.
  if (config.isProduction) {
    app.set("trust proxy", 1);
  }
  app.disable("x-powered-by");

  app.use(
    helmet({
      // Post covers are served from here and shown by the web app, which is
      // on another origin; the default same-origin policy would block them.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use(cors({ origin: config.cors.origin, credentials: true }));

  // A correlation id on every request and log line.
  app.use((req, res, next) => {
    req.id = req.headers["x-request-id"] || crypto.randomUUID();
    res.setHeader("x-request-id", req.id);
    next();
  });

  app.use(pinoHttp({ logger, genReqId: (req) => req.id, autoLogging: !config.isTest }));

  // Explicit body size limits.
  app.use(express.json({ limit: config.server.bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: config.server.bodyLimit }));

  // Liveness probe for the process manager.
  app.get("/health", (_req, res) => res.status(200).json({ status: "ok", uptime: process.uptime() }));

  // The API. It has its own session (Redis), errors and 404s.
  app.use("/api/v1", createV1Router());

  // Customers' subscription links, fetched by their VPN apps. No session.
  app.use("/s", createSubscriptionLinkRouter());

  // Anything else: not ours. The web app is served separately.
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } }));

  return app;
};

module.exports = { createApp };
