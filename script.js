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
async function addProduct() {
  const name = document.getElementById("name").value.trim();
  const price = Number(document.getElementById("price").value);
  const stock = Number(document.getElementById("stock").value);
  const tags = document.getElementById("tags").value.split(",").map(t => t.trim()).filter(Boolean);
  if (!name || !price) return alert("Complete the form.");
  if (stock < 0) return alert("Stock cannot be negative.");
  await db.collection("products").add({
    name, price, tags, stock: stock || 0,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  document.getElementById("name").value = "";
  document.getElementById("price").value = "";
  document.getElementById("stock").value = "";
  document.getElementById("tags").value = "";
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
  const list = document.getElementById("productList");
  list.innerHTML = "";
  if (snapshot.empty) {
    list.innerHTML = `<p style="opacity:.6;padding:20px;">No products yet</p>`;
    return;
  }
  snapshot.forEach(doc => {
    const p = doc.data();
    const stock = p.stock ?? 0;
    const stockColor = stock === 0 ? '#ef4444' : stock <= 5 ? '#f59e0b' : '#4ade80';
    const stockLabel = stock === 0 ? 'Out of Stock' : stock <= 5 ? `Low Stock: ${stock}` : `In Stock: ${stock}`;
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <button class="delete-btn" onclick="deleteProduct('${doc.id}')">✕</button>
      <h3 class="product-name">${p.name}</h3>
      <p class="product-price">Rp ${p.price.toLocaleString()}</p>
      <div class="tag-row" style="margin-bottom:10px;">
        ${(p.tags || []).map(tag => `<span class="tag">${tag}</span>`).join("")}
      </div>
      <!-- Stock Display -->
      <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Stock</span>
          <span style="font-size:12px;font-weight:700;color:${stockColor};">${stockLabel}</span>
        </div>
        <!-- Quick +/- buttons -->
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          <button onclick="updateStock('${doc.id}',-1)" style="width:28px;height:28px;background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);border-radius:6px;color:#ef4444;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>
          <span style="flex:1;text-align:center;font-size:18px;font-weight:700;color:${stockColor};">${stock}</span>
          <button onclick="updateStock('${doc.id}',1)" style="width:28px;height:28px;background:rgba(74,222,128,0.2);border:1px solid rgba(74,222,128,0.4);border-radius:6px;color:#4ade80;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>
        </div>
        <!-- Set exact stock -->
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

function openConversation(convId, buyerName) {
  activeConvId = convId;
  document.getElementById('conversation-tabs').classList.add('hidden');
  document.getElementById('chat-window-area').classList.remove('hidden');
  document.getElementById('active-username').textContent = buyerName;
  document.getElementById('active-avatar').textContent = buyerName[0].toUpperCase();
  db.collection('chats').doc(convId).update({ unreadSeller: 0 });
  if (activeMessagesUnsubscribe) activeMessagesUnsubscribe();
  activeMessagesUnsubscribe = db.collection('chats').doc(convId)
    .collection('messages').orderBy('createdAt', 'asc')
    .onSnapshot(snapshot => {
      const container = document.getElementById('chat-messages');
      container.innerHTML = '';
      snapshot.forEach(doc => {
        const msg = doc.data();
        const isSeller = msg.sender === 'seller';
        const time = msg.createdAt?.toDate ? formatTime(msg.createdAt.toDate()) : '';
        const div = document.createElement('div');
        div.className = `msg-row ${isSeller ? 'msg-row-seller' : 'msg-row-buyer'}`;
        div.innerHTML = `<div class="msg-bubble ${isSeller ? 'msg-seller' : 'msg-buyer'}"><p>${msg.text}</p><span class="msg-time">${time}</span></div>`;
        container.appendChild(div);
      });
      container.scrollTop = container.scrollHeight;
    });
}

function backToList() {
  activeConvId = null;
  if (activeMessagesUnsubscribe) { activeMessagesUnsubscribe(); activeMessagesUnsubscribe = null; }
  document.getElementById('conversation-tabs').classList.remove('hidden');
  document.getElementById('chat-window-area').classList.add('hidden');
}

async function sendSellerMessage() {
  if (!activeConvId) return;
  const input = document.getElementById('seller-chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const now = firebase.firestore.FieldValue.serverTimestamp();
  await db.collection('chats').doc(activeConvId).collection('messages').add({ text, sender: 'seller', createdAt: now });
  await db.collection('chats').doc(activeConvId).update({ lastMessage: text, lastMessageAt: now, unreadBuyer: firebase.firestore.FieldValue.increment(1) });
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
}

function formatTime(date) {
  const diff = new Date() - date;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

listenConversations();