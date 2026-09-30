"use strict";

const path = require("node:path");

require("dotenv").config();

/**
 * Environment-aware, validated configuration (best practice 1.4).
 *
 * Everything the app needs is read here, once, and validated at boot. Nothing
 * else in the codebase touches `process.env`, so a missing variable fails fast
 * at startup instead of surfacing as `undefined` deep inside a request.
 */

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";
const isTest = NODE_ENV === "test";

/** Reads a variable, falling back to a default outside production. */
const read = (key, { fallback, required = false } = {}) => {
  // Keys in this project's .env are written with stray spaces ("HOST =x").
  const raw = process.env[key] ?? process.env[`${key} `];
  const value = typeof raw === "string" ? raw.trim() : raw;

  if (value === undefined || value === "") {
    if (required && isProduction) {
      throw new Error(
        `Missing required environment variable "${key}". Refusing to start.`,
      );
    }
    return fallback;
  }
  return value;
};

const readNumber = (key, fallback) => {
  const value = read(key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable "${key}" must be a number.`);
  }
  return parsed;
};

const zarinpalMerchantId = read("ZARINPAL_MERCHANT_ID", { required: true });

const config = {
  env: NODE_ENV,
  isProduction,
  isTest,

  server: {
    host: read("HOST", { fallback: "localhost" }),
    // 0 lets the OS pick a free port, which is what the tests want so that
    // suites can run in parallel without colliding (testing practice 3.3).
    port: readNumber("PORT", isTest ? 0 : 5000),
    // Requests larger than this are rejected (security practice 6.14).
    bodyLimit: read("BODY_LIMIT", { fallback: "100kb" }),
  },

  // PostgreSQL: the platform's database from here on. The defaults match
  // compose.yaml, so `npm run services:up` is all a new machine needs; tests
  // get their own database so a test run never touches development data.
  postgres: {
    url: read("POSTGRES_URL", {
      required: true,
      fallback: isTest
        ? "postgres://shah_kelid:dev-only-password@127.0.0.1:5432/shah_kelid_test"
        : "postgres://shah_kelid:dev-only-password@127.0.0.1:5432/shah_kelid",
    }),
    poolSize: readNumber("POSTGRES_POOL_SIZE", 10),
  },

  // Redis: queues, and later sessions and rate limits. Tests use database 1,
  // for the same reason as above.
  redis: {
    url: read("REDIS_URL", {
      required: true,
      fallback: isTest ? "redis://127.0.0.1:6379/1" : "redis://127.0.0.1:6379/0",
    }),
    // Every key the app writes starts with this. Each test process gets its
    // own, so counters such as rate limits never leak from one test file, or
    // one run, into the next.
    keyPrefix: isTest ? `test:${process.pid}:` : "",
  },

  // The new PostgreSQL accounts (src/modules/identity). The old session above
  // serves the MongoDB routes until each is replaced.
  account: {
    sessionName: read("ACCOUNT_SESSION_NAME", { fallback: "sk.sid" }),
    // Thirty days: this is a store people return to once a month to renew.
    sessionMaxAgeMs: readNumber("ACCOUNT_SESSION_MAX_AGE_MS", 30 * 24 * 60 * 60 * 1000),
    // An emailed sign-in code is good for ten minutes and five guesses.
    codeTtlMs: readNumber("SIGN_IN_CODE_TTL_MS", 10 * 60 * 1000),
    codeMaxAttempts: 5,
    // How many codes one email address can be sent per hour.
    codesPerEmailPerHour: readNumber("SIGN_IN_CODES_PER_HOUR", 5),
    // Password sign-in locks after this many wrong passwords in a row.
    lockoutThreshold: 5,
    lockoutMs: readNumber("PASSWORD_LOCKOUT_MS", 15 * 60 * 1000),
  },

  security: {
    // AES-256-GCM key for secrets kept in the database: two-factor secrets
    // now, VPN panel credentials from M3. 32 bytes, base64. Required in
    // production; the fallbacks are public and only good for development.
    //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    encryptionKey: read("APP_ENCRYPTION_KEY", {
      required: true,
      fallback: Buffer.alloc(32, isTest ? "t" : "d").toString("base64"),
    }),
  },

  session: {
    // Signs the account session's cookie (src/platform/http/account-session.ts).
    secret: read("SESSION_SECRET", {
      fallback: isProduction ? undefined : "dev-only-insecure-secret",
      required: true,
    }),
  },

  cors: {
    origin: read("CLIENT_ORIGIN", { fallback: "http://localhost:5173" }),
  },

  // Buying (src/modules/billing).
  checkout: {
    // Zarinpal's v4 API. In the sandbox any merchant id is accepted, so
    // development needs none; production refuses to start without one.
    zarinpalSandbox: read("ZARINPAL_SANDBOX", { fallback: "true" }) !== "false",
    zarinpalMerchantId:
      zarinpalMerchantId ||
      (read("ZARINPAL_SANDBOX", { fallback: "true" }) !== "false"
        ? "00000000-0000-0000-0000-000000000000"
        : ""),
    // An unpaid order lapses after this long; a card transfer gets longer,
    // since the customer has to go to their bank app and come back.
    orderTtlMs: readNumber("ORDER_TTL_MS", 60 * 60 * 1000),
    // Orders and payment attempts per address per minute. The test suite
    // buys dozens of times from one address.
    requestsPerMinute: readNumber("SHOP_REQUESTS_PER_MINUTE", isTest ? 1000 : 30),
    cardTransferTtlMs: readNumber("CARD_TRANSFER_TTL_MS", 24 * 60 * 60 * 1000),
    // Receipts and other private files, never served statically.
    privateFilesDirectory: path.join(__dirname, "..", "..", "files"),
  },

  // Crypto payments (src/modules/billing/crypto*). Both methods stay hidden
  // at checkout until they are configured and the USDT rate is fresh.
  crypto: {
    // Nobitex's public market stats; api.nobitex.ir does not resolve from abroad.
    nobitexUrl: read("NOBITEX_URL", { fallback: "https://apiv2.nobitex.ir" }),
    // A rate older than this stops crypto checkout until a fresh one arrives.
    rateMaxAgeMs: readNumber("CRYPTO_RATE_MAX_AGE_MS", 10 * 60 * 1000),
    // How long a quoted amount is honoured.
    invoiceTtlMs: readNumber("CRYPTO_INVOICE_TTL_MS", 30 * 60 * 1000),

    // USDT on TRON, sent straight to our wallet. Only its address is needed:
    // the server never holds the wallet's key.
    tronAddress: read("TRON_RECEIVE_ADDRESS", { fallback: "" }),
    // TronGrid: https://api.trongrid.io on mainnet, https://nile.trongrid.io on the Nile testnet.
    tronGridUrl: read("TRONGRID_URL", { fallback: "https://api.trongrid.io" }),
    tronGridApiKey: read("TRONGRID_API_KEY", { fallback: "" }),
    // The official USDT contract; a token merely named USDT is ignored.
    // Mainnet TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t; Nile TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf.
    usdtContract: read("TRON_USDT_CONTRACT", { fallback: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" }),

    // NOWPayments: an API key and the IPN secret from its dashboard.
    nowpaymentsApiKey: read("NOWPAYMENTS_API_KEY", { fallback: "" }),
    nowpaymentsIpnSecret: read("NOWPAYMENTS_IPN_SECRET", { fallback: "" }),
    nowpaymentsSandbox: read("NOWPAYMENTS_SANDBOX", { fallback: "false" }) === "true",
  },

  // Alerts to the people running the store (src/modules/notifications/alerts).
  alerts: {
    // A bot from @BotFather, and the chats (people or a group) it writes to.
    telegramBotToken: read("TELEGRAM_BOT_TOKEN", { fallback: "" }),
    telegramChatIds: read("TELEGRAM_ADMIN_CHAT_IDS", { fallback: "" })
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  },

  // VPN panels and subscriptions (src/modules/provisioning).
  provisioning: {
    // Where this API is reached from outside: customers' links are
    // {publicUrl}/s/{token} unless a panel names its own subscription domain.
    publicUrl: read("PUBLIC_API_URL", {
      fallback: isProduction ? undefined : "http://localhost:5000",
      required: true,
    }).replace(/\/+$/, ""),
    // A plan that starts on first use starts anyway after this many days.
    firstUseDeadlineDays: readNumber("FIRST_USE_DEADLINE_DAYS", 30),
    // How often usage is copied from the panels.
    syncEveryMs: readNumber("USAGE_SYNC_EVERY_MS", 5 * 60 * 1000),
  },


  mail: {
    host: read("SMTP_HOST", { fallback: "sandbox.smtp.mailtrap.io" }),
    port: readNumber("SMTP_PORT", 2525),
    user: read("SMTP_USER", { required: true }),
    password: read("SMTP_PASSWORD", { required: true }),
    from: read("MAIL_FROM", { fallback: "no-reply@shahkelid.local" }),
  },

  auth: {
    // Credential attempts allowed per IP per window. Twenty is right for a
    // public deployment but far too few for development, where iterating on
    // the sign-in screen or running the client's integration suite exhausts
    // it in one sitting and then blocks work for the rest of the window.
    rateLimitWindowMs: readNumber("AUTH_RATE_WINDOW_MS", 15 * 60 * 1000),
    rateLimitMax: readNumber(
      "AUTH_RATE_LIMIT",
      isProduction ? 20 : 1000,
    ),
  },

  logging: {
    level: read("LOG_LEVEL", { fallback: isTest ? "silent" : "info" }),
  },
};

module.exports = config;
