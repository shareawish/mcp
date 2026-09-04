# @shareawish/mcp

Two [Model Context Protocol](https://modelcontextprotocol.io) servers (stdio) so that Claude, Cursor, Copilot & Co. can work with Share a Wish directly:

| Server | Binary | For whom | What it does |
|---|---|---|---|
| **Creator Shop** | `shareawish-creator-mcp` | Creators / affiliates | Create and manage creator shops: handle check, shop create/update/publish, logo & cover upload, lists, products by URL (scraped) or manual, affiliate-link and title/image/price overrides, catalog search, product videos (upload, hide, delete), analytics, earnings. |
| **Wishlist Integration** | `shareawish-wishlist-mcp` | Shop developers / agencies | API keys (test/live) and domain allowlists, basket (wishlist drawer + checkout) configurations and webhook test, save-button and basket embed snippets (HTML/React/Vue/Shopify/WooCommerce), usage vs. plan limits, plan table, docs search and OpenAPI lookup. |

Both are single-file bundles without runtime dependencies (Node ≥ 18).

## Install

1. Create a personal access token in the [Partner Portal](https://partner.shareawish.shop) → API & Integrations → Access tokens (`saw_pat_…`, shown once).
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

## Notes

- Tool names use `snake_case` (`shops_create`, `keys_domains_set`) for maximum client compatibility.
- `shops_update` merges `settings` with the current values (the API overwrites the whole JSON otherwise).
- `products_add_by_url` first calls the scrape preview to reuse an existing catalog product, then adds the item with your `affiliate_url`.
- `media_upload_video`: MP4/MOV up to 200 MB; Creator Free allows 5 ready videos per shop.
- Live keys created after 2026-09-01 need at least one allowed domain; `localhost` is always allowed.
