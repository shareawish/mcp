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
import { registerDocsAndSnippetTools, fetchText, DOCS, OPENAPI_URL, BASKET_HTTPS_NOTE } from '../shared/docs.js';
import { VERSION } from '../shared/version.js';

const P = PARTNER_API_BASE;
const A = PUBLIC_API_BASE;

/** Plan table (Pricing 2026). Source of truth: supabase/functions/_shared/plans.ts */
const PLANS = [
  { id: 'free', name: 'Free', actions_per_month: 200, price_eur: 0, notes: 'Save button + basket, test keys, "powered by" branding' },
  { id: 'starter', name: 'Starter', actions_per_month: 2000, price_eur: 19, notes: 'No branding' },
  { id: 'growth', name: 'Growth', actions_per_month: 15000, price_eur: 49, notes: 'Share pages, price alerts, webhooks, hosted lists with own branding' },
  { id: 'scale', name: 'Scale', actions_per_month: 60000, price_eur: 99, notes: 'Custom domain, API with server keys, priority support' },
  { id: 'enterprise', name: 'Enterprise / Agentur', actions_per_month: null, price_eur: null, notes: 'On request; agency rev-share 25 %' },
];

const server = new McpServer({ name: 'shareawish-wishlist', version: VERSION }, {
  instructions: [
    'Share a Wish Wishlist Integration server for shop developers. Typical flow: whoami → keys_create(environment="test") →',
    'snippet_save_button (embed) → widget_init_check(public_key, origin) to verify key + allowlist → for a basket: baskets_create → snippet_basket.',
    'Live keys need an allowed domain (keys_domains_set). Usage is measured in wishlist actions per month (save, share, list view) – usage_get.',
    'docs_search / openapi_get / snippet_* read the public docs and spec; they work without credentials.',
    'The basket iframe only renders on https pages or http://localhost (CSP frame-ancestors). Creator shops (lists, products, videos) live on the shareawish-creator server.',
    authConfigured() ? '' : authHelp(),
  ].filter(Boolean).join('\n'),
});

