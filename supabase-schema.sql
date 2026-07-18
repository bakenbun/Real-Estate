-- BuildLedger: server-only Supabase database schema.
-- Browser clients do not connect to Supabase directly. The server uses a secret key.

create table if not exists public.construction_expenses (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  expense_group text not null check (expense_group in ('material', 'labour')),
  expense_type text not null check (expense_type in ('bricks', 'steel', 'crush_stone', 'bajar', 'mistri', 'plumber', 'electrician')),
  category text,
  supplier text,
  quantity numeric(14,2),
  unit text,
  unit_price numeric(14,2),
  amount numeric(14,2) not null check (amount >= 0),
  work_category text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists construction_expenses_date_idx on public.construction_expenses (entry_date desc);
create index if not exists construction_expenses_group_idx on public.construction_expenses (expense_group);

alter table public.construction_expenses enable row level security;

-- No anonymous browser access. The trusted server uses a Supabase secret key,
-- which bypasses RLS and is kept exclusively in its environment variables.
drop policy if exists "Allow public read for construction ledger" on public.construction_expenses;
drop policy if exists "Allow public insert for construction ledger" on public.construction_expenses;
drop policy if exists "Allow public delete for construction ledger" on public.construction_expenses;
