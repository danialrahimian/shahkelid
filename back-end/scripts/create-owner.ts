/**
 * Makes the first owner of a new database.
 *
 *   npm run create-owner -- owner@example.com
 *   npm run create-owner -- second.owner@example.com --another
 *
 * The owner then signs in on the site with a code emailed to that address and
 * is made to set up an authenticator app before anything else. No password is
 * asked for here, so none ends up in the shell history.
 *
 * Refuses when an owner already exists; pass --another to add one on purpose.
 * Later owners are better added from the staff screens by an existing owner,
 * where the change carries their name in the audit log.
 */
import { emailSchema } from "@shah-kelid/contracts";

import config from "../src/config";
import { appointOwner, OwnerExistsError } from "../src/modules/access/bootstrap";
import { closeDb, getDb } from "../src/platform/db/client";

const main = async () => {
  const args = process.argv.slice(2);
  const another = args.includes("--another");
  const address = args.find((arg) => !arg.startsWith("--"));

  const email = emailSchema.safeParse(address ?? "");
  if (!email.success) {
    console.error("Usage: npm run create-owner -- <email> [--another]");
    process.exitCode = 1;
    return;
  }

  try {
    const { created } = await appointOwner(getDb(), email.data, { another });
    console.log(
      created
        ? `${email.data} is now an owner. Sign in at ${config.cors.origin}/account/sign-in with a code sent to that address.`
        : `${email.data} was already an owner. Nothing changed.`,
    );
  } catch (error) {
    if (error instanceof OwnerExistsError) {
      console.error("An owner already exists. Pass --another to add one more on purpose.");
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await closeDb();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
