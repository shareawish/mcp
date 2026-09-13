/**
 * Docs search and embed snippets – shared by both servers so that an agent connected
 * only to the Creator Shop server still finds the save button / basket integration.
 * None of these tools need credentials.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ok, fail, guard } from './util.js';

export const DOCS = (process.env.SHAREAWISH_DOCS_URL || 'https://shareawish.shop/developers').replace(/\/$/, '');
export const CDN_WIDGET = 'https://shareawish.shop/sdk/v1/widget.js';
export const CDN_BASKET = 'https://shareawish.shop/sdk/v1/basket-integration.js';
export const OPENAPI_URL = 'https://shareawish.shop/openapi/shareawish-public-api.yaml';
export const SUMMARY_URL = 'https://shareawish.shop/openapi/summary.json';
export const KEY_PLACEHOLDER = 'pk_test_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

/** One-paragraph pointer that both servers put into their instructions. */
export const INTEGRATION_POINTER =
  'Save button / basket on an external site: keys (pk_test_/pk_live_), basket configs (bkt_…) and domain allow-lists are managed by the ' +
  'shareawish-wishlist server (npx -y -p @shareawish/mcp shareawish-wishlist-mcp; tools keys_create, baskets_create, widget_init_check) ' +
  'or in the Partner Portal → API & Integrations. snippet_save_button, snippet_basket and docs_search are available here and need no credentials.';

/** Basket pages are served with `Content-Security-Policy: frame-ancestors 'self' https: http://localhost:* http://127.0.0.1:*`. */
export const BASKET_HTTPS_NOTE =
  'The basket renders in an iframe from https://shareawish.shop/basket, which only allows https parents plus http://localhost and http://127.0.0.1 (CSP frame-ancestors). ' +
  'Local testing over http://localhost works; any other http page (e.g. a LAN IP or http staging host) shows an empty iframe – the SDK logs `insecure_origin` and emits `sharewish:basket.error`. Serve production pages over https.';


