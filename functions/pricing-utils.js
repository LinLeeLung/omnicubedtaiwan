function parseOriginalPrice(html) {
  const priceMatch = html.match(
    /<span\b[^>]*class=["'][^"']*\bs-price-net\b[^"']*["'][^>]*>[\s\S]*?data-net-base=["']([0-9]+(?:\.[0-9]+)?)["']/i,
  );
  const currencyMatch = html.match(
    /<meta\b[^>]*property=["']product:price:currency["'][^>]*content=["']([A-Z]{3})["']/i,
  ) || html.match(/data-currency-code=["'](?:&quot;)?([A-Z]{3})(?:&quot;)?["']/i);

  if (!priceMatch || !currencyMatch) {
    throw new Error('原廠頁面未提供可辨識的未稅價格或幣別，請改用手動報價。');
  }

  const price = Number(priceMatch[1]);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('原廠頁面的未稅價格無效，請改用手動報價。');
  }

  return { sourcePrice: price, currency: currencyMatch[1].toUpperCase() };
}

function parseExchangeRate(payload, baseCurrency) {
  const currency = typeof baseCurrency === 'string' ? baseCurrency.toUpperCase() : '';
  if (
    !/^[A-Z]{3}$/.test(currency)
    || !payload
    || payload.result !== 'success'
    || typeof payload.base_code !== 'string'
    || payload.base_code.toUpperCase() !== currency
  ) {
    throw new Error('匯率服務未提供有效的原幣別資料。');
  }

  const rate = payload.rates && payload.rates.TWD;
  const updatedAt = Number(payload.time_last_update_unix);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isSafeInteger(updatedAt) || updatedAt <= 0) {
    throw new Error('匯率服務未提供有效的台幣匯率或更新時間。');
  }

  return {
    exchangeRate: rate,
    asOf: new Date(updatedAt * 1000),
  };
}

function calculateSuggestedPrice({
  sourcePrice,
  exchangeRate,
  dutyPercent,
  shippingPercent,
  marginPercent,
}) {
  const values = [sourcePrice, exchangeRate, dutyPercent, shippingPercent, marginPercent];
  if (!values.every(Number.isFinite) || sourcePrice <= 0 || exchangeRate <= 0) {
    throw new Error('原廠價格與匯率必須是大於 0 的有效數值。');
  }
  if (dutyPercent < 0 || dutyPercent > 1000 || shippingPercent < 0 || shippingPercent > 1000) {
    throw new Error('關稅與運輸百分比需介於 0% 至 1000%。');
  }
  if (marginPercent < 0 || marginPercent >= 100) {
    throw new Error('毛利率需介於 0%（含）至 100%（不含）。');
  }

  const dealerCostTwd = sourcePrice * 0.7 * exchangeRate;
  const dutyTwd = dealerCostTwd * dutyPercent / 100;
  const shippingTwd = dealerCostTwd * shippingPercent / 100;
  const totalCostTwd = dealerCostTwd + dutyTwd + shippingTwd;
  const suggestedPriceTwd = Math.round(totalCostTwd / (1 - marginPercent / 100));

  if (!Number.isSafeInteger(suggestedPriceTwd) || suggestedPriceTwd > 1000000000) {
    throw new Error('計算出的建議售價超出可用範圍，請檢查輸入資料。');
  }

  return {
    dealerCostTwd,
    dutyTwd,
    shippingTwd,
    totalCostTwd,
    suggestedPriceTwd,
  };
}

module.exports = { calculateSuggestedPrice, parseExchangeRate, parseOriginalPrice };
