// ============================================================
//  SellerDashboard.js — WAD2601SELLER
//  Real-time Firebase Seller Dashboard
//  Handles: Orders • Catalog • Buyer Chat • Typing Indicator
// ============================================================

// ────────────────────────────────────────────────────────────
//  FIREBASE INIT  (shared with script.js — do NOT re-init)
//  db is already initialised in script.js; this file just
//  extends the dashboard with extra real-time listeners.
// ────────────────────────────────────────────────────────────

// ============================================================
//  1.  PRODUCT CATALOG CACHE  (live onSnapshot)
// ============================================================
//  allProducts is already kept fresh by script.js, but we keep
//  a named Map here so order cards can look up products in O(1).
const productMap = new Map(); // productId → product data

db.collection('products').onSnapshot(snap => {
  productMap.clear();
  snap.forEach(doc => productMap.set(doc.id, { id: doc.id, ...doc.data() }));
  // Re-render orders so product names / prices refresh automatically
  renderOrders();
});

// ============================================================
//  2.  ORDER STATUS CONSTANTS
// ============================================================
const SD_STATUS_META = {
  pending:    { label: 'Pending',    color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.4)'  },
  accepted:   { label: 'Accepted',   color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.4)'  },
  preparing:  { label: 'Preparing',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.4)'  },
  ready:      { label: 'Ready',      color: '#06b6d4', bg: 'rgba(6,182,212,0.15)',   border: 'rgba(6,182,212,0.4)'   },
  delivering: { label: 'Delivering', color: '#D4AF37', bg: 'rgba(212,175,55,0.15)', border: 'rgba(212,175,55,0.4)'  },
  completed:  { label: 'Completed',  color: '#4ade80', bg: 'rgba(74,222,128,0.15)', border: 'rgba(74,222,128,0.3)'  },
  rejected:   { label: 'Rejected',   color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.3)'   },
  cancelled:  { label: 'Cancelled',  color: '#6b7280', bg: 'rgba(107,114,128,0.15)',border: 'rgba(107,114,128,0.3)' },
};

function sdStatusBadge(status) {
  const s = SD_STATUS_META[status] || SD_STATUS_META.pending;
  return `<span style="background:${s.bg};color:${s.color};font-size:11px;padding:3px 10px;border-radius:20px;border:1px solid ${s.border};font-weight:700;white-space:nowrap;letter-spacing:0.3px;">${s.label}</span>`;
}

// ============================================================
//  3.  REAL-TIME ORDER FEED  (onSnapshot)
//      Handles both legacy ARRAY_ORDER format and new format
// ============================================================
let _sdOrders = [];
let _sdOrderFilter = 'all';
let _sdOrderUnsubscribe = null;

function startOrderFeed() {
  if (_sdOrderUnsubscribe) _sdOrderUnsubscribe();

  _sdOrderUnsubscribe = db.collection('orders')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snapshot => {
      const previous = new Set(_sdOrders.map(o => o.firestoreId));
      _sdOrders = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        // Normalise ARRAY_ORDER format if it exists
        const order = normaliseOrder(doc.id, data);
        _sdOrders.push(order);

        // Flash notification for brand-new pending orders
        if (!previous.has(doc.id) && order.status === 'pending') {
          showNewOrderToast(order);
        }
      });

      renderOrderFeed();
      updateSDOrderBadge();
      updateSDAnalytics();
    }, err => {
      console.error('[SD] Order feed error:', err);
    });
}

// Normalise ARRAY_ORDER  { items:[{productId,qty},...] }  →  flat order object
function normaliseOrder(docId, data) {
  const order = { firestoreId: docId, ...data };

  // If items were stored as ARRAY_ORDER (productId-only format), enrich them
  if (Array.isArray(order.items)) {
    order.items = order.items.map(item => {
      // Already resolved — has name?
      if (item.name) return item;

      // Resolve from live productMap
      const product = productMap.get(item.productId);
      return {
        productId: item.productId,
        quantity: item.qty || item.quantity || 1,
        name: product ? product.name : `Product (${item.productId})`,
        price: product ? product.price : (item.price || 0),
        image: product ? (product.image || '') : '',
      };
    });

    // Recompute total from resolved items if missing
    if (!order.total) {
      order.total = order.items.reduce((s, i) => s + (i.price * i.quantity), 0);
    }
  }

  return order;
}

