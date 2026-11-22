import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let products = [
  {
    name: 'Aqua-Jaw Carry Vise *pair*',
    category: 'clamps',
    categoryLabel: '搬運夾具',
    image: 'https://www.omnicubedeurope.com/_webedit/cached-images/1-156-0-600-wide.jpg',
    tag: 'POPULAR',
  },
  {
    name: 'Stealth Grip',
    category: 'clamps',
    categoryLabel: '搬運夾具',
    image: 'https://www.omnicubedeurope.com/_webedit/cached-images/56-211-0-600-wide.png',
    tag: 'POPULAR',
  },
  {
    name: 'Pro Dolly HD2',
    category: 'transport',
    categoryLabel: '搬運設備',
    image: 'https://www.omnicubedeurope.com/_webedit/cached-images/53-208-0-600-wide.jpg',
    tag: 'POPULAR',
  },
  {
    name: 'Pro-Cart AT2',
    category: 'transport',
    categoryLabel: '搬運設備',
    image: 'https://www.omnicubedeurope.com/_webedit/cached-images/51-206-0-600-wide.jpg',
    tag: 'POPULAR',
  },
  {
    name: 'S3 Table HD',
    category: 'transport',
    categoryLabel: '搬運設備',
    image: 'https://www.omnicubedeurope.com/_webedit/cached-images/18-173-0-600-wide.jpg',
    tag: 'POPULAR',
  },
  {
    name: "Sink Hole Saver Auto v6 (7')",
    category: 'stone',
    categoryLabel: '石材加工',
    image: 'https://www.omnicubedeurope.com/_webedit/cached-images/9-164-0-600-wide.jpg',
    tag: 'POPULAR',
  },
  {
    name: 'Nano Stealth Seamer Auto',
    category: 'seam',
    categoryLabel: '接縫調整',
    image: 'https://www.omnicubedeurope.com/_webedit/cached-images/42-197-0-600-wide.jpg',
    tag: 'POPULAR',
  },
  {
    name: 'Pro Stealth Seamer Manual',
    category: 'seam',
    categoryLabel: '接縫調整',
    image: 'https://www.omnicubedeurope.com/_webedit/cached-images/45-200-0-600-wide.jpg',
    tag: 'POPULAR',
  },
];

const productGrid = document.querySelector('#product-grid');
const searchInput = document.querySelector('#product-search');
const inquiryProduct = document.querySelector('#inquiry-product');
const filters = document.querySelector('.filters');
const categoryLabels = {
  clamps: '搬運夾具',
  transport: '搬運設備',
  'spare-parts': '零配件',
  tape: '施工膠帶',
  reinforcement: '支撐設備',
  'seam-setters': '接縫調整',
};
let activeFilter = 'all';
let catalogInitialized = false;
let firestoreProducts = [];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function getCategoryLabel(product) {
  return categoryLabels[product.category] || product.categoryLabel || product.category || '';
}

function syncCatalog() {
  if (!catalogInitialized) return;
  products = firestoreProducts;
  activeFilter = 'all';
  renderFilters();
  populateInquiryOptions();
  renderProducts();
}

function renderFilters() {
  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))];
  const orderedCategories = [
    'clamps',
    'transport',
    'seam-setters',
    'reinforcement',
    'tape',
    'spare-parts',
  ].filter((category) => categories.includes(category));
  const remainingCategories = categories.filter((category) => !orderedCategories.includes(category));
  const options = [['all', '全部產品'], ...[...orderedCategories, ...remainingCategories]
    .map((category) => [category, categoryLabels[category] || category])];

  filters.innerHTML = options.map(([value, label]) => `
    <button class="filter-button${value === activeFilter ? ' is-active' : ''}"
      type="button" data-filter="${escapeHtml(value)}"
      aria-pressed="${String(value === activeFilter)}">${escapeHtml(label)}</button>
  `).join('');
}

function populateInquiryOptions() {
  const selectedProduct = inquiryProduct.value;
  inquiryProduct.innerHTML = '<option value="">請選擇產品（可不選）</option>';
  products.forEach((product) => {
    const option = document.createElement('option');
    option.value = product.name;
    option.textContent = product.name;
    inquiryProduct.append(option);
  });
  if (products.some((product) => product.name === selectedProduct)) {
    inquiryProduct.value = selectedProduct;
  }
}

