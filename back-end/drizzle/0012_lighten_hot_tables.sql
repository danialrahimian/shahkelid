-- Usage, time and status are written to these two tables at every sync, row
-- by row as they change. Room left in each page lets PostgreSQL rewrite a
-- row in place (a HOT update: no new index entries, nothing for the indexes
-- to clean up), since the sync writes no indexed column. Autovacuum is asked
-- to come sooner than the default 20% of the table, so dead rows do not pile
-- up between visits on a large table.
--
-- The fill factor applies to pages written from now on; existing pages get
-- the room as rows move. (VACUUM FULL in a quiet hour applies it at once.)
ALTER TABLE "subscription_panels" SET (fillfactor = 80, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.05);--> statement-breakpoint
ALTER TABLE "subscriptions" SET (fillfactor = 85, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.05);--> statement-breakpoint
ALTER TABLE "panels" SET (fillfactor = 50);
