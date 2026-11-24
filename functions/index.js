const { initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const nodemailer = require('nodemailer');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const {
  calculateSuggestedPrice,
  parseExchangeRate,
  parseOriginalPrice,
} = require('./pricing-utils');

initializeApp();

const db = getFirestore();
const notificationAddress = 'linlilung@gmail.com';
const gmailAppPassword = defineSecret('GMAIL_APP_PASSWORD');
const pricingAdminEmail = 'linlilung@gmail.com';
const pricingDiscount = 0.7;
const allowedProducts = new Set([
  'Aqua-Jaw Carry Vise *pair*',
  'Stealth Grip',
  'Pro Dolly HD2',
  'Pro-Cart AT2',
  'S3 Table HD',
  "Sink Hole Saver Auto v6 (7')",
  'Nano Stealth Seamer Auto',
  'Pro Stealth Seamer Manual',
]);

function requirePricingAdmin(request) {
  if (
    !request.auth
    || request.auth.token.email?.toLowerCase() !== pricingAdminEmail
    || request.auth.token.email_verified !== true
  ) {
    throw new HttpsError('permission-denied', '僅限已驗證的管理員使用報價功能。');
  }
}

function validateProductId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,180}$/i.test(value)) {
    throw new HttpsError('invalid-argument', '商品識別碼無效。');
  }
  return value;
}

async function fetchOriginalQuote(productId, sourceUrl) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new HttpsError('failed-precondition', '商品沒有有效的原廠產品網址。');
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'www.omnicubedeurope.com'
    || !url.pathname.startsWith('/webshop/')
  ) {
    throw new HttpsError('failed-precondition', '僅能讀取 Omni Cubed Europe 原廠商品頁面。');
  }

  let response;
  try {
    response = await fetch(url.href, {
      headers: { 'User-Agent': 'OmniCubedTaiwanPricing/1.0' },
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    console.error(`Unable to fetch original price for ${productId}.`, error);
    throw new HttpsError('unavailable', '無法連線至原廠頁面，請稍後重試或手動輸入報價。');
  }

  const finalUrl = new URL(response.url);
  if (
    !response.ok
    || finalUrl.protocol !== 'https:'
    || finalUrl.hostname !== 'www.omnicubedeurope.com'
    || !finalUrl.pathname.startsWith('/webshop/')
  ) {
    throw new HttpsError('unavailable', `原廠頁面回應失敗（HTTP ${response.status}）。`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 5000000) {
    throw new HttpsError('resource-exhausted', '原廠頁面內容過大，無法安全讀取。');
  }

  let quote;
  try {
    const html = await response.text();
    if (html.length > 5000000) {
      throw new Error('Original product page is too large.');
    }
    quote = parseOriginalPrice(html);
  } catch (error) {
    console.error(`Unable to parse original price for ${productId}.`, error);
    if (error.message.includes('未稅價格')) {
      throw new HttpsError('failed-precondition', error.message);
    }
    throw new HttpsError('unavailable', '無法讀取原廠價格，請稍後重試或手動輸入報價。');
  }

  return {
    ...quote,
    sourceUrl: url.href,
    capturedAt: new Date(),
  };
}

async function fetchCurrencyRate(currency) {
  let response;
  try {
    response = await fetch(
      `https://open.er-api.com/v6/latest/${encodeURIComponent(currency.toUpperCase())}`,
      {
        headers: { 'User-Agent': 'OmniCubedTaiwanPricing/1.0' },
        signal: AbortSignal.timeout(12000),
      },
    );
  } catch (error) {
    console.error(`Unable to fetch ${currency}/TWD exchange rate.`, error);
    throw new HttpsError('unavailable', '無法連線至匯率服務，請稍後重試或手動輸入匯率。');
  }

  if (!response.ok) {
    throw new HttpsError('unavailable', `匯率服務回應失敗（HTTP ${response.status}）。`);
  }

  let rateData;
  try {
    rateData = await response.json();
  } catch (error) {
    console.error(`Unable to parse the ${currency}/TWD exchange-rate response.`, error);
    throw new HttpsError('unavailable', '匯率服務回傳的資料格式無效，請稍後重試。');
  }

  try {
    return parseExchangeRate(rateData, currency);
  } catch (error) {
    console.error(`Invalid ${currency}/TWD exchange-rate response.`, error);
    throw new HttpsError('unavailable', error.message);
  }
}

async function mapWithConcurrency(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await callback(items[currentIndex]);
    }
  }));
  return results;
}

