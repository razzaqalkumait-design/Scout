#!/usr/bin/env node
/**
 * fetch-players.mjs
 * -------------------
 * Fetches player + transfer data from API-Football and maintains a local
 * cache (players.json). Safe to re-run: it skips anything already cached
 * and still fresh, so you never re-spend API quota on data you already have.
 *
 * Usage:
 *   API_FOOTBALL_KEY=xxxx node scripts/fetch-players.mjs
 *
 * Env vars:
 *   API_FOOTBALL_KEY   required — your API-Football key
 *   MAX_REQUESTS       optional — hard cap on API calls this run (default 90,
 *                       leaving headroom under the 100/day free tier)
 *   CACHE_TTL_DAYS      optional — how long a cached player is considered
 *                       fresh before we refetch (default 30)
 */

import fs from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.API_FOOTBALL_KEY;
const MAX_REQUESTS = parseInt(process.env.MAX_REQUESTS || "90", 10);
const CACHE_TTL_DAYS = parseInt(process.env.CACHE_TTL_DAYS || "30", 10);
const BASE_URL = "https://v3.football.api-sports.io";
const CACHE_PATH = path.join(process.cwd(), "players.json");
const SEASON = process.env.SEASON || "2025";

// The teams whose current squads we want to pull in. Extend this list to
// grow the game's roster over time -- each new team costs ~1 request for
// the squad list, plus 1 request per NEW player for transfer history.
const TARGET_TEAMS = [
  { id: 541, name: "Real Madrid" },
  { id: 529, name: "Barcelona" },
  { id: 50, name: "Manchester City" },
  { id: 40, name: "Liverpool" },
  { id: 157, name: "Bayern Munich" },
  { id: 85, name: "PSG" },
  { id: 505, name: "Inter Milan" },
  { id: 496, name: "Juventus" },
];

let requestCount = 0;

async function apiGet(endpoint, params) {
  if (requestCount >= MAX_REQUESTS) {
    console.log(`Hit MAX_REQUESTS cap (${MAX_REQUESTS}) — stopping early. Re-run later to continue.`);
    return null;
  }
  const url = new URL(BASE_URL + endpoint);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  requestCount++;
  const res = await fetch(url, { headers: { "x-apisports-key": API_KEY } });
  if (!res.ok) {
    console.warn(`Request failed (${res.status}) for ${endpoint}`, params);
    return null;
  }
  const data = await res.json();
  return data.response;
}

async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { players: {}, lastRun: null };
  }
}

async function saveCache(cache) {
  cache.lastRun = new Date().toISOString();
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function isFresh(entry) {
  if (!entry?.fetchedAt) return false;
  const ageDays = (Date.now() - new Date(entry.fetchedAt).getTime()) / 86400000;
  return ageDays < CACHE_TTL_DAYS;
}

// Big-5-league club -> league name, used to derive yes/no question attributes.
// Extend as you add more clubs to TARGET_TEAMS.
const LEAGUE_BY_CLUB = {
  "Real Madrid": "La Liga", "Barcelona": "La Liga", "Atletico Madrid": "La Liga",
  "Manchester City": "Premier League", "Liverpool": "Premier League",
  "Manchester United": "Premier League", "Chelsea": "Premier League", "Arsenal": "Premier League",
  "Bayern Munich": "Bundesliga", "Borussia Dortmund": "Bundesliga",
  "PSG": "Ligue 1", "Marseille": "Ligue 1", "Monaco": "Ligue 1",
  "Inter Milan": "Serie A", "Juventus": "Serie A", "AC Milan": "Serie A", "Napoli": "Serie A",
};

function normalizePlayer(profile, transfers) {
  const clubs = [...new Set((transfers || []).flatMap(t => [t.teams?.in?.name, t.teams?.out?.name]).filter(Boolean))];
  return {
    id: profile.player.id,
    n: profile.player.name,
    p: mapPosition(profile.statistics?.[0]?.games?.position),
    nat: profile.player.nationality,
    clubs: clubs.length ? clubs : [profile.statistics?.[0]?.team?.name].filter(Boolean),
    retired: profile.player.age > 40 ? 1 : 0,
    young: profile.player.age < 25 ? 1 : 0,
    fetchedAt: new Date().toISOString(),
  };
}

function mapPosition(pos) {
  if (!pos) return "MF";
  if (pos.includes("Goal")) return "GK";
  if (pos.includes("Defe")) return "DF";
  if (pos.includes("Mid")) return "MF";
  return "FW";
}

async function main() {
  if (!API_KEY) {
    console.error("Set API_FOOTBALL_KEY before running this script.");
    process.exit(1);
  }
  const cache = await loadCache();
  console.log(`Loaded cache: ${Object.keys(cache.players).length} players already stored.`);

  for (const team of TARGET_TEAMS) {
    console.log(`\nFetching squad: ${team.name}`);
    const squad = await apiGet("/players/squads", { team: team.id });
    if (!squad) continue;
    const roster = squad[0]?.players || [];

    for (const p of roster) {
      const key = String(p.id);
      if (isFresh(cache.players[key])) {
        continue; // already cached and fresh — no request spent
      }
      if (requestCount >= MAX_REQUESTS) break;

      const [profileRes, transfersRes] = await Promise.all([
        apiGet("/players", { id: p.id, season: SEASON }),
        apiGet("/transfers", { player: p.id }),
      ]);
      const profile = profileRes?.[0];
      const transfers = transfersRes?.[0]?.transfers;
      if (!profile) continue;

      cache.players[key] = normalizePlayer(profile, transfers);
      console.log(`  cached: ${cache.players[key].n}`);
    }
  }

  await saveCache(cache);
  console.log(`\nDone. ${requestCount} requests used this run. Cache now has ${Object.keys(cache.players).length} players.`);
  console.log(`Saved to ${CACHE_PATH}`);
}

main();
