import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { Router } from "express";

import { createV1Router } from "../src/http/v1";
import { captureEmails, closeDatabase, signedInCustomer, signedInStaff } from "./helpers/accounts";
import { createClient } from "./helpers/api-client";
import { resetTestDatabase } from "./helpers/postgres";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * Every staff route refuses anyone who is not staff with its permission.
 *
 * The routes are read from the running router itself, not listed by hand, so
 * a route added later without a permission check fails here without anyone
 * having to remember to add it to a list.
 */

type Layer = {
  name: string;
  route?: { path: string; methods: Record<string, boolean> };
  handle: { stack?: Layer[] };
  match: (path: string) => boolean;
};

const MOUNTS = ["/staff/reports", "/staff", "/support", "/posts", "/auth", ""];

/** Every [method, path] the router answers, with parameters filled in. */
const routesOf = (router: Router) => {
  const found: { method: string; path: string }[] = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          found.push({ method, path: prefix + layer.route.path });
        }
      } else if (layer.handle.stack) {
        // A mounted router: its prefix is the first one it answers to.
        const mount = MOUNTS.find((candidate) => layer.match(`${candidate}/probe`)) ?? "";
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk((router as unknown as { stack: Layer[] }).stack, "");
  return found.map(({ method, path }) => ({
    method,
    path: path.replace(/:([A-Za-z]+)/g, (_match, name: string) =>
      name === "roleKey" ? "support" : name === "action" ? "sync" : name === "key" ? "payment_received" : "0190a0a0-0000-7000-8000-000000000000",
    ),
  }));
};

let emails: ReturnType<typeof captureEmails>;

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  emails = captureEmails();
});

after(async () => {
  emails.stop();
  await closeDatabase();
  await stopTestServer();
});

describe("The staff area's guard", () => {
  const staffRoutes = routesOf(createV1Router()).filter((route) => route.path.startsWith("/staff"));

  it("finds the staff routes (so the checks below check something)", () => {
    assert.ok(staffRoutes.length > 60, `only ${staffRoutes.length} staff routes found`);
  });

  it("[security] Every staff route answers 401 to a visitor, and 403 to a customer and to staff without its permission", async () => {
    const anonymous = createClient();
    const customer = await signedInCustomer(emails);
    // Staff with a role that grants nothing a staff route asks for.
    const powerless = await signedInStaff(["editor"]);
    const editorAllowed = /^\/staff\/(posts|comments)/;

    const leaks: string[] = [];
    for (const { method, path } of staffRoutes) {
      const call = (client: ReturnType<typeof createClient>) =>
        method === "get"
          ? client.get(`/api/v1${path}`)
          : method === "delete"
            ? client.del(`/api/v1${path}`)
            : method === "put"
              ? client.put(`/api/v1${path}`, {})
              : method === "patch"
                ? client.patch(`/api/v1${path}`, {})
                : client.post(`/api/v1${path}`, {});
      const asVisitor = (await call(anonymous)).status;
      const asCustomer = (await call(customer.client)).status;
      if (asVisitor !== 401) leaks.push(`${method.toUpperCase()} ${path}: visitor got ${asVisitor}`);
      if (asCustomer !== 403) leaks.push(`${method.toUpperCase()} ${path}: customer got ${asCustomer}`);
      if (!editorAllowed.test(path)) {
        const asEditor = (await call(powerless.client)).status;
        if (asEditor !== 403) leaks.push(`${method.toUpperCase()} ${path}: editor got ${asEditor}`);
      }
    }
    assert.deepEqual(leaks, []);
  });
});
