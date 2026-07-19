/* BuildLedger - browser UI. Supabase credentials stay on the server. */

const EXPENSE_TYPES = {
  material: {
    bricks: { label: 'Bricks', unit: 'bricks', symbol: '▦', color: '#d9793f' },
    steel: { label: 'Steel', unit: 'tons', symbol: '╬', color: '#6576a9' },
    crush_stone: { label: 'Crush stone (Bajri)', unit: 'cft', symbol: '◆', color: '#6b9b8a' },
    bajar: { label: 'Bajar', unit: 'cft', symbol: '◒', color: '#b68141' },
    cement: { label: 'Cement', unit: 'bags', symbol: '◉', color: '#7a8b6f' },
    rait: { label: 'Rait', unit: 'kg', symbol: '⫘', color: '#8b6e5a' },
  },
  labour: {
    mistri: { label: 'Mistri', unit: 'payment', symbol: '♧', color: '#5067a8', parent: 'Contractor' },
    mazdur: { label: 'Mazdur', unit: 'payment', symbol: '⛏', color: '#6e7fb5', parent: 'Contractor' },
    electrician: { label: 'Electrician', unit: 'payment', symbol: 'ϟ', color: '#a9687b', parent: 'Contractor' },
    plumber: { label: 'Plumber', unit: 'payment', symbol: '⌁', color: '#367d96' },
  },
};

const DEFAULT_DATA = [];
const state = { expenses: [], view: 'dashboard', period: 'all', filter: 'all', search: '', unlocked: false };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function today() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
function money(value) {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0, currencyDisplay: 'narrowSymbol' })
    .format(Number(value || 0)).replace('PKR', 'Rs');
}
function compactMoney(value) {
  const n = Number(value || 0);
  if (n >= 10000000) return `Rs ${(n / 10000000).toFixed(1)} cr`;
  if (n >= 100000) return `Rs ${(n / 100000).toFixed(1)} lac`;
  if (n >= 1000) return `Rs ${(n / 1000).toFixed(1)}k`;
  return money(n);
}
function typeInfo(type) { return EXPENSE_TYPES.material[type] || EXPENSE_TYPES.labour[type] || { label: type, unit: '', symbol: '•', color: '#5d9c78' }; }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c])); }
function showToast(message, isError = false) { const toast = $('#toast'); toast.textContent = message; toast.className = `toast show${isError ? ' error' : ''}`; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.className = 'toast', 3300); }

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    credentials: 'same-origin',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'Secure server request failed.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showAccessDialog() {
  const dialog = $('#accessDialog');
  if (!dialog.open) dialog.showModal();
  $('#accessPassword').focus();
}

function showServerRequired() {
  const dialog = $('#serverDialog');
  if (!dialog.open) dialog.showModal();
}

async function fetchExpenses() {
  try {
    state.expenses = await api('/api/expenses');
    state.unlocked = true;
  } catch (error) {
    state.expenses = DEFAULT_DATA;
    state.unlocked = false;
    if (error.status === 401) showAccessDialog();
    else showServerRequired();
  }
  renderAll();
}

