# BuildLedger — Construction Cost Manager

A lightweight construction-cost manager. The browser is plain HTML, CSS, and JavaScript; a small Node server connects to Supabase so no Supabase key reaches the client.

## What it tracks

- **Bricks:** date, category/quality, total price, quantity, supplier, price per brick
- **Steel:** date, category/quality, total price, quantity, supplier, price per ton
- **Crush stone (bajri):** date, category/type, total price, quantity, supplier, price per cubic foot
- **Bajar:** date, category, total price, quantity, supplier, price per cubic foot
- **Mistri:** date and payment given
- **Plumber and electrician:** date, payment, work category/completed work
- **Dashboard:** total spend, materials versus labour, category breakdown, largest cost, and recent activity

## Run securely

1. Apply [`supabase-schema.sql`](supabase-schema.sql) once. It enables RLS and removes all anonymous policies from `construction_expenses`.
2. Copy `.env.example` to `.env`.
3. In `.env`, set:
   - `SUPABASE_URL` — your project URL
   - `SUPABASE_SECRET_KEY` — a Supabase **secret** key (never a publishable key)
   - `WORKSPACE_PASSWORD` — a long, unique password for this ledger
4. Start the app:

   ```bash
   npm start
   ```

5. Open `http://127.0.0.1:3000` and enter the workspace password.

The server binds to `127.0.0.1` by default, so it is not exposed to your local network. The browser receives only an HTTP-only, same-site session cookie; it never receives a Supabase URL, publishable key, or secret key. The server validates inputs before using its environment-only secret key to access Supabase.

## Deployment

Keep `.env` out of source control—it is already ignored. For a public deployment, set `NODE_ENV=production`, run behind HTTPS, retain the access-password requirement, and configure the host platform's encrypted environment variables instead of uploading `.env`.

The Supabase secret key must be rotated if it has ever been pasted into a chat, terminal history, or other insecure location.
