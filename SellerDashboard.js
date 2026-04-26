// ============================================================
//  SellerDashboard.js — TEMPAT. Supabase Integration Layer
//  Project: bnqhrwccxzjrnmxyzbvc  (shared with Buyer side)
//
//  This file:
//    1. Initialises Supabase with the same config
//       used in the Buyer page.
//    2. Attaches realtime channels to:
//         • "products"  — streams the menu in real-time
//         • "orders"    — streams incoming buyer orders in real-time
//    3. Provides helper functions used by script.js:
//         • sbUpdateOrderStatus(firestoreId, newStatus)
//         • showSupabaseError(msg) / hideSupabaseError()
//         • refreshMenu()
//
//  Communication via Supabase Realtime (shared with Buyer):
//    "seller_menu"           → local cache of menu items
//    "chat_messages"         → seller↔buyer chat log
//    "seller_recommendation" → food card pushed to buyer (storage event)
//    "buyer_cart_events"     → cart-add notifications from buyer
//    "buyer_typing"          → "1" while buyer is composing
// ============================================================

// ──────────────────────────────────────────────────────────────
//  1. SUPABASE CONFIGURATION
// ──────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://bnqhrwccxzjrnmxyzbvc.supabase.co";
const SUPABASE_KEY = "sb_publishable_aQgx6XXGRxZElZI_3FYGgg_3HMtn8TD";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('[SellerDashboard] ✅ Supabase initialised');

// ──────────────────────────────────────────────────────────────
//  3. STATUS DOT HELPER
// ──────────────────────────────────────────────────────────────
function setSbStatus(state) {
  const dot = document.getElementById('sb-status');
  if (!dot) return;
  const MAP = {
    connecting: { bg: '#f59e0b', title: 'Connecting to Supabase…' },
    connected: { bg: '#4ade80', title: 'Supabase connected ✅' },
    error: { bg: '#ef4444', title: 'Supabase connection error ❌' },
  };
  const s = MAP[state] || MAP.connecting;
  dot.style.background = s.bg;
  dot.style.boxShadow = `0 0 8px ${s.bg}`;
  dot.title = s.title;
}

// ──────────────────────────────────────────────────────────────
//  4. ERROR BANNER
// ──────────────────────────────────────────────────────────────
function showSupabaseError(msg) {
  console.error('[Supabase Error]', msg);
  const banner = document.getElementById('sb-error-banner');
  const text = document.getElementById('sb-error-text');
  if (banner && text) {
    text.textContent = `⚠️ Supabase: ${msg}`;
    banner.style.display = 'flex';
  }
}

function hideSupabaseError() {
  const banner = document.getElementById('sb-error-banner');
  if (banner) banner.style.display = 'none';
}

// ──────────────────────────────────────────────────────────────
//  5. MENU — Supabase realtime listener on "products" table
//
//  Maps Supabase rows to the same shape used by script.js so
//  the "Recommend to Buyer" buttons get the correct product IDs.
//
//  Supabase products row shape:
//    { id, name, price, description?, stock?, tags?, created_at }
// ──────────────────────────────────────────────────────────────
let _unsubscribeProducts = null;

async function attachProductsListener() {
  console.log('[SellerDashboard] Attaching Supabase listener → products');
  setSbStatus('connecting');

  if (_unsubscribeProducts) {
    supabaseClient.removeChannel(_unsubscribeProducts);
    _unsubscribeProducts = null;
  }

  try {
    const { data: snapshot, error } = await supabaseClient
      .from('products')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    
    hideSupabaseError();
    setSbStatus('connected');

    const loadingMsg = document.getElementById('menu-loading-msg');
    if (loadingMsg) loadingMsg.remove();

    const badge = document.getElementById('menu-source-badge');
    if (badge) badge.style.display = 'inline-block';

    const supabaseProducts = (snapshot || []).map(d => ({
      id: d.id,
      name: d.name || '(no name)',
      price: Number(d.price) || 0,
      description: d.description || '',
      stock: d.stock !== null ? Number(d.stock) : null,
      tags: Array.isArray(d.tags) ? d.tags : [],
      createdAt: d.created_at ? new Date(d.created_at).getTime() : Date.now(),
      _source: 'supabase'
    }));

    localStorage.setItem('seller_menu', JSON.stringify(supabaseProducts));
    if (typeof renderMenu === 'function') renderMenu();

    _unsubscribeProducts = supabaseClient.channel('public:products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async payload => {
         const { data: snap } = await supabaseClient.from('products').select('*').order('name', { ascending: true });
         if (snap) {
           const updatedProducts = snap.map(d => ({
             id: d.id, name: d.name || '(no name)', price: Number(d.price) || 0,
             description: d.description || '', stock: d.stock !== null ? Number(d.stock) : null,
             tags: Array.isArray(d.tags) ? d.tags : [],
             createdAt: d.created_at ? new Date(d.created_at).getTime() : Date.now(),
             _source: 'supabase'
           }));
           localStorage.setItem('seller_menu', JSON.stringify(updatedProducts));
           if (typeof renderMenu === 'function') renderMenu();
         }
      })
      .subscribe();

  } catch (err) {
    setSbStatus('error');
    showSupabaseError(`Products fetch error: ${err.message}`);
    console.error('[SellerDashboard] products error:', err);
    if (typeof renderMenu === 'function') renderMenu();
  }
}

