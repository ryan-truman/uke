import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Credentials { shop: string; token: string }
interface Item { title: string; variant: string; quantity: number }
interface Order { number: string; customer: string; items: Item[] }
interface Summary { items: Item[]; orders: Order[]; orderCount: number }

const grinds: { label: string; match: RegExp }[] = [
  { label: 'Espresso',     match: /espresso/i },
  { label: 'Filter',       match: /filter/i },
  { label: 'Aeropress',    match: /aero\s*press/i },
  { label: 'Moka Pot',     match: /moka\s*pot/i },
  { label: 'French Press', match: /french\s*press/i },
  { label: 'Whole Bean',   match: /whole\s*bean/i },
];

const $ = (id: string) => document.getElementById(id)!;
const app = $('app');

const ranges: { value: number; label: string }[] = [
  { value: 1,  label: 'Past day' },
  { value: 7,  label: 'Past week' },
  { value: 30, label: 'Past month' },
  { value: 0,  label: 'All time' },
];
let currentDays = 7;

const loadCreds = (): Credentials | null => {
  const shop = localStorage.getItem('uke_shop');
  const token = localStorage.getItem('uke_token');
  return shop && token ? { shop, token } : null;
};

const saveCreds = (c: Credentials) => {
  localStorage.setItem('uke_shop', c.shop);
  localStorage.setItem('uke_token', c.token);
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fetchOrders(c: Credentials): Promise<Summary> {
  const resp = await fetch(`/api/orders?days=${currentDays}`, {
    headers: { 'X-Shopify-Shop': c.shop, 'X-Shopify-Token': c.token },
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(body.error ?? `server error ${resp.status}`);
  return body;
}

async function load() {
  const creds = loadCreds();
  if (!creds) return showSettings();
  showLoading();
  try {
    showSummary(await fetchOrders(creds));
  } catch (e: unknown) {
    showError(e instanceof Error ? e.message : String(e));
  }
}

function showSettings() {
  const creds = loadCreds();
  app.innerHTML = `
    <div class="card settings-card">
      <div class="card-logo"><img src="logo.png" alt="Uke Coffee" /></div>
      <p class="hint">Enter your shop domain and a custom app access token with <code>read_orders</code> scope.</p>
      <form id="f">
        <label>Shop domain
          <input id="s" type="text" placeholder="my-store.myshopify.com"
            value="${esc(creds?.shop ?? '')}" required autocomplete="off" spellcheck="false" />
        </label>
        <label>Access token
          <input id="t" type="password" placeholder="shpat_…"
            value="${esc(creds?.token ?? '')}" required autocomplete="off" />
        </label>
        <button type="submit" class="btn-primary">Save &amp; load orders</button>
      </form>
    </div>`;
  $('f').addEventListener('submit', e => {
    e.preventDefault();
    saveCreds({ shop: ($ ('s') as HTMLInputElement).value.trim(), token: ($('t') as HTMLInputElement).value.trim() });
    load();
  });
}

function showLoading() {
  app.innerHTML = `
    <div class="card loading-card">
      <div class="spinner"></div>
      <p>Fetching unfulfilled orders…</p>
    </div>`;
}

const backArrow = `<button id="b" class="btn-back" aria-label="Back">←</button>`;
const downloadBtn = `<button id="dl" class="btn-download" aria-label="Download PDF">Download</button>`;

function download(data: Summary) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pivoted = pivot(data.items);
  const activeCols = grinds.map((_, i) => pivoted.some(r => r.cells[i] > 0));
  const visibleGrinds = grinds.filter((_, i) => activeCols[i]);

  autoTable(doc, {
    startY: 48,
    head: [['Product', ...visibleGrinds.map(g => g.label), 'Total']],
    body: pivoted.map(r => [
      r.title,
      ...r.cells.filter((_, i) => activeCols[i]).map(n => n ? String(n) : ''),
      String(r.total),
    ]),
    styles: { font: 'helvetica', fontSize: 10 },
    headStyles: { fillColor: [20, 20, 20] },
  });

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24,
    head: [['Order', 'Customer', 'Products']],
    body: data.orders.map(o => [
      o.number,
      o.customer || '—',
      o.items.map(i =>
        `${i.title}${i.variant ? ' — ' + i.variant : ''}${i.quantity > 1 ? ' ×' + i.quantity : ''}`
      ).join('\n'),
    ]),
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [20, 20, 20] },
    columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 120 } },
  });

  doc.save(`uke-${stamp}.pdf`);
}

