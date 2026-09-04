/**
 * Share a Wish – Wishlist Integration MCP server (stdio).
 * For shops integrating the save-to-wishlist button and the wishlist basket: API keys & domain allowlists,
 * basket configurations & checkout webhooks, embed snippets, usage/limits and docs (OpenAPI).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
/** Numeric id; string digits are accepted because the API returns ids as strings. */
const zid = z.union([z.number().int(), z.string().regex(/^\d+$/)]).transform((v) => Number(v));
import { PARTNER_API_BASE, PUBLIC_API_BASE, authConfigured, authHelp, getAccessToken, currentSessionInfo } from '../shared/auth.js';
import { get, post, put, del, request } from '../shared/http.js';
import { ok, fail, guard, compact } from '../shared/util.js';

const P = PARTNER_API_BASE;
const A = PUBLIC_API_BASE;
const DOCS = (process.env.SHAREAWISH_DOCS_URL || 'https://shareawish.shop/developers').replace(/\/$/, '');
const CDN_WIDGET = 'https://shareawish.shop/sdk/v1/widget.js';
const CDN_BASKET = 'https://shareawish.shop/sdk/v1/basket-integration.js';
const OPENAPI_URL = 'https://shareawish.shop/openapi/shareawish-public-api.yaml';
const SUMMARY_URL = 'https://shareawish.shop/openapi/summary.json';
const KEY_PLACEHOLDER = 'pk_test_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

/** Plan table (Pricing 2026). Source of truth: supabase/functions/_shared/plans.ts */
const PLANS = [
  { id: 'free', name: 'Free', actions_per_month: 200, price_eur: 0, notes: 'Save button + basket, test keys, "powered by" branding' },
  { id: 'starter', name: 'Starter', actions_per_month: 2000, price_eur: 19, notes: 'No branding' },
  { id: 'growth', name: 'Growth', actions_per_month: 15000, price_eur: 49, notes: 'Share pages, price alerts, webhooks, hosted lists with own branding' },
  { id: 'scale', name: 'Scale', actions_per_month: 60000, price_eur: 99, notes: 'Custom domain, API with server keys, priority support' },
  { id: 'enterprise', name: 'Enterprise / Agentur', actions_per_month: null, price_eur: null, notes: 'On request; agency rev-share 25 %' },
];

const server = new McpServer({ name: 'shareawish-wishlist', version: '0.1.0' }, {
  instructions: [
    'Share a Wish Wishlist Integration server for shop developers. Typical flow: whoami → keys_create(environment="test") →',
    'snippet_save_button (embed) → widget_init_check(public_key, origin) to verify key + allowlist → for a basket: baskets_create → snippet_basket.',
    'Live keys need an allowed domain (keys_domains_set). Usage is measured in wishlist actions per month (save, share, list view) – usage_get.',
    'docs_search / openapi_get read the public docs and spec; they work without credentials.',
    authConfigured() ? '' : authHelp(),
  ].filter(Boolean).join('\n'),
});

// ── identity & usage ────────────────────────────────────────────────────────
server.registerTool('whoami', { title: 'Who am I', description: 'Verify credentials; shows the partner session, API keys and current usage.', inputSchema: {} },
  guard(async () => {
    await getAccessToken();
    const [keys, usage] = await Promise.all([get(`${P}/integrations/keys`), get(`${A}/me/usage`).catch((e) => ({ error: String(e.message) }))]);
    return ok({ session: currentSessionInfo(), keys, usage });
  }));

server.registerTool('usage_get', { title: 'Usage this month', description: 'Wishlist actions used vs. plan limit for the current calendar month (save / share / list view breakdown, warning level).', inputSchema: {} },
  guard(async () => ok(await get(`${A}/me/usage`))));

server.registerTool('usage_key', { title: 'Usage of one key', description: 'Rate-limit and monthly usage for a specific public key (authenticates with the key itself).',
  inputSchema: { api_key_id: zid, public_key: z.string().regex(/^pk_(live|test)_/) } },
  guard(async ({ api_key_id, public_key }) => ok(await get(`${A}/api-usage/${api_key_id}`, { auth: { bearer: public_key } }))));

server.registerTool('plans_list', { title: 'Plans', description: 'Shop plans with monthly wishlist-action limits and prices (Pricing 2026).', inputSchema: {} },
  async () => ok(PLANS));

// ── API keys ────────────────────────────────────────────────────────────────
server.registerTool('keys_list', { title: 'List API keys', description: 'All public API keys (pk_live_/pk_test_) with status, allowed domains and monthly usage.', inputSchema: {} },
  guard(async () => ok(await get(`${P}/integrations/keys`))));

