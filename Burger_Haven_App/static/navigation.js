(() => {
  'use strict';
  const localFile = window.location.protocol === 'file:';
  const routes = new Map([
    ['/', localFile ? 'index.html' : '/'],
    ['/admin', localFile ? 'admin.html' : '/admin'],
    ['/analytics', localFile ? 'analytics.html' : '/analytics'],
    ['/admin.html', localFile ? 'admin.html' : '/admin'],
    ['/analytics.html', localFile ? 'analytics.html' : '/analytics']
  ]);

  function sanitizeCustomerNavigation() {
    const customerNav = document.querySelector('#nav');
    if (!customerNav) return;
    customerNav.querySelectorAll('a[href]').forEach(link => {
      const label = (link.textContent || '').trim().toLowerCase();
      const rawHref = (link.getAttribute('href') || '').trim().toLowerCase();
      let pathname = rawHref;
      try { pathname = new URL(rawHref, window.location.href).pathname.toLowerCase(); } catch {}
      const staffRoute = ['/admin', '/admin.html', '/analytics', '/analytics.html'].includes(pathname);
      const staffLabel = ['staff dashboard', 'analytics', 'admin analytics', 'admin analytics dashboard'].includes(label);
      if (staffRoute || staffLabel) link.remove();
    });
  }

  document.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (routes.has(href)) link.setAttribute('href', routes.get(href));
  });
  sanitizeCustomerNavigation();
  document.addEventListener('DOMContentLoaded', sanitizeCustomerNavigation, { once: true });
  const customerNav = document.querySelector('#nav');
  if (customerNav && 'MutationObserver' in window) {
    const observer = new MutationObserver(sanitizeCustomerNavigation);
    observer.observe(customerNav, { childList: true, subtree: true });
  }

  if (localFile && document.querySelector('.admin-main') && !document.querySelector('#local-admin-notice')) {
    const banner = document.createElement('div');
    banner.id = 'local-admin-notice';
    banner.className = 'preview-banner';
    banner.innerHTML = document.querySelector('#analytics-dashboard')
      ? '<strong>SERVER REQUIRED</strong><span>Admin analytics requires the FastAPI server and a valid administrator token. Start the server, then open http://127.0.0.1:8000/analytics.</span>'
      : '<strong>SERVER REQUIRED</strong><span>This staff dashboard shell opens locally, but orders and staff actions require the FastAPI server and a valid staff token. Start the server, then open http://127.0.0.1:8000/admin.</span>';
    const header = document.querySelector('.site-header');
    if (header) header.insertAdjacentElement('afterend', banner);
  }
})();
