/* SnipeWatch parser tests — run with: node test/parse_test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { extractPrice, normalizePrice } = require('../app.js');

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

console.log('normalizePrice():');
check('"1,299.00" -> 1299', normalizePrice('1,299.00'), 1299);
check('"1.299,00" -> 1299', normalizePrice('1.299,00'), 1299);
check('"$1,299" -> 1299', normalizePrice('$1,299'), 1299);
check('"1299,00" -> 1299', normalizePrice('1299,00'), 1299);
check('"garbage" -> null', normalizePrice('garbage'), null);
check('"0" -> null', normalizePrice('0'), null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
