// ============================================================
//  auth.js — TEMPAT. Seller Session Manager
//  Cookie-based authentication backed by Supabase.
//
//  Flow:
//    1. On load: read "tempat_session" cookie
//    2. If cookie found: validate token against seller_sessions table
//    3. If valid: fire sessionReady, reveal dashboard
//    4. If no cookie / invalid: show login modal
//    5. Login: Name + PIN → create session row → set cookie
//    6. Logout: delete Supabase row + cookie → show login modal
//
//  Supabase table (run once in SQL editor):
//    create table public.seller_sessions (
//      id          uuid primary key default gen_random_uuid(),
//      seller_name text not null,
//      pin         text not null,
//      token       text not null unique,
//      created_at  timestamptz default now(),
//      expires_at  timestamptz default (now() + interval '30 days')
//    );
//    alter table public.seller_sessions enable row level security;
//    create policy "allow all" on public.seller_sessions
//      for all using (true) with check (true);
// ============================================================

(function () {
  'use strict';

  // ── Supabase (SDK is loaded before this script) ──────────────
  const SUPABASE_URL = 'https://bnqhrwccxzjrnmxyzbvc.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_aQgx6XXGRxZElZI_3FYGgg_3HMtn8TD';
  const _authSB = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── Cookie Helpers ──────────────────────────────────────────
  function setCookie(name, value, days) {
    const exp = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${exp};path=/;SameSite=Lax`;
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
  }

  // ── Token generator (random UUID-like string) ───────────────
  function generateToken() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ── Validate existing token against Supabase ─────────────────
  async function validateSession(token) {
    try {
      const { data, error } = await _authSB
        .from('seller_sessions')
        .select('*')
        .eq('token', token)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (error || !data) return null;
      return data;
    } catch {
      return null;
    }
  }

  // ── Create a new session in Supabase ─────────────────────────
  // PIN is NOT stored in Supabase (avoids schema dependency).
  // It is hashed and kept in a local cookie instead.
  async function createSession(sellerName, pin) {
    // Check if a seller account already exists
    const { data: existing } = await _authSB
      .from('seller_sessions')
      .select('seller_name')
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Account exists — name must match
      if (existing.seller_name !== sellerName) {
        throw new Error('Incorrect seller name.');
      }
      // Verify PIN against locally stored hash
      const storedHash = getCookie('tempat_pin');
      if (storedHash && storedHash !== _hashPin(sellerName, pin)) {
        throw new Error('Incorrect PIN.');
      }
    }

    // Insert session token (no pin column required)
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 864e5).toISOString();
    const { error } = await _authSB.from('seller_sessions').insert([{
      seller_name: sellerName,
      token,
      expires_at: expiresAt
    }]);
    if (error) throw new Error(error.message);

    // Persist PIN hash locally for future login checks
    setCookie('tempat_pin', _hashPin(sellerName, pin), 365);
    return { token, seller_name: sellerName };
  }

  // ── Simple PIN hash (name + pin, not cryptographic) ──────────
  function _hashPin(name, pin) {
    const str = name.toLowerCase() + ':' + pin;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return 'ph_' + Math.abs(hash).toString(36);
  }

  // ── Destroy session (logout) ──────────────────────────────────
  async function destroySession(token) {
    try {
      await _authSB.from('seller_sessions').delete().eq('token', token);
    } catch { /* best-effort */ }
    deleteCookie('tempat_session');
  }

  // ── Reveal dashboard (fire sessionReady) ─────────────────────
  function activateSession(sellerName) {
    window.SELLER_NAME = sellerName;

    // Update header chip
    const chip = document.getElementById('seller-name-chip');
    if (chip) {
      chip.textContent = `👤 ${sellerName}`;
      chip.style.display = 'inline-flex';
    }

    // Remove auth overlay
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.remove();

    // Fire event so SellerDashboard.js can start listeners
    window.dispatchEvent(new CustomEvent('sessionReady', { detail: { sellerName } }));
    console.log('[Auth] ✅ Session active as:', sellerName);
  }

  // ══════════════════════════════════════════════════════════════
  //  LOGIN MODAL — injected HTML + CSS
  // ══════════════════════════════════════════════════════════════
  function injectAuthStyles() {
    const s = document.createElement('style');
    s.id = 'auth-styles';
    s.textContent = `
      #auth-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        background: radial-gradient(ellipse at 60% 40%, rgba(212,175,55,0.08) 0%, #000 70%);
        backdrop-filter: blur(2px);
        animation: authFadeIn 0.4s ease;
      }
      @keyframes authFadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      #auth-card {
        position: relative;
        width: 100%;
        max-width: 400px;
        margin: 20px;
        background: linear-gradient(145deg, #0e0e11, #111318);
        border: 1px solid rgba(212,175,55,0.3);
        border-radius: 24px;
        padding: 44px 40px 40px;
        box-shadow:
          0 0 0 1px rgba(212,175,55,0.08),
          0 40px 80px rgba(0,0,0,0.8),
          inset 0 1px 0 rgba(212,175,55,0.15);
        animation: authCardIn 0.5s cubic-bezier(0.34,1.56,0.64,1);
      }
      @keyframes authCardIn {
        from { opacity:0; transform: translateY(28px) scale(0.96); }
        to   { opacity:1; transform: translateY(0)   scale(1); }
      }
      #auth-card::before {
        content: '';
        position: absolute;
        top: -1px; left: 50%;
        transform: translateX(-50%);
        width: 60%;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(212,175,55,0.6), transparent);
        border-radius: 999px;
      }
      .auth-logo {
        text-align: center;
        margin-bottom: 28px;
      }
      .auth-logo-title {
        font-family: 'Orbitron', sans-serif;
        font-size: 32px;
        font-weight: 900;
        color: #D4AF37;
        letter-spacing: 0.12em;
        text-shadow: 0 0 32px rgba(212,175,55,0.4);
        display: block;
      }
      .auth-logo-sub {
        display: inline-block;
        margin-top: 6px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #4b5563;
        background: rgba(212,175,55,0.07);
        border: 1px solid rgba(212,175,55,0.18);
        border-radius: 999px;
        padding: 3px 14px;
      }
      .auth-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(212,175,55,0.2), transparent);
        margin: 0 0 28px;
      }
      .auth-label {
        display: block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #6b7280;
        margin-bottom: 8px;
      }
      .auth-input-wrap {
        position: relative;
        margin-bottom: 18px;
      }
      .auth-input-wrap svg {
        position: absolute;
        left: 14px;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        color: #4b5563;
        flex-shrink: 0;
      }
      .auth-input {
        width: 100%;
        box-sizing: border-box;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        color: #e5e7eb;
        font-size: 14px;
        font-weight: 500;
        padding: 13px 16px 13px 42px;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
        font-family: 'Inter', sans-serif;
      }
      .auth-input::placeholder { color: #374151; }
      .auth-input:focus {
        border-color: rgba(212,175,55,0.5);
        background: rgba(212,175,55,0.04);
        box-shadow: 0 0 0 3px rgba(212,175,55,0.08);
      }
      #auth-pin-input {
        letter-spacing: 0.25em;
        font-size: 18px;
        font-weight: 700;
      }
      #auth-btn {
        width: 100%;
        padding: 14px;
        margin-top: 8px;
        background: linear-gradient(135deg, #D4AF37, #b8942a);
        border: none;
        border-radius: 12px;
        color: #000;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0.05em;
        cursor: pointer;
        transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
        box-shadow: 0 8px 24px rgba(212,175,55,0.3);
        font-family: 'Inter', sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      #auth-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 12px 32px rgba(212,175,55,0.45);
      }
      #auth-btn:active:not(:disabled) { transform: scale(0.98); }
      #auth-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
      #auth-btn .auth-spinner {
        width: 16px; height: 16px;
        border: 2px solid rgba(0,0,0,0.3);
        border-top-color: #000;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        display: none;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      #auth-error {
        display: none;
        margin-top: 16px;
        background: rgba(239,68,68,0.1);
        border: 1px solid rgba(239,68,68,0.3);
        border-radius: 10px;
        padding: 10px 14px;
        color: #ef4444;
        font-size: 13px;
        font-weight: 600;
        text-align: center;
        animation: authFadeIn 0.25s ease;
      }
      #auth-hint {
        margin-top: 20px;
        text-align: center;
        font-size: 11px;
        color: #374151;
        line-height: 1.6;
      }
      #auth-hint strong { color: #6b7280; }
      /* Floating particles background */
      .auth-particle {
        position: absolute;
        border-radius: 50%;
        background: rgba(212,175,55,0.12);
        animation: authFloat linear infinite;
        pointer-events: none;
      }
      @keyframes authFloat {
        from { transform: translateY(100vh) rotate(0deg); opacity: 0; }
        10%  { opacity: 1; }
        90%  { opacity: 0.4; }
        to   { transform: translateY(-100px) rotate(720deg); opacity: 0; }
      }
    `;
    document.head.appendChild(s);
  }

  function createAuthOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'auth-overlay';

    // Floating particles
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('div');
      p.className = 'auth-particle';
      const size = Math.random() * 8 + 4;
      p.style.cssText = `
        width:${size}px; height:${size}px;
        left:${Math.random() * 100}%;
        animation-duration:${Math.random() * 12 + 10}s;
        animation-delay:${Math.random() * 8}s;
      `;
      overlay.appendChild(p);
    }

    const card = document.createElement('div');
    card.id = 'auth-card';
    card.innerHTML = `
      <div class="auth-logo">
        <span class="auth-logo-title">TEMPAT.</span>
        <span class="auth-logo-sub">Seller Access</span>
      </div>
      <div class="auth-divider"></div>

      <label class="auth-label" for="auth-name-input">Seller Name</label>
      <div class="auth-input-wrap">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
        </svg>
        <input id="auth-name-input" class="auth-input" type="text"
          placeholder="Enter your name…" maxlength="40" autocomplete="username"
          autocapitalize="words" spellcheck="false">
      </div>

      <label class="auth-label" for="auth-pin-input">PIN</label>
      <div class="auth-input-wrap">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
        </svg>
        <input id="auth-pin-input" class="auth-input" type="password"
          placeholder="••••••" maxlength="6" autocomplete="current-password"
          inputmode="numeric" pattern="[0-9]*">
      </div>

      <button id="auth-btn" onclick="window._authLogin()">
        <div class="auth-spinner" id="auth-spinner"></div>
        <svg id="auth-btn-icon" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/>
        </svg>
        Enter Dashboard
      </button>

      <div id="auth-error"></div>

      <p id="auth-hint">
        First time? Enter your name and choose a PIN.<br>
        <strong>Your credentials will be saved for 30 days.</strong>
      </p>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Enter key support
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter') window._authLogin();
    });

    // Auto-focus name field
    setTimeout(() => document.getElementById('auth-name-input')?.focus(), 100);
  }

  function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (el) { el.textContent = '⚠️ ' + msg; el.style.display = 'block'; }
  }

  function setAuthLoading(loading) {
    const btn = document.getElementById('auth-btn');
    const spinner = document.getElementById('auth-spinner');
    const icon = document.getElementById('auth-btn-icon');
    if (!btn) return;
    btn.disabled = loading;
    if (spinner) spinner.style.display = loading ? 'block' : 'none';
    if (icon) icon.style.display = loading ? 'none' : 'block';
  }

  // ── Login handler (exposed globally for onclick) ──────────────
  window._authLogin = async function () {
    const nameEl = document.getElementById('auth-name-input');
    const pinEl  = document.getElementById('auth-pin-input');
    const errEl  = document.getElementById('auth-error');

    const name = nameEl?.value.trim();
    const pin  = pinEl?.value.trim();

    if (errEl) errEl.style.display = 'none';

    if (!name) return showAuthError('Please enter your seller name.');
    if (!pin || pin.length < 4) return showAuthError('PIN must be at least 4 digits.');
    if (!/^\d+$/.test(pin)) return showAuthError('PIN must contain numbers only.');

    setAuthLoading(true);
    try {
      const session = await createSession(name, pin);
      setCookie('tempat_session', session.token, 30);
      activateSession(session.seller_name);
    } catch (err) {
      showAuthError(err.message || 'Login failed. Try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  // ── Logout handler (exposed globally) ────────────────────────
  window.sellerLogout = async function () {
    if (!confirm('Log out of the Seller Dashboard?')) return;
    const token = getCookie('tempat_session');
    if (token) await destroySession(token);
    window.SELLER_NAME = null;
    location.reload();
  };

  // ══════════════════════════════════════════════════════════════
  //  BOOTSTRAP — runs on DOMContentLoaded
  // ══════════════════════════════════════════════════════════════
  async function boot() {
    injectAuthStyles();

    const token = getCookie('tempat_session');

    if (token) {
      // Show subtle "validating" state on the status dot
      console.log('[Auth] Cookie found, validating session…');
      const session = await validateSession(token);
      if (session) {
        activateSession(session.seller_name);
        return;
      }
      // Token expired or deleted — clear it
      deleteCookie('tempat_session');
    }

    // No valid session → show login modal
    createAuthOverlay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
