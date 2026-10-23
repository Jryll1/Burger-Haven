'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const staffAuth = window.BurgerHavenStaffAuth;
let toastTimeout;
let currentFilter = 'all';
let adminProducts = [];
let adminDrinkVariants = { sizes: [{ id: 'small', label: 'Small (250 ml)', price: 25 }, { id: 'regular', label: 'Regular (330 ml)', price: 35 }, { id: 'large', label: 'Large (500 ml)', price: 50 }] };
let receiptObjectUrl = null;
const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(Number(value) || 0).replace('PHP', '₱').replace(/\s/g, '');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function notice(message, type = '') {
  const element = $('#admin-toast');
  element.textContent = message;
  element.className = `toast show ${type}`.trim();
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { element.className = 'toast'; }, 3200);
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...staffAuth.headers(), ...(options.headers || {}) } });
  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw new Error(body.error || body.detail || `Request failed (${response.status})`);
  return body;
}
async function unlock() {
  $('#login-message').textContent = 'Checking access…';
  try {
    await loadOrders();
    try { await loadProducts(); } catch (productError) { notice(`Orders loaded, but menu management could not load: ${productError.message}`, 'error'); }
    const accessInfo = await request('/api/admin/access');
    const analyticsLink = $('#admin-analytics-link');
    if (analyticsLink) analyticsLink.hidden = !accessInfo.permissions?.analytics;
    const sessionLabel = $('#staff-session-label');
    if (sessionLabel) sessionLabel.textContent = `Signed in as ${accessInfo.role === 'admin' ? 'administrator' : 'staff'} (${staffAuth.kind() === 'account' ? 'account' : 'access token'})`;
    $('#login-panel').hidden = true;
    $('#dashboard').hidden = false;
    $('#login-message').textContent = '';
    notice('Staff dashboard unlocked.', 'success');
  } catch (error) {
    staffAuth.clear();
    const message = /invalid (admin|staff access) token/i.test(error.message)
      ? 'The server rejected this token. Check the Burger_Haven_App folder .env file, restart the server after editing it, and enter the exact STAFF_TOKEN or ADMIN_TOKEN value configured there.'
      : /admin access is not configured/i.test(error.message)
        ? 'Staff access is not configured on this server. Set STAFF_TOKEN or ADMIN_TOKEN in .env and restart Burger Haven, or give an account the staff role with manage_users.py.'
        : error.message;
    $('#login-message').textContent = message;
  }
}
async function loadOrders() {
  const data = await request(`/api/admin/orders?status=${encodeURIComponent(currentFilter)}`);
  $('#metric-orders').textContent = String(data.metrics?.total_orders ?? 0);
  $('#metric-sales').textContent = money(data.metrics?.paid_sales ?? 0);
  $('#metric-open').textContent = String(data.metrics?.open_orders ?? 0);
  $('#metric-pending').textContent = String(data.metrics?.pending_payments ?? 0);
  $('#order-count').textContent = `${data.orders.length} shown (most recent 200 maximum)`;
  renderOrders(data.orders || []);
}
async function loadProducts() {
  const data = await request('/api/admin/products');
  adminProducts = data.products || [];
  adminDrinkVariants = data.drink_variants || adminDrinkVariants;
  renderProducts(adminProducts);
}
function renderProducts(products) {
  const container = $('#products-container');
  if (!container) return;
  if (!products.length) { container.innerHTML = '<p class="empty-state">No menu items yet. Create your first product above.</p>'; return; }
  container.innerHTML = products.map(product => {
    const priceSummary = product.id === 'soft-drink'
      ? `Drink prices: ${[...(adminDrinkVariants.sizes || []), ...(adminDrinkVariants.additional_sizes || [])].map(size => `${esc(size.label.split(' ')[0])} ${money(size.price)}`).join(' · ')} (app configuration)`
      : product.sizes?.length ? `${money(product.price)} base · ${(product.sizes || []).map(size => `${esc(size.label)} ${money(size.price)}`).join(' · ')}` : money(product.price);
    return `<article class="product-admin-card"><img src="${esc(product.image)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/static/food-fallback.svg'"><div class="product-admin-copy"><div class="product-admin-title"><h3>${esc(product.name)}</h3><span class="status-pill ${product.available ? 'paid' : 'rejected'}">${product.available ? 'Available' : 'Archived / unavailable'}</span></div><p>${esc(product.category)} · <strong>${priceSummary}</strong></p><p>${esc(product.description)}</p><p class="subtle">ID: ${esc(product.id)}${product.featured ? ' · Featured' : ''}</p></div><div class="product-admin-actions"><button type="button" class="button button-outline" data-action="edit-product" data-id="${esc(product.id)}">Edit</button>${product.available ? `<button type="button" class="button danger-button" data-action="archive-product" data-id="${esc(product.id)}">Archive</button>` : `<button type="button" class="button" data-action="activate-product" data-id="${esc(product.id)}">Reactivate</button>`}</div></article>`;
  }).join('');
}
function resetProductForm() {
  const form = $('#product-form');
  form.reset();
  $('#product-id').value = '';
  $('#product-available').checked = true;
  $('#product-featured').checked = false;
  $('#product-form-title').textContent = 'Add Product';
  $('#save-product').textContent = 'Save Product';
  $('#product-form-message').textContent = '';
  $('#product-price').disabled = false;
  $('#product-price').title = '';
  form.hidden = true;
}
function fillProductForm(product) {
  $('#product-id').value = product.id;
  $('#product-name').value = product.name;
  $('#product-category').value = product.category;
  $('#product-price').disabled = product.id === 'soft-drink';
  $('#product-price').title = product.id === 'soft-drink' ? 'Soft drink size prices are configured in DRINK_VARIANTS in app.py.' : '';
  if (!$('#product-category').value) $('#product-category').value = 'Other';
  $('#product-price').value = String(product.price);
  $('#product-image').value = product.image;
  $('#product-description').value = product.description || '';
  const variantPrices = product.size_prices || {};
  $('#size-price-small').value = variantPrices.small ?? '';
  $('#size-price-medium').value = variantPrices.medium ?? '';
  $('#size-price-large').value = variantPrices.large ?? '';
  $('#size-price-xl').value = variantPrices.xl ?? '';
  $('#product-available').checked = Boolean(product.available);
  $('#product-featured').checked = Boolean(product.featured);
  $('#product-form-title').textContent = `Edit ${product.name}`;
  $('#save-product').textContent = 'Save Changes';
  $('#product-form-message').textContent = product.id === 'soft-drink' ? 'Soft drink size prices are configured in DRINK_VARIANTS in app.py; the base price field is disabled.' : '';
  $('#product-form').hidden = false;
  $('#product-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#product-name').focus({ preventScroll: true });
}
async function saveProduct(event) {
  event.preventDefault();
  const form = $('#product-form');
  if (!form.reportValidity()) return;
  const id = $('#product-id').value;
  const variantInputs = ['small', 'medium', 'large', 'xl'].map(size => $('#size-price-' + size).value.trim());
  const hasVariantPrice = variantInputs.some(value => value !== '');
  if (hasVariantPrice && variantInputs.some(value => value === '')) {
    $('#product-form-message').textContent = 'Enter all four size prices or leave all four blank.';
    return;
  }
  const payload = {
    name: $('#product-name').value.trim(),
    category: $('#product-category').value,
    description: $('#product-description').value.trim(),
    price: Number($('#product-price').value),
    image: $('#product-image').value.trim(),
    available: $('#product-available').checked,
    featured: $('#product-featured').checked
  };
  if (hasVariantPrice) payload.size_prices = { small: Number(variantInputs[0]), medium: Number(variantInputs[1]), large: Number(variantInputs[2]), xl: Number(variantInputs[3]) };
  const button = $('#save-product');
  button.disabled = true;
  const previousText = button.textContent;
  button.textContent = 'Saving…';
  $('#product-form-message').textContent = '';
  try {
    const result = await request(id ? `/api/admin/products/${encodeURIComponent(id)}` : '/api/admin/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    await loadProducts();
    resetProductForm();
    notice(result.message || 'Product saved.', 'success');
  } catch (error) {
    $('#product-form-message').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = $('#product-id').value ? 'Save Changes' : 'Save Product';
  }
}
async function productAction(button) {
  const id = button.dataset.id;
  const product = adminProducts.find(item => item.id === id);
  if (!product) return;
  if (button.dataset.action === 'edit-product') { fillProductForm(product); return; }
  button.disabled = true;
  try {
    if (button.dataset.action === 'archive-product') {
      if (!window.confirm(`Archive ${product.name}? It will disappear from new orders but historical order records will remain.`)) return;
      const result = await request(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      notice(result.message || 'Product archived.', 'success');
    } else if (button.dataset.action === 'activate-product') {
      const payload = { name: product.name, category: product.category, description: product.description, price: product.price, image: product.image, available: true, featured: product.featured };
      await request(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
      notice('Product reactivated.', 'success');
    }
    await loadProducts();
  } catch (error) { notice(error.message, 'error'); }
  finally { if (button.isConnected) button.disabled = false; }
}

function renderOrders(orders) {
  const container = $('#orders-container');
  if (!orders.length) {
    container.innerHTML = '<p class="empty-state">No orders matched this filter yet.</p>';
    return;
  }
  const statuses = ['Pending Confirmation', 'Confirmed', 'Preparing', 'Ready for Pickup', 'Out for Delivery', 'Completed', 'Cancelled'];
  container.innerHTML = orders.map(order => {
    const itemLines = (order.items || []).map(item => `<div class="item-row"><span>${esc(item.product_name)} × ${item.quantity}${item.addons?.length ? `<br><small>${esc(item.addons.map(x => x.name).join(', '))}</small>` : ''}${item.options?.product_size ? `<br><small>Size: ${esc(item.options.product_size.toUpperCase())}</small>` : ''}${item.options?.drink_brand ? `<br><small>${esc(item.options.drink_brand)} · ${esc(item.options.drink_size || '')}</small>` : ''}</span><strong>${money(item.line_total)}</strong></div>`).join('');
    const statusOptions = statuses.map(status => `<option value="${esc(status)}" ${status === order.order_status ? 'selected' : ''}>${esc(status)}</option>`).join('');
    const paymentStatus = esc(order.payment_status);
    const claimButtons = order.payment_status === 'Awaiting Verification' && ['gcash', 'maya'].includes(order.payment_method) ? `<div class="payment-review"><h4>Payment needs manual verification</h4><p>Method: <strong>${esc(order.payment_method.toUpperCase())}</strong></p><p>Reference: <strong>${esc(order.transaction_reference || 'Not supplied')}</strong></p><p>Claim submitted: ${esc(order.payment_claim_at || 'Unknown')}</p>${order.receipt_filename ? `<button class="button receipt-button" type="button" data-action="view-receipt" data-filename="${esc(order.receipt_filename)}">View receipt screenshot</button>` : '<p>No receipt screenshot uploaded.</p>'}<label class="subtle" for="reason-${esc(order.public_id)}">Rejection reason (required to reject)</label><textarea class="reason-field" id="reason-${esc(order.public_id)}" rows="2" maxlength="500" placeholder="Explain what needs to be corrected"></textarea><div class="payment-actions"><button class="button" type="button" data-action="approve-payment" data-id="${esc(order.public_id)}">Approve verified payment</button><button class="button danger-button" type="button" data-action="reject-payment" data-id="${esc(order.public_id)}">Reject claim</button></div><p class="subtle">Only approve after checking the actual incoming transaction in the merchant account.</p></div>` : '';
    const cashButton = order.payment_method === 'cash' && order.payment_status !== 'Paid' && order.order_status !== 'Cancelled' ? `<button class="button" type="button" data-action="cash-collected" data-id="${esc(order.public_id)}">Confirm cash collected</button>` : '';
    const events = (order.events || []).slice(-3).map(event => `<p class="event-line"><strong>${esc(event.event_type)}</strong><br><small>${esc(new Date(event.created_at).toLocaleString())}${event.details ? ' · ' + esc(event.details) : ''}</small></p>`).join('');
    return `<article class="order-card" data-order="${esc(order.public_id)}"><div class="order-card-header"><div><h3 class="order-id">${esc(order.public_id)}</h3><p>${esc(new Date(order.created_at).toLocaleString())} · ${esc(order.fulfillment_type.toUpperCase())}</p></div><div>${order.customer_edit_count > 0 ? `<span class="status-pill edited-pill" title="Last edited ${esc(order.customer_last_edited_at ? new Date(order.customer_last_edited_at).toLocaleString() : '')}">Edited by customer${order.customer_edit_count > 1 ? ` ×${order.customer_edit_count}` : ''}</span> ` : ''}<span class="status-pill">${esc(order.order_status)}</span> <span class="status-pill ${order.payment_status === 'Paid' ? 'paid' : order.payment_status === 'Awaiting Verification' || order.payment_status === 'Unpaid' ? 'pending' : order.payment_status === 'Rejected' ? 'rejected' : ''}">${paymentStatus}</span></div></div><div class="admin-order-grid"><section><h4>Customer</h4><p><strong>${esc(order.customer_name)}</strong></p><p>${esc(order.phone)}</p><p>${esc(order.address || (order.fulfillment_type === 'pickup' ? 'Pickup order' : 'No address supplied'))}</p>${order.notes ? `<p>Note: ${esc(order.notes)}</p>` : ''}</section><section><h4>Items</h4>${itemLines}<div class="item-row"><span>Subtotal</span><strong>${money(order.subtotal)}</strong></div><div class="item-row"><span>Delivery fee</span><strong>${money(order.delivery_fee)}</strong></div><div class="item-row"><strong>Total</strong><strong>${money(order.total)}</strong></div></section><section><h4>Payment</h4><p>Method: <strong>${esc(order.payment_method.toUpperCase())}</strong></p><p>Status: <strong>${paymentStatus}</strong></p>${order.transaction_reference ? `<p>Reference: ${esc(order.transaction_reference)}</p>` : ''}${order.verified_at ? `<p>Verified: ${esc(order.verified_at)}</p>` : ''}${order.payment_decision_reason ? `<p>Decision note: ${esc(order.payment_decision_reason)}</p>` : ''}${cashButton}</section></div>${claimButtons}<div class="status-update-row"><label for="status-${esc(order.public_id)}">Order status</label><select id="status-${esc(order.public_id)}" data-status-select="${esc(order.public_id)}">${statusOptions}</select><button class="button button-outline" type="button" data-action="update-status" data-id="${esc(order.public_id)}">Update status</button></div><details class="events-details"><summary>Recent activity</summary>${events || '<p class="subtle">No recorded updates.</p>'}</details></article>`;
  }).join('');
}
async function performAction(button, action) {
  const id = button.dataset.id;
  if (!id || button.disabled) return;
  const oldText = button.textContent;
  button.disabled = true;
  try {
    if (action === 'approve-payment') {
      const accepted = window.confirm(`Have you checked the official ${button.closest('.order-card')?.querySelector('.payment-review strong')?.textContent || 'e-wallet'} account and confirmed the exact transfer amount was received?`);
      if (!accepted) return;
      await request(`/api/admin/orders/${encodeURIComponent(id)}/payment-decision`, { method: 'POST', body: JSON.stringify({ decision: 'approve', reason: 'Transfer verified in the official business account.' }) });
      notice('Payment approved.', 'success');
    } else if (action === 'reject-payment') {
      const reason = $(`#reason-${CSS.escape(id)}`).value.trim();
      if (reason.length < 3) { notice('Enter a clear rejection reason first.', 'error'); return; }
      await request(`/api/admin/orders/${encodeURIComponent(id)}/payment-decision`, { method: 'POST', body: JSON.stringify({ decision: 'reject', reason }) });
      notice('Payment claim rejected.', 'success');
    } else if (action === 'cash-collected') {
      if (!window.confirm('Confirm that the full cash amount has actually been received?')) return;
      await request(`/api/admin/orders/${encodeURIComponent(id)}/cash-collected`, { method: 'POST', body: '{}' });
      notice('Cash collection recorded.', 'success');
    } else if (action === 'update-status') {
      const status = $(`[data-status-select="${CSS.escape(id)}"]`).value;
      await request(`/api/admin/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      notice('Order status updated.', 'success');
    }
    await loadOrders();
  } catch (error) { notice(error.message, 'error'); }
  finally { if (button.isConnected) { button.disabled = false; button.textContent = oldText; } }
}
async function viewReceipt(button) {
  const filename = button.dataset.filename;
  if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(filename || '')) { notice('Receipt reference is invalid.', 'error'); return; }
  button.disabled = true;
  try {
    const response = await fetch(`/api/admin/receipts/${encodeURIComponent(filename)}`, { headers: staffAuth.headers() });
    if (!response.ok) {
      let data = {}; try { data = await response.json(); } catch { /* no body */ }
      throw new Error(data.error || 'Could not load receipt.');
    }
    const blob = await response.blob();
    if (receiptObjectUrl) URL.revokeObjectURL(receiptObjectUrl);
    receiptObjectUrl = URL.createObjectURL(blob);
    $('#receipt-body').innerHTML = `<img class="receipt-preview" src="${receiptObjectUrl}" alt="Customer-submitted payment receipt screenshot"><p class="subtle">Check the details against the transaction shown in the official merchant app. The image is supporting evidence only.</p>`;
    $('#receipt-modal').hidden = false;
  } catch (error) { notice(error.message, 'error'); }
  finally { button.disabled = false; }
}
function bind() {
  $('#admin-login-form').addEventListener('submit', event => { event.preventDefault(); staffAuth.useToken($('#admin-token').value.trim()); unlock(); });
  $('#staff-account-form').addEventListener('submit', async event => {
    event.preventDefault();
    const message = $('#login-message');
    const button = $('#staff-account-submit');
    button.disabled = true;
    message.textContent = 'Signing in…';
    try {
      await staffAuth.signIn($('#staff-email').value.trim(), $('#staff-password').value);
      $('#staff-password').value = '';
      await unlock();
    } catch (error) {
      $('#staff-password').value = '';
      message.textContent = error.message;
    } finally { button.disabled = false; }
  });
  $('#refresh-orders').addEventListener('click', async () => { try { await loadOrders(); notice('Orders refreshed.', 'success'); } catch (error) { notice(error.message, 'error'); } });
  $('#order-filter').addEventListener('change', async event => { currentFilter = event.target.value; try { await loadOrders(); } catch (error) { notice(error.message, 'error'); } });
  $('#admin-logout').addEventListener('click', () => { staffAuth.clear(); $('#dashboard').hidden = true; $('#login-panel').hidden = false; $('#admin-token').value = ''; $('#login-message').textContent = 'Dashboard locked for this tab.'; });
  $('#orders-container').addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'view-receipt') viewReceipt(button);
    else performAction(button, button.dataset.action);
  });
  $('#products-container').addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (button) productAction(button);
  });
  $('#product-form').addEventListener('submit', saveProduct);
  $('#new-product').addEventListener('click', () => { resetProductForm(); $('#product-form').hidden = false; $('#product-form').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#product-name').focus({ preventScroll: true }); });
  $('#cancel-product-edit').addEventListener('click', resetProductForm);
  $('#close-receipt').addEventListener('click', () => { $('#receipt-modal').hidden = true; if (receiptObjectUrl) { URL.revokeObjectURL(receiptObjectUrl); receiptObjectUrl = null; } });
  $('#receipt-modal').addEventListener('click', event => { if (event.target.id === 'receipt-modal') $('#close-receipt').click(); });
}
document.addEventListener('DOMContentLoaded', async () => {
  bind();
  const saved = staffAuth.saved();
  if (saved) await unlock();
}, { once: true });