// ── identity & usage ────────────────────────────────────────────────────────
server.registerTool('whoami', { title: 'Who am I', description: 'Verify credentials; shows the partner session, API keys and current usage.', inputSchema: {} },
  guard(async () => {
    await getAccessToken();
    const [partner, keys, usage] = await Promise.all([
      get<{ id: string; email?: string; name?: string; company_name?: string | null; plan?: string }>(`${P}/auth/partner`).catch(() => null),
      get(`${P}/integrations/keys`),
      get(`${A}/me/usage`).catch((e) => ({ error: String(e.message) })),
    ]);
    return ok({ partner: partner ? { user_id: partner.id, email: partner.email, name: partner.name, company: partner.company_name || null, plan: partner.plan } : null, session: { auth: process.env.SHAREAWISH_TOKEN ? 'personal_access_token' : 'session', ...currentSessionInfo() }, keys, usage });
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
  layout: z.enum(['grid', 'list', 'cards', 'compact']).optional().describe('grid (default, 2–3 columns), list (rows with image left), cards (large cards), compact (dense rows)'),
  checkout: z.enum(['add-to-cart', 'direct-checkout', 'custom-callback']).optional().describe('Label of the checkout mode in the Partner Portal. The actual behaviour is driven by webhook_url / cart_url / the parent page – see basket_guide(topic="checkout").'),
  colors: z.object({ primary: z.string().optional().describe('Buttons/accents, e.g. "#6459f6"'), text: z.string().optional().describe('Button text colour'), background: z.string().optional().describe('Basket background') }).optional(),
  typography: z.object({ fontFamily: z.string().optional().describe('"inherit" or a family such as Inter, Roboto, Open Sans, Lato, Poppins'), buttonText: z.string().optional().describe('Label of the add-to-cart button') }).optional(),
  styling: z.object({ borderRadius: z.number().optional().describe('px, e.g. 0, 4, 6, 8, 12, 16 or 999 (pill)'), animation: z.enum(['none', 'subtle', 'bounce', 'slide', 'zoom']).optional().describe('Hover animation of product cards') }).optional(),
  cart_url: z.string().optional().describe('Cart URL pattern for non-iframe shops; placeholders {variantId} {id} {sku} {quantity} {properties.x}, e.g. https://shop.example.com/cart/add?id={variantId}&quantity={quantity}'),
  webhook_url: z.string().url().optional().describe('If set, every checkout POSTs JSON {type:"basket_checkout"|"basket_bulk_checkout", product|products, meta, origin} here and nothing else happens client-side'),
  fallback_text: z.string().optional().describe('Label of the fallback "View product" button shown when an item has no cart data (e.g. "Zum Produkt"). Not an empty-state message.'),
  cart_button_text: z.string().optional().describe('Overrides the add-to-cart button label'),
  view_button_text: z.string().optional().describe('Overrides the view-product button label'),
  shop_name: z.string().optional().describe('Shown in the basket subtitle ("All your products saved from <shop_name>"); defaults to the embedding host'),
  explore_url: z.string().url().optional().describe('Empty-state link "Explore products"'),
  popular_url: z.string().url().optional().describe('Empty-state link "Popular items"'),
  track_saves: z.boolean().optional(), track_checkouts: z.boolean().optional(),
};
const basketBody = (a: Record<string, unknown>) => compact({ name: a.name, layout: a.layout, checkout: a.checkout, colors: a.colors, typography: a.typography, styling: a.styling, cartUrl: a.cart_url, webhookUrl: a.webhook_url, fallbackText: a.fallback_text, cartButtonText: a.cart_button_text, viewButtonText: a.view_button_text, shopName: a.shop_name, exploreUrl: a.explore_url, popularUrl: a.popular_url, trackSaves: a.track_saves, trackCheckouts: a.track_checkouts });

server.registerTool('baskets_list', { title: 'List baskets', description: 'Basket (wishlist drawer/checkout) configurations of the partner.', inputSchema: {} },
  guard(async () => ok(await get(`${P}/integrations/baskets`))));
server.registerTool('baskets_get', { title: 'Get basket', description: 'One basket configuration by public id (bkt_…).', inputSchema: { id: z.string() } },
  guard(async ({ id }) => ok(await get(`${P}/integrations/baskets/${id}`))));
server.registerTool('baskets_create', { title: 'Create basket', description: 'Create a basket configuration: layout, colours, typography, styling, checkout (cart URL pattern or webhook), button labels, empty-state links. Read basket_guide first for what the fields do and how to embed the basket (drawer, inline, page).',
  inputSchema: { name: z.string().min(1), ...basketShape } },
  guard(async (a) => ok(await post(`${P}/integrations/baskets`, { ...basketBody(a), layout: a.layout || 'grid', checkout: a.checkout || 'add-to-cart', trackSaves: a.track_saves ?? true, trackCheckouts: a.track_checkouts ?? true }), `Next: snippet_basket(config_id, mode="drawer"). ${BASKET_HTTPS_NOTE}`)));
server.registerTool('baskets_update', { title: 'Update basket', description: 'Update fields of a basket configuration (only the given fields change).', inputSchema: { id: z.string(), name: z.string().optional(), ...basketShape } },
  guard(async ({ id, ...a }) => ok(await put(`${P}/integrations/baskets/${id}`, basketBody(a)))));
server.registerTool('baskets_delete', { title: 'Delete basket', description: 'Delete a basket configuration.', inputSchema: { id: z.string() } },
  guard(async ({ id }) => ok(await del(`${P}/integrations/baskets/${id}`))));
server.registerTool('baskets_test_webhook', { title: 'Test basket webhook', description: 'Send a test payload {type:"basket.test"} to the configured webhookUrl and report the HTTP status.', inputSchema: { id: z.string() } },
  guard(async ({ id }) => ok(await post(`${P}/integrations/baskets/${id}/test-webhook`))));
server.registerTool('baskets_public_config', { title: 'Public basket config', description: 'What the SDK sees for a basket id (no credentials needed).', inputSchema: { id: z.string() } },
  guard(async ({ id }) => ok(await get(`${A}/baskets/${id}`, { auth: 'none' }))));

// ── snippets & docs (shared with the creator server; no credentials needed) ─
registerDocsAndSnippetTools(server);

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
