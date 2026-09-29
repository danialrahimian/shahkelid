"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const mongoose = require("mongoose");
const pinoHttp = require("pino-http");
const crypto = require("node:crypto");

const config = require("./config");
const logger = require("./libraries/logger");
const { errorMiddleware } = require("./libraries/errors/error-handler");
const { loadUser, notFoundHandler } = require("./middlewares");
const { User } = require("./components/users/user.model");

const { authRouter } = require("./components/auth/auth.routes");
const { productRouter } = require("./components/products/product.routes");
const { userRouter } = require("./components/users/user.routes");
const { profileRouter } = require("./components/users/profile.routes");
const { adminRouter } = require("./components/admin/admin.routes");
const { moderatorRouter } = require("./components/moderator/moderator.routes");
const { orderRouter } = require("./components/orders/order.routes");
const { postRouter } = require("./components/posts/post.routes");
const {
  analyticsRouter,
} = require("./components/analytics/analytics.routes");
const { crmRouter } = require("./components/crm/crm.routes");
const { createV1Router } = require("./http/v1");

/**
 * Builds the express application.
 *
 * This module never listens on a port. Creating the app and running a server
 * are separate concerns, which is what lets the tests start it on a random
 * port and shut it down cleanly (testing practices 3.1 - 3.3).
 */
const createApp = () => {
  const app = express();

  // Behind a reverse proxy in production, so secure cookies and the client IP
  // used for rate limiting are read from the forwarding headers.
  if (config.isProduction) {
    app.set("trust proxy", 1);
  }
  app.disable("x-powered-by");

  // Security headers (best practice 6.6).
  app.use(
    helmet({
      // Uploaded images are served from here and read by the SPA on another
      // origin, so the default same-origin policy would block them.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use(
    cors({
      origin: config.cors.origin,
      credentials: true,
    }),
  );

  // A correlation id on every request and log line (best practice 5.14).
  app.use((req, res, next) => {
    req.id = req.headers["x-request-id"] || crypto.randomUUID();
    res.setHeader("x-request-id", req.id);
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: !config.isTest,
    }),
  );

  // Explicit body size limits (best practice 6.14).
  app.use(express.json({ limit: config.server.bodyLimit }));
  app.use(
    express.urlencoded({ extended: true, limit: config.server.bodyLimit }),
  );

  // The rebuilt API, on PostgreSQL. Mounted before the old session below, so
  // its requests never touch MongoDB: it has its own session in Redis.
  app.use("/api/v1", createV1Router());

  app.use(config.uploads.publicPath, express.static(config.uploads.directory));

  // The session store rides on the connection mongoose already opened, so
  // there is exactly one client to open, watch and close. Tests depend on this:
  // a second, self-managed connection would keep the process alive after the
  // suite finished and would write sessions to the wrong database.
  const store = MongoStore.create({
    client: mongoose.connection.getClient(),
    collectionName: "session",
    ttl: config.session.maxAgeMs / 1000,
  });
  store.on("error", (error) =>
    logger.error({ err: error }, "Session store error"),
  );

  app.use(
    session({
      name: config.session.name,
      secret: config.session.secret,
      resave: false,
      saveUninitialized: false,
      store,
      cookie: {
        // Hardened session cookie (best practice 6.22).
        httpOnly: true,
        sameSite: "lax",
        secure: config.isProduction,
        maxAge: config.session.maxAgeMs,
      },
    }),
  );

  app.use(loadUser(User));

  // Liveness probe for the process manager (best practice 5.7).
  app.get("/health", (req, res) =>
    res.status(200).json({ status: "ok", uptime: process.uptime() }),
  );

  app.use("/", authRouter);
  app.use("/", productRouter);
  app.use("/", userRouter);
  app.use("/", profileRouter);
  app.use("/", adminRouter);
  app.use("/", moderatorRouter);
  app.use("/", orderRouter);
  app.use("/", postRouter);
  app.use("/", analyticsRouter);
  app.use("/", crmRouter);

  app.use(notFoundHandler);
  app.use(errorMiddleware);

  return app;
};

module.exports = { createApp };