server.registerTool('keys_create', { title: 'Create API key', description: 'Create a public key. environment "test" → pk_test_ (works on localhost without allowlist); "prod" → pk_live_ (needs allowed_domains).',
  inputSchema: { label: z.string().max(80).optional(), environment: z.enum(['test', 'prod']).default('test'), allowed_domains: z.array(z.string()).optional().describe('e.g. ["shop.example.com", "*.example.com"]') } },
  guard(async ({ label, environment, allowed_domains }) => {
    if (environment === 'prod' && !(allowed_domains && allowed_domains.length)) return fail('Live keys need at least one allowed domain (allowlist_required). Pass allowed_domains or create a test key.');
    return ok(await post(`${P}/integrations/keys`, compact({ label: label || `${environment === 'prod' ? 'Live' : 'Test'} key (MCP)`, environment, allowed_domains: allowed_domains || [] })));
  }));

server.registerTool('keys_rotate', { title: 'Rotate key', description: 'Issue a new key value; the old one stays valid for 15 minutes (domains are copied).', inputSchema: { id: zid } },
  guard(async ({ id }) => ok(await post(`${P}/integrations/keys/${id}/rotate`))));
server.registerTool('keys_revoke', { title: 'Revoke key', description: 'Revoke a key immediately.', inputSchema: { id: zid } },
  guard(async ({ id }) => ok(await post(`${P}/integrations/keys/${id}/revoke`))));
server.registerTool('keys_delete', { title: 'Delete key', description: 'Delete a key (only unused or revoked keys).', inputSchema: { id: zid } },
  guard(async ({ id }) => ok(await del(`${P}/integrations/keys/${id}`))));
server.registerTool('keys_domains_get', { title: 'Get allowed domains', description: 'Domain allowlist of a key.', inputSchema: { id: zid } },
  guard(async ({ id }) => ok(await get(`${P}/integrations/keys/${id}/domains`))));
server.registerTool('keys_domains_set', { title: 'Set allowed domains', description: 'Replace the allowlist (hosts without scheme; wildcards like *.example.com allowed; localhost is always allowed).',
  inputSchema: { id: zid, domains: z.array(z.string()).min(0) } },
  guard(async ({ id, domains }) => ok(await put(`${P}/integrations/keys/${id}/domains`, { domains }))));

server.registerTool('widget_init_check', { title: 'Check key + origin', description: 'Simulate the widget handshake (POST /widget/init) for a key and origin. Shows whether the origin is allowed, the plan usage headers and any error (origin_not_allowed, allowlist_required, subscription_required).',
  inputSchema: { public_key: z.string().regex(/^pk_(live|test)_/), origin: z.string().url().describe('e.g. https://shop.example.com or http://localhost:3000') } },
  guard(async ({ public_key, origin }) => {
    try {
      const { data, headers } = await request<{ token?: string; partner_id?: number; api_key_id?: number; exp_minutes?: number; overage?: boolean; basketConfig?: unknown }>('POST', `${A}/widget/init`, { auth: { bearer: public_key }, body: { origin }, headers: { Origin: origin } });
      return ok({ ok: true, origin, token_issued: Boolean(data.token), partner_id: data.partner_id, api_key_id: data.api_key_id, exp_minutes: data.exp_minutes, overage: data.overage, usage: { total: headers.get('X-Usage-Total'), limit: headers.get('X-Usage-Limit'), remaining: headers.get('X-Usage-Remaining') } });
    } catch (e) { throw e; }
  }));

// ── baskets ─────────────────────────────────────────────────────────────────
const basketShape = {
  layout: z.enum(['grid', 'list', 'card', 'compact']).optional(), checkout: z.enum(['add_to_cart', 'ajax', 'redirect', 'webhook']).optional(),
  colors: z.object({ primary: z.string().optional(), text: z.string().optional(), background: z.string().optional() }).optional(),
  typography: z.object({ fontFamily: z.string().optional(), buttonText: z.string().optional() }).optional(),
  styling: z.object({ borderRadius: z.number().optional(), animation: z.string().optional() }).optional(),
  cart_url: z.string().optional().describe('Cart URL pattern with {variant_id}/{sku}/{quantity}/{properties.x}'),
  webhook_url: z.string().url().optional(), fallback_text: z.string().optional(), track_saves: z.boolean().optional(), track_checkouts: z.boolean().optional(),
};

server.registerTool('baskets_list', { title: 'List baskets', description: 'Basket (wishlist drawer/checkout) configurations of the partner.', inputSchema: {} },
  guard(async () => ok(await get(`${P}/integrations/baskets`))));
server.registerTool('baskets_get', { title: 'Get basket', description: 'One basket configuration by public id (bkt_…).', inputSchema: { id: z.string() } },
  guard(async ({ id }) => ok(await get(`${P}/integrations/baskets/${id}`))));
server.registerTool('baskets_create', { title: 'Create basket', description: 'Create a basket configuration: layout, colours, checkout method (cart URL pattern or webhook), texts.',
  inputSchema: { name: z.string().min(1), ...basketShape } },
  guard(async (a) => ok(await post(`${P}/integrations/baskets`, compact({ name: a.name, layout: a.layout || 'grid', checkout: a.checkout || 'add_to_cart', colors: a.colors, typography: a.typography, styling: a.styling, cartUrl: a.cart_url, webhookUrl: a.webhook_url, fallbackText: a.fallback_text, trackSaves: a.track_saves ?? true, trackCheckouts: a.track_checkouts ?? true })))));
server.registerTool('baskets_update', { title: 'Update basket', description: 'Update fields of a basket configuration.', inputSchema: { id: z.string(), name: z.string().optional(), ...basketShape } },
  guard(async ({ id, ...a }) => ok(await put(`${P}/integrations/baskets/${id}`, compact({ name: a.name, layout: a.layout, checkout: a.checkout, colors: a.colors, typography: a.typography, styling: a.styling, cartUrl: a.cart_url, webhookUrl: a.webhook_url, fallbackText: a.fallback_text, trackSaves: a.track_saves, trackCheckouts: a.track_checkouts })))));
server.registerTool('baskets_delete', { title: 'Delete basket', description: 'Delete a basket configuration.', inputSchema: { id: z.string() } },
  guard(async ({ id }) => ok(await del(`${P}/integrations/baskets/${id}`))));
server.registerTool('baskets_test_webhook', { title: 'Test basket webhook', description: 'Send a test payload {type:"basket.test"} to the configured webhookUrl and report the HTTP status.', inputSchema: { id: z.string() } },
  guard(async ({ id }) => ok(await post(`${P}/integrations/baskets/${id}/test-webhook`))));
server.registerTool('baskets_public_config', { title: 'Public basket config', description: 'What the SDK sees for a basket id (no credentials needed).', inputSchema: { id: z.string() } },
  guard(async ({ id }) => ok(await get(`${A}/baskets/${id}`, { auth: 'none' }))));

