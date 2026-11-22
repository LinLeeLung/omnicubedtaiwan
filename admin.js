import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const adminEmail = 'linlilung@gmail.com';
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
const loginPanel = document.querySelector('#login-panel');
const catalogPanel = document.querySelector('#catalog-panel');
const loginStatus = document.querySelector('#login-status');
const adminStatus = document.querySelector('#admin-status');
const accountLabel = document.querySelector('#account-label');
const signInButton = document.querySelector('#google-sign-in');
const signOutButton = document.querySelector('#sign-out');
const importButton = document.querySelector('#import-catalog');
const productRows = document.querySelector('#product-rows');
const searchInput = document.querySelector('#catalog-search');
const categoryFilter = document.querySelector('#category-filter');
const emptyState = document.querySelector('#empty-state');
const categoryLabels = {
  clamps: '搬運夾具',
  transport: '搬運設備',
  'spare-parts': '零配件',
  tape: '施工膠帶',
  reinforcement: '支撐設備',
  'seam-setters': '接縫調整',
};
let products = [];
let currentUser = null;
let sourceCatalog = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function showStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('is-error', isError);
  element.classList.toggle('is-success', Boolean(message) && !isError);
}

function getSignInErrorMessage(error) {
  if (error.code === 'auth/operation-not-allowed') {
    return 'Firebase Authentication 尚未啟用 Google 登入，請在 Firebase Console 開啟 Google provider。';
  }
  if (error.code === 'auth/unauthorized-domain') {
    return '目前網站網域尚未加入 Firebase Authentication 的授權網域。';
  }
  if (error.code === 'auth/popup-closed-by-user') {
    return 'Google 登入視窗已關閉，請重新嘗試並完成登入。';
  }
  if (error.code === 'auth/network-request-failed') {
    return '無法連線至 Google 登入服務，請檢查網路或瀏覽器封鎖設定。';
  }
  if (error.code === 'auth/invalid-api-key') {
    return 'Firebase Web API 設定無效，請檢查 Firebase 專案設定。';
  }
  return `登入失敗${error.code ? `（${error.code}）` : ''}，請依錯誤代碼檢查 Google 登入設定。`;
}

function getCategoryLabel(category) {
  return categoryLabels[category] || category;
}

function updateStats() {
  document.querySelector('#total-count').textContent = String(products.length);
  document.querySelector('#published-count').textContent = String(
    products.filter((product) => product.published).length,
  );
  document.querySelector('#priced-count').textContent = String(
    products.filter((product) => Number.isSafeInteger(product.priceTwd) && product.priceTwd >= 0).length,
  );
}

function renderCategoryOptions() {
  const categories = [...new Set(products.map((product) => product.category))].sort((a, b) => (
    getCategoryLabel(a).localeCompare(getCategoryLabel(b), 'zh-Hant')
  ));
  categoryFilter.innerHTML = '<option value="all">全部分類</option>';
  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = getCategoryLabel(category);
    categoryFilter.append(option);
  });
}

function safeOriginalUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin === 'https://www.omnicubedeurope.com' && url.pathname.startsWith('/webshop/')) {
      return url.href;
    }
  } catch {
    return '';
  }
  return '';
}

