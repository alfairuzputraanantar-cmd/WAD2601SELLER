// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCIYc8Epfu3jmrewyRaVGc4ISm7qKxG03k",
  authDomain: "localluxury-cb0d7.firebaseapp.com",
  projectId: "localluxury-cb0d7",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ADD PRODUCT
async function addProduct() {
  const name = document.getElementById("name").value.trim();
  const price = Number(document.getElementById("price").value);
  const tags = document.getElementById("tags").value
    .split(",")
    .map(t => t.trim())
    .filter(Boolean);

  if (!name || !price) return alert("Complete the form.");

  await db.collection("products").add({
    name,
    price,
    tags,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  document.getElementById("name").value = "";
  document.getElementById("price").value = "";
  document.getElementById("tags").value = "";
}

// DELETE PRODUCT
async function deleteProduct(id) {
  if (!confirm("Remove this product from catalog?")) return;
  await db.collection("products").doc(id).delete();
}

// REALTIME CATALOG
db.collection("products")
  .orderBy("createdAt", "desc")
  .onSnapshot(snapshot => {
    const list = document.getElementById("productList");
    list.innerHTML = "";

    if (snapshot.empty) {
      list.innerHTML = `<p style="opacity:.6">No products yet</p>`;
      return;
    }

    snapshot.forEach(doc => {
      const p = doc.data();

      const card = document.createElement("div");
      card.className = "product-card";

      card.innerHTML = `
        <button class="delete-btn" onclick="deleteProduct('${doc.id}')">✕</button>
        <h3 class="product-name">${p.name}</h3>
        <p class="product-price">Rp ${p.price.toLocaleString()}</p>
        <div class="tag-row">
          ${(p.tags || []).map(tag =>
            `<span class="tag">${tag}</span>`
          ).join("")}
        </div>
      `;

      list.appendChild(card);
    });
  });

  