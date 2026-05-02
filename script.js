// ============================================================
//  TEMPAT. — Seller Dashboard (Manual Mode)
//  Communication via Supabase Realtime (shared with Buyer):
//
//  Shared table: public.messages
//  Row shape:
//    text messages  : { sender, text, session_id, type, created_at }
//  TEMPAT. — Seller Dashboard (Supabase Conversation Mode)
//
//  Shared Supabase tables:
//    conversations : { id (uuid), buyer_name, created_at }
//    messages      : { id, conversation_id, sender, text, type, ... }
//    products      : menu catalog
//    orders        : buyer orders
// ============================================================

const CHAT_TABLE = 'messages';
let _chatUnsub2 = null;          // global messages channel
const _sellerRendered = new Set(); // dedup per active conv

// ── Active conversation state ──────────────────────────────────
let activeConversationId = null;  // UUID of selected conversation
const _convUnreadCounts = {};     // { [convId]: number }
const _convData = {};             // { [convId]: { id, buyer_name, created_at } }

// ── Helpers ────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(date) {
  return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function showSellerToast(msg, color = '#D4AF37') {
  // Check if a toast container exists, if not create one
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.style.cssText = `background:rgba(0,0,0,0.85);color:${color};padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;border:1px solid ${color};box-shadow:0 8px 16px rgba(0,0,0,0.5);opacity:0;transform:translateY(20px);transition:all 0.3s ease;`;
  toast.textContent = msg;
  
  container.appendChild(toast);
  
  // Animate in
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }, 10);
  
  // Animate out
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ──────────────────────────────────────────────────────────────
//  MENU (Catalog) — localStorage: "seller_menu"
// ──────────────────────────────────────────────────────────────
let allProducts = [];

function loadMenu() {
  try {
    allProducts = JSON.parse(localStorage.getItem('seller_menu') || '[]');
  } catch {
    allProducts = [];
  }
}

