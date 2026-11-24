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
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import { firebaseConfig } from './firebase-config.js';

const adminEmail = 'linlilung@gmail.com';
const defaultPricingRates = {
  dutyPercent: 10,
  shippingPercent: 10,
  marginPercent: 40,
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, 'asia-east1');
const refreshAllPricing = httpsCallable(functions, 'refreshAllProductPricing', { timeout: 540000 });
const calculateSuggestedPrice = httpsCallable(functions, 'calculateSuggestedPrice');
const provider = new GoogleAuthProvider();
const loginPanel = document.querySelector('#login-panel');
const catalogPanel = document.querySelector('#catalog-panel');
const loginStatus = document.querySelector('#login-status');
const adminStatus = document.querySelector('#admin-status');
const accountLabel = document.querySelector('#account-label');
const signInButton = document.querySelector('#google-sign-in');
const signOutButton = document.querySelector('#sign-out');
const importButton = document.querySelector('#import-catalog');
const refreshAllPricingButton = document.querySelector('#refresh-all-pricing');
const pricingRefreshStatus = document.querySelector('#pricing-refresh-status');
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
let productPricing = new Map();
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

function formatTwd(value) {
  return Number.isFinite(value) ? `NT$ ${Math.round(value).toLocaleString('zh-TW')}` : '—';
}

function formatTimestamp(value) {
  const date = value && typeof value.toDate === 'function'
    ? value.toDate()
    : value instanceof Date
      ? value
      : null;
  return date
    ? new Intl.DateTimeFormat('zh-TW', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Taipei',
    }).format(date)
    : '尚無取得紀錄';
}

