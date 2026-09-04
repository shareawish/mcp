/**
 * Share a Wish – Creator Shop MCP server (stdio).
 * Lets an AI agent create and manage affiliate creator shops: shops, images, lists, products (by URL or manual),
 * affiliate-link overrides, product videos, catalog search, analytics and earnings.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
/** Numeric id; string digits are accepted because the API returns ids as strings. */
const zid = z.union([z.number().int(), z.string().regex(/^\d+$/)]).transform((v) => Number(v));
import { PARTNER_API_BASE, PUBLIC_API_BASE, authConfigured, authHelp, getAccessToken, currentSessionInfo } from '../shared/auth.js';
import { get, post, put, patch, del, putBinary } from '../shared/http.js';
import { ok, fail, guard, loadBytes, slugify, compact, toArrayBuffer } from '../shared/util.js';

const P = PARTNER_API_BASE;
const A = PUBLIC_API_BASE;
const SHOP_URL = (handle: string, domain?: string | null) => (domain ? `https://${domain}` : `https://shareawish.shop/${handle}`);

const server = new McpServer({ name: 'shareawish-creator', version: '0.1.0' }, {
  instructions: [
    'Share a Wish Creator Shop server. Typical flow: whoami → shops_check_handle → shops_create → shops_upload_image (logo/cover) →',
    'lists_create → products_add_by_url (source_url + affiliate_url; the product page is scraped for title/image/price) →',
    'media_upload_video (optional product videos) → shops_publish(status="live"). Public URL: https://shareawish.shop/<handle>.',
    'Settings are merged server-side by shops_update (never overwrite unknown keys). All actions run on the signed-in partner account.',
    authConfigured() ? '' : authHelp(),
  ].filter(Boolean).join('\n'),
});

// ── identity ────────────────────────────────────────────────────────────────
server.registerTool('whoami', {
  title: 'Who am I',
  description: 'Verify credentials and show the signed-in partner (email, number of shops). Call this first.',
  inputSchema: {},
}, guard(async () => {
  await getAccessToken();
  const shops = await get<{ shops: Array<{ id: number; name: string; slug: string; is_public: boolean }> }>(`${P}/shops`);
  return ok({ session: currentSessionInfo(), shops: shops.shops.map((s) => ({ id: s.id, name: s.name, handle: s.slug, public: s.is_public, url: SHOP_URL(s.slug) })) });
}));

// ── shops ───────────────────────────────────────────────────────────────────
server.registerTool('shops_list', { title: 'List shops', description: 'List all creator shops of the partner.', inputSchema: {} },
  guard(async () => ok(await get(`${P}/shops`))));

server.registerTool('shops_get', { title: 'Get shop', description: 'Full shop record (name, handle, description, template, settings, images, markets, publish state).',
  inputSchema: { shop_id: zid.describe('Numeric shop id (see shops_list)') } },
  guard(async ({ shop_id }) => ok(await get(`${P}/shops/${shop_id}`))));

server.registerTool('shops_check_handle', { title: 'Check handle', description: 'Check whether a shop handle (URL slug, e.g. "lenas-picks") is available. Returns a slugified suggestion.',
  inputSchema: { handle: z.string().min(2).max(60), exclude_shop_id: zid.optional() } },
  guard(async ({ handle, exclude_shop_id }) => {
    const slug = slugify(handle);
    const r = await get<{ available: boolean }>(`${P}/shops/check-handle`, { query: { handle: slug, excludeShopId: exclude_shop_id } });
    return ok({ handle: slug, available: r.available, url: SHOP_URL(slug) });
  }));

const settingsShape = z.object({
  website: z.string().optional(), instagram: z.string().optional(), tiktok: z.string().optional(), youtube: z.string().optional(), twitter: z.string().optional(),
  extraSocials: z.array(z.object({ label: z.string(), url: z.string(), icon: z.string().optional() })).optional(),
  socialButtonsEnabled: z.boolean().optional(), listLayout: z.string().optional(), imageRatio: z.string().optional(),
  primaryColor: z.string().optional(), accentColor: z.string().optional(), seoIndexing: z.boolean().optional(),
  market_code: z.string().optional().describe('Default market, e.g. "de-DE" or "en-US"'),
  amazonAffiliateTag: z.string().optional().describe('Own Amazon tag, e.g. "meinshop-21"'),
}).passthrough();

