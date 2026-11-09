const keyForm = document.getElementById('key-form');
const keyInput = document.getElementById('key-input');
const keyError = document.getElementById('key-error');
const sessionEl = document.getElementById('session');
const merchantIdEl = document.getElementById('merchant-id');
const signOutBtn = document.getElementById('sign-out');
const totalOrdersEl = document.getElementById('total-orders');
const uniqueCustomersEl = document.getElementById('unique-customers');
const avgOrderEl = document.getElementById('avg-order');
const revenue30dEl = document.getElementById('revenue-30d');
const ordersTbody = document.getElementById('orders-tbody');

// The key stays in this tab only: sessionStorage is cleared when the tab closes.
const KEY_STORAGE = 'dashboard_api_key';
let apiKey = null;
try {
  apiKey = sessionStorage.getItem(KEY_STORAGE);
} catch {}

function setKey(key) {
  apiKey = key;
  try {
    if (key) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {}
}

async function api(path) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (res.status === 401) throw new Error('unauthorized');
  return res.json();
}

function money(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function refresh() {
  const summary = await api('/api/metrics/summary');
  merchantIdEl.textContent = summary.merchant_id;
  totalOrdersEl.textContent = summary.total_orders ?? '—';
  uniqueCustomersEl.textContent = summary.unique_customers ?? '—';
  avgOrderEl.textContent = money(summary.avg_order_value_cents ?? 0);

  const now = new Date();
  const thirtyAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const revenue = await api(`/api/revenue?from=${isoDate(thirtyAgo)}&to=${isoDate(now)}`);
  revenue30dEl.textContent = money(revenue.revenue_cents ?? 0);

  const ordersRes = await api('/api/orders?limit=10');
  // Order fields come from clients, so they are shown as text, never parsed as HTML.
  ordersTbody.replaceChildren();
  for (const o of ordersRes.orders ?? []) {
    const tr = document.createElement('tr');
    for (const text of [new Date(o.created_at).toLocaleDateString(), o.customer_email, o.type, money(o.total_amount)]) {
      const td = document.createElement('td');
      td.textContent = String(text);
      tr.appendChild(td);
    }
    ordersTbody.appendChild(tr);
  }
}

function showSignedOut(message) {
  setKey(null);
  keyForm.hidden = false;
  sessionEl.hidden = true;
  keyError.textContent = message ?? '';
  // Do not leave the previous merchant's numbers on screen.
  for (const el of [totalOrdersEl, uniqueCustomersEl, avgOrderEl, revenue30dEl]) el.textContent = '—';
  ordersTbody.replaceChildren();
}

async function signIn() {
  try {
    await refresh();
  } catch (err) {
    if (err.message !== 'unauthorized') throw err;
    showSignedOut('That API key is not valid.');
    return;
  }
  keyForm.hidden = true;
  sessionEl.hidden = false;
  keyError.textContent = '';
}

keyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  setKey(keyInput.value.trim());
  keyInput.value = '';
  signIn();
});
signOutBtn.addEventListener('click', () => showSignedOut());

if (apiKey) signIn();