function renderPricingPanel(product, pricing = {}) {
  const calculation = pricing.calculation || {};
  const dutyPercent = Number.isFinite(pricing.dutyPercent)
    ? pricing.dutyPercent
    : defaultPricingRates.dutyPercent;
  const shippingPercent = Number.isFinite(pricing.shippingPercent)
    ? pricing.shippingPercent
    : defaultPricingRates.shippingPercent;
  const marginPercent = Number.isFinite(pricing.marginPercent)
    ? pricing.marginPercent
    : defaultPricingRates.marginPercent;
  const hasSuggestedPrice = Number.isSafeInteger(pricing.suggestedPriceTwd)
    && pricing.suggestedPriceTwd > 0;
  const sourcePrice = Number.isFinite(pricing.sourcePrice)
    ? `${escapeHtml(pricing.currency || '')} ${pricing.sourcePrice.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })}`
    : '尚未取得原廠報價';
  const sourceType = !Number.isFinite(pricing.sourcePrice)
    ? '尚無報價'
    : pricing.sourceType === 'manual'
      ? '手動登錄'
      : '原廠頁面擷取';
  const exchangeRateMetadata = pricing.exchangeRateSource === '手動輸入'
    ? '匯率由管理員手動設定'
    : pricing.exchangeRateSource
      ? `資料日期 ${escapeHtml(formatTimestamp(pricing.exchangeRateAsOf))}・取得時間 ${escapeHtml(formatTimestamp(pricing.exchangeRateFetchedAt))}`
      : '尚無自動取得紀錄';
  const calculationDetails = hasSuggestedPrice
    ? `<ul class="calculation-breakdown">
        <li><span>經銷進貨價（原廠價 × 70%）</span><strong>${formatTwd(calculation.dealerCostTwd)}</strong></li>
        <li><span>關稅</span><strong>${formatTwd(calculation.dutyTwd)}</strong></li>
        <li><span>運輸成本</span><strong>${formatTwd(calculation.shippingTwd)}</strong></li>
        <li><span>含費用總成本</span><strong>${formatTwd(calculation.totalCostTwd)}</strong></li>
      </ul>`
    : '<p class="pricing-hint">儲存報價與費率後即可試算。建議售價不會自動更新網站。</p>';

  return `
    <details class="pricing-panel">
      <summary>原廠報價與成本試算</summary>
      <div class="pricing-content">
        <div class="source-quote">
          <div>
            <span class="field-caption">目前原廠未稅報價</span>
            <strong>${sourcePrice}</strong>
            <small>${escapeHtml(sourceType)}・${escapeHtml(formatTimestamp(pricing.sourceFetchedAt))}</small>
          </div>
        </div>
        <div class="pricing-grid">
          <label>手動報價金額
            <input data-source-price type="number" min="0.01" max="1000000000" step="0.01"
              placeholder="無法自動取得時輸入">
          </label>
          <label>幣別
            <input data-currency type="text" maxlength="3" pattern="[A-Za-z]{3}" value="${escapeHtml(pricing.currency || 'GBP')}"
              aria-label="${escapeHtml(product.name)} 報價幣別">
          </label>
          <button class="button button-muted manual-quote-button" type="button" data-action="manual-quote">記錄手動報價</button>
        </div>
        <div class="pricing-grid pricing-rate-grid">
          <div class="exchange-rate-field">
            <label>台幣匯率 <small>1 單位外幣兌台幣</small>
              <input data-exchange-rate type="number" min="0.000001" max="1000000" step="0.0001"
                value="${Number.isFinite(pricing.exchangeRate) ? escapeHtml(pricing.exchangeRate) : ''}" placeholder="例如 41.5">
            </label>
            <small class="exchange-rate-meta">${exchangeRateMetadata}</small>
            <small class="rate-attribution">匯率來源：<a href="https://www.exchangerate-api.com/docs/free" target="_blank" rel="noreferrer">ExchangeRate-API Open Access</a>（約每日更新）</small>
          </div>
          <label>關稅 <small>以台幣經銷進貨價計算</small>
            <span class="percent-input"><input data-duty-percent type="number" min="0" max="1000" step="0.01"
              value="${escapeHtml(dutyPercent)}" placeholder="10"><span>%</span></span>
          </label>
          <label>運輸成本 <small>以台幣經銷進貨價計算</small>
            <span class="percent-input"><input data-shipping-percent type="number" min="0" max="1000" step="0.01"
              value="${escapeHtml(shippingPercent)}" placeholder="10"><span>%</span></span>
          </label>
          <label>期望毛利率 <small>售價＝總成本 ÷ (1 − 毛利率)</small>
            <span class="percent-input"><input data-margin-percent type="number" min="0" max="99.99" step="0.01"
              value="${escapeHtml(marginPercent)}" placeholder="40"><span>%</span></span>
          </label>
        </div>
        <div class="pricing-actions">
          <button class="button button-muted" type="button" data-action="save-pricing">儲存費率</button>
          <button class="button button-outline" type="button" data-action="calculate-price">計算建議售價</button>
        </div>
        <div class="suggested-price">
          <div>
            <span class="field-caption">建議台幣售價</span>
            <strong>${hasSuggestedPrice ? formatTwd(pricing.suggestedPriceTwd) : '尚未試算'}</strong>
            ${calculationDetails}
          </div>
          <button class="button button-dark" type="button" data-action="apply-price" ${hasSuggestedPrice ? '' : 'disabled'}>
            確認並更新網站售價
          </button>
        </div>
        <div class="pricing-history">
          <button class="history-button" type="button" data-action="quote-history">查看原廠報價紀錄</button>
          <ul data-quote-history hidden></ul>
        </div>
        <p class="row-status pricing-status" aria-live="polite"></p>
      </div>
    </details>
  `;
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
  const expandedPricingPanels = new Set(
    [...productRows.querySelectorAll('tr[data-id]')].filter((row) => {
      const panel = row.querySelector('.pricing-panel');
      return panel && panel.open;
    }).map((row) => row.dataset.id),
  );
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
    const pricing = productPricing.get(product.id) || {};
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
              ${renderPricingPanel(product, pricing)}
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

  productRows.querySelectorAll('tr[data-id]').forEach((row) => {
    const panel = row.querySelector('.pricing-panel');
    if (panel && expandedPricingPanels.has(row.dataset.id)) {
      panel.open = true;
    }
  });

  productRows.querySelectorAll('.product-thumb img').forEach((image) => {
    image.addEventListener('error', () => image.parentElement.classList.add('is-fallback'), { once: true });
  });
}

