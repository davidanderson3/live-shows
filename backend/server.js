const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const backendEnvPath = path.resolve(__dirname, '.env');
if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath, override: false });
}

const express = require('express');
const { execFile } = require('child_process');
const util = require('util');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const cors = require('cors');
const { readCachedResponse, writeCachedResponse } = require('../shared/cache');
const { normalizeRecipeQuery, recipeCacheKeyParts } = require('../shared/recipes');
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

const execFileAsync = util.promisify(execFile);
const app = express();
const PORT = Number(process.env.PORT) || 3003;
const HOST = process.env.HOST || (process.env.VITEST ? '127.0.0.1' : '0.0.0.0');
const SONGKICK_API_KEY = process.env.SONGKICK_API_KEY || '';
const HAS_SONGKICK_KEY = Boolean(SONGKICK_API_KEY);
const YELP_CACHE_COLLECTION = 'yelpCache';
const YELP_CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes
const SONGKICK_CACHE_COLLECTION = 'songkickCache';
const SPOONACULAR_CACHE_COLLECTION = 'recipeCache';
const SPOONACULAR_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

// Enable CORS for all routes so the frontend can reach the API
app.use(cors());

const CONTACT_EMAIL = Buffer.from('ZHZkbmRyc25AZ21haWwuY29t', 'base64').toString('utf8');
const mailer = (() => {
  if (!nodemailer || !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
})();

app.use(express.json());

function sendCachedResponse(res, cached) {
  if (!cached || typeof cached.body !== 'string') return false;
  res.status(typeof cached.status === 'number' ? cached.status : 200);
  res.type(cached.contentType || 'application/json');
  res.send(cached.body);
  return true;
}

function yelpCacheKeyParts({ city, latitude, longitude, cuisine }) {
  const normalizedCity = typeof city === 'string' ? city.trim().toLowerCase() : '';
  const normalizedCuisine = typeof cuisine === 'string' ? cuisine.trim().toLowerCase() : '';
  const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);
  const parts = ['yelp'];
  if (hasCoords) {
    const lat = Number(latitude);
    const lon = Number(longitude);
    parts.push('coords');
    parts.push(`${lat.toFixed(4)},${lon.toFixed(4)}`);
  } else {
    parts.push('coords:none');
  }
  if (normalizedCity) {
    parts.push(`city:${normalizedCity}`);
  }
  if (normalizedCuisine) {
    parts.push(`cuisine:${normalizedCuisine}`);
  }
  return parts;
}

const plaidClient = (() => {
  const clientID = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV || 'sandbox';
  if (!clientID || !secret) return null;
  const config = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientID,
        'PLAID-SECRET': secret
      }
    }
  });
  return new PlaidApi(config);
})();

// Serve static files (like index.html, style.css, script.js)
app.use(express.static(path.resolve(__dirname, '../')));

app.post('/contact', async (req, res) => {
  const { name, from, message } = req.body || {};
  if (!from || !message) {
    return res.status(400).json({ error: 'invalid' });
  }
  if (!mailer) {
    return res.status(500).json({ error: 'mail disabled' });
  }
  try {
    await mailer.sendMail({
      to: CONTACT_EMAIL,
      from: process.env.SMTP_USER,
      replyTo: from,
      subject: `Dashboard contact from ${name || 'Anonymous'}`,
      text: message
    });
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Contact email failed', err);
    res.status(500).json({ error: 'failed' });
  }
});

// --- Description persistence ---
const descFile = path.join(__dirname, 'descriptions.json');