function saveMenu() {
  localStorage.setItem('seller_menu', JSON.stringify(allProducts));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Add Product ────────────────────────────────────────────────
function addProduct() {
  const name = document.getElementById('name').value.trim();
  const price = Number(document.getElementById('price').value);
  const description = document.getElementById('description').value.trim();
  const stock = parseInt(document.getElementById('stock').value) || 0;
  const tags = document.getElementById('tags').value.split(',').map(t => t.trim()).filter(Boolean);

  if (!name) return showSellerToast('⚠️ Item name is required.', '#f59e0b');
  if (!price || price <= 0) return showSellerToast('⚠️ Price must be a positive number.', '#f59e0b');
  if (stock < 0) return showSellerToast('⚠️ Stock cannot be negative.', '#f59e0b');

  const product = {
    id: generateId(),
    name,
    price,
    description,
    stock,
    tags,
    createdAt: Date.now()
  };

  loadMenu();
  allProducts.unshift(product);
  saveMenu();
  renderMenu();

  // ── 3. WRITE TO SUPABASE
  if (typeof sbSaveProduct === 'function') {
    sbSaveProduct(product);
  }

  // Clear form
  ['name', 'price', 'description', 'stock', 'tags'].forEach(id => {
    document.getElementById(id).value = '';
  });

  showSellerToast(`✅ "${name}" added to menu!`);
}

// ── Delete Product ─────────────────────────────────────────────
function deleteProduct(id) {
  if (!confirm('Remove this item from the menu?')) return;
  loadMenu();
  allProducts = allProducts.filter(p => p.id !== id);
  saveMenu();
  renderMenu();
  // Also delete from Supabase
  if (typeof sbDeleteProduct === 'function') sbDeleteProduct(id);
  showSellerToast('Item removed.', '#ef4444');
}

// ── Update Stock ───────────────────────────────────────────────
function updateStock(id, delta) {
  loadMenu();
  const p = allProducts.find(p => p.id === id);
  if (!p) return;
  p.stock = Math.max(0, (p.stock || 0) + delta);
  saveMenu();
  renderMenu();
  // Sync stock change to Supabase
  if (typeof sbUpdateProduct === 'function') sbUpdateProduct(p);
  showSellerToast(`Stock ${delta > 0 ? '+' : ''}${delta}`, '#4ade80');
}

function setStock(id) {
  const input = document.getElementById(`stock-input-${id}`);
  const val = parseInt(input?.value);
  if (isNaN(val) || val < 0) return showSellerToast('⚠️ Enter a valid stock number.', '#f59e0b');
  loadMenu();
  const p = allProducts.find(p => p.id === id);
  if (p) {
    p.stock = val;
    saveMenu();
    renderMenu();
    // Sync stock change to Supabase
    if (typeof sbUpdateProduct === 'function') sbUpdateProduct(p);
  }
}

// ── Open Edit Modal ────────────────────────────────────────────
function openEditModal(id) {
  loadMenu();
  const product = allProducts.find(p => p.id === id);
  if (!product) return;

  document.getElementById('edit-product-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'edit-product-modal';
  modal.className = 'edit-modal-overlay';
  modal.innerHTML = `
    <div class="edit-modal-card" role="dialog" aria-modal="true">
      <div class="edit-modal-header">
        <div class="edit-modal-title">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          <span>Edit Menu Item</span>
        </div>
        <button class="edit-modal-close" onclick="closeEditModal()">✕</button>
      </div>
      <div class="edit-modal-body">
        <div class="edit-form-group">
          <label for="edit-name">Item Name <span style="color:#ef4444">*</span></label>
          <input id="edit-name" type="text" value="${product.name.replace(/"/g, '&quot;')}">
        </div>
        <div class="edit-form-row">
          <div class="edit-form-group">
            <label for="edit-price">Price (Rp) <span style="color:#ef4444">*</span></label>
            <input id="edit-price" type="number" min="1" value="${product.price}">
          </div>
          <div class="edit-form-group">
            <label for="edit-stock">Stock</label>
            <input id="edit-stock" type="number" min="0" value="${product.stock ?? 0}">
          </div>
        </div>
        <div class="edit-form-group">
          <label for="edit-description">Description</label>
          <textarea id="edit-description" rows="3">${product.description || ''}</textarea>
        </div>
        <div class="edit-form-group">
          <label for="edit-tags">Tags <span style="color:#6b7280;font-weight:400;font-size:11px;">(comma separated)</span></label>
          <input id="edit-tags" type="text" value="${(product.tags || []).join(', ')}">
        </div>
        <div id="edit-error-msg" style="display:none;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:10px 14px;color:#ef4444;font-size:13px;"></div>
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

function submitEditProduct(id) {
  const nameVal = document.getElementById('edit-name')?.value.trim();
  const priceVal = Number(document.getElementById('edit-price')?.value);
  const stockVal = parseInt(document.getElementById('edit-stock')?.value ?? '0', 10);
  const descVal = document.getElementById('edit-description')?.value.trim();
  const tagsVal = document.getElementById('edit-tags')?.value.split(',').map(t => t.trim()).filter(Boolean);

  const errEl = document.getElementById('edit-error-msg');
  const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };

  if (!nameVal) return showErr('Item name is required.');
  if (!priceVal || priceVal <= 0 || isNaN(priceVal)) return showErr('Price must be a positive number.');
  if (isNaN(stockVal) || stockVal < 0) return showErr('Stock cannot be negative.');

  const saveBtn = document.getElementById('edit-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  loadMenu();
  const idx = allProducts.findIndex(p => p.id === id);
  if (idx !== -1) {
    allProducts[idx] = { ...allProducts[idx], name: nameVal, price: priceVal, stock: stockVal, description: descVal, tags: tagsVal };
    saveMenu();
    // Dual-write edit to Supabase
    if (typeof sbUpdateProduct === 'function') sbUpdateProduct(allProducts[idx]);
  }
  closeEditModal();
  renderMenu();
  showSellerToast('✅ Item updated!');
}

// ── Render Menu Grid ───────────────────────────────────────────
function renderMenu() {
  loadMenu();
  const list = document.getElementById('productList');
  if (!list) return;

  if (!allProducts.length) {
    list.innerHTML = `<p style="opacity:.5;padding:20px;font-size:13px;">No menu items yet. Add your first item above!</p>`;
    return;
  }

  list.innerHTML = '';
  allProducts.forEach(p => {
    const stock = p.stock ?? 0;
    const stockColor = stock === 0 ? '#ef4444' : stock <= 5 ? '#f59e0b' : '#4ade80';
    const stockLabel = stock === 0 ? 'Out of Stock' : stock <= 5 ? `Low: ${stock}` : `${stock} left`;
    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <button class="delete-btn" onclick="deleteProduct('${p.id}')" title="Remove item">✕</button>
      <button class="edit-btn"   onclick="openEditModal('${p.id}')" title="Edit item">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>

      <h3 class="product-name">${escapeHtml(p.name)}</h3>
      <p class="product-price">Rp ${p.price.toLocaleString()}</p>
      ${p.description ? `<p style="font-size:12px;color:#9ca3af;margin-bottom:8px;line-height:1.45;">${escapeHtml(p.description)}</p>` : ''}
      <div class="tag-row" style="margin-bottom:10px;">
        ${(p.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
      </div>

      <!-- Stock controls -->
      <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Stock</span>
          <span style="font-size:12px;font-weight:700;color:${stockColor};">${stockLabel}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          <button onclick="updateStock('${p.id}',-1)" style="width:28px;height:28px;background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);border-radius:6px;color:#ef4444;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>
          <span style="flex:1;text-align:center;font-size:18px;font-weight:700;color:${stockColor};">${stock}</span>
          <button onclick="updateStock('${p.id}',1)"  style="width:28px;height:28px;background:rgba(74,222,128,0.2);border:1px solid rgba(74,222,128,0.4);border-radius:6px;color:#4ade80;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>
        </div>
        <div style="display:flex;gap:6px;">
          <input id="stock-input-${p.id}" type="number" min="0" value="${stock}"
            style="flex:1;background:#000;border:1px solid rgba(212,175,55,0.2);border-radius:6px;color:white;padding:5px 8px;font-size:12px;outline:none;">
          <button onclick="setStock('${p.id}')" style="padding:5px 10px;background:rgba(212,175,55,0.2);border:1px solid rgba(212,175,55,0.4);border-radius:6px;color:#D4AF37;font-size:11px;font-weight:600;cursor:pointer;">Set</button>
        </div>
      </div>

      <!-- ★ RECOMMEND button -->
      <button
        id="rec-btn-${p.id}"
        onclick="recommendToBuyer('${p.id}')"
        class="recommend-btn"
        ${stock === 0 ? 'disabled title="Out of stock"' : ''}
        style="${stock === 0 ? 'opacity:0.4;cursor:not-allowed;' : ''}"
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
        </svg>
        Recommend to Buyer
      </button>
    `;
    list.appendChild(card);
  });
}