// ──────────────────────────────────────────────────────────────
//  Render the order list inside #sd-order-list
// ──────────────────────────────────────────────────────────────
function renderOrderFeed() {
  const container = document.getElementById('sd-order-list');
  if (!container) return;

  const filtered = _sdOrderFilter === 'all'
    ? _sdOrders
    : _sdOrders.filter(o => o.status === _sdOrderFilter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:56px 20px;color:#374151;">
        <svg width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.2" viewBox="0 0 24 24" style="margin:0 auto 14px;display:block;opacity:0.25;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
        </svg>
        <p style="font-size:13px;">No ${_sdOrderFilter === 'all' ? '' : _sdOrderFilter + ' '}orders</p>
        <p style="font-size:11px;margin-top:4px;opacity:0.6;">Waiting for incoming orders…</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(order => {
    container.appendChild(buildOrderCard(order));
  });
}

function buildOrderCard(order) {
  const s = SD_STATUS_META[order.status] || SD_STATUS_META.pending;
  const timeStr = order.createdAt?.toDate ? formatTime(order.createdAt.toDate()) : (order.orderDate || '');

  // Dynamic item rows — cross-referenced against productMap
  const itemsHTML = (order.items || []).map(item => {
    // Always try to get the freshest data from productMap
    const live = productMap.get(item.productId);
    const name  = live ? live.name  : (item.name  || `Product (${item.productId || '?'})`);
    const price = live ? live.price : (item.price || 0);
    const image = live ? (live.image || '') : (item.image || '');
    const qty   = item.quantity || item.qty || 1;
    const inStock = live ? (live.stock > 0) : true;

    return `
      <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        ${image
          ? `<img src="${image}" alt="${name}" style="width:34px;height:34px;border-radius:7px;object-fit:cover;flex-shrink:0;">`
          : `<div style="width:34px;height:34px;border-radius:7px;background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.2);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">🍽️</div>`}
        <div style="flex:1;min-width:0;">
          <p style="color:#e5e7eb;font-size:12px;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</p>
          <p style="color:#6b7280;font-size:11px;margin:2px 0 0;">Rp ${price.toLocaleString()} × ${qty}${!inStock && live ? ' · <span style="color:#ef4444;">Out of stock</span>' : ''}</p>
        </div>
        <span style="color:#D4AF37;font-weight:700;font-size:12px;flex-shrink:0;">Rp ${(price * qty).toLocaleString()}</span>
      </div>`;
  }).join('');

  // Quick action buttons based on status
  const actionHTML = buildActionButtons(order);

  const card = document.createElement('div');
  card.id = `sd-order-card-${order.firestoreId}`;
  card.className = 'sd-order-card';
  card.style.cssText = `
    background:linear-gradient(145deg,#0e0e0e,#080808);
    border:1px solid rgba(212,175,55,0.2);
    border-radius:16px;
    padding:16px;
    margin-bottom:12px;
    transition:border-color 0.2s,box-shadow 0.2s;
    animation:sdCardIn 0.35s cubic-bezier(0.34,1.56,0.64,1);
  `;
  card.onmouseenter = () => { card.style.borderColor = 'rgba(212,175,55,0.5)'; card.style.boxShadow = '0 8px 30px rgba(212,175,55,0.08)'; };
  card.onmouseleave = () => { card.style.borderColor = 'rgba(212,175,55,0.2)'; card.style.boxShadow = 'none'; };

  card.innerHTML = `
    <!-- Card Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
      <div>
        <p style="color:#D4AF37;font-weight:700;font-size:12px;font-family:monospace;margin:0;">${order.orderId || order.firestoreId.slice(0,8).toUpperCase()}</p>
        <p style="color:#4b5563;font-size:10px;margin:3px 0 0;">${timeStr}</p>
      </div>
      ${sdStatusBadge(order.status)}
    </div>

    <!-- Buyer Info -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#D4AF37,#b8962e);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:#000;flex-shrink:0;">
        ${(order.fullName || order.buyerName || 'B')[0].toUpperCase()}
      </div>
      <div>
        <p style="color:#e5e7eb;font-size:12px;font-weight:600;margin:0;">${order.fullName || order.buyerName || 'Anonymous'}</p>
        <p style="color:#6b7280;font-size:10px;margin:1px 0 0;">${order.phone || ''} ${order.city ? '· ' + order.city : ''}</p>
      </div>
      ${order.buyerConvId ? `
        <button onclick="sdOpenChat('${order.buyerConvId}','${(order.fullName||order.buyerName||'Buyer').replace(/'/g,"\\'")}');if(window.__chatPanelOpen===false)toggleChatPanel()"
          style="margin-left:auto;padding:4px 10px;background:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.3);border-radius:7px;color:#D4AF37;font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap;">
          💬 Chat
        </button>` : ''}
    </div>

    <!-- Dynamic Item List (cross-referenced from productMap) -->
    <div style="margin-bottom:10px;">${itemsHTML}</div>

    <!-- Custom / Off-menu note -->
    ${order.customNote ? `
      <div style="background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.25);border-radius:8px;padding:8px 12px;margin-bottom:10px;">
        <p style="color:#a78bfa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">📝 Custom Request</p>
        <p style="color:#c4b5fd;font-size:12px;margin:0;">${order.customNote}</p>
      </div>` : ''}

    <!-- Total row -->
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid rgba(212,175,55,0.15);margin-bottom:10px;">
      <span style="color:#9ca3af;font-size:11px;">Total</span>
      <span style="color:#D4AF37;font-weight:700;font-size:15px;">Rp ${(order.total || 0).toLocaleString()}</span>
    </div>

    <!-- Action Buttons -->
    <div style="display:flex;flex-wrap:wrap;gap:7px;">${actionHTML}</div>
  `;

  return card;
}

