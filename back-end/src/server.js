"use strict";

const http = require("node:http");
const mongoose = require("mongoose");

const config = require("./config");
const logger = require("./libraries/logger");
const { createApp } = require("./app");
const { handleFatal } = require("./libraries/errors/error-handler");
const { ensureUploadDirectory } = require("./libraries/storage/file-store");
const { closeDb } = require("./platform/db/client");
const { closeAppRedis } = require("./platform/redis");
const { closeEmailQueue } = require("./modules/notifications/email");

/**
 * Owns the process lifecycle.
 *
 * `start` and `stop` are exported so the tests can run the real server in their
 * own process, on a random port, and close it deterministically
 * (testing practices 3.1 - 3.3).
 */

let server;

const connectToDatabase = async (uri = config.database.uri) => {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  logger.info("Connected to MongoDB");
};

const start = async ({ port = config.server.port, uri } = {}) => {
  await ensureUploadDirectory();
  await connectToDatabase(uri);

  const app = createApp();
  server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  logger.info({ port: address.port }, "Server listening");

  return { server, port: address.port, app };
};

const stop = async () => {
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  server = undefined;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  // The /api/v1 connections. Each is opened only on first use, and closing
  // one that was never opened does nothing.
  await closeEmailQueue();
  await closeAppRedis();
  await closeDb();
  logger.info("Server stopped");
};

/**
 * Drains connections, then exits, so an orchestrator can replace the process
 * without dropping in-flight requests (best practices 2.6, 5.16).
 */
const shutdown = async (signal, code = 0) => {
  logger.info({ signal }, "Shutting down");
  const forceExit = setTimeout(() => {
    logger.fatal("Shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await stop();
    process.exit(code);
  } catch (error) {
    logger.error({ err: error }, "Error during shutdown");
    process.exit(1);
  }
};

/** Installs signal and crash handlers. Only the real entry point calls this. */
const registerProcessHandlers = () => {
  handleFatal({ onFatal: () => shutdown("fatal-error", 1) });
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => shutdown(signal, 0));
  }
};

module.exports = { start, stop, connectToDatabase, registerProcessHandlers };