/** Long-form guide the agent can read before configuring/embedding the basket. Split by topic. */
export const BASKET_GUIDE: Record<string, string> = {
  overview: `# Share a Wish basket – what it is
The basket ("wishlist drawer") is a hosted page (https://shareawish.shop/basket) that the SDK mounts into your site in an iframe.
It shows the products the shopper saved **from your shop** (scoped by the partner behind the public key – products saved elsewhere are never shown),
lets them sign in (Google, Apple, e-mail; OAuth runs in a popup and works inside third-party iframes), and offers per-item and bulk
"Add to cart" / "View product" actions. Configuration (layout, colours, labels, checkout) lives server-side in a basket config (bkt_…),
so you can restyle without redeploying. Requirements: public key (pk_test_/pk_live_), basket config id, page served over https (http://localhost allowed).`,

  config: `# Basket configuration fields (baskets_create / baskets_update)
- name – internal label.
- layout – grid (default; 2–3 columns of cards), list (rows, image left), cards (large cards, one per row on mobile), compact (dense rows for narrow drawers).
- colors.primary / colors.text / colors.background – buttons & accents, button text colour, basket background. Use your shop's brand colour for primary.
- typography.fontFamily – "inherit" (recommended: matches your site) or Inter, Roboto, Open Sans, Lato, Poppins (any CSS family string is accepted). typography.buttonText – add-to-cart label.
- styling.borderRadius – px (0 sharp … 12–16 soft … 999 pill). styling.animation – none | subtle (scale+fade on hover, default) | bounce | slide | zoom.
- checkout – add-to-cart | direct-checkout | custom-callback. This is the label shown in the Partner Portal; what actually happens on click is decided by cart_url / webhook_url / the parent page (see checkout topic).
- cart_url – URL pattern for shops that can add to cart via a GET URL: placeholders {variantId} {id} {sku} {quantity} {properties.<key>} are filled from the item's checkout meta. Example Shopify: https://shop.example.com/cart/add?id={variantId}&quantity={quantity}
- webhook_url – server endpoint that receives every checkout as JSON (see checkout topic). When set, the basket does nothing else client-side.
- fallback_text – label of the "View product" fallback button (items without cart data). cart_button_text / view_button_text – explicit labels for the two buttons.
- shop_name – subtitle "All your products saved from <shop_name>" (defaults to the embedding host). explore_url / popular_url – links in the empty state ("Explore products", "Popular items").
- track_saves / track_checkouts – analytics toggles.
Good defaults for a modern shop: layout "compact" or "list" inside a drawer, "grid" on a standalone wishlist page; fontFamily "inherit"; borderRadius 12; animation "subtle"; primary = brand colour; shop_name set; explore_url = your catalog page.`,

  embedding: `# How to embed the basket (best practices)
1. **Side panel / drawer (recommended for shop pages).** A "Wishlist" button in the header opens a slide-over panel; the iframe is loaded on first open, so it costs nothing on page load.
   var basket = ShareWishBasket.init({ apiKey, configId });
   var drawer = basket.drawer({ trigger: '#wishlist-button', side: 'right', width: '440px', title: 'My wishlist' });
   // drawer.open() / close() / toggle() / refresh() / isOpen()
   Refresh the drawer after a save: ShareAWish.on('saved', () => drawer.refresh()) – and bump your header badge.
2. **Inline section** (account page, "My wishlist" page, product page below the fold): <div id="sharewish-basket"></div> + basket.renderInto('#sharewish-basket'). The iframe auto-resizes to its content.
3. **Standalone page** (/wishlist): an inline section as the only content, linked from the header. Good for SEO-neutral pages and e-mail links.
4. **Shopify**: install the Share a Wish app and add the "Wishlist basket" theme block – no code, cart integration included.
Save button + basket belong together: the save button (data-shareawish) puts products in, the basket shows them. Use the same public key for both.
The embedding page must be https (http://localhost is fine). Errors arrive as DOM events (sharewish:basket.error).`,

  checkout: `# Checkout: how "Add to cart" / "Buy now" reaches your shop
The hosted basket cannot touch your cart directly (different origin). On click it tries, in this order:
1. **webhook_url set** → POST JSON to your server and stop:
   { "type": "basket_checkout", "product": { "id", "title" }, "meta": { "identifiers": {...}, "cart": { "params": {...} } }, "origin": "https://shareawish.shop" }
   Bulk: { "type": "basket_bulk_checkout", "products": [{ "id", "title" }], "origin" }. Test with baskets_test_webhook (sends { "type": "basket.test" }).
   Use this when a backend should create the cart (e.g. headless commerce, custom checkout links, e-mail follow-ups).
2. **Embedded in a page + item has a variant id** → the iframe posts a message to the parent page; the SDK turns it into a DOM event you handle with your platform's cart API and then confirm:
   basket.on('basket.addToCart', d => fetch('/cart/add.js', { method:'POST', body: JSON.stringify({ items:[{ id: d.variantId, quantity: d.quantity }] }) }).then(r => d.respond(r.ok)));
   basket.on('basket.addToCartBulk', d => addAll(d.items).then(ok => d.respond(ok)));
   (or pass onAddToCart / onAddToCartBulk to init). respond(true) shows "Added ✓" in the basket, respond(false, 'msg') an error. The Shopify theme block does exactly this with /cart/add.js.
3. **cart_url pattern** (no message handler / not embedded) → opens the pattern URL in a new tab with placeholders filled from the item's checkout meta.
4. Otherwise → "View product": opens the product/affiliate URL (label = view_button_text / fallback_text).
Where the variant id comes from: pass it on the save button – data-metadata='{"variantId":"123","quantity":1}' (or open({ metadata })). It is stored per product and domain as checkout meta and returned with the item. Without it the basket can only offer "View product".`,

  events: `# Events & messages
SDK (window, CustomEvent, detail = payload) – subscribe with basket.on(name, fn) or window.addEventListener('sharewish:' + name):
- basket.mounted { configId, container } · basket.drawer { open } · basket.error { code, message, configId }
- basket.addToCart { variantId, quantity, productId, productTitle, respond(ok, err) } · basket.addToCartBulk { items:[{id, quantity, title}], respond }
- basket.checkout { kind: "single"|"bulk", detail } (fires alongside the two above)
Save button SDK: ShareAWish.on('saved' | 'open' | 'close' | 'error').
Iframe → parent postMessage (handled by the SDK; only relevant without the SDK): shareawish:resize, shareawish:addToCart, shareawish:addToCartBulk; parent → iframe: shareawish:addToCartResult, shareawish:addToCartBulkResult.
Analytics: the SDK reports opens via POST /baskets/{id}/event; saves and checkouts count as wishlist actions (usage_get).`,
};

