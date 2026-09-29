"use strict";

const express = require("express");

const { asyncHandler, requireRole } = require("../../middlewares");
const analyticsService = require("./analytics.service");

const router = express.Router();

/**
 * Sales reporting, for staff only.
 *
 * Revenue, customer names and conversion rates are commercial information, so
 * every route carries the same guard the admin panel does. The guard is per
 * route rather than router-wide because this router is mounted at "/", and a
 * router-wide one would answer for paths the app does not define.
 */
const staffOnly = requireRole("admin", "moderator", "owner");

router.get(
  "/analytics/summary",
  staffOnly,
  asyncHandler(async (req, res) =>
    res.status(200).json(await analyticsService.getSummary(req.query)),
  ),
);

router.get(
  "/analytics/revenue",
  staffOnly,
  asyncHandler(async (req, res) =>
    res.status(200).json(await analyticsService.getRevenueSeries(req.query)),
  ),
);

router.get(
  "/analytics/plans",
  staffOnly,
  asyncHandler(async (req, res) =>
    res.status(200).json(await analyticsService.getPlanBreakdown(req.query)),
  ),
);

router.get(
  "/analytics/funnel",
  staffOnly,
  asyncHandler(async (req, res) =>
    res.status(200).json(await analyticsService.getFunnel(req.query)),
  ),
);

router.get(
  "/analytics/top-customers",
  staffOnly,
  asyncHandler(async (req, res) =>
    res.status(200).json(await analyticsService.getTopCustomers(req.query)),
  ),
);

module.exports = { analyticsRouter: router };