// ──────────────────────────────────────────────────────────────
//  RECOMMEND — Push a food card to the buyer's side
//  Writes to localStorage: "seller_recommendation"
//  The Buyer's page listens for the "storage" event and
//  renders an interactive food card in the chat window.
// ──────────────────────────────────────────────────────────────
// ── Recommend a food card to Buyer via Supabase ────────────────
async function recommendToBuyer(productId) {
  if (!activeConversationId) {
    return showSellerToast('⚠️ Select a buyer conversation first!', '#f59e0b');
  }
  loadMenu();
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  if ((product.stock ?? 0) <= 0) {
    return showSellerToast('⚠️ This item is out of stock!', '#f59e0b');
  }

  try {
    const { error } = await supabaseClient.from(CHAT_TABLE).insert([{
      sender: 'seller',
      type: 'product',
      productId: product.id,
      name: product.name,
      price: product.price,
      info: product.description || '',
      stock: product.stock ?? null,
      tags: product.tags || [],
      conversation_id: activeConversationId,
      session_id: 'session_01'
    }]);

    if (error) throw error;

    showSellerToast(`📤 Food card sent: ${product.name}`, '#D4AF37');

    const btn = document.getElementById(`rec-btn-${productId}`);
    if (btn) {
      btn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Sent!`;
      btn.style.background = 'rgba(74,222,128,0.25)';
      btn.style.borderColor = 'rgba(74,222,128,0.5)';
      btn.style.color = '#4ade80';
      setTimeout(() => {
        btn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg> Recommend to Buyer`;
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
      }, 2200);
    }
  } catch (err) {
    console.error('[Seller] recommendToBuyer failed:', err);
    showSellerToast('⚠️ Could not send food card.', '#ef4444');
  }
}

