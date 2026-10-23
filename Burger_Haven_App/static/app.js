'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const STORE_CART = 'burgerHavenCart_v2';
const STORE_LAST_ORDER = 'burgerHavenLastOrder_v2';
const STORE_AUTH_TOKEN = 'burgerHavenCustomerToken_v1';
const STORE_AUTH_USER = 'burgerHavenCustomerUser_v1';
let products = [];
let addons = {};
let drinkVariants = {
  brands: ['Sprint', 'Sprite', 'Royal', 'Coke', 'Pepsi'],
  sizes: [{ id: 'small', label: 'Small (250 ml)', price: 25 }, { id: 'regular', label: 'Medium (330 ml)', price: 35 }, { id: 'large', label: 'Large (500 ml)', price: 50 }]
};
let config = null;
let cart = loadCart();
let currentCategory = 'All';
let currentSearch = '';
let pendingProductId = null;
let toastTimer = null;
let activeOrder = null;
let activeOrderToken = '';
let requestInProgress = false;
let authToken = (() => { try { return localStorage.getItem(STORE_AUTH_TOKEN) || ''; } catch { return ''; } })();
let authUser = (() => { try { return JSON.parse(localStorage.getItem(STORE_AUTH_USER) || 'null'); } catch { return null; } })();
let authMode = 'login';
let customerOrders = [];
let customerOrdersLoading = false;
let editingOrderId = '';
let orderEditItems = [];
let orderEditSaving = false;
// A clearly labeled local preview keeps the visual design usable when opened without FastAPI.
let previewMode = (window.location.protocol === 'file:');