function readDescriptions() {
  try {
    const text = fs.readFileSync(descFile, 'utf8');
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function writeDescriptions(data) {
  fs.writeFileSync(descFile, JSON.stringify(data, null, 2));
}

app.get('/api/descriptions', (req, res) => {
  res.json(readDescriptions());
});

app.post('/api/description', (req, res) => {
  const { panelId, position, text } = req.body || {};
  if (!panelId || !['top', 'bottom'].includes(position) || typeof text !== 'string') {
    return res.status(400).json({ error: 'invalid' });
  }
  const data = readDescriptions();
  data[panelId] = data[panelId] || {};
  data[panelId][position] = text;
  writeDescriptions(data);
  res.json({ status: 'ok' });
});

// --- Saved movies persistence ---
const savedFile = path.join(__dirname, 'saved-movies.json');

function readSavedMovies() {
  try {
    const txt = fs.readFileSync(savedFile, 'utf8');
    return JSON.parse(txt);
  } catch {
    return [];
  }
}

function writeSavedMovies(data) {
  fs.writeFileSync(savedFile, JSON.stringify(data, null, 2));
}

app.get('/api/saved-movies', (req, res) => {
  res.json(readSavedMovies());
});

app.post('/api/saved-movies', (req, res) => {
  const movie = req.body || {};
  if (!movie || !movie.id) {
    return res.status(400).json({ error: 'invalid' });
  }
  const data = readSavedMovies();
  if (!data.some(m => String(m.id) === String(movie.id))) {
    data.push(movie);
    writeSavedMovies(data);
  }
  res.json({ status: 'ok' });
});

// --- Spotify client ID ---
app.get('/api/spotify-client-id', (req, res) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'missing' });
  }
  res.json({ clientId, hasSongkickKey: HAS_SONGKICK_KEY });
});

