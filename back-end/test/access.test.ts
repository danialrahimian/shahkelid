import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { appointOwner, OwnerExistsError } from "../src/modules/access/bootstrap";
import { auditLogs, rolePermissions, roles, userRoles } from "../src/modules/access/schema";
import { createClient } from "./helpers/api-client";
import { aStaffMember, captureEmails, closeDatabase, database, uniqueEmail } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * Roles, permissions and the audit log: /api/v1/staff.
 *
 * The rules under test hold whatever a screen offers: only role managers
 * change roles, nobody hands out more power than they have, only owners touch
 * the owner role, the last owner stays, and every change is written down.
 */

const V1 = "/api/v1";
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

/** A member of staff, fully signed in: password, then authenticator code. */
const signedInStaff = async (roleKeys: string[]) => {
  const staff = await aStaffMember({ roleKeys, withAuthenticator: true });
  const client = createClient();
  await client.post(`${V1}/auth/password`, { email: staff.email, password: staff.password });
  const verified = await client.post(`${V1}/auth/two-factor/verify`, {
    code: staff.authenticator!.next(),
  });
  assert.equal(verified.data.status, "signed_in");
  return { ...staff, client };
};

const aCustomer = async () => {
  const client = createClient();
  const email = uniqueEmail("customer");
  await client.post(`${V1}/auth/code`, { email });
  const response = await client.post(`${V1}/auth/code/verify`, {
    email,
    code: emails.lastCodeFor(email),
  });
  return { client, id: response.data.account.id as string };
};

/** A custom role, made directly: its permissions are what the test needs. */
const aCustomRole = async (key: string, permissions: string[]) => {
  const db = database();
  const [role] = await db
    .insert(roles)
    .values({ key, name: key, isSystem: false })
    .returning();
  await db.insert(rolePermissions).values(permissions.map((permission) => ({ roleId: role!.id, permission })));
  return role!;
};

describe("Who may see and change roles", () => {
  it("When a customer asks for the roles, then it is forbidden", async () => {
    const customer = await aCustomer();

    const response = await customer.client.get(`${V1}/staff/roles`);

    assert.equal(response.status, 403);
    assert.equal(response.data.error.code, "FORBIDDEN");
  });

  it("When an admin (who cannot manage roles) tries to give one, then it is forbidden", async () => {
    const admin = await signedInStaff(["admin"]);
    const customer = await aCustomer();

    const response = await admin.client.post(`${V1}/staff/users/${customer.id}/roles/support`, {});

    assert.equal(response.status, 403);
  });

  it("When the roles are listed, then the built-in ones are there with their permissions", async () => {
    const owner = await signedInStaff(["owner"]);

    const response = await owner.client.get(`${V1}/staff/roles`);

    const support = response.data.find((role: { key: string }) => role.key === "support");
    assert.ok(support.isSystem);
    assert.ok(support.permissions.includes("tickets:reply"));
    assert.ok(!support.permissions.includes("users:manage_roles"));
  });
});

describe("Changing roles", () => {
  it("[acceptance] When an owner gives and then takes away a role, then both are in the audit log", async () => {
    const owner = await signedInStaff(["owner"]);
    const customer = await aCustomer();

    const granted = await owner.client.post(`${V1}/staff/users/${customer.id}/roles/support`, {});
    assert.deepEqual(granted.data.roles, ["support"]);
    const revoked = await owner.client.del(`${V1}/staff/users/${customer.id}/roles/support`);
    assert.deepEqual(revoked.data.roles, []);

    const log = await owner.client.get(`${V1}/staff/audit?entityType=user&entityId=${customer.id}`);
    const [revokedEntry, grantedEntry] = log.data.entries;

    assert.equal(grantedEntry.action, "access.role_granted");
    assert.equal(grantedEntry.actorUserId, owner.id);
    assert.deepEqual(grantedEntry.before, { roles: [] });
    assert.deepEqual(grantedEntry.after, { roles: ["support"] });

    assert.equal(revokedEntry.action, "access.role_revoked");
    assert.deepEqual(revokedEntry.before, { roles: ["support"] });
    assert.deepEqual(revokedEntry.after, { roles: [] });
  });

  it("When a role is taken away, then it stops working on the very next request", async () => {
    const owner = await signedInStaff(["owner"]);
    const admin = await signedInStaff(["admin"]);
    assert.equal((await admin.client.get(`${V1}/staff/roles`)).status, 200);

    await owner.client.del(`${V1}/staff/users/${admin.id}/roles/admin`);

    assert.equal((await admin.client.get(`${V1}/staff/roles`)).status, 403);
  });

  it("When a role manager tries to give a role more powerful than their own, then it is refused", async () => {
    // Can manage roles and nothing else: may not create an admin.
    await aCustomRole("role_manager", ["users:read", "users:manage_roles"]);
    const manager = await signedInStaff(["role_manager"]);
    const customer = await aCustomer();

    const response = await manager.client.post(`${V1}/staff/users/${customer.id}/roles/admin`, {});

    assert.equal(response.status, 403);
    assert.match(response.data.error.message, /permissions you do not have/);
  });

  it("When a role manager gives a role within their own permissions, then it is allowed", async () => {
    await aCustomRole("viewer", ["users:read"]);
    const manager = await signedInStaff(["role_manager"]);
    const customer = await aCustomer();

    const response = await manager.client.post(`${V1}/staff/users/${customer.id}/roles/viewer`, {});

    assert.equal(response.status, 200);
  });

  it("When someone other than an owner touches the owner role, then it is refused", async () => {
    await aCustomRole("everything_but_owner", [
      "users:read",
      "users:manage_roles",
      "audit:read",
      "plans:manage",
      "servers:manage",
      "orders:read",
      "payments:review",
      "subscriptions:manage",
      "customers:read",
      "customers:manage",
      "tickets:reply",
      "content:manage",
      "analytics:read",
      "settings:manage",
    ]);
    const almostOwner = await signedInStaff(["everything_but_owner"]);
    const customer = await aCustomer();

    const response = await almostOwner.client.post(`${V1}/staff/users/${customer.id}/roles/owner`, {});

    assert.equal(response.status, 403);
    assert.match(response.data.error.message, /Only an owner/);
  });

  it("When the last owner would be removed, then it is refused", async () => {
    // Leave exactly one owner in the database.
    const db = database();
    const [ownerRole] = await db.select().from(roles).where(eq(roles.key, "owner"));
    await db.delete(userRoles).where(eq(userRoles.roleId, ownerRole!.id));
    const owner = await signedInStaff(["owner"]);

    const response = await owner.client.del(`${V1}/staff/users/${owner.id}/roles/owner`);

    assert.equal(response.status, 409);
    const stillOwner = await owner.client.get(`${V1}/staff/users/${owner.id}/access`);
    assert.deepEqual(stillOwner.data.roles, ["owner"]);
  });

  it("When the user id is not a valid id, then it is a 400, not a 500", async () => {
    const owner = await signedInStaff(["owner"]);

    const response = await owner.client.post(`${V1}/staff/users/not-an-id/roles/support`, {});

    assert.equal(response.status, 400);
  });
});