server.registerTool('shops_create', { title: 'Create shop', description: 'Create a creator shop (draft). Handle becomes the public URL https://shareawish.shop/<handle>. Publish later with shops_publish.',
  inputSchema: {
    name: z.string().min(2).max(80), handle: z.string().min(2).max(60).describe('URL slug; will be slugified'),
    description: z.string().max(600).optional(), template: z.enum(['classic-grid', 'minimal', 'hero-rows', 'magazine-cards']).optional().describe('Layout template (default classic-grid)'),
    allowed_markets: z.array(z.string()).optional().describe('e.g. ["de-DE","en-US"]; omit = all markets'),
    settings: settingsShape.optional(),
  } },
  guard(async ({ name, handle, description, template, allowed_markets, settings }) => {
    const slug = slugify(handle);
    const r = await post<{ shop: Record<string, unknown> }>(`${P}/shops`, compact({ name, handle: slug, description, template, allowedMarkets: allowed_markets, settings: settings ? { seoIndexing: true, ...settings } : { seoIndexing: true } }));
    return ok({ shop: r.shop, url: SHOP_URL(slug), next: 'Add a logo/cover with shops_upload_image, create a list with lists_create, then shops_publish.' });
  }));

server.registerTool('shops_update', { title: 'Update shop', description: 'Update name/description/template/handle/markets/settings. Settings are merged with the existing ones.',
  inputSchema: {
    shop_id: zid, name: z.string().optional(), description: z.string().optional(), handle: z.string().optional(),
    template: z.enum(['classic-grid', 'minimal', 'hero-rows', 'magazine-cards']).optional(), domain: z.string().optional().describe('Custom domain (Creator Pro)'),
    allowed_markets: z.array(z.string()).optional(), settings: settingsShape.optional(),
  } },
  guard(async ({ shop_id, name, description, handle, template, domain, allowed_markets, settings }) => {
    let merged: Record<string, unknown> | undefined;
    if (settings) {
      const cur = await get<{ shop: { settings?: Record<string, unknown> } }>(`${P}/shops/${shop_id}`);
      merged = { ...(cur.shop.settings || {}), ...settings };
    }
    const r = await put(`${P}/shops/${shop_id}`, compact({ name, description, handle: handle ? slugify(handle) : undefined, template, domain, allowedMarkets: allowed_markets, settings: merged }));
    return ok(r);
  }));

server.registerTool('shops_publish', { title: 'Publish shop', description: 'Set the shop live (public) or back to draft.',
  inputSchema: { shop_id: zid, status: z.enum(['live', 'draft']) } },
  guard(async ({ shop_id, status }) => {
    const r = await post<{ shop: { slug: string; domain?: string | null } }>(`${P}/shops/${shop_id}/publish`, { status });
    return ok({ ...r, url: SHOP_URL(r.shop.slug, r.shop.domain) });
  }));

server.registerTool('shops_upload_image', { title: 'Upload shop image', description: 'Upload a logo or cover image from a local file path or an http(s) URL (max 10 MB; jpg/png/webp) and attach it to the shop.',
  inputSchema: { shop_id: zid, type: z.enum(['logo', 'cover']), source: z.string().describe('Local file path or image URL') } },
  guard(async ({ shop_id, type, source }) => {
    const { bytes, mime, name } = await loadBytes(source);
    if (!mime.startsWith('image/')) return fail(`Not an image: ${mime}`);
    const fd = new FormData();
    fd.append('file', new Blob([toArrayBuffer(bytes)], { type: mime }), name);
    const up = await post<{ url: string; path: string }>(`${P}/upload/shop/${type}?public=true`, fd);
    const field = type === 'logo' ? 'logo' : 'coverImage';
    await put(`${P}/shops/${shop_id}`, { [field]: up.url });
    return ok({ type, url: up.url, path: up.path, bytes: bytes.length });
  }));

// ── lists ───────────────────────────────────────────────────────────────────
server.registerTool('lists_list', { title: 'List lists', description: 'Lists (collections) of a shop with product counts.', inputSchema: { shop_id: zid } },
  guard(async ({ shop_id }) => ok(await get(`${P}/shops/${shop_id}/lists`))));

