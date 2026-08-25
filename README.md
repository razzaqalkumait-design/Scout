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

## One-time setup
1. Get a free API-Football key: https://www.api-football.com (100 req/day).
2. In your GitHub repo: Settings → Secrets and variables → Actions →
   New repository secret → name it `API_FOOTBALL_KEY`, paste your key.
3. Push these files. The workflow runs automatically every night, or trigger
   it manually anytime from the Actions tab ("Run workflow").

## Running the fetch locally (optional)
```
API_FOOTBALL_KEY=your_key node scripts/fetch-players.mjs
```
This writes/updates `players.json` in the current directory.

## Growing the roster
Add teams to the `TARGET_TEAMS` list in `scripts/fetch-players.mjs`. Each new
team costs ~1 request for its squad list, plus 1 request per *new* player for
their transfer history — already-cached players are skipped for free. The
free tier's 100/day easily covers adding a few teams per run.

## Why not call the API straight from the browser?
Two problems: most sports-data APIs (API-Football included) block direct
cross-origin browser requests without a backend, and even where it works,
every visitor's page load would burn your daily quota independently. Baking
fetched data into a static, periodically-refreshed `players.json` sidesteps
both — same approach as `questions.json` in Triviaty, just refreshed on a
schedule instead of by hand.
