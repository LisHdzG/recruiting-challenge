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
const ordersForm = document.getElementById('orders-form');
const ordersError = document.getElementById('orders-error');
const ordersStatus = document.getElementById('orders-status');
const loadMoreBtn = document.getElementById('load-more');

const PAGE_SIZE = 25;

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
  const body = await res.json();
  if (!res.ok) {
    // The API says which fields failed; the caller decides how to show them.
    const err = new Error(body.error ?? `HTTP ${res.status}`);
    err.details = body.details ?? [];
    throw err;
  }
  return body;
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

  await searchOrders();
}

// --- Orders: the list and its filters ------------------------------------------

// What the form calls each API field, for error messages.
const FILTER_LABELS = {
  customer_email: 'Customer email',
  type: 'Type',
  status: 'Status',
  from: 'From',
  to: 'To',
  min_amount: 'Min amount',
  max_amount: 'Max amount',
};

// The filters of the search on screen. "Load more" reuses them, so editing the
// form without pressing Search does not mix two searches in one table.
let appliedFilters = new URLSearchParams();
let nextCursor = null;
let shownOrders = 0;

function nextDay(day) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return isoDate(d);
}

/** Form values as API parameters. Empty fields are left out: they mean "any". */
function readFilters() {
  const form = new FormData(ordersForm);
  const params = new URLSearchParams();
  for (const name of ['customer_email', 'type', 'status', 'from']) {
    const value = String(form.get(name) ?? '').trim();
    if (value !== '') params.set(name, value);
  }
  // The form's "To" is the last day included; the API's `to` is exclusive.
  const to = String(form.get('to') ?? '');
  if (to !== '') params.set('to', nextDay(to));
  // The form takes currency units; the API takes cents.
  for (const name of ['min_amount', 'max_amount']) {
    const value = String(form.get(name) ?? '');
    if (value !== '') params.set(name, String(Math.round(Number(value) * 100)));
  }
  return params;
}

function showOrdersError(err) {
  const details = err.details ?? [];
  ordersError.textContent =
    details.length > 0
      ? details.map((d) => `${FILTER_LABELS[d.field] ?? d.field}: ${d.issue}`).join('\n')
      : 'Could not load the orders. Check that the server is running and try again.';
  ordersError.hidden = false;
}

function formatDate(createdAt) {
  // Stored as UTC, 2026-11-06T02:28:37.000Z. Shown in UTC because the date filters are UTC days.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(createdAt);
  return match ? `${match[1]} ${match[2]}` : createdAt;
}

function appendOrders(orders) {
  // Order fields come from clients, so they are shown as text, never parsed as HTML.
  for (const o of orders) {
    const tr = document.createElement('tr');
    const cells = [formatDate(String(o.created_at)), o.customer_email, o.type, o.status, money(o.total_amount)];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = String(text);
      if (i === cells.length - 1) td.className = 'amount';
      tr.appendChild(td);
    });
    ordersTbody.appendChild(tr);
  }
}

async function loadOrders({ append, filters }) {
  const params = new URLSearchParams(filters);
  params.set('limit', String(PAGE_SIZE));
  if (append && nextCursor) params.set('cursor', nextCursor);
  const page = await api(`/api/orders?${params}`);

  if (!append) {
    ordersTbody.replaceChildren();
    shownOrders = 0;
  }
  // Only a search that worked becomes the one on screen: after an error, the
  // table and "Load more" still belong to the previous search.
  appliedFilters = filters;
  appendOrders(page.orders);
  shownOrders += page.orders.length;
  nextCursor = page.next_cursor;
  loadMoreBtn.hidden = !nextCursor;
  const filtered = [...appliedFilters.keys()].length > 0;
  ordersStatus.textContent =
    shownOrders === 0
      ? filtered ? 'No orders match these filters.' : 'No orders yet.'
      : `Showing ${shownOrders} ${shownOrders === 1 ? 'order' : 'orders'}${nextCursor ? '; there are more.' : '.'}`;
}

/** Runs the search in the form. A sign-in problem is left to the caller; any other is shown here. */
async function searchOrders({ append = false } = {}) {
  ordersError.hidden = true;
  loadMoreBtn.disabled = true;
  try {
    await loadOrders({ append, filters: append ? appliedFilters : readFilters() });
  } catch (err) {
    if (err.message === 'unauthorized') throw err;
    showOrdersError(err);
  } finally {
    loadMoreBtn.disabled = false;
  }
}

function clearOrders() {
  ordersForm.reset();
  appliedFilters = new URLSearchParams();
  nextCursor = null;
  shownOrders = 0;
  ordersTbody.replaceChildren();
  ordersStatus.textContent = '';
  ordersError.hidden = true;
  loadMoreBtn.hidden = true;
}

function onOrdersAction(action) {
  if (!apiKey) return;
  action().catch((err) => {
    if (err.message !== 'unauthorized') throw err;
    showSignedOut('That API key is not valid.');
  });
}

ordersForm.addEventListener('submit', (event) => {
  event.preventDefault();
  onOrdersAction(() => searchOrders());
});
ordersForm.addEventListener('reset', () => {
  // The fields are emptied after this event, so search on the next tick.
  setTimeout(() => onOrdersAction(() => searchOrders()), 0);
});
loadMoreBtn.addEventListener('click', () => onOrdersAction(() => searchOrders({ append: true })));

function showSignedOut(message) {
  setKey(null);
  keyForm.hidden = false;
  sessionEl.hidden = true;
  keyError.textContent = message ?? '';
  // Do not leave the previous merchant's numbers on screen.
  for (const el of [totalOrdersEl, uniqueCustomersEl, avgOrderEl, revenue30dEl]) el.textContent = '—';
  clearOrders();
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
