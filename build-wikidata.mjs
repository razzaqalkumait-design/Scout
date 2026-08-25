#!/usr/bin/env node
/**
 * build-wikidata.mjs
 * -------------------
 * Builds players.json from Wikidata (free, no API-Football key).
 * Walks famous clubs, pulls anyone listed as having played there
 * (including retired), then writes SCOUT's player records.
 *
 *   node scripts/build-wikidata.mjs
 *
 * Resumable: re-run merges into the existing players.json.
 */

import fs from "node:fs/promises";
import path from "node:path";

const CACHE_PATH = path.join(process.cwd(), "players.json");
const SPARQL = "https://query.wikidata.org/sparql";
const UA = "SCOUT-Football-Game/1.0 (local encyclopedia; github.com/razzaqalkumait-design/Scout)";
const DELAY_MS = 1500;

const CLUBS = [
  { id: "Q18656", name: "Manchester United" },
  { id: "Q50602", name: "Manchester City" },
  { id: "Q1130849", name: "Liverpool" },
  { id: "Q9616", name: "Chelsea" },
  { id: "Q9617", name: "Arsenal" },
  { id: "Q18741", name: "Tottenham" },
  { id: "Q8682", name: "Real Madrid" },
  { id: "Q7156", name: "Barcelona" },
  { id: "Q8701", name: "Atletico Madrid" },
  { id: "Q15789", name: "Bayern Munich" },
  { id: "Q41420", name: "Borussia Dortmund" },
  { id: "Q1422", name: "Juventus" },
  { id: "Q1543", name: "AC Milan" },
  { id: "Q631", name: "Inter Milan" },
  { id: "Q19045", name: "Napoli" },
  { id: "Q2739", name: "AS Roma" },
  { id: "Q483020", name: "PSG" },
  { id: "Q132885", name: "Marseille" },
  { id: "Q19518", name: "Monaco" },
  { id: "Q81888", name: "Ajax" },
  { id: "Q13143", name: "Benfica" },
  { id: "Q128446", name: "Porto" },
  { id: "Q75729", name: "Sporting CP" },
  { id: "Q19593", name: "Celtic" },
  { id: "Q80955", name: "Santos" },
  { id: "Q17479", name: "Flamengo" },
  { id: "Q170703", name: "Boca Juniors" },
  { id: "Q15799", name: "River Plate" },
  { id: "Q10329", name: "Sevilla" },
  { id: "Q10333", name: "Valencia" },
  { id: "Q18732", name: "Everton" },
  { id: "Q19470", name: "Aston Villa" },
  { id: "Q18711", name: "Leicester City" },
  { id: "Q101959", name: "Bayer Leverkusen" },
  { id: "Q128084", name: "Feyenoord" },
  { id: "Q9950", name: "PSV" },
  // Middle East — national teams (past and present caps)
  { id: "Q186243", name: "Iraq" },
  { id: "Q189723", name: "Saudi Arabia" },
  { id: "Q235910", name: "United Arab Emirates" },
  { id: "Q232731", name: "Qatar" },
  { id: "Q184602", name: "Iran" },
  { id: "Q275940", name: "Jordan" },
  { id: "Q272097", name: "Syria" },
  { id: "Q206828", name: "Kuwait" },
  { id: "Q210460", name: "Bahrain" },
  { id: "Q206834", name: "Oman" },
  { id: "Q206523", name: "Palestine" },
  { id: "Q320307", name: "Lebanon" },
  { id: "Q208403", name: "Yemen" },
  { id: "Q28089", name: "Egypt" },
  { id: "Q207337", name: "Morocco" },
  { id: "Q181903", name: "Algeria" },
  { id: "Q189728", name: "Tunisia" },
  // Middle East — clubs
  { id: "Q73969", name: "Al-Hilal" },
  { id: "Q482764", name: "Al-Nassr" },
  { id: "Q309480", name: "Al-Ittihad" },
  { id: "Q155423", name: "Al-Ahli" },
  { id: "Q310845", name: "Al-Sadd" },
  { id: "Q16837885", name: "Al-Duhail" },
  { id: "Q310838", name: "Al-Gharafa" },
  { id: "Q310836", name: "Al-Wakrah" },
  { id: "Q223566", name: "Al Ahly" },
  { id: "Q286504", name: "Zamalek" },
  { id: "Q242351", name: "Persepolis" },
  { id: "Q239208", name: "Esteghlal" },
  { id: "Q309483", name: "Al-Ain" },
  { id: "Q812732", name: "Al-Wasl" },
  { id: "Q286580", name: "Al-Shorta" },
  { id: "Q285643", name: "Al-Quwa Al-Jawiya" },
  { id: "Q310849", name: "Al-Talaba" },
  { id: "Q310850", name: "Al-Zawraa" },
  { id: "Q223728", name: "Wydad" },
  { id: "Q73712", name: "Raja Casablanca" },
  { id: "Q231255", name: "Esperance" },
];

