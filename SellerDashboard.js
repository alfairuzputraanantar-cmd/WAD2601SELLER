// ============================================================
//  SellerDashboard.js — TEMPAT. Firebase Integration Layer
//  Project: localluxury-cb0d7  (shared with Buyer side)
//
//  This file:
//    1. Initialises Firebase (Firestore) with the same config
//       used in the Buyer page.
//    2. Attaches onSnapshot listeners to:
//         • "products"  — streams the menu in real-time
//         • "orders"    — streams incoming buyer orders in real-time
//    3. Provides helper functions used by script.js:
//         • fbUpdateOrderStatus(firestoreId, newStatus)
//         • showFirebaseError(msg) / hideFirebaseError()
//         • refreshMenu()
//
//  localStorage schema (shared with script.js & Buyer page):
//    "seller_menu"           → local cache of menu items
//    "chat_messages"         → seller↔buyer chat log
//    "seller_recommendation" → food card pushed to buyer (storage event)
//    "buyer_cart_events"     → cart-add notifications from buyer
//    "buyer_typing"          → "1" while buyer is composing
// ============================================================

// ──────────────────────────────────────────────────────────────
//  1. FIREBASE CONFIGURATION
//     Identical to the Buyer page (same DB, same project).
// ──────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCIYc8Epfu3jmrewyRaVGc4ISm7qKxG03k",
  authDomain:        "localluxury-cb0d7.firebaseapp.com",
  projectId:         "localluxury-cb0d7",
  storageBucket:     "localluxury-cb0d7.firebasestorage.app",
  messagingSenderId: "425958954222",
  appId:             "1:425958954222:web:0bfcdedbfbac2697a40fff",
  measurementId:     "G-DHC0N06PZB"
};

// ──────────────────────────────────────────────────────────────
//  2. INIT — guard against double-init from script.js
// ──────────────────────────────────────────────────────────────
let db = null;

(function initFirebase() {
  try {
    if (firebase.apps.length === 0) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    console.log('[SellerDashboard] ✅ Firebase initialised — project:', firebaseConfig.projectId);
    console.log('[Seller] Connected to Chat Collection: chats/session_01/messages');
    // DOM may not be ready yet — status dot update deferred to DOMContentLoaded
  } catch (err) {
    console.error('[SellerDashboard] ❌ Firebase init failed:', err);
    // Save error to show once DOM is ready
    window._fbInitError = err.message;
  }
})();

// ──────────────────────────────────────────────────────────────
//  3. STATUS DOT HELPER
// ──────────────────────────────────────────────────────────────
function setFbStatus(state) {
  const dot = document.getElementById('fb-status');
  if (!dot) return;
  const MAP = {
    connecting: { bg: '#f59e0b', title: 'Connecting to Firebase…' },
    connected:  { bg: '#4ade80', title: 'Firebase connected ✅'   },
    error:      { bg: '#ef4444', title: 'Firebase connection error ❌' },
  };
  const s = MAP[state] || MAP.connecting;
  dot.style.background = s.bg;
  dot.style.boxShadow  = `0 0 8px ${s.bg}`;
  dot.title = s.title;
}

// ──────────────────────────────────────────────────────────────
//  4. ERROR BANNER
// ──────────────────────────────────────────────────────────────
function showFirebaseError(msg) {
  console.error('[Firebase Error]', msg);
  const banner = document.getElementById('fb-error-banner');
  const text   = document.getElementById('fb-error-text');
  if (banner && text) {
    text.textContent = `⚠️ Firebase: ${msg}`;
    banner.style.display = 'flex';
  }
}

function hideFirebaseError() {
  const banner = document.getElementById('fb-error-banner');
  if (banner) banner.style.display = 'none';
}

// ──────────────────────────────────────────────────────────────
//  5. MENU — onSnapshot listener on "products" collection
//
//  Maps Firestore docs to the same shape used by script.js so
//  the "Recommend to Buyer" buttons get the correct product IDs.
//
//  Firestore product document shape (from Buyer side):
//    { name, price, description?, stock?, tags? }
// ──────────────────────────────────────────────────────────────
let _unsubscribeProducts = null;

