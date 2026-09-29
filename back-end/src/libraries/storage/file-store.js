"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const config = require("../../config");
const logger = require("../logger");

const uploadDirectory = config.uploads.directory;

const ensureUploadDirectory = async () => {
  await fs.mkdir(uploadDirectory, { recursive: true });
};

/**
 * Deletes a previously uploaded file.
 *
 * Only the basename is used and the result is checked to stay inside the
 * uploads directory, so a stored path such as "../../app.js" cannot escape it
 * (the old version joined an unchecked value straight onto the upload folder).
 * Failures are logged rather than thrown: an orphaned file must not fail the
 * request that replaced it.
 */
const deleteUpload = async (storedPath) => {
  if (!storedPath) return false;

  const fileName = path.basename(storedPath);
  const fullPath = path.join(uploadDirectory, fileName);

  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(path.resolve(uploadDirectory) + path.sep)) {
    logger.warn({ storedPath }, "Refusing to delete a file outside uploads");
    return false;
  }

  try {
    await fs.unlink(resolved);
    logger.debug({ fileName }, "Upload deleted");
    return true;
  } catch (error) {
    if (error.code !== "ENOENT") {
      logger.warn({ err: error, fileName }, "Could not delete upload");
    }
    return false;
  }
};

/** Public URL for a stored upload, e.g. "/uploads/123.png". */
const toPublicPath = (fileName) => `${config.uploads.publicPath}/${fileName}`;

module.exports = { ensureUploadDirectory, deleteUpload, toPublicPath };