exports.fetchOriginalPrice = onCall(
  { region: 'asia-east1', timeoutSeconds: 20 },
  async (request) => {
    requirePricingAdmin(request);
    const productId = validateProductId(request.data && request.data.productId);
    const productSnapshot = await db.collection('products').doc(productId).get();
    if (!productSnapshot.exists) {
      throw new HttpsError('not-found', '找不到這項商品。');
    }

    const quote = await fetchOriginalQuote(productId, productSnapshot.get('sourceUrl'));
    const pricingRef = db.collection('productPricing').doc(productId);
    const quoteRef = pricingRef.collection('sourceQuotes').doc();
    const batch = db.batch();
    batch.set(quoteRef, {
      sourcePrice: quote.sourcePrice,
      currency: quote.currency,
      sourceType: 'automatic',
      sourceUrl: quote.sourceUrl,
      capturedAt: quote.capturedAt,
      capturedBy: request.auth.token.email,
    });
    batch.set(pricingRef, {
      sourcePrice: quote.sourcePrice,
      currency: quote.currency,
      sourceType: 'automatic',
      sourceFetchedAt: quote.capturedAt,
      sourceUrl: quote.sourceUrl,
      suggestedPriceTwd: FieldValue.delete(),
      calculation: FieldValue.delete(),
      updatedAt: quote.capturedAt,
    }, { merge: true });
    await batch.commit();

    return {
      sourcePrice: quote.sourcePrice,
      currency: quote.currency,
      capturedAt: quote.capturedAt.toISOString(),
    };
  },
);

exports.fetchExchangeRate = onCall(
  { region: 'asia-east1', timeoutSeconds: 20 },
  async (request) => {
    requirePricingAdmin(request);
    const productId = validateProductId(request.data && request.data.productId);
    const pricingRef = db.collection('productPricing').doc(productId);
    const pricingSnapshot = await pricingRef.get();
    if (!pricingSnapshot.exists) {
      throw new HttpsError('failed-precondition', '請先取得或手動記錄原廠報價與幣別。');
    }

    const currency = pricingSnapshot.get('currency');
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/i.test(currency)) {
      throw new HttpsError('failed-precondition', '原廠報價幣別無效，請先確認報價資料。');
    }

    const result = await fetchCurrencyRate(currency);

    const fetchedAt = new Date();
    await pricingRef.set({
      exchangeRate: result.exchangeRate,
      exchangeRateSource: 'ExchangeRate-API Open Access',
      exchangeRateAsOf: result.asOf,
      exchangeRateFetchedAt: fetchedAt,
      suggestedPriceTwd: FieldValue.delete(),
      calculation: FieldValue.delete(),
      updatedAt: fetchedAt,
    }, { merge: true });

    return {
      currency: currency.toUpperCase(),
      exchangeRate: result.exchangeRate,
      source: 'ExchangeRate-API Open Access',
      asOf: result.asOf.toISOString(),
      fetchedAt: fetchedAt.toISOString(),
    };
  },
);

exports.refreshAllProductPricing = onCall(
  { region: 'asia-east1', timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    requirePricingAdmin(request);
    const snapshot = await db.collection('products').get();
    if (snapshot.empty) {
      throw new HttpsError('failed-precondition', '商品目錄是空的，請先匯入原廠產品。');
    }

    const products = snapshot.docs.map((productDocument) => ({
      id: productDocument.id,
      ...productDocument.data(),
    }));
    const quoteResults = await mapWithConcurrency(products, 6, async (product) => {
      try {
        validateProductId(product.id);
        const quote = await fetchOriginalQuote(product.id, product.sourceUrl);
        return { product, quote };
      } catch (error) {
        console.error(`Unable to refresh original quote for ${product.id}.`, error);
        return { product, error: error.message || '無法取得原廠報價。' };
      }
    });

    const currencies = [...new Set(
      quoteResults.filter((result) => result.quote).map((result) => result.quote.currency),
    )];
    const rates = new Map(await Promise.all(currencies.map(async (currency) => {
      try {
        return [currency, { rate: await fetchCurrencyRate(currency) }];
      } catch (error) {
        console.error(`Unable to refresh the ${currency}/TWD rate.`, error);
        return [currency, { error: error.message || '無法取得匯率。' }];
      }
    })));

    const updatedProducts = [];
    const failedProducts = [];
    quoteResults.forEach(({ product, quote, error }) => {
      if (error) {
        failedProducts.push({ id: product.id, name: product.name || product.id, reason: error });
        return;
      }
      const rateResult = rates.get(quote.currency);
      if (!rateResult || rateResult.error) {
        failedProducts.push({
          id: product.id,
          name: product.name || product.id,
          reason: rateResult?.error || `沒有 ${quote.currency}/TWD 匯率。`,
        });
        return;
      }
      updatedProducts.push({ product, quote, rate: rateResult.rate });
    });

    for (let offset = 0; offset < updatedProducts.length; offset += 200) {
      const batch = db.batch();
      updatedProducts.slice(offset, offset + 200).forEach(({ product, quote, rate }) => {
        const pricingRef = db.collection('productPricing').doc(product.id);
        const quoteRef = pricingRef.collection('sourceQuotes').doc();
        batch.set(quoteRef, {
          sourcePrice: quote.sourcePrice,
          currency: quote.currency,
          sourceType: 'automatic',
          sourceUrl: quote.sourceUrl,
          capturedAt: quote.capturedAt,
          capturedBy: request.auth.token.email,
        });
        batch.set(pricingRef, {
          sourcePrice: quote.sourcePrice,
          currency: quote.currency,
          sourceType: 'automatic',
          sourceFetchedAt: quote.capturedAt,
          sourceUrl: quote.sourceUrl,
          exchangeRate: rate.exchangeRate,
          exchangeRateSource: 'ExchangeRate-API Open Access',
          exchangeRateAsOf: rate.asOf,
          exchangeRateFetchedAt: new Date(),
          suggestedPriceTwd: FieldValue.delete(),
          calculation: FieldValue.delete(),
          updatedAt: new Date(),
        }, { merge: true });
      });
      await batch.commit();
    }

    return {
      totalProducts: products.length,
      updatedProducts: updatedProducts.length,
      failedProducts,
      updatedCurrencies: currencies.filter((currency) => rates.get(currency)?.rate),
    };
  },
);

