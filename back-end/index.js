"use strict";

/**
 * Production entry point. The only place that both starts a server and wires
 * process-level handlers; everything else is importable without side effects.
 */
const logger = require("./src/libraries/logger");
const { start, registerProcessHandlers } = require("./src/server");

registerProcessHandlers();

start().catch((error) => {
  logger.fatal({ err: error }, "Failed to start");
  process.exit(1);
});