function attachProductsListener() {
  if (!db) return;

  // Detach any existing listener first
  if (_unsubscribeProducts) {
    _unsubscribeProducts();
    _unsubscribeProducts = null;
  }

  console.log('[SellerDashboard] Attaching onSnapshot → products');
  setFbStatus('connecting');

  _unsubscribeProducts = db
    .collection('products')
    .orderBy('name')          // alphabetical — matches buyer display
    .onSnapshot(
      (snapshot) => {
        hideFirebaseError();
        setFbStatus('connected');

        // Remove loading spinner
        const loadingMsg = document.getElementById('menu-loading-msg');
        if (loadingMsg) loadingMsg.remove();

        // Show "Firebase Live" badge
        const badge = document.getElementById('menu-source-badge');
        if (badge) badge.style.display = 'inline-block';

        if (snapshot.empty) {
          // No products in Firestore — fall through to localStorage cache
          console.warn('[SellerDashboard] products collection is empty.');
          // script.js renderMenu() will show localStorage items if any
          return;
        }

        // Map snapshot → product array (same shape as localStorage products)
        const firestoreProducts = [];
        snapshot.forEach(doc => {
          const d = doc.data();
          firestoreProducts.push({
            id:          doc.id,                          // Firestore doc ID
            name:        d.name        || '(no name)',
            price:       Number(d.price) || 0,
            description: d.description || '',
            stock:       d.stock  !== undefined ? Number(d.stock) : null,
            tags:        Array.isArray(d.tags) ? d.tags : [],
            createdAt:   d.createdAt?.toMillis?.() || Date.now(),
            _source:     'firebase'                       // tag so we know origin
          });
        });

        console.log(`[SellerDashboard] Received ${firestoreProducts.length} products from Firestore.`);

        // Merge into seller_menu cache so script.js renderMenu() can draw cards
        // We keep Firebase as the authoritative source — overwrite localStorage
        localStorage.setItem('seller_menu', JSON.stringify(firestoreProducts));

        // Trigger the script.js renderer
        if (typeof renderMenu === 'function') renderMenu();
      },
      (err) => {
        setFbStatus('error');
        const msg = getFirestoreErrorMessage(err);
        showFirebaseError(msg);
        console.error('[SellerDashboard] products onSnapshot error:', err);

        // FALLBACK: render whatever is in localStorage
        if (typeof renderMenu === 'function') renderMenu();
      }
    );
}

// ──────────────────────────────────────────────────────────────
//  6. ORDERS — onSnapshot listener on "orders" collection
//
//  Listens for new/changed order documents.
//  Shows a slide-in panel with order details + status actions.
//  Firestore order document shape (from Buyer side):
//    { orderId, fullName, phone, address, city, items[],
//      total, status, orderDate, paymentMethod, createdAt }
// ──────────────────────────────────────────────────────────────
let _unsubscribeOrders = null;
const _knownOrderIds   = new Set();
let _ordersInitialLoad = true;   // suppress toasts for pre-existing orders on first load

