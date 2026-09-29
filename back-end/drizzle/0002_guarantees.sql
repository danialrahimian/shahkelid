-- Written by hand: the rules the database enforces on its own, which
-- drizzle-kit cannot express. Taken unchanged from the approved design,
-- docs/02-schema.sql, where each is tested by docs/schema-check.

-- -------------------------------------------------------------- append-only
-- Audit entries, issued invoices and ledger entries are history. They are
-- never edited or deleted: a correction is a new row that reverses the old.

CREATE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER invoices_immutable
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- -------------------------------------------------------------------- ledger
-- The cached balance moves with every entry, in the same statement. The
-- UPDATE takes a row lock, so two concurrent spends queue up, and the second
-- fails the non-negative check instead of overdrawing.

CREATE FUNCTION ledger_apply_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ledger_accounts
     SET balance_toman = balance_toman + NEW.amount_toman
   WHERE id = NEW.account_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_apply
  AFTER INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_apply_entry();
--> statement-breakpoint

-- A transaction must balance by the time it commits. Deferred, so its entries
-- can be inserted one at a time inside the transaction.
CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total bigint;
BEGIN
  SELECT coalesce(sum(amount_toman), 0) INTO total
    FROM ledger_entries
   WHERE transaction_id = NEW.transaction_id;

  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance (off by %)',
      NEW.transaction_id, total USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();