async function saveExpense(expense) {
  if (!state.unlocked) { showAccessDialog(); return false; }
  try {
    const saved = await api('/api/expenses', { method: 'POST', body: JSON.stringify(expense) });
    state.expenses.unshift(saved); renderAll(); showToast('Expense saved securely.'); return true;
  } catch (error) { showToast(error.status === 401 ? 'Session expired. Unlock the workspace again.' : 'Could not save this expense.', true); if (error.status === 401) showAccessDialog(); return false; }
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense record?')) return;
  if (!state.unlocked) { showAccessDialog(); return; }
  try {
    await api(`/api/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.expenses = state.expenses.filter(item => item.id !== id); renderAll(); showToast('Record deleted.');
  } catch (error) { showToast(error.status === 401 ? 'Session expired. Unlock the workspace again.' : 'Could not delete this record.', true); if (error.status === 401) showAccessDialog(); }
}

function filteredForPeriod() {
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  return state.expenses.filter(item => {
    if (state.period === 'all') return true;
    const date = new Date(`${item.entry_date}T00:00:00`);
    if (state.period === 'week') return now - date < 7 * day && now >= date;
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
}
function total(items) { return items.reduce((sum, item) => sum + Number(item.amount || 0), 0); }
function entriesFor(group) { return state.expenses.filter(item => item.expense_group === group); }

function renderDashboard() {
  const items = filteredForPeriod();
  const overall = total(items); const materials = total(items.filter(i => i.expense_group === 'material')); const labour = total(items.filter(i => i.expense_group === 'labour'));
  $('#totalSpent').textContent = money(overall);
  $('#materialsSpent').textContent = money(materials); $('#labourSpent').textContent = money(labour); $('#entryCount').textContent = items.length;
  $('#materialsRatio').textContent = overall ? `${Math.round(materials / overall * 100)}% of overall cost` : '0% of overall cost';
  $('#labourRatio').textContent = overall ? `${Math.round(labour / overall * 100)}% of overall cost` : '0% of overall cost';
  $('#totalSpentNote').textContent = state.period === 'all' ? 'Cost across all recorded entries' : `Cost during ${state.period === 'week' ? 'the last 7 days' : 'this month'}`;
  $('#entryCountNote').textContent = state.unlocked ? 'Across selected period' : 'Workspace locked';
  const groups = Object.entries(EXPENSE_TYPES).flatMap(([, types]) => Object.entries(types)).map(([key, info]) => ({ key, ...info, amount: total(items.filter(i => i.expense_type === key)) })).filter(i => i.amount > 0).sort((a, b) => b.amount - a.amount);
  $('#costBreakdown').innerHTML = groups.map(item => `<div class="breakdown-item"><span class="breakdown-name"><i class="breakdown-dot" style="background:${item.color}"></i>${escapeHtml(item.label)}</span><span class="breakdown-track"><i class="breakdown-fill" style="width:${overall ? item.amount / overall * 100 : 0}%;background:${item.color}"></i></span><span class="breakdown-cost">${compactMoney(item.amount)}</span></div>`).join('');
  $('#noBreakdown').style.display = groups.length ? 'none' : 'block';
  const largest = groups[0]; const score = overall ? Math.min(94, 66 + Math.min(items.length * 3, 21) + (groups.length >= 4 ? 4 : 0)) : '—';
  $('#healthScore').textContent = score; $('#largestCost').textContent = largest ? `${largest.label} · ${compactMoney(largest.amount)}` : '—';
  $('#healthText').textContent = !overall ? 'Start recording expenses to receive a cost health signal.' : largest ? `${largest.label} is your largest tracked cost. ${items.length >= 6 ? 'Your ledger is developing a useful cost picture.' : 'Add more records for a clearer trend.'}` : '';
  renderRecent(items);
}
function renderRecent(items) {
  const newest = [...items].sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date)).slice(0, 5);
  $('#recentTable').innerHTML = newest.map(item => `<tr><td>${formatDate(item.entry_date)}</td><td><strong>${escapeHtml(typeInfo(item.expense_type).label)}</strong>${item.category ? `<br><small>${escapeHtml(item.category)}</small>` : ''}</td><td>${escapeHtml(item.supplier || '—')}</td><td><span class="type-badge ${item.expense_group}">${item.expense_group}</span></td><td class="right amount">${money(item.amount)}</td></tr>`).join('');
  $('#recentEmpty').classList.toggle('visible', newest.length === 0);
}

function categoryCard(type, items) {
  const info = typeInfo(type); const entries = items.filter(i => i.expense_type === type); const amount = total(entries); const quantity = entries.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
  const entryLabel = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
  let subtext = entries.length ? entryLabel : 'No entries yet';
  if (quantity) subtext = `${formatNumber(quantity)} ${entries[0]?.unit || info.unit} · ${entryLabel}`;
  return `<article class="category-card"><div class="category-card-top"><small>${info.label.toUpperCase()}</small><span class="category-symbol" style="color:${info.color};background:${info.color}18">${info.symbol}</span></div><strong>${money(amount)}</strong><p>${subtext}</p></article>`;
}
function renderMaterials() {
  const items = entriesFor('material');
  $('#materialCards').innerHTML = Object.keys(EXPENSE_TYPES.material).map(type => categoryCard(type, items)).join('');
  $('#materialsTable').innerHTML = sorted(items).map(item => `<tr><td>${formatDate(item.entry_date)}</td><td><strong>${escapeHtml(typeInfo(item.expense_type).label)}</strong>${item.category ? `<br><small>${escapeHtml(item.category)}</small>` : ''}</td><td>${escapeHtml(item.supplier || '—')}</td><td>${item.quantity ? `${formatNumber(item.quantity)} ${escapeHtml(item.unit || '')}` : '—'}</td><td>${item.unit_price ? `${money(item.unit_price)}<small> / ${escapeHtml(item.unit || 'unit')}</small>` : '—'}</td><td class="right amount">${money(item.amount)}</td><td><div class="row-actions"><button class="row-delete" type="button" data-delete="${item.id}" aria-label="Delete record">×</button></div></td></tr>`).join('');
  $('#materialsEmpty').classList.toggle('visible', items.length === 0);
}
function renderLabour() {
  const items = entriesFor('labour');
  $('#labourCards').innerHTML = Object.keys(EXPENSE_TYPES.labour).map(type => categoryCard(type, items)).join('');
  $('#labourTable').innerHTML = sorted(items).map(item => `<tr><td>${formatDate(item.entry_date)}</td><td><strong>${escapeHtml(typeInfo(item.expense_type).label)}</strong></td><td>${escapeHtml(item.work_category || item.category || '—')}</td><td>${escapeHtml(item.notes || '—')}</td><td class="right amount">${money(item.amount)}</td><td><div class="row-actions"><button class="row-delete" type="button" data-delete="${item.id}" aria-label="Delete record">×</button></div></td></tr>`).join('');
  $('#labourEmpty').classList.toggle('visible', items.length === 0);
}
function renderRecords() {
  const search = state.search.trim().toLowerCase();
  const items = sorted(state.expenses.filter(item => (state.filter === 'all' || item.expense_group === state.filter) && (!search || [item.supplier, item.category, item.work_category, item.notes, typeInfo(item.expense_type).label].filter(Boolean).join(' ').toLowerCase().includes(search))));
  $('#recordsTable').innerHTML = items.map(item => {
    const info = typeInfo(item.expense_type); const description = item.expense_group === 'material' ? `${info.label}${item.category ? ` · ${item.category}` : ''}` : info.label;
    const quantity = item.expense_group === 'material' && item.quantity ? `${formatNumber(item.quantity)} ${item.unit || ''} @ ${money(item.unit_price || 0)}` : (item.work_category || '—');
    return `<tr><td>${formatDate(item.entry_date)}</td><td><strong>${escapeHtml(description)}</strong></td><td>${escapeHtml(item.supplier || '—')}</td><td><span class="type-badge ${item.expense_group}">${item.expense_group}</span></td><td>${escapeHtml(quantity)}</td><td class="right amount">${money(item.amount)}</td><td><div class="row-actions"><button class="row-delete" type="button" data-delete="${item.id}" aria-label="Delete record">×</button></div></td></tr>`;
  }).join('');
  $('#recordsEmpty').classList.toggle('visible', items.length === 0);
}
function sorted(items) { return [...items].sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date) || new Date(b.created_at || 0) - new Date(a.created_at || 0)); }
function formatDate(value) { if (!value) return '—'; return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)); }
function formatNumber(value) { return new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(Number(value)); }
function renderAll() { renderDashboard(); renderMaterials(); renderLabour(); renderRecords(); }

function setView(view) {
  state.view = view;
  $$('.view').forEach(el => el.classList.toggle('active-view', el.id === `${view}View`));
  $$('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  const labels = { dashboard: ['PROJECT PULSE', 'Good day, builder.'], materials: ['MATERIAL MANAGEMENT', 'Material control centre.'], labour: ['LABOUR MANAGEMENT', 'Your on-site crew.'], records: ['COMPLETE LEDGER', 'Expense records.'] };
  $('#viewKicker').textContent = labels[view][0]; $('#viewTitle').textContent = labels[view][1];
  window.location.hash = view;
}

function setExpenseGroup(group) {
  $('#expenseGroup').value = group;
  $$('.toggle-button').forEach(btn => btn.classList.toggle('active', btn.dataset.groupChoice === group));
  const types = EXPENSE_TYPES[group];
  if (group === 'labour') {
    // Group labour types under optgroup headers (Contractor vs standalone)
    const grouped = {};
    const standalone = [];
    for (const [key, info] of Object.entries(types)) {
      if (info.parent) {
        if (!grouped[info.parent]) grouped[info.parent] = [];
        grouped[info.parent].push([key, info]);
      } else {
        standalone.push([key, info]);
      }
    }
    let html = '';
    for (const [parentLabel, items] of Object.entries(grouped)) {
      html += `<optgroup label="${parentLabel}">`;
      html += items.map(([key, info]) => `<option value="${key}">${info.label}</option>`).join('');
      html += '</optgroup>';
    }
    html += standalone.map(([key, info]) => `<option value="${key}">${info.label}</option>`).join('');
    $('#expenseType').innerHTML = html;
  } else {
    $('#expenseType').innerHTML = Object.entries(types).map(([key, info]) => `<option value="${key}">${info.label}</option>`).join('');
  }
  $('#categoryField').classList.toggle('hidden', group === 'labour'); $('#supplierField').classList.toggle('hidden', group === 'labour');
  $('#quantityField').classList.toggle('hidden', group === 'labour'); $('#unitField').classList.toggle('hidden', group === 'labour'); $('#rateField').classList.toggle('hidden', group === 'labour'); $('#workField').classList.toggle('hidden', group === 'material');
  $('#amountHint').textContent = group === 'material' ? 'Calculated from quantity × rate when both are provided.' : 'Enter the payment made to this worker.';
  setUnitOptions();
}
function setUnitOptions() { const info = typeInfo($('#expenseType').value); $('#unit').innerHTML = `<option value="${info.unit}">${info.unit}</option><option value="other">other</option>`; }
function openExpenseDialog(group = 'material') { $('#expenseForm').reset(); $('#entryDate').value = today(); setExpenseGroup(group); $('#expenseDialog').showModal(); $('#entryDate').focus(); }
function closeExpenseDialog() { $('#expenseDialog').close(); }
function calculateAmount() { const quantity = Number($('#quantity').value); const rate = Number($('#unitPrice').value); if (quantity && rate) $('#amount').value = (quantity * rate).toFixed(2); }

function downloadPdfReport() {
  const items = sorted(state.expenses);
  const totalSpent = total(items);
  const materialsSpent = total(items.filter(i => i.expense_group === 'material'));
  const labourSpent = total(items.filter(i => i.expense_group === 'labour'));

  const categories = Object.entries(EXPENSE_TYPES).flatMap(([, types]) => Object.entries(types)).map(([key, info]) => {
    const entries = items.filter(i => i.expense_type === key);
    const amount = total(entries);
    const quantity = entries.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
    const unit = entries[0]?.unit || info.unit;
    return { key, ...info, amount, quantity, unit };
  }).filter(i => i.amount > 0);

  const reportDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());

  let categoryRows = '';
  for (const c of categories) {
    const isMaterial = ['bricks', 'steel', 'crush_stone', 'bajar', 'cement', 'rait'].includes(c.key);
    const badgeClass = isMaterial ? 'material' : 'labour';
    const qtyText = c.quantity ? `${formatNumber(c.quantity)} ${escapeHtml(c.unit)}` : '—';
    categoryRows += `
      <tr>
        <td><strong>${escapeHtml(c.label)}</strong></td>
        <td><span class="badge ${badgeClass}">${badgeClass}</span></td>
        <td>${qtyText}</td>
        <td class="right mono">${money(c.amount)}</td>
      </tr>
    `;
  }

  let entryRows = '';
  for (const item of items) {
    const info = typeInfo(item.expense_type);
    const desc = item.expense_group === 'material' ? `${info.label}${item.category ? ` · ${item.category}` : ''}` : info.label;
    const details = item.expense_group === 'material' && item.quantity ? `${formatNumber(item.quantity)} ${item.unit || ''} @ ${money(item.unit_price || 0)}` : (item.work_category || '—');
    entryRows += `
      <tr>
        <td>${formatDate(item.entry_date)}</td>
        <td><strong>${escapeHtml(desc)}</strong></td>
        <td>${escapeHtml(item.supplier || '—')}</td>
        <td>${escapeHtml(details)}</td>
        <td class="right mono">${money(item.amount)}</td>
      </tr>
    `;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>BuildLedger Cost Report</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #18332e; line-height: 1.5; padding: 30px; margin: 0; }
        h1 { font-family: Georgia, serif; font-size: 26px; border-bottom: 2px solid #16473d; padding-bottom: 10px; margin: 0 0 5px; }
        .meta { font-size: 11px; color: #72817d; margin-bottom: 25px; }
        .metrics-grid { display: flex; gap: 15px; margin-bottom: 30px; }
        .metric-card { flex: 1; padding: 15px; border: 1px solid #e8ece7; border-radius: 8px; background: #fafafa; }
        .metric-card.primary { background: #16473d; color: #ffffff; border: 0; }
        .metric-card.primary .label { color: #a9d4ba; }
        .metric-card .label { font-size: 10px; text-transform: uppercase; font-weight: bold; color: #72817d; }
        .metric-card .value { font-size: 20px; font-family: monospace; font-weight: bold; margin-top: 5px; }
        
        h2 { font-family: Georgia, serif; font-size: 18px; margin: 25px 0 10px; color: #16473d; }
        
        .breakdown-table, .entries-table { width: 100%; border-collapse: collapse; text-align: left; margin-bottom: 30px; }
        th { padding: 10px 8px; border-bottom: 1px solid #18332e; font-size: 10px; text-transform: uppercase; color: #72817d; font-weight: bold; }
        td { padding: 10px 8px; border-bottom: 1px solid #e8ece7; font-size: 11.5px; color: #4e5a57; }
        tr:last-child td { border-bottom: 1px solid #18332e; }
        .right { text-align: right; }
        .mono { font-family: monospace; font-weight: 500; }
        
        .badge { display: inline-block; padding: 3px 6px; border-radius: 99px; font-size: 9px; font-weight: bold; text-transform: uppercase; }
        .badge.material { background: #fff4ee; color: #a54a1f; }
        .badge.labour { background: #eef2fb; color: #4e63a1; }
        
        @media print {
          body { padding: 0; }
          .metric-card { outline: 1px solid #e8ece7; background: #fafafa !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .metric-card.primary { background: #16473d !important; color: #ffffff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .metric-card.primary .label { color: #a9d4ba !important; }
          .badge.material { background: #fff4ee !important; color: #a54a1f !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .badge.labour { background: #eef2fb !important; color: #4e63a1 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          tr { page-break-inside: avoid; }
        }
      </style>
    </head>
    <body>
      <h1>BuildLedger Cost Control Report</h1>
      <div class="meta">Generated on ${reportDate} | Project: Construction site</div>
      
      <div class="metrics-grid">
        <div class="metric-card primary">
          <div class="label">Total spent</div>
          <div class="value">${money(totalSpent)}</div>
        </div>
        <div class="metric-card">
          <div class="label">Materials</div>
          <div class="value">${money(materialsSpent)}</div>
        </div>
        <div class="metric-card">
          <div class="label">Labour</div>
          <div class="value">${money(labourSpent)}</div>
        </div>
      </div>
      
      <h2>Cost Composition by Category</h2>
      <table class="breakdown-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Type</th>
            <th>Total Quantity</th>
            <th class="right">Total Cost</th>
          </tr>
        </thead>
        <tbody>
          ${categoryRows}
        </tbody>
      </table>
      
      <h2>Detailed Ledger Entries</h2>
      <table class="entries-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Supplier / Worker</th>
            <th>Details / Quantity</th>
            <th class="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${entryRows}
        </tbody>
      </table>
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  printWindow.document.write(htmlContent);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

function bindEvents() {
  $$('.nav-link').forEach(link => link.addEventListener('click', e => { e.preventDefault(); setView(link.dataset.view); }));
  $$('[data-go-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.goView)));
  $('#newExpenseButton').addEventListener('click', () => openExpenseDialog(state.view === 'labour' ? 'labour' : 'material'));
  $$('[data-add-expense]').forEach(btn => btn.addEventListener('click', () => openExpenseDialog(btn.dataset.defaultGroup || 'material')));
  $$('.toggle-button').forEach(btn => btn.addEventListener('click', () => setExpenseGroup(btn.dataset.groupChoice)));
  $('#expenseType').addEventListener('change', setUnitOptions); $('#quantity').addEventListener('input', calculateAmount); $('#unitPrice').addEventListener('input', calculateAmount);
  $$('[data-close-dialog]').forEach(btn => btn.addEventListener('click', closeExpenseDialog));
  $('#downloadPdfButton').addEventListener('click', downloadPdfReport);
  $('#expenseForm').addEventListener('submit', async e => {
    e.preventDefault(); const group = $('#expenseGroup').value;
    const payload = { entry_date: $('#entryDate').value, expense_group: group, expense_type: $('#expenseType').value, category: $('#category').value.trim() || null, supplier: $('#supplier').value.trim() || null, quantity: group === 'material' && $('#quantity').value ? Number($('#quantity').value) : null, unit: group === 'material' ? $('#unit').value : null, unit_price: group === 'material' && $('#unitPrice').value ? Number($('#unitPrice').value) : null, amount: Number($('#amount').value), work_category: group === 'labour' ? $('#workCategory').value.trim() || null : null, notes: $('#notes').value.trim() || null };
    const button = $('#saveExpense'); button.disabled = true; button.textContent = 'Saving…'; const saved = await saveExpense(payload); button.disabled = false; button.textContent = 'Save expense'; if (saved) closeExpenseDialog();
  });
  $('#periodFilter').addEventListener('change', e => { state.period = e.target.value; renderDashboard(); });
  $('#searchInput').addEventListener('input', e => { state.search = e.target.value; renderRecords(); });
  $('#recordGroupFilter').addEventListener('change', e => { state.filter = e.target.value; renderRecords(); });
  document.addEventListener('click', e => { const button = e.target.closest('[data-delete]'); if (button) deleteExpense(button.dataset.delete); });
  $('#accessForm').addEventListener('submit', async e => {
    e.preventDefault();
    const button = $('#accessSubmit'); button.disabled = true; button.textContent = 'Unlocking…';
    try {
      await api('/api/session', { method: 'POST', body: JSON.stringify({ password: $('#accessPassword').value }) });
      $('#accessPassword').value = ''; $('#accessDialog').close(); await fetchExpenses();
    } catch (error) { showToast(error.status === 401 ? 'Incorrect workspace password.' : 'Could not unlock the workspace.', true); }
    finally { button.disabled = false; button.textContent = 'Unlock workspace'; }
  });
  $('#themeButton').addEventListener('click', () => { document.body.classList.toggle('dark'); localStorage.setItem('buildledger-dark', document.body.classList.contains('dark')); });
}

async function init() {
  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      console.log('[PWA] Service Worker registered with scope:', reg.scope);
    } catch (err) {
      console.error('[PWA] Service Worker registration failed:', err);
    }
  }

  // Remove configuration saved by the retired direct-to-Supabase browser build.
  // This intentionally clears only non-persistent preview data and the old public key.
  try {
    localStorage.removeItem('buildledger-supabase-connection');
    localStorage.removeItem('buildledger-preview-expenses');
  } catch { /* Browser storage may be unavailable in privacy mode. */ }
  if (localStorage.getItem('buildledger-dark') === 'true') document.body.classList.add('dark');
  bindEvents(); setExpenseGroup('material');
  const requested = window.location.hash.slice(1); if (['dashboard', 'materials', 'labour', 'records'].includes(requested)) setView(requested);
  renderAll();
  try {
    const session = await api('/api/session');
    if (session.authenticated) await fetchExpenses(); else showAccessDialog();
  } catch { showServerRequired(); }
}
init();