function renderProducts() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const visibleProducts = products.filter((product) => {
    const matchesCategory = activeFilter === 'all' || product.category === activeFilter;
    const matchesQuery = `${product.name} ${getCategoryLabel(product)}`.toLocaleLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });

  if (visibleProducts.length === 0) {
    productGrid.innerHTML = `<p class="no-results">${products.length
      ? '找不到符合的產品，試試其他關鍵字或聯絡我們。'
      : '目前尚無上架商品，歡迎聯絡我們洽詢。'}</p>`;
    return;
  }

  productGrid.innerHTML = visibleProducts.map((product) => `
    <article class="product-card">
      <div class="product-media">
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy">
        <span class="product-tag">${escapeHtml(getCategoryLabel(product))}</span>
      </div>
      <div class="product-info">
        <p class="product-category">${escapeHtml(getCategoryLabel(product))}</p>
        <h3>${escapeHtml(product.name)}</h3>
        <div class="product-details">
          <span class="product-price">${Number.isSafeInteger(product.priceTwd) && product.priceTwd >= 0
    ? `NT$ ${product.priceTwd.toLocaleString('zh-TW')}`
    : '歡迎詢價'}</span>
          <a class="product-inquire" href="#inquiry" data-product="${escapeHtml(product.name)}">詢問 <span aria-hidden="true">↗</span></a>
        </div>
      </div>
    </article>
  `).join('');

  productGrid.querySelectorAll('.product-media img').forEach((image) => {
    image.addEventListener('error', () => image.parentElement.classList.add('is-fallback'), { once: true });
  });

}

filters.addEventListener('click', (event) => {
  const button = event.target.closest('.filter-button');
  if (!button) return;
  activeFilter = button.dataset.filter;
  renderFilters();
  renderProducts();
});

searchInput.addEventListener('input', renderProducts);

productGrid.addEventListener('click', (event) => {
  const link = event.target.closest('[data-product]');
  if (!link) return;
  inquiryProduct.value = products.some((product) => product.name === link.dataset.product)
    ? link.dataset.product
    : '';
});

document.querySelectorAll('.hero-image-frame img, .service-image img').forEach((image) => {
  image.addEventListener('error', () => image.parentElement.classList.add('is-fallback'), { once: true });
});

const menuToggle = document.querySelector('.menu-toggle');
const mainNav = document.querySelector('#main-nav');
menuToggle.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  mainNav.classList.toggle('is-open', !isOpen);
});

mainNav.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuToggle.setAttribute('aria-expanded', 'false');
    mainNav.classList.remove('is-open');
  });
});

document.querySelector('#current-year').textContent = new Date().getFullYear();

const inquiryForm = document.querySelector('#inquiry-form');
const inquiryResult = document.querySelector('#inquiry-result');
const inquiryPreview = document.querySelector('#inquiry-preview');
const copyStatus = document.querySelector('#copy-status');
const formStatus = document.querySelector('#form-status');
const submitButton = inquiryForm.querySelector('[type="submit"]');

inquiryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(inquiryForm);
  const inquiry = {
    name: formData.get('name').trim(),
    company: formData.get('company').trim(),
    email: formData.get('email').trim(),
    phone: formData.get('phone').trim(),
    product: formData.get('product'),
    message: formData.get('message').trim(),
    status: 'new',
    createdAt: serverTimestamp(),
  };
  const lines = [
    'Omni Cubed Taiwan 產品詢價',
    `姓名：${inquiry.name}`,
    `公司：${inquiry.company || '未提供'}`,
    `電子郵件：${inquiry.email}`,
    `電話：${inquiry.phone || '未提供'}`,
    `感興趣的產品：${inquiry.product || '未指定'}`,
    '',
    '需求說明：',
    inquiry.message,
  ];
  inquiryPreview.value = lines.join('\n');
  submitButton.disabled = true;
  formStatus.textContent = '正在送出詢價...';
  copyStatus.textContent = '';

  try {
    await addDoc(collection(db, 'inquiries'), inquiry);
    inquiryForm.querySelectorAll('[name]').forEach((field) => {
      field.value = '';
    });
    inquiryPreview.value = lines.join('\n');
    inquiryResult.hidden = false;
    formStatus.textContent = '詢價已送出並儲存。若未收到回覆，請透過電子郵件或 LINE 聯絡。';
    inquiryResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    console.error('Unable to save the inquiry to Firebase.', error);
    formStatus.textContent = '送出失敗，資料尚未儲存。請稍後重試，或使用電子郵件／LINE 聯絡我們。';
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector('#copy-inquiry').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(inquiryPreview.value);
    copyStatus.textContent = '已複製詢價內容，可自行留存。';
  } catch {
    inquiryPreview.focus();
    inquiryPreview.select();
    copyStatus.textContent = '無法自動複製，請手動選取上方內容複製。';
  }
});

renderFilters();
populateInquiryOptions();
renderProducts();

onSnapshot(doc(db, 'siteSettings', 'catalog'), (snapshot) => {
  catalogInitialized = snapshot.exists() && snapshot.data().initialized === true;
  syncCatalog();
}, (error) => {
  console.error('Unable to load public catalog settings from Firebase.', error);
});

onSnapshot(query(collection(db, 'products'), where('published', '==', true)), (snapshot) => {
  firestoreProducts = snapshot.docs.map((productDocument) => ({
    id: productDocument.id,
    ...productDocument.data(),
  }));
  syncCatalog();
}, (error) => {
  console.error('Unable to load published products from Firebase.', error);
});