// ──────────────────────────────────────────────────────────────
//  CONVERSATION LIST — renders items in the left inbox pane
// ──────────────────────────────────────────────────────────────
function renderConversationItem(conv) {
  _convData[conv.id] = conv;
  if (!_convUnreadCounts[conv.id]) _convUnreadCounts[conv.id] = 0;

  const listEl = document.getElementById('conv-list-items');
  const emptyEl = document.getElementById('conv-list-empty');
  if (emptyEl) emptyEl.style.display = 'none';
  if (!listEl) return;

  // Remove old entry for this conversation if exists (re-render)
  document.getElementById(`conv-item-${conv.id}`)?.remove();

  const item = document.createElement('div');
  item.id = `conv-item-${conv.id}`;
  const isActive = conv.id === activeConversationId;
  const unread = _convUnreadCounts[conv.id] || 0;

  item.style.cssText = `
    padding:10px 12px;
    cursor:pointer;
    border-left:3px solid ${isActive ? '#D4AF37' : 'transparent'};
    background:${isActive ? 'rgba(212,175,55,0.1)' : 'transparent'};
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:6px;
    transition:background 0.15s, border-color 0.15s;
    border-bottom:1px solid rgba(255,255,255,0.04);
  `;
  item.innerHTML = `
    <div style="flex:1;min-width:0;">
      <p style="color:${isActive ? '#D4AF37' : '#e5e7eb'};font-size:12px;font-weight:${isActive ? '700' : '500'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;">
        ${escapeHtml(conv.buyer_name || 'Guest')}
      </p>
      <p style="color:#4b5563;font-size:10px;margin:2px 0 0;">
        ${new Date(conv.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
    ${unread > 0 ? `<span style="background:#D4AF37;color:#000;border-radius:999px;font-size:9px;font-weight:800;padding:2px 6px;flex-shrink:0;">${unread}</span>` : ''}
  `;
  item.addEventListener('click', () => selectConversation(conv.id));
  item.addEventListener('mouseenter', () => { if (conv.id !== activeConversationId) item.style.background = 'rgba(255,255,255,0.04)'; });
  item.addEventListener('mouseleave', () => { if (conv.id !== activeConversationId) item.style.background = 'transparent'; });

  listEl.appendChild(item);
}

// ──────────────────────────────────────────────────────────────
//  SELECT CONVERSATION — loads messages for chosen buyer
// ──────────────────────────────────────────────────────────────
async function selectConversation(convId) {
  if (activeConversationId === convId) return;
  activeConversationId = convId;

  // Reset unread for this conversation
  _convUnreadCounts[convId] = 0;

  // Re-render all conversation items to update active highlight
  Object.values(_convData).forEach(c => renderConversationItem(c));

  // Update active label
  const conv = _convData[convId];
  const nameEl = document.getElementById('active-conv-name');
  const dotEl  = document.getElementById('active-conv-dot');
  if (nameEl) nameEl.textContent = conv?.buyer_name || 'Buyer';
  if (dotEl)  { dotEl.style.background = '#4ade80'; dotEl.style.boxShadow = '0 0 6px #4ade80'; }

  // Enable input
  const inputEl = document.getElementById('seller-chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (inputEl) { inputEl.disabled = false; inputEl.style.opacity = '1'; inputEl.placeholder = 'Reply to buyer…'; inputEl.focus(); }
  if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = '0.45'; }

  // Clear rendered message set & DOM
  _sellerRendered.clear();
  const container = document.getElementById('chat-messages');
  const emptyState = document.getElementById('chat-empty-state');
  if (container) {
    container.innerHTML = '';
    if (emptyState) { container.appendChild(emptyState); emptyState.style.display = 'none'; }
  }

  // Load messages for this conversation from Supabase
  const { data: msgs } = await supabaseClient
    .from(CHAT_TABLE)
    .select('*')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true });

  if (msgs && msgs.length > 0) {
    msgs.forEach(row => renderSellerMessage({ id: row.id, data: () => row }));
  } else if (emptyState) {
    emptyState.style.display = 'flex';
  }

  console.log('[Seller] Switched to conversation:', convId, conv?.buyer_name);
}

// ──────────────────────────────────────────────────────────────
//  CHAT — Supabase Realtime (kept for compat — actual logic is
//  driven by attachBuyerMessageListener in SellerDashboard.js)
// ──────────────────────────────────────────────────────────────
let _lastRenderedCount = 0;

