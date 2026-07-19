-- Migration: Add cement, rait, mazdur to expense_type check constraint.
-- Run this in the Supabase Dashboard SQL Editor.

ALTER TABLE public.construction_expenses
  DROP CONSTRAINT construction_expenses_expense_type_check;

ALTER TABLE public.construction_expenses
  ADD CONSTRAINT construction_expenses_expense_type_check
  CHECK (expense_type IN ('bricks','steel','crush_stone','bajar','cement','rait','mistri','mazdur','plumber','electrician'));
