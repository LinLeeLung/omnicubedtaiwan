const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateSuggestedPrice,
  parseExchangeRate,
  parseOriginalPrice,
} = require('./pricing-utils');

test('parses the original page net price and currency', () => {
  const html = `
    <meta property="product:price:currency" content="GBP">
    <span class="s-price-net"><span class="s-price-current" data-net-base="729.00">£729.00</span> exc. VAT</span>
  `;

  assert.deepEqual(parseOriginalPrice(html), { sourcePrice: 729, currency: 'GBP' });
});

test('requires a published net price and currency', () => {
  assert.throws(() => parseOriginalPrice('<span>£874.80 inc. VAT</span>'), /未稅價格或幣別/);
});

test('parses the TWD rate and update date for the selected source currency', () => {
  const parsed = parseExchangeRate({
    result: 'success',
    base_code: 'GBP',
    time_last_update_unix: 1795478551,
    rates: { TWD: 42.905838 },
  }, 'gbp');

  assert.equal(parsed.exchangeRate, 42.905838);
  assert.equal(parsed.asOf.toISOString(), '2026-11-24T00:02:31.000Z');
});

test('rejects a rate response for a different currency or without TWD', () => {
  assert.throws(() => parseExchangeRate({
    result: 'success',
    base_code: 'USD',
    time_last_update_unix: 1795478551,
    rates: { TWD: 32 },
  }, 'GBP'), /原幣別/);
  assert.throws(() => parseExchangeRate({
    result: 'success',
    base_code: 'GBP',
    time_last_update_unix: 1795478551,
    rates: {},
  }, 'GBP'), /台幣匯率/);
});

test('calculates wholesale cost, fees, and gross-margin price', () => {
  const result = calculateSuggestedPrice({
    sourcePrice: 100,
    exchangeRate: 32,
    dutyPercent: 5,
    shippingPercent: 8,
    marginPercent: 30,
  });

  assert.deepEqual(result, {
    dealerCostTwd: 2560,
    dutyTwd: 128,
    shippingTwd: 204.8,
    totalCostTwd: 2892.8,
    suggestedPriceTwd: 4133,
  });
});

test('rejects a 100 percent gross margin', () => {
  assert.throws(() => calculateSuggestedPrice({
    sourcePrice: 100,
    exchangeRate: 32,
    dutyPercent: 0,
    shippingPercent: 0,
    marginPercent: 100,
  }), /毛利率/);
});