function allDrinkSizes() { return [...(drinkVariants.sizes || []), ...(drinkVariants.additional_sizes || [])]; }
function allDrinkBrands() { return [...(drinkVariants.brands || []), ...(drinkVariants.additional_brands || [])]; }
function money(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(Number(value) || 0).replace('PHP', '₱').replace(/\s/g, '');
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function loadCart() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_CART) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(item => item && typeof item.product_id === 'string' && Number.isInteger(item.quantity) && item.quantity > 0).slice(0, 100).map(item => {
      const options = item.options && typeof item.options === 'object' && !Array.isArray(item.options) ? item.options : {};
      const drinkOptions = ['soft-drink', 'burger-combo'].includes(item.product_id) && (!options.drink_brand || !options.drink_size)
        ? { drink_brand: 'Sprite', drink_size: 'regular' } : options;
      return { ...item, addons: Array.isArray(item.addons) ? item.addons : [], options: drinkOptions };
    });
  } catch { return []; }
}
function saveCart() {
  try { localStorage.setItem(STORE_CART, JSON.stringify(cart)); } catch { /* Cart remains usable for this page session. */ }
  renderCart();
}
function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${type}`.trim();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2900);
}
async function api(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw.slice(0, 300) || 'Unexpected server response.' }; }
    if (!response.ok) { const detail = Array.isArray(data.detail) ? data.detail.map(entry => entry.msg || 'Invalid input').join(' ') : data.detail; throw new Error(data.error || detail || `Request failed (${response.status}).`); }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request took too long. Check your connection and try again.');
    if (error instanceof TypeError) throw new Error('Unable to reach Burger Haven right now. Check that the app server is running and try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function showPreviewMode(message = 'You are viewing the visual preview. Run the FastAPI server to enable real checkout, order tracking, and staff tools.') {
  previewMode = true;
  config = { delivery_fee: 30, minimum_order: 0, payments: { cash: { enabled: true, cash_on_delivery: true, cash_on_pickup: true }, gcash: { configured: false }, maya: { configured: false } } };
  addons = {
    'extra-cheese': { name: 'Extra cheese', price: 20 },
    bacon: { name: 'Bacon', price: 30 }
  };
  drinkVariants = { brands: ['Sprint', 'Sprite', 'Royal', 'Coke', 'Pepsi'], additional_brands: ['7-Up', 'Mirinda', 'Mountain Dew'], sizes: [{ id: 'small', label: 'Small (250 ml)', price: 25 }, { id: 'regular', label: 'Medium (330 ml)', price: 35 }, { id: 'large', label: 'Large (500 ml)', price: 50 }], additional_sizes: [{ id: 'xl', label: 'XL (700 ml)', price: 60 }] };
  products = [
    { id: 'classic-burger', name: 'Classic Burger', category: 'Burgers', description: 'Juicy beef patty, fresh lettuce, tomato, cheese, and house sauce.', price: 120, image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80', available: true, featured: true },
    { id: 'bbq-bacon-burger', name: 'BBQ Bacon Burger', category: 'Burgers', description: 'Smoky BBQ sauce, crispy bacon, cheese, and a grilled beef patty.', price: 150, image: 'https://images.unsplash.com/photo-1553979459-d2229ba7433a?auto=format&fit=crop&w=900&q=80', available: true, featured: true },
    { id: 'spicy-burger', name: 'Spicy Burger', category: 'Burgers', description: 'Beef, peppery spicy sauce, lettuce, tomato, and melted cheese.', price: 140, image: 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=900&q=80', available: true, featured: false },
    { id: 'double-cheeseburger', name: 'Double Cheeseburger', category: 'Burgers', description: 'Two beef patties, double cheese, pickles, and special sauce.', price: 180, image: 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=900&q=80', available: true, featured: true },
    { id: 'crispy-fries', name: 'Crispy Fries', category: 'Sides', description: 'Golden fries, lightly seasoned and served hot.', price: 40, image: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80', available: true, featured: false },
    { id: 'onion-rings', name: 'Onion Rings', category: 'Sides', description: 'Crunchy onion rings with a golden coating.', price: 55, image: 'https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=900&q=80', available: true, featured: false },
    { id: 'soft-drink', name: 'Soft Drink', category: 'Drinks', description: 'Choose Sprint, Sprite, Royal, Coke, Pepsi, 7-Up, Mirinda, or Mountain Dew in four cup sizes.', price: 25, image: 'https://images.unsplash.com/photo-1581006852262-e4307cf6283a?auto=format&fit=crop&w=900&q=80', available: true, featured: false },
    { id: 'burger-combo', name: 'Burger Combo', category: 'Combos', description: 'Classic Burger with fries and a soft drink.', price: 175, image: 'https://images.unsplash.com/photo-1551782450-a2132b4ba21d?auto=format&fit=crop&w=900&q=80', available: true, featured: true }
  ];
  products.push(
    { id:'beef-burger-b1t1', name:'Beef Burger Sandwich — B1T1', category:'Buy 1 Take 1', description:'Classic beef patty with mayo and ketchup. Includes two sandwiches.', price:44, image:'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80', available:true, featured:true },
    { id:'cheeseburger-b1t1', name:'Cheeseburger Sandwich — B1T1', category:'Buy 1 Take 1', description:'Beef patty, cheese, mayo, and ketchup. Includes two sandwiches.', price:58, image:'https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=900&q=80', available:true, featured:true },
    { id:'cheesy-hotdog-b1t1', name:'Cheesy Hotdog Sandwich — B1T1', category:'Hotdogs & Sausages', description:'Cheesy hotdog sandwich promotion; includes two sandwiches.', price:44, image:'https://images.unsplash.com/photo-1612392062798-2dbaa8f4c5d6?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'jumbo-cheese-footlong', name:'Jumbo Cheese Footlong', category:'Hotdogs & Sausages', description:'Jumbo footlong sausage topped with cheese.', price:60, image:'https://images.unsplash.com/photo-1612392062798-2dbaa8f4c5d6?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'cheesy-hungarian', name:'Cheesy Hungarian Sandwich', category:'Hotdogs & Sausages', description:'Hungarian sausage with cheese.', price:70, image:'https://images.unsplash.com/photo-1612392062798-2dbaa8f4c5d6?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'ham-sandwich', name:'Ham Sandwich', category:'Ham Sandwiches', description:'Classic ham sandwich.', price:26, image:'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'ham-cheese-sandwich', name:'Ham and Cheese Sandwich', category:'Ham Sandwiches', description:'Ham and cheese sandwich.', price:33, image:'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'ham-egg-sandwich', name:'Ham and Egg Sandwich', category:'Ham Sandwiches', description:'Ham and egg sandwich.', price:43, image:'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'ham-cheese-egg-sandwich', name:'Ham, Cheese, and Egg Sandwich', category:'Ham Sandwiches', description:'Ham, cheese, and egg sandwich.', price:50, image:'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'bacon-sandwich', name:'Bacon Sandwich', category:'Bacon Sandwiches', description:'Smoky bacon sandwich.', price:36, image:'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'bacon-cheese-sandwich', name:'Bacon and Cheese Sandwich', category:'Bacon Sandwiches', description:'Bacon and cheese sandwich.', price:43, image:'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'bacon-cheese-egg-sandwich', name:'Bacon, Cheese, and Egg Sandwich', category:'Bacon Sandwiches', description:'Bacon, cheese, and egg sandwich.', price:60, image:'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'egg-sandwich', name:'Egg Sandwich', category:'Egg & Specialty Sandwiches', description:'Classic egg sandwich.', price:33, image:'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'tater-tots', name:'Tater Tots', category:'Sides', description:'Crispy potato bites.', price:55, image:'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'potato-wedges', name:'Potato Wedges', category:'Sides', description:'Seasoned golden potato wedges.', price:55, image:'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'fried-pickles', name:'Fried Pickles', category:'Sides', description:'Tangy pickles with a crisp coating.', price:60, image:'https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'jalapeno-poppers', name:'Jalapeño Poppers', category:'Sides', description:'Crispy jalapeño bites.', price:70, image:'https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'cheese-curds', name:'Cheese Curds', category:'Sides', description:'Crispy cheese bites.', price:75, image:'https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'sweet-potato-fries', name:'Sweet Potato Fries', category:'Sides', description:'Crispy sweet potato fries.', price:60, image:'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'fried-zucchini', name:'Fried Zucchini', category:'Sides', description:'Crispy battered zucchini.', price:60, image:'https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'creamy-coleslaw', name:'Creamy Coleslaw', category:'Sides', description:'Shredded cabbage with tangy dressing.', price:35, image:'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'potato-salad', name:'Potato Salad', category:'Sides', description:'Creamy potato salad.', price:40, image:'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'pasta-salad', name:'Pasta or Orzo Salad', category:'Sides', description:'Chilled pasta salad.', price:45, image:'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'cucumber-tomato-salad', name:'Cucumber and Tomato Salad', category:'Sides', description:'Fresh cucumber and tomato salad.', price:40, image:'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'smoky-baked-beans', name:'Smoky Baked Beans', category:'Sides', description:'Sweet and smoky baked beans.', price:45, image:'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'mac-and-cheese', name:'Macaroni and Cheese', category:'Sides', description:'Creamy macaroni and cheese.', price:55, image:'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'mexican-street-corn', name:'Mexican Street Corn', category:'Sides', description:'Corn with a creamy savory topping.', price:50, image:'https://images.unsplash.com/photo-1551754655-cd27e38d2076?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'bottled-water', name:'Bottled Mineral Water', category:'Drinks', description:'Bottled mineral water. Actual package volume needs owner confirmation.', price:25, image:'https://images.unsplash.com/photo-1559839914-17aae19cec71?auto=format&fit=crop&w=900&q=80', available:true, featured:false },
    { id:'lipton-iced-tea', name:'Lipton Iced Tea', category:'Drinks', description:'Refreshing iced tea.', price:46, image:'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=900&q=80', available:true, featured:false }
  );
  let banner = $('#preview-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'preview-banner';
    banner.className = 'preview-banner';
    banner.setAttribute('role', 'status');
    const header = $('.site-header');
    if (header) header.insertAdjacentElement('afterend', banner);
  }
  banner.innerHTML = `<strong>DESIGN PREVIEW MODE</strong><span>${escapeHtml(message)} Real orders and payment verification are disabled until you run the app server.</span>`;
  banner.hidden = false;
  renderProducts();
  renderCart();
  syncPaymentOptions();
  updateCheckoutSummary();
}

async function init() {
  $('#year').textContent = String(new Date().getFullYear());
  bindEvents();
  updateAuthButton();
  renderCart();
  if (previewMode) {
    showPreviewMode();
    return;
  }
  await Promise.all([loadConfig(), loadProducts()]);
  await restoreCustomerSession();
  updateCheckoutSummary();
  const last = getLastOrder();
  if (last) {
    $('#track-order-id').value = last.public_id || '';
    $('#track-token').value = last.access_token || '';
  }
}
async function loadConfig() {
  try {
    config = await api('/api/config');
    syncPaymentOptions();
  } catch (error) {
    config = { delivery_fee: 30, payments: { cash: { enabled: true }, gcash: { configured: false }, maya: { configured: false } } };
    // Product loading will switch to an explicitly labeled preview if the backend is unavailable.
    syncPaymentOptions();
  }
}
async function loadProducts() {
  const message = $('#menu-message');
  try {
    const data = await api('/api/products');
    products = data.products || [];
    addons = data.addons || {};
    if (data.drink_variants) drinkVariants = data.drink_variants;
    renderProducts();
    renderCart();
    message.textContent = '';
  } catch (error) {
    // If the site was opened from disk or a static preview server, keep the real design visible.
    showPreviewMode('The backend is not connected in this preview. Start the FastAPI server for real orders and staff verification.');
    message.textContent = 'Preview menu loaded. Real product and order data require the backend server.';
  }
}
function syncPaymentOptions() {
  const select = $('#payment-method');
  if (!select || !config) return;
  const selected = select.value;
  const gcash = select.querySelector('option[value="gcash"]');
  const maya = select.querySelector('option[value="maya"]');
  gcash.disabled = !config.payments?.gcash?.configured;
  gcash.textContent = gcash.disabled ? 'GCash (configure business account first)' : 'GCash (manual verification)';
  maya.disabled = !config.payments?.maya?.configured;
  maya.textContent = maya.disabled ? 'Maya (configure business account first)' : 'Maya (manual verification)';
  const cash = select.querySelector('option[value="cash"]');
  cash.disabled = config.payments?.cash?.enabled === false;
  if (select.selectedOptions[0]?.disabled) select.value = cash.disabled ? (gcash.disabled ? 'maya' : 'gcash') : 'cash';
  if (select.selectedOptions[0]?.disabled) select.value = 'cash';
  if (selected && select.querySelector(`option[value="${selected}"]`) && !select.querySelector(`option[value="${selected}"]`).disabled) select.value = selected;
  updateCheckoutSummary();
}
function renderCategoryTabs() {
  const container = $('#category-tabs');
  if (!container) return;
  const cats = ['All', 'Featured', ...[...new Set(products.map(product => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b))];
  container.innerHTML = cats.map(category => `<button class="category-tab ${currentCategory === category ? 'active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('');
}
function visibleProducts() {
  const term = currentSearch.trim().toLocaleLowerCase();
  return products.filter(product => (currentCategory === 'All' || (currentCategory === 'Featured' ? product.featured : product.category === currentCategory)) && (!term || `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase().includes(term)));
}
function localProductSizes(product) {
  if (Array.isArray(product?.sizes) && product.sizes.length) return product.sizes;
  if (!product || ['soft-drink', 'burger-combo', 'beef-burger-b1t1', 'cheeseburger-b1t1', 'cheesy-hotdog-b1t1'].includes(product.id)) return [];
  const base = Number(product.price || 0);
  const sidePrices = {
    'crispy-fries':[35,50,70,90], 'onion-rings':[45,60,80,100], 'tater-tots':[40,55,75,95], 'potato-wedges':[40,55,75,95], 'fried-pickles':[45,60,80,100], 'jalapeno-poppers':[50,70,90,115], 'cheese-curds':[55,75,100,125], 'sweet-potato-fries':[45,60,85,110], 'fried-zucchini':[45,60,80,100], 'creamy-coleslaw':[25,35,50,65], 'potato-salad':[30,40,55,70], 'pasta-salad':[35,45,60,75], 'cucumber-tomato-salad':[30,40,55,70], 'smoky-baked-beans':[30,45,60,80], 'mac-and-cheese':[40,55,75,95], 'mexican-street-corn':[35,50,70,90], 'bottled-water':[23,25,28,30], 'lipton-iced-tea':[43,46,49,52]
  };
  const ids = ['small', 'medium', 'large', 'xl'];
  const labels = ['Small', 'Medium', 'Large', 'XL'];
  const prices = sidePrices[product.id] || [base, base + 10, base + 20, base + 30];
  return ids.map((id, index) => ({ id, label: labels[index], price: prices[index], capacity_ml: null }));
}
function productSizePrice(product, sizeId) {
  const size = localProductSizes(product).find(entry => entry.id === sizeId);
  return Number(size?.price ?? product?.price ?? 0);
}
function renderProducts() {
  const grid = $('#menu-grid');
  renderCategoryTabs();
  const list = visibleProducts();
  renderCalculatorOptions();
  if (!list.length) {
    grid.innerHTML = '<div class="empty-state">No menu items matched. Try a different search or category.</div>';
    return;
  }
  grid.innerHTML = list.map(product => {
    const sizes = localProductSizes(product);
    const minPrice = sizes.length ? Math.min(...sizes.map(size => Number(size.price))) : Number(product.price || 0);
    const priceLabel = product.id === 'soft-drink' ? `From ${money(minDrinkPrice())}` : sizes.length ? `From ${money(minPrice)}` : money(product.price);
    const description = product.id === 'soft-drink' ? 'Choose Sprint, Sprite, Royal, Coke, Pepsi, 7-Up, Mirinda, or Mountain Dew. Multiple sizes available.' : product.id === 'burger-combo' ? 'Classic Burger, fries, and your choice of soft drink brand and size.' : product.description;
    const promo = String(product.name).includes('B1T1') || product.category === 'Buy 1 Take 1';
    return `
    <article class="food-card">
      <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" width="600" height="400" onerror="this.onerror=null;this.src='static/food-fallback.svg'">
      <div class="food-content"><div class="food-meta"><span class="category-pill">${escapeHtml(product.category)}</span>${promo ? '<span class="promo-pill">BUY 1 TAKE 1</span>' : ''}${product.featured ? '<span aria-label="Featured" title="Featured">★</span>' : ''}</div>
      <h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(description)}</p>
      <div class="food-bottom"><strong>${priceLabel}</strong><button class="button add-button" type="button" data-action="customize" data-id="${escapeHtml(product.id)}" aria-label="Customize and add ${escapeHtml(product.name)}">+</button></div></div>
    </article>`;
  }).join('');
}
function calculatorBurgerProducts() {
  const active = products.filter(product => product.available !== false);
  const burgers = active.filter(product => String(product.category || '').toLowerCase() === 'burgers');
  return burgers.length ? burgers : active;
}
function calculatorSideProduct(kind) {
  const active = products.filter(product => product.available !== false);
  if (kind === 'fries') {
    return active.find(product => product.id === 'crispy-fries') || active.find(product => /fries/i.test(product.name)) || active.find(product => String(product.category || '').toLowerCase() === 'sides');
  }
  return active.find(product => product.id === 'soft-drink') || active.find(product => String(product.category || '').toLowerCase() === 'drinks');
}
function minDrinkPrice() {
  const prices = (drinkVariants.sizes || []).map(size => Number(size.price)).filter(price => Number.isFinite(price) && price >= 0);
  return prices.length ? Math.min(...prices) : 25;
}
function selectedDrinkSize() {
  const id = $('#calc-drink-size')?.value || 'regular';
  return allDrinkSizes().find(size => size.id === id) || allDrinkSizes()[0] || { id: 'regular', label: 'Medium (330 ml)', price: 35 };
}
function drinkPrice(options) {
  const sizeId = options?.drink_size || 'regular';
  const size = allDrinkSizes().find(value => value.id === sizeId);
  return Number(size?.price ?? 35);
}
function drinkItemName(options) {
  const brand = options?.drink_brand || 'Sprite';
  const size = allDrinkSizes().find(value => value.id === (options?.drink_size || 'regular'));
  return `Soft Drink — ${brand} · ${size?.label || 'Medium (330 ml)'}`;
}
function renderCalculatorOptions() {
  const select = $('#calc-burger');
  if (!select) return;
  const options = calculatorBurgerProducts();
  const previous = select.value;
  if (!options.length) {
    select.innerHTML = '<option value="">No available products</option>';
    select.disabled = true;
  } else {
    select.innerHTML = options.map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} (${money(product.price)})</option>`).join('');
    select.disabled = false;
    if (options.some(product => product.id === previous)) select.value = previous;
  }
  const fries = calculatorSideProduct('fries');
  const drink = calculatorSideProduct('drink');
  const friesInput = $('#calc-fries');
  const drinkInput = $('#calc-drink');
  if (friesInput) {
    friesInput.disabled = !fries;
    if (!fries) friesInput.checked = false;
    const friesVariants = fries ? localProductSizes(fries) : [];
    const friesSizeSelect = $('#calc-fries-size');
    const previousFriesSize = friesSizeSelect?.value || 'medium';
    if (friesSizeSelect) {
      friesSizeSelect.innerHTML = friesVariants.length
        ? friesVariants.map(size => `<option value="${escapeHtml(size.id)}">${escapeHtml(size.label)} — ${money(size.price)}</option>`).join('')
        : '<option value="medium">Standard</option>';
      if (friesVariants.some(size => size.id === previousFriesSize)) friesSizeSelect.value = previousFriesSize;
    }
    const selectedFriesVariant = friesVariants.find(size => size.id === (friesSizeSelect?.value || 'medium'));
    $('#calc-fries-price').textContent = fries ? `(+${money(selectedFriesVariant?.price ?? fries.price)})` : '(Unavailable)';
    const label = friesInput.closest('label');
    if (label) label.classList.toggle('option-unavailable', !fries);
    const friesOptions = $('#calc-fries-options');
    if (friesOptions) friesOptions.hidden = !friesInput.checked || !friesVariants.length;
  }
  if (drinkInput) {
    drinkInput.disabled = !drink;
    if (!drink) drinkInput.checked = false;
    $('#calc-drink-price').textContent = drink ? `From ${money(minDrinkPrice())}` : '(Unavailable)';
    const label = drinkInput.closest('label');
    if (label) label.classList.toggle('option-unavailable', !drink);
    const drinkOptions = $('#calc-drink-options');
    if (drinkOptions) drinkOptions.hidden = !drinkInput.checked;
  }
  const brandSelect = $('#calc-drink-brand');
  if (brandSelect) {
    const oldBrand = brandSelect.value;
    brandSelect.innerHTML = allDrinkBrands().map(brand => `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`).join('');
    if (allDrinkBrands().includes(oldBrand)) brandSelect.value = oldBrand;
  }
  const drinkSizeSelect = $('#calc-drink-size');
  if (drinkSizeSelect) {
    const oldSize = drinkSizeSelect.value || 'regular';
    drinkSizeSelect.innerHTML = allDrinkSizes().map(size => `<option value="${escapeHtml(size.id)}">${escapeHtml(size.label)} — ${money(size.price)}</option>`).join('');
    if (allDrinkSizes().some(size => size.id === oldSize)) drinkSizeSelect.value = oldSize;
  }
  const foodSizeSelect = $('#calc-size');
  if (foodSizeSelect) {
    const selectedBurger = currentProduct(select.value) || options[0];
    const previousSize = foodSizeSelect.value || 'medium';
    const sizes = localProductSizes(selectedBurger);
    foodSizeSelect.innerHTML = sizes.length ? sizes.map(size => `<option value="${escapeHtml(size.id)}">${escapeHtml(size.label)} — ${money(size.price)}</option>`).join('') : '<option value="medium">Medium / Standard</option>';
    if (sizes.some(size => size.id === previousSize)) foodSizeSelect.value = previousSize;
    else if ([...foodSizeSelect.options].some(option => option.value === 'medium')) foodSizeSelect.value = 'medium';
    foodSizeSelect.disabled = !sizes.length;
  }
  if ($('#calc-cheese-price')) $('#calc-cheese-price').textContent = `(+${money(addons['extra-cheese']?.price ?? 20)})`;
  if ($('#calc-bacon-price')) $('#calc-bacon-price').textContent = `(+${money(addons.bacon?.price ?? 30)})`;
  updateQuickCalculator();
}
function selectedCalculatorItems() {
  const product = currentProduct($('#calc-burger')?.value);
  if (!product || product.available === false) return { product: null, quantity: 1, selectedAddons: [], sideProducts: [], unitTotal: 0, summaryNames: [] };
  const quantityInput = $('#calc-quantity');
  const parsed = Number.parseInt(quantityInput?.value || '1', 10);
  const quantity = Math.max(1, Math.min(20, Number.isFinite(parsed) ? parsed : 1));
  if (quantityInput && String(quantityInput.value) !== String(quantity)) quantityInput.value = String(quantity);
  const selectedAddons = $$('[data-calc-addon]:checked').map(input => input.dataset.calcAddon).filter(id => addons[id]);
  const sideProducts = [];
  if ($('#calc-fries')?.checked) {
    const fries = calculatorSideProduct('fries');
    if (fries) {
      const sizeId = $('#calc-fries-size')?.value || 'medium';
      const size = localProductSizes(fries).find(entry => entry.id === sizeId);
      sideProducts.push({ ...fries, price: Number(size?.price ?? fries.price), options: size ? { product_size: size.id } : {}, displayName: size ? `${fries.name} — ${size.label}` : fries.name });
    }
  }
  if ($('#calc-drink')?.checked) {
    const drink = calculatorSideProduct('drink');
    if (drink) {
      const selectedSize = selectedDrinkSize();
      sideProducts.push({ ...drink, price: Number(selectedSize.price), options: { drink_brand: $('#calc-drink-brand')?.value || 'Sprite', drink_size: selectedSize.id }, displayName: drinkItemName({ drink_brand: $('#calc-drink-brand')?.value || 'Sprite', drink_size: selectedSize.id }) });
    }
  }
  const sizeId = $('#calc-size')?.value || 'medium';
  const baseBurgerPrice = productSizePrice(product, sizeId);
  const addonTotal = selectedAddons.reduce((total, id) => total + Number(addons[id]?.price || 0), 0);
  const sidesTotal = sideProducts.reduce((total, item) => total + Number(item.price || 0), 0);
  const unitTotal = baseBurgerPrice + addonTotal + sidesTotal;
  const summaryNames = [
    ...selectedAddons.map(id => addons[id]?.name || id),
    ...sideProducts.map(item => item.displayName || item.name)
  ];
  return { product, quantity, selectedAddons, sideProducts, unitTotal, summaryNames, sizeId };
}
function updateQuickCalculator(message) {
  if (!$('#calc-total')) return;
  const order = selectedCalculatorItems();
  $('#calc-summary-burger').textContent = order.product?.name || 'No product available';
  $('#calc-summary-addons').textContent = order.summaryNames.length ? order.summaryNames.join(', ') : 'None';
  $('#calc-summary-quantity').textContent = `×${order.quantity}`;
  $('#calc-total').textContent = money(order.unitTotal * order.quantity);
  $('#add-calculator-to-cart').disabled = !order.product;
  if (message) $('#calculator-message').textContent = message;
}
function addQuickCalculatorMeal() {
  const order = selectedCalculatorItems();
  if (!order.product) {
    $('#calculator-message').textContent = 'No available products are listed right now.';
    return;
  }
  const before = cart.map(item => ({ ...item, addons: [...(item.addons || [])], options: { ...(item.options || {}) } }));
  const requested = [
    { product_id: order.product.id, quantity: order.quantity, addons: order.selectedAddons, options: localProductSizes(order.product).length ? { product_size: order.sizeId } : {} },
    ...order.sideProducts.map(product => ({ product_id: product.id, quantity: order.quantity, addons: [], options: product.options || {} }))
  ];
  for (const item of requested) {
    const key = cartKey(item);
    const existing = cart.find(value => cartKey(value) === key);
    if (existing) existing.quantity = Math.min(20, existing.quantity + item.quantity);
    else if (cart.length < 30) cart.push(item);
    else {
      cart = before;
      $('#calculator-message').textContent = 'Your cart has reached the 30-item limit. Remove an item before adding this meal.';
      return;
    }
  }
  saveCart();
  $('#calculator-message').textContent = `${order.product.name} meal added to your cart. The cart and checkout will use the live menu prices.`;
  toast('Meal added to cart.', 'success');
  openCart();
}

