# SnipeWatch — Developer Plan

> Price-drop tracker. Watchlist of products (name, URL, target price) → periodic price checks →
> per-product price-history chart → alert when price ≤ target. 100% static, GitHub Pages ready,
> zero budget, no backend, no API keys.

## 1. Architecture

```
snipewatch/
├── index.html          # single-page app shell
├── styles.css          # dark "mission control" theme, animations
├── app.js              # all logic (storage, price engine, charts, alerts, SFX)
├── assets/
│   └── screenshot.png  # UI mockup (programmatically rendered, labeled as mockup)
├── test/
│   ├── parse_test.js   # node test runner for the price parser
│   └── fixtures/       # saved sample product-page HTML
│       ├── fixture-jsonld-single.html
│       ├── fixture-jsonld-graph.html
│       ├── fixture-meta-fallback.html
│       └── fixture-no-price.html
├── PLAN.md
└── README.md
```

**Price engine (the core).** Static pages can't fetch retailer pages directly (CORS), so:
`fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(productUrl))` → raw HTML string →
`extractPrice(html)` (pure string/regex function, no DOM needed — this is what makes it unit-testable in node):

1. **JSON-LD first:** regex out every `<script type="application/ld+json">` block, `JSON.parse` each
   (tolerate arrays and `@graph`), walk to `offers` → prefer `offers.price`, else `lowPrice`,
   else first entry of an offers array. Most retailers (Best Buy, Walmart, Target, Newegg, etc.) embed this.
2. **Meta fallback:** `og:price:amount`, `product:price:amount`, `itemprop="price"`.
3. **Markup fallback:** regex for elements whose class/id contains "price" and pull the first
   currency-like number out of their text. Fragile by design — last resort.
4. **Manual fallback (always available):** "Log price manually" button per product — user types the
   current price, it enters history and the alert engine. This is the honest answer for Amazon and
   other anti-bot sites.

**State:** `localStorage['snipewatch.v1']` = `{ products: [{id, name, url, target, history:[{t, price}], muted, lastCheck, lastError}], settings: {checkIntervalMin, sfxMuted, notifGranted} }`.
History capped at 365 points per product (FIFO) to bound storage.

**Checking:** "Check now" per product + "Check all". Auto-check via `setInterval` while the tab is open
(user picks 30m / 1h / 6h / 24h / off). Documented limitation: static page = no background checks
when closed; the manual-log path covers that.

**Alerts:** on check, if `latest.price <= target` and not already alerted for this price point →
in-app toast + `Notification` API (permission requested on first enable) + celebratory SFX + card glows.
Alert state resets when price rises above target again.

**Charts:** hand-drawn `<canvas>` line chart per product (no chart lib — zero deps, zero weight).
Axes, target-price dashed line, gradient fill, min/max labels, hover tooltip via mousemove.

**SFX (WebAudio, synthesized, zero assets):** tiny synth module — `blip` (add product), `chaChing`-ish
two-tone arpeggio (price alert), `tick` (manual log), `whoosh` (delete). Master gain + persisted mute
toggle in the header. All oscillators, no audio files.

## 2. Likely bugs / problems and mitigations

| # | Problem | Likelihood | Mitigation |
|---|---------|-----------|------------|
| 1 | Retailer blocks the CORS proxy / returns bot-wall HTML (Amazon, some Shopify) | High | Parser returns null → UI shows "couldn't read price — log manually"; manual-log path is first-class, not an afterthought. README documents this honestly. |
| 2 | allorigins.win rate-limits or is down | Medium | "Check all" staggers requests (1.2s apart, sequential); per-product error shown, others continue; user can retry. Proxy URL is a single constant — swappable. |
| 3 | JSON-LD contains multiple products/offers (search/category pages pasted as URL) | Medium | Parser prefers the first `Product` node with an `offers.price`; UI warns if URL looks like a search page ("paste a product page, not search results"). |
| 4 | Locale number formats (`1.299,00` vs `1,299.00`) | Medium | Normalizer: if both `,` and `.` present, the rightmost is the decimal separator; currency code from JSON-LD kept for display only. |
| 5 | localStorage quota (many products × long history) | Low | 365-point cap per product; wrap `setItem` in try/catch → on QuotaExceeded, prune oldest history and retry once. |
| 6 | Notification permission denied / browser blocks | Low | Feature-detect; in-app toast always works regardless; settings toggle reflects actual permission state. |
| 7 | Price regex false-positives ("Save $50!" crossed-out prices) | Medium | Priority order (JSON-LD → meta → markup) means the structured sources win; markup fallback only used when nothing structured exists, and its value is flagged "unverified" in the UI. |
| 8 | Stale tab / clock skew in history timestamps | Low | Timestamps from `Date.now()` at check time; chart sorts by `t` defensively. |
| 9 | XSS via product name/URL rendering | Low | All user strings inserted via `textContent`, never `innerHTML`; URLs validated with `new URL()` and restricted to http(s). |
| 10 | User closes tab → no background checks | Certain | Stated upfront in UI ("checks run while this tab is open") + manual log; no fake promises. |

## 3. UI/UX thinking

**Vibe:** "deal-hunter mission control" — dark theme, deep navy/charcoal, neon-green accent for
price drops, amber for watching, red for errors. Dense but calm; this is a tool you glance at.

**Layout:** header (logo mark ⌖ SnipeWatch, SFX mute toggle, notification toggle, "Check all" button,
auto-check interval select) → "Add product" card (name, URL, target price, [Track it]) → product grid.
Each product card: name, favicon-ish domain badge, current price (big), target price, delta chip
("↓ $23.50 below target" / "$12.00 to go"), sparkline canvas, [Check now] [Log price] [⋯ delete],
last-checked timestamp, status line.

**Motion (tasteful, not noisy):** cards fade/slide in on add (CSS keyframes, 250ms); price digits do a
quick count/flip on update; a price-drop triggers a green pulse ring on the card + confetti-lite
burst (a few canvas particles, 600ms, then gone); toasts slide up from bottom-right and auto-dismiss.
`prefers-reduced-motion` respected — all animation gated behind a media query.

**SFX design (synthesized WebAudio):** `add` = soft 660Hz blip; `check-ok` = subtle tick; `drop-alert` =
two-tone coin arpeggio (E5→B5, triangle wave, 120ms apart) — the dopamine sound; `error` = low 180Hz
thud; `delete` = downward sweep. Master mute persisted; toggle in header with speaker icon.

**Empty state:** friendly illustration-via-CSS (crosshair over a price tag) + "No targets yet — add your
first product above." First-run coach marks: one dismissible hint bar explaining the proxy + manual
fallback so expectations are set on day one.

**Accessibility:** real `<button>`s, labels on all inputs, `aria-live` on the toast region, focus styles,
contrast-checked text.

## 4. QA plan

- `node --check` on app.js and test runner (syntax).
- `node test/parse_test.js` against 4 fixtures: JSON-LD single offer, JSON-LD @graph with
  aggregate lowPrice, meta-tag fallback, no-price negative. Assert exact extracted values.
- Manual browser checklist (documented, not claimed): add product, check via proxy on a real
  retailer page, manual log, chart renders, alert fires at/below target, mute persists across reload.
  Anything not run in a real browser is labeled as such in the final report.

## 5. Non-goals (v1)

No accounts, no backend, no email/SMS alerts (browser Notification only), no mobile app, no
multi-currency conversion, no automatic background checks when the tab is closed.