server.registerTool('lists_get', { title: 'Get list', description: 'A list with its products (each with listItemId, offerId, overrides).', inputSchema: { shop_id: zid, list_id: zid } },
  guard(async ({ shop_id, list_id }) => ok(await get(`${P}/shops/${shop_id}/lists/${list_id}`))));

server.registerTool('lists_create', { title: 'Create list', description: 'Create a product list in a shop (e.g. "Herbst-Favoriten").',
  inputSchema: { shop_id: zid, name: z.string().min(1).max(80), description: z.string().max(500).optional(), cover_image: z.string().url().optional(), is_public: z.boolean().optional(), is_featured: z.boolean().optional(), market_code: z.string().optional() } },
  guard(async ({ shop_id, name, description, cover_image, is_public, is_featured, market_code }) =>
    ok(await post(`${P}/shops/${shop_id}/lists`, compact({ name, description, coverImage: cover_image, isPublic: is_public ?? true, isFeatured: is_featured ?? false, marketCode: market_code })))));

server.registerTool('lists_update', { title: 'Update list', description: 'Rename/describe a list, toggle public/featured, or reorder+prune products by passing the full ordered product id array.',
  inputSchema: { shop_id: zid, list_id: zid, name: z.string().optional(), description: z.string().optional(), cover_image: z.string().optional(), is_public: z.boolean().optional(), is_featured: z.boolean().optional(), products: z.array(zid).optional().describe('Ordered product ids; products not listed are removed from the list') } },
  guard(async ({ shop_id, list_id, name, description, cover_image, is_public, is_featured, products }) =>
    ok(await put(`${P}/shops/${shop_id}/lists/${list_id}`, compact({ name, description, coverImage: cover_image, isPublic: is_public, isFeatured: is_featured, products })))));

server.registerTool('lists_delete', { title: 'Delete list', description: 'Delete a list (products stay in the shop catalog).', inputSchema: { shop_id: zid, list_id: zid } },
  guard(async ({ shop_id, list_id }) => ok(await del(`${P}/shops/${shop_id}/lists/${list_id}`))));

// ── products ────────────────────────────────────────────────────────────────
server.registerTool('products_preview_url', { title: 'Preview product URL', description: 'Scrape a product page (title, image, price, brand) without adding it. Returns productId to reuse in products_add_by_url.',
  inputSchema: { url: z.string().url(), market_code: z.string().optional() } },
  guard(async ({ url, market_code }) => ok(await post(`${A}/hosted/scrape-preview`, compact({ url, market_code })))));

server.registerTool('products_add_by_url', { title: 'Add product by URL', description: 'Add a product to a list from its shop URL. The page is scraped for title/image/price; affiliate_url is the link visitors will click (may equal source_url). Optional overrides for title/image/description/price.',
  inputSchema: {
    shop_id: zid, list_id: zid,
    source_url: z.string().url().describe('Original product page'), affiliate_url: z.string().url().describe('Tracked link (Amazon tag, Awin deeplink …)'),
    market_code: z.string().optional(), title_override: z.string().optional(), image_override_url: z.string().url().optional(), description_override: z.string().optional(),
    manual_price_minor: z.number().int().optional().describe('Price in minor units, e.g. 2999'), manual_price_currency: z.string().length(3).optional(),
    categories: z.array(z.string()).optional(), tags: z.array(z.string()).optional(), adult_only: z.boolean().optional(),
  } },
  guard(async (a) => {
    let product_id: number | undefined;
    try {
      const pre = await post<{ productId?: number; product_id?: number }>(`${A}/hosted/scrape-preview`, compact({ url: a.source_url, market_code: a.market_code }));
      product_id = pre.productId ?? pre.product_id;
    } catch { /* fall back to server-side scrape */ }
    const body = compact({ source_url: a.source_url, affiliate_url: a.affiliate_url, product_id, market_code: a.market_code, title_override: a.title_override, image_override_url: a.image_override_url, description_override: a.description_override, manual_price_minor: a.manual_price_minor, manual_price_currency: a.manual_price_currency, categories: a.categories, tags: a.tags, adult_only: a.adult_only });
    return ok(await post(`${P}/shops/${a.shop_id}/lists/${a.list_id}/items`, body));
  }));

