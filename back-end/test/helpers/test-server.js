"use strict";

/**
 * Boots the real API once per test file, on a random port.
 *
 * The API runs against the test PostgreSQL database and Redis database 1
 * (test/setup-env.cjs); each file resets the database itself
 * (helpers/postgres.ts). The tests talk to it over HTTP, as a browser would.
 */

process.env.NODE_ENV = "test";

const { start, stop } = require("../../src/server");

/**
 * Ports fetch() refuses to connect to (the Fetch standard's "bad ports").
 * The OS hands out a random free port, and now and then it is one of these;
 * every request of that test file would then fail with "bad port".
 */
const BAD_PORTS = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697,
  10080,
]);

let baseUrl;

const startTestServer = async () => {
  for (;;) {
    const { port } = await start({ port: 0 });
    if (!BAD_PORTS.has(port)) {
      baseUrl = `http://127.0.0.1:${port}`;
      return baseUrl;
    }
    await stop();
  }
};

const stopTestServer = async () => {
  await stop();
};

const getBaseUrl = () => baseUrl;

module.exports = { startTestServer, stopTestServer, getBaseUrl };