// ──────────────────────────────────────────────────────────────
//  Build action buttons for an order card
// ──────────────────────────────────────────────────────────────
function buildActionButtons(order) {
  const id = order.firestoreId;
  const convId = order.buyerConvId || '';
  const orderId = order.orderId || id.slice(0,8).toUpperCase();
  let html = '';

  switch (order.status) {
    case 'pending':
      html += sdActionBtn('✅ Accept', 'rgba(74,222,128,0.15)', 'rgba(74,222,128,0.4)', '#4ade80',
        `sdAcceptOrder('${id}','${convId}','${orderId}')`);
      html += sdActionBtn('❌ Reject', 'rgba(239,68,68,0.12)', 'rgba(239,68,68,0.35)', '#ef4444',
        `sdRejectOrder('${id}','${convId}','${orderId}')`);
      break;
    case 'accepted':
    case 'preparing':
      html += sdActionBtn('🔥 Mark as Ready', 'rgba(6,182,212,0.12)', 'rgba(6,182,212,0.4)', '#06b6d4',
        `sdUpdateStatus('${id}','ready','${convId}','${orderId}')`);
      break;
    case 'ready':
      html += sdActionBtn('🚚 Out for Delivery', 'rgba(212,175,55,0.12)', 'rgba(212,175,55,0.4)', '#D4AF37',
        `sdUpdateStatus('${id}','delivering','${convId}','${orderId}')`);
      break;
    case 'delivering':
      html += sdActionBtn('✔ Mark as Done', 'rgba(74,222,128,0.15)', 'rgba(74,222,128,0.4)', '#4ade80',
        `sdUpdateStatus('${id}','completed','${convId}','${orderId}')`);
      break;
    default:
      break;
  }

  // Details always available
  html += sdActionBtn('📋 Details', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.12)', '#9ca3af',
    `openOrderDetail('${id}')`);

  return html;
}

function sdActionBtn(label, bg, border, color, onclick) {
  return `<button onclick="${onclick}" style="padding:6px 13px;background:${bg};border:1px solid ${border};border-radius:8px;color:${color};font-size:11px;font-weight:700;cursor:pointer;transition:all 0.15s;white-space:nowrap;" onmouseover="this.style.filter='brightness(1.15)'" onmouseout="this.style.filter=''">${label}</button>`;
}

