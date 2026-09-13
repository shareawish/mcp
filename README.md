# @shareawish/mcp

[![CI](https://github.com/shareawish/mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shareawish/mcp/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@shareawish/mcp)](https://www.npmjs.com/package/@shareawish/mcp)

Two [Model Context Protocol](https://modelcontextprotocol.io) servers (stdio) so that Claude, Cursor, Copilot & Co. can work with Share a Wish directly:

| Server | Binary | For whom | What it does |
|---|---|---|---|
| **Creator Shop** | `shareawish-creator-mcp` | Creators / affiliates | Create and manage creator shops: handle check, shop create/update/publish, logo & cover upload, lists, products by URL (scraped) or manual, affiliate-link and title/image/price overrides, catalog search, product videos (upload, hide, delete), analytics, earnings. Also `docs_search`, `snippet_save_button`, `snippet_basket` (no credentials) so an agent can embed the save button / basket on the creator's own site. |
| **Wishlist Integration** | `shareawish-wishlist-mcp` | Shop developers / agencies | API keys (test/live) and domain allowlists, basket (wishlist drawer + checkout) configurations and webhook test, save-button and basket embed snippets (HTML/React/Vue/Shopify/WooCommerce), usage vs. plan limits, plan table, docs search and OpenAPI lookup. |

Both are single-file bundles without runtime dependencies (Node ≥ 18).

## Install

1. Create a personal access token in the [Partner Portal](https://partner.shareawish.shop) → Account Settings → Access tokens & AI agents (`saw_pat_…`, shown once).
2. Add the server to your MCP client. Every Partner Portal account can use it, the Free plan included; plan limits apply exactly as in the portal.

Claude Code:

```bash
claude mcp add shareawish-creator  -e SHAREAWISH_TOKEN=saw_pat_… -- npx -y -p @shareawish/mcp shareawish-creator-mcp
claude mcp add shareawish-wishlist -e SHAREAWISH_TOKEN=saw_pat_… -- npx -y -p @shareawish/mcp shareawish-wishlist-mcp
```

Cursor / Windsurf / Claude Desktop / VS Code (`mcpServers` in the client config):

```json
{
  "mcpServers": {
    "shareawish-creator": {
      "command": "npx",
      "args": ["-y", "-p", "@shareawish/mcp", "shareawish-creator-mcp"],
      "env": { "SHAREAWISH_TOKEN": "saw_pat_…" }
    },
    "shareawish-wishlist": {
      "command": "npx",
      "args": ["-y", "-p", "@shareawish/mcp", "shareawish-wishlist-mcp"],
      "env": { "SHAREAWISH_TOKEN": "saw_pat_…" }
    }
  }
}
```

From source: `git clone https://github.com/shareawish/mcp && cd mcp && npm install && npm run build`, then use `node dist/creator.js` / `node dist/wishlist.js` as the command.

## Authentication

| Variable | Notes |
|---|---|
| `SHAREAWISH_TOKEN` | Recommended. Personal access token from the Partner Portal. Revocable, expires after 365 days by default, cannot create other tokens. |
| `SHAREAWISH_EMAIL` + `SHAREAWISH_PASSWORD` | Local use only. Signs in on first use, refreshes automatically. |
| `SHAREAWISH_ACCESS_TOKEN` | A session access token (valid ~1 h, no refresh). |
| `SHAREAWISH_REFRESH_TOKEN` | Refresh token of a Partner Portal session. |

Docs, snippet and plan tools of the Wishlist server work without credentials. Nothing is written to disk. Use one token per machine or agent and revoke it when you are done.

Optional: `SHAREAWISH_API_BASE`, `SHAREAWISH_PARTNER_API_BASE`, `SHAREAWISH_DOCS_URL`, `SHAREAWISH_SUPABASE_URL`, `SHAREAWISH_SUPABASE_ANON_KEY` (defaults point at production).

## Typical sessions

**Creator:** `whoami` → `shops_check_handle` → `shops_create` → `shops_upload_image(type=logo, source=./logo.png)` → `lists_create` → `products_add_by_url(source_url, affiliate_url)` → `media_upload_video(product_id, source=./clip.mp4)` → `shops_publish(status=live)`. The public shop is `https://shareawish.shop/<handle>`.

**Shop integrator:** `whoami` → `keys_create(environment=test)` → `snippet_save_button(framework=react, public_key=pk_test_…)` → `widget_init_check(public_key, origin=http://localhost:3000)` → `baskets_create(name, cart_url|webhook_url)` → `snippet_basket(config_id=bkt_…)` → later `keys_create(environment=prod, allowed_domains=[…])`, `usage_get`.

## Test

```bash
npm run smoke                  # offline: protocol, tool list, snippets, docs, error surfacing
SHAREAWISH_EMAIL=… SHAREAWISH_PASSWORD=… node scripts/smoke.mjs all --live   # against the live API
SHAREAWISH_EMAIL=… SHAREAWISH_PASSWORD=… npm run e2e:creator    # creates a draft shop, uploads logo + video, adds a product, publishes, reads it publicly, sets it back to draft
SHAREAWISH_EMAIL=… SHAREAWISH_PASSWORD=… npm run e2e:wishlist   # test key → widget init → basket config → snippets → allowlist → revoke
```

Run the end-to-end scripts with a dedicated test partner: they write real rows (shops stay behind as drafts).

## Which server for what

| Need | Server / tool |
|---|---|
| Public API key (`pk_test_…` / `pk_live_…`), domain allow-list | `shareawish-wishlist`: `keys_create`, `keys_domains_set`, `widget_init_check` — or Partner Portal → API & Integrations |
| Basket configuration (`bkt_…`) | `shareawish-wishlist`: `baskets_create` — or Partner Portal → Basket Integration |
| Embed snippets, docs search, basket know-how | both servers: `snippet_save_button`, `snippet_basket` (drawer / inline / page), `basket_guide`, `docs_search` (no credentials) |
| Creator shops, lists, products, videos, analytics | `shareawish-creator` |

Each server's instructions point to the other one. `whoami` on both servers returns the partner (email, name, plan) and the session type.

**Basket needs https (localhost excepted).** `https://shareawish.shop/basket` is served with `Content-Security-Policy: frame-ancestors 'self' https: http://localhost:* http://127.0.0.1:*` — `http://localhost` works for local tests, any other `http://` page shows an empty iframe. The basket SDK logs `insecure_origin` and dispatches `sharewish:basket.error` in that case.

## Notes

- Tool names use `snake_case` (`shops_create`, `keys_domains_set`) for maximum client compatibility.
- `shops_list` and `lists_list` return compact rows (id, name, handle/slug, public, counts, …) with `q`, `limit`/`offset` paging and `next_offset`; pass `full=true` for the raw records or use `shops_get` / `lists_get`. Raw output for a partner with 170 shops is ~250 KB and exceeds most clients' tool-result limits.
- `shops_update` merges `settings` with the current values (the API overwrites the whole JSON otherwise).
- `products_add_by_url` first calls the scrape preview to reuse an existing catalog product, then adds the item with your `affiliate_url`.
- `media_upload_video`: MP4/MOV up to 200 MB; Creator Free allows 5 ready videos per shop. Every video belongs to one primary product (`product_id`); `product_ids` links further products that are shown next to the video in the shop's video feed (`https://shareawish.shop/<handle>`, "Videos" row). `media_update(product_ids=[...])` replaces those links.
- Live keys created after 2026-09-01 need at least one allowed domain; `localhost` is always allowed.

## Changelog

- **0.1.5** — Basket: `basket_guide` (config fields, drawer/inline/page embedding, checkout mechanics, events) on both servers; `snippet_basket` gets `mode` (drawer default) and the add-to-cart bridge; basket schema aligned with the API (layout `cards`, checkout `add-to-cart|direct-checkout|custom-callback`, `cart_button_text`, `view_button_text`, `shop_name`, `explore_url`, `popular_url`, every field described). Requires basket-integration.js with `drawer()` (deployed 2026-09-14).
- **0.1.4** — Creator server: `whoami` returns the partner profile (email, name, plan) and shop counts; `shops_list` / `lists_list` return compact, filterable, paged rows (`full=true` for raw records); `docs_search`, `snippet_save_button`, `snippet_basket` added; instructions point to the wishlist server for keys and baskets. Wishlist server: `whoami` includes the partner profile; `baskets_create` and `snippet_basket` state the https requirement of the basket iframe (localhost excepted). Shared docs/snippet module.
- **0.1.3** — Product videos: `product_ids` on `media_upload_video` / `media_update`.
