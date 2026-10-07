"use strict";

/**
 * Loaded before every test file (see the "test" script), ahead of any import.
 *
 * Setting NODE_ENV inside a helper was not enough: a test that imported the
 * config before that helper would read the development settings, and the
 * suite resets the database it points at. Here, the config can only ever see
 * "test", and therefore only ever the test database.
 */
process.env.NODE_ENV = "test";
// The addresses the web server answers on, as in production: the site may be
// used from any of them (see the cross-origin tests).
process.env.SITE_ADDRESSES ??= "shop.test, www.shop.test";