server.registerTool('products_add_manual', { title: 'Add manual product', description: 'Add a product with your own data (no scraping) to the shop catalog. Use lists_update(products) or products_add_existing to place it in a list.',
  inputSchema: {
    shop_id: zid, title: z.string().min(1), affiliate_url: z.string().url(), description: z.string().optional(), price: z.number().optional(), original_price: z.number().optional(), currency: z.string().length(3).optional(),
    image_url: z.string().url().optional(), category: z.string().optional(), tags: z.array(z.string()).optional(), brand: z.string().optional(), market_code: z.string().optional(),
  } },
  guard(async (a) => ok(await post(`${P}/shops/${a.shop_id}/products`, compact({ title: a.title, affiliateUrl: a.affiliate_url, description: a.description, price: a.price, originalPrice: a.original_price, currency: a.currency || 'EUR', imageUrl: a.image_url, category: a.category, tags: a.tags, brand: a.brand, marketCode: a.market_code })))));

server.registerTool('products_add_existing', { title: 'Add existing product to list', description: 'Place a product that already exists (by product id, e.g. from catalog_search) into a list, optionally with an affiliate link and overrides.',
  inputSchema: { shop_id: zid, list_id: zid, product_id: zid, affiliate_url: z.string().url().optional(), market_code: z.string().optional(), title_override: z.string().optional(), image_override_url: z.string().url().optional(), manual_price_minor: z.number().int().optional(), manual_price_currency: z.string().length(3).optional() } },
  guard(async (a) => ok(await post(`${P}/shops/${a.shop_id}/lists/${a.list_id}/products`, compact({ productId: a.product_id, affiliate_url: a.affiliate_url, market_code: a.market_code, title_override: a.title_override, image_override_url: a.image_override_url, manual_price_minor: a.manual_price_minor, manual_price_currency: a.manual_price_currency })))));

server.registerTool('products_update_item', { title: 'Update list item', description: 'Change the affiliate link or overrides of a product in a list (item_id = listItemId from lists_get).',
  inputSchema: { shop_id: zid, list_id: zid, item_id: zid, affiliate_url: z.string().url().optional(), title_override: z.string().optional(), image_override_url: z.string().url().optional(), description_override: z.string().optional(), manual_price_minor: z.number().int().optional(), manual_price_currency: z.string().length(3).optional(), available: z.boolean().optional(), list_item_title: z.string().optional(), list_item_description: z.string().optional(), list_item_image_url: z.string().url().optional() } },
  guard(async (a) => { const { shop_id, list_id, item_id, ...rest } = a; return ok(await put(`${P}/shops/${shop_id}/lists/${list_id}/items/${item_id}`, compact(rest))); }));

server.registerTool('products_remove_item', { title: 'Remove list item', description: 'Remove a product from a list.', inputSchema: { shop_id: zid, list_id: zid, item_id: zid } },
  guard(async ({ shop_id, list_id, item_id }) => ok(await del(`${P}/shops/${shop_id}/lists/${list_id}/items/${item_id}`))));

server.registerTool('catalog_search', { title: 'Search catalog', description: 'Search the affiliate product catalog (Awin feeds, Amazon, existing products) to find products with ready affiliate links.',
  inputSchema: { shop_id: zid, q: z.string().min(1), store: z.string().optional(), brand: z.string().optional(), price_min: z.number().optional(), price_max: z.number().optional(), market: z.string().optional(), limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().optional() } },
  guard(async ({ shop_id, ...q }) => ok(await get(`${P}/shops/${shop_id}/catalog/search`, { query: q as Record<string, string | number | undefined> }))));

// ── product videos ──────────────────────────────────────────────────────────
server.registerTool('media_list', { title: 'List product videos', description: 'Product videos of the partner (optionally filtered by product/shop) plus the plan limit.',
  inputSchema: { product_id: zid.optional(), shop_id: zid.optional() } },
  guard(async ({ product_id, shop_id }) => ok(await get(`${A}/me/media`, { query: { product_id, shop_id } }))));

