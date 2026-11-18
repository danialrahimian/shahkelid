-- Hosts are now known by an id made from the config a panel gives (a
-- reseller's account cannot read the panel's host ids). Picks, names and
-- places kept under the panel's old ids no longer point at anything: they
-- go, and the groups start from their panel groups' defaults.
DELETE FROM "group_hosts";--> statement-breakpoint
ALTER TABLE "group_hosts" ALTER COLUMN "host_id" SET DATA TYPE text;