app.get('/api/restaurants', async (req, res) => {
  const { city, cuisine = '' } = req.query || {};
  const rawLatitude = req.query?.latitude;
  const rawLongitude = req.query?.longitude;
  const latitude = typeof rawLatitude === 'string' ? Number(rawLatitude) : Number(rawLatitude);
  const longitude = typeof rawLongitude === 'string' ? Number(rawLongitude) : Number(rawLongitude);
  const yelpKey = req.get('x-api-key') || req.query.apiKey || process.env.YELP_API_KEY;
  if (!yelpKey) {
    return res.status(500).json({ error: 'missing yelp api key' });
  }
  const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);
  if (!city && !hasCoords) {
    return res.status(400).json({ error: 'missing location' });
  }

  const cacheKeyParts = yelpCacheKeyParts({ city, latitude, longitude, cuisine });
  const cached = await readCachedResponse(YELP_CACHE_COLLECTION, cacheKeyParts, YELP_CACHE_TTL_MS);
  if (sendCachedResponse(res, cached)) {
    return;
  }

  const params = new URLSearchParams({
    categories: 'restaurants',
    limit: '20',
    sort_by: 'rating'
  });
  if (city) {
    params.set('location', String(city));
  }
  if (hasCoords) {
    params.delete('location');
    params.set('latitude', String(latitude));
    params.set('longitude', String(longitude));
  }
  if (cuisine) {
    params.set('term', String(cuisine));
  }

  const url = `https://api.yelp.com/v3/businesses/search?${params.toString()}`;

  try {
    const apiRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${yelpKey}`
      }
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      const message = data?.error?.description || data?.error?.code || 'failed';
      return res.status(apiRes.status).json({ error: message });
    }

    const results = Array.isArray(data?.businesses) ? data.businesses : [];
    const simplified = results.map(biz => ({
      id: biz.id,
      name: biz.name,
      address: Array.isArray(biz.location?.display_address)
        ? biz.location.display_address.join(', ')
        : biz.location?.address1 || '',
      city: biz.location?.city || '',
      state: biz.location?.state || '',
      zip: biz.location?.zip_code || '',
      phone: biz.display_phone || biz.phone || '',
      rating: biz.rating ?? null,
      reviewCount: biz.review_count ?? null,
      price: biz.price || '',
      categories: Array.isArray(biz.categories) ? biz.categories.map(c => c.title).filter(Boolean) : [],
      latitude:
        typeof biz.coordinates?.latitude === 'number' ? biz.coordinates.latitude : null,
      longitude:
        typeof biz.coordinates?.longitude === 'number' ? biz.coordinates.longitude : null,
      url: biz.url || '',
      distance: typeof biz.distance === 'number' ? biz.distance : null
    }));

    const payload = JSON.stringify(simplified);
    await writeCachedResponse(YELP_CACHE_COLLECTION, cacheKeyParts, {
      status: 200,
      contentType: 'application/json',
      body: payload,
      metadata: {
        city: typeof city === 'string' ? city : '',
        hasCoords,
        latitude: hasCoords ? latitude : null,
        longitude: hasCoords ? longitude : null,
        cuisine: typeof cuisine === 'string' ? cuisine : '',
        total: simplified.length
      }
    });

    res.type('application/json').send(payload);
  } catch (err) {
    console.error('Restaurant proxy failed', err);
    res.status(500).json({ error: 'failed' });
  }
});

// --- Songkick proxy ---
const SONGKICK_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const SONGKICK_CACHE_MAX_ENTRIES = 200;

const songkickCache = new Map();

function normalizeCoordinate(value, digits = 3) {
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(digits));
}

function toDateString(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

function songkickMemoryCacheKey({ scope, latitude, longitude, radiusKm, startDate, endDate }) {
  const latPart = normalizeCoordinate(latitude, 3);
  const lonPart = normalizeCoordinate(longitude, 3);
  const radiusPart = Number.isFinite(radiusKm) ? Number(radiusKm.toFixed(1)) : 'none';
  return [scope, latPart, lonPart, radiusPart, startDate, endDate].join('::');
}

function songkickCacheKeyParts({ apiKey, latitude, longitude, radiusKm, startDate, endDate }) {
  const keyPart = String(apiKey || '').trim().toLowerCase();
  const latPart = normalizeCoordinate(latitude, 3);
  const lonPart = normalizeCoordinate(longitude, 3);
  const radiusPart = Number.isFinite(radiusKm) ? Number(radiusKm.toFixed(1)) : 'none';
  return [
    'songkick',
    keyPart,
    `lat:${latPart}`,
    `lon:${lonPart}`,
    `radius:${radiusPart}`,
    `from:${startDate}`,
    `to:${endDate}`
  ];
}

function getSongkickCacheEntry(key) {
  const entry = songkickCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > SONGKICK_CACHE_TTL_MS) {
    songkickCache.delete(key);
    return null;
  }
  songkickCache.delete(key);
  songkickCache.set(key, entry);
  return entry.value;
}

function setSongkickCacheEntry(key, value) {
  songkickCache.set(key, { timestamp: Date.now(), value });
  if (songkickCache.size > SONGKICK_CACHE_MAX_ENTRIES) {
    const oldestKey = songkickCache.keys().next().value;
    if (oldestKey) {
      songkickCache.delete(oldestKey);
    }
  }
}

function clampDays(value) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return 14;
  return Math.min(Math.max(num, 1), 31);
}

function normalizeDateString(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return toDateString(date);
}

app.get('/api/songkick', async (req, res) => {
  const { apiKey: queryKey, lat, lon, radius, startDate: startParam, days } = req.query || {};
  const latitude = normalizeCoordinate(lat, 4);
  const longitude = normalizeCoordinate(lon, 4);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ error: 'missing coordinates' });
  }

  const radiusMiles = Number.parseFloat(radius);
  const radiusKm = Number.isFinite(radiusMiles) && radiusMiles > 0 ? radiusMiles * 1.60934 : null;

  const today = toDateString(new Date());
  const normalizedStart = normalizeDateString(startParam) || today;
  const lookaheadDays = clampDays(days);
  const endDate = addDays(normalizedStart, lookaheadDays - 1) || normalizedStart;

  const effectiveKey = queryKey || SONGKICK_API_KEY;
  if (!effectiveKey) {
    return res.status(500).json({ error: 'missing songkick api key' });
  }

  const scope = queryKey ? 'manual' : 'server';
  const memoryKey = songkickMemoryCacheKey({
    scope,
    latitude,
    longitude,
    radiusKm,
    startDate: normalizedStart,
    endDate
  });

  const cached = getSongkickCacheEntry(memoryKey);
  if (cached) {
    return res.status(cached.status).type('application/json').send(cached.text);
  }

  const sharedCached = await readCachedResponse(
    SONGKICK_CACHE_COLLECTION,
    songkickCacheKeyParts({
      apiKey: scope === 'manual' ? queryKey : effectiveKey,
      latitude,
      longitude,
      radiusKm,
      startDate: normalizedStart,
      endDate
    }),
    SONGKICK_CACHE_TTL_MS
  );
  if (sharedCached) {
    setSongkickCacheEntry(memoryKey, {
      status: sharedCached.status,
      text: sharedCached.body
    });
    sendCachedResponse(res, sharedCached);
    return;
  }

  const params = new URLSearchParams({
    apikey: effectiveKey,
    location: `geo:${latitude},${longitude}`,
    per_page: '50',
    min_date: normalizedStart,
    max_date: endDate
  });
  if (Number.isFinite(radiusKm)) {
    params.set('radius', radiusKm.toFixed(1));
  }

  const url = `https://api.songkick.com/api/3.0/events.json?${params.toString()}`;

  try {
    const response = await fetch(url);
    const text = await response.text();
    if (response.ok) {
      setSongkickCacheEntry(memoryKey, { status: response.status, text });
      await writeCachedResponse(SONGKICK_CACHE_COLLECTION, songkickCacheKeyParts({
        apiKey: scope === 'manual' ? queryKey : effectiveKey,
        latitude,
        longitude,
        radiusKm,
        startDate: normalizedStart,
        endDate
      }), {
        status: response.status,
        contentType: 'application/json',
        body: text,
        metadata: {
          latitude,
          longitude,
          radiusMiles: Number.isFinite(radiusMiles) ? radiusMiles : null,
          startDate: normalizedStart,
          endDate,
          usingDefaultKey: !queryKey
        }
      });
    }
    res.status(response.status).type('application/json').send(text);
  } catch (err) {
    console.error('Songkick fetch failed', err);
    res.status(500).json({ error: 'failed' });
  }
});

