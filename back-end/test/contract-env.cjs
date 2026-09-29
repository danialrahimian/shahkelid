"use strict";

/**
 * Loaded by `npm run test:contract` only. The contract tests touch a real
 * panel, so they run when asked for and never as part of `npm test`.
 * (A file rather than `VAR=1 node ...`, which does not work on Windows.)
 */
// The test panel lives in .env, which nothing else in the test run reads first.
require("dotenv").config();
process.env.PASARGUARD_CONTRACT = "1";