describe("The audit log", () => {
  it("When someone without audit:read asks for it, then it is forbidden", async () => {
    const support = await signedInStaff(["support"]);

    assert.equal((await support.client.get(`${V1}/staff/audit`)).status, 403);
  });

  it("When the log is paged, then each page continues where the last stopped", async () => {
    const owner = await signedInStaff(["owner"]);
    const customer = await aCustomer();
    for (const role of ["support", "editor", "accountant"]) {
      await owner.client.post(`${V1}/staff/users/${customer.id}/roles/${role}`, {});
    }

    const first = await owner.client.get(`${V1}/staff/audit?entityId=${customer.id}&limit=2`);
    const second = await owner.client.get(
      `${V1}/staff/audit?entityId=${customer.id}&limit=2&before=${first.data.nextBefore}`,
    );

    assert.equal(first.data.entries.length, 2);
    assert.equal(second.data.entries.length, 1);
    const ids = [...first.data.entries, ...second.data.entries].map((e: { id: number }) => e.id);
    assert.equal(new Set(ids).size, 3, "no entry is repeated across pages");
  });
});

describe("The first owner (npm run create-owner)", () => {
  const withNoOwners = async () => {
    const db = database();
    const [ownerRole] = await db.select().from(roles).where(eq(roles.key, "owner"));
    await db.delete(userRoles).where(eq(userRoles.roleId, ownerRole!.id));
  };

  it("When the store has no owner, then the address becomes one, and it is in the audit log", async () => {
    await withNoOwners();
    const email = uniqueEmail("first.owner");

    const { userId, created } = await appointOwner(database(), email);

    assert.equal(created, true);
    const [entry] = await database()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, userId), eq(auditLogs.action, "access.role_granted")));
    assert.equal(entry!.actorKind, "system");
    assert.deepEqual(entry!.after, { roles: ["owner"] });
  });

  it("When the new owner signs in with a code, then they must set up an authenticator first", async () => {
    await withNoOwners();
    const email = uniqueEmail("first.owner");
    await appointOwner(database(), email);
    const client = createClient();

    await client.post(`${V1}/auth/code`, { email });
    const signedIn = await client.post(`${V1}/auth/code/verify`, {
      email,
      code: emails.lastCodeFor(email),
    });

    assert.equal(signedIn.data.status, "two_factor_setup_required");
    assert.equal((await client.get(`${V1}/staff/roles`)).status, 403);
  });

  it("When an owner already exists, then another is refused unless asked for on purpose", async () => {
    await withNoOwners();
    await appointOwner(database(), uniqueEmail("first.owner"));

    await assert.rejects(appointOwner(database(), uniqueEmail("second.owner")), OwnerExistsError);
    const second = await appointOwner(database(), uniqueEmail("second.owner"), { another: true });
    assert.equal(second.created, true);
  });

  it("When it is run twice at the same moment on an empty store, then only one owner is made", async () => {
    await withNoOwners();

    const results = await Promise.allSettled([
      appointOwner(database(), uniqueEmail("racer.a")),
      appointOwner(database(), uniqueEmail("racer.b")),
    ]);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const [ownerRole] = await database().select().from(roles).where(eq(roles.key, "owner"));
    const owners = await database().select().from(userRoles).where(eq(userRoles.roleId, ownerRole!.id));
    assert.equal(owners.length, 1);
  });
});
