import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Credentials { shop: string; token: string }
interface Item { title: string; variant: string; quantity: number }
interface Order { number: string; items: Item[] }
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
  const resp = await fetch('/api/orders', {
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
      <form id="f">
        <label>Shop domain
          <input id="s" type="text" placeholder="my-store.myshopify.com"
            value="${esc(creds?.shop ?? '')}" required autocomplete="off" spellcheck="false" />
        </label>
        <label>Access token
          <input id="t" type="password" placeholder="shpat_…"
            value="${esc(creds?.token ?? '')}" required autocomplete="off" />
        </label>
        <div class="settings-actions">
          ${loadCreds() ? `<button type="button" id="clr" class="btn-danger">Clear saved data</button>` : '<div></div>'}
          <button type="submit" class="btn-primary">Save &amp; load orders</button>
        </div>
      </form>
    </div>`;
  $('f').addEventListener('submit', e => {
    e.preventDefault();
    saveCreds({ shop: ($('s') as HTMLInputElement).value.trim(), token: ($('t') as HTMLInputElement).value.trim() });
    load();
  });
  document.getElementById('clr')?.addEventListener('click', () => {
    if (confirm('Are you sure? This will remove your Access Token and you will not be able to retrieve order information until you enter a new one.')) {
      localStorage.removeItem('uke_shop');
      localStorage.removeItem('uke_token');
      showSettings();
    }
  });
}

function showLoading() {
  app.innerHTML = `
    <div class="card loading-card">
      <div class="spinner"></div>
      <p>Fetching orders…</p>
    </div>`;
}

const settingsBtn = `<button id="b" class="btn-top btn-settings" aria-label="Settings">Settings</button>`;
const refreshBtn = `<button id="rf" class="btn-top btn-refresh" aria-label="Refresh">Refresh</button>`;
const downloadBtn = `<button id="dl" class="btn-top btn-download" aria-label="Download PDF">Download</button>`;

function download(data: Summary) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pivoted = pivot(data.items);
  const activeCols = grinds.map((_, i) => pivoted.some(r => r.cells[i] > 0));
  const visibleGrinds = grinds.filter((_, i) => activeCols[i]);

  autoTable(doc, {
    startY: 48,
    head: [['Product', 'Total', ...visibleGrinds.map(g => g.label)]],
    body: pivoted.map(r => [
      r.title,
      String(r.total),
      ...r.cells.filter((_, i) => activeCols[i]).map(n => n ? String(n) : ''),
    ]),
    styles: { font: 'helvetica', fontSize: 10 },
    headStyles: { fillColor: [20, 20, 20] },
  });

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24,
    head: [['Order', 'Products']],
    body: data.orders.map(o => [
      o.number,
      o.items.map(i =>
        `${i.title}${i.variant ? ' — ' + i.variant : ''}${i.quantity > 1 ? ' ×' + i.quantity : ''}`
      ).join('\n'),
    ]),
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [20, 20, 20] },
    columnStyles: { 0: { cellWidth: 60 } },
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

const clothingSize = /^(XS|S|M|L|XL|XXL|2XL|3XL)$/i;

function ukeDrip(orders: Order[]): { title: string; size: string; quantity: number }[] {
  const totals = new Map<string, number>();
  for (const o of orders) {
    for (const i of o.items) {
      if (!clothingSize.test(i.variant?.trim() ?? '')) continue;
      const k = `${i.title}||${i.variant.trim().toUpperCase()}`;
      totals.set(k, (totals.get(k) ?? 0) + i.quantity);
    }
  }
  return Array.from(totals.entries())
    .map(([k, quantity]) => { const [title, size] = k.split('||'); return { title, size, quantity }; })
    .sort((a, b) => a.title.localeCompare(b.title) || a.size.localeCompare(b.size));
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
          <td class="qty total">${r.total}</td>
          ${r.cells.filter((_, i) => activeCols[i]).map(n => `<td class="qty">${n || ''}</td>`).join('')}
        </tr>`).join('');
  const orderRows = data.orders.length === 0
    ? `<tr><td colspan="2" class="empty">No unfulfilled orders</td></tr>`
    : data.orders.map(o => `
        <tr>
          <td class="order-num">${esc(o.number)}</td>
          <td>${o.items.map(i =>
            `${esc(i.title)}${i.variant ? ' — ' + esc(i.variant) : ''}${i.quantity > 1 ? ' ×' + i.quantity : ''}`
          ).join('<br>')}</td>
        </tr>`).join('');
  const drip = ukeDrip(data.orders);
  const dripRows = drip.length === 0
    ? `<tr><td colspan="3" class="empty">No clothing items</td></tr>`
    : drip.map(d => `
        <tr>
          <td>${esc(d.title)}</td>
          <td class="qty-col">${esc(d.size)}</td>
          <td class="qty">${d.quantity}</td>
        </tr>`).join('');

  app.innerHTML = `
    ${settingsBtn}
    ${refreshBtn}
    ${downloadBtn}
    <div class="card">
      <div class="card-logo"><img src="logo.png" alt="Uke Coffee" /></div>
      <div class="summary-header">
        <h2>Until Victory</h2>
        <p class="order-count">${data.orderCount} order${data.orderCount === 1 ? '' : 's'}</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th class="qty-col">Total</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Uke Drip</h2>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="qty-col">Size</th>
            <th class="qty-col">Qty</th>
          </tr>
        </thead>
        <tbody>${dripRows}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Order details</h2>
      <table class="order-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Products</th>
          </tr>
        </thead>
        <tbody>${orderRows}</tbody>
      </table>
    </div>`;
  $('b').addEventListener('click', showSettings);
  $('rf').addEventListener('click', load);
  $('dl').addEventListener('click', () => download(data));
}

function showError(message: string) {
  app.innerHTML = `
    ${settingsBtn}
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
