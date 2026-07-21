-- Migration: Ensure expense_type check constraint accepts cement, rait, mazdur.
-- Safe to re-run. Paste into Supabase Dashboard -> SQL Editor and click Run.
--
-- Why this is needed:
--   `create table if not exists` in supabase-schema.sql does NOT alter an
--   existing constraint. If the table was created before cement/rait/mazdur
--   were added to the code, INSERTs with those values fail with:
--     "new row for relation ... violates check constraint
--      construction_expenses_expense_type_check"

ALTER TABLE public.construction_expenses
  DROP CONSTRAINT IF EXISTS construction_expenses_expense_type_check;

ALTER TABLE public.construction_expenses
  ADD CONSTRAINT construction_expenses_expense_type_check
  CHECK (expense_type IN (
    'bricks','steel','crush_stone','bajar','cement','rait',
    'mistri','mazdur','plumber','electrician'
  ));
