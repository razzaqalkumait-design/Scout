#!/usr/bin/env node
/**
 * SCOUT API
 * ---------
 * Public API the game talks to. API-Football stays on THIS machine —
 * players never need a key.
 *
 *   API_FOOTBALL_KEY=xxxx node api/server.mjs
 *
 * Endpoints
 *   GET  /api/health
 *   GET  /api/players          cached roster
 *   GET  /api/search?q=rabiot  cache first, then API-Football on miss
 *
 * Also serves scout.html and static files from the repo root.
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const API_KEY = process.env.API_FOOTBALL_KEY || "";
const MAX_UPSTREAM = parseInt(process.env.MAX_REQUESTS || "90", 10);
const SEASON = process.env.SEASON || "2026";
const TARGET_TEAMS = [
  { id: 541, name: "Real Madrid" },
  { id: 529, name: "Barcelona" },
  { id: 50, name: "Manchester City" },
  { id: 40, name: "Liverpool" },
  { id: 157, name: "Bayern Munich" },
  { id: 85, name: "PSG" },
  { id: 505, name: "Inter Milan" },
  { id: 496, name: "Juventus" },
  { id: 33, name: "Manchester United" },
  { id: 49, name: "Chelsea" },
];
const CACHE_PATH = path.join(ROOT, "players.json");
const UPSTREAM = "https://v3.football.api-sports.io";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const CLUB_ALIASES = {
  "Paris Saint Germain": "PSG",
  "Paris Saint-Germain": "PSG",
  "Inter": "Inter Milan",
  "FC Internazionale Milano": "Inter Milan",
  "Internazionale": "Inter Milan",
  "Bayern München": "Bayern Munich",
  "FC Bayern München": "Bayern Munich",
  "FC Bayern Munich": "Bayern Munich",
  "Manchester Utd": "Manchester United",
  "Man United": "Manchester United",
  "Man City": "Manchester City",
  "Atlético Madrid": "Atletico Madrid",
  "Atletico de Madrid": "Atletico Madrid",
};

let upstreamCount = 0;
let cache = { players: {}, lastRun: null };
const searchHits = new Map(); // ip -> timestamps

async function loadCache() {
  try {
    cache = JSON.parse(await fs.readFile(CACHE_PATH, "utf8"));
    if (!cache.players) cache.players = {};
  } catch {
    cache = { players: {}, lastRun: null };
  }
}

async function saveCache() {
  cache.lastRun = new Date().toISOString();
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, code, body) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").toString().split(",")[0].trim();
}

function rateLimit(ip, max = 30, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const hits = (searchHits.get(ip) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  searchHits.set(ip, hits);
  return true;
}

async function upstream(endpoint, params) {
  if (!API_KEY) return null;
  if (upstreamCount >= MAX_UPSTREAM) return null;
  const url = new URL(UPSTREAM + endpoint);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  upstreamCount++;
  const res = await fetch(url, { headers: { "x-apisports-key": API_KEY } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.response;
}

function mapPosition(pos) {
  if (!pos) return "MF";
  if (pos.includes("Goal")) return "GK";
  if (pos.includes("Defe")) return "DF";
  if (pos.includes("Mid")) return "MF";
  return "FW";
}

function withAliases(clubs) {
  const out = [...clubs];
  for (const c of clubs) {
    const a = CLUB_ALIASES[c];
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

function trophyFlags(trophies) {
  const names = (trophies || []).map((t) => `${t.league || ""} ${t.place || ""}`.toLowerCase());
  const won = (needle) => names.some((n) => n.includes(needle) && n.includes("winner"));
  return {
    cl: won("champions league") || won("uefa champions") ? 1 : 0,
    wc: won("world cup") ? 1 : 0,
    bd: won("ballon") ? 1 : 0,
  };
}

function normalizePlayer(profile, transfers, trophies) {
  const clubs = withAliases([
    ...new Set(
      (transfers || [])
        .flatMap((t) => [t.teams?.in?.name, t.teams?.out?.name])
        .filter(Boolean)
    ),
  ]);
  const flags = trophyFlags(trophies);
  const age = profile.player.age;
  return {
    id: profile.player.id,
    n: profile.player.name,
    p: mapPosition(profile.statistics?.[0]?.games?.position),
    nat: profile.player.nationality,
    clubs: clubs.length ? clubs : withAliases([profile.statistics?.[0]?.team?.name].filter(Boolean)),
    cl: flags.cl,
    wc: flags.wc,
    bd: flags.bd,
    retired: age > 40 ? 1 : 0,
    young: age < 25 ? 1 : 0,
    fetchedAt: new Date().toISOString(),
  };
}

function fromSquad(p, teamName) {
  return {
    id: p.id,
    n: p.name,
    p: mapPosition(p.position),
    nat: p.nationality || "",
    clubs: withAliases([teamName]),
    cl: 0,
    wc: 0,
    bd: 0,
    retired: p.age > 40 ? 1 : 0,
    young: p.age < 25 ? 1 : 0,
    fetchedAt: new Date().toISOString(),
  };
}

async function fillFromSquads() {
  if (!API_KEY) return;
  console.log("Background fill: pulling squads from API-Football…");
  for (const team of TARGET_TEAMS) {
    if (upstreamCount >= MAX_UPSTREAM) break;
    const squad = await upstream("/players/squads", { team: team.id });
    const roster = squad?.[0]?.players || [];
    console.log(`  ${team.name}: ${roster.length} players`);
    for (const p of roster) {
      const key = String(p.id);
      if (cache.players[key]) continue;
      const rec = fromSquad(p, team.name);
      if (upstreamCount < MAX_UPSTREAM) {
        const transfersRes = await upstream("/transfers", { player: p.id });
        const transfers = transfersRes?.[0]?.transfers;
        if (transfers?.length) {
          rec.clubs = withAliases(
            transfers.flatMap((t) => [t.teams?.in?.name, t.teams?.out?.name])
          );
        }
      }
      cache.players[key] = rec;
    }
    await saveCache();
  }
  console.log(`Background fill done. Roster: ${Object.keys(cache.players).length}. Requests used: ${upstreamCount}.`);
}

function searchCache(q) {
  const needle = q.toLowerCase();
  return Object.values(cache.players).filter((p) =>
    (p.n || "").toLowerCase().includes(needle)
  );
}

async function hydrateBySearch(q) {
  const found = await upstream("/players", { search: q });
  if (!found?.length) return [];
  const out = [];
  for (const row of found.slice(0, 5)) {
    const id = row.player?.id;
    if (!id) continue;
    const key = String(id);
    if (cache.players[key]) {
      out.push(cache.players[key]);
      continue;
    }
    const [profileRes, transfersRes, trophiesRes] = await Promise.all([
      upstream("/players", { id, season: SEASON }),
      upstream("/transfers", { player: id }),
      upstream("/trophies", { player: id }),
    ]);
    const profile = profileRes?.[0] || row;
    const transfers = transfersRes?.[0]?.transfers;
    const trophies = trophiesRes;
    if (!profile?.player) continue;
    cache.players[key] = normalizePlayer(profile, transfers, trophies);
    out.push(cache.players[key]);
  }
  if (out.length) await saveCache();
  return out;
}

function publicPlayer(p) {
  return {
    n: p.n,
    p: p.p,
    nat: p.nat,
    clubs: p.clubs || [],
    cl: p.cl || 0,
    wc: p.wc || 0,
    bd: p.bd || 0,
    retired: p.retired || 0,
    young: p.young || 0,
  };
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/api/health") {
    json(res, 200, {
      ok: true,
      players: Object.keys(cache.players).length,
      lastRun: cache.lastRun,
      upstream: Boolean(API_KEY),
    });
    return;
  }

  if (url.pathname === "/api/players") {
    const players = {};
    for (const [id, p] of Object.entries(cache.players)) {
      players[id] = publicPlayer(p);
    }
    json(res, 200, {
      players,
      lastRun: cache.lastRun,
      source: "scout-api",
      count: Object.keys(players).length,
    });
    return;
  }

  if (url.pathname === "/api/squad") {
    const team = url.searchParams.get("team");
    if (!team) {
      json(res, 400, { error: "team id required", players: [] });
      return;
    }
    const teamId = String(team);
    const teamName =
      TARGET_TEAMS.find((t) => String(t.id) === teamId)?.name || "";
    const squad = await upstream("/players/squads", { team: teamId });
    const roster = squad?.[0]?.players || [];
    const added = [];
    for (const p of roster) {
      const key = String(p.id);
      if (!cache.players[key]) {
        cache.players[key] = fromSquad(p, teamName || p.name);
      }
      added.push(publicPlayer(cache.players[key]));
    }
    if (roster.length) await saveCache();
    json(res, 200, { players: added, count: added.length, team: teamName });
    return;
  }

  if (url.pathname === "/api/search") {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 2) {
      json(res, 400, { error: "query too short", results: [] });
      return;
    }
    if (!rateLimit(clientIp(req))) {
      json(res, 429, { error: "too many searches", results: [] });
      return;
    }
    let results = searchCache(q);
    let from = "cache";
    if (!results.length && API_KEY) {
      try {
        results = await hydrateBySearch(q);
        from = "upstream";
      } catch (err) {
        console.warn("search hydrate failed", err);
      }
    }
    json(res, 200, {
      results: results.map(publicPlayer),
      source: from,
    });
    return;
  }

  json(res, 404, { error: "not found" });
}

async function handleStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/scout.html";
  const file = path.resolve(ROOT, "." + rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await handleStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "server error" }));
    }
  }
});

await loadCache();
server.listen(PORT, HOST, () => {
  console.log(`SCOUT API on http://${HOST}:${PORT}`);
  console.log(`  roster: ${Object.keys(cache.players).length} cached players`);
  console.log(`  upstream: ${API_KEY ? "API-Football key loaded" : "no key — cache/search local only"}`);
});
