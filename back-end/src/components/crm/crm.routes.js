"use strict";

const express = require("express");
const { body } = require("express-validator");

const { asyncHandler, requireRole, validate } = require("../../middlewares");
const crmService = require("./crm.service");
const { LIFECYCLE_STAGES } = require("./crm.model");

const router = express.Router();

/**
 * The customer book, for staff only.
 *
 * Everything here is internal: purchase history, lifetime value and the team's
 * own notes. None of it is ever shown to the customer it describes.
 */
const staffOnly = requireRole("admin", "moderator", "owner");

const noteValidator = [
  body("body")
    .exists({ values: "falsy" })
    .withMessage("write something first")
    .bail()
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage("a note must be between 1 and 2000 characters"),
  validate,
];

const updateValidator = [
  body("stage")
    .optional({ values: "null" })
    .isIn(["", ...LIFECYCLE_STAGES])
    .withMessage(`stage must be one of: ${LIFECYCLE_STAGES.join(", ")}`),
  body("tags").optional().isArray().withMessage("tags must be a list"),
  validate,
];

router.get(
  "/crm/customers",
  staffOnly,
  asyncHandler(async (req, res) =>
    res.status(200).json(await crmService.listCustomers(req.query)),
  ),
);

// Declared before the parameter route so the literal wins.
router.get(
  "/crm/segments",
  staffOnly,
  asyncHandler(async (_req, res) =>
    res.status(200).json(await crmService.getSegments()),
  ),
);

router.get(
  "/crm/customers/:userId",
  staffOnly,
  asyncHandler(async (req, res) =>
    res.status(200).json(await crmService.getCustomer(req.params.userId)),
  ),
);

router.put(
  "/crm/customers/:userId",
  staffOnly,
  updateValidator,
  asyncHandler(async (req, res) =>
    res.status(200).json(
      await crmService.updateCustomer(req.params.userId, {
        stage: req.body.stage,
        tags: req.body.tags,
        owner: req.body.owner,
      }),
    ),
  ),
);

router.post(
  "/crm/customers/:userId/notes",
  staffOnly,
  noteValidator,
  asyncHandler(async (req, res) =>
    res
      .status(201)
      .json(
        await crmService.addNote(req.params.userId, req.user, req.body.body),
      ),
  ),
);

router.delete(
  "/crm/customers/:userId/notes/:noteId",
  staffOnly,
  asyncHandler(async (req, res) =>
    res
      .status(200)
      .json(
        await crmService.deleteNote(req.params.userId, req.params.noteId),
      ),
  ),
);

module.exports = { crmRouter: router };
