/* SnipeWatch — price-drop tracker. 100% client-side, zero backend. (c) VN */
'use strict';

/* ============================================================
   PRICE EXTRACTION — pure functions, no DOM. Testable in node.
   ============================================================ */

/**
 * Normalize a raw price string to a float.
 * Handles "1,299.00", "1.299,00", "$1,299", "1299", "1 299.99".
 * If both comma and dot are present, the RIGHTMOST one is the decimal separator.
 */
function normalizePrice(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  // strip currency symbols / codes, keep digits, comma, dot, spaces
  s = s.replace(/[$€£¥₹]|USD|EUR|GBP|CAD|INR|AUD/gi, '').trim();
  s = s.replace(/\s+/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      // "1.299,00" -> "1299.00"
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // "1,299.00" -> "1299.00"
      s = s.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    // "1299,00" or "1,299" — decimal only if exactly 2 digits follow the last comma
    const after = s.slice(lastComma + 1);
    s = /^\d{2}$/.test(after) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Try to parse a JSON-LD block and pull a price out of it. Returns number|null. */
function priceFromJsonLdObject(node, depth) {
  if (node == null || depth > 4) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const p = priceFromJsonLdObject(item, depth + 1);
      if (p != null) return p;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  if (node['@graph']) {
    const p = priceFromJsonLdObject(node['@graph'], depth + 1);
    if (p != null) return p;
  }
  const type = node['@type'];
  const isProduct = type === 'Product' ||
    (Array.isArray(type) && type.includes('Product'));
  const offers = node.offers;
  if (offers) {
    const list = Array.isArray(offers) ? offers : [offers];
    // Prefer an actual sale price on a Product node
    for (const offer of list) {
      if (offer && offer.price != null) {
        const p = normalizePrice(offer.price);
        if (p != null) return p;
      }
    }
    for (const offer of list) {
      if (offer && offer.lowPrice != null) {
        const p = normalizePrice(offer.lowPrice);
        if (p != null) return p;
      }
    }
    // AggregateOffer without lowPrice: try first priceSpec
    for (const offer of list) {
      if (offer && offer.priceSpecification && offer.priceSpecification.price != null) {
        const p = normalizePrice(offer.priceSpecification.price);
        if (p != null) return p;
      }
    }
  }
  // Recurse into nested values (but prefer direct hits above)
  if (!isProduct) {
    for (const key of Object.keys(node)) {
      if (key === '@graph' || key === 'offers') continue;
      const p = priceFromJsonLdObject(node[key], depth + 1);
      if (p != null) return p;
    }
  }
  return null;
}

/**
 * Extract a price from raw product-page HTML.
 * Returns { price, currency, source } or null.
 * source: 'json-ld' | 'meta' | 'markup' (markup = unverified fallback)
 */
function extractPrice(html) {
  if (!html || typeof html !== 'string') return null;

  // 1) JSON-LD structured data — the reliable path
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch (e) { continue; }
    const price = priceFromJsonLdObject(data, 0);
    if (price != null) {
      return { price, currency: guessCurrency(html, data), source: 'json-ld' };
    }
  }

  // 2) Meta tags
  const metaRes = [
    /<meta[^>]+property=["'](?:og:price:amount|product:price:amount)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:og:price:amount|product:price:amount)["']/i,
    /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']price["']/i,
  ];
  for (const re of metaRes) {
    const mm = html.match(re);
    if (mm) {
      const p = normalizePrice(mm[1]);
      if (p != null) return { price: p, currency: guessCurrency(html, null), source: 'meta' };
    }
  }

  // 3) Markup fallback — elements with price-ish class/id. Flagged unverified.
  const markupRe = /<(?:span|div|p|strong|b)[^>]*(?:class|id)=["'][^"']*price[^"']*["'][^>]*>([^<]{1,40})<\//gi;
  while ((m = markupRe.exec(html)) !== null) {
    const p = normalizePrice(m[1]);
    if (p != null) return { price: p, currency: guessCurrency(html, null), source: 'markup' };
  }
  return null;
}

function guessCurrency(html, ldData) {
  const curRe = /"priceCurrency"\s*:\s*"([A-Z]{3})"/i;
  const mm = html.match(curRe);
  if (mm) return mm[1];
  const meta = html.match(/<meta[^>]+(?:property=["'](?:og:price:currency|product:price:currency)["']|itemprop=["']priceCurrency["'])[^>]*>/i);
  if (meta) {
    const c = meta[0].match(/content=["']([^"']+)["']/i);
    if (c) return c[1].toUpperCase();
  }
  return null;
}

// Export for node tests; harmless in browsers.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractPrice, normalizePrice };
}

/* ============================================================
   BROWSER APP (guarded — skipped under node)
   ============================================================ */
if (typeof window !== 'undefined') (function () {
  'use strict';

  const PROXY = 'https://api.allorigins.win/raw?url=';
  const STORE_KEY = 'snipewatch.v1';
  const MAX_HISTORY = 365;

  /* ---------- SFX: synthesized WebAudio, zero assets ---------- */
  const Sfx = {
    ctx: null,
    muted: false,
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone(freq, dur, type, delay, vol) {
      if (this.muted) return;
      const ctx = this.ensure();
      if (!ctx) return;
      const t = ctx.currentTime + (delay || 0);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.05);
    },
    add()    { this.tone(660, 0.12, 'sine'); },
    tick()   { this.tone(880, 0.06, 'square', 0, 0.06); },
    alert()  { this.tone(659.25, 0.16, 'triangle', 0, 0.22); this.tone(987.77, 0.24, 'triangle', 0.13, 0.22); },
    error()  { this.tone(180, 0.2, 'sawtooth', 0, 0.12); },
    remove() { this.tone(420, 0.1, 'sine'); this.tone(280, 0.14, 'sine', 0.08); },
  };

  /* ---------- storage ---------- */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.products)) return Object.assign(defaultState(), s);
      }
    } catch (e) { /* corrupted storage -> start fresh */ }
    return defaultState();
  }
  function defaultState() {
    return { products: [], settings: { checkIntervalMin: 60, sfxMuted: false, notifAsked: false, hintDismissed: false } };
  }
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      // Quota: prune oldest history points and retry once
      state.products.forEach(p => { p.history = p.history.slice(-100); });
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e2) { /* give up gracefully */ }
    }
  }
  const state = loadState();
  Sfx.muted = !!state.settings.sfxMuted;

  /* ---------- helpers ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s);
  function fmtMoney(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'link'; }
  }
  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = msg; // msg is built internally from escaped parts
    $('toastRegion').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 5200);
  }
  function toastSafe(title, body, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    const strong = document.createElement('strong');
    strong.textContent = title;
    el.appendChild(strong);
    el.appendChild(document.createTextNode(' ' + body));
    $('toastRegion').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 5200);
  }

  /* ---------- notifications ---------- */
  function notifEnabled() { return 'Notification' in window && Notification.permission === 'granted'; }
  function refreshNotifBtn() {
    const b = $('notifBtn');
    const on = notifEnabled();
    b.classList.toggle('off', !on);
    b.title = on ? 'Browser notifications ON' : 'Enable browser notifications';
  }
  function fireNotification(title, body) {
    if (notifEnabled()) {
      try { new Notification(title, { body, icon: undefined }); } catch (e) { /* ignore */ }
    }
  }
  $('notifBtn').addEventListener('click', () => {
    if (!('Notification' in window)) { toastSafe('Not supported', 'This browser does not support notifications.', 'error'); return; }
    Notification.requestPermission().then(() => {
      state.settings.notifAsked = true; saveState(); refreshNotifBtn();
      if (notifEnabled()) toastSafe('Notifications on', 'You will be alerted here when a price drops.', 'info');
      else toastSafe('Notifications blocked', 'Enable them in your browser site settings to get alerts.', 'error');
    });
  });

  /* ---------- price checking ---------- */
  function checkProduct(p, opts) {
    opts = opts || {};
    p.checking = true; render();
    const url = PROXY + encodeURIComponent(p.url);
    return fetch(url, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error('proxy HTTP ' + r.status);
        return r.text();
      })
      .then(html => {
        const found = extractPrice(html);
        p.checking = false;
        if (!found) {
          p.lastError = 'Could not read a price from this page (bot protection or layout change). Use "Log price" to enter it manually.';
          p.lastCheck = Date.now();
          saveState(); render();
          if (!opts.quiet) { Sfx.error(); toastSafe('No price found', 'for "' + p.name + '". Try logging it manually.', 'error'); }
          return;
        }
        p.lastError = null;
        recordPrice(p, found.price, found.source);
      })
      .catch(err => {
        p.checking = false;
        p.lastError = 'Check failed (' + (err && err.message ? err.message : 'network error') + '). Retry or log the price manually.';
        p.lastCheck = Date.now();
        saveState(); render();
        if (!opts.quiet) { Sfx.error(); toastSafe('Check failed', 'for "' + p.name + '".', 'error'); }
      });
  }

  function recordPrice(p, price, source) {
    const now = Date.now();
    const last = p.history[p.history.length - 1];
    if (!last || last.price !== price) {
      p.history.push({ t: now, price });
      if (p.history.length > MAX_HISTORY) p.history = p.history.slice(-MAX_HISTORY);
    }
    p.lastCheck = now;
    const wasAlerting = p.alerting;
    p.alerting = price <= p.target;
    saveState(); render();
    if (p.alerting && !wasAlerting) {
      Sfx.alert();
      celebrate(p);
      const msg = '"' + p.name + '" is now ' + fmtMoney(price) + ' (target ' + fmtMoney(p.target) + ')';
      toastSafe('🎯 Price drop!', msg);
      fireNotification('🎯 SnipeWatch price drop', msg);
    } else {
      Sfx.tick();
    }
    if (source === 'markup') {
      toastSafe('Heads up', 'Price for "' + p.name + '" came from page markup (unverified) — double-check it on the retailer site.', 'info');
    }
  }

  function celebrate(p) {
    // tiny confetti burst on the product card
    const card = document.querySelector('[data-pid="' + p.id + '"]');
    if (!card) return;
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('span');
      s.textContent = ['✨', '🎯', '💸', '🟢'][i % 4];
      s.style.cssText = 'position:absolute;left:50%;top:40%;font-size:18px;pointer-events:none;z-index:10;transition:all .7s ease-out;';
      card.appendChild(s);
      requestAnimationFrame(() => {
        const ang = (i / 14) * Math.PI * 2 + Math.random() * 0.5;
        const dist = 60 + Math.random() * 70;
        s.style.transform = 'translate(' + Math.cos(ang) * dist + 'px,' + (Math.sin(ang) * dist - 30) + 'px) rotate(' + (Math.random() * 360) + 'deg)';
        s.style.opacity = '0';
      });
      setTimeout(() => s.remove(), 800);
    }
  }

  function checkAll() {
    const btn = $('checkAllBtn');
    btn.disabled = true;
    // sequential with stagger — kinder to the free proxy
    let chain = Promise.resolve();
    state.products.forEach((p, i) => {
      chain = chain.then(() => checkProduct(p, { quiet: true })
        .then(() => new Promise(res => setTimeout(res, 1200))));
    });
    chain.then(() => { btn.disabled = false; toastSafe('Done', 'All prices checked.', 'info'); });
  }
  $('checkAllBtn').addEventListener('click', checkAll);

  /* ---------- add / delete / manual log ---------- */
  $('addForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('pName').value.trim();
    let url = $('pUrl').value.trim();
    const target = parseFloat($('pTarget').value);
    if (!name || !url || !(target > 0)) return;
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
      url = u.href;
    } catch (err) { toastSafe('Invalid URL', 'Please paste a full http(s) product URL.', 'error'); return; }
    if (/google\.[^/]+\/search|bing\.com\/search|duckduckgo\.com/.test(url)) {
      toastSafe('Tip', 'That looks like a search page — paste the product page itself for best results.', 'info');
    }
    state.products.push({
      id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      name, url, target, history: [], lastCheck: null, lastError: null,
      alerting: false, checking: false,
    });
    $('addForm').reset();
    saveState(); render(); Sfx.add();
    toastSafe('Tracking', '"' + name + '" added. Hit "Check now" to grab its first price.', 'info');
  });

  function manualLog(p) {
    const raw = window.prompt('Enter the current price for "' + p.name + '" (e.g. 249.99):', '');
    if (raw == null) return;
    const price = normalizePrice(raw);
    if (price == null) { toastSafe('Invalid price', 'Please enter a number like 249.99.', 'error'); return; }
    recordPrice(p, price, 'manual');
  }

  function deleteProduct(id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
    if (!window.confirm('Stop tracking "' + p.name + '"? Its price history will be deleted.')) return;
    state.products = state.products.filter(x => x.id !== id);
    saveState(); render(); Sfx.remove();
  }

  /* ---------- rendering ---------- */
  function render() {
    const grid = $('productGrid');
    grid.innerHTML = '';
    $('watchCount').textContent = state.products.length;
    $('emptyState').style.display = state.products.length ? 'none' : 'block';
    state.products.forEach(p => grid.appendChild(cardEl(p)));
    refreshNotifBtn();
    $('muteBtn').textContent = Sfx.muted ? '🔇' : '🔊';
    $('muteBtn').classList.toggle('off', Sfx.muted);
  }

  function cardEl(p) {
    const card = document.createElement('article');
    card.className = 'product-card' + (p.alerting ? ' alert' : '');
    card.dataset.pid = p.id;

    const top = document.createElement('div');
    top.className = 'card-top';
    const h3 = document.createElement('h3');
    h3.className = 'card-name';
    const a = document.createElement('a');
    a.href = p.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = p.name;
    h3.appendChild(a);
    const badge = document.createElement('span');
    badge.className = 'domain-badge';
    badge.textContent = domainOf(p.url);
    const del = document.createElement('button');
    del.className = 'delete-btn'; del.textContent = '🗑️';
    del.title = 'Stop tracking'; del.setAttribute('aria-label', 'Stop tracking ' + p.name);
    del.addEventListener('click', () => deleteProduct(p.id));
    const rightWrap = document.createElement('div');
    rightWrap.style.display = 'flex'; rightWrap.style.alignItems = 'center'; rightWrap.style.gap = '4px';
    rightWrap.appendChild(badge); rightWrap.appendChild(del);
    top.appendChild(h3); top.appendChild(rightWrap);
    card.appendChild(top);

    const last = p.history[p.history.length - 1];
    const priceRow = document.createElement('div');
    priceRow.className = 'price-row';
    const cur = document.createElement('span');
    cur.className = 'current-price' + (p.alerting ? ' drop' : '');
    cur.textContent = last ? fmtMoney(last.price) : '—';
    priceRow.appendChild(cur);
    const chip = document.createElement('span');
    chip.className = 'delta-chip';
    if (last) {
      const diff = p.target - last.price;
      if (diff >= 0) { chip.classList.add('good'); chip.textContent = '↓ ' + fmtMoney(diff) + ' below target'; }
      else { chip.classList.add('wait'); chip.textContent = fmtMoney(-diff) + ' to go'; }
    } else { chip.classList.add('wait'); chip.textContent = 'no data yet'; }
    priceRow.appendChild(chip);
    card.appendChild(priceRow);

    const tline = document.createElement('div');
    tline.className = 'target-line';
    tline.textContent = 'Target: ' + fmtMoney(p.target);
    card.appendChild(tline);

    // chart
    const wrap = document.createElement('div');
    wrap.className = 'chart-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'chart';
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    wrap.appendChild(canvas); wrap.appendChild(tip);
    card.appendChild(wrap);
    drawChart(canvas, tip, p);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const mkBtn = (label, fn, disabled) => {
      const b = document.createElement('button');
      b.className = 'ghost-btn'; b.textContent = label; b.disabled = !!disabled;
      b.addEventListener('click', fn);
      return b;
    };
    actions.appendChild(mkBtn(p.checking ? 'Checking…' : 'Check now', () => checkProduct(p), p.checking));
    actions.appendChild(mkBtn('Log price', () => manualLog(p)));
    card.appendChild(actions);

    const status = document.createElement('div');
    status.className = 'status-line' + (p.lastError ? ' error' : (last ? ' ok' : ''));
    if (p.lastError) status.textContent = '⚠ ' + p.lastError;
    else if (last && p.lastCheck) status.textContent = '✓ Updated ' + new Date(p.lastCheck).toLocaleString() + ' · ' + p.history.length + ' data point' + (p.history.length === 1 ? '' : 's');
    else status.textContent = 'Not checked yet — hit "Check now" or log a price manually.';
    card.appendChild(status);

    // redraw once laid out so the chart uses the real card width
    requestAnimationFrame(() => drawChart(canvas, tip, p));

    return card;
  }

  /* ---------- canvas chart ---------- */
  function drawChart(canvas, tip, p) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 300, H = 110;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const hist = p.history;
    if (hist.length === 0) {
      ctx.fillStyle = '#8b98ab'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('No price history yet', W / 2, H / 2 + 4);
      return;
    }
    const pad = { l: 8, r: 8, t: 12, b: 18 };
    const vals = hist.map(h => h.price).concat([p.target]);
    let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    const spanPad = (max - min) * 0.15;
    min -= spanPad; max += spanPad;
    const X = i => pad.l + (hist.length === 1 ? 0.5 : i / (hist.length - 1)) * (W - pad.l - pad.r);
    const Y = v => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);

    // target line (dashed amber)
    ctx.strokeStyle = '#ffb020'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(p.target)); ctx.lineTo(W - pad.r, Y(p.target)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffb020'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('target ' + fmtMoney(p.target), W - pad.r, Y(p.target) - 4);

    // area fill
    const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
    const col = hist[hist.length - 1].price <= p.target ? '61,220,132' : '88,152,255';
    grad.addColorStop(0, 'rgba(' + col + ',.35)');
    grad.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.beginPath();
    hist.forEach((h, i) => { i ? ctx.lineTo(X(i), Y(h.price)) : ctx.moveTo(X(0), Y(h.price)); });
    ctx.lineTo(X(hist.length - 1), H - pad.b); ctx.lineTo(X(0), H - pad.b); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // line
    ctx.beginPath();
    hist.forEach((h, i) => { i ? ctx.lineTo(X(i), Y(h.price)) : ctx.moveTo(X(0), Y(h.price)); });
    ctx.strokeStyle = hist[hist.length - 1].price <= p.target ? '#3ddc84' : '#58a6ff';
    ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

    // points
    hist.forEach((h, i) => {
      ctx.beginPath(); ctx.arc(X(i), Y(h.price), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#e8edf3'; ctx.fill();
    });

    // min/max labels
    ctx.fillStyle = '#8b98ab'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(fmtMoney(Math.max.apply(null, hist.map(h => h.price))), pad.l, pad.t + 2);

    // hover tooltip
    canvas.onmousemove = e => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      let best = 0, bestD = Infinity;
      hist.forEach((h, i) => { const d = Math.abs(X(i) - mx); if (d < bestD) { bestD = d; best = i; } });
      const h = hist[best];
      tip.style.display = 'block';
      tip.textContent = fmtMoney(h.price) + ' · ' + new Date(h.t).toLocaleDateString();
      tip.style.left = Math.min(Math.max(X(best) - 40, 4), W - 120) + 'px';
      tip.style.top = (Y(h.price) - 30) + 'px';
    };
    canvas.onmouseleave = () => { tip.style.display = 'none'; };
  }

  /* ---------- header controls ---------- */
  $('muteBtn').addEventListener('click', () => {
    Sfx.muted = !Sfx.muted;
    state.settings.sfxMuted = Sfx.muted;
    saveState(); render();
    if (!Sfx.muted) Sfx.tick();
  });

  $('intervalSelect').value = String(state.settings.checkIntervalMin || 0);
  let autoTimer = null;
  function armAutoCheck() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    const mins = parseInt($('intervalSelect').value, 10);
    state.settings.checkIntervalMin = mins; saveState();
    if (mins > 0 && state.products.length) {
      autoTimer = setInterval(() => {
        if (state.products.length) checkAll();
      }, mins * 60 * 1000);
    }
  }
  $('intervalSelect').addEventListener('change', () => {
    armAutoCheck();
    const mins = parseInt($('intervalSelect').value, 10);
    toastSafe('Auto-check ' + (mins ? 'on' : 'off'), mins ? 'Prices will refresh every ' + $('intervalSelect').selectedOptions[0].textContent.toLowerCase() + ' while this tab is open.' : 'Automatic checks disabled.', 'info');
  });

  $('hintClose').addEventListener('click', () => {
    $('hintBar').hidden = true;
    state.settings.hintDismissed = true; saveState();
  });
  if (!state.settings.hintDismissed) $('hintBar').hidden = false;

  // first paint + arm timer
  render();
  armAutoCheck();
  // re-arm when products are added later
  const _origRender = render;
  render = function () { _origRender(); };
})();