function renderProducts() {
  const queryText = searchInput.value.trim().toLocaleLowerCase();
  const selectedCategory = categoryFilter.value;
  const visibleProducts = products.filter((product) => {
    const matchesText = `${product.name} ${getCategoryLabel(product.category)}`
      .toLocaleLowerCase()
      .includes(queryText);
    const matchesCategory = selectedCategory === 'all' || product.category === selectedCategory;
    return matchesText && matchesCategory;
  });

  emptyState.hidden = visibleProducts.length > 0;
  productRows.innerHTML = visibleProducts.map((product) => {
    const sourceUrl = safeOriginalUrl(product.sourceUrl);
    const imageUrl = product.image && new URL(product.image).origin === 'https://www.omnicubedeurope.com'
      ? product.image
      : '';
    const imageMarkup = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy">`
      : '';
    const priceValue = Number.isSafeInteger(product.priceTwd) && product.priceTwd >= 0
      ? String(product.priceTwd)
      : '';

    return `
      <tr data-id="${escapeHtml(product.id)}">
        <td>
          <div class="product-cell">
            <div class="product-thumb">${imageMarkup}</div>
            <div class="product-name">
              <strong>${escapeHtml(product.name)}</strong>
              ${sourceUrl
    ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">查看原廠頁面 ↗</a>`
    : '<span>原廠連結不可用</span>'}
            </div>
          </div>
        </td>
        <td class="category-cell">${escapeHtml(getCategoryLabel(product.category))}</td>
        <td>
          <label class="price-input-wrap">
            <span>NT$</span>
            <input class="price-input" type="number" min="0" max="1000000000" step="1"
              value="${priceValue}" aria-label="${escapeHtml(product.name)} 台幣售價"
              placeholder="詢價">
          </label>
        </td>
        <td>
          <input class="publish-toggle" type="checkbox" ${product.published ? 'checked' : ''}
            aria-label="上架 ${escapeHtml(product.name)}">
        </td>
        <td>
          <button class="save-button" type="button" data-save>儲存</button>
          <span class="row-status" aria-live="polite"></span>
        </td>
      </tr>
    `;
  }).join('');

  productRows.querySelectorAll('.product-thumb img').forEach((image) => {
    image.addEventListener('error', () => image.parentElement.classList.add('is-fallback'), { once: true });
  });
}

async function loadProducts() {
  showStatus(adminStatus, '正在讀取商品目錄...');
  try {
    const snapshot = await getDocs(collection(db, 'products'));
    products = snapshot.docs.map((productDocument) => ({
      id: productDocument.id,
      ...productDocument.data(),
    })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    renderCategoryOptions();
    renderProducts();
    updateStats();
    if (products.length) {
      showStatus(adminStatus, `已載入 ${products.length} 項原廠產品。`);
    } else {
      showStatus(adminStatus, '尚未匯入商品目錄，請先匯入原廠產品。');
    }
  } catch (error) {
    console.error('Unable to load the product catalog.', error);
    showStatus(adminStatus, '無法讀取目錄。請確認 Firestore Rules 已部署，且管理帳號有權限。', true);
  }
}

async function loadSourceCatalog() {
  if (sourceCatalog) return sourceCatalog;
  const response = await fetch('/catalog-seed.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Catalog source request failed with status ${response.status}.`);
  }
  sourceCatalog = await response.json();
  if (!Array.isArray(sourceCatalog)) {
    throw new Error('The original product catalog has an invalid format.');
  }
  return sourceCatalog;
}