function currentProduct(id) { return products.find(item => item.id === id); }
function cartKey(item) { return `${item.product_id}|${[...(item.addons || [])].sort().join(',')}|${JSON.stringify(item.options || {})}`; }
function cartItemDisplayName(product, item) {
  if (product?.id === 'soft-drink') return drinkItemName(item.options);
  if (product?.id === 'burger-combo') return `Burger Combo — ${item.options?.drink_brand || 'Sprite'} · ${allDrinkSizes().find(size => size.id === item.options?.drink_size)?.label || 'Medium (330 ml)'}`;
  const size = product && item.options?.product_size ? localProductSizes(product).find(entry => entry.id === item.options.product_size) : null;
  return product?.name || 'Menu item';
}
function cartPrice(item) {
  const product = currentProduct(item.product_id);
  if (!product) return 0;
  if (product.id === 'soft-drink') return drinkPrice(item.options) * item.quantity;
  if (product.id === 'burger-combo') {
    const regularPrice = Number(allDrinkSizes().find(size => size.id === 'regular')?.price ?? 35);
    return Math.max(0, Number(product.price) + drinkPrice(item.options) - regularPrice) * item.quantity;
  }
  const extras = (item.addons || []).reduce((sum, id) => sum + (addons[id]?.price || 0), 0);
  const base = item.options?.product_size ? productSizePrice(product, item.options.product_size) : Number(product.price || 0);
  return (base + extras) * item.quantity;
}
function cartSubtotal() { return cart.reduce((sum, item) => sum + cartPrice(item), 0); }
function cartCount() { return cart.reduce((sum, item) => sum + item.quantity, 0); }
function renderCart() {
  $('#cart-count').textContent = String(cartCount());
  $('#cart-subtotal').textContent = money(cartSubtotal());
  const wrap = $('#cart-items');
  if (!cart.length) {
    wrap.innerHTML = '<p class="empty-state">Your cart is empty. Add something delicious from the menu.</p>';
  } else {
    wrap.innerHTML = cart.map((item, index) => {
      const product = currentProduct(item.product_id);
      if (!product) return '';
      const extras = (item.addons || []).map(id => addons[id]?.name).filter(Boolean).join(', ');
      const optionText = ['soft-drink', 'burger-combo'].includes(product.id) ? `${item.options?.drink_brand || 'Sprite'} · ${allDrinkSizes().find(value => value.id === item.options?.drink_size)?.label || 'Medium (330 ml)'}` : '';
      const selectedSize = item.options?.product_size ? localProductSizes(product).find(size => size.id === item.options.product_size) : null;
      const foodSizeText = selectedSize ? `${selectedSize.label}${selectedSize.capacity_ml ? ` (${selectedSize.capacity_ml} ml)` : ''}` : '';
      const promoText = String(product.name).includes('B1T1') ? 'Includes two sandwiches' : '';
      const details = [extras, optionText, foodSizeText, promoText].filter(Boolean).join(' · ');
      return `<article class="cart-line"><img src="${escapeHtml(product.image)}" alt="" width="65" height="65" loading="lazy" onerror="this.onerror=null;this.src='static/food-fallback.svg'"><div><h3>${escapeHtml(cartItemDisplayName(product, item))}</h3><p>${details ? escapeHtml(details) : 'No extras'}</p><strong>${money(cartPrice(item))}</strong><div class="cart-controls"><button type="button" data-action="quantity-down" data-index="${index}" aria-label="Decrease ${escapeHtml(product.name)} quantity">−</button><span>${item.quantity}</span><button type="button" data-action="quantity-up" data-index="${index}" aria-label="Increase ${escapeHtml(product.name)} quantity">+</button><button type="button" class="remove-line" data-action="remove-cart-item" data-index="${index}" aria-label="Remove ${escapeHtml(product.name)}">Remove</button></div></div></article>`;
    }).join('');
  }
  const proceed = $('#proceed-checkout');
  if (proceed) proceed.disabled = cart.length === 0;
  updateCheckoutSummary();
}
function openCart() {
  $('#overlay').hidden = false;
  $('#cart-drawer').classList.add('open');
  $('#cart-drawer').setAttribute('aria-hidden', 'false');
  document.body.classList.add('locked');
}
function closeCart() {
  $('#cart-drawer').classList.remove('open');
  $('#cart-drawer').setAttribute('aria-hidden', 'true');
  if ($$('.modal:not([hidden])').length === 0) { $('#overlay').hidden = true; document.body.classList.remove('locked'); }
}
function openModal(id) {
  $(id).hidden = false;
  document.body.classList.add('locked');
  const focusable = $('input,button,select,textarea', $(id));
  if (focusable) setTimeout(() => focusable.focus(), 30);
}
function closeModal(id) {
  $(id).hidden = true;
  if ($$('.modal:not([hidden])').length === 0 && !$('#cart-drawer').classList.contains('open')) { $('#overlay').hidden = true; document.body.classList.remove('locked'); }
}
function openCustomize(productId) {
  const product = currentProduct(productId);
  if (!product) return;
  pendingProductId = productId;
  if (['soft-drink', 'burger-combo'].includes(product.id)) {
    const isCombo = product.id === 'burger-combo';
    const brandOptions = allDrinkBrands().map(brand => `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`).join('');
    const sizeOptions = allDrinkSizes().map(size => `<option value="${escapeHtml(size.id)}" ${size.id === 'regular' ? 'selected' : ''}>${escapeHtml(size.label)} — ${money(size.price)}</option>`).join('');
    const currentProductPrice = isCombo ? Number(product.price) : 0;
    const regularPrice = Number(allDrinkSizes().find(size => size.id === 'regular')?.price ?? 35);
    const initialPrice = isCombo ? currentProductPrice : drinkPrice({drink_size:'regular'});
    $('#customize-content').innerHTML = `<p>${escapeHtml(product.description)}</p><form id="customize-form" class="claim-form drink-customize-form"><label for="custom-drink-brand">Soft drink brand</label><select id="custom-drink-brand" required>${brandOptions}</select><label for="custom-drink-size">Size</label><select id="custom-drink-size" required>${sizeOptions}</select><label for="custom-quantity">Quantity</label><input id="custom-quantity" type="number" min="1" max="20" value="1" required><div id="custom-drink-price" class="detail-box"><span>Total for selected quantity</span><strong>${money(initialPrice)}</strong></div><div id="customize-error" class="form-message"></div><button class="button full" type="submit">Add to Cart</button></form>`;
    const updateDrinkCustomizePrice = () => { const sizePrice = drinkPrice({ drink_size: $('#custom-drink-size').value }); const unitPrice = isCombo ? Math.max(0, currentProductPrice + sizePrice - regularPrice) : sizePrice; const quantity = Math.max(1, Math.min(20, Number.parseInt($('#custom-quantity').value, 10) || 1)); $('#custom-drink-price strong').textContent = money(unitPrice * quantity); };
    $('#custom-drink-size').addEventListener('change', updateDrinkCustomizePrice);
    $('#custom-quantity').addEventListener('input', updateDrinkCustomizePrice);
  } else {
    const sizes = localProductSizes(product);
    const sizeOptions = sizes.map(size => `<option value="${escapeHtml(size.id)}" ${size.id === 'medium' ? 'selected' : ''}>${escapeHtml(size.label)}${size.capacity_ml ? ` (${size.capacity_ml} ml)` : ''} — ${money(size.price)}</option>`).join('');
    const canSize = sizes.length > 0;
    const isPromo = ['beef-burger-b1t1', 'cheeseburger-b1t1', 'cheesy-hotdog-b1t1'].includes(product.id);
    $('#customize-content').innerHTML = `<p>${escapeHtml(product.description)}</p>${isPromo ? '<div class="promotion-note">Buy 1 Take 1 pricing includes two sandwiches per order unit.</div>' : ''}<div class="detail-box"><span>Base price</span><strong>${money(product.price)}</strong></div><form id="customize-form" class="claim-form product-customize-form">
      ${canSize ? `<label for="custom-size">Size</label><select id="custom-size" required>${sizeOptions}</select>` : ''}
      <div class="product-checks"><label><input type="checkbox" name="addon" value="extra-cheese"> Extra cheese (+${money(addons['extra-cheese']?.price || 20)})</label><label><input type="checkbox" name="addon" value="bacon"> Bacon (+${money(addons.bacon?.price || 30)})</label></div>
      <label for="custom-quantity">Quantity</label><input id="custom-quantity" type="number" min="1" max="20" value="1" required>
      <div id="custom-food-price" class="detail-box"><span>Total for selected quantity</span><strong>${money(canSize ? productSizePrice(product, 'medium') : product.price)}</strong></div>
      <div id="customize-error" class="form-message"></div><button class="button full" type="submit">Add to Order</button></form>`;
    const updateFoodPrice = () => {
      const sizeId = $('#custom-size')?.value || '';
      const base = canSize ? productSizePrice(product, sizeId) : Number(product.price || 0);
      const addonTotal = $$('input[name="addon"]:checked', $('#customize-form')).reduce((sum, input) => sum + Number(addons[input.value]?.price || 0), 0);
      const quantity = Math.max(1, Math.min(20, Number.parseInt($('#custom-quantity').value, 10) || 1));
      $('#custom-food-price strong').textContent = money((base + addonTotal) * quantity);
    };
    $('#custom-size')?.addEventListener('change', updateFoodPrice);
    $$('input[name="addon"]', $('#customize-form')).forEach(input => input.addEventListener('change', updateFoodPrice));
    $('#custom-quantity').addEventListener('input', updateFoodPrice);
  }
  openModal('#customize-modal');
}
function addCustomizedItem(event) {
  event.preventDefault();
  if (!pendingProductId) return;
  const quantity = Math.max(1, Math.min(20, parseInt($('#custom-quantity').value, 10) || 1));
  const selectedAddons = $$('input[name="addon"]:checked', $('#customize-form')).map(el => el.value);
  const selectedProduct = currentProduct(pendingProductId);
  const options = ['soft-drink', 'burger-combo'].includes(pendingProductId) ? { drink_brand: $('#custom-drink-brand').value, drink_size: $('#custom-drink-size').value } : (localProductSizes(selectedProduct).length ? { product_size: $('#custom-size')?.value || 'medium' } : {});
  const item = { product_id: pendingProductId, quantity, addons: selectedAddons, options };
  const key = cartKey(item);
  const existing = cart.find(value => cartKey(value) === key);
  if (existing) existing.quantity = Math.min(20, existing.quantity + quantity);
  else cart.push(item);
  if (cart.length > 30) { cart.pop(); $('#customize-error').textContent = 'The cart supports up to 30 unique items.'; return; }
  saveCart();
  closeModal('#customize-modal');
  toast('Added to your cart.', 'success');
  pendingProductId = null;
}
function updateQuantity(index, delta) {
  const item = cart[index];
  if (!item) return;
  item.quantity = Math.max(0, Math.min(20, item.quantity + delta));
  if (item.quantity === 0) cart.splice(index, 1);
  saveCart();
}
function updateCheckoutSummary() {
  if (!$('#checkout-subtotal')) return;
  const subtotal = cartSubtotal();
  const delivery = $('#fulfillment')?.value === 'delivery' ? Number(config?.delivery_fee ?? 30) : 0;
  $('#checkout-subtotal').textContent = money(subtotal);
  $('#checkout-delivery').textContent = money(delivery);
  $('#checkout-total').textContent = money(subtotal + delivery);
  const paymentHelp = $('#payment-help');
  const method = $('#payment-method')?.value || 'cash';
  const paymentConfig = config?.payments?.[method] || {};
  if (paymentHelp) {
    const amountDue = money(subtotal + delivery);
    if (method === 'cash') {
      const when = $('#fulfillment')?.value === 'pickup' ? 'when your order is picked up' : 'when your order is delivered';
      paymentHelp.textContent = `Amount due: ${amountDue}. Pay in cash ${when}. Payment stays Unpaid until authorized staff confirm receiving the cash.`;
    } else if (!paymentConfig.configured) {
      paymentHelp.textContent = `${method.toUpperCase()} is unavailable until Burger Haven configures its official business account. Choose Cash for now.`;
    } else {
      const qrPath = typeof paymentConfig.qr_image === 'string' && paymentConfig.qr_image.startsWith('/static/') ? paymentConfig.qr_image : '';
      const qr = qrPath ? `<img class="payment-qr checkout-payment-qr" src="${escapeHtml(qrPath)}" alt="${escapeHtml(method.toUpperCase())} QR code" loading="lazy">` : '';
      paymentHelp.innerHTML = `<strong>Amount due: ${amountDue}</strong><br>Send the exact amount to the official Burger Haven ${escapeHtml(method.toUpperCase())} account.<br>Account name: <strong>${escapeHtml(paymentConfig.account_name || '')}</strong><br>Mobile number: <strong>${escapeHtml(paymentConfig.number || '')}</strong><br>Submit your transaction reference and optional receipt screenshot. Staff must verify the actual incoming transfer before it can be marked Paid.${qr}`;
    }
  }
  if ($('#address-field') && $('#fulfillment')) {
    const needsAddress = $('#fulfillment').value === 'delivery';
    $('#address-field').hidden = !needsAddress;
    $('#address').required = needsAddress;
  }
}
function openCheckout() {
  if (!cart.length) { toast('Add an item to your cart first.', 'error'); return; }
  closeCart();
  $('#checkout-error').hidden = true;
  $('#checkout-error').textContent = '';
  updateCheckoutSummary();
  if (authUser) { $('#customer-name').value = authUser.full_name || ''; $('#customer-phone').value = authUser.phone || ''; }
  $('#checkout-modal').hidden = false;
  openModal('#checkout-modal');
}
function createLocalToken(bytes = 24) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, value => value.toString(16).padStart(2, '0')).join('');
}
function getLastOrder() {
  try { return JSON.parse(localStorage.getItem(STORE_LAST_ORDER) || 'null'); } catch { return null; }
}
function saveOrderAccess(publicId, token) {
  const value = { public_id: publicId, access_token: token };
  try {
    localStorage.setItem(STORE_LAST_ORDER, JSON.stringify(value));
    localStorage.setItem(`burgerHavenOrder:${publicId}`, token);
  } catch { /* User can copy the code from the confirmation page. */ }
  $('#track-order-id').value = publicId;
  $('#track-token').value = token;
}
async function placeOrder(event) {
  event.preventDefault();
  if (requestInProgress) return;
  if (!cart.length) { $('#checkout-error').textContent = 'Your cart is empty.'; $('#checkout-error').hidden = false; return; }
  if (previewMode) {
    $('#checkout-error').textContent = 'Design preview only: no order was placed. Start the FastAPI app using the README instructions to enable real checkout and manual payment verification.';
    $('#checkout-error').hidden = false;
    return;
  }
  const method = $('#payment-method').value;
  if (method !== 'cash' && !config?.payments?.[method]?.configured) {
    $('#checkout-error').textContent = `The ${method.toUpperCase()} business account has not been configured. Please choose Cash or contact the restaurant.`;
    $('#checkout-error').hidden = false; return;
  }
  const form = $('#checkout-form');
  if (!form.reportValidity()) return;
  requestInProgress = true;
  const button = $('#place-order');
  const originalText = button.textContent;
  button.disabled = true; button.textContent = 'Placing order…';
  $('#checkout-error').hidden = true;
  // Reuse the same idempotency key and access token for safe retries if a response is lost.
  let attempt;
  try { attempt = JSON.parse(sessionStorage.getItem('burgerHavenCheckoutAttempt') || 'null'); } catch { attempt = null; }
  if (!attempt) {
    attempt = { idempotency_key: createLocalToken(20), access_token: createLocalToken(32) };
    try { sessionStorage.setItem('burgerHavenCheckoutAttempt', JSON.stringify(attempt)); } catch { /* Current attempt still works. */ }
  }
  const payload = {
    ...attempt,
    customer_name: $('#customer-name').value.trim(),
    phone: $('#customer-phone').value.trim(),
    fulfillment_type: $('#fulfillment').value,
    address: $('#address').value.trim(),
    notes: $('#order-notes').value.trim(),
    payment_method: method,
    items: cart.map(item => ({ product_id: item.product_id, quantity: item.quantity, addons: item.addons || [], options: item.options || {} }))
  };
  try {
    const response = await api('/api/orders', { method: 'POST', headers: authToken ? { 'X-Customer-Token': authToken } : {}, body: JSON.stringify(payload) });
    const token = response.access_token || attempt.access_token;
    const order = response.order;
    saveOrderAccess(order.public_id, token);
    activeOrder = order; activeOrderToken = token;
    cart = []; saveCart();
    try { sessionStorage.removeItem('burgerHavenCheckoutAttempt'); } catch { /* Ignore unavailable storage. */ }
    form.reset(); $('#fulfillment').value = 'delivery'; $('#payment-method').value = 'cash'; syncPaymentOptions(); updateCheckoutSummary();
    closeModal('#checkout-modal');
    renderOrder(order, token, config?.payments?.[order.payment_method] || {});
    toast('Order created successfully.', 'success');
  } catch (error) {
    $('#checkout-error').textContent = error.message;
    $('#checkout-error').hidden = false;
  } finally {
    requestInProgress = false; button.disabled = false; button.textContent = originalText;
  }
}
function paymentStatusClass(status) {
  if (status === 'Paid') return 'paid';
  if (status === 'Awaiting Verification' || status === 'Unpaid') return 'pending';
  if (status === 'Rejected' || status === 'Failed') return 'rejected';
  return '';
}
function paymentInstructions(method, instructions, order) {
  if (method === 'cash') {
    const where = order.fulfillment_type === 'delivery' ? 'when your order is delivered' : 'when you pick up your order';
    return `<div class="payment-info"><h3>Cash payment</h3><p>Please prepare <strong>${money(order.total)}</strong> ${where}. Staff will mark the payment as paid only after collecting the cash.</p></div>`;
  }
  if (!instructions?.configured) return `<div class="warning-box">${escapeHtml(method.toUpperCase())} is not configured for this business yet. Do not send money until official account details are shown.</div>`;
  const safeQr = instructions.qr_image && instructions.qr_image.startsWith('/static/') ? `<img class="payment-qr" src="${escapeHtml(instructions.qr_image)}" alt="${escapeHtml(method.toUpperCase())} payment QR code" loading="lazy">` : '';
  const methodName = method.toUpperCase();
  return `<div class="payment-info"><h3>Pay with ${methodName}</h3><p>Open your own ${methodName} app and transfer the exact amount below. These are manual transfers; no payment gateway is connected.</p><p>Business account: <strong>${escapeHtml(instructions.account_name)}</strong></p><p>Account/mobile number: <span class="payment-number">${escapeHtml(instructions.number)}</span> <button type="button" class="copy-btn" data-action="copy" data-copy="${escapeHtml(instructions.number)}">Copy</button></p><p>Order reference: <strong>${escapeHtml(order.public_id)}</strong></p><p>Amount to send: <span class="payment-number">${money(order.total)}</span></p>${safeQr}<p class="subtle">After sending, submit the transaction reference below. Staff must verify the actual incoming transfer before payment is marked Paid.</p><form class="claim-form" id="payment-claim-form" enctype="multipart/form-data"><label for="transaction-reference">Transaction reference *</label><input id="transaction-reference" name="transaction_reference" required minlength="4" maxlength="120" placeholder="Enter the receipt reference"><label for="receipt-file">Receipt screenshot (optional, JPG/PNG/WEBP, max 5 MB)</label><input id="receipt-file" name="receipt" type="file" accept="image/jpeg,image/png,image/webp"><div id="claim-message" class="form-message" role="status"></div><button class="button full" type="submit">Submit for Manual Verification</button></form></div>`;
}
function renderOrder(order, token, instructions = {}) {
  activeOrder = order; activeOrderToken = token;
  const itemsHtml = (order.items || []).map(item => `<li><span>${escapeHtml(item.product_name)} × ${item.quantity}${item.addons?.length ? `<br><small>${escapeHtml(item.addons.map(a => a.name).join(', '))}</small>` : ''}${item.options?.product_size ? `<br><small>Size: ${escapeHtml(item.options.product_size.toUpperCase())}</small>` : ''}</span><strong>${money(item.line_total)}</strong></li>`).join('');
  const timelineHtml = (order.events || []).slice(-5).map(event => `<div class="timeline-item"><strong>${escapeHtml(event.event_type)}</strong><span>${escapeHtml(new Date(event.created_at).toLocaleString())}${event.details ? ' · ' + escapeHtml(event.details) : ''}</span></div>`).join('');
  const statusMessage = order.order_status === 'Cancelled' ? 'This order is cancelled. Contact Burger Haven if a payment was already sent or collected.' : order.payment_status === 'Paid' ? 'Payment confirmed.' : order.payment_status === 'Awaiting Verification' ? 'Your transfer claim is waiting for staff verification. Do not send the payment again unless staff ask you to.' : order.payment_status === 'Rejected' ? `The payment claim was rejected: ${escapeHtml(order.payment_decision_reason || 'Please contact the restaurant or submit corrected evidence.')}` : order.payment_status === 'Unpaid' && order.payment_method !== 'cash' ? 'Complete the transfer and submit the transaction reference for staff verification.' : 'Payment is not yet marked as collected.';
  const instructionsHtml = order.order_status === 'Cancelled' ? '<div class="warning-box">This order is cancelled. Do not send payment. If you already transferred or paid, contact Burger Haven directly.</div>' : order.payment_status === 'Paid' ? '<div class="success-box">Payment has been marked paid by authorized staff.</div>' : order.payment_status === 'Awaiting Verification' ? '<div class="warning-box">Payment claim received. Staff must verify your transfer in the official business account before it can be marked Paid.</div>' + (order.payment_method !== 'cash' ? paymentInstructions(order.payment_method, instructions, order) : '') : paymentInstructions(order.payment_method, instructions, order);
  $('#order-details').innerHTML = `<div class="success-box"><strong>Order created.</strong> Keep the order number and private access code below to track your order.</div><div class="order-detail-grid"><div class="detail-box"><span>Order number</span><strong class="order-id">${escapeHtml(order.public_id)}</strong><button class="copy-btn" data-action="copy" data-copy="${escapeHtml(order.public_id)}">Copy</button></div><div class="detail-box"><span>Private access code</span><strong class="order-id">${escapeHtml(token)}</strong><button class="copy-btn" data-action="copy" data-copy="${escapeHtml(token)}">Copy access code</button></div><div class="detail-box"><span>Order status</span><strong>${escapeHtml(order.order_status)}</strong></div><div class="detail-box"><span>Payment status</span><strong><span class="status-pill ${paymentStatusClass(order.payment_status)}">${escapeHtml(order.payment_status)}</span></strong></div></div><h3>Order summary</h3><ul class="order-list">${itemsHtml}<li><span>Subtotal</span><strong>${money(order.subtotal)}</strong></li><li><span>Delivery fee</span><strong>${money(order.delivery_fee)}</strong></li><li><span><strong>Total</strong></span><strong>${money(order.total)}</strong></li></ul><p class="subtle">${escapeHtml(order.fulfillment_type === 'delivery' ? 'Delivery address: ' + order.address : 'Pickup order')}${order.notes ? '<br>Note: ' + escapeHtml(order.notes) : ''}</p><p class="order-status-line"><span class="status-pill">${escapeHtml(order.order_status)}</span><span>${escapeHtml(statusMessage)}</span></p>${instructionsHtml}${timelineHtml ? `<h3>Recent updates</h3><div class="timeline">${timelineHtml}</div>` : ''}<div class="modal-actions"><button type="button" class="button button-outline" data-action="close-order">Close</button><button type="button" class="button" data-action="refresh-order">Refresh Status</button></div>`;
  openModal('#order-modal');
}
async function refreshActiveOrder() {
  if (!activeOrder || !activeOrderToken) return;
  try {
    const result = await api(`/api/orders/${encodeURIComponent(activeOrder.public_id)}`, { headers: { 'X-Order-Token': activeOrderToken } });
    activeOrder = result.order;
    renderOrder(result.order, activeOrderToken, result.payment_instructions);
  } catch (error) { toast(error.message, 'error'); }
}
async function trackOrder(event) {
  event.preventDefault();
  if (previewMode) { $('#track-message').textContent = 'Order tracking requires the FastAPI server. This is only a design preview.'; return; }
  const id = $('#track-order-id').value.trim().toUpperCase();
  const token = $('#track-token').value.trim();
  $('#track-message').textContent = 'Looking up your order…';
  try {
    const response = await api(`/api/orders/${encodeURIComponent(id)}`, { headers: { 'X-Order-Token': token } });
    activeOrder = response.order; activeOrderToken = token;
    saveOrderAccess(id, token);
    $('#track-message').textContent = '';
    renderOrder(response.order, token, response.payment_instructions);
  } catch (error) { $('#track-message').textContent = error.message; }
}
async function submitPaymentClaim(event) {
  if (event.target.id !== 'payment-claim-form') return;
  event.preventDefault();
  if (!activeOrder || !activeOrderToken) return;
  const form = event.target;
  const file = $('#receipt-file').files[0];
  if (file && file.size > 5 * 1024 * 1024) { $('#claim-message').textContent = 'Receipt must be 5 MB or smaller.'; return; }
  const button = $('button[type="submit"]', form);
  if (button.disabled) return;
  button.disabled = true; button.textContent = 'Submitting…';
  const data = new FormData(form);
  try {
    const response = await api(`/api/orders/${encodeURIComponent(activeOrder.public_id)}/payment-claim`, { method: 'POST', headers: { 'X-Order-Token': activeOrderToken }, body: data });
    activeOrder = response.order;
    toast('Payment claim submitted for manual verification.', 'success');
    await refreshActiveOrder();
  } catch (error) { $('#claim-message').textContent = error.message; }
  finally { if (document.body.contains(button)) { button.disabled = false; button.textContent = 'Submit for Manual Verification'; } }
}
function setAuthMode(mode) {
  authMode = mode === 'register' ? 'register' : 'login';
  const registering = authMode === 'register';
  $('#auth-title').textContent = registering ? 'Create your account' : 'Email';
  $('#auth-step-label').textContent = registering ? 'Join Burger Haven' : 'Your account';
  $('#auth-subtitle').textContent = registering ? 'Create an account to keep track of your orders.' : "We'll check if you already have an account.";
  $('#auth-register-fields').hidden = !registering;
  $('#auth-confirm-wrap').hidden = !registering;
  $('#auth-name').required = registering;
  $('#auth-phone').required = registering;
  $('#auth-confirm-password').required = registering;
  $('#auth-terms').required = registering;
  $('#auth-password').autocomplete = registering ? 'new-password' : 'current-password';
  $('#auth-password').minLength = registering ? 10 : 1;
  $('#auth-submit').textContent = registering ? 'Create Account' : 'Login';
  $('#auth-mode-toggle').textContent = registering ? 'Already have an account? Log in' : 'New to Burger Haven? Create an account';
  $('#auth-feedback').textContent = '';
}
function updateAuthButton() {
  const button = $('#account-button');
  if (!button) return;
  button.textContent = authUser ? `Account · ${(authUser.full_name || 'Customer').split(' ')[0]}` : 'Login / Register';
  button.setAttribute('aria-label', authUser ? `Open account for ${authUser.full_name}` : 'Login or register');
}
function openAuth() {
  $('#auth-feedback').textContent = '';
  if (authUser) {
    $('#auth-form').hidden = true;
    $('#auth-mode-toggle').hidden = true;
    $('.auth-guest')?.setAttribute('hidden', '');
    $('#auth-account-panel').hidden = false;
    $('#auth-title').textContent = 'My Account';
    $('#auth-step-label').textContent = 'Welcome back';
    $('#auth-subtitle').textContent = 'Manage your account and view your recent orders.';
    $('#auth-user-summary').innerHTML = `<strong>${escapeHtml(authUser.full_name)}</strong><span>${escapeHtml(authUser.email)}</span><span>${escapeHtml(authUser.phone || '')}</span>`;
  } else {
    $('#auth-form').hidden = false;
    $('#auth-mode-toggle').hidden = false;
    $('.auth-guest')?.removeAttribute('hidden');
    $('#auth-account-panel').hidden = true;
    setAuthMode('login');
  }
  openModal('#auth-modal');
  if (authUser) void loadCustomerOrders();
}
async function restoreCustomerSession() {
  if (!authToken) { updateAuthButton(); return; }
  try {
    const result = await api('/api/auth/me', { headers: { 'X-Customer-Token': authToken } });
    authUser = result.user;
    localStorage.setItem(STORE_AUTH_USER, JSON.stringify(authUser));
  } catch {
    authToken = ''; authUser = null;
    try { localStorage.removeItem(STORE_AUTH_TOKEN); localStorage.removeItem(STORE_AUTH_USER); } catch { /* storage may be disabled */ }
  }
  updateAuthButton();
}
async function submitAuthForm(event) {
  event.preventDefault();
  const form = $('#auth-form');
  if (!form.reportValidity()) return;
  if (authMode === 'register' && $('#auth-password').value !== $('#auth-confirm-password').value) {
    $('#auth-feedback').textContent = 'Passwords do not match.';
    $('#auth-feedback').classList.add('error-text');
    $('#auth-confirm-password').focus();
    return;
  }
  const button = $('#auth-submit');
  const original = button.textContent;
  button.disabled = true; button.textContent = authMode === 'register' ? 'Creating account…' : 'Logging in…';
  $('#auth-feedback').textContent = '';
  try {
    const email = $('#auth-email').value.trim().toLowerCase();
    const payload = authMode === 'register'
      ? { full_name: $('#auth-name').value.trim(), email, phone: $('#auth-phone').value.trim(), password: $('#auth-password').value, confirm_password: $('#auth-confirm-password').value, accept_terms: $('#auth-terms').checked }
      : { email, password: $('#auth-password').value };
    const result = await api(authMode === 'register' ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    authToken = result.token; authUser = result.user;
    localStorage.setItem(STORE_AUTH_TOKEN, authToken);
    localStorage.setItem(STORE_AUTH_USER, JSON.stringify(authUser));
    updateAuthButton();
    toast(authMode === 'register' ? 'Account created successfully.' : 'Welcome back.', 'success');
    closeModal('#auth-modal');
    if ($('#customer-name') && !$('#customer-name').value.trim()) $('#customer-name').value = authUser.full_name || '';
    if ($('#customer-phone') && !$('#customer-phone').value.trim()) $('#customer-phone').value = authUser.phone || '';
  } catch (error) {
    $('#auth-feedback').textContent = error.message;
    $('#auth-feedback').classList.add('error-text');
  } finally {
    button.disabled = false; button.textContent = original;
  }
}
async function logoutCustomer() {
  try { if (authToken) await api('/api/auth/logout', { method: 'POST', headers: { 'X-Customer-Token': authToken } }); } catch { /* Clear local session even if network is unavailable. */ }
  authToken = ''; authUser = null;
  try { localStorage.removeItem(STORE_AUTH_TOKEN); localStorage.removeItem(STORE_AUTH_USER); } catch { /* storage may be disabled */ }
  updateAuthButton(); closeModal('#auth-modal'); toast('You have been logged out.', 'success');
}
async function loadCustomerOrders() {
  const container = $('#auth-order-history');
  if (!authToken || !container || customerOrdersLoading) return;
  customerOrdersLoading = true;
  const refreshButton = $('#load-my-orders');
  if (refreshButton) { refreshButton.disabled = true; refreshButton.textContent = 'Loading Orders…'; }
  container.innerHTML = '<p class="small-note">Loading your orders…</p>';
  try {
    const result = await api('/api/auth/orders', { headers: { 'X-Customer-Token': authToken } });
    customerOrders = Array.isArray(result.orders) ? result.orders : [];
    editingOrderId = '';
    orderEditItems = [];
    renderCustomerOrderHistory();
  } catch (error) {
    container.innerHTML = `<p class="form-message error-text">${escapeHtml(error.message)}</p>`;
  } finally {
    customerOrdersLoading = false;
    if (refreshButton) { refreshButton.disabled = false; refreshButton.textContent = 'Refresh My Orders'; }
  }
}
function renderCustomerOrderHistory() {
  const container = $('#auth-order-history');
  if (!container) return;
  if (!customerOrders.length) {
    container.innerHTML = '<p class="small-note">No account orders yet. Place an order while signed in and it will appear here.</p>';
    return;
  }
  container.innerHTML = customerOrders.map(order => {
    const card = `<article class="auth-order-card" data-order-card="${escapeHtml(order.public_id)}"><div><strong>${escapeHtml(order.public_id)}</strong><span>${escapeHtml(new Date(order.created_at).toLocaleDateString())}</span></div><p>${escapeHtml(order.order_status)} · ${escapeHtml(order.payment_status)}</p><strong>${money(order.total)}</strong><div class="customer-order-actions">${order.can_edit ? `<button type="button" class="button button-small" data-action="edit-order" data-id="${escapeHtml(order.public_id)}">Edit Order</button>` : `<p class="order-edit-unavailable">${escapeHtml(order.edit_reason || 'This order can no longer be edited.')}</p>`}</div></article>`;
    return card + (editingOrderId === order.public_id ? renderOrderEditPanel(order) : '');
  }).join('');
}
function defaultOrderEditItem(productId) {
  const product = currentProduct(productId) || products.find(item => item.available !== false);
  if (!product) return null;
  let options = {};
  if (['soft-drink', 'burger-combo'].includes(product.id)) {
    options = { drink_brand: allDrinkBrands()[0] || 'Sprite', drink_size: allDrinkSizes().some(size => size.id === 'regular') ? 'regular' : (allDrinkSizes()[0]?.id || 'small') };
  } else if (localProductSizes(product).some(size => size.id === 'medium')) {
    options = { product_size: 'medium' };
  }
  return { product_id: product.id, quantity: 1, addons: [], options };
}
function beginOrderEdit(publicId) {
  const order = customerOrders.find(item => item.public_id === publicId);
  if (!order || !order.can_edit) { toast(order?.edit_reason || 'This order cannot be edited.', 'error'); return; }
  editingOrderId = publicId;
  orderEditItems = (order.items || []).map(item => {
    const options = item.options && typeof item.options === 'object' ? { ...item.options } : {};
    // Older orders may not have stored variant options; supply a safe selectable default
    // for drink items so they can still be edited without a client-side crash.
    if (['soft-drink', 'burger-combo'].includes(item.product_id)) {
      if (!options.drink_brand) options.drink_brand = allDrinkBrands()[0] || 'Sprite';
      if (!options.drink_size) options.drink_size = allDrinkSizes().some(size => size.id === 'regular') ? 'regular' : (allDrinkSizes()[0]?.id || 'small');
    }
    return {
      product_id: item.product_id,
      quantity: Number(item.quantity) || 1,
      addons: Array.isArray(item.addons) ? item.addons.map(addon => typeof addon === 'string' ? addon : addon.id).filter(Boolean) : [],
      options
    };
  });
  renderCustomerOrderHistory();
}
function orderEditUnitPrice(item) {
  const product = currentProduct(item.product_id);
  if (!product || product.available === false) return 0;
  let unit = Number(product.price || 0);
  if (product.id === 'soft-drink') {
    unit = Number(allDrinkSizes().find(size => size.id === item.options?.drink_size)?.price ?? product.price);
  } else if (product.id === 'burger-combo') {
    const regular = Number(allDrinkSizes().find(size => size.id === 'regular')?.price ?? 35);
    unit = Math.max(0, Number(product.price) + Number(allDrinkSizes().find(size => size.id === item.options?.drink_size)?.price ?? regular) - regular);
  } else if (item.options?.product_size) {
    unit = productSizePrice(product, item.options.product_size);
  }
  if (!['soft-drink', 'burger-combo'].includes(product.id)) {
    unit += (item.addons || []).reduce((sum, id) => sum + Number(addons[id]?.price || 0), 0);
  }
  return unit;
}
function orderEditLineTotal(item) {
  return orderEditUnitPrice(item) * Math.max(1, Number(item.quantity) || 1);
}
function orderEditSubtotal() {
  return orderEditItems.reduce((total, item) => total + orderEditLineTotal(item), 0);
}
function updateOrderEditLiveTotals(index, rawQuantity) {
  if (!Number.isInteger(index) || !orderEditItems[index]) return;
  const quantity = Number.parseInt(rawQuantity, 10);
  const normalized = Number.isInteger(quantity) && quantity >= 1 && quantity <= 20 ? quantity : 1;
  orderEditItems[index].quantity = normalized;
  const line = $(`[data-edit-line="${index}"]`);
  const lineTotal = line?.querySelector('.order-edit-line-total strong');
  if (lineTotal) lineTotal.textContent = money(orderEditLineTotal(orderEditItems[index]));
  const subtotal = orderEditSubtotal();
  const delivery = Number(customerOrders.find(order => order.public_id === editingOrderId)?.delivery_fee || 0);
  const subtotalElement = $('#order-edit-subtotal');
  const deliveryElement = $('#order-edit-delivery');
  const totalElement = $('#order-edit-grand-total');
  if (subtotalElement) subtotalElement.textContent = money(subtotal);
  if (deliveryElement) deliveryElement.textContent = money(delivery);
  if (totalElement) totalElement.textContent = money(subtotal + delivery);
}
function renderOrderEditPanel(order) {
  const productOptionsFor = selectedId => products.filter(product => product.available !== false).map(product => `<option value="${escapeHtml(product.id)}" ${product.id === selectedId ? 'selected' : ''}>${escapeHtml(product.name)}</option>`).join('');
  const lines = orderEditItems.map((item, index) => {
    const foundProduct = currentProduct(item.product_id);
    const product = foundProduct && foundProduct.available !== false ? foundProduct : null;
    const previousOrderItem = (order.items || []).find(previous => previous.product_id === item.product_id);
    const productOptionList = !product
      ? `<option value="${escapeHtml(item.product_id)}" selected disabled>${escapeHtml(previousOrderItem?.product_name || item.product_id)} (unavailable — replace or remove)</option>${productOptionsFor('')}`
      : productOptionsFor(item.product_id);
    const isDrink = ['soft-drink', 'burger-combo'].includes(item.product_id);
    const sizes = product ? localProductSizes(product) : [];
    const addonControls = !isDrink ? `<fieldset class="order-edit-addons"><legend>Add-ons</legend>${Object.entries(addons).map(([id, addon]) => `<label><input type="checkbox" data-edit-addon="${escapeHtml(id)}" data-index="${index}" ${(item.addons || []).includes(id) ? 'checked' : ''}> ${escapeHtml(addon.name)} (+${money(addon.price)})</label>`).join('')}</fieldset>` : '';
    const optionControls = isDrink
      ? `<div class="order-edit-options"><label>Soft drink brand<select data-edit-option="drink_brand" data-index="${index}">${allDrinkBrands().map(brand => `<option value="${escapeHtml(brand)}" ${brand === (item.options?.drink_brand || 'Sprite') ? 'selected' : ''}>${escapeHtml(brand)}</option>`).join('')}</select></label><label>Drink size<select data-edit-option="drink_size" data-index="${index}">${allDrinkSizes().map(size => `<option value="${escapeHtml(size.id)}" ${size.id === (item.options?.drink_size || 'regular') ? 'selected' : ''}>${escapeHtml(size.label)} — ${money(size.price)}</option>`).join('')}</select></label></div>`
      : sizes.length ? `<label class="order-edit-size">Product size<select data-edit-option="product_size" data-index="${index}"><option value="">Standard / listed price</option>${sizes.map(size => `<option value="${escapeHtml(size.id)}" ${size.id === (item.options?.product_size || '') ? 'selected' : ''}>${escapeHtml(size.label)} — ${money(size.price)}</option>`).join('')}</select></label>` : '';
    const preview = product ? money(orderEditLineTotal(item)) : 'Replace or remove this unavailable item';
    return `<article class="order-edit-line" data-edit-line="${index}"><div class="order-edit-line-head"><label>Menu item<select data-edit-product data-index="${index}">${productOptionList}</select></label><label>Qty<input type="number" min="1" max="20" step="1" value="${Math.min(20, Math.max(1, Number(item.quantity) || 1))}" data-edit-quantity data-index="${index}" required></label><button type="button" class="button button-outline button-small" data-action="edit-remove-item" data-index="${index}" aria-label="Remove item ${index + 1}">Remove</button></div>${optionControls}${addonControls}<p class="order-edit-line-total">Estimated line total: <strong>${preview}</strong></p></article>`;
  }).join('');
  const subtotal = orderEditSubtotal();
  const delivery = Number(order.delivery_fee || 0);
  return `<section class="order-edit-panel" aria-label="Edit order ${escapeHtml(order.public_id)}"><div class="order-edit-heading"><div><h4>Edit ${escapeHtml(order.public_id)}</h4><p>Prices are checked again by Burger Haven before saving.</p></div></div><form id="order-edit-form" data-order-id="${escapeHtml(order.public_id)}"><div class="order-edit-lines">${lines}</div><button type="button" class="button button-outline full" data-action="edit-add-item" ${orderEditItems.length >= 30 ? 'disabled' : ''}>+ Add Another Item</button><div class="order-edit-summary"><p><span>Items subtotal</span><strong id="order-edit-subtotal">${money(subtotal)}</strong></p><p><span>Delivery fee</span><strong id="order-edit-delivery">${money(delivery)}</strong></p><p class="order-edit-grand-total"><span>Grand total</span><strong id="order-edit-grand-total">${money(subtotal + delivery)}</strong></p></div><p class="small-note">Final totals are recalculated securely by the server. Payment details and payment status are not changed by editing.</p><p class="form-message order-edit-message" id="order-edit-message" role="status"></p><div class="modal-actions"><button type="button" class="button button-outline" data-action="cancel-order-edit">Cancel</button><button type="submit" class="button" id="save-order-edit" ${orderEditSaving ? 'disabled' : ''}>${orderEditSaving ? 'Saving…' : 'Save Changes'}</button></div></form></section>`;
}
function handleOrderEditChange(target) {
  const index = Number(target.dataset.index);
  if (!Number.isInteger(index) || !orderEditItems[index]) return;
  const item = orderEditItems[index];
  if (target.matches('[data-edit-product]')) {
    const quantity = item.quantity;
    const replacement = defaultOrderEditItem(target.value);
    if (replacement) { orderEditItems[index] = replacement; orderEditItems[index].quantity = quantity; }
  } else if (target.matches('[data-edit-quantity]')) {
    const amount = Number.parseInt(target.value, 10);
    item.quantity = Number.isFinite(amount) ? Math.min(20, Math.max(1, amount)) : 1;
  } else if (target.matches('[data-edit-addon]')) {
    const id = target.dataset.editAddon;
    item.addons = target.checked ? [...new Set([...(item.addons || []), id])] : (item.addons || []).filter(value => value !== id);
  } else if (target.matches('[data-edit-option]')) {
    const key = target.dataset.editOption;
    item.options = { ...(item.options || {}), [key]: target.value };
    if (key === 'product_size' && !target.value) delete item.options.product_size;
  }
  renderCustomerOrderHistory();
}
function addOrderEditItem() {
  if (orderEditItems.length >= 30) { toast('An order can contain up to 30 line items.', 'error'); return; }
  const product = products.find(item => item.available !== false);
  const item = product ? defaultOrderEditItem(product.id) : null;
  if (item) { orderEditItems.push(item); renderCustomerOrderHistory(); }
}
async function saveOrderEdits(event) {
  event.preventDefault();
  if (orderEditSaving) return;
  const order = customerOrders.find(item => item.public_id === editingOrderId);
  if (!order || !order.can_edit) { toast(order?.edit_reason || 'This order cannot be edited.', 'error'); return; }
  if (!orderEditItems.length || orderEditItems.length > 30) { $('#order-edit-message').textContent = 'Keep between 1 and 30 order items.'; return; }
  if (orderEditItems.some(item => !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > 20)) { $('#order-edit-message').textContent = 'Each quantity must be a whole number from 1 to 20.'; return; }
  const button = $('#save-order-edit');
  orderEditSaving = true;
  if (button) { button.disabled = true; button.textContent = 'Saving…'; }
  const message = $('#order-edit-message');
  if (message) message.textContent = '';
  try {
    const payload = { expected_updated_at: order.updated_at, items: orderEditItems.map(item => ({ product_id: item.product_id, quantity: Number(item.quantity), addons: item.addons || [], options: item.options || {} })) };
    const result = await api(`/api/auth/orders/${encodeURIComponent(order.public_id)}`, { method: 'PUT', headers: { 'X-Customer-Token': authToken }, body: JSON.stringify(payload) });
    editingOrderId = '';
    orderEditItems = [];
    await loadCustomerOrders();
    toast(result.message || 'Order changes saved.', 'success');
  } catch (error) {
    if ($('#order-edit-message')) $('#order-edit-message').textContent = error.message;
    if (button) { button.disabled = false; button.textContent = 'Save Changes'; }
  } finally { orderEditSaving = false; }
}

async function handleClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'account-open') openAuth();
  else if (action === 'auth-close') closeModal('#auth-modal');
  else if (action === 'auth-back') { if (authMode === 'register') setAuthMode('login'); else closeModal('#auth-modal'); }
  else if (action === 'auth-toggle-mode') setAuthMode(authMode === 'login' ? 'register' : 'login');
  else if (action === 'guest-continue') { closeModal('#auth-modal'); document.querySelector('#menu').scrollIntoView({ behavior: 'smooth', block: 'start' }); toast('You can continue ordering as a guest.', 'success'); }
  else if (action === 'auth-logout') logoutCustomer();
  else if (action === 'load-my-orders') loadCustomerOrders();
  else if (action === 'edit-order') beginOrderEdit(button.dataset.id || '');
  else if (action === 'cancel-order-edit') { editingOrderId = ''; orderEditItems = []; renderCustomerOrderHistory(); }
  else if (action === 'edit-add-item') addOrderEditItem();
  else if (action === 'edit-remove-item') { orderEditItems.splice(Number(button.dataset.index), 1); renderCustomerOrderHistory(); }
  else if (action === 'open-cart') openCart();
  else if (action === 'close-cart') closeCart();
  else if (action === 'open-checkout') openCheckout();
  else if (action === 'close-checkout') closeModal('#checkout-modal');
  else if (action === 'close-order') closeModal('#order-modal');
  else if (action === 'close-customize') closeModal('#customize-modal');
  else if (action === 'customize') openCustomize(button.dataset.id);
  else if (action === 'calc-quantity-up') { $('#calc-quantity').value = String(Math.min(20, (Number.parseInt($('#calc-quantity').value, 10) || 1) + 1)); updateQuickCalculator(); }
  else if (action === 'calc-quantity-down') { $('#calc-quantity').value = String(Math.max(1, (Number.parseInt($('#calc-quantity').value, 10) || 1) - 1)); updateQuickCalculator(); }
  else if (action === 'quantity-up') updateQuantity(Number(button.dataset.index), 1);
  else if (action === 'quantity-down') updateQuantity(Number(button.dataset.index), -1);
  else if (action === 'remove-cart-item') { cart.splice(Number(button.dataset.index), 1); saveCart(); }
  else if (action === 'refresh-order') refreshActiveOrder();
  else if (action === 'copy') {
    try { await navigator.clipboard.writeText(button.dataset.copy || ''); toast('Copied to clipboard.', 'success'); }
    catch { toast('Copy was blocked by the browser. Select and copy the text manually.', 'error'); }
  }
}
function bindEvents() {
  document.addEventListener('click', handleClick);
  $('#category-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    currentCategory = button.dataset.category;
    $$('.category-tab').forEach(tab => tab.classList.toggle('active', tab === button));
    renderProducts();
  });
  let searchTimer;
  $('#product-search').addEventListener('input', event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentSearch = event.target.value; renderProducts(); }, 120);
  });
  $('#menu-toggle').addEventListener('click', () => {
    const nav = $('#nav');
    const open = nav.classList.toggle('open');
    $('#menu-toggle').setAttribute('aria-expanded', String(open));
  });
  $$('#nav a').forEach(link => link.addEventListener('click', () => { $('#nav').classList.remove('open'); $('#menu-toggle').setAttribute('aria-expanded', 'false'); }));
  $('#overlay').addEventListener('click', closeCart);
  $('#checkout-form').addEventListener('submit', placeOrder);
  $('#proceed-checkout').addEventListener('click', event => { event.preventDefault(); openCheckout(); });
  $('#auth-form').addEventListener('submit', submitAuthForm);
  $('#auth-order-history').addEventListener('input', event => { const quantity = event.target.closest('[data-edit-quantity]'); if (quantity) updateOrderEditLiveTotals(Number(quantity.dataset.index), quantity.value); });
  $('#auth-order-history').addEventListener('change', event => { if (event.target.closest('.order-edit-line')) handleOrderEditChange(event.target); });
  $('#auth-order-history').addEventListener('submit', event => { if (event.target.id === 'order-edit-form') saveOrderEdits(event); });
  $('#toggle-auth-password').addEventListener('click', () => { const input = $('#auth-password'); const show = input.type === 'password'; input.type = show ? 'text' : 'password'; $('#toggle-auth-password').textContent = show ? 'Hide' : 'Show'; $('#toggle-auth-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password'); });
  $('#auth-email').addEventListener('input', () => { $('#auth-feedback').textContent = ''; });
  $('#fulfillment').addEventListener('change', updateCheckoutSummary);
  $('#payment-method').addEventListener('change', updateCheckoutSummary);
  $('#track-form').addEventListener('submit', trackOrder);
  document.addEventListener('submit', submitPaymentClaim);
  $('#customize-content').addEventListener('submit', addCustomizedItem);
  $('#calc-burger').addEventListener('change', () => { renderCalculatorOptions(); updateQuickCalculator(); });
  $('#calc-size').addEventListener('change', () => updateQuickCalculator());
  $('#calc-quantity').addEventListener('input', () => updateQuickCalculator());
  $$('[data-calc-addon], [data-calc-product]').forEach(input => input.addEventListener('change', () => {
    if (input.id === 'calc-drink' && $('#calc-drink-options')) $('#calc-drink-options').hidden = !input.checked;
    if (input.id === 'calc-fries' && $('#calc-fries-options')) $('#calc-fries-options').hidden = !input.checked;
    updateQuickCalculator();
  }));
  $('#calc-fries-size')?.addEventListener('change', () => { renderCalculatorOptions(); updateQuickCalculator(); });
  $('#calc-drink-brand')?.addEventListener('change', () => updateQuickCalculator());
  $('#calc-drink-size')?.addEventListener('change', () => updateQuickCalculator());
  $('#add-calculator-to-cart').addEventListener('click', addQuickCalculatorMeal);
  $('#play-promo').addEventListener('click', async () => {
    const video = $('#promo-video');
    const message = $('#promo-video-message');
    const playButton = $('#play-promo');
    playButton.disabled = true;
    const originalLabel = playButton.textContent;
    playButton.textContent = '…';
    try {
      const response = await fetch('static/burger-haven-promo.mp4', { method: 'HEAD', cache: 'no-store' });
      if (!response.ok) throw new Error('The promo video file has not been added yet.');
      video.src = 'static/burger-haven-promo.mp4';
      video.controls = true;
      video.hidden = false;
      $('#promo-overlay').hidden = true;
      await video.play();
      message.textContent = 'Playing Burger Haven promotional video.';
    } catch {
      message.textContent = 'The video section is ready. Add your finished MP4 as static/burger-haven-promo.mp4 to enable playback.';
      toast('Promotional video file not added yet.', 'error');
      playButton.textContent = originalLabel;
    } finally { playButton.disabled = false; }
  });
  const sectionLinks = $$('#nav a[href^="#"]');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      sectionLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`));
    }, { rootMargin: '-24% 0px -60% 0px', threshold: [0, 0.2, 0.5] });
    ['home', 'menu', 'calculator', 'video', 'about'].forEach(id => { const section = document.getElementById(id); if (section) observer.observe(section); });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!$('#auth-modal').hidden) closeModal('#auth-modal');
      else if (!$('#customize-modal').hidden) closeModal('#customize-modal');
      else if (!$('#order-modal').hidden) closeModal('#order-modal');
      else if (!$('#checkout-modal').hidden) closeModal('#checkout-modal');
      else closeCart();
    }
  });
}

document.addEventListener('DOMContentLoaded', init, { once: true });
