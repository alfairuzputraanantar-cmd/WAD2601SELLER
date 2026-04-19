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

function attachOrdersListener() {
  if (!db) return;

  if (_unsubscribeOrders) {
    _unsubscribeOrders();
    _unsubscribeOrders = null;
  }

  console.log('[SellerDashboard] Attaching onSnapshot → orders');

  // Only show last 30 orders, sorted newest first
  _unsubscribeOrders = db
    .collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(30)
    .onSnapshot(
      (snapshot) => {
        let newOrderCount = 0;

        snapshot.docChanges().forEach(change => {
          const doc  = change.doc;
          const data = { firestoreId: doc.id, ...doc.data() };

          if (change.type === 'added' && !_knownOrderIds.has(doc.id)) {
            _knownOrderIds.add(doc.id);
            renderOrderCard(data);
            newOrderCount++;
          } else if (change.type === 'modified') {
            // Update the status badge in-place
            updateOrderCardStatus(doc.id, data.status);
          }
        });

        if (newOrderCount > 0) {
          showNewOrdersBadge(newOrderCount);
          if (newOrderCount === 1) {
            const latest = snapshot.docs[0]?.data();
            if (latest) showNewOrderToast(latest);
          }
        }

        // Hide "waiting" message once we have data
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

  // Check if card already exists (avoid duplicates on re-render)
  if (document.getElementById(`order-card-${order.firestoreId}`)) return;

  const STATUS_COLORS = {
    pending:    '#f59e0b',
    preparing:  '#3b82f6',
    ready:      '#8b5cf6',
    delivering: '#D4AF37',
    completed:  '#4ade80',
    cancelled:  '#ef4444',
  };
  const status = order.status || 'pending';
  const color  = STATUS_COLORS[status] || '#6b7280';

  const itemsHtml = (order.items || [])
    .map(i => `<span style="display:block;font-size:11px;color:#9ca3af;">${escapeHtml(i.name)} ×${i.quantity}</span>`)
    .join('');

  const card = document.createElement('div');
  card.id = `order-card-${order.firestoreId}`;
  card.style.cssText = `
    background:rgba(212,175,55,0.04);
    border:1px solid rgba(212,175,55,0.2);
    border-radius:12px;
    padding:12px;
    margin-bottom:10px;
    animation:sdCardIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
  `;
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
      <div>
        <p style="color:#D4AF37;font-weight:700;font-size:11px;font-family:monospace;margin:0;">${order.orderId || order.firestoreId}</p>
        <p style="color:#6b7280;font-size:10px;margin:2px 0 0;">${order.fullName || '—'} · ${order.phone || ''}</p>
      </div>
      <span id="status-badge-${order.firestoreId}" style="background:rgba(${hexToRgb(color)},0.15);color:${color};font-size:10px;padding:2px 8px;border-radius:20px;border:1px solid rgba(${hexToRgb(color)},0.4);font-weight:700;text-transform:uppercase;">${status}</span>
    </div>
    <div style="margin-bottom:8px;">${itemsHtml}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span style="color:#9ca3af;font-size:11px;">Total</span>
      <span style="color:#D4AF37;font-weight:700;font-size:13px;">Rp ${(order.total || 0).toLocaleString()}</span>
    </div>
    <!-- Status action buttons -->
    <div style="display:flex;gap:5px;flex-wrap:wrap;">
      ${['preparing','ready','delivering','completed','cancelled']
        .map(s => `<button onclick="fbUpdateOrderStatus('${order.firestoreId}','${s}')"
          style="flex:1;min-width:60px;padding:5px 4px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;
            background:rgba(${hexToRgb(STATUS_COLORS[s])},0.12);
            border:1px solid rgba(${hexToRgb(STATUS_COLORS[s])},0.4);
            color:${STATUS_COLORS[s]};transition:all 0.2s;"
          onmouseover="this.style.opacity='0.8'"
          onmouseout="this.style.opacity='1'"
        >${s.charAt(0).toUpperCase() + s.slice(1)}</button>`)
        .join('')}
    </div>
  `;
  list.prepend(card);
}

// ── Update status badge in-place when Firestore doc changes ──
function updateOrderCardStatus(firestoreId, newStatus) {
  const badge = document.getElementById(`status-badge-${firestoreId}`);
  if (!badge) return;
  const STATUS_COLORS = {
    pending:'#f59e0b', preparing:'#3b82f6', ready:'#8b5cf6',
    delivering:'#D4AF37', completed:'#4ade80', cancelled:'#ef4444'
  };
  const color = STATUS_COLORS[newStatus] || '#6b7280';
  badge.textContent = newStatus;
  badge.style.color  = color;
  badge.style.background = `rgba(${hexToRgb(color)},0.15)`;
  badge.style.borderColor = `rgba(${hexToRgb(color)},0.4)`;
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
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed;top:72px;left:20px;z-index:9999;
    background:linear-gradient(135deg,#0a0a0a,#111);
    border:1px solid rgba(59,130,246,0.5);
    border-radius:14px;padding:14px 18px;
    box-shadow:0 12px 40px rgba(0,0,0,0.6);
    max-width:300px;
    animation:sdSlideInLeft 0.4s cubic-bezier(0.34,1.56,0.64,1);
  `;
  t.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:36px;height:36px;border-radius:50%;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.4);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">📋</div>
      <div>
        <p style="color:#3b82f6;font-weight:700;font-size:13px;margin:0 0 3px;">New Order! 🎉</p>
        <p style="color:#e5e7eb;font-size:12px;margin:0;font-weight:600;">${order.fullName || 'Customer'}</p>
        <p style="color:#9ca3af;font-size:11px;margin:2px 0 0;">Rp ${(order.total || 0).toLocaleString()}</p>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;color:#4b5563;font-size:16px;cursor:pointer;margin-left:auto;flex-shrink:0;">✕</button>
    </div>`;
  document.body.appendChild(t);
  setTimeout(() => t?.remove(), 7000);
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