export function basketGuide(topic?: string): string {
  const t = (topic || 'all').toLowerCase();
  if (t !== 'all' && BASKET_GUIDE[t]) return BASKET_GUIDE[t];
  return Object.values(BASKET_GUIDE).join('\n\n');
}

export function saveButtonSnippet(fw: string, key: string): string {
  switch (fw) {
    case 'react': return `// npm install @shareawish/widget
import { useEffect, useRef } from 'react';
import { init, mount, on } from '@shareawish/widget';

export function SaveToWishlistButton({ product }: { product: { url: string; id: string; title: string; price: number; currency: string; imageUrl?: string } }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    init({ key: '${key}', locale: 'de-DE' });
    const offSaved = on('saved', (item) => console.log('saved', item));
    const unmount = mount(btn.current!, { productUrl: product.url, productId: product.id, title: product.title, price: product.price, currency: product.currency, imageUrl: product.imageUrl });
    return () => { unmount(); offSaved(); };
  }, [product.url]);
  return <button ref={btn} type="button">Auf die Wunschliste</button>;
}`;
    case 'vue': return `<!-- npm install @shareawish/widget -->
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { init, mount, on } from '@shareawish/widget';
const props = defineProps<{ product: { url: string; id: string; title: string; price: number; currency: string; imageUrl?: string } }>();
const btn = ref<HTMLButtonElement>();
let cleanup: Array<() => void> = [];
onMounted(() => {
  init({ key: '${key}', locale: 'de-DE' });
  cleanup.push(mount(btn.value!, { productUrl: props.product.url, productId: props.product.id, title: props.product.title, price: props.product.price, currency: props.product.currency, imageUrl: props.product.imageUrl }));
  cleanup.push(on('saved', (item) => console.log('saved', item)));
});
onBeforeUnmount(() => cleanup.forEach((fn) => fn()));
</script>
<template><button ref="btn" type="button">Auf die Wunschliste</button></template>`;
    case 'shopify': return `{%- comment -%} Preferred: install the Share a Wish Shopify app and add the theme blocks (no code). Manual fallback: {%- endcomment -%}
<script src="${CDN_WIDGET}" data-shareawish-key="${key}" defer></script>
<button type="button" class="button button--secondary" data-shareawish
  data-url="{{ shop.url }}{{ product.url }}" data-id="{{ product.id }}"
  data-title="{{ product.title | escape }}" data-description="{{ product.description | strip_html | truncate: 200 | escape }}"
  data-image-url="{{ product.featured_image | image_url: width: 800 }}"
  data-price="{{ product.selected_or_first_available_variant.price }}" data-currency="{{ shop.currency }}"
  data-market="{{ localization.language.iso_code }}-{{ localization.country.iso_code }}"
  data-metadata='{{ product.selected_or_first_available_variant.id | json | prepend: "{\\"variantId\\":" | append: ",\\"quantity\\":1}" }}'>
  Auf die Wunschliste
</button>`;
    default: return `<!-- Share a Wish save button (drop-in) -->
<script src="${CDN_WIDGET}" data-shareawish-key="${key}" defer></script>

<button
  data-shareawish
  data-url="https://shop.example.com/products/42"
  data-id="42"
  data-title="Blue Sneaker"
  data-price="7990"
  data-currency="EUR"
  data-image-url="https://shop.example.com/img/42.jpg"
  data-market="de-DE">
  Auf die Wunschliste
</button>

<script>
  window.addEventListener('DOMContentLoaded', function () {
    var sdk = window.ShareAWish.getInstance() || window.ShareAWish.init({ key: '${key}' });
    sdk.on('saved', function (item) { console.log('saved', item); });
    sdk.on('error', function (err) { console.warn('shareawish error', err.code); });
  });
</script>`;
  }
}

