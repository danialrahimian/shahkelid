"use strict";

/**
 * A plain HTTP client over the running server.
 *
 * The guidance is to approach the API with a real HTTP client rather than
 * binding tests to the express app object (testing practice 4.2), so this is
 * Node's built-in fetch and nothing more. Cookies are tracked per client so a
 * test can authenticate the same way a browser does (practice 4.3).
 */

const { getBaseUrl } = require("./test-server");

const createClient = () => {
  let cookie = "";

  const request = async (method, path, { body, headers = {} } = {}) => {
    const isFormData = body instanceof FormData;
    const requestHeaders = { ...headers };

    if (cookie) requestHeaders.cookie = cookie;
    if (body !== undefined && !isFormData) {
      requestHeaders["content-type"] = "application/json";
    }

    const response = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    });

    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) {
      cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ");
    }

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }

    return { status: response.status, data, headers: response.headers };
  };

  return {
    get: (path, options) => request("GET", path, options),
    post: (path, body, options) => request("POST", path, { ...options, body }),
    put: (path, body, options) => request("PUT", path, { ...options, body }),
    patch: (path, body, options) => request("PATCH", path, { ...options, body }),
    del: (path, options) => request("DELETE", path, options),
    /** Drops the session, turning the client back into an anonymous visitor. */
    clearSession: () => {
      cookie = "";
    },
  };
};

module.exports = { createClient };
