"use strict";

const http = require("node:http");

const config = require("./config");
const logger = require("./libraries/logger");
const { createApp } = require("./app");
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

const start = async ({ port = config.server.port } = {}) => {
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
  // Each connection is opened only on first use, and closing one that was
  // never opened does nothing.
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

/**
 * Installs signal and crash handlers. Only the real entry point calls this.
 * An error that escapes every request leaves the process in an unknown
 * state, so it is logged, drained and restarted by the process manager.
 */
const registerProcessHandlers = () => {
  for (const origin of ["unhandledRejection", "uncaughtException"]) {
    process.on(origin, (error) => {
      logger.fatal({ err: error, origin }, "Unhandled error, shutting down");
      void shutdown("fatal-error", 1);
    });
  }
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => shutdown(signal, 0));
  }
};

module.exports = { start, stop, registerProcessHandlers };
