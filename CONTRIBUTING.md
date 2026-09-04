# Contributing

```bash
npm install
npm run typecheck   # tsc
npm run build       # esbuild → dist/creator.js, dist/wishlist.js
npm run smoke       # offline protocol test of both servers
```

Live checks need a Partner Portal account: `SHAREAWISH_TOKEN=saw_pat_… node scripts/smoke.mjs all --live`, `npm run e2e:creator`, `npm run e2e:wishlist` (they create real rows, use a test account).

Tool names are `snake_case`; keep descriptions short and action-oriented, they are what the model sees.
