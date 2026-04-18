const firebaseConfig = {
  apiKey: "AIzaSyCIYc8Epfu3jmrewyRaVGc4ISm7qKxG03k",
  authDomain: "localluxury-cb0d7.firebaseapp.com",
  projectId: "localluxury-cb0d7",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// =============================================
// PRODUCT MANAGEMENT
// =============================================
let allProducts = []; // cached for recommendation engine

async function addProduct() {
  const name = document.getElementById("name").value.trim();
  const price = Number(document.getElementById("price").value);
  const stock = Number(document.getElementById("stock").value);
  const tags = document.getElementById("tags").value.split(",").map(t => t.trim()).filter(Boolean);
  if (!name || !price) return alert("Complete the form.");
  if (price <= 0) return alert("Price must be a positive number.");
  if (stock < 0) return alert("Stock cannot be negative.");
  await db.collection("products").add({
    name, price, tags, stock: stock || 0, description: "",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  document.getElementById("name").value = "";
  document.getElementById("price").value = "";
  document.getElementById("stock").value = "";
  document.getElementById("tags").value = "";
}

// ── EDIT PRODUCT ──────────────────────────────────────────────────────────────
function openEditModal(id) {
  const product = allProducts.find(p => p.id === id);
  if (!product) return;

  document.getElementById('edit-product-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'edit-product-modal';
  modal.className = 'edit-modal-overlay';
  modal.innerHTML = `
    <div class="edit-modal-card" role="dialog" aria-modal="true" aria-label="Edit Product">
      <div class="edit-modal-header">
        <div class="edit-modal-title">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          <span>Edit Product</span>
        </div>
        <button class="edit-modal-close" onclick="closeEditModal()" aria-label="Close">✕</button>
      </div>

      <div class="edit-modal-body">
        <div class="edit-form-group">
          <label for="edit-name">Product Name <span style="color:#ef4444">*</span></label>
          <input id="edit-name" type="text" placeholder="e.g. Nasi Goreng Spesial"
            value="${product.name.replace(/"/g, '&quot;')}">
        </div>

        <div class="edit-form-row">
          <div class="edit-form-group">
            <label for="edit-price">Price (Rp) <span style="color:#ef4444">*</span></label>
            <input id="edit-price" type="number" min="1" placeholder="e.g. 25000"
              value="${product.price}">
          </div>
          <div class="edit-form-group">
            <label for="edit-stock">Stock</label>
            <input id="edit-stock" type="number" min="0" placeholder="e.g. 10"
              value="${product.stock ?? 0}">
          </div>
        </div>

        <div class="edit-form-group">
          <label for="edit-tags">Tags <span style="color:#6b7280;font-weight:400;font-size:11px;">(comma separated)</span></label>
          <input id="edit-tags" type="text" placeholder="e.g. spicy, chicken, quick"
            value="${(product.tags || []).join(', ').replace(/"/g, '&quot;')}">
        </div>

        <div class="edit-form-group">
          <label for="edit-description">Description <span style="color:#6b7280;font-weight:400;font-size:11px;">(optional)</span></label>
          <textarea id="edit-description" rows="3"
            placeholder="Short description visible to buyers...">${product.description || ''}</textarea>
        </div>

        <div id="edit-error-msg" style="display:none;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:10px 14px;color:#ef4444;font-size:13px;margin-top:4px;"></div>
      </div>

      <div class="edit-modal-footer">
        <button class="edit-btn-cancel" onclick="closeEditModal()">Cancel</button>
        <button class="edit-btn-save" id="edit-save-btn" onclick="submitEditProduct('${id}')">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
          Save Changes
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeEditModal(); });
  setTimeout(() => document.getElementById('edit-name')?.focus(), 50);
}

function closeEditModal() {
  document.getElementById('edit-product-modal')?.remove();
}

async function submitEditProduct(id) {
  const nameVal  = document.getElementById('edit-name')?.value.trim();
  const priceVal = Number(document.getElementById('edit-price')?.value);
  const stockVal = parseInt(document.getElementById('edit-stock')?.value ?? '0', 10);
  const tagsVal  = document.getElementById('edit-tags')?.value
    .split(',').map(t => t.trim()).filter(Boolean);
  const descVal  = document.getElementById('edit-description')?.value.trim();

  const errEl = document.getElementById('edit-error-msg');
  const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };

  // Validation
  if (!nameVal) return showErr('Product name is required.');
  if (!priceVal || priceVal <= 0 || isNaN(priceVal))
    return showErr('Price must be a positive number.');
  if (isNaN(stockVal) || stockVal < 0)
    return showErr('Stock cannot be negative.');

  // Disable button to prevent double-submit
  const saveBtn = document.getElementById('edit-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    await db.collection('products').doc(id).update({
      name: nameVal,
      price: priceVal,
      stock: stockVal,
      tags: tagsVal,
      description: descVal,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    closeEditModal();
    showSellerToast('✅ Product updated successfully!');
  } catch (err) {
    console.error('Edit product error:', err);
    showErr('Failed to save. Please check your connection and try again.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Save Changes'; }
  }
}

async function deleteProduct(id) {
  if (!confirm("Remove this product?")) return;
  await db.collection("products").doc(id).delete();
}

async function updateStock(id, delta) {
  const doc = await db.collection("products").doc(id).get();
  const current = doc.data().stock || 0;
  const newStock = Math.max(0, current + delta);
  await db.collection("products").doc(id).update({ stock: newStock });
}

async function setStock(id) {
  const input = document.getElementById(`stock-input-${id}`);
  const val = parseInt(input.value);
  if (isNaN(val) || val < 0) return alert("Enter a valid stock number.");
  await db.collection("products").doc(id).update({ stock: val });
}

db.collection("products").orderBy("createdAt", "desc").onSnapshot(snapshot => {
  allProducts = []; // FIX GAP 3: keep cache fresh for recommendation engine
  const list = document.getElementById("productList");
  list.innerHTML = "";
  if (snapshot.empty) {
    list.innerHTML = `<p style="opacity:.6;padding:20px;">No products yet</p>`;
    return;
  }
  snapshot.forEach(doc => {
    allProducts.push({ id: doc.id, ...doc.data() });
    const p = doc.data();
    const stock = p.stock ?? 0;
    const stockColor = stock === 0 ? '#ef4444' : stock <= 5 ? '#f59e0b' : '#4ade80';
    const stockLabel = stock === 0 ? 'Out of Stock' : stock <= 5 ? `Low Stock: ${stock}` : `In Stock: ${stock}`;
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <button class="delete-btn" onclick="deleteProduct('${doc.id}')" title="Delete product">✕</button>
      <button class="edit-btn" onclick="openEditModal('${doc.id}')" title="Edit product">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <h3 class="product-name">${p.name}</h3>
      <p class="product-price">Rp ${p.price.toLocaleString()}</p>
      <div class="tag-row" style="margin-bottom:10px;">
        ${(p.tags || []).map(tag => `<span class="tag">${tag}</span>`).join("")}
      </div>
      <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Stock</span>
          <span style="font-size:12px;font-weight:700;color:${stockColor};">${stockLabel}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          <button onclick="updateStock('${doc.id}',-1)" style="width:28px;height:28px;background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);border-radius:6px;color:#ef4444;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>
          <span style="flex:1;text-align:center;font-size:18px;font-weight:700;color:${stockColor};">${stock}</span>
          <button onclick="updateStock('${doc.id}',1)" style="width:28px;height:28px;background:rgba(74,222,128,0.2);border:1px solid rgba(74,222,128,0.4);border-radius:6px;color:#4ade80;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>
        </div>
        <div style="display:flex;gap:6px;">
          <input id="stock-input-${doc.id}" type="number" min="0" placeholder="Set exact stock" value="${stock}" style="flex:1;background:#000;border:1px solid rgba(212,175,55,0.2);border-radius:6px;color:white;padding:5px 8px;font-size:12px;outline:none;">
          <button onclick="setStock('${doc.id}')" style="padding:5px 10px;background:rgba(212,175,55,0.2);border:1px solid rgba(212,175,55,0.4);border-radius:6px;color:#D4AF37;font-size:11px;font-weight:600;cursor:pointer;">Set</button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
});

// =============================================
// ORDERS PANEL
// =============================================
const ORDER_STATUSES = ['pending', 'preparing', 'ready', 'delivering', 'completed', 'cancelled'];

const STATUS_META = {
  pending:    { text: 'Pending',    color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  border: 'rgba(245,158,11,0.4)'  },
  preparing:  { text: 'Preparing',  color: '#3b82f6', bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.4)'  },
  ready:      { text: 'Ready',      color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)',  border: 'rgba(139,92,246,0.4)'  },
  delivering: { text: 'Delivering', color: '#D4AF37', bg: 'rgba(212,175,55,0.15)',  border: 'rgba(212,175,55,0.4)'  },
  completed:  { text: 'Completed',  color: '#4ade80', bg: 'rgba(74,222,128,0.15)',  border: 'rgba(74,222,128,0.3)'  },
  cancelled:  { text: 'Cancelled',  color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.3)'   },
};

function statusBadge(status) {
  const s = STATUS_META[status] || STATUS_META.pending;
  return `<span style="background:${s.bg};color:${s.color};font-size:11px;padding:3px 8px;border-radius:20px;border:1px solid ${s.border};font-weight:600;white-space:nowrap;">${s.text}</span>`;
}

const NEXT_STATUS = {
  pending: 'preparing', preparing: 'ready', ready: 'delivering', delivering: 'completed'
};

let activeOrderFilter = 'all';

function initOrdersPanel() {
  const filtersEl = document.getElementById('order-filters');
  if (!filtersEl) return;
  const filters = ['all', 'pending', 'preparing', 'ready', 'delivering', 'completed', 'cancelled'];
  filtersEl.innerHTML = filters.map(f => `
    <button id="filter-${f}" onclick="setOrderFilter('${f}')"
      style="padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid rgba(212,175,55,0.3);background:${f === 'all' ? 'rgba(212,175,55,0.2)' : 'transparent'};color:${f === 'all' ? '#D4AF37' : '#9ca3af'};transition:all 0.2s;">
      ${f.charAt(0).toUpperCase() + f.slice(1)}
    </button>`).join('');
  listenOrders();
}

function setOrderFilter(filter) {
  activeOrderFilter = filter;
  ['all', 'pending', 'preparing', 'ready', 'delivering', 'completed', 'cancelled'].forEach(f => {
    const btn = document.getElementById(`filter-${f}`);
    if (!btn) return;
    btn.style.background = f === filter ? 'rgba(212,175,55,0.2)' : 'transparent';
    btn.style.color = f === filter ? '#D4AF37' : '#9ca3af';
  });
  renderOrders();
}

let _allOrders = [];

function listenOrders() {
  db.collection('orders').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
    _allOrders = [];
    snapshot.forEach(doc => _allOrders.push({ firestoreId: doc.id, ...doc.data() }));
    renderOrders();
    updateOrderBadge();
  });
}

function renderOrders() {
  const container = document.getElementById('order-list');
  if (!container) return;

  const filtered = activeOrderFilter === 'all'
    ? _allOrders
    : _allOrders.filter(o => o.status === activeOrderFilter);

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:48px 20px;color:#4b5563;">
      <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="margin:0 auto 12px;opacity:0.3;display:block;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
      </svg>
      <p style="font-size:13px;">No ${activeOrderFilter === 'all' ? '' : activeOrderFilter} orders yet</p>
    </div>`;
    return;
  }

  container.innerHTML = filtered.map(order => {
    const nextStatus = NEXT_STATUS[order.status];
    const nextMeta = nextStatus ? STATUS_META[nextStatus] : null;
    const itemSummary = (order.items || []).slice(0, 2).map(i => `${i.name} ×${i.quantity}`).join(', ')
      + ((order.items || []).length > 2 ? ` +${order.items.length - 2} more` : '');
    const timeStr = order.createdAt?.toDate ? formatTime(order.createdAt.toDate()) : '';

    return `<div style="background:rgba(0,0,0,0.3);border:1px solid rgba(212,175,55,0.2);border-radius:12px;padding:14px;margin-bottom:10px;transition:border-color 0.2s;" onmouseover="this.style.borderColor='rgba(212,175,55,0.5)'" onmouseout="this.style.borderColor='rgba(212,175,55,0.2)'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div>
          <p style="color:#D4AF37;font-weight:700;font-size:12px;font-family:monospace;margin:0;">${order.orderId}</p>
          <p style="color:#6b7280;font-size:11px;margin:2px 0 0;">${timeStr}</p>
        </div>
        ${statusBadge(order.status)}
      </div>
      <p style="color:#e5e7eb;font-size:12px;margin-bottom:4px;font-weight:500;">${order.fullName} · ${order.phone}</p>
      <p style="color:#9ca3af;font-size:11px;margin-bottom:8px;">${itemSummary}</p>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#D4AF37;font-weight:700;font-size:14px;">Rp ${(order.total || 0).toLocaleString()}</span>
        <div style="display:flex;gap:6px;">
          ${order.buyerConvId ? `
          <button onclick="openConversation('${order.buyerConvId}','${(order.fullName||'Buyer').replace(/'/g,"\\'")}');toggleChatPanel()"
            style="padding:5px 10px;background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.3);border-radius:7px;color:#D4AF37;font-size:11px;cursor:pointer;"
            title="Open buyer chat">
            💬 Chat
          </button>` : ''}
          <button onclick="openOrderDetail('${order.firestoreId}')"
            style="padding:5px 10px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:7px;color:#9ca3af;font-size:11px;cursor:pointer;">
            Details
          </button>
          ${nextMeta ? `
          <button onclick="advanceOrderStatus('${order.firestoreId}','${nextStatus}')"
            style="padding:5px 12px;background:${nextMeta.bg};border:1px solid ${nextMeta.border};border-radius:7px;color:${nextMeta.color};font-size:11px;font-weight:600;cursor:pointer;">
            → ${nextMeta.text}
          </button>` : ''}
          ${order.status === 'pending' ? `
          <button onclick="promptCancelOrder('${order.firestoreId}','${order.buyerConvId||''}','${order.orderId}')"
            style="padding:5px 10px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:7px;color:#ef4444;font-size:11px;cursor:pointer;">
            Cancel
          </button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function updateOrderBadge() {
  const pendingCount = _allOrders.filter(o => o.status === 'pending').length;
  const badge = document.getElementById('order-badge');
  if (!badge) return;
  if (pendingCount > 0) { badge.textContent = pendingCount; badge.style.display = 'flex'; }
  else { badge.style.display = 'none'; }
}

async function advanceOrderStatus(firestoreId, newStatus) {
  await db.collection('orders').doc(firestoreId).update({ status: newStatus });
}

// FIX GAP 4: Cancel with reason + refund message to buyer chat
function promptCancelOrder(firestoreId, buyerConvId, orderId) {
  const existing = document.getElementById('cancel-reason-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'cancel-reason-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#0d0d0d;border:1px solid rgba(239,68,68,0.4);border-radius:16px;padding:28px;max-width:420px;width:100%;">
      <h3 style="color:#ef4444;font-weight:700;font-size:16px;margin:0 0 6px;">Cancel Order?</h3>
      <p style="color:#9ca3af;font-size:13px;margin:0 0 16px;">
        Provide a reason so the buyer understands. They will receive a refund notification.
      </p>
      <p style="color:#6b7280;font-size:11px;font-family:monospace;margin:0 0 14px;">${orderId}</p>
      <textarea id="cancel-reason-input" placeholder="e.g. Item out of stock, kitchen is closed, etc." rows="3"
        style="width:100%;background:#111;border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:white;padding:10px 12px;font-size:13px;outline:none;resize:none;margin-bottom:16px;"></textarea>
      <div style="display:flex;gap:8px;">
        <button onclick="document.getElementById('cancel-reason-modal').remove()"
          style="flex:1;padding:11px;background:rgba(255,255,255,0.06);color:#9ca3af;border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;font-size:13px;">
          Back
        </button>
        <button onclick="confirmCancelOrder('${firestoreId}','${buyerConvId}','${orderId}')"
          style="flex:1;padding:11px;background:rgba(239,68,68,0.2);color:#ef4444;font-weight:700;border:1px solid rgba(239,68,68,0.4);border-radius:10px;cursor:pointer;font-size:13px;">
          Cancel & Notify Buyer
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('cancel-reason-input').focus();
}

async function confirmCancelOrder(firestoreId, buyerConvId, orderId) {
  const reason = document.getElementById('cancel-reason-input')?.value.trim() || '';
  document.getElementById('cancel-reason-modal')?.remove();

  // 1. Update order status in Firestore
  await db.collection('orders').doc(firestoreId).update({
    status: 'cancelled',
    cancelReason: reason,
    cancelledAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // 2. Send refund notification message to buyer chat
  if (buyerConvId) {
    const reasonText = reason ? ` Reason: "${reason}".` : '';
    const now = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('chats').doc(buyerConvId).collection('messages').add({
      text: `❌ Your order ${orderId} has been cancelled.${reasonText} A full refund will be processed within 1–3 business days. We apologise for the inconvenience. 💳`,
      sender: 'seller',
      type: 'order_cancelled',
      orderId,
      cancelReason: reason,
      createdAt: now
    });
    await db.collection('chats').doc(buyerConvId).update({
      lastMessage: `Order ${orderId} cancelled`,
      lastMessageAt: now,
      unreadBuyer: firebase.firestore.FieldValue.increment(1)
    });
  }

  showSellerToast(`Order ${orderId} cancelled. Buyer has been notified.`, '#ef4444');
}

function showSellerToast(message, color = '#D4AF37') {
  const existing = document.getElementById('seller-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'seller-toast';
  t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:#111;border:1px solid ${color}66;border-radius:10px;padding:10px 20px;color:${color};font-weight:600;font-size:13px;box-shadow:0 8px 30px rgba(0,0,0,0.6);white-space:nowrap;animation:fadeInUp 0.3s ease;`;
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t?.remove(), 4000);
}

function openOrderDetail(firestoreId) {
  const order = _allOrders.find(o => o.firestoreId === firestoreId);
  if (!order) return;

  const pLabel = { cash: 'Cash on Delivery', transfer: 'Bank Transfer', ewallet: 'E-Wallet' }[order.paymentMethod] || order.paymentMethod;
  const itemRows = (order.items || []).map(i =>
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div><p style="color:#e5e7eb;font-size:13px;margin:0;">${i.name}</p><p style="color:#9ca3af;font-size:11px;margin:2px 0 0;">Rp ${i.price.toLocaleString()} × ${i.quantity}</p></div>
      <span style="color:#D4AF37;font-weight:600;font-size:13px;">Rp ${(i.price * i.quantity).toLocaleString()}</span>
    </div>`
  ).join('');

  const statusOptions = ORDER_STATUSES.map(s => {
    const m = STATUS_META[s];
    return `<button onclick="advanceOrderStatus('${firestoreId}','${s}');closeOrderDetail()"
      style="padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${m.border};background:${order.status === s ? m.bg : 'transparent'};color:${m.color};transition:all 0.2s;">
      ${m.text}
    </button>`;
  }).join('');

  // FIX GAP 7: Map location row if available
  const locationRow = order.location
    ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <span style="color:#9ca3af;flex-shrink:0;">Location</span>
        <a href="https://www.google.com/maps?q=${order.location.lat},${order.location.lng}" target="_blank"
          style="color:#D4AF37;font-size:12px;text-decoration:none;">
          📍 ${order.location.lat.toFixed(5)}, ${order.location.lng.toFixed(5)} ↗
        </a>
      </div>`
    : '';

  // FIX GAP 4: Show cancel reason if cancelled
  const cancelReasonRow = (order.status === 'cancelled' && order.cancelReason)
    ? `<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:10px 12px;margin-bottom:14px;">
        <p style="color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Cancel Reason</p>
        <p style="color:#ef4444;font-size:13px;margin:0;">${order.cancelReason}</p>
      </div>`
    : '';

  // FIX GAP 1: "Open Chat" button if buyerConvId exists
  const chatBtn = order.buyerConvId
    ? `<button onclick="closeOrderDetail();openConversation('${order.buyerConvId}','${(order.fullName||'Buyer').replace(/'/g,"\\'")}');if(window.innerWidth<1200)toggleChatPanel()"
        style="width:100%;margin-top:12px;padding:10px;background:rgba(212,175,55,0.15);border:1px solid rgba(212,175,55,0.3);border-radius:10px;color:#D4AF37;font-weight:600;font-size:13px;cursor:pointer;">
        💬 Open Buyer Chat
      </button>`
    : '';

  const modal = document.createElement('div');
  modal.id = 'order-detail-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:300;display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#0a0a0a;border:1px solid rgba(212,175,55,0.3);border-radius:20px;max-width:520px;width:100%;max-height:85vh;overflow-y:auto;">
      <div style="padding:20px 24px;border-bottom:1px solid rgba(212,175,55,0.2);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#0a0a0a;z-index:1;">
        <div>
          <p style="color:#D4AF37;font-family:monospace;font-weight:700;font-size:15px;margin:0;">${order.orderId}</p>
          <p style="color:#6b7280;font-size:11px;margin:3px 0 0;">${order.createdAt?.toDate ? new Date(order.createdAt.toDate()).toLocaleString() : order.orderDate}</p>
        </div>
        <button onclick="closeOrderDetail()" style="background:none;border:none;color:#6b7280;font-size:22px;cursor:pointer;line-height:1;">✕</button>
      </div>

      <div style="padding:20px 24px;">

        <!-- Cancel reason (if applicable) -->
        ${cancelReasonRow}

        <!-- Status control -->
        <div style="margin-bottom:20px;">
          <p style="color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Update Status</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">${statusOptions}</div>
        </div>

        <!-- Customer -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px;margin-bottom:14px;">
          <p style="color:#D4AF37;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Customer</p>
          <div style="display:grid;gap:6px;font-size:13px;">
            <div style="display:flex;justify-content:space-between;"><span style="color:#9ca3af;">Name</span><span style="color:#e5e7eb;">${order.fullName}</span></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:#9ca3af;">Phone</span><a href="tel:${order.phone}" style="color:#D4AF37;">${order.phone}</a></div>
            <div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:#9ca3af;flex-shrink:0;">Address</span><span style="color:#e5e7eb;text-align:right;">${order.address}, ${order.city} ${order.postalCode}</span></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:#9ca3af;">Payment</span><span style="color:#e5e7eb;">${pLabel}</span></div>
            ${locationRow}
          </div>
          ${chatBtn}
        </div>

        <!-- Items -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px;margin-bottom:14px;">
          <p style="color:#D4AF37;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Items</p>
          ${itemRows}
        </div>

        <!-- Totals -->
        <div style="background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.2);border-radius:10px;padding:14px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;"><span style="color:#9ca3af;">Subtotal</span><span style="color:#e5e7eb;">Rp ${(order.subtotal||0).toLocaleString()}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;"><span style="color:#9ca3af;">Delivery</span><span style="color:#e5e7eb;">Rp ${(order.deliveryFee||0).toLocaleString()}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:10px;"><span style="color:#9ca3af;">Tax (10%)</span><span style="color:#e5e7eb;">Rp ${(order.tax||0).toLocaleString()}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:700;padding-top:10px;border-top:1px solid rgba(212,175,55,0.3);"><span style="color:#fff;">Total</span><span style="color:#D4AF37;">Rp ${(order.total||0).toLocaleString()}</span></div>
        </div>

      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeOrderDetail(); });
}

function closeOrderDetail() {
  document.getElementById('order-detail-modal')?.remove();
}

// =============================================
// PRODUCT RECOMMENDATION ENGINE  (FIX GAP 3)
// =============================================
function getRecommendations(buyerMessage) {
  const lower = buyerMessage.toLowerCase();
  const inStock = allProducts.filter(p => (p.stock ?? 0) > 0);
  if (!inStock.length) return [];

  const scored = inStock.map(p => {
    let score = 0;
    const nameL = p.name.toLowerCase();
    const tags = (p.tags || []).map(t => t.toLowerCase());

    if (lower.includes('sweet') || lower.includes('manis'))      { if (tags.includes('sweet') || tags.includes('dessert')) score += 3; }
    if (lower.includes('spicy') || lower.includes('pedas'))      { if (tags.includes('spicy'))      score += 3; }
    if (lower.includes('healthy') || lower.includes('vegetarian')){ if (tags.includes('healthy') || tags.includes('vegetarian')) score += 3; }
    if (lower.includes('cheap') || lower.includes('murah'))      { if (p.price < 20000)             score += 3; }
    if (lower.includes('luxury') || lower.includes('premium'))   { if (tags.includes('luxury'))     score += 3; }
    if (lower.includes('quick') || lower.includes('fast') || lower.includes('cepat')) { if (tags.includes('quick')) score += 3; }
    if (lower.includes('filling') || lower.includes('kenyang'))  { if (tags.includes('filling'))    score += 3; }
    if (lower.includes('chicken') || lower.includes('ayam'))     { if (nameL.includes('ayam') || nameL.includes('sate') || nameL.includes('soto')) score += 3; }
    if (lower.includes('noodle') || lower.includes('mie'))       { if (nameL.includes('mie') || nameL.includes('bakso')) score += 3; }
    if (lower.includes('rice') || lower.includes('nasi'))        { if (nameL.includes('nasi'))      score += 3; }
    // partial name match
    p.name.toLowerCase().split(' ').forEach(w => { if (lower.includes(w) && w.length > 3) score += 2; });

    return { ...p, score };
  });

  return scored.filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
}

function renderRecommendationPanel(recs) {
  document.getElementById('rec-panel')?.remove();
  if (!recs.length) return;

  const container = document.getElementById('chat-messages');
  const panel = document.createElement('div');
  panel.id = 'rec-panel';
  panel.style.cssText = 'margin:8px 0;padding:12px;background:rgba(212,175,55,0.05);border:1px solid rgba(212,175,55,0.2);border-radius:12px;';
  panel.innerHTML = `
    <p style="color:#D4AF37;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">💡 AI Suggestions — click to send</p>
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${recs.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(0,0,0,0.3);border-radius:8px;border:1px solid rgba(212,175,55,0.15);">
          <div>
            <p style="color:#e5e7eb;font-size:13px;font-weight:600;margin:0;">${p.name}</p>
            <p style="color:#9ca3af;font-size:11px;margin:2px 0 0;">Rp ${p.price.toLocaleString()} · Stock: ${p.stock}</p>
          </div>
          <button onclick="sendProductRecommendation('${p.id}')"
            style="padding:5px 12px;background:rgba(212,175,55,0.2);border:1px solid rgba(212,175,55,0.4);border-radius:6px;color:#D4AF37;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">
            Send →
          </button>
        </div>`).join('')}
    </div>`;
  container.appendChild(panel);
  container.scrollTop = container.scrollHeight;
}

async function sendProductRecommendation(productId) {
  if (!activeConvId) return;
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  const now = firebase.firestore.FieldValue.serverTimestamp();
  await db.collection('chats').doc(activeConvId).collection('messages').add({
    text: `🍽️ I recommend: *${product.name}* — Rp ${product.price.toLocaleString()}`,
    sender: 'seller',
    type: 'recommendation',
    product: {
      id: product.id,
      name: product.name,
      price: product.price,
      stock: product.stock ?? 0,
      tags: product.tags || [],
      description: product.description || ''
    },
    createdAt: now
  });
  await db.collection('chats').doc(activeConvId).update({
    lastMessage: `Recommended: ${product.name}`,
    lastMessageAt: now,
    unreadBuyer: firebase.firestore.FieldValue.increment(1)
  });

  // Remove rec panel after sending
  document.getElementById('rec-panel')?.remove();
}

// =============================================
// CHAT SYSTEM
// =============================================
let activeConvId = null;
let activeMessagesUnsubscribe = null;

function toggleChatPanel() {
  document.getElementById('chat-panel').classList.toggle('chat-panel-open');
}

function listenConversations() {
  const convList = document.getElementById('conv-list');
  const convEmpty = document.getElementById('conv-empty');

  db.collection('chats').orderBy('lastMessageAt', 'desc').onSnapshot(snapshot => {
    convList.innerHTML = '';
    if (snapshot.empty) { convEmpty.classList.remove('hidden'); return; }
    convEmpty.classList.add('hidden');

    let totalUnread = 0;
    snapshot.forEach(doc => {
      const conv = doc.data();
      const unread = conv.unreadSeller || 0;
      totalUnread += unread;
      const time = conv.lastMessageAt?.toDate ? formatTime(conv.lastMessageAt.toDate()) : '';
      const item = document.createElement('div');
      item.className = `conv-item ${activeConvId === doc.id ? 'conv-item-active' : ''}`;
      item.onclick = () => openConversation(doc.id, conv.buyerName || 'Buyer');
      item.innerHTML = `
        <div class="conv-avatar">${(conv.buyerName || 'B')[0].toUpperCase()}</div>
        <div class="conv-info">
          <div class="conv-name-row">
            <span class="conv-name">${conv.buyerName || 'Anonymous Buyer'}</span>
            <span class="conv-time">${time}</span>
          </div>
          <div class="conv-preview">${conv.lastMessage || '...'}</div>
        </div>
        ${unread > 0 ? `<span class="conv-unread">${unread}</span>` : ''}
      `;
      convList.appendChild(item);
    });

    const badge = document.getElementById('chat-unread-badge');
    if (totalUnread > 0) { badge.textContent = totalUnread; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  });
}

// FIX GAP 2 & 3: openConversation now handles message types + triggers recommendation engine
let _lastBuyerMsg = '';

function openConversation(convId, buyerName) {
  activeConvId = convId;
  _lastBuyerMsg = '';
  document.getElementById('conversation-tabs').classList.add('hidden');
  document.getElementById('chat-window-area').classList.remove('hidden');
  document.getElementById('active-username').textContent = buyerName;
  document.getElementById('active-avatar').textContent = buyerName[0].toUpperCase();
  db.collection('chats').doc(convId).update({ unreadSeller: 0 });
  document.getElementById('rec-panel')?.remove();

  if (activeMessagesUnsubscribe) activeMessagesUnsubscribe();

  activeMessagesUnsubscribe = db.collection('chats').doc(convId)
    .collection('messages').orderBy('createdAt', 'asc')
    .onSnapshot(snapshot => {
      const container = document.getElementById('chat-messages');
      container.innerHTML = '';
      document.getElementById('rec-panel')?.remove();

      let latestBuyerMsg = '';

      snapshot.forEach(doc => {
        const msg = doc.data();
        const isSeller = msg.sender === 'seller';
        const isSystem = msg.sender === 'system';
        const time = msg.createdAt?.toDate ? formatTime(msg.createdAt.toDate()) : '';
        const div = document.createElement('div');

        // FIX GAP 2: Render message types correctly
        if (msg.type === 'recommendation' && msg.product) {
          // Seller's own sent recommendation — show as a compact gold bubble
          div.className = 'msg-row msg-row-seller';
          div.innerHTML = `
            <div class="msg-bubble msg-seller" style="min-width:160px;">
              <p style="font-size:10px;opacity:0.75;margin-bottom:4px;font-weight:700;">📦 RECOMMENDED</p>
              <p style="font-weight:700;margin:0 0 2px;">${msg.product.name}</p>
              <p style="font-size:11px;margin:0 0 4px;opacity:0.8;">Rp ${msg.product.price.toLocaleString()}</p>
              <span class="msg-time">${time}</span>
            </div>`;

        } else if (msg.type === 'order_cancelled') {
          // Cancelled order system message — center banner
          div.style.cssText = 'display:flex;justify-content:center;margin:6px 0;';
          div.innerHTML = `
            <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:8px 14px;font-size:12px;color:#ef4444;text-align:center;max-width:90%;">
              ❌ <strong>Order Cancelled</strong>${msg.cancelReason ? ` — ${msg.cancelReason}` : ''}
              <span style="display:block;font-size:10px;color:#9ca3af;margin-top:2px;">${time}</span>
            </div>`;

        } else if (isSystem || msg.type === 'order_placed') {
          // System/order messages — neutral center banner
          div.style.cssText = 'display:flex;justify-content:center;margin:6px 0;';
          div.innerHTML = `
            <div style="background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.2);border-radius:10px;padding:8px 14px;font-size:12px;color:#9ca3af;text-align:center;max-width:90%;white-space:pre-line;">
              ${msg.text}
              <span style="display:block;font-size:10px;margin-top:2px;">${time}</span>
            </div>`;

        } else {
          // Normal buyer / seller message
          div.className = `msg-row ${isSeller ? 'msg-row-seller' : 'msg-row-buyer'}`;
          div.innerHTML = `<div class="msg-bubble ${isSeller ? 'msg-seller' : 'msg-buyer'}"><p>${msg.text}</p><span class="msg-time">${time}</span></div>`;
        }

        container.appendChild(div);

        // Track latest buyer message for recommendation engine
        if (!isSeller && !isSystem && msg.type !== 'order_placed' && msg.type !== 'order_cancelled') {
          latestBuyerMsg = msg.text;
        }
      });

      container.scrollTop = container.scrollHeight;

      // FIX GAP 3: Trigger recommendation engine when a new buyer message arrives
      if (latestBuyerMsg && latestBuyerMsg !== _lastBuyerMsg) {
        _lastBuyerMsg = latestBuyerMsg;
        const recs = getRecommendations(latestBuyerMsg);
        renderRecommendationPanel(recs);
      }
    });
}

function backToList() {
  activeConvId = null;
  _lastBuyerMsg = '';
  if (activeMessagesUnsubscribe) { activeMessagesUnsubscribe(); activeMessagesUnsubscribe = null; }
  document.getElementById('conversation-tabs').classList.remove('hidden');
  document.getElementById('chat-window-area').classList.add('hidden');
  document.getElementById('rec-panel')?.remove();
}

async function sendSellerMessage() {
  if (!activeConvId) return;
  const input = document.getElementById('seller-chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const now = firebase.firestore.FieldValue.serverTimestamp();
  await db.collection('chats').doc(activeConvId).collection('messages').add({ text, sender: 'seller', createdAt: now });
  await db.collection('chats').doc(activeConvId).update({
    lastMessage: text, lastMessageAt: now,
    unreadBuyer: firebase.firestore.FieldValue.increment(1)
  });
}

function handleChatKey(e) { if (e.key === 'Enter') sendSellerMessage(); }

async function clearConversation() {
  if (!activeConvId) return;
  if (!confirm("Clear this conversation? This cannot be undone.")) return;
  const msgs = await db.collection('chats').doc(activeConvId).collection('messages').get();
  const batch = db.batch();
  msgs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  await db.collection('chats').doc(activeConvId).update({ lastMessage: '', unreadSeller: 0, unreadBuyer: 0 });
  document.getElementById('rec-panel')?.remove();
}

function formatTime(date) {
  const diff = new Date() - date;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

// Fade-in-up animation for toast
const _sellerStyle = document.createElement('style');
_sellerStyle.textContent = `@keyframes fadeInUp { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`;
document.head.appendChild(_sellerStyle);

listenConversations();
document.addEventListener('DOMContentLoaded', initOrdersPanel);