const MUST_PLAYERS = ["Q318780"]; // Younis Mahmoud

const CLUB_ALIASES = {
  "Manchester United F.C.": "Manchester United",
  "Manchester City F.C.": "Manchester City",
  "Liverpool F.C.": "Liverpool",
  "Chelsea F.C.": "Chelsea",
  "Arsenal F.C.": "Arsenal",
  "Tottenham Hotspur F.C.": "Tottenham",
  "Real Madrid CF": "Real Madrid",
  "FC Barcelona": "Barcelona",
  "Club Atlético de Madrid": "Atletico Madrid",
  "FC Bayern Munich": "Bayern Munich",
  "Paris Saint-Germain FC": "PSG",
  "Paris Saint-Germain": "PSG",
  "Inter Milan": "Inter Milan",
  "FC Internazionale Milano": "Inter Milan",
  "AC Milan": "AC Milan",
  "Juventus FC": "Juventus",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function qid(uri) {
  return (uri || "").split("/").pop();
}

function mapPosition(label) {
  const s = (label || "").toLowerCase();
  if (s.includes("goal")) return "GK";
  if (s.includes("defen") || s.includes("back") || s.includes("centre-back") || s.includes("sweeper")) return "DF";
  if (s.includes("midfield")) return "MF";
  if (s.includes("forward") || s.includes("winger") || s.includes("striker") || s.includes("attack")) return "FW";
  return "MF";
}

function canonClub(name) {
  if (!name) return null;
  return CLUB_ALIASES[name] || name.replace(/\s+F\.C\.$/, "").replace(/\s+FC$/, "").trim();
}

async function sparql(query) {
  const url = SPARQL + "?query=" + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": UA },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SPARQL ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.results.bindings;
}

async function loadCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_PATH, "utf8"));
  } catch {
    return { players: {}, lastRun: null, source: "wikidata" };
  }
}

