/* SnipeWatch parser tests — run with: node test/parse_test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { extractPrice, normalizePrice, priceStats, dropPercent, sanitizeImportedProducts } = require('../app.js');

const FIX = p => fs.readFileSync(path.join(__dirname, 'fixtures', p), 'utf8');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '\n    expected: ' + JSON.stringify(expected) + '\n    actual:   ' + JSON.stringify(actual)); }
}

console.log('extractPrice():');
let r = extractPrice(FIX('fixture-jsonld-single.html'));
check('json-ld single offer -> 1299.00, USD, json-ld', r && { price: r.price, currency: r.currency, source: r.source }, { price: 1299, currency: 'USD', source: 'json-ld' });

r = extractPrice(FIX('fixture-jsonld-graph.html'));
check('json-ld @graph aggregate lowPrice "899,99" -> 899.99, EUR, json-ld', r && { price: r.price, currency: r.currency, source: r.source }, { price: 899.99, currency: 'EUR', source: 'json-ld' });

r = extractPrice(FIX('fixture-meta-fallback.html'));
check('meta og:price:amount fallback -> 249.50, meta', r && { price: r.price, source: r.source }, { price: 249.5, source: 'meta' });

r = extractPrice(FIX('fixture-no-price.html'));
check('bot-wall page -> null', r, null);

// --- teardown upgrades ---
r = extractPrice(FIX('fixture-multi-offer.html'));
check('one product, two seller offers -> lowest 199.99', r && { price: r.price, currency: r.currency, source: r.source }, { price: 199.99, currency: 'USD', source: 'json-ld' });

r = extractPrice(FIX('fixture-ambiguous.html'));
check('two distinct products with different prices -> {ambiguous:true}', r, { ambiguous: true });

r = extractPrice(FIX('fixture-microdata.html'));
check('microdata itemprop price -> 59.95, USD, microdata', r && { price: r.price, currency: r.currency, source: r.source }, { price: 59.95, currency: 'USD', source: 'microdata' });

r = extractPrice(FIX('fixture-markup-old-price.html'));
check('markup skips <del> + old-price, takes current 129.99', r && { price: r.price, source: r.source }, { price: 129.99, source: 'markup' });

r = extractPrice(FIX('fixture-out-of-stock.html'));
check('json-ld availability -> OutOfStock', r && { price: r.price, availability: r.availability }, { price: 149, availability: 'OutOfStock' });

r = extractPrice(FIX('fixture-jsonld-single.html'));
check('json-ld availability -> InStock', r && { availability: r.availability }, { availability: 'InStock' });

// duplicated identical Product blocks are one price, not ambiguous
const dup = FIX('fixture-jsonld-single.html') + FIX('fixture-jsonld-single.html');
r = extractPrice(dup);
check('duplicated identical product block -> 1299, not ambiguous', r && { price: r.price, source: r.source }, { price: 1299, source: 'json-ld' });

console.log('normalizePrice():');
check('"1,299.00" -> 1299', normalizePrice('1,299.00'), 1299);
check('"1.299,00" -> 1299', normalizePrice('1.299,00'), 1299);
check('"$1,299" -> 1299', normalizePrice('$1,299'), 1299);
check('"1299,00" -> 1299', normalizePrice('1299,00'), 1299);
check('"garbage" -> null', normalizePrice('garbage'), null);
check('"0" -> null', normalizePrice('0'), null);

console.log('priceStats():');
const st = priceStats([100, 120, 110, 90, 130, 80]);
check('6 points: low/high/avg/current', st && { low: st.low, high: st.high, avg: st.avg, current: st.current, count: st.count }, { low: 80, high: 130, avg: 105, current: 80, count: 6 });
check('6 points: p25/p75/percentile/verdict (current is lowest)', st && { p25: st.p25, p75: st.p75, percentile: st.percentile, verdict: st.verdict }, { p25: 92.5, p75: 117.5, percentile: 100, verdict: 'low' });
const st2 = priceStats([100, 110]);
check('2 points: no percentile/verdict yet', st2 && { percentile: st2.percentile, verdict: st2.verdict, low: st2.low, high: st2.high }, { percentile: null, verdict: null, low: 100, high: 110 });
check('empty history -> null', priceStats([]), null);

console.log('dropPercent():');
check('200 -> 170 = 15%', dropPercent(200, 170), 15);
check('100 -> 100 = 0%', dropPercent(100, 100), 0);
check('prev 0 -> null', dropPercent(0, 50), null);

console.log('sanitizeImportedProducts():');
const imp = sanitizeImportedProducts({
  products: [
    { name: 'Good', url: 'https://example.com/a', target: 50, history: [{ t: 1, price: 60 }, { t: 2, price: 45 }], availability: 'InStock' },
    { name: '', url: 'https://example.com/b', target: 50, history: [] },
    { name: 'Bad URL', url: 'ftp://example.com/c', target: 50, history: [] },
    { name: 'Bad target', url: 'https://example.com/d', target: -5, history: [] },
    { name: 'Bad history rows dropped', url: 'https://example.com/e', target: 10, history: [{ t: 1, price: -3 }, { t: 2, price: 9 }] },
  ],
});
check('keeps 2 valid, drops 3 invalid', imp && imp.map(p => p.name), ['Good', 'Bad history rows dropped']);
check('imported at-target history marks alerting', imp && imp[0].alerting, true);
check('bad history rows dropped, good kept', imp && imp[1].history, [{ t: 2, price: 9 }]);
check('non-backup shape -> null', sanitizeImportedProducts({ foo: 1 }), null);
check('null -> null', sanitizeImportedProducts(null), null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
