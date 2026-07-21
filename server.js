/**
 * BuildLedger's small server-side boundary.
 *
 * The browser talks only to this server. SUPABASE_SECRET_KEY is read from the
 * process environment and is never sent to the browser, local storage, or git.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || '';
const workspacePassword = process.env.WORKSPACE_PASSWORD || '';
const production = process.env.NODE_ENV === 'production';
const sessions = new Map();
const sessionLifetimeMs = 12 * 60 * 60 * 1000;

if (!/^https:\/\/.+\.supabase\.co$/.test(supabaseUrl) || !supabaseSecretKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Copy .env.example to .env and set all values.');
  process.exit(1);
}

const expenseTypes = new Set(['bricks', 'steel', 'crush_stone', 'bajar', 'cement', 'rait', 'mistri', 'mazdur', 'plumber', 'electrician']);
const expenseGroups = new Set(['material', 'labour']);
const staticTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(payload));
}

function constantTimeEquals(left, right) {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cookieValue(request, name) {
  const value = request.headers.cookie || '';
  return value.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function activeSession(request) {
  // Direct access is enabled: no password required, always authenticated
  return true;
}

function purgeExpiredSessions() {
  for (const [token, expiresAt] of sessions) if (expiresAt <= Date.now()) sessions.delete(token);
}

function trustedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  return origin === `http://${request.headers.host}` || origin === `https://${request.headers.host}`;
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20_000) throw new Error('Request body is too large.');
  }
  try { return JSON.parse(body || '{}'); } catch { throw new Error('Request body must be valid JSON.'); }
}

function text(value, max = 500) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error('Text fields must be text.');
  return value.trim().slice(0, max) || null;
}

function number(value, field, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error(`${field} is required.`);
    return null;
  }
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number.`);
  return Number(value);
}

function validateExpense(value) {
  if (!value || typeof value !== 'object') throw new Error('Expense payload is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.entry_date || '')) throw new Error('A valid entry date is required.');
  if (!expenseGroups.has(value.expense_group) || !expenseTypes.has(value.expense_type)) throw new Error('Invalid expense type.');
  const isMaterial = value.expense_group === 'material';
  if (isMaterial !== ['bricks', 'steel', 'crush_stone', 'bajar', 'cement', 'rait'].includes(value.expense_type)) throw new Error('Expense group and type do not match.');
  return {
    entry_date: value.entry_date,
    expense_group: value.expense_group,
    expense_type: value.expense_type,
    category: text(value.category, 120),
    supplier: text(value.supplier, 160),
    quantity: isMaterial ? number(value.quantity, 'Quantity') : null,
    unit: isMaterial ? text(value.unit, 24) : null,
    unit_price: isMaterial ? number(value.unit_price, 'Unit price') : null,
    amount: number(value.amount, 'Amount', true),
    work_category: !isMaterial ? text(value.work_category, 240) : null,
    notes: text(value.notes, 1_000),
  };
}

async function supabase(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseSecretKey,
      Authorization: `Bearer ${supabaseSecretKey}`,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const raw = await response.text();
    console.error(`Supabase request failed (${response.status}):`, raw);
    let message = raw;
    try {
      const parsed = JSON.parse(raw);
      message = parsed.message || parsed.error || parsed.hint || raw;
    } catch { /* raw text already suitable */ }
    const err = new Error(`Supabase ${response.status}: ${String(message).slice(0, 400)}`);
    err.status = response.status;
    err.supabase = true;
    throw err;
  }
  if (response.status === 204) return null;
  return response.json();
}

/* ---------- Local text-file backup ----------
 * On every Supabase write/delete we mirror the full record set to a plain-text
 * JSON file on disk. If Supabase is unreachable, writes are also queued so they
 * can be flushed automatically the next time the server starts.
 *
 * Files live outside the git repo and outside the served static set:
 *   BACKUP_DIR/expenses.json   -> pretty-printed authoritative snapshot
 *   BACKUP_DIR/pending.jsonl   -> newline-delimited queue of unsent writes
 *
 * Filesystem writes are skipped on Vercel (read-only FS).
 */
const backupEnabled = !process.env.VERCEL && process.env.DISABLE_LOCAL_BACKUP !== '1';
const backupDir = process.env.BACKUP_DIR || join(root, 'data');
const backupFile = join(backupDir, 'expenses.json');
const pendingFile = join(backupDir, 'pending.jsonl');

async function ensureBackupDir() {
  if (!backupEnabled) return;
  await mkdir(backupDir, { recursive: true });
}

async function writeSnapshot(records) {
  if (!backupEnabled) return;
  await ensureBackupDir();
  const body = JSON.stringify({ updated_at: new Date().toISOString(), count: records.length, records }, null, 2);
  const tmp = `${backupFile}.tmp`;
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, backupFile);
}

async function readSnapshot() {
  if (!backupEnabled) return null;
  try {
    const raw = await readFile(backupFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed.records || []);
  } catch { return null; }
}

async function queuePending(op) {
  if (!backupEnabled) return;
  await ensureBackupDir();
  const line = JSON.stringify({ ...op, queued_at: new Date().toISOString() }) + '\n';
  await writeFile(pendingFile, line, { flag: 'a', encoding: 'utf8' });
}

