/**
 * Owners who sign in with a username, from the server (`shahkelid owner …`):
 *
 *   owner.ts create <username> [--another]   a new owner; the password on stdin
 *   owner.ts password <username>             a new password, on stdin
 *   owner.ts reset-2fa <username>            two-step sign-in off, to set up again
 *   owner.ts list                            every owner
 *
 * The password comes on standard input, one line, so it is never in the
 * shell history or the process list. The owner is made to set up an
 * authenticator app at their first sign-in.
 */
import { passwordSchema, usernameSchema } from "@shah-kelid/contracts";

import { OwnerExistsError } from "../src/modules/access/bootstrap";
import { createUsernameOwner, listOwners, resetUsernameTwoFactor, setUsernamePassword } from "../src/modules/access/owners";
import { closeDb, getDb } from "../src/platform/db/client";
import { closeAppRedis, getAppRedis } from "../src/platform/redis";

const USAGE = "Usage: owner.ts create <username> [--another] | password <username> | reset-2fa <username> | list";

const readPassword = async () => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const password = Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) throw new Error("The password needs at least 8 characters (and at most 128)");
  return parsed.data;
};

const usernameOf = (value: string | undefined) => {
  const parsed = usernameSchema.safeParse(value ?? "");
  if (!parsed.success) throw new Error("A username is 3 to 32 of a-z, 0-9, dot, dash and underscore");
  return parsed.data;
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  const name = rest.find((arg) => !arg.startsWith("--"));
  const db = getDb();

  switch (command) {
    case "create": {
      const username = usernameOf(name);
      await createUsernameOwner(db, username, await readPassword(), { another: rest.includes("--another") });
      console.log(`${username} is now an owner. They are asked to set up an authenticator app at their first sign-in.`);
      return;
    }
    case "password": {
      const username = usernameOf(name);
      await setUsernamePassword(db, getAppRedis(), username, await readPassword());
      console.log(`${username} has a new password. Every session they had is over.`);
      return;
    }
    case "reset-2fa": {
      const username = usernameOf(name);
      await resetUsernameTwoFactor(db, getAppRedis(), username);
      console.log(`Two-step sign-in is off for ${username}; they set it up again at their next sign-in.`);
      return;
    }
    case "list": {
      for (const owner of await listOwners(db)) {
        console.log(
          [
            owner.username ?? "-",
            owner.email ?? "-",
            owner.twoFactor ? "2fa:on" : "2fa:off",
            owner.lastLoginAt ? `last:${owner.lastLoginAt.toISOString()}` : "last:never",
          ].join("\t"),
        );
      }
      return;
    }
    default:
      console.error(USAGE);
      process.exitCode = 2;
  }
};

main()
  .catch((error) => {
    console.error(
      error instanceof OwnerExistsError
        ? "An owner exists already. Pass --another to add one more on purpose."
        : error instanceof Error
          ? error.message
          : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAppRedis().catch(() => undefined);
    await closeDb();
  });
