(() => {
  'use strict';
  // Shared sign-in helper for /admin and /analytics.
  // Two credential kinds are supported, both enforced by the server on every request:
  //   account: a Burger Haven account whose role is staff or admin (X-Customer-Token header)
  //   token:   the shared STAFF_TOKEN / ADMIN_TOKEN from .env (X-Admin-Token header, unchanged)
  // The credential lives in this browser tab's sessionStorage only. Hiding a page is never the
  // security boundary; the backend rejects customer sessions and tokens that lack the role.
  const KEY = 'burgerHavenStaffCredential_v2';
  const LEGACY_TOKEN_KEY = 'burgerHavenAdminToken';
  let current = null;

  function load() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.kind === 'account' || parsed.kind === 'token') && typeof parsed.value === 'string' && parsed.value) return parsed;
      }
      const legacy = sessionStorage.getItem(LEGACY_TOKEN_KEY);
      if (legacy) return { kind: 'token', value: legacy };
    } catch { /* storage unavailable: credential stays in memory only */ }
    return null;
  }

  function store(next) {
    current = next;
    try {
      if (next) sessionStorage.setItem(KEY, JSON.stringify(next)); else sessionStorage.removeItem(KEY);
      if (next && next.kind === 'token') sessionStorage.setItem(LEGACY_TOKEN_KEY, next.value); else sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch { /* ignore */ }
  }

  current = load();

  async function readJson(response) {
    try { return await response.json(); } catch { return {}; }
  }

  const StaffAuth = {
    saved() { return current; },
    kind() { return current ? current.kind : ''; },
    headers() {
      if (!current) return {};
      return current.kind === 'account' ? { 'X-Customer-Token': current.value } : { 'X-Admin-Token': current.value };
    },
    useToken(token) { store(token ? { kind: 'token', value: token } : null); },
    async signIn(email, password) {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        cache: 'no-store'
      });
      const data = await readJson(response);
      if (!response.ok) {
        const detail = Array.isArray(data.detail) ? 'Enter a valid email address and password.' : (data.error || data.detail);
        throw new Error(detail || `Sign-in failed (${response.status})`);
      }
      const role = data.user && data.user.role;
      if (role !== 'staff' && role !== 'admin') {
        // Do not keep a customer session open in the staff area.
        try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Customer-Token': data.token } }); } catch { /* best effort */ }
        const denied = new Error('This account does not have staff access. Customer accounts can order from the storefront but cannot open staff or administrator pages.');
        denied.code = 'no-access';
        throw denied;
      }
      store({ kind: 'account', value: data.token });
      return data.user;
    },
    async clear() {
      const previous = current;
      store(null);
      if (previous && previous.kind === 'account') {
        try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Customer-Token': previous.value } }); } catch { /* session also expires on its own */ }
      }
    }
  };

  window.BurgerHavenStaffAuth = StaffAuth;
})();