export function basketSnippet(fw: string, key: string, configId: string, mode = 'drawer'): string {
  const init = `ShareWishBasket.init({ apiKey: '${key}', configId: '${configId}' })`;
  const cartHandler = `  // "Add to cart" from the basket arrives here – call your cart API, then confirm:
  onAddToCart: function (d) { /* d.variantId, d.quantity, d.productId */ addToCart(d.variantId, d.quantity).then(function (ok) { d.respond(ok); }); },
  onAddToCartBulk: function (d) { addAll(d.items).then(function (ok) { d.respond(ok); }); }`;
  const initWithHandlers = `ShareWishBasket.init({
  apiKey: '${key}', configId: '${configId}',
${cartHandler}
})`;
  if (fw === 'shopify') return `{% comment %} Preferred: install the Share a Wish Shopify app and add the "Wishlist basket" theme block – it adds to cart via /cart/add.js for you. Manual fallback: {% endcomment %}
<div id="sharewish-basket"></div>
<script src="${CDN_BASKET}"></script>
<script>${init}.renderInto('#sharewish-basket');</script>`;
  if (fw === 'woocommerce') return `<?php
// functions.php – enqueue the basket SDK and render a drawer trigger in the header
add_action('wp_enqueue_scripts', function () { wp_enqueue_script('sharewish-basket', '${CDN_BASKET}', array(), '1.1', true); });
add_action('wp_footer', function () { ?>
  <script>
    var basket = ShareWishBasket.init({
      apiKey: '${key}', configId: '${configId}',
      onAddToCart: function (d) {
        var fd = new FormData(); fd.append('product_id', d.productId); fd.append('quantity', d.quantity || 1);
        fetch('/?wc-ajax=add_to_cart', { method: 'POST', body: fd }).then(function (r) { d.respond(r.ok); jQuery(document.body).trigger('wc_fragment_refresh'); });
      }
    });
    basket.drawer({ trigger: '.sharewish-open', title: 'My wishlist' });
  </script>
<?php });
// Put <a href="#" class="sharewish-open">Wishlist</a> into your header template.`;
  if (fw === 'react') return `// React wrapper – drawer opened from a header button, iframe loaded lazily
import { useEffect, useRef } from 'react';
declare global { interface Window { ShareWishBasket: any } }
export function WishlistDrawerButton() {
  const drawer = useRef<any>(null);
  useEffect(() => {
    const s = document.createElement('script'); s.src = '${CDN_BASKET}'; s.async = true;
    s.onload = () => {
      const basket = window.ShareWishBasket.init({
        apiKey: '${key}', configId: '${configId}',
        onAddToCart: (d: any) => addToCart(d.variantId, d.quantity).then((ok: boolean) => d.respond(ok)),
      });
      drawer.current = basket.drawer({ title: 'My wishlist', side: 'right', width: '440px' });
    };
    document.body.appendChild(s);
    return () => { s.remove(); };
  }, []);
  return <button type="button" onClick={() => drawer.current?.open()}>Wishlist</button>;
}
async function addToCart(variantId: string, quantity: number) { const r = await fetch('/api/cart', { method: 'POST', body: JSON.stringify({ variantId, quantity }) }); return r.ok; }`;
  if (mode === 'inline' || mode === 'page') return `<!-- Share a Wish basket as an inline section${mode === 'page' ? ' (standalone /wishlist page)' : ''}. Page must be https (http://localhost ok). -->
<div id="sharewish-basket"></div>
<script src="${CDN_BASKET}"></script>
<script>
  var basket = ${initWithHandlers};
  basket.renderInto('#sharewish-basket');
  basket.on('basket.error', function (e) { console.warn('basket', e.code, e.message); });
</script>`;
  return `<!-- Share a Wish basket as a side panel (drawer). Page must be https (http://localhost ok). -->
<button type="button" id="wishlist-button">Wishlist <span id="wishlist-count"></span></button>
<script src="${CDN_BASKET}"></script>
<script>
  var basket = ${initWithHandlers};
  var drawer = basket.drawer({ trigger: '#wishlist-button', side: 'right', width: '440px', title: 'My wishlist' });
  basket.on('basket.error', function (e) { console.warn('basket', e.code, e.message); });
  // After a save via the save button, refresh the drawer so the new item shows up:
  if (window.ShareAWish) ShareAWish.on('saved', function () { drawer.refresh(); });
</script>`;
}

let docsCache: { at: number; text: string } | null = null;
export async function fetchText(url: string): Promise<string> { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.text(); }