// --- Spoonacular proxy ---
app.get('/api/spoonacular', async (req, res) => {
  const { query } = req.query || {};
  const apiKey = process.env.SPOONACULAR_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'missing api key' });
  }
  if (!query) {
    return res.status(400).json({ error: 'missing query' });
  }
  const cacheKeyParts = recipeCacheKeyParts(query);
  const cached = await readCachedResponse(
    SPOONACULAR_CACHE_COLLECTION,
    cacheKeyParts,
    SPOONACULAR_CACHE_TTL_MS
  );
  if (sendCachedResponse(res, cached)) {
    return;
  }
  const apiUrl =
    `https://api.spoonacular.com/recipes/complexSearch?query=${encodeURIComponent(
      query
    )}&number=50&offset=0&addRecipeInformation=true&apiKey=${apiKey}`;
  try {
    const apiRes = await fetch(apiUrl);
    const text = await apiRes.text();
    const contentType = apiRes.headers.get('content-type') || 'application/json';
    if (apiRes.ok) {
      await writeCachedResponse(SPOONACULAR_CACHE_COLLECTION, cacheKeyParts, {
        status: apiRes.status,
        contentType,
        body: text,
        metadata: {
          query,
          normalizedQuery: normalizeRecipeQuery(query)
        }
      });
    }
    res.status(apiRes.status).type(contentType).send(text);
  } catch (err) {
    console.error('Spoonacular fetch failed', err);
    res.status(500).json({ error: 'failed' });
  }
});

// --- GeoLayers game endpoints ---
const layerOrder = ['rivers','lakes','elevation','roads','outline','cities','label'];
const countriesPath = path.join(__dirname, '../geolayers-game/public/countries.json');
let countryData = [];
try {
  countryData = JSON.parse(fs.readFileSync(countriesPath, 'utf8'));
} catch {
  countryData = [];
}
const locations = countryData.map(c => c.code);
const leaderboard = [];
const countryNames = Object.fromEntries(countryData.map(c => [c.code, c.name]));

async function fetchCitiesForCountry(iso3) {
  const endpoint = 'https://query.wikidata.org/sparql';
  const query = `
SELECT ?city ?cityLabel ?population ?coord WHERE {
  ?country wdt:P298 "${iso3}".
  ?city (wdt:P31/wdt:P279*) wd:Q515;
        wdt:P17 ?country;
        wdt:P625 ?coord.
  OPTIONAL { ?city wdt:P1082 ?population. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?population)
LIMIT 10`;
  const url = endpoint + '?format=json&query=' + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'dashboard-app/1.0'
    }
  });
  if (!res.ok) throw new Error('SPARQL query failed');
  const data = await res.json();
  const features = data.results.bindings
    .map(b => {
      const m = /Point\(([-\d\.eE]+)\s+([-\d\.eE]+)\)/.exec(b.coord.value);
      if (!m) return null;
      const lon = Number(m[1]);
      const lat = Number(m[2]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          name: b.cityLabel?.value || '',
          population: b.population ? Number(b.population.value) : null
        }
      };
    })
    .filter(Boolean);
  return { type: 'FeatureCollection', features };
}