// ──────────────────────────────────────────────────────────────
//  6. ORDERS — Supabase realtime listener on "orders" table
//
//  Listens for new/changed order rows.
//  Shows a slide-in panel with order details + status actions.
//  Supabase orders row shape:
//    { id, orderId, fullName, phone, address, city, district, items[],
//      total, status, orderDate, paymentMethod, created_at }
// ──────────────────────────────────────────────────────────────
let _unsubscribeOrders = null;
const _knownOrderIds = new Set();
let _ordersInitialLoad = true;

async function attachOrdersListener() {
  if (_unsubscribeOrders) {
    supabaseClient.removeChannel(_unsubscribeOrders);
    _unsubscribeOrders = null;
  }

  _ordersInitialLoad = true;
  console.log('[SellerDashboard] Attaching Supabase listener → orders');

  try {
    const { data: snapshot, error } = await supabaseClient
      .from('orders')
      .select('*')
      .order('id', { ascending: false })
      .limit(50);
      
    if (error) throw error;

    if (snapshot) {
      snapshot.forEach(doc => {
        const data = { firestoreId: doc.id, ...doc };
        if (!_knownOrderIds.has(doc.id)) {
          _knownOrderIds.add(doc.id);
          renderOrderCard(data);
        }
      });
    }

    _ordersInitialLoad = false;
    
    if (_knownOrderIds.size > 0) {
      const emptyMsg = document.getElementById('orders-empty-msg');
      if (emptyMsg) emptyMsg.style.display = 'none';
    }

    _unsubscribeOrders = supabaseClient.channel('public:orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => {
        if (payload.eventType === 'INSERT') {
          const doc = payload.new;
          const data = { firestoreId: doc.id, ...doc };
          if (!_knownOrderIds.has(doc.id)) {
            _knownOrderIds.add(doc.id);
            renderOrderCard(data);
            showNewOrdersBadge(1);
            showNewOrderToast(data);
          }
          const emptyMsg = document.getElementById('orders-empty-msg');
          if (emptyMsg) emptyMsg.style.display = 'none';
        } else if (payload.eventType === 'UPDATE') {
          const doc = payload.new;
          updateOrderCardStatus(doc.id, doc.status);
        }
      })
      .subscribe();

  } catch (err) {
    console.error('[SellerDashboard] orders error:', err);
    showSupabaseError(`Orders listener: ${err.message}`);
  }
}

