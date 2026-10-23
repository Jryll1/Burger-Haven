(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const staffAuth = window.BurgerHavenStaffAuth;
  const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(Number(value) || 0).replace('PHP', '₱').replace(/\s/g, '');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toast(message, type='') { const node=$('#analytics-toast'); node.textContent=message; node.className=`toast show ${type}`.trim(); window.setTimeout(()=>{node.className='toast';},3000); }
  async function request() {
    const response = await fetch('/api/analytics', { headers: staffAuth.headers(), cache: 'no-store' });
    let data={}; try { data=await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || data.detail || `Request failed (${response.status})`);
    return data;
  }
  function renderTrend(rows) {
    const target=$('#sales-trend');
    if (!rows?.length) { target.innerHTML='<p class="empty-state">No orders have been recorded in the last 30 days.</p>'; return; }
    const max=Math.max(1,...rows.map(row=>Number(row.revenue)||0));
    target.innerHTML=rows.map(row=>{const value=Number(row.revenue)||0;const pct=Math.max(value>0?2:0,Math.round(value/max*100));return `<div class="trend-row"><div class="trend-meta"><span>${esc(row.date)}</span><span>${money(value)} · ${Number(row.orders)||0} orders</span></div><div class="trend-track"><span style="width:${pct}%"></span></div></div>`;}).join('');
  }
  function recalculateScenario() {
    const units = Number($('#scenario-units')?.value);
    const price = Number($('#scenario-price')?.value);
    const cost = Number($('#scenario-cost')?.value);
    const message = $('#scenario-message');
    if (![units,price,cost].every(Number.isFinite) || !Number.isInteger(units) || units < 0 || units > 100000 || price < 0 || price > 100000 || cost < 0 || cost > 100000) {
      if (message) message.textContent = 'Enter a whole-number quantity from 0 to 100000 and prices/costs from 0 to 100000.';
      return;
    }
    const revenue = units * price;
    const totalCost = units * cost;
    const profit = revenue - totalCost;
    $('#scenario-revenue').textContent = money(revenue);
    $('#scenario-total-cost').textContent = money(totalCost);
    $('#scenario-profit').textContent = money(profit);
    $('#scenario-margin').textContent = (revenue ? profit / revenue * 100 : 0).toFixed(1) + '%';
    if (message) message.textContent = 'Scenario recalculated automatically. These are hypothetical figures.';
  }
  let scenarioTimer;
  ['#scenario-units','#scenario-price','#scenario-cost'].forEach(selector => $(selector)?.addEventListener('input', () => {
    window.clearTimeout(scenarioTimer);
    scenarioTimer = window.setTimeout(recalculateScenario, 75);
  }));
  function render(data) {
    const summary=data.summary||{};
    $('#analytics-total-orders').textContent=String(summary.total_orders??0);
    $('#analytics-paid-sales').textContent=money(summary.paid_sales??0);
    $('#analytics-pending-orders').textContent=String(summary.pending_orders??0);
    $('#analytics-completed-orders').textContent=String(summary.completed_orders??0);
    $('#analytics-cancelled-orders').textContent=String(summary.cancelled_orders??0);
    $('#analytics-average-order').textContent=money(summary.average_paid_order??0);
    const statusRows=data.orders_by_status||[];
    $('#orders-by-status').innerHTML=statusRows.length?statusRows.map(row=>`<div class="analytics-list-row"><span>${esc(row.order_status)}</span><strong>${Number(row.count)||0}</strong></div>`).join(''):'<p class="empty-state">No order status data yet.</p>';
    const products=data.top_products||[];
    $('#top-products-body').innerHTML=products.length?products.map(item=>`<tr><td>${esc(item.product_name)}</td><td>${Number(item.quantity)||0}</td><td>${money(item.sales||0)}</td></tr>`).join(''):'<tr><td colspan="3">No product sales recorded yet.</td></tr>';
    renderTrend(data.sales_trend||[]);
    recalculateScenario();
  }
  async function unlock() {
    $('#analytics-login-message').textContent='Checking administrator access…';
    try {
      const data=await request(); render(data);
      $('#analytics-login-panel').hidden=true; $('#analytics-dashboard').hidden=false;
      $('#analytics-login-message').textContent=''; toast('Admin analytics unlocked.','success');
    } catch (error) {
      staffAuth.clear();
      $('#analytics-login-message').textContent=/invalid admin token/i.test(error.message)?'Access denied. Use an administrator account or the configured administrator ADMIN_TOKEN.':error.message;
    }
  }
  $('#analytics-login-form').addEventListener('submit',event=>{event.preventDefault();staffAuth.useToken($('#analytics-token').value.trim());unlock();});
  $('#analytics-account-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const message=$('#analytics-login-message'), button=$('#analytics-account-submit');
    button.disabled=true; message.textContent='Signing in…';
    try {
      await staffAuth.signIn($('#analytics-email').value.trim(), $('#analytics-password').value);
      $('#analytics-password').value='';
      await unlock();
    } catch (error) { $('#analytics-password').value=''; message.textContent=error.message; }
    finally { button.disabled=false; }
  });
  $('#refresh-analytics').addEventListener('click',async()=>{try{render(await request());toast('Analytics refreshed.','success');}catch(error){toast(error.message,'error');}});
  $('#analytics-logout').addEventListener('click',()=>{staffAuth.clear();$('#analytics-dashboard').hidden=true;$('#analytics-login-panel').hidden=false;$('#analytics-token').value='';$('#analytics-login-message').textContent='Analytics locked for this tab.';});
  if (staffAuth.saved()) unlock();
})();