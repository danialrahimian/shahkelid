import { eq } from "drizzle-orm";

import type { Db, Executor } from "../../platform/db/client";
import { createVerifiedAccount, findUserByEmail } from "../identity/service";
import { writeAudit } from "./audit";
import { rolesOf } from "./roles";
import { roles, userRoles } from "./schema";

/**
 * Makes an account an owner, from the command line (scripts/create-owner.ts).
 *
 * A new database has nobody who can reach the staff screens, and roles are
 * only granted by someone who already has them. Whoever runs this already
 * controls the server, so it is not a way around the rules; it is how the
 * first owner comes to exist.
 *
 * No password is set here. The owner signs in with a code sent to the
 * address, which proves it is theirs, and the owner role then makes them set
 * up an authenticator before they can do anything else.
 *
 * Refuses when an owner already exists, unless `another` is set, so running
 * it twice by mistake does not quietly add a second owner.
 */
export class OwnerExistsError extends Error {
  constructor() {
    super("An owner already exists");
    this.name = "OwnerExistsError";
  }
}

/**
 * Gives an account the owner role, inside the caller's transaction. Refuses
 * when an owner exists already, unless `another`. True when it was granted
 * now, false when the account was an owner already.
 */
export const grantOwner = async (tx: Executor, userId: string, { another = false } = {}) => {
  // The role row is locked, not the owners: with no owners yet there is no
  // row to lock, and two runs at once would both see "no owner yet".
  const [ownerRole] = await tx.select().from(roles).where(eq(roles.key, "owner")).for("update");
  if (!ownerRole) throw new Error("The owner role is missing: run the migrations first");

  const owners = await tx
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.roleId, ownerRole.id));
  const ownerIds = owners.map((row) => row.userId);
  if (ownerIds.includes(userId)) return false;
  if (ownerIds.length > 0 && !another) throw new OwnerExistsError();

  const before = await rolesOf(tx, userId);
  await tx.insert(userRoles).values({ userId, roleId: ownerRole.id });
  await writeAudit(tx, {
    actorKind: "system",
    action: "access.role_granted",
    entityType: "user",
    entityId: userId,
    before: { roles: before },
    after: { roles: await rolesOf(tx, userId) },
  });
  return true;
};

export const appointOwner = async (db: Db, email: string, { another = false } = {}) => {
  const account = (await findUserByEmail(db, email)) ?? (await createVerifiedAccount(db, email));
  const created = await db.transaction((tx) => grantOwner(tx, account.id, { another }));
  return { userId: account.id, created };
};