async function saveCache(cache) {
  cache.lastRun = new Date().toISOString();
  cache.source = "wikidata";
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function emptyRec(id, name) {
  return {
    id,
    n: name,
    p: "MF",
    nat: "",
    clubs: [],
    cl: 0,
    wc: 0,
    bd: 0,
    retired: 0,
    young: 0,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchClub(club) {
  const query = `
SELECT ?p ?pLabel ?enLabel ?dob ?posLabel ?natLabel WHERE {
  ?p p:P54/ps:P54 wd:${club.id} .
  ?p wdt:P31 wd:Q5 .
  OPTIONAL { ?p wdt:P569 ?dob . }
  OPTIONAL { ?p wdt:P413 ?pos . }
  OPTIONAL { ?p wdt:P1532 ?nat . }
  OPTIONAL { ?p wdt:P27 ?nat . }
  OPTIONAL { ?p rdfs:label ?enLabel . FILTER(LANG(?enLabel) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 2500`;
  return sparql(query);
}

async function fetchMustPlayer(id) {
  const query = `
SELECT ?p ?pLabel ?enLabel ?dob ?posLabel ?natLabel ?club ?clubLabel WHERE {
  BIND(wd:${id} AS ?p)
  OPTIONAL { ?p wdt:P569 ?dob . }
  OPTIONAL { ?p wdt:P413 ?pos . }
  OPTIONAL { ?p wdt:P1532 ?nat . }
  OPTIONAL { ?p wdt:P27 ?nat . }
  OPTIONAL { ?p p:P54/ps:P54 ?club . }
  OPTIONAL { ?p rdfs:label ?enLabel . FILTER(LANG(?enLabel) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
  return sparql(query);
}

async function fetchAwards(ids) {
  const flags = { cl: new Set(), wc: new Set(), bd: new Set() };
  const chunk = 80;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const values = slice.map((id) => `wd:${id}`).join(" ");
    const query = `
SELECT ?p ?kind WHERE {
  VALUES ?p { ${values} }
  {
    ?p wdt:P166 wd:Q166177 .
    BIND("bd" AS ?kind)
  } UNION {
    ?p wdt:P2522 wd:Q18755 .
    BIND("cl" AS ?kind)
  } UNION {
    ?p wdt:P2522 wd:Q19317 .
    BIND("wc" AS ?kind)
  } UNION {
    ?p wdt:P166 ?award .
    ?award wdt:P361 wd:Q19317 .
    BIND("wc" AS ?kind)
  }
}`;
    try {
      const rows = await sparql(query);
      for (const row of rows) {
        const id = qid(row.p.value);
        const kind = row.kind.value;
        flags[kind]?.add(id);
      }
    } catch (err) {
      console.warn("  award chunk failed:", err.message);
    }
    await sleep(DELAY_MS);
  }
  return flags;
}

async function main() {
  const cache = await loadCache();
  if (!cache.players) cache.players = {};
  console.log(`Loaded ${Object.keys(cache.players).length} players.`);

  const meIdx = CLUBS.findIndex((c) => c.id === "Q186243");
  const list = process.argv.includes("--me") && meIdx >= 0 ? CLUBS.slice(meIdx) : CLUBS;

  for (const id of MUST_PLAYERS) {
    process.stdout.write(`\nMust-have ${id} … `);
    try {
      const rows = await fetchMustPlayer(id);
      console.log(`${rows.length} rows`);
      for (const row of rows) {
        const pid = qid(row.p.value);
        let name = row.pLabel?.value;
        if (!name || name === pid) name = row.enLabel?.value;
        if (!pid || !name || name === pid) continue;
        const rec = cache.players[pid] || emptyRec(pid, name);
        rec.n = name;
        if (row.posLabel?.value) rec.p = mapPosition(row.posLabel.value);
        if (row.natLabel?.value && !/^\d/.test(row.natLabel.value)) rec.nat = row.natLabel.value;
        if (row.dob?.value) {
          const age = (Date.now() - new Date(row.dob.value).getTime()) / (365.25 * 86400000);
          rec.retired = age > 40 ? 1 : 0;
          rec.young = age < 25 ? 1 : 0;
        }
        const clubName = canonClub(row.clubLabel?.value);
        if (clubName && !rec.clubs.includes(clubName)) rec.clubs.push(clubName);
        rec.fetchedAt = new Date().toISOString();
        cache.players[pid] = rec;
      }
      await saveCache(cache);
    } catch (err) {
      console.log("FAILED", err.message);
    }
    await sleep(DELAY_MS);
  }

  for (const club of list) {
    process.stdout.write(`\n${club.name} (${club.id}) … `);
    let rows;
    try {
      rows = await fetchClub(club);
    } catch (err) {
      console.log("FAILED", err.message);
      await sleep(DELAY_MS * 2);
      continue;
    }
    console.log(`${rows.length} rows`);
    for (const row of rows) {
      const id = qid(row.p.value);
      const name = row.pLabel?.value;
      if (!id || !name || name === id) continue;
      const rec = cache.players[id] || emptyRec(id, name);
      rec.n = name;
      if (row.posLabel?.value) rec.p = mapPosition(row.posLabel.value);
      if (row.natLabel?.value && !/^\d/.test(row.natLabel.value)) rec.nat = row.natLabel.value;
      if (row.dob?.value) {
        const age = (Date.now() - new Date(row.dob.value).getTime()) / (365.25 * 86400000);
        rec.retired = age > 40 ? 1 : 0;
        rec.young = age < 25 ? 1 : 0;
      }
      const c = canonClub(club.name);
      if (c && !rec.clubs.includes(c)) rec.clubs.push(c);
      rec.fetchedAt = new Date().toISOString();
      cache.players[id] = rec;
    }
    await saveCache(cache);
    await sleep(DELAY_MS);
  }

  if (!process.argv.includes("--me")) {
    const ids = Object.keys(cache.players);
    console.log(`\nFetching trophy flags for ${ids.length} players…`);
    const flags = await fetchAwards(ids);
    for (const id of ids) {
      if (flags.bd.has(id)) cache.players[id].bd = 1;
      if (flags.cl.has(id)) cache.players[id].cl = 1;
      if (flags.wc.has(id)) cache.players[id].wc = 1;
    }
    await saveCache(cache);
  }

  console.log(`\nDone. ${Object.keys(cache.players).length} players in ${CACHE_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