// Extracts grams from a variant string. "1kg" → 1000, "250g" → 250, null if none.
function parseWeight(variant: string): number | null {
  const m = variant.match(/(\d+(?:\.\d+)?)\s*(kg|g)\b/i);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2].toLowerCase() === 'kg' ? 1000 : 1);
}

function pivot(items: Item[]): { title: string; cells: number[]; total: number }[] {
  // First pass: per-product base (smallest) bag weight.
  const baseByTitle = new Map<string, number>();
  for (const it of items) {
    const w = parseWeight(it.variant);
    if (w === null) continue;
    const cur = baseByTitle.get(it.title);
    if (cur === undefined || w < cur) baseByTitle.set(it.title, w);
  }

  // Second pass: aggregate bags per (title, grind).
  const byTitle = new Map<string, number[]>();
  for (const it of items) {
    const idx = grinds.findIndex(g => g.match.test(it.variant));
    if (idx === -1) continue; // skip variants that don't match any grind type
    const w = parseWeight(it.variant);
    const base = baseByTitle.get(it.title);
    const bags = w !== null && base ? (w / base) * it.quantity : it.quantity;
    if (!byTitle.has(it.title)) byTitle.set(it.title, grinds.map(() => 0));
    byTitle.get(it.title)![idx] += bags;
  }
  return Array.from(byTitle.entries())
    .map(([title, cells]) => ({ title, cells, total: cells.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
}

function showSummary(data: Summary) {
  const pivoted = pivot(data.items);
  // Only show grind columns where at least one product has a non-zero count.
  const activeCols = grinds.map((_, i) => pivoted.some(r => r.cells[i] > 0));
  const visibleGrinds = grinds.filter((_, i) => activeCols[i]);
  const headerCells = visibleGrinds.map(g => `<th class="qty-col">${g.label}</th>`).join('');
  const rows = pivoted.length === 0
    ? `<tr><td colspan="${visibleGrinds.length + 2}" class="empty">No unfulfilled orders</td></tr>`
    : pivoted.map(r => `
        <tr>
          <td>${esc(r.title)}</td>
          ${r.cells.filter((_, i) => activeCols[i]).map(n => `<td class="qty">${n || ''}</td>`).join('')}
          <td class="qty total">${r.total}</td>
        </tr>`).join('');
  const options = ranges
    .map(r => `<option value="${r.value}"${r.value === currentDays ? ' selected' : ''}>${r.label}</option>`)
    .join('');
  const orderRows = data.orders.length === 0
    ? `<tr><td colspan="3" class="empty">No unfulfilled orders</td></tr>`
    : data.orders.map(o => `
        <tr>
          <td class="order-num">${esc(o.number)}</td>
          <td>${esc(o.customer || '—')}</td>
          <td>${o.items.map(i =>
            `${esc(i.title)}${i.variant ? ' — ' + esc(i.variant) : ''}${i.quantity > 1 ? ' ×' + i.quantity : ''}`
          ).join('<br>')}</td>
        </tr>`).join('');
  app.innerHTML = `
    ${backArrow}
    ${downloadBtn}
    <div class="card">
      <div class="card-logo"><img src="logo.png" alt="Uke Coffee" /></div>
      <div class="summary-header">
        <h2>Unfulfilled orders</h2>
        <p class="order-count">${data.orderCount} order${data.orderCount === 1 ? '' : 's'}</p>
        <select id="d" class="date-select" aria-label="Date range">${options}</select>
      </div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            ${headerCells}
            <th class="qty-col">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Order details</h2>
      <table class="order-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Products</th>
          </tr>
        </thead>
        <tbody>${orderRows}</tbody>
      </table>
    </div>`;
  $('b').addEventListener('click', showSettings);
  $('dl').addEventListener('click', () => download(data));
  $('d').addEventListener('change', e => {
    currentDays = parseInt((e.target as HTMLSelectElement).value, 10);
    load();
  });
}

function showError(message: string) {
  app.innerHTML = `
    ${backArrow}
    <div class="card error-card">
      <h2>Something went wrong</h2>
      <p class="error-msg">${esc(message)}</p>
      <div class="error-actions">
        <button id="r" class="btn-primary">Retry</button>
      </div>
    </div>`;
  $('b').addEventListener('click', showSettings);
  $('r').addEventListener('click', load);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
loadCreds() ? load() : showSettings();
