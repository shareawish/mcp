// Smoke test for both servers: initialize → tools/list → a few calls.
// Usage: node scripts/smoke.mjs [creator|wishlist|all] [--live]   (--live calls authenticated tools; needs SHAREAWISH_EMAIL/PASSWORD)
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const which = process.argv[2] && process.argv[2] !== '--live' ? process.argv[2] : 'all';
const live = process.argv.includes('--live');

function client(bin) {
  const server = spawn(process.execPath, [resolve(root, `dist/${bin}.js`)], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
  const pending = new Map(); let buf = ''; let nextId = 1;
  server.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8'); let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1); if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  const request = (method, params) => new Promise((res, rej) => {
    const id = nextId++; const t = setTimeout(() => rej(new Error(`timeout ${method}`)), 60000);
    pending.set(id, (m) => { clearTimeout(t); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const notify = (method, params) => server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  const call = async (name, args = {}) => { const r = await request('tools/call', { name, arguments: args }); return { text: r.content?.map((c) => c.text).join('\n') ?? '', isError: Boolean(r.isError) }; };
  return { request, notify, call, close: () => server.kill() };
}

let failures = 0;
function check(label, cond, detail = '') { console.log(`${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!cond) failures++; }

async function run(bin, tests) {
  console.log(`\n=== ${bin} ===`);
  const c = client(bin);
  try {
    const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
    check('initialize', Boolean(init.serverInfo?.name), init.serverInfo?.name);
    c.notify('notifications/initialized', {});
    const list = await c.request('tools/list', {});
    check('tools/list', list.tools.length > 5, `${list.tools.length} tools: ${list.tools.map((t) => t.name).join(', ')}`);
    await tests(c, list.tools.map((t) => t.name));
  } catch (e) { check(`${bin} crashed`, false, e.message); }
  finally { c.close(); }
}

if (which === 'wishlist' || which === 'all') await run('wishlist', async (c) => {
  let r = await c.call('plans_list'); check('plans_list', !r.isError && r.text.includes('"actions_per_month": 200'));
  r = await c.call('snippet_save_button', { framework: 'html' }); check('snippet_save_button html', !r.isError && r.text.includes('data-shareawish'));
  r = await c.call('snippet_basket', { framework: 'shopify', config_id: 'bkt_test' }); check('snippet_basket shopify', !r.isError && r.text.includes('bkt_test'));
  r = await c.call('openapi_get', { path: '/widget/init' }); check('openapi_get /widget/init', !r.isError && /widget\/init/.test(r.text), r.isError ? r.text.slice(0, 120) : `${r.text.length} chars`);
  r = await c.call('docs_search', { query: 'rate limit' }); check('docs_search', !r.isError && r.text.length > 20, `${r.text.length} chars`);
  r = await c.call('baskets_public_config', { id: 'bkt_does_not_exist' }); check('baskets_public_config (expected API error)', r.isError && /API error/.test(r.text));
  r = await c.call('widget_init_check', { public_key: 'pk_test_00000000000000000000000000000000', origin: 'http://localhost:3000' }); check('widget_init_check unknown key → error surfaced', r.isError && /unknown_key|403|400/.test(r.text), r.text.split('\n')[0]);
  if (live) {
    r = await c.call('whoami'); check('whoami (live)', !r.isError, r.text.split('\n').slice(0, 2).join(' '));
    r = await c.call('keys_list'); check('keys_list (live)', !r.isError);
    r = await c.call('usage_get'); check('usage_get (live)', !r.isError, r.isError ? r.text.slice(0, 100) : r.text.replace(/\s+/g, ' ').slice(0, 120));
  } else {
    r = await c.call('whoami'); check('whoami without credentials → auth error text', r.isError && /credentials|Authentication/i.test(r.text));
  }
});

if (which === 'creator' || which === 'all') await run('creator', async (c) => {
  let r = await c.call('shops_check_handle', { handle: 'Lenas Picks!' });
  if (live) check('shops_check_handle (live)', !r.isError && r.text.includes('"handle": "lenas-picks"'), r.text.replace(/\s+/g, ' ').slice(0, 100));
  else check('shops_check_handle without credentials → auth error', r.isError && /credentials|Authentication/i.test(r.text));
  if (live) {
    r = await c.call('whoami'); check('whoami (live)', !r.isError, r.text.replace(/\s+/g, ' ').slice(0, 120));
    r = await c.call('shops_list'); check('shops_list (live)', !r.isError);
    r = await c.call('media_list'); check('media_list (live)', !r.isError, r.isError ? r.text.slice(0, 100) : '');
    r = await c.call('products_preview_url', { url: 'https://www.amazon.de/dp/B0C6FFBHRT', market_code: 'de-DE' }); check('products_preview_url (live)', !r.isError, r.text.replace(/\s+/g, ' ').slice(0, 120));
  }
});

console.log(failures ? `\nSMOKE FAILED (${failures})` : '\nSMOKE OK');
process.exit(failures ? 1 : 0);
