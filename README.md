# SCOUT — Football Guesser

Players never need an API key. They just open the game.

You (the host) run **one** server. It holds your API-Football key, caches players, and is what the game fetches from.

```
browser  →  SCOUT API  →  API-Football (only on cache miss)
              ↑
         your key stays here
```

## Run

```bash
API_FOOTBALL_KEY=your_key node api/server.mjs
```

Then open the URL it prints (not the HTML file). The game loads `/api/players` automatically.

Optional: copy `.env.example` to `.env` and export the key yourself. Do not commit `.env`.

## What players hit

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | status + roster size |
| GET | `/api/players` | full cached roster |
| GET | `/api/search?q=rabiot` | cache first; if missing, fetch once from API-Football and keep it |

A first lookup costs your quota. The next one is free.

## Growing the roster (you, not players)

```bash
API_FOOTBALL_KEY=your_key node scripts/fetch-players.mjs
```

This writes `players.json`. The API serves that file. Safe to re-run — fresh cached players are skipped.

## Files

- `scout.html` — the game
- `music.mp3` — drop next to the HTML (optional)
- `api/server.mjs` — SCOUT API + static file host
- `scripts/fetch-players.mjs` — batch squad sync
- `players.json` — cache (created on first sync/search)
