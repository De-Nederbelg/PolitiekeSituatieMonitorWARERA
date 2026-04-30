const http = require("http");
const PORT = 3000;
const API_KEY = "";

// BELGIË SETUP
const DEFAULT_COUNTRY_ID = "6813b6d446e731854c7ac7a4";

const CACHE_TTL = 5 * 60 * 1000;
const BAD_IDS = new Set();

const countryCache = {};

function getCountryCache(countryId) {
  if (!countryCache[countryId]) {
    countryCache[countryId] = {
      elections: null,
      lastElectionsFetch: 0,
      electionDetails: {},
      partyDetails: {},
      lastPartyFetch: {},
      userDetails: {},
      parties: null,
      lastPartiesFetch: 0,
    };
  }
  return countryCache[countryId];
}

/* ---- API Functies ---- */
async function wareraFetch(base, proc, input, isPost = false) {
  let url = `${base}/${proc}`;
  const headers = {
    "Content-Type": "application/json",
    ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
  };

  if (isPost) {
    url += "?batch=1";
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ 0: input }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json?.[0]?.result?.data ?? null;
  } else {
    const query = `?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetch(url + query, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json?.result?.data ?? json;
  }
}

async function refreshElectionsList(countryId) {
  const cache = getCountryCache(countryId);
  console.log(`   📡 Verkiezingen ophalen voor ${countryId}...`);
  try {
    const data = await wareraFetch(
      "https://api5.warera.io/trpc",
      "election.getElections",
      { countryId, limit: 100, direction: "forward" },
    );
    cache.elections = data?.items || data?.results || [];
    cache.lastElectionsFetch = Date.now();
    console.log(`   ✅ ${cache.elections.length} verkiezingen gevonden.`);
  } catch (err) {
    console.error(`   ❌ Fout voor ${countryId}:`, err.message);
    cache.elections = cache.elections || [];
    throw err;
  }
}

/* ---- Preload ---- */
async function preloadAllCountries() {
  console.log("🌍 Preload gestart...");
  try {
    // We zorgen dat België als eerste wordt geladen
    await refreshElectionsList(DEFAULT_COUNTRY_ID);

    const all = await wareraFetch(
      "https://api5.warera.io/trpc",
      "country.getAllCountries",
      {},
    );
    const countries = all?.items || all?.results || all || [];

    // De rest van de landen laden (met pauze tegen ratelimits)
    const sorted = countries.sort(
      (a, b) => (b.population || 0) - (a.population || 0),
    );
    for (const country of sorted) {
      if (!country._id || country._id === DEFAULT_COUNTRY_ID) continue;
      await new Promise((r) => setTimeout(r, 2000));
      try {
        await refreshElectionsList(country._id);
      } catch (e) {}
    }
    console.log("🏁 Preload voltooid!");
  } catch (err) {
    console.error("❌ Preload mislukt:", err.message);
  }
}

/* ---- Server ---- */
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, ngrok-skip-browser-warning",
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  res.setHeader("Content-Type", "application/json");
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  const respond = (data, status = 200) => {
    res.writeHead(status);
    res.end(JSON.stringify(data));
  };

  try {
    // 1. Verkiezingen (Standaard België)
    if (path === "/api/elections") {
      const countryId = url.searchParams.get("countryId") || DEFAULT_COUNTRY_ID;
      const cache = getCountryCache(countryId);
      if (
        !cache.elections ||
        Date.now() - cache.lastElectionsFetch > CACHE_TTL
      ) {
        await refreshElectionsList(countryId);
      }
      return respond({ items: cache.elections || [] });
    }

    // 2. Partijen (Standaard België)
    if (path === "/api/parties") {
      const countryId = url.searchParams.get("countryId") || DEFAULT_COUNTRY_ID;
      const cache = getCountryCache(countryId);
      if (
        !cache.parties ||
        Date.now() - (cache.lastPartiesFetch || 0) > 60 * 60 * 1000
      ) {
        const data = await wareraFetch(
          "https://api2.warera.io/trpc",
          "party.getManyPaginated",
          { countryId, limit: 100, direction: "forward" },
          true,
        );
        cache.parties = data?.items || data?.results || data || [];
        cache.lastPartiesFetch = Date.now();
      }
      return respond({ items: cache.parties || [] });
    }

    // 3. Landenlijst
    if (path === "/api/countries") {
      const allCache = getCountryCache("__all__");
      if (
        !allCache.countries ||
        Date.now() - (allCache.lastCountriesFetch || 0) > 24 * 60 * 60 * 1000
      ) {
        const data = await wareraFetch(
          "https://api5.warera.io/trpc",
          "country.getAllCountries",
          {},
        );
        allCache.countries = data?.items || data?.results || data || [];
        allCache.lastCountriesFetch = Date.now();
      }
      return respond({ items: allCache.countries || [] });
    }

    // Overige routes (party, user, election details)
    if (path === "/api/election") {
      const electionId = url.searchParams.get("id");
      if (!electionId) return respond({ error: "Missing id" }, 400);
      const data = await wareraFetch(
        "https://api5.warera.io/trpc",
        "election.getElection",
        { electionId },
      );
      return respond(data || {});
    }

    if (path === "/api/party") {
      const partyId = url.searchParams.get("id");
      if (!partyId) return respond({ error: "Missing id" }, 400);
      const data = await wareraFetch(
        "https://api2.warera.io/trpc",
        "party.getById",
        { partyId },
        true,
      );
      return respond(data || {});
    }

    respond({ error: "Niet gevonden" }, 404);
  } catch (err) {
    respond({ error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(
    `🚀 Proxy server draait op poort ${PORT} (Standaard land: België)`,
  );
  preloadAllCountries();
});
