-- Allow multiple invoices per (hospital, month).
--
-- The bill-generation flow previously rejected a second invoice for the same
-- hospital in the same calendar month, enforced by a partial unique index. An
-- operator may legitimately bill a hospital more than once in a month (an early
-- batch, then later claims), so that restriction is removed. Double-billing a
-- single claim is still prevented at the claim level (isBilled flag).
DROP INDEX IF EXISTS "invoices_hospital_id_month_regular_not_void_key";
