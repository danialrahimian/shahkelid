"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const config = require("../../config");
const { asyncHandler } = require("../../middlewares");
const { toPublicUser } = require("../users/user.serializer");
const authService = require("./auth.service");
const {
  signUpValidator,
  loginValidator,
  resetLinkValidator,
  resetPasswordValidator,
} = require("./auth.validators");

const router = express.Router();

/**
 * Credential endpoints are rate limited per IP (best practice 6.12). Without
 * this, /login is an open door for offline-speed password guessing.
 */
const credentialLimiter = rateLimit({
  windowMs: config.auth.rateLimitWindowMs,
  limit: config.auth.rateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { errors: [{ msg: "Too many attempts, please try again later" }] },
});

/** Regenerates the session id on privilege change, defeating session fixation. */
const startSession = (req, user) =>
  new Promise((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      req.session.isLoggedIn = true;
      req.session.user = { id: user._id.toString(), role: user.role };
      return req.session.save((saveError) =>
        saveError ? reject(saveError) : resolve(),
      );
    });
  });

router.post(
  "/sign-up",
  credentialLimiter,
  signUpValidator,
  asyncHandler(async (req, res) => {
    const { username, password, email } = req.body;
    const user = await authService.registerUser({ username, password, email });

    await startSession(req, user);
    // isLoggedIn is included so the client knows the session exists without a
    // second round trip to /login-status.
    return res.status(201).json({ ...user, isLoggedIn: true });
  }),
);

router.post(
  "/login",
  credentialLimiter,
  loginValidator,
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;
    const user = await authService.authenticateUser({
      username,
      email,
      password,
    });

    await startSession(req, user);
    return res.status(200).json({ ...user, isLoggedIn: true });
  }),
);

/**
 * Reports the session from the user loaded for this request, not from what the
 * session captured at login time.
 *
 * Answering out of the session had three visible faults: the role was whatever
 * it was when the user signed in, so a promotion or demotion was ignored until
 * they logged out; an account deleted in the meantime still looked signed in
 * while every guarded route answered 401; and the reply carried only an id and
 * a role, so a client that reloaded the page lost the username, email and cart
 * that /login and /sign-up had given it.
 */
router.get("/login-status", (req, res) => {
  if (!req.user) {
    return res.json({ isLoggedIn: false });
  }
  return res.json({ ...toPublicUser(req.user), isLoggedIn: true });
});

router.post(
  "/logout",
  asyncHandler(
    (req, res) =>
      new Promise((resolve, reject) => {
        if (!req.session) {
          res.status(200).json({ message: "Logout succesfully" });
          return resolve();
        }
        req.session.destroy((error) => {
          if (error) return reject(error);
          res.clearCookie(config.session.name);
          res.status(200).json({ message: "Logout succesfully" });
          return resolve();
        });
      }),
  ),
);

// The old router registered this as "/reset-passwor " - a typo with a trailing
// space - so the client's POST /reset-password always 404'd and no reset mail
// was ever sent.
router.post(
  "/reset-password",
  credentialLimiter,
  resetLinkValidator,
  asyncHandler(async (req, res) => {
    const result = await authService.requestPasswordReset({
      email: req.body.email,
    });
    return res.status(200).json(result);
  }),
);

router.post(
  "/reset-password/:resetToken",
  credentialLimiter,
  resetPasswordValidator,
  asyncHandler(async (req, res) => {
    const result = await authService.resetPassword({
      token: req.params.resetToken,
      newPassword: req.body.newPassword,
    });
    return res.status(200).json(result);
  }),
);

module.exports = { authRouter: router };