exports.calculateSuggestedPrice = onCall(
  { region: 'asia-east1' },
  async (request) => {
    requirePricingAdmin(request);
    const productId = validateProductId(request.data && request.data.productId);
    const pricingRef = db.collection('productPricing').doc(productId);
    const pricingSnapshot = await pricingRef.get();
    if (!pricingSnapshot.exists) {
      throw new HttpsError('failed-precondition', '請先儲存報價、匯率及費率。');
    }

    const pricing = pricingSnapshot.data();
    let calculation;
    try {
      calculation = calculateSuggestedPrice({
        sourcePrice: pricing.sourcePrice,
        exchangeRate: pricing.exchangeRate,
        dutyPercent: pricing.dutyPercent,
        shippingPercent: pricing.shippingPercent,
        marginPercent: pricing.marginPercent,
      });
    } catch (error) {
      throw new HttpsError('failed-precondition', error.message);
    }

    const calculatedAt = new Date();
    const discount = pricingDiscount;
    await pricingRef.set({
      suggestedPriceTwd: calculation.suggestedPriceTwd,
      calculation: {
        sourcePrice: pricing.sourcePrice,
        currency: pricing.currency,
        discount,
        exchangeRate: pricing.exchangeRate,
        dealerCostTwd: calculation.dealerCostTwd,
        dutyPercent: pricing.dutyPercent,
        dutyTwd: calculation.dutyTwd,
        shippingPercent: pricing.shippingPercent,
        shippingTwd: calculation.shippingTwd,
        marginPercent: pricing.marginPercent,
        totalCostTwd: calculation.totalCostTwd,
        suggestedPriceTwd: calculation.suggestedPriceTwd,
        calculatedAt,
      },
      updatedAt: calculatedAt,
    }, { merge: true });

    return {
      ...calculation,
      sourcePrice: pricing.sourcePrice,
      currency: pricing.currency,
      discount,
      exchangeRate: pricing.exchangeRate,
      dutyPercent: pricing.dutyPercent,
      shippingPercent: pricing.shippingPercent,
      marginPercent: pricing.marginPercent,
      calculatedAt: calculatedAt.toISOString(),
    };
  },
);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

exports.sendInquiryNotification = onDocumentCreated(
  {
    document: 'inquiries/{inquiryId}',
    region: 'asia-east1',
    secrets: [gmailAppPassword],
  },
  async (event) => {
    const inquiry = event.data && event.data.data();
    if (!inquiry) return;

    const inquiryRef = db.collection('inquiries').doc(event.params.inquiryId);
    const claimed = await db.runTransaction(async (transaction) => {
      const currentInquiry = await transaction.get(inquiryRef);
      if (
        !currentInquiry.exists
        || currentInquiry.get('notificationStatus') === 'sent'
        || currentInquiry.get('notificationStatus') === 'sending'
      ) {
        return false;
      }

      transaction.update(inquiryRef, {
        notificationStatus: 'sending',
        notificationAttemptedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!claimed) return;

    const product = allowedProducts.has(inquiry.product) ? inquiry.product : '未指定產品';
    const details = [
      `姓名：${inquiry.name}`,
      `公司：${inquiry.company || '未提供'}`,
      `Email：${inquiry.email}`,
      `電話：${inquiry.phone || '未提供'}`,
      `產品：${product}`,
      '',
      '需求說明：',
      inquiry.message,
    ];
    const text = details.join('\n');
    const html = `<h2>Omni Cubed Taiwan 新詢價</h2><pre>${escapeHtml(text)}</pre>`;

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: notificationAddress,
        pass: gmailAppPassword.value().replace(/\s/g, ''),
      },
    });

    try {
      await transporter.sendMail({
        from: `Omni Cubed Taiwan <${notificationAddress}>`,
        to: notificationAddress,
        replyTo: inquiry.email,
        subject: `Omni Cubed Taiwan 新詢價：${product}`,
        text,
        html,
      });
      await inquiryRef.update({
        notificationStatus: 'sent',
        notificationSentAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error(`Unable to send inquiry notification for ${event.params.inquiryId}.`, error);
      await inquiryRef.update({ notificationStatus: 'failed' });
      throw error;
    }
  },
);