async function importMissingProducts() {
  if (!currentUser) return;
  importButton.disabled = true;
  showStatus(adminStatus, '正在檢查原廠目錄並匯入尚未建立的商品...');

  try {
    const [catalog, existingSnapshot] = await Promise.all([
      loadSourceCatalog(),
      getDocs(collection(db, 'products')),
    ]);
    const existingIds = new Set(existingSnapshot.docs.map((productDocument) => productDocument.id));
    const missingProducts = catalog.filter((product) => !existingIds.has(product.id));

    if (missingProducts.length) {
      const batch = writeBatch(db);
      missingProducts.forEach((product) => {
        batch.set(doc(db, 'products', product.id), {
          name: product.name,
          category: product.category,
          image: product.image,
          sourceUrl: product.sourceUrl,
          priceTwd: null,
          published: product.published === true,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }

    await setDoc(doc(db, 'siteSettings', 'catalog'), {
      initialized: true,
      updatedAt: serverTimestamp(),
    });
    await loadProducts();
    showStatus(
      adminStatus,
      missingProducts.length
        ? `目錄匯入完成，新增 ${missingProducts.length} 項商品；原有設定已保留。`
        : '原廠目錄已完整，沒有需要新增的商品。',
    );
  } catch (error) {
    console.error('Unable to import the original product catalog.', error);
    showStatus(adminStatus, '目錄匯入失敗。請確認網路連線與 Firestore Rules，之後可安全重試。', true);
  } finally {
    importButton.disabled = false;
  }
}

async function saveProduct(row) {
  if (!currentUser) return;
  const product = products.find((item) => item.id === row.dataset.id);
  if (!product) {
    showStatus(adminStatus, '找不到這項商品，請重新載入頁面。', true);
    return;
  }

  const priceInput = row.querySelector('.price-input');
  const priceText = priceInput.value.trim();
  const priceTwd = priceText === '' ? null : Number(priceText);
  const rowStatus = row.querySelector('.row-status');
  const saveButton = row.querySelector('[data-save]');

  if (priceTwd !== null && (!Number.isSafeInteger(priceTwd) || priceTwd < 0 || priceTwd > 1000000000)) {
    showStatus(rowStatus, '售價需為 0 至 1,000,000,000 的整數。', true);
    return;
  }

  saveButton.disabled = true;
  showStatus(rowStatus, '儲存中...');
  try {
    const published = row.querySelector('.publish-toggle').checked;
    await updateDoc(doc(db, 'products', product.id), {
      priceTwd,
      published,
      updatedAt: serverTimestamp(),
    });
    product.priceTwd = priceTwd;
    product.published = published;
    updateStats();
    showStatus(rowStatus, '已儲存');
    showStatus(adminStatus, '商品設定已儲存；網站商品清單會即時更新。');
  } catch (error) {
    console.error(`Unable to save product ${product.id}.`, error);
    showStatus(rowStatus, '儲存失敗', true);
    showStatus(adminStatus, '儲存失敗。請確認登入帳號與 Firestore Rules。', true);
  } finally {
    saveButton.disabled = false;
  }
}

signInButton.addEventListener('click', async () => {
  signInButton.disabled = true;
  showStatus(loginStatus, '正在開啟 Google 登入...');
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error('Google sign-in failed.', error);
    if (error.code === 'auth/popup-blocked') {
      showStatus(loginStatus, '登入視窗遭瀏覽器阻擋，正在改用重新導向登入...');
      try {
        await signInWithRedirect(auth, provider);
        return;
      } catch (redirectError) {
        console.error('Google redirect sign-in failed.', redirectError);
        showStatus(loginStatus, getSignInErrorMessage(redirectError), true);
      }
    } else {
      showStatus(loginStatus, getSignInErrorMessage(error), true);
    }
  } finally {
    signInButton.disabled = false;
  }
});

getRedirectResult(auth).catch((error) => {
  console.error('Google redirect sign-in failed.', error);
  showStatus(loginStatus, getSignInErrorMessage(error), true);
});

signOutButton.addEventListener('click', async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Unable to sign out.', error);
    showStatus(adminStatus, '登出失敗，請重新整理頁面。', true);
  }
});

signOutButton.hidden = true;
importButton.addEventListener('click', importMissingProducts);
searchInput.addEventListener('input', renderProducts);
categoryFilter.addEventListener('change', renderProducts);
productRows.addEventListener('click', (event) => {
  const button = event.target.closest('[data-save]');
  if (button) saveProduct(button.closest('tr'));
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    accountLabel.textContent = '尚未登入';
    signOutButton.hidden = true;
    catalogPanel.hidden = true;
    loginPanel.hidden = false;
    signInButton.disabled = false;
    return;
  }

  if (user.email?.toLowerCase() !== adminEmail || !user.emailVerified) {
    currentUser = null;
    showStatus(loginStatus, `此後台僅開放已驗證的 ${adminEmail} 登入。`, true);
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Unable to clear an unauthorized session.', error);
    }
    return;
  }

  currentUser = user;
  accountLabel.textContent = user.email;
  signOutButton.hidden = false;
  loginPanel.hidden = true;
  catalogPanel.hidden = false;
  await loadProducts();
});