/** Register docs_search, snippet_save_button and snippet_basket on a server. */
export function registerDocsAndSnippetTools(server: McpServer, opts: { basketNeedsWishlistServer?: boolean } = {}): void {
  const keyHint = opts.basketNeedsWishlistServer
    ? ' Keys come from the shareawish-wishlist server (keys_create) or the Partner Portal → API & Integrations → API Keys; without a key a placeholder is used.'
    : ' Uses your key if given, else a placeholder.';

  server.registerTool('snippet_save_button', { title: 'Save-button snippet', description: 'Copy-paste code for the save-to-wishlist button on any website (html, react, vue, shopify).' + keyHint,
    inputSchema: { framework: z.enum(['html', 'react', 'vue', 'shopify']).default('html'), public_key: z.string().optional() } },
    async ({ framework, public_key }) => ok(saveButtonSnippet(framework, public_key || KEY_PLACEHOLDER) + `\n\n// Script: ${CDN_WIDGET} · npm: @shareawish/widget · docs: ${DOCS}/save-button/ · test keys work on http://localhost without allow-list`));

  server.registerTool('snippet_basket', { title: 'Basket snippet', description: 'Copy-paste code for the wishlist basket: mode "drawer" (side panel opened from a header button – recommended), "inline" (section on a page) or "page" (standalone wishlist page); frameworks html, react, shopify, woocommerce. Includes the add-to-cart bridge (onAddToCart → respond). Needs a basket config id (bkt_…' + (opts.basketNeedsWishlistServer ? ', created with baskets_create on the shareawish-wishlist server or in the Partner Portal' : ', see baskets_create') + '). The embedding page must be https (http://localhost is allowed).',
    inputSchema: { framework: z.enum(['html', 'react', 'shopify', 'woocommerce']).default('html'), mode: z.enum(['drawer', 'inline', 'page']).default('drawer'), public_key: z.string().optional(), config_id: z.string().optional() } },
    async ({ framework, mode, public_key, config_id }) => ok(basketSnippet(framework, public_key || KEY_PLACEHOLDER, config_id || 'bkt_YOUR_CONFIG_ID', mode) + `\n\n// Script: ${CDN_BASKET} · docs: ${DOCS}/#basket · basket_guide(topic="checkout") explains how add-to-cart reaches your shop\n// ${BASKET_HTTPS_NOTE}`));

  server.registerTool('basket_guide', { title: 'Basket guide', description: 'How the wishlist basket works and how to integrate it well: config fields (layout, colours, typography, animation, labels, empty state), embedding patterns (drawer/side panel, inline, standalone page, Shopify), checkout mechanics (webhook, add-to-cart bridge, cart URL pattern, view product), events. No credentials needed. Read before baskets_create.',
    inputSchema: { topic: z.enum(['all', 'overview', 'config', 'embedding', 'checkout', 'events']).default('all') } },
    async ({ topic }) => ok(basketGuide(topic)));

  server.registerTool('docs_search', { title: 'Search docs', description: 'Search the public developer docs (llms.txt index + endpoint summary) and return matching sections with links. No credentials needed.',
    inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(25).default(8) } },
    guard(async ({ query, limit }) => {
      if (!docsCache || Date.now() - docsCache.at > 10 * 60_000) {
        const [llms, summary] = await Promise.all([fetchText(`${DOCS}/llms.txt`).catch(() => ''), fetchText(SUMMARY_URL).catch(() => '{}')]);
        let ops = '';
        try { const j = JSON.parse(summary) as Record<string, unknown[]>; for (const [tag, entries] of Object.entries(j)) if (Array.isArray(entries)) for (const e of entries) { const o = Array.isArray(e) ? { method: e[0], path: e[1], summary: e[2] } : (e as Record<string, unknown>); ops += `\n## ${String(o.method || '').toUpperCase()} ${o.path}\n[${tag}] ${o.summary || ''}\n`; } } catch { /* ignore */ }
        const builtin = `## Basket embedding requires https\n${BASKET_HTTPS_NOTE}\n\n## Which MCP server for what\n${INTEGRATION_POINTER}\n\n${Object.values(BASKET_GUIDE).join('\n\n')}\n`;
        docsCache = { at: Date.now(), text: `${builtin}\n${llms}\n${ops}` };
      }
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const sections = docsCache.text.split(/\n(?=#{1,3} )/).map((s) => s.trim()).filter(Boolean);
      const scored = sections.map((s) => ({ s, score: terms.reduce((acc, t) => acc + (s.toLowerCase().includes(t) ? 1 + (s.toLowerCase().split(t).length - 1) * 0.1 : 0), 0) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
      return scored.length ? ok(scored.map((x) => x.s.slice(0, 900)).join('\n\n---\n\n')) : ok(`No matches for "${query}". Try: widget init, save, basket, hosted list, rate limit, errors. Docs: ${DOCS}/`);
    }));
}