async function drainPending() {
  if (!backupEnabled) return;
  let raw;
  try { raw = await readFile(pendingFile, 'utf8'); } catch { return; }
  const lines = raw.split('\n').filter(Boolean);
  const survivors = [];
  for (const line of lines) {
    let op;
    try { op = JSON.parse(line); } catch { continue; }
    try {
      if (op.type === 'insert') {
        await supabase('construction_expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(op.record) });
      } else if (op.type === 'delete' && op.id) {
        await supabase(`construction_expenses?id=eq.${encodeURIComponent(op.id)}`, { method: 'DELETE' });
      }
    } catch (err) {
      console.warn('[backup] deferred op still failing, will retry next startup:', err.message);
      survivors.push(line);
    }
  }
  if (survivors.length) await writeFile(pendingFile, survivors.join('\n') + '\n', 'utf8');
  else await writeFile(pendingFile, '', 'utf8');
}

async function refreshSnapshotFromSupabase() {
  if (!backupEnabled) return;
  try {
    const records = await supabase('construction_expenses?select=*&order=entry_date.desc,created_at.desc');
    await writeSnapshot(records || []);
    console.log(`[backup] Snapshot refreshed (${(records || []).length} records) -> ${backupFile}`);
  } catch (err) {
    console.warn('[backup] Could not refresh snapshot from Supabase:', err.message);
  }
}

async function bootstrapBackup() {
  if (!backupEnabled) return;
  try {
    await ensureBackupDir();
    await drainPending();
    await refreshSnapshotFromSupabase();
  } catch (err) {
    console.warn('[backup] Bootstrap failed (non-fatal):', err.message);
  }
}

async function serveFile(request, response, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safePath = normalize(requested).replace(/^([/\\])+/, '');
  const isIcon = safePath.startsWith('icons/') && (safePath.endsWith('.png') || safePath.endsWith('.ico'));
  const isStatic = ['index.html', 'app.js', 'styles.css', 'manifest.json', 'sw.js'].includes(safePath) || isIcon;
  if (!isStatic) return sendJson(response, 404, { error: 'Not found.' });
  try {
    const data = await readFile(join(root, safePath));
    response.writeHead(200, { ...securityHeaders, 'Content-Type': staticTypes[extname(safePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch { sendJson(response, 404, { error: 'Not found.' }); }
}

export default async function handler(request, response) {
  purgeExpiredSessions();
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (request.method === 'GET' && pathname === '/api/health') return sendJson(response, 200, { ok: true });
    if (request.method === 'GET' && pathname === '/api/session') return sendJson(response, 200, { authenticated: activeSession(request) });
    if (request.method === 'POST' && pathname === '/api/session') {
      if (!trustedOrigin(request)) return sendJson(response, 403, { error: 'Request origin is not allowed.' });
      const { password } = await readJson(request);
      if (!constantTimeEquals(password, workspacePassword)) return sendJson(response, 401, { error: 'Incorrect workspace password.' });
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, Date.now() + sessionLifetimeMs);
      const secure = production ? '; Secure' : '';
      return sendJson(response, 200, { authenticated: true }, { 'Set-Cookie': `buildledger_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetimeMs / 1000}${secure}` });
    }

    if (pathname.startsWith('/api/')) {
      if (!activeSession(request)) return sendJson(response, 401, { error: 'Unlock the workspace first.' });
      if (!trustedOrigin(request)) return sendJson(response, 403, { error: 'Request origin is not allowed.' });

      if (request.method === 'GET' && pathname === '/api/expenses') {
        try {
          const records = await supabase('construction_expenses?select=*&order=entry_date.desc,created_at.desc');
          await writeSnapshot(records || []);
          return sendJson(response, 200, records);
        } catch (err) {
          const fallback = await readSnapshot();
          if (fallback) {
            console.warn('[backup] Serving GET from local snapshot:', err.message);
            return sendJson(response, 200, fallback);
          }
          throw err;
        }
      }
      if (request.method === 'POST' && pathname === '/api/expenses') {
        const expense = validateExpense(await readJson(request));
        try {
          const [created] = await supabase('construction_expenses', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(expense) });
          const snap = (await readSnapshot()) || [];
          await writeSnapshot([created, ...snap]);
          return sendJson(response, 201, created);
        } catch (err) {
          // If the server was reachable but rejected the row (validation, constraint), don't queue — surface it.
          if (err.supabase && err.status && err.status >= 400 && err.status < 500) throw err;
          // Otherwise treat as offline: queue and stash a local copy so the user does not lose the entry.
          const localId = `pending-${randomBytes(8).toString('hex')}`;
          const stash = { ...expense, id: localId, created_at: new Date().toISOString(), pending_sync: true };
          await queuePending({ type: 'insert', record: expense });
          const snap = (await readSnapshot()) || [];
          await writeSnapshot([stash, ...snap]);
          console.warn('[backup] Supabase POST failed, saved locally for later sync:', err.message);
          return sendJson(response, 202, stash);
        }
      }
      if (request.method === 'DELETE' && pathname.startsWith('/api/expenses/')) {
        const id = pathname.slice('/api/expenses/'.length);
        if (!uuid.test(id)) return sendJson(response, 400, { error: 'Invalid expense id.' });
        try {
          await supabase(`construction_expenses?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch (err) {
          if (err.supabase && err.status && err.status >= 400 && err.status < 500) throw err;
          await queuePending({ type: 'delete', id });
          console.warn('[backup] Supabase DELETE failed, queued for retry:', err.message);
        }
        const snap = await readSnapshot();
        if (snap) await writeSnapshot(snap.filter(r => r.id !== id));
        return sendJson(response, 200, { deleted: true });
      }
      return sendJson(response, 405, { error: 'Method not allowed.' });
    }

    if (request.method === 'GET') return serveFile(request, response, pathname);
    return sendJson(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    const status = Number.isInteger(error.status) ? error.status : 400;
    return sendJson(response, status, { error: error.message || 'Request could not be completed.' });
  }
}

if (!process.env.VERCEL) {
  const server = createServer(handler);
  server.listen(port, host, () => console.log(`BuildLedger is running at http://${host}:${port}`));
  bootstrapBackup();
}
