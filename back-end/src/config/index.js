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

// Read before the config object so its presence can be reported alongside it.
const paymentMerchantId = read("ZARINPAL_MERCHANT_ID", { required: true });

const databaseHost = read("DATABASE_HOST", { fallback: "127.0.0.1" });
const databaseName = read("DATABASE_NAME", {
  fallback: isTest ? "shahkelid-test" : "shahkelid",
});

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

  database: {
    uri:
      read("DATABASE_URI") || `mongodb://${databaseHost}:27017/${databaseName}`,
  },

  session: {
    secret: read("SESSION_SECRET", {
      fallback: isProduction ? undefined : "dev-only-insecure-secret",
      required: true,
    }),
    name: read("SESSION_NAME", { fallback: "shahkelid.sid" }),
    // One week.
    maxAgeMs: readNumber("SESSION_MAX_AGE_MS", 7 * 24 * 60 * 60 * 1000),
  },

  cors: {
    origin: read("CLIENT_ORIGIN", { fallback: "http://localhost:5173" }),
  },

  uploads: {
    // Anchored to the package, not to the shell's working directory. Starting
    // the app from a parent folder used to point this somewhere else, so new
    // uploads landed outside the folder that already held every stored image.
    directory: path.join(__dirname, "..", "..", "uploads"),
    publicPath: "/uploads",
    maxFileSizeBytes: readNumber("UPLOAD_MAX_BYTES", 5 * 1024 * 1024),
  },

  mail: {
    host: read("SMTP_HOST", { fallback: "sandbox.smtp.mailtrap.io" }),
    port: readNumber("SMTP_PORT", 2525),
    user: read("SMTP_USER", { required: true }),
    password: read("SMTP_PASSWORD", { required: true }),
    from: read("MAIL_FROM", { fallback: "no-reply@shahkelid.local" }),
  },

  payment: {
    merchantId: paymentMerchantId,
    // The library throws on an undefined merchant id, so callers check this
    // rather than discovering the problem as an unrelated TypeError.
    isConfigured: Boolean(paymentMerchantId),
    // Zarinpal's sandbox, unless explicitly turned off.
    sandbox: read("ZARINPAL_SANDBOX", { fallback: "true" }) !== "false",
    callbackUrl: read("PAYMENT_CALLBACK_URL", {
      fallback: "http://localhost:5173/verify-payment",
    }),
  },

  auth: {
    bcryptRounds: readNumber("BCRYPT_ROUNDS", isTest ? 4 : 12),
    resetTokenTtlMs: readNumber("RESET_TOKEN_TTL_MS", 60 * 60 * 1000),
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
