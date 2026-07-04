# Keep-Alive Worker (Dronacharya)

A Cloudflare Worker on a **Cron Trigger** that pings this project's free services
every 12 hours so none of them idle-sleep. This is separate from the Smart
Property worker — deploy it as its own Cloudflare Worker with its own cron.

| Target | Idles after | Kept alive by |
|--------|-------------|---------------|
| HF Space `yantrikaran-innovations-dronacharya-recce-backend` | ~48 h | `GET /api/health` |
| Supabase project (`osnlmlphcceogasgvlrv`) | ~7 days | `GET /rest/v1/missions?limit=1` |

Both values are already filled in ([`src/worker.js`](src/worker.js)) and are public
(HF health is public; the Supabase key is the anon/publishable key).

---

## Deploy — Option A: Dashboard (no CLI, ~2 min)

1. **dash.cloudflare.com → Workers & Pages → Create → Create Worker**.
2. Name it `dronacharya-keepalive`, click **Deploy**, then **Edit code**.
3. Delete the starter code, paste all of [`src/worker.js`](src/worker.js), **Deploy**.
4. Worker → **Settings → Triggers → Cron Triggers → Add** → enter `0 */12 * * *` → **Add**.

**Test now:** open the worker's `*.workers.dev` URL — you should see both targets at `status: 200`
(the Supabase one returns 200 only once the schema is loaded into the new project).

## Deploy — Option B: Wrangler CLI

```bash
cd keepalive-worker
npx wrangler login
npx wrangler deploy
```

## Notes
- Free Workers plan covers this easily (~2 runs/day vs the 100k/day limit).
- Verify via the worker's **Logs** tab or `npx wrangler tail` — one
  `[keepalive] 200 …ms <url>` line per target each run.