function attachOrdersListener() {
  if (!db) return;

  if (_unsubscribeOrders) {
    _unsubscribeOrders();
    _unsubscribeOrders = null;
  }

  _ordersInitialLoad = true;
  console.log('[SellerDashboard] Attaching onSnapshot → orders (collection: orders)');

  // Query by `timestamp` — matches the field the Buyer writes in processOrder()
  // (Buyer uses: timestamp: firebase.firestore.FieldValue.serverTimestamp())
  _unsubscribeOrders = db
    .collection('orders')
    .orderBy('timestamp', 'desc')
    .limit(50)
    .onSnapshot(
      (snapshot) => {
        let newOrderCount = 0;

        snapshot.docChanges().forEach(change => {
          const doc  = change.doc;
          const data = { firestoreId: doc.id, ...doc.data() };

          if (change.type === 'added' && !_knownOrderIds.has(doc.id)) {
            _knownOrderIds.add(doc.id);
            renderOrderCard(data);
            // Only count as "new" after the initial page-load snapshot is done
            if (!_ordersInitialLoad) newOrderCount++;
          } else if (change.type === 'modified') {
            updateOrderCardStatus(doc.id, data.status);
          }
        });

        // After the first snapshot resolves, future adds are truly new orders
        _ordersInitialLoad = false;

        if (newOrderCount > 0) {
          showNewOrdersBadge(newOrderCount);
          // Show an alert-style toast for brand-new incoming orders
          const newDocs = snapshot.docChanges()
            .filter(c => c.type === 'added')
            .map(c => ({ firestoreId: c.doc.id, ...c.doc.data() }));
          if (newDocs.length > 0) showNewOrderToast(newDocs[0]);
        }

        // Hide the "waiting for Firebase" placeholder
        if (_knownOrderIds.size > 0) {
          const emptyMsg = document.getElementById('orders-empty-msg');
          if (emptyMsg) emptyMsg.style.display = 'none';
        }
      },
      (err) => {
        console.error('[SellerDashboard] orders onSnapshot error:', err);
        showFirebaseError(`Orders listener: ${getFirestoreErrorMessage(err)}`);
      }
    );
}

