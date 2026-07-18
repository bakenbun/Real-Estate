/**
 * BuildLedger's small server-side boundary.
 *
 * The browser talks only to this server. SUPABASE_SECRET_KEY is read from the
 * process environment and is never sent to the browser, local storage, or git.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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

if (!/^https:\/\/.+\.supabase\.co$/.test(supabaseUrl) || !supabaseSecretKey || !workspacePassword) {
  console.error('Missing SUPABASE_URL, SUPABASE_SECRET_KEY, or WORKSPACE_PASSWORD. Copy .env.example to .env and set all values.');
  process.exit(1);
}

const expenseTypes = new Set(['bricks', 'steel', 'crush_stone', 'bajar', 'mistri', 'plumber', 'electrician']);
const expenseGroups = new Set(['material', 'labour']);
const staticTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
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
  const token = cookieValue(request, 'buildledger_session');
  const expiresAt = token && sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
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
  if (isMaterial !== ['bricks', 'steel', 'crush_stone', 'bajar'].includes(value.expense_type)) throw new Error('Expense group and type do not match.');
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
    console.error(`Supabase request failed (${response.status}):`, await response.text());
    throw new Error('Database request failed.');
  }
  if (response.status === 204) return null;
  return response.json();
}

async function serveFile(request, response, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safePath = normalize(requested).replace(/^([/\\])+/, '');
  if (!['index.html', 'app.js', 'styles.css'].includes(safePath)) return sendJson(response, 404, { error: 'Not found.' });
  try {
    const data = await readFile(join(root, safePath));
    response.writeHead(200, { ...securityHeaders, 'Content-Type': staticTypes[extname(safePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch { sendJson(response, 404, { error: 'Not found.' }); }
}

const server = createServer(async (request, response) => {
  purgeExpiredSessions();
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
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
        const records = await supabase('construction_expenses?select=*&order=entry_date.desc,created_at.desc');
        return sendJson(response, 200, records);
      }
      if (request.method === 'POST' && pathname === '/api/expenses') {
        const expense = validateExpense(await readJson(request));
        const [created] = await supabase('construction_expenses', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(expense) });
        return sendJson(response, 201, created);
      }
      if (request.method === 'DELETE' && pathname.startsWith('/api/expenses/')) {
        const id = pathname.slice('/api/expenses/'.length);
        if (!uuid.test(id)) return sendJson(response, 400, { error: 'Invalid expense id.' });
        await supabase(`construction_expenses?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
        return sendJson(response, 200, { deleted: true });
      }
      return sendJson(response, 405, { error: 'Method not allowed.' });
    }

    if (request.method === 'GET') return serveFile(request, response, pathname);
    return sendJson(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    return sendJson(response, 400, { error: 'Request could not be completed.' });
  }
});

server.listen(port, host, () => console.log(`BuildLedger is running at http://${host}:${port}`));