function loadChatMessages() {
  try { return JSON.parse(localStorage.getItem('chat_messages') || '[]'); } catch { return []; }
}
function saveChatMessages(msgs) {
  localStorage.setItem('chat_messages', JSON.stringify(msgs));
}
function appendChatMessage(msg) {
  const msgs = loadChatMessages();
  msgs.push(msg);
  saveChatMessages(msgs);
}
function renderChat() {
  // no-op — driven by channel listener
}

/**
 * renderSellerMessage(doc) — renders a single Supabase row in the seller's chat panel.
 * Buyer messages float LEFT, Seller messages float RIGHT.
 */
function renderSellerMessage(doc) {
  const container = document.getElementById('chat-messages');
  const emptyState = document.getElementById('chat-empty-state');
  if (!container) return;
  if (_sellerRendered.has(doc.id)) return;
  _sellerRendered.add(doc.id);

  if (emptyState) emptyState.style.display = 'none';

  const data = doc.data ? doc.data() : doc;
  const isSeller = data.sender === 'seller';
  const tsMillis = data.timestamp ? new Date(data.timestamp).getTime() : (data.ts || Date.now());
  const time = formatTime(new Date(tsMillis));
  const el = document.createElement('div');

  /* ── SYSTEM NOTIFICATION (order-placed alert from Buyer) ────── */
  if (data.sender === 'system') {
    el.className = 'msg-row';
    el.innerHTML = `
      <div style="
        width:100%;
        background:linear-gradient(135deg,rgba(212,175,55,0.18),rgba(212,175,55,0.06));
        border:1px solid rgba(212,175,55,0.5);
        border-radius:10px;
        padding:10px 14px;
        display:flex;flex-direction:column;gap:3px;
        margin:4px 0;
      ">
        <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:#D4AF37;text-transform:uppercase;">⚡ System Notification</span>
        <span style="color:#f0e0a0;font-size:13px;font-weight:500;">${escapeHtml(data.text || '')}</span>
        <span style="font-size:10px;color:rgba(255,255,255,0.3);align-self:flex-end;">${time}</span>
      </div>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return;
  }

  /* ── PRODUCT FOOD CARD ─────────────────────────────────────── */
  if (data.type === 'product') {
    const stockNum = data.stock ?? null;
    const inStock = stockNum !== null && stockNum > 0;
    const stockColor = inStock ? '#4ade80' : '#ef4444';
    const stockLabel = stockNum === null ? ''
      : (inStock ? '&#x2705; ' + stockNum + ' in stock' : '&#x274C; Out of stock');

    const tagsHtml = (data.tags || [])
      .map(t => '<span style="background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.3);' +
        'color:#D4AF37;padding:2px 8px;border-radius:999px;font-size:9px;font-weight:600;">' +
        escapeHtml(t) + '</span>')
      .join('');

    el.className = 'msg-row msg-row-seller';
    el.innerHTML =
      '<div class="seller-food-card-inline">' +
      '<p class="seller-food-card-badge">📤 Food Card Sent</p>' +
      '<p class="seller-food-card-name">' + escapeHtml(data.name || '') + '</p>' +
      (data.info
        ? '<p class="seller-food-card-desc">' + escapeHtml(data.info) + '</p>'
        : '') +
      '<p class="seller-food-card-price">Rp ' + (data.price || 0).toLocaleString() + '</p>' +
      (stockLabel
        ? '<p class="seller-food-card-stock" style="color:' + stockColor + ';">' + stockLabel + '</p>'
        : '') +
      (tagsHtml
        ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">' + tagsHtml + '</div>'
        : '') +
      '<span class="msg-time" style="color:rgba(212,175,55,0.45);">' + time + '</span>' +
      '</div>';
  } else {
    // ── Standard text bubble ──────────────────────────────────
    el.className = `msg-row ${isSeller ? 'msg-row-seller' : 'msg-row-buyer'}`;
    el.innerHTML = `
      <div class="msg-bubble ${isSeller ? 'msg-seller' : 'msg-buyer'}">
        <p>${escapeHtml(data.text || '')}</p>
        <span class="msg-time">${time}</span>
      </div>`;

    // Flash the chat-unread-badge for incoming buyer messages
    if (!isSeller) {
      const badge = document.getElementById('chat-unread-badge');
      if (badge) {
        const cur = parseInt(badge.textContent) || 0;
        badge.textContent = cur + 1;
        badge.classList.remove('hidden');
      }
    }
  }

  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function updateChatUnreadBadge() {
  // Badge is now updated incrementally by renderSellerMessage.
  // This function kept for backward compatibility.
}

// Mark all buyer messages read when the chat panel is visible
function markAllRead() {
  // Reset unread badge only
  const badge = document.getElementById('chat-unread-badge');
  if (badge) {
    badge.textContent = '0';
    badge.classList.add('hidden');
  }
}

// ── Attach global Supabase real-time listener for ALL messages ──
async function attachBuyerMessageListener() {
  if (_chatUnsub2) return;

  console.log('[Seller] Attaching global messages listener');

  _chatUnsub2 = supabaseClient.channel('seller-all-messages')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: CHAT_TABLE
    }, payload => {
      const row = payload.new;
      if (!row || !row.conversation_id) return;

      if (row.conversation_id === activeConversationId) {
        // Message is for the currently selected conversation — render it
        if (row.sender !== 'seller') {
          renderSellerMessage({ id: row.id, data: () => row });
        }
      } else {
        // Message is for a different conversation — increment unread badge
        if (row.sender === 'buyer') {
          _convUnreadCounts[row.conversation_id] = (_convUnreadCounts[row.conversation_id] || 0) + 1;
          // Re-render that conversation item so badge updates
          const conv = _convData[row.conversation_id];
          if (conv) renderConversationItem(conv);

          // Flash the global chat FAB badge
          const badge = document.getElementById('chat-unread-badge');
          if (badge) {
            const cur = parseInt(badge.textContent) || 0;
            badge.textContent = cur + 1;
            badge.classList.remove('hidden');
          }
        }
      }
    })
    .subscribe();
}

// ── Send a text reply to buyer via Supabase ──────────────────────────
async function sendSellerMessage() {
  if (!activeConversationId) {
    showSellerToast('⚠️ Please select a buyer conversation first.', '#f59e0b');
    return;
  }
  const input = document.getElementById('seller-chat-input');
  const text = input?.value.trim();
  if (!text) return;
  input.value = '';
  syncSendBtn();
  try {
    const { data, error } = await supabaseClient.from(CHAT_TABLE).insert([{
      sender: 'seller',
      text: text,
      type: 'text',
      conversation_id: activeConversationId,
      session_id: 'session_01'
    }]).select();
    
    if (error) throw error;
    
    if (data && data[0]) {
      const row = data[0];
      renderSellerMessage({ id: row.id, data: () => row });
    }
  } catch (err) {
    console.error('[Seller Chat] Failed to send:', err);
    showSellerToast('⚠️ Could not send message.', '#ef4444');
  }
}

function handleChatKey(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendSellerMessage();
  }
}

function clearConversation() {
  if (!activeConversationId) { showSellerToast('⚠️ No conversation selected.', '#f59e0b'); return; }
  if (!confirm('Clear messages for this buyer? (local view only)')) return;
  _sellerRendered.clear();
  const container = document.getElementById('chat-messages');
  const emptyState = document.getElementById('chat-empty-state');
  if (container) {
    container.innerHTML = '';
    if (emptyState) { container.appendChild(emptyState); emptyState.style.display = 'flex'; }
  }
  showSellerToast('Conversation cleared (local view only).', '#6b7280');
}

// ──────────────────────────────────────────────────────────────
//  BUYER TYPING INDICATOR
//  Buyer sets localStorage "buyer_typing" = "1" while typing.
//  Seller side listens and shows animated dots.
// ──────────────────────────────────────────────────────────────
function checkBuyerTyping() {
  const isTyping = localStorage.getItem('buyer_typing') === '1';
  const bar = document.getElementById('buyer-typing-indicator');
  if (bar) bar.style.display = isTyping ? 'flex' : 'none';
}

// ──────────────────────────────────────────────────────────────
//  CART ACTIVITY LISTENER
//  Buyer writes to localStorage: "buyer_cart_events"
//  Each event: { productId, productName, price, qty, ts }
// ──────────────────────────────────────────────────────────────
let _lastCartEventCount = 0;

function checkCartEvents() {
  try {
    const events = JSON.parse(localStorage.getItem('buyer_cart_events') || '[]');
    if (events.length === _lastCartEventCount) return;

    const newEvents = events.slice(_lastCartEventCount);
    _lastCartEventCount = events.length;

    newEvents.forEach(ev => {
      addCartNotification(ev);
      showNewCartToast(ev);
    });

    const badge = document.getElementById('notif-badge');
    const panel = document.getElementById('notif-panel');
    if (badge && !panel?.classList.contains('notif-panel-open')) {
      const current = parseInt(badge.textContent) || 0;
      badge.textContent = current + newEvents.length;
      badge.classList.remove('hidden');
    }
  } catch { /* ignore */ }
}

function addCartNotification(ev) {
  const list = document.getElementById('notif-list');
  if (!list) return;

  // Remove placeholder if present
  const placeholder = list.querySelector('p');
  if (placeholder && placeholder.textContent.includes('No cart activity')) placeholder.remove();

  const item = document.createElement('div');
  item.className = 'notif-item';
  item.style.cssText = `
    background:rgba(74,222,128,0.06);
    border:1px solid rgba(74,222,128,0.25);
    border-radius:10px;
    padding:10px 12px;
    margin-bottom:8px;
    animation:sdCardIn 0.35s cubic-bezier(0.34,1.56,0.64,1);
  `;
  item.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:18px;">🛒</span>
      <div style="flex:1;min-width:0;">
        <p style="color:#4ade80;font-weight:700;font-size:12px;margin:0 0 2px;">Buyer added to cart!</p>
        <p style="color:#e5e7eb;font-size:13px;font-weight:600;margin:0;">${escapeHtml(ev.productName)}</p>
        <p style="color:#9ca3af;font-size:11px;margin:2px 0 0;">×${ev.qty || 1} · Rp ${(ev.price || 0).toLocaleString()} · ${formatTime(new Date(ev.ts))}</p>
      </div>
      <span style="font-size:18px;">✅</span>
    </div>`;
  list.prepend(item);
}

function showNewCartToast(ev) {
  const t = document.createElement('div');
  t.style.cssText = `
    position:fixed;top:72px;right:20px;z-index:9999;
    background:linear-gradient(135deg,#0a0a0a,#111);
    border:1px solid rgba(74,222,128,0.5);
    border-radius:14px;padding:14px 18px;
    box-shadow:0 12px 40px rgba(0,0,0,0.6);
    max-width:310px;
    animation:sdSlideIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
  `;
  t.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:36px;height:36px;border-radius:50%;background:rgba(74,222,128,0.15);border:1px solid rgba(74,222,128,0.4);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">🛒</div>
      <div>
        <p style="color:#4ade80;font-weight:700;font-size:13px;margin:0 0 3px;">Recommendation worked! 🎉</p>
        <p style="color:#e5e7eb;font-size:12px;margin:0;font-weight:600;">${escapeHtml(ev.productName)}</p>
        <p style="color:#9ca3af;font-size:11px;margin:2px 0 0;">Added to buyer's cart (×${ev.qty || 1})</p>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;color:#4b5563;font-size:16px;cursor:pointer;margin-left:auto;line-height:1;flex-shrink:0;">✕</button>
    </div>`;
  document.body.appendChild(t);
  setTimeout(() => t?.remove(), 6000);
}

function clearNotifications() {
  const list = document.getElementById('notif-list');
  if (list) list.innerHTML = `<p style="color:#4b5563;font-size:12px;text-align:center;padding:24px 0;">No cart activity yet.<br>Recommend items to get started!</p>`;
  _lastCartEventCount = (JSON.parse(localStorage.getItem('buyer_cart_events') || '[]')).length;
}

// ──────────────────────────────────────────────────────────────
//  REAL-TIME SYNC
//  Primary: Supabase postgres_changes channel (via attachBuyerMessageListener)
//  Secondary: 500ms poll for cart events + typing indicator only
// ──────────────────────────────────────────────────────────────
window.addEventListener('storage', e => {
  if (e.key === 'buyer_cart_events') checkCartEvents();
  if (e.key === 'buyer_typing') checkBuyerTyping();
  if (e.key === 'seller_menu') renderMenu();
});

// Fallback poll for cart events + typing only (chat is handled by Supabase channel)
setInterval(() => {
  checkCartEvents();
  checkBuyerTyping();
}, 500);

// ──────────────────────────────────────────────────────────────
//  UTILITY
// ──────────────────────────────────────────────────────────────
function formatTime(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showSellerToast(message, color = '#D4AF37') {
  document.getElementById('seller-toast')?.remove();
  const t = document.createElement('div');
  t.id = 'seller-toast';
  t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;
    background:#111;border:1px solid ${color}55;border-radius:10px;
    padding:10px 20px;color:${color};font-weight:600;font-size:13px;
    box-shadow:0 8px 30px rgba(0,0,0,0.6);white-space:nowrap;animation:fadeInUp 0.3s ease;`;
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t?.remove(), 3500);
}