async function loadProducts() {
  showStatus(adminStatus, '正在讀取商品目錄...');
  try {
    const [snapshot, pricingSnapshot] = await Promise.all([
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'productPricing')),
    ]);
    products = snapshot.docs.map((productDocument) => ({
      id: productDocument.id,
      ...productDocument.data(),
    })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    productPricing = new Map(pricingSnapshot.docs.map((pricingDocument) => [
      pricingDocument.id,
      pricingDocument.data(),
    ]));
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

function getPricingProduct(row) {
  const product = products.find((item) => item.id === row.dataset.id);
  if (!product) {
    showStatus(adminStatus, '找不到這項商品，請重新載入頁面。', true);
  }
  return product;
}

function getPricingInputs(row) {
  const fields = [
    row.querySelector('[data-exchange-rate]'),
    row.querySelector('[data-duty-percent]'),
    row.querySelector('[data-shipping-percent]'),
    row.querySelector('[data-margin-percent]'),
  ];
  if (fields.some((field) => !field.value.trim())) {
    throw new Error('請填寫匯率、關稅、運輸費率與期望毛利率；若費率為零，請明確輸入 0。');
  }
  const values = {
    exchangeRate: Number(fields[0].value),
    dutyPercent: Number(fields[1].value),
    shippingPercent: Number(fields[2].value),
    marginPercent: Number(fields[3].value),
  };
  if (
    !Number.isFinite(values.exchangeRate)
    || values.exchangeRate <= 0
    || !Number.isFinite(values.dutyPercent)
    || values.dutyPercent < 0
    || values.dutyPercent > 1000
    || !Number.isFinite(values.shippingPercent)
    || values.shippingPercent < 0
    || values.shippingPercent > 1000
    || !Number.isFinite(values.marginPercent)
    || values.marginPercent < 0
    || values.marginPercent >= 100
  ) {
    throw new Error('請輸入有效匯率、0% 至 1000% 的關稅／運輸費率，以及低於 100% 的毛利率。');
  }
  return values;
}

async function refreshPricing(productId, message) {
  const snapshot = await getDoc(doc(db, 'productPricing', productId));
  if (snapshot.exists()) {
    productPricing.set(productId, snapshot.data());
  }
  renderProducts();
  const row = [...productRows.querySelectorAll('tr')].find((item) => item.dataset.id === productId);
  if (row && message) showStatus(row.querySelector('.pricing-status'), message);
}

async function saveManualQuote(row) {
  const product = getPricingProduct(row);
  if (!product) return;
  const price = Number(row.querySelector('[data-source-price]').value);
  const currency = row.querySelector('[data-currency]').value.trim().toUpperCase();
  const status = row.querySelector('.pricing-status');
  const button = row.querySelector('[data-action="manual-quote"]');
  if (!Number.isFinite(price) || price <= 0 || price > 1000000000 || !/^[A-Z]{3}$/.test(currency)) {
    showStatus(status, '請輸入大於 0 的報價金額及 3 碼幣別代碼（例如 GBP）。', true);
    return;
  }

  button.disabled = true;
  showStatus(status, '正在記錄手動報價...');
  try {
    const pricingRef = doc(db, 'productPricing', product.id);
    const quoteRef = doc(collection(db, 'productPricing', product.id, 'sourceQuotes'));
    const capturedAt = serverTimestamp();
    const batch = writeBatch(db);
    batch.set(quoteRef, {
      sourcePrice: price,
      currency,
      sourceType: 'manual',
      sourceUrl: safeOriginalUrl(product.sourceUrl),
      capturedAt,
      capturedBy: currentUser.email,
    });
    batch.set(pricingRef, {
      sourcePrice: price,
      currency,
      sourceType: 'manual',
      sourceFetchedAt: capturedAt,
      sourceUrl: safeOriginalUrl(product.sourceUrl),
      suggestedPriceTwd: deleteField(),
      calculation: deleteField(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    await refreshPricing(product.id, '手動報價與登錄時間已記錄。');
  } catch (error) {
    console.error(`Unable to save manual quote for ${product.id}.`, error);
    showStatus(status, '手動報價儲存失敗，請確認 Firestore Rules 後重試。', true);
  } finally {
    button.disabled = false;
  }
}

async function savePricingSettings(row) {
  const product = getPricingProduct(row);
  if (!product) return false;
  const status = row.querySelector('.pricing-status');
  try {
    const pricing = productPricing.get(product.id) || {};
    if (!Number.isFinite(pricing.sourcePrice) || !/^[A-Z]{3}$/.test(pricing.currency || '')) {
      throw new Error('請先自動取得或手動記錄原廠未稅報價。');
    }
    const values = getPricingInputs(row);
    const exchangeRateChanged = values.exchangeRate !== pricing.exchangeRate;
    await setDoc(doc(db, 'productPricing', product.id), {
      ...values,
      ...(exchangeRateChanged
        ? {
          exchangeRateSource: '手動輸入',
          exchangeRateAsOf: deleteField(),
          exchangeRateFetchedAt: deleteField(),
        }
        : {}),
      suggestedPriceTwd: deleteField(),
      calculation: deleteField(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    productPricing.set(product.id, {
      ...pricing,
      ...values,
      ...(exchangeRateChanged
        ? {
          exchangeRateSource: '手動輸入',
          exchangeRateAsOf: undefined,
          exchangeRateFetchedAt: undefined,
        }
        : {}),
      suggestedPriceTwd: undefined,
      calculation: undefined,
    });
    showStatus(status, '匯率與費率已儲存。');
    return true;
  } catch (error) {
    showStatus(status, error.message, true);
    return false;
  }
}

async function calculateProductPrice(row) {
  const product = getPricingProduct(row);
  if (!product) return;
  const button = row.querySelector('[data-action="calculate-price"]');
  if (!(await savePricingSettings(row))) return;
  button.disabled = true;
  showStatus(row.querySelector('.pricing-status'), '正在計算建議售價...');
  try {
    await calculateSuggestedPrice({ productId: product.id });
    await refreshPricing(product.id, '建議售價已試算，尚未套用到網站。');
  } catch (error) {
    console.error(`Unable to calculate suggested price for ${product.id}.`, error);
    showStatus(row.querySelector('.pricing-status'), error.message || '建議售價計算失敗。', true);
  } finally {
    button.disabled = false;
  }
}

async function applySuggestedPrice(row) {
  const product = getPricingProduct(row);
  if (!product) return;
  const pricing = productPricing.get(product.id);
  const suggestedPriceTwd = pricing && pricing.suggestedPriceTwd;
  const status = row.querySelector('.pricing-status');
  const button = row.querySelector('[data-action="apply-price"]');
  if (!Number.isSafeInteger(suggestedPriceTwd) || suggestedPriceTwd <= 0) {
    showStatus(status, '請先完成有效的建議售價試算。', true);
    return;
  }

  button.disabled = true;
  showStatus(status, '正在更新網站售價...');
  try {
    await updateDoc(doc(db, 'products', product.id), {
      priceTwd: suggestedPriceTwd,
      updatedAt: serverTimestamp(),
    });
    product.priceTwd = suggestedPriceTwd;
    updateStats();
    renderProducts();
    const updatedRow = [...productRows.querySelectorAll('tr')].find((item) => item.dataset.id === product.id);
    if (updatedRow) {
      updatedRow.querySelector('.price-input').value = String(suggestedPriceTwd);
      showStatus(updatedRow.querySelector('.pricing-status'), '已確認，網站售價已更新。');
    }
  } catch (error) {
    console.error(`Unable to apply suggested price for ${product.id}.`, error);
    showStatus(status, '更新網站售價失敗，請確認 Firestore Rules 後重試。', true);
  } finally {
    button.disabled = false;
  }
}

async function showQuoteHistory(row) {
  const product = getPricingProduct(row);
  if (!product) return;
  const list = row.querySelector('[data-quote-history]');
  const button = row.querySelector('[data-action="quote-history"]');
  const status = row.querySelector('.pricing-status');
  button.disabled = true;
  showStatus(status, '正在讀取報價紀錄...');
  try {
    const quotes = await getDocs(query(
      collection(db, 'productPricing', product.id, 'sourceQuotes'),
      orderBy('capturedAt', 'desc'),
      limit(10),
    ));
    list.innerHTML = quotes.empty
      ? '<li>尚無報價紀錄。</li>'
      : quotes.docs.map((quoteDocument) => {
        const quote = quoteDocument.data();
        const type = quote.sourceType === 'manual' ? '手動' : '自動擷取';
        return `<li>${escapeHtml(type)}・${escapeHtml(quote.currency)} ${escapeHtml(quote.sourcePrice)}・${escapeHtml(formatTimestamp(quote.capturedAt))}</li>`;
      }).join('');
    list.hidden = false;
    showStatus(status, '已載入最近 10 筆報價紀錄。');
  } catch (error) {
    console.error(`Unable to load quote history for ${product.id}.`, error);
    showStatus(status, '無法讀取報價紀錄，請確認 Firestore Rules。', true);
  } finally {
    button.disabled = false;
  }
}

async function updateAllProductPricing() {
  if (!currentUser) return;
  refreshAllPricingButton.disabled = true;
  showStatus(pricingRefreshStatus, '正在更新全部商品報價與匯率，請保持頁面開啟...');
  try {
    const result = await refreshAllPricing({});
    await loadProducts();
    const { totalProducts, updatedProducts, failedProducts, updatedCurrencies } = result.data;
    const summary = `更新完成：成功 ${updatedProducts}/${totalProducts} 項商品；匯率幣別：${updatedCurrencies.join(', ') || '無'}。`;
    if (failedProducts.length) {
      const failures = failedProducts.slice(0, 5)
        .map((item) => `${item.name}：${item.reason}`)
        .join('；');
      const remainder = failedProducts.length > 5
        ? `；另有 ${failedProducts.length - 5} 項未列出`
        : '';
      showStatus(
        pricingRefreshStatus,
        `${summary} 未成功 ${failedProducts.length} 項：${failures}${remainder}`,
        true,
      );
    } else {
      showStatus(pricingRefreshStatus, summary);
    }
  } catch (error) {
    console.error('Unable to refresh pricing for the full product catalog.', error);
    showStatus(pricingRefreshStatus, error.message || '全商品更新失敗，請稍後重試。', true);
  } finally {
    refreshAllPricingButton.disabled = false;
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
refreshAllPricingButton.addEventListener('click', updateAllProductPricing);
searchInput.addEventListener('input', renderProducts);
categoryFilter.addEventListener('change', renderProducts);
productRows.addEventListener('input', (event) => {
  const field = event.target.closest(
    '[data-source-price], [data-currency], [data-exchange-rate], [data-duty-percent], [data-shipping-percent], [data-margin-percent]',
  );
  if (!field) return;
  const row = field.closest('tr');
  const applyButton = row.querySelector('[data-action="apply-price"]');
  if (applyButton && !applyButton.disabled) {
    applyButton.disabled = true;
    showStatus(row.querySelector('.pricing-status'), '資料已變更，請先儲存並重新試算。');
  }
});
productRows.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const row = actionButton.closest('tr');
    const actions = {
      'manual-quote': saveManualQuote,
      'save-pricing': async (item) => {
        const saved = await savePricingSettings(item);
        if (saved) await refreshPricing(item.dataset.id, '匯率與費率已儲存。');
      },
      'calculate-price': calculateProductPrice,
      'apply-price': applySuggestedPrice,
      'quote-history': showQuoteHistory,
    };
    if (actions[actionButton.dataset.action]) actions[actionButton.dataset.action](row);
    return;
  }

  const saveButton = event.target.closest('[data-save]');
  if (saveButton) saveProduct(saveButton.closest('tr'));
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
