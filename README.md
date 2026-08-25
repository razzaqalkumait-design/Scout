# SCOUT — Football Guesser

Think of a footballer. Answer yes/no. Scout guesses.

Players never need an API key. The roster is a **local file** (`players.json`) built from Wikidata.

## Play

```bash
node api/server.mjs
```

Open http://localhost:3000 — only **Start Scouting**.

## Build the player database (you, once)

This walks famous clubs on Wikidata (including retired players) and writes `players.json`. No API-Football quota.

```bash
node scripts/build-wikidata.mjs
```

Safe to re-run. Then restart the server and refresh the game. The home-screen count should jump well past 79.

Takes a few minutes. If Wikidata rate-limits you, wait and run it again.

## Files

- `scout.html` — the game
- `music.mp3` — optional, same folder
- `api/server.mjs` — serves the game + `/api/players`
- `scripts/build-wikidata.mjs` — builds `players.json`
- `players.json` — local encyclopedia (created by the builder)