function syncSendBtn() {
  const input = document.getElementById('seller-chat-input');
  const btn = document.getElementById('chat-send-btn');
  if (!input || !btn) return;
  const has = input.value.trim().length > 0;
  btn.style.opacity = has ? '1' : '0.45';
  btn.style.transform = has ? '' : 'scale(0.92)';
}

// ──────────────────────────────────────────────────────────────
//  INJECT STYLES (animations + typing indicator)
// ──────────────────────────────────────────────────────────────
(function injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
    @keyframes fadeInUp {
      from { opacity:0; transform:translateX(-50%) translateY(8px); }
      to   { opacity:1; transform:translateX(-50%) translateY(0); }
    }
    @keyframes sdCardIn {
      from { opacity:0; transform:translateY(10px) scale(0.97); }
      to   { opacity:1; transform:translateY(0) scale(1); }
    }
    @keyframes sdSlideIn {
      from { opacity:0; transform:translateX(20px); }
      to   { opacity:1; transform:translateX(0); }
    }
    @keyframes typingBounce {
      0%,80%,100% { transform:translateY(0);   opacity:0.4; }
      40%          { transform:translateY(-5px); opacity:1;   }
    }

    /* Empty state flex helper */
    .chat-empty-state {
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      flex:1; padding:40px 20px; text-align:center; pointer-events:none;
    }

    /* Recommend button */
    .recommend-btn {
      position: relative;
      width:100%;
      padding:10px 14px;
      background:linear-gradient(135deg,rgba(212,175,55,0.18),rgba(212,175,55,0.08));
      border:1px solid rgba(212,175,55,0.5);
      border-radius:10px;
      color:#D4AF37;
      font-size:12px;
      font-weight:700;
      cursor:pointer;
      display:flex;
      align-items:center;
      justify-content:center;
      gap:7px;
      transition:all 0.2s;
      letter-spacing:0.3px;
      overflow:hidden;
    }
    .recommend-btn::after {
      content:'';
      position:absolute;
      inset:0;
      background:linear-gradient(135deg,rgba(212,175,55,0.25),transparent);
      opacity:0;
      transition:opacity 0.25s;
    }
    .recommend-btn:hover:not(:disabled)::after { opacity:1; }
    .recommend-btn:hover:not(:disabled) {
      box-shadow:0 6px 22px rgba(212,175,55,0.35);
      transform:translateY(-1px);
    }
    .recommend-btn:active:not(:disabled) { transform:scale(0.98); }
    .rec-card-seller { border-bottom-right-radius:6px !important; }

    /* Buyer typing indicator bar */
    .buyer-typing-bar {
      display:flex;
      align-items:center;
      gap:5px;
      padding:6px 14px;
      font-size:11px;
      color:#6b7280;
      background:rgba(0,0,0,0.4);
      border-bottom:1px solid rgba(255,255,255,0.04);
      flex-shrink:0;
    }
    .typing-dot {
      width:6px; height:6px;
      border-radius:50%;
      background:#6b7280;
      animation:typingBounce 1.4s infinite;
    }
    .typing-dot:nth-child(2) { animation-delay:0.2s; }
    .typing-dot:nth-child(3) { animation-delay:0.4s; }
  `;
  document.head.appendChild(s);
})();

// ──────────────────────────────────────────────────────────────
//  BOOTSTRAP
// ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderMenu();
  // renderChat() is now driven by Supabase realtime listener
  checkCartEvents();
  checkBuyerTyping();

  // Start the Supabase chat listener
  // SellerDashboard.js fires its DOMContentLoaded first; supabaseClient is set there.
  // We defer slightly to guarantee supabaseClient is initialized.
  setTimeout(() => {
    attachBuyerMessageListener();
  }, 200);

  // Init send-button dim state
  const chatInput = document.getElementById('seller-chat-input');
  chatInput?.addEventListener('input', syncSendBtn);
  syncSendBtn();

  // Mark messages read when seller interacts with chat panel
  document.getElementById('chat-panel')?.addEventListener('click', markAllRead);
});