// ── Render a single order card into the orders panel ──────────
function renderOrderCard(order) {
  const list = document.getElementById('orders-list');
  if (!list) return;

  if (document.getElementById(`order-card-${order.firestoreId}`)) return;

  const STATUS_COLORS = {
    new: '#a78bfa',   // purple — Buyer just placed
    pending: '#f59e0b',
    preparing: '#3b82f6',
    ready: '#8b5cf6',
    delivering: '#D4AF37',
    completed: '#4ade80',
    cancelled: '#ef4444',
  };

  const status = order.status || 'new';
  const color = STATUS_COLORS[status] || '#6b7280';

  // Format time from Supabase created_at ISO string
  let timeStr = '';
  try {
    const raw = order.timestamp?.toDate ? order.timestamp.toDate() : new Date(order.orderDate || Date.now());
    timeStr = raw.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
  } catch { timeStr = ''; }

  const itemsHtml = (order.items || [])
    .map(i => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-size:12px;color:#e5e7eb;font-weight:500;">${escapeHtml(i.name)}</span>
        <span style="font-size:11px;color:#9ca3af;">×${i.quantity}  <span style="color:#D4AF37;">Rp ${(i.price * i.quantity).toLocaleString()}</span></span>
      </div>`)
    .join('');

  const card = document.createElement('div');
  card.id = `order-card-${order.firestoreId}`;
  card.style.cssText = `
    background: linear-gradient(135deg, rgba(212,175,55,0.06), rgba(0,0,0,0));
    border: 1px solid rgba(212,175,55,0.25);
    border-radius: 14px;
    padding: 14px;
    margin-bottom: 12px;
    animation: sdCardIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
  `;
  card.innerHTML = `
    <!-- Header: Order ID + status badge -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
      <div>
        <p style="color:#D4AF37;font-weight:800;font-size:12px;font-family:monospace;margin:0;letter-spacing:0.5px;">
          ${escapeHtml(order.orderId || order.firestoreId.slice(0, 12))}
        </p>
        <p style="color:#6b7280;font-size:11px;margin:3px 0 0;">
          ${escapeHtml(order.fullName || '—')}&nbsp;&nbsp;${escapeHtml(order.phone || '')}
        </p>
      </div>
      <span id="status-badge-${order.firestoreId}"
        style="background:rgba(${hexToRgb(color)},0.15);color:${color};
               font-size:10px;padding:3px 10px;border-radius:20px;
               border:1px solid rgba(${hexToRgb(color)},0.45);font-weight:700;
               text-transform:uppercase;white-space:nowrap;">
        ${status}
      </span>
    </div>

    <!-- Itemized list -->
    <div style="margin-bottom:10px;padding:6px 0;">${itemsHtml}</div>

    <!-- Pricing summary -->
    <div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:8px 10px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#6b7280;margin-bottom:3px;">
        <span>Subtotal</span><span>Rp ${(order.subtotal || 0).toLocaleString()}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#6b7280;margin-bottom:3px;">
        <span>Delivery</span><span>Rp ${(order.deliveryFee || 0).toLocaleString()}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#6b7280;margin-bottom:6px;">
        <span>Tax (10%)</span><span>Rp ${(order.tax || 0).toLocaleString()}</span>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="font-size:12px;color:#9ca3af;font-weight:600;">Total Paid</span>
        <span style="font-size:14px;color:#D4AF37;font-weight:800;">Rp ${(order.total || 0).toLocaleString()}</span>
      </div>
    </div>

    <!-- Payment + time metadata -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span style="font-size:10px;color:#4b5563;background:rgba(255,255,255,0.05);border-radius:6px;padding:2px 7px;">
        ${escapeHtml(order.paymentMethod || 'N/A')}
      </span>
      <span style="font-size:10px;color:#4b5563;">${timeStr}</span>
    </div>

    <!-- Status action buttons (Seller updates order status) -->
    <div style="display:flex;gap:5px;flex-wrap:wrap;">
      ${['preparing', 'ready', 'delivering', 'completed', 'cancelled']
      .map(s => `<button onclick="sbUpdateOrderStatus('${order.firestoreId}','${s}')"
          style="flex:1;min-width:58px;padding:6px 4px;border-radius:7px;font-size:10px;font-weight:700;cursor:pointer;
            background:rgba(${hexToRgb(STATUS_COLORS[s])},0.12);
            border:1px solid rgba(${hexToRgb(STATUS_COLORS[s])},0.4);
            color:${STATUS_COLORS[s]};transition:opacity 0.2s;"
          onmouseover="this.style.opacity='0.75'"
          onmouseout="this.style.opacity='1'"
        >${s.charAt(0).toUpperCase() + s.slice(1)}</button>`)
      .join('')}
    </div>
  `;
  list.prepend(card);
}

// ── Update status badge in-place when Supabase order row changes ──
function updateOrderCardStatus(firestoreId, newStatus) {
  const badge = document.getElementById(`status-badge-${firestoreId}`);
  if (!badge) return;
  const STATUS_COLORS = {
    new: '#a78bfa', pending: '#f59e0b', preparing: '#3b82f6',
    ready: '#8b5cf6', delivering: '#D4AF37', completed: '#4ade80', cancelled: '#ef4444'
  };
  const color = STATUS_COLORS[newStatus] || '#6b7280';
  badge.textContent = newStatus;
  badge.style.color = color;
  badge.style.background = `rgba(${hexToRgb(color)},0.15)`;
  badge.style.borderColor = `rgba(${hexToRgb(color)},0.45)`;
}

// ── Write a status update back to Supabase ───────────────────
async function sbUpdateOrderStatus(firestoreId, newStatus) {
  try {
    const { error } = await supabaseClient.from('orders').update({ status: newStatus }).eq('id', firestoreId);
    if (error) throw error;
    console.log(`[SellerDashboard] Order ${firestoreId} → ${newStatus}`);
    showSellerToast(`Order updated → ${newStatus}`, '#4ade80');
  } catch (err) {
    console.error('[SellerDashboard] Status update failed:', err);
    showSupabaseError(`Could not update status: ${err.message}`);
  }
}

// ── Orders notification badge ─────────────────────────────────
function showNewOrdersBadge(count) {
  const badge = document.getElementById('orders-badge');
  const panel = document.getElementById('orders-slide-panel');
  if (!badge || panel?.classList.contains('orders-panel-open')) return;
  const current = parseInt(badge.textContent) || 0;
  badge.textContent = current + count;
  badge.classList.remove('hidden');
}

// ── New order toast popup ─────────────────────────────────────
function showNewOrderToast(order) {
  // Build a compact item summary (e.g. "2× Pizza, 1× Soda")
  const itemSummary = (order.items || [])
    .slice(0, 3)
    .map(i => `${i.quantity}× ${escapeHtml(i.name)}`)
    .join(', ') + ((order.items || []).length > 3 ? '…' : '');

  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed;top:72px;left:20px;z-index:9999;
    background:linear-gradient(135deg,#0c0c0f,#111318);
    border:1px solid rgba(167,139,250,0.55);
    border-radius:16px;padding:16px 18px;
    box-shadow:0 0 0 1px rgba(167,139,250,0.1),0 16px 48px rgba(0,0,0,0.7);
    max-width:320px;
    animation:sdSlideInLeft 0.4s cubic-bezier(0.34,1.56,0.64,1);
  `;
  t.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;">
      <div style="width:40px;height:40px;border-radius:50%;
        background:linear-gradient(135deg,rgba(167,139,250,0.25),rgba(167,139,250,0.1));
        border:1px solid rgba(167,139,250,0.45);
        display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🛒</div>
      <div style="flex:1;min-width:0;">
        <p style="color:#a78bfa;font-weight:800;font-size:13px;margin:0 0 4px;letter-spacing:0.3px;">⚡ NEW ORDER INCOMING!</p>
        <p style="color:#f0f0f0;font-size:13px;margin:0 0 2px;font-weight:600;">${escapeHtml(order.fullName || 'Customer')}</p>
        <p style="color:#9ca3af;font-size:11px;margin:0 0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${itemSummary || '—'}</p>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:12px;color:#D4AF37;font-weight:700;">Rp ${(order.total || 0).toLocaleString()}</span>
          <span style="font-size:10px;color:#374151;background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.2);border-radius:5px;padding:1px 6px;font-weight:700;">
            ${escapeHtml(order.orderId || 'NEW')}
          </span>
        </div>
      </div>
      <button onclick="this.parentElement.parentElement.remove()"
        style="background:none;border:none;color:#4b5563;font-size:18px;cursor:pointer;line-height:1;flex-shrink:0;margin-top:-2px;">✕</button>
    </div>`;
  document.body.appendChild(t);
  // Play a soft audio cue if browser allows
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
  } catch { /* audio not available */ }
  setTimeout(() => t?.remove(), 8000);
}

// ──────────────────────────────────────────────────────────────
//  7. REFRESH MENU (manual button)
// ──────────────────────────────────────────────────────────────
function refreshMenu() {
  // Re-attach the listener (will flush and re-query from Supabase)
  attachProductsListener();
  showSellerToast('🔄 Refreshing menu from Supabase…', '#D4AF37');
}

// ──────────────────────────────────────────────────────────────
//  8. WRITE PRODUCT TO SUPABASE (called from script.js addProduct)
//
//  script.js calls addProduct() which saves to localStorage.
//  These helpers also write to Supabase so the Buyer page can
//  see the new/updated/deleted item immediately via realtime.
// ──────────────────────────────────────────────────────────────
async function sbSaveProduct(product) {
  try {
    const { error } = await supabaseClient.from('products').insert([{
      id: product.id,
      name: product.name,
      price: product.price,
      description: product.description || '',
      stock: product.stock ?? 0,
      tags: product.tags || []
    }]);
    if (error) throw error;
    console.log('[SellerDashboard] Product written to Supabase:', product.name);
  } catch (err) {
    console.error('[SellerDashboard] Could not write product:', err);
    showSupabaseError(`Product save failed: ${err.message}`);
  }
}

async function sbDeleteProduct(productId) {
  try {
    await supabaseClient.from('products').delete().eq('id', productId);
    console.log('[SellerDashboard] Product deleted:', productId);
  } catch (err) {
    console.error('[SellerDashboard] Could not delete product:', err);
  }
}

async function sbUpdateProduct(product) {
  try {
    const { error } = await supabaseClient.from('products').update({
      name: product.name,
      price: product.price,
      description: product.description || '',
      stock: product.stock ?? 0,
      tags: product.tags || []
    }).eq('id', product.id);
    if (error) throw error;
    console.log('[SellerDashboard] Product updated:', product.name);
  } catch (err) {
    console.error('[SellerDashboard] Could not update product:', err);
    showSupabaseError(`Product update failed: ${err.message}`);
  }
}

// ──────────────────────────────────────────────────────────────
//  9. UTILITY
// ──────────────────────────────────────────────────────────────
function getSupabaseErrorMessage(err) {
  // Map common Supabase/Postgres error codes to friendly messages
  const CODE_MAP = {
    '42501': 'Permission denied. Check Supabase RLS policies.',
    '23505': 'Duplicate record — item already exists.',
    'PGRST301': 'Row-level security blocked the request.',
    '42P01': 'Table not found.',
  };
  return CODE_MAP[err?.code] || (err?.message || 'Unknown Supabase error');
}

/** Convert a #rrggbb hex colour to "r,g,b" for rgba() usage */
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

// ──────────────────────────────────────────────────────────────
//  10. CSS INJECTIONS (Panel styles + animations)
// ──────────────────────────────────────────────────────────────
(function injectSDStyles() {
  if (document.getElementById('sd-extra-styles')) return;
  const style = document.createElement('style');
  style.id = 'sd-extra-styles';
  style.textContent = `
    /* Supabase connection status dot (header) */
    .sb-status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #f59e0b;        /* starts amber = connecting */
      box-shadow: 0 0 8px #f59e0b;
      transition: background 0.4s, box-shadow 0.4s;
    }

    /* Orders slide-in panel (from the LEFT) */
    .orders-slide-panel {
      position: fixed;
      top: 57px;
      left: -380px;
      width: 360px;
      bottom: 0;
      background: #090909;
      border-right: 1px solid var(--gold-border);
      z-index: 250;
      display: flex;
      flex-direction: column;
      transition: left 0.3s ease;
      box-shadow: 8px 0 32px rgba(0,0,0,0.5);
    }
    .orders-slide-panel.orders-panel-open { left: 0; }

    .orders-slide-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 18px;
      border-bottom: 1px solid var(--gold-border);
      background: rgba(0,0,0,0.5);
      flex-shrink: 0;
    }

    /* Slide-in animation for order toast (from left) */
    @keyframes sdSlideInLeft {
      from { opacity:0; transform:translateX(-20px); }
      to   { opacity:1; transform:translateX(0); }
    }

    /* sdCardIn reused from script.js */
    @keyframes sdCardIn {
      from { opacity:0; transform:translateY(10px) scale(0.97); }
      to   { opacity:1; transform:translateY(0) scale(1); }
    }
    @keyframes sdSlideIn {
      from { opacity:0; transform:translateX(20px); }
      to   { opacity:1; transform:translateX(0); }
    }
  `;
  document.head.appendChild(style);
})();

// ──────────────────────────────────────────────────────────────
//  11. BOOTSTRAP — start listeners once DOM is ready
// ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setSbStatus('connected');
  attachProductsListener();
  attachOrdersListener();
});

console.log('[SellerDashboard] Supabase integration layer loaded ✅');