server.registerTool('media_upload_video', { title: 'Upload product video', description: 'Upload an MP4/MOV (max 200 MB) for a product from a local path or URL, optionally with a poster image, and publish it (status ready). Creator Free: 5 ready videos per shop.',
  inputSchema: { product_id: zid, shop_id: zid.optional(), source: z.string().describe('Local .mp4/.mov path or URL'), poster_source: z.string().optional().describe('Optional local .jpg path or URL'), title: z.string().optional(), caption: z.string().optional(), language: z.string().optional(), duration_s: z.number().optional(), width: z.number().int().optional(), height: z.number().int().optional() } },
  guard(async (a) => {
    const video = await loadBytes(a.source);
    if (!['video/mp4', 'video/quicktime'].includes(video.mime)) return fail(`Unsupported mime ${video.mime}; use video/mp4 or video/quicktime.`);
    const slot = await post<{ video: { path: string; signed_url: string; content_type: string }; poster?: { path: string; signed_url: string }; max_bytes: number }>(`${A}/me/media/upload-url`, compact({ product_id: a.product_id, shop_id: a.shop_id, mime: video.mime, bytes: video.bytes.length, filename: video.name }));
    await putBinary(slot.video.signed_url, video.bytes, video.mime, { 'x-upsert': 'true' });
    let poster_path: string | undefined;
    if (a.poster_source && slot.poster) {
      const poster = await loadBytes(a.poster_source);
      await putBinary(slot.poster.signed_url, poster.bytes, 'image/jpeg', { 'x-upsert': 'true' });
      poster_path = slot.poster.path;
    }
    const created = await post(`${A}/me/media`, compact({ product_id: a.product_id, shop_id: a.shop_id, storage_path: slot.video.path, poster_path, duration_s: a.duration_s, width: a.width, height: a.height, bytes: video.bytes.length, mime: video.mime, title: a.title, caption: a.caption, language: a.language }));
    return ok(created, `Uploaded ${video.bytes.length} bytes to ${slot.video.path}`);
  }));

server.registerTool('media_update', { title: 'Update product video', description: 'Change title/caption/language/position or hide/show (status hidden|ready).',
  inputSchema: { id: zid, title: z.string().optional(), caption: z.string().optional(), language: z.string().optional(), position: z.number().int().optional(), status: z.enum(['hidden', 'ready']).optional() } },
  guard(async ({ id, ...rest }) => ok(await patch(`${A}/me/media/${id}`, compact(rest)))));

server.registerTool('media_delete', { title: 'Delete product video', description: 'Delete a product video and its files.', inputSchema: { id: zid } },
  guard(async ({ id }) => ok(await del(`${A}/me/media/${id}`))));

// ── analytics & earnings ────────────────────────────────────────────────────
server.registerTool('analytics_kpis', { title: 'Analytics KPIs', description: 'Shop visits, product clicks, saves and list clicks over a date range (one shop or all).',
  inputSchema: { shop_id: z.union([zid, z.literal('all')]).optional(), list_id: zid.optional(), from: z.string().optional().describe('YYYY-MM-DD'), to: z.string().optional().describe('YYYY-MM-DD') } },
  guard(async ({ shop_id, list_id, from, to }) => ok(await get(`${P}/analytics/kpis`, { query: { shopId: shop_id ?? 'all', listId: list_id, from, to } }))));

server.registerTool('analytics_top_products', { title: 'Top products', description: 'Most clicked/saved products of a shop.', inputSchema: { shop_id: z.union([zid, z.literal('all')]).optional(), from: z.string().optional(), to: z.string().optional() } },
  guard(async ({ shop_id, from, to }) => ok(await get(`${P}/analytics/top-products`, { query: { shopId: shop_id ?? 'all', from, to } }))));

server.registerTool('earnings_summary', { title: 'Earnings', description: 'Affiliate earnings, clicks, conversions and payouts of a shop (70/30 rev-share on Awin conversions).', inputSchema: { shop_id: zid, months: z.number().int().min(1).max(24).optional() } },
  guard(async ({ shop_id, months }) => ok(await get(`${P}/shops/${shop_id}/earnings`, { query: { months } }))));

// ── start ───────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[shareawish-creator] ready (${authConfigured() ? 'credentials configured' : 'NO credentials – set SHAREAWISH_EMAIL/SHAREAWISH_PASSWORD'})\n`);
