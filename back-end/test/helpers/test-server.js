"use strict";

/**
 * Boots the real backend once per test file, against a real MongoDB.
 *
 * The guidance is to test against the same database product as production and
 * not to fake it (testing practice 2.4). Docker is unavailable here, so the
 * suite prefers a mongod already running on the machine and writes to a
 * throwaway database named per run. If no server is reachable it falls back to
 * mongodb-memory-server, which runs a real mongod binary, so the suite still
 * works on a fresh checkout or in CI.
 */

const net = require("node:net");
const crypto = require("node:crypto");
const mongoose = require("mongoose");

process.env.NODE_ENV = "test";

const { start, stop } = require("../../src/server");
const { installFakes } = require("./fakes");

const LOCAL_HOST = process.env.MONGO_TEST_HOST || "127.0.0.1";
const LOCAL_PORT = Number(process.env.MONGO_TEST_PORT || 27017);

let memoryServer;
let baseUrl;
let databaseName;

/** Can we open a TCP connection to a mongod? */
const isReachable = (host, port, timeout = 1500) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const settle = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });

const resolveDatabaseUri = async () => {
  databaseName = `shahkelid-test-${crypto.randomBytes(4).toString("hex")}`;

  if (await isReachable(LOCAL_HOST, LOCAL_PORT)) {
    return `mongodb://${LOCAL_HOST}:${LOCAL_PORT}/${databaseName}`;
  }

  const { MongoMemoryServer } = require("mongodb-memory-server");
  memoryServer = await MongoMemoryServer.create();
  return memoryServer.getUri(databaseName);
};

/** Starts the API on a random port against a fresh test database. */
const startTestServer = async () => {
  // No test may reach the real SMTP server or payment provider.
  installFakes();
  const uri = await resolveDatabaseUri();
  const { port } = await start({ port: 0, uri });
  baseUrl = `http://127.0.0.1:${port}`;
  return baseUrl;
};

const stopTestServer = async () => {
  // Drop the throwaway database so repeated runs never inherit old records.
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
  }
  await stop();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = undefined;
  }
};

/** Empties every collection, keeping each test independent of the last. */
const clearDatabase = async () => {
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({})),
  );
};

const getBaseUrl = () => baseUrl;

module.exports = { startTestServer, stopTestServer, clearDatabase, getBaseUrl };