async function ensureCitiesForCountry(code) {
  const dir = path.join(__dirname, '../geolayers-game/public/data', code);
  const file = path.join(dir, 'cities.geojson');
  if (!fs.existsSync(file)) {
    const geo = await fetchCitiesForCountry(code);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(geo));
    console.log('Fetched cities for', code);
  }
  return file;
}

async function ensureAllCities() {
  for (const code of locations) {
    try {
      await ensureCitiesForCountry(code);
    } catch (err) {
      console.error('Failed to fetch cities for', code, err);
    }
  }
}

function dailySeed() {
  const today = new Date().toISOString().slice(0,10);
  let seed = 0;
  for (const c of today) {
    seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  }
  return seed;
}

function pickLocation() {
  const seed = dailySeed();
  return locations[seed % locations.length];
}

app.get('/daily', (req, res) => {
  const loc = pickLocation();
  res.json({
    locationId: loc,
    layers: layerOrder.map(l => `/layer/${loc}/${l}`)
  });
});

app.get('/countries', (req, res) => {
  const list = Object.entries(countryNames).map(([code, name]) => ({ code, name }));
  res.json(list);
});

app.get('/layer/:loc/:name', async (req, res) => {
  const { loc, name } = req.params;
  const file = path.join(__dirname, '../geolayers-game/public/data', loc, `${name}.geojson`);
  if (name === 'cities' && !fs.existsSync(file)) {
    try {
      await ensureCitiesForCountry(loc);
    } catch (err) {
      console.error('ensureCitiesForCountry failed', err);
    }
  }
  fs.readFile(file, 'utf8', (err, data) => {
    if (err) return res.status(404).send('Layer not found');
    res.type('application/json').send(data);
  });
});

app.post('/score', (req, res) => {
  const { playerName, score } = req.body || {};
  if (typeof playerName === 'string' && typeof score === 'number') {
    leaderboard.push({ playerName, score });
    leaderboard.sort((a, b) => b.score - a.score);
    res.json({ status: 'ok' });
  } else {
    res.status(400).json({ error: 'invalid' });
  }
});

app.get('/leaderboard', (req, res) => {
  res.json(leaderboard.slice(0, 10));
});

app.get('/api/movies', async (req, res) => {
  try {
    const url = 'https://raw.githubusercontent.com/FEND16/movie-json-data/master/json/top-rated-movies-01.json';
    const { stdout } = await execFileAsync('curl', ['-sL', url], { maxBuffer: 5 * 1024 * 1024 });
    const data = JSON.parse(stdout);
    const results = data
      .map(m => ({
        title: m.title,
        score: m.ratings.reduce((a, b) => a + b, 0) / m.ratings.length
      }))
      .slice(0, 10);
    res.json(results);
  } catch (err) {
    console.error('Failed to fetch movies', err);
    res.status(500).json({ error: 'Failed to fetch movies' });
  }
});

app.get('/api/transactions', async (req, res) => {
  if (!plaidClient || !process.env.PLAID_ACCESS_TOKEN) {
    res.status(500).json({ error: 'Plaid not configured' });
    return;
  }
  try {
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    const end = new Date();
    const response = await plaidClient.transactionsGet({
      access_token: process.env.PLAID_ACCESS_TOKEN,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10)
    });
    res.json(response.data);
  } catch (err) {
    console.error('Plaid error', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

const shouldListen = process.env.NODE_ENV !== 'test';

let server = null;
if (shouldListen) {
  server = app
    .listen(PORT, HOST, () => {
      console.log(
        `✅ Serving static files at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`
      );
    })
    .on('error', err => {
      console.error('Failed to start server', err);
      process.exit(1);
    });
  module.exports = server;
  module.exports.app = app;
} else {
  module.exports = app;
}