// ── snippets ────────────────────────────────────────────────────────────────
function saveButtonSnippet(fw: string, key: string): string {
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

function basketSnippet(fw: string, key: string, configId: string): string {
  const init = `ShareWishBasket.init({ apiKey: '${key}', configId: '${configId}' }).renderInto('#sharewish-basket');`;
  switch (fw) {
    case 'react': return `// Component wrapper – loads the basket SDK once and mounts it into a div
import { useEffect } from 'react';
export function WishlistBasket() {
  useEffect(() => {
    const s = document.createElement('script'); s.src = '${CDN_BASKET}'; s.async = true;
    s.onload = () => (window as any).${init.replace('ShareWishBasket', 'ShareWishBasket')}
    document.body.appendChild(s);
    return () => { s.remove(); };
  }, []);
  return <div id="sharewish-basket" />;
}`;
    case 'shopify': return `{% comment %} Add to your product template (e.g. sections/main-product.liquid) {% endcomment %}
<div id="sharewish-basket"></div>
<script src="${CDN_BASKET}"></script>
<script>${init}</script>`;
    case 'woocommerce': return `<?php
// functions.php – enqueue the basket SDK on product pages and render the container
add_action('wp_enqueue_scripts', function () { if (is_product()) wp_enqueue_script('sharewish-basket', '${CDN_BASKET}', array(), '1.0', true); });
add_action('woocommerce_after_add_to_cart_button', function () { ?>
  <div id="sharewish-basket"></div>
  <script>if (typeof ShareWishBasket !== 'undefined') { ${init} }</script>
<?php });`;
    default: return `<!-- Share a Wish basket (wishlist drawer + checkout). Cart URL placeholders: {product_id} {variant_id} {sku} {quantity} {properties.color} -->
<div id="sharewish-basket"></div>
<script src="${CDN_BASKET}"></script>
<script>${init}</script>`;
  }
}

server.registerTool('snippet_save_button', { title: 'Save-button snippet', description: 'Copy-paste code for the save-to-wishlist button (html, react, vue, shopify). Uses your key if given, else a placeholder.',
  inputSchema: { framework: z.enum(['html', 'react', 'vue', 'shopify']).default('html'), public_key: z.string().optional() } },
  async ({ framework, public_key }) => ok(saveButtonSnippet(framework, public_key || KEY_PLACEHOLDER) + `\n\n// Script: ${CDN_WIDGET} · npm: @shareawish/widget · docs: ${DOCS}/save-button/`));

server.registerTool('snippet_basket', { title: 'Basket snippet', description: 'Copy-paste code for the wishlist basket / checkout drawer (html, react, shopify, woocommerce). Needs a basket config id (baskets_create).',
  inputSchema: { framework: z.enum(['html', 'react', 'shopify', 'woocommerce']).default('html'), public_key: z.string().optional(), config_id: z.string().optional() } },
  async ({ framework, public_key, config_id }) => ok(basketSnippet(framework, public_key || KEY_PLACEHOLDER, config_id || 'bkt_YOUR_CONFIG_ID') + `\n\n// Script: ${CDN_BASKET} · docs: ${DOCS}/wishlist-api/`));

server.registerTool('snippet_hosted_list', { title: 'Hosted list snippet', description: 'Server-side example: create a hosted wishlist for a signed-in user and get its share link.', inputSchema: {} },
  async () => ok(`// Hosted lists live under ${A}/hosted/* and use the end user's Supabase JWT.
const res = await fetch('${A}/hosted/lists', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer <user access token>' },
  body: JSON.stringify({ name: 'Geburtstag', occasion_slug: 'birthday', share_public: true }),
});
const { list } = await res.json();
console.log('share link', 'https://shareawish.de/list/' + list.id); // id = share token
// Public view without account: GET ${A}/hosted/public/lists/{token} and …/items · docs: ${DOCS}/hosted-lists/`));

// ── docs & spec (no credentials needed) ─────────────────────────────────────
let docsCache: { at: number; text: string } | null = null;
async function fetchText(url: string): Promise<string> { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.text(); }

server.registerTool('docs_search', { title: 'Search docs', description: 'Search the public developer docs (llms.txt index + endpoint summary) and return matching sections with links.',
  inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(25).default(8) } },
  guard(async ({ query, limit }) => {
    if (!docsCache || Date.now() - docsCache.at > 10 * 60_000) {
      const [llms, summary] = await Promise.all([fetchText(`${DOCS}/llms.txt`).catch(() => ''), fetchText(SUMMARY_URL).catch(() => '{}')]);
      let ops = '';
      try { const j = JSON.parse(summary) as Record<string, unknown[]>; for (const [tag, entries] of Object.entries(j)) if (Array.isArray(entries)) for (const e of entries) { const o = Array.isArray(e) ? { method: e[0], path: e[1], summary: e[2] } : (e as Record<string, unknown>); ops += `\n## ${String(o.method || '').toUpperCase()} ${o.path}\n[${tag}] ${o.summary || ''}\n`; } } catch { /* ignore */ }
      docsCache = { at: Date.now(), text: `${llms}\n${ops}` };
    }
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const sections = docsCache.text.split(/\n(?=#{1,3} )/).map((s) => s.trim()).filter(Boolean);
    const scored = sections.map((s) => ({ s, score: terms.reduce((acc, t) => acc + (s.toLowerCase().includes(t) ? 1 + (s.toLowerCase().split(t).length - 1) * 0.1 : 0), 0) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
    return scored.length ? ok(scored.map((x) => x.s.slice(0, 900)).join('\n\n---\n\n')) : ok(`No matches for "${query}". Try: widget init, save, basket, hosted list, rate limit, errors. Docs: ${DOCS}/`);
  }));

server.registerTool('openapi_get', { title: 'OpenAPI spec', description: 'Fetch the public OpenAPI 3.1 spec (YAML). Pass a path like "/widget/init" to get just that path item.',
  inputSchema: { path: z.string().optional() } },
  guard(async ({ path }) => {
    const yaml = await fetchText(OPENAPI_URL);
    if (!path) return ok(yaml.length > 60_000 ? `${yaml.slice(0, 60_000)}\n… (truncated; full spec: ${OPENAPI_URL})` : yaml);
    const lines = yaml.split('\n');
    const start = lines.findIndex((l) => l.trim() === `${path}:` || l.trim() === `'${path}':` || l.trim() === `"${path}":`);
    if (start < 0) return fail(`Path ${path} not found in the spec. See ${OPENAPI_URL}`);
    const indent = lines[start].search(/\S/);
    let end = start + 1;
    while (end < lines.length && (lines[end].trim() === '' || lines[end].search(/\S/) > indent)) end++;
    return ok(lines.slice(start, end).join('\n'));
  }));

// ── start ───────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[shareawish-wishlist] ready (${authConfigured() ? 'credentials configured' : 'no credentials – docs/snippet tools still work'})\n`);