// ──────────────────────────────────────────────────────────────
//  Order Actions  (Accept / Reject / Status transition)
// ──────────────────────────────────────────────────────────────

async function sdAcceptOrder(firestoreId, buyerConvId, orderId) {
  await db.collection('orders').doc(firestoreId).update({
    status: 'accepted',
    acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  if (buyerConvId) await sdNotifyBuyer(buyerConvId, orderId,
    `✅ Great news! Your order **${orderId}** has been accepted and is being prepared. We'll update you when it's ready! 🍽️`,
    'order_accepted');
  showSellerToast('Order accepted! Buyer notified.', '#4ade80');
}

async function sdRejectOrder(firestoreId, buyerConvId, orderId) {
  // Show reason modal before rejecting
  sdShowRejectModal(firestoreId, buyerConvId, orderId);
}

function sdShowRejectModal(firestoreId, buyerConvId, orderId) {
  document.getElementById('sd-reject-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'sd-reject-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;animation:sdFadeIn 0.2s ease;';
  modal.innerHTML = `
    <div style="background:linear-gradient(145deg,#111,#0a0a0a);border:1px solid rgba(239,68,68,0.4);border-radius:20px;padding:28px 28px 22px;max-width:420px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,0.8);">
      <h3 style="color:#ef4444;font-size:16px;font-weight:700;margin:0 0 8px;display:flex;align-items:center;gap:8px;">
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        Reject Order?
      </h3>
      <p style="color:#9ca3af;font-size:13px;margin:0 0 6px;">Give the buyer a reason — they will be notified immediately.</p>
      <p style="color:#4b5563;font-size:11px;font-family:monospace;margin:0 0 14px;">${orderId}</p>
      <textarea id="sd-reject-reason" placeholder="e.g. Item is currently unavailable, kitchen cannot fulfil this request…" rows="3"
        style="width:100%;background:#0a0a0a;border:1px solid rgba(239,68,68,0.3);border-radius:10px;color:white;padding:11px 13px;font-size:13px;outline:none;resize:none;margin-bottom:16px;font-family:inherit;"></textarea>
      <div style="display:flex;gap:8px;">
        <button onclick="document.getElementById('sd-reject-modal').remove()"
          style="flex:1;padding:12px;background:rgba(255,255,255,0.05);color:#9ca3af;border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;">
          Back
        </button>
        <button onclick="sdConfirmReject('${firestoreId}','${buyerConvId}','${orderId}')"
          style="flex:1;padding:12px;background:rgba(239,68,68,0.18);color:#ef4444;font-weight:700;border:1px solid rgba(239,68,68,0.4);border-radius:10px;cursor:pointer;font-size:13px;">
          Reject & Notify
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('sd-reject-reason')?.focus();
}

async function sdConfirmReject(firestoreId, buyerConvId, orderId) {
  const reason = document.getElementById('sd-reject-reason')?.value.trim() || '';
  document.getElementById('sd-reject-modal')?.remove();

  await db.collection('orders').doc(firestoreId).update({
    status: 'rejected',
    cancelReason: reason,
    rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  if (buyerConvId) {
    const reasonText = reason ? ` Reason: "${reason}".` : '';
    await sdNotifyBuyer(buyerConvId, orderId,
      `❌ Unfortunately, your order **${orderId}** has been rejected.${reasonText} We apologise for the inconvenience. A full refund will be processed within 1–3 business days. 💳`,
      'order_rejected');
  }
  showSellerToast(`Order ${orderId} rejected. Buyer notified.`, '#ef4444');
}

async function sdUpdateStatus(firestoreId, newStatus, buyerConvId, orderId) {
  await db.collection('orders').doc(firestoreId).update({
    status: newStatus,
    [`${newStatus}At`]: firebase.firestore.FieldValue.serverTimestamp()
  });

  // Buyer notification messages
  const messages = {
    ready:      `🔔 Your order **${orderId}** is READY for pickup / handoff! Our team will deliver it shortly. 🎉`,
    delivering: `🚚 Your order **${orderId}** is on its way! Please be ready to receive it. 📍`,
    completed:  `✅ Your order **${orderId}** has been marked as COMPLETED. Thank you for ordering with us! ⭐`,
  };

  if (buyerConvId && messages[newStatus]) {
    await sdNotifyBuyer(buyerConvId, orderId, messages[newStatus], `order_${newStatus}`);
  }

  const meta = SD_STATUS_META[newStatus];
  showSellerToast(`Status → ${meta?.label || newStatus}. Buyer notified.`, meta?.color || '#D4AF37');
}

// Push a system message + update conversation doc so buyer sees it live
async function sdNotifyBuyer(convId, orderId, text, type = 'system') {
  const now = firebase.firestore.FieldValue.serverTimestamp();
  await db.collection('chats').doc(convId).collection('messages').add({
    text,
    sender: 'seller',
    type,
    orderId,
    createdAt: now
  });
  await db.collection('chats').doc(convId).update({
    lastMessage: text.slice(0, 60),
    lastMessageAt: now,
    unreadBuyer: firebase.firestore.FieldValue.increment(1)
  });
}

// ──────────────────────────────────────────────────────────────
//  Order Filter Tabs  (for #sd-filter-bar)
// ──────────────────────────────────────────────────────────────
function initSDFilterBar() {
  const bar = document.getElementById('sd-filter-bar');
  if (!bar) return;
  const tabs = ['all', 'pending', 'accepted', 'preparing', 'ready', 'delivering', 'completed', 'rejected', 'cancelled'];
  bar.innerHTML = tabs.map(f => {
    const m = SD_STATUS_META[f];
    return `
      <button id="sd-filter-${f}" onclick="setSDFilter('${f}')"
        style="padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid rgba(212,175,55,0.25);background:${f === 'all' ? 'rgba(212,175,55,0.18)' : 'transparent'};color:${f === 'all' ? '#D4AF37' : '#6b7280'};transition:all 0.2s;white-space:nowrap;">
        ${f === 'all' ? 'All' : (m?.label || f)}
      </button>`;
  }).join('');
}

function setSDFilter(f) {
  _sdOrderFilter = f;
  ['all','pending','accepted','preparing','ready','delivering','completed','rejected','cancelled'].forEach(t => {
    const btn = document.getElementById(`sd-filter-${t}`);
    if (!btn) return;
    btn.style.background = t === f ? 'rgba(212,175,55,0.18)' : 'transparent';
    btn.style.color = t === f ? '#D4AF37' : '#6b7280';
  });
  renderOrderFeed();
}

// ──────────────────────────────────────────────────────────────
//  Order Badge
// ──────────────────────────────────────────────────────────────
function updateSDOrderBadge() {
  const pending  = _sdOrders.filter(o => o.status === 'pending').length;
  const badge    = document.getElementById('order-badge');
  const sdBadge  = document.getElementById('sd-order-badge');
  [badge, sdBadge].forEach(el => {
    if (!el) return;
    if (pending > 0) { el.textContent = pending; el.style.display = 'flex'; }
    else { el.style.display = 'none'; }
  });
}

// ──────────────────────────────────────────────────────────────
//  New order toast
// ──────────────────────────────────────────────────────────────
function showNewOrderToast(order) {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed;top:72px;right:20px;z-index:9999;
    background:linear-gradient(135deg,#111,#0d0d0d);
    border:1px solid rgba(74,222,128,0.5);
    border-radius:14px;padding:14px 18px;
    box-shadow:0 12px 40px rgba(0,0,0,0.6),0 0 0 1px rgba(74,222,128,0.1) inset;
    max-width:300px;
    animation:sdSlideIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
  `;
  const name = order.fullName || order.buyerName || 'Someone';
  const total = (order.total || 0).toLocaleString();
  t.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px;">
      <div style="width:34px;height:34px;border-radius:50%;background:rgba(74,222,128,0.15);border:1px solid rgba(74,222,128,0.4);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">🛒</div>
      <div>
        <p style="color:#4ade80;font-weight:700;font-size:13px;margin:0 0 3px;">New Order!</p>
        <p style="color:#e5e7eb;font-size:12px;margin:0 0 2px;font-weight:600;">${name}</p>
        <p style="color:#6b7280;font-size:11px;margin:0;">Rp ${total} · ${order.orderId || ''}</p>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;color:#4b5563;font-size:16px;cursor:pointer;margin-left:auto;line-height:1;">✕</button>
    </div>`;
  document.body.appendChild(t);
  setTimeout(() => t?.remove(), 6000);
}

// ============================================================
//  4.  DECOUPLED BUYER CHAT (Seller View)
//      Shows raw buyer text — not filtered to catalogue
// ============================================================
let _sdActiveChatId = null;
let _sdChatUnsubscribe = null;
let _sdTypingUnsubscribe = null;

// Override / extend openConversation to integrate SD features
const _originalOpenConversation = typeof openConversation === 'function' ? openConversation : null;

function sdOpenChat(convId, buyerName) {
  // Use the existing openConversation if available (it handles the UI tabs)
  if (typeof openConversation === 'function') {
    openConversation(convId, buyerName);
  }
  _sdActiveChatId = convId;
  startTypingListener(convId);
}

// ──────────────────────────────────────────────────────────────
//  Typing Indicator Listener
//  Buyer app writes: chats/{convId}.buyerTyping = true/false
// ──────────────────────────────────────────────────────────────
function startTypingListener(convId) {
  if (_sdTypingUnsubscribe) _sdTypingUnsubscribe();
  _sdTypingUnsubscribe = db.collection('chats').doc(convId).onSnapshot(snap => {
    const data = snap.data();
    const isTyping = data?.buyerTyping === true;
    renderTypingIndicator(isTyping, data?.buyerName || 'Buyer');
  });
}

function renderTypingIndicator(isTyping, name) {
  let indicator = document.getElementById('sd-typing-indicator');
  if (!isTyping) { indicator?.remove(); return; }
  if (indicator) return; // already visible

  const container = document.getElementById('chat-messages');
  if (!container) return;

  indicator = document.createElement('div');
  indicator.id = 'sd-typing-indicator';
  indicator.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;animation:sdFadeIn 0.3s ease;';
  indicator.innerHTML = `
    <div style="background:#1a1a1a;border:1px solid rgba(255,255,255,0.08);border-radius:16px;border-bottom-left-radius:4px;padding:10px 14px;display:flex;align-items:center;gap:6px;">
      <span style="color:#6b7280;font-size:11px;">${name} is typing</span>
      <div style="display:flex;gap:3px;">
        <span style="width:5px;height:5px;border-radius:50%;background:#6b7280;animation:sdDot 1s infinite 0s;display:block;"></span>
        <span style="width:5px;height:5px;border-radius:50%;background:#6b7280;animation:sdDot 1s infinite 0.2s;display:block;"></span>
        <span style="width:5px;height:5px;border-radius:50%;background:#6b7280;animation:sdDot 1s infinite 0.4s;display:block;"></span>
      </div>
    </div>`;
  container.appendChild(indicator);
  container.scrollTop = container.scrollHeight;
}

// ──────────────────────────────────────────────────────────────
//  Off-menu / custom request detection
//  Any message without a matching product is shown raw with a
//  purple "Custom Request" label — decoupled from catalogue.
// ──────────────────────────────────────────────────────────────
function isOffMenuRequest(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const keywords = ['extra', 'no ', 'without', 'add ', 'less ', 'more ', 'spicy', 'sweet', 'mild', 'hold the', 'custom', 'allergic', 'vegan', 'half'];
  const matchedKeyword = keywords.some(k => lower.includes(k));
  // Also flag if no product in catalog matches
  const hasProductMatch = Array.from(productMap.values()).some(p => {
    const pName = p.name.toLowerCase();
    return lower.includes(pName) || pName.split(' ').some(w => w.length > 3 && lower.includes(w));
  });
  return matchedKeyword || (!hasProductMatch && lower.length > 8);
}

// Patch the chat message rendering to highlight off-menu requests
// (This patches into the existing onSnapshot callback in script.js)
const _origOpenConvListener = null;

// We expose a post-render hook that script.js can call, or we intercept via
// a MutationObserver on #chat-messages to decorate buyer bubbles.
const _chatMutationObserver = new MutationObserver(() => {
  decorateOffMenuMessages();
});

function decorateOffMenuMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  // Look for buyer message bubbles that haven't been decorated yet
  container.querySelectorAll('.msg-row-buyer:not([data-sd-checked])').forEach(row => {
    row.setAttribute('data-sd-checked', '1');
    const bubble = row.querySelector('.msg-bubble');
    const textEl = bubble?.querySelector('p');
    if (!textEl) return;
    const text = textEl.textContent;
    if (isOffMenuRequest(text)) {
      // Add off-menu badge inside the bubble
      if (!bubble.querySelector('.sd-offmenu-badge')) {
        const badge = document.createElement('div');
        badge.className = 'sd-offmenu-badge';
        badge.style.cssText = 'margin-top:6px;display:flex;align-items:center;gap:5px;';
        badge.innerHTML = `
          <span style="font-size:10px;background:rgba(139,92,246,0.2);border:1px solid rgba(139,92,246,0.4);border-radius:6px;padding:2px 7px;color:#a78bfa;font-weight:700;letter-spacing:0.5px;">
            📝 Custom Request
          </span>`;
        bubble.appendChild(badge);
        // Also slightly tint the bubble
        bubble.style.borderLeft = '3px solid rgba(139,92,246,0.5)';
      }
    }
  });
}

function attachChatObserver() {
  const container = document.getElementById('chat-messages');
  if (!container || container.hasAttribute('data-sd-observed')) return;
  container.setAttribute('data-sd-observed', '1');
  _chatMutationObserver.observe(container, { childList: true, subtree: false });
}

// ============================================================
//  5.  INJECT SD-SPECIFIC HTML INTO EXISTING DOM
//  (Adds the SD order list + filter bar + analytics strip)
// ============================================================
function injectSDUI() {
  // ── Replace the existing order-list + order-filters with SD versions
  const existingFilters = document.getElementById('order-filters');
  const existingList    = document.getElementById('order-list');

  if (existingFilters) {
    existingFilters.id = 'sd-filter-bar';
    existingFilters.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-bottom:1px solid var(--gold-border);flex-shrink:0;overflow-x:auto;';
  }
  if (existingList) {
    existingList.id = 'sd-order-list';
  }

  // ── Inject analytics strip above the orders panel header
  const ordersHeader = document.querySelector('.orders-panel-header');
  if (ordersHeader && !document.getElementById('sd-analytics-strip')) {
    const strip = document.createElement('div');
    strip.id = 'sd-analytics-strip';
    strip.style.cssText = 'display:flex;gap:0;border-bottom:1px solid var(--gold-border);flex-shrink:0;';
    strip.innerHTML = `
      <div class="sd-stat" id="sd-stat-pending">
        <span class="sd-stat-val" id="sd-stat-val-pending">0</span>
        <span class="sd-stat-lbl">Pending</span>
      </div>
      <div class="sd-stat" id="sd-stat-active" style="border-left:1px solid var(--gold-border);border-right:1px solid var(--gold-border);">
        <span class="sd-stat-val" id="sd-stat-val-active" style="color:#3b82f6;">0</span>
        <span class="sd-stat-lbl">Active</span>
      </div>
      <div class="sd-stat" id="sd-stat-done">
        <span class="sd-stat-val" id="sd-stat-val-done" style="color:#4ade80;">0</span>
        <span class="sd-stat-lbl">Done Today</span>
      </div>`;
    ordersHeader.after(strip);
  }

  // ── Inject CSS for SD-specific styles
  if (!document.getElementById('sd-styles')) {
    const style = document.createElement('style');
    style.id = 'sd-styles';
    style.textContent = `
      @keyframes sdCardIn {
        from { opacity:0; transform:translateY(12px) scale(0.97); }
        to   { opacity:1; transform:translateY(0) scale(1); }
      }
      @keyframes sdSlideIn {
        from { opacity:0; transform:translateX(20px); }
        to   { opacity:1; transform:translateX(0); }
      }
      @keyframes sdFadeIn {
        from { opacity:0; } to { opacity:1; }
      }
      @keyframes sdDot {
        0%,80%,100% { transform:scale(0.6); opacity:0.4; }
        40%          { transform:scale(1);   opacity:1;   }
      }
      .sd-stat {
        flex:1; display:flex; flex-direction:column; align-items:center;
        justify-content:center; padding:10px 6px;
        background:rgba(0,0,0,0.2);
      }
      .sd-stat-val {
        font-size:22px; font-weight:700; color:#D4AF37;
        font-family:'Orbitron',sans-serif; line-height:1;
      }
      .sd-stat-lbl {
        font-size:9px; text-transform:uppercase; letter-spacing:1px;
        color:#4b5563; margin-top:3px; font-weight:600;
      }
      #sd-filter-bar::-webkit-scrollbar { height:3px; }
      #sd-filter-bar::-webkit-scrollbar-thumb { background:#333; border-radius:3px; }
    `;
    document.head.appendChild(style);
  }
}

// ── Update analytics strip counters
function updateSDAnalytics() {
  const activeStatuses = new Set(['accepted','preparing','ready','delivering']);
  const today = new Date(); today.setHours(0,0,0,0);

  const pending = _sdOrders.filter(o => o.status === 'pending').length;
  const active  = _sdOrders.filter(o => activeStatuses.has(o.status)).length;
  const done    = _sdOrders.filter(o => {
    if (o.status !== 'completed') return false;
    const d = o.createdAt?.toDate?.();
    return d && d >= today;
  }).length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('sd-stat-val-pending', pending);
  set('sd-stat-val-active',  active);
  set('sd-stat-val-done',    done);
}

// (analytics are updated from startOrderFeed's onSnapshot directly — no conflict with script.js)

// ============================================================
//  6.  BOOTSTRAP
// ============================================================
function initSellerDashboard() {
  injectSDUI();
  initSDFilterBar();
  startOrderFeed();

  // Intercept openConversation to attach SD features
  const _baseOpen = window.openConversation;
  window.openConversation = function(convId, buyerName) {
    _baseOpen?.(convId, buyerName);
    _sdActiveChatId = convId;
    startTypingListener(convId);
    // Attach observer a tick later (after DOM settles)
    setTimeout(attachChatObserver, 100);
  };

  // Also watch for chat panel opening to attach observer
  document.addEventListener('click', e => {
    if (e.target.closest('.conv-item')) {
      setTimeout(attachChatObserver, 200);
    }
  });

  console.log('[SD] SellerDashboard real-time feed initialised ✅');

  // ── Pill input: dim send button when empty, brighten when has text
  const chatInput = document.getElementById('seller-chat-input');
  const sendBtn   = document.getElementById('chat-send-btn');
  function syncSendBtn() {
    if (!chatInput || !sendBtn) return;
    const hasText = chatInput.value.trim().length > 0;
    sendBtn.style.opacity = hasText ? '1' : '0.45';
    sendBtn.style.transform = hasText ? '' : 'scale(0.92)';
  }
  chatInput?.addEventListener('input', syncSendBtn);
  syncSendBtn(); // initialise

  // ── Auto-scroll #chat-messages to bottom whenever children change
  const _scrollObserver = new MutationObserver(() => {
    const msgs = document.getElementById('chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  });
  function attachScrollObserver() {
    const msgs = document.getElementById('chat-messages');
    if (msgs && !msgs.hasAttribute('data-scroll-observed')) {
      msgs.setAttribute('data-scroll-observed', '1');
      _scrollObserver.observe(msgs, { childList: true });
    }
  }
  attachScrollObserver();
  // Re-attach when chat window opens (conversation switch clears DOM)
  document.addEventListener('click', e => {
    if (e.target.closest('.conv-item') || e.target.closest('.back-btn')) {
      setTimeout(attachScrollObserver, 150);
    }
  });
}

// Run after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSellerDashboard);
} else {
  // DOMContentLoaded already fired (script loaded deferred/async)
  setTimeout(initSellerDashboard, 0);
}