// ── Render a single order card into the orders panel ──────────
function renderOrderCard(order) {
  const list = document.getElementById('orders-list');
  if (!list) return;

  if (document.getElementById(`order-card-${order.firestoreId}`)) return;

  const STATUS_COLORS = {
    new:        '#a78bfa',   // purple — Buyer just placed
    pending:    '#f59e0b',
    preparing:  '#3b82f6',
    ready:      '#8b5cf6',
    delivering: '#D4AF37',
    completed:  '#4ade80',
    cancelled:  '#ef4444',
  };

  const status = order.status || 'new';
  const color  = STATUS_COLORS[status] || '#6b7280';

  // Format time from Firestore Timestamp or ISO string
  let timeStr = '';
  try {
    const raw = order.timestamp?.toDate ? order.timestamp.toDate() : new Date(order.orderDate || Date.now());
    timeStr = raw.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
  } catch { timeStr = ''; }

  const itemsHtml = (order.items || [])
    .map(i => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-size:12px;color:#e5e7eb;font-weight:500;">${escapeHtml(i.name)}</span>
        <span style="font-size:11px;color:#9ca3af;">×${i.quantity}  <span style="color:#D4AF37;">Rp ${(i.price*i.quantity).toLocaleString()}</span></span>
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
          ${escapeHtml(order.orderId || order.firestoreId.slice(0,12))}
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
      ${ ['preparing','ready','delivering','completed','cancelled']
        .map(s => `<button onclick="fbUpdateOrderStatus('${order.firestoreId}','${s}')"
          style="flex:1;min-width:58px;padding:6px 4px;border-radius:7px;font-size:10px;font-weight:700;cursor:pointer;
            background:rgba(${hexToRgb(STATUS_COLORS[s])},0.12);
            border:1px solid rgba(${hexToRgb(STATUS_COLORS[s])},0.4);
            color:${STATUS_COLORS[s]};transition:opacity 0.2s;"
          onmouseover="this.style.opacity='0.75'"
          onmouseout="this.style.opacity='1'"
        >${s.charAt(0).toUpperCase()+s.slice(1)}</button>`)
        .join('') }
    </div>
  `;
  list.prepend(card);
}

// ── Update status badge in-place when Firestore doc changes ──
function updateOrderCardStatus(firestoreId, newStatus) {
  const badge = document.getElementById(`status-badge-${firestoreId}`);
  if (!badge) return;
  const STATUS_COLORS = {
    new:'#a78bfa', pending:'#f59e0b', preparing:'#3b82f6',
    ready:'#8b5cf6', delivering:'#D4AF37', completed:'#4ade80', cancelled:'#ef4444'
  };
  const color = STATUS_COLORS[newStatus] || '#6b7280';
  badge.textContent = newStatus;
  badge.style.color  = color;
  badge.style.background = `rgba(${hexToRgb(color)},0.15)`;
  badge.style.borderColor = `rgba(${hexToRgb(color)},0.45)`;
}

// ── Write a status update back to Firestore ───────────────────
async function fbUpdateOrderStatus(firestoreId, newStatus) {
  if (!db) return showFirebaseError('Firebase not initialised.');
  try {
    await db.collection('orders').doc(firestoreId).update({ status: newStatus });
    console.log(`[SellerDashboard] Order ${firestoreId} → ${newStatus}`);
    showSellerToast(`Order updated → ${newStatus}`, '#4ade80');
  } catch (err) {
    console.error('[SellerDashboard] Status update failed:', err);
    showFirebaseError(`Could not update status: ${err.message}`);
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
  if (!db) {
    showFirebaseError('Firebase not connected. Check console.');
    return;
  }
  // Re-attach the listener (will flush and re-query)
  attachProductsListener();
  showSellerToast('🔄 Refreshing menu from Firebase…', '#D4AF37');
}

// ──────────────────────────────────────────────────────────────
//  8. WRITE PRODUCT TO FIRESTORE (called from script.js addProduct)
//
//  script.js calls addProduct() which currently saves to localStorage.
//  Here we intercept the save and ALSO write to Firestore so the
//  Buyer page can see the new item immediately.
// ──────────────────────────────────────────────────────────────
async function fbSaveProduct(product) {
  if (!db) return; // Silently skip — localStorage always saves first in script.js
  try {
    await db.collection('products').doc(product.id).set({
      name:        product.name,
      price:       product.price,
      description: product.description || '',
      stock:       product.stock ?? 0,
      tags:        product.tags || [],
      createdAt:   firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('[SellerDashboard] Product written to Firestore:', product.name);
  } catch (err) {
    console.error('[SellerDashboard] Could not write product to Firestore:', err);
    showFirebaseError(`Product save failed: ${err.message}`);
  }
}

async function fbDeleteProduct(productId) {
  if (!db) return;
  try {
    await db.collection('products').doc(productId).delete();
    console.log('[SellerDashboard] Product deleted from Firestore:', productId);
  } catch (err) {
    console.error('[SellerDashboard] Could not delete product from Firestore:', err);
  }
}

async function fbUpdateProduct(product) {
  if (!db) return;
  try {
    await db.collection('products').doc(product.id).update({
      name:        product.name,
      price:       product.price,
      description: product.description || '',
      stock:       product.stock ?? 0,
      tags:        product.tags || []
    });
    console.log('[SellerDashboard] Product updated in Firestore:', product.name);
  } catch (err) {
    console.error('[SellerDashboard] Could not update product in Firestore:', err);
    showFirebaseError(`Product update failed: ${err.message}`);
  }
}

// ──────────────────────────────────────────────────────────────
//  9. UTILITY
// ──────────────────────────────────────────────────────────────
function getFirestoreErrorMessage(err) {
  const CODE_MAP = {
    'permission-denied':    'Permission denied. Check Firestore Security Rules.',
    'not-found':            'Collection not found.',
    'unauthenticated':      'You must be signed in.',
    'unavailable':          'Firestore is offline. Check your internet connection.',
    'resource-exhausted':   'Quota exceeded.',
    'failed-precondition':  'Missing index. Check Firebase console for required index.',
  };
  return CODE_MAP[err?.code] || (err?.message || 'Unknown Firebase error');
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
    /* Firebase connection status dot (header) */
    .fb-status-dot {
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
  if (db) {
    // Firebase init succeeded — show green dot and start listeners
    setFbStatus('connected');
    attachProductsListener();
    attachOrdersListener();
  } else {
    // Firebase failed to init — show error and fall back to localStorage
    setFbStatus('error');
    if (window._fbInitError) {
      showFirebaseError(`Firebase init failed: ${window._fbInitError}`);
    }
    const loadingMsg = document.getElementById('menu-loading-msg');
    if (loadingMsg) loadingMsg.remove();
    if (typeof renderMenu === 'function') renderMenu();
  }
});

console.log('[SellerDashboard] Firebase integration layer loaded ✅');
