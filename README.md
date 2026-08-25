# SCOUT — Football Akinator

## Files
- `scout.html` — the game. Fully playable standalone (open the file directly)
  using its built-in 79-player seed dataset.
- `scripts/fetch-players.mjs` — fetches player data from API-Football and
  writes/updates `players.json`. Safe to re-run: it caches every player it
  fetches and skips anything already cached and still fresh (30 days by
  default), so re-runs only spend API quota on new or stale players.
- `.github/workflows/sync-players.yml` — runs the fetch script every Monday
  and commits the updated `players.json` automatically.
- `players.json` — the cache file (created on first run of the fetch script;
  not included until then). When this file sits next to `scout.html` in your
  deployment, the game loads it automatically and merges it into the roster.
  Without it, the game just uses the built-in seed dataset — nothing breaks.
