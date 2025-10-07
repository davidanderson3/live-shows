const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const backendEnvPath = path.resolve(__dirname, '.env');
if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath, override: false });
}

const express = require('express');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const cors = require('cors');
const { readCachedResponse, writeCachedResponse } = require('../shared/cache');
const movieCatalog = require('./movie-catalog');
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

const app = express();

movieCatalog
  .init()
  .catch(err => {
    console.error('Initial movie catalog load failed', err);
  });
const PORT = Number(process.env.PORT) || 3003;
const HOST = process.env.HOST || (process.env.VITEST ? '127.0.0.1' : '0.0.0.0');
const EVENTBRITE_API_TOKEN =
  process.env.EVENTBRITE_API_TOKEN ||
  process.env.EVENTBRITE_OAUTH_TOKEN ||
  process.env.EVENTBRITE_TOKEN ||
  '2YR3RA4K6VCZVEUZMBG4';
const HAS_EVENTBRITE_TOKEN = Boolean(EVENTBRITE_API_TOKEN);
const YELP_BASE_URL = 'https://api.yelp.com/v3/businesses/search';
const YELP_CACHE_COLLECTION = 'yelpCache';
const YELP_CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes
const YELP_MAX_PAGE_LIMIT = 50;
const YELP_DEFAULT_TOTAL_LIMIT = 120;
const YELP_ABSOLUTE_MAX_LIMIT = 200;
const EVENTBRITE_CACHE_COLLECTION = 'eventbriteCache';
const SPOONACULAR_CACHE_COLLECTION = 'recipeCache';
const SPOONACULAR_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const DEFAULT_MOVIE_LIMIT = 20;

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

function parseBooleanQuery(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return false;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return Boolean(normalized);
}

function parseNumberQuery(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizePositiveInteger(value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const clamped = Math.min(Math.max(parsed, min), max);
  return clamped;
}

function yelpCacheKeyParts({ city, latitude, longitude, cuisine, limit }) {
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
  if (Number.isFinite(limit) && limit > 0) {
    parts.push(`limit:${limit}`);
  } else {
    parts.push('limit:default');
  }
  return parts;
}

function simplifyYelpBusiness(biz) {
  if (!biz || typeof biz !== 'object') return null;
  return {
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
    categories: Array.isArray(biz.categories)
      ? biz.categories.map(c => c.title).filter(Boolean)
      : [],
    latitude: typeof biz.coordinates?.latitude === 'number' ? biz.coordinates.latitude : null,
    longitude: typeof biz.coordinates?.longitude === 'number' ? biz.coordinates.longitude : null,
    url: biz.url || '',
    distance: typeof biz.distance === 'number' ? biz.distance : null
  };
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
    return res.status(500).json({ error: 'missing', hasEventbriteToken: HAS_EVENTBRITE_TOKEN });
  }
  res.json({ clientId, hasEventbriteToken: HAS_EVENTBRITE_TOKEN });
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

  const rawLimitParam = req.query?.limit ?? req.query?.maxResults;
  const requestedLimit = normalizePositiveInteger(rawLimitParam, {
    min: 1,
    max: YELP_ABSOLUTE_MAX_LIMIT
  });
  const targetTotal = requestedLimit || YELP_DEFAULT_TOTAL_LIMIT;

  const cacheKeyParts = yelpCacheKeyParts({
    city,
    latitude,
    longitude,
    cuisine,
    limit: targetTotal
  });
  const cached = await readCachedResponse(YELP_CACHE_COLLECTION, cacheKeyParts, YELP_CACHE_TTL_MS);
  if (sendCachedResponse(res, cached)) {
    return;
  }

  try {
    const baseParams = new URLSearchParams({
      categories: 'restaurants'
    });
    if (hasCoords) {
      baseParams.set('latitude', String(latitude));
      baseParams.set('longitude', String(longitude));
      baseParams.set('sort_by', 'distance');
    } else if (city) {
      baseParams.set('location', String(city));
    }
    if (cuisine) {
      baseParams.set('term', String(cuisine));
    }

    const aggregated = [];
    const seenIds = new Set();
    let offset = 0;
    let totalAvailable = null;
    let shouldContinue = true;

    while (shouldContinue && aggregated.length < targetTotal) {
      const remainingNeeded = targetTotal - aggregated.length;
      const batchLimit = Math.min(YELP_MAX_PAGE_LIMIT, remainingNeeded);
      const params = new URLSearchParams(baseParams);
      params.set('limit', String(batchLimit));
      if (offset > 0) {
        params.set('offset', String(offset));
      }

      const apiRes = await fetch(`${YELP_BASE_URL}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${yelpKey}`
        }
      });

      const data = await apiRes.json().catch(() => null);

      if (!apiRes.ok || !data) {
        const message =
          data?.error?.description || data?.error?.code || data?.error || 'failed';
        res.status(apiRes.status).json({ error: message });
        return;
      }

      const results = Array.isArray(data?.businesses) ? data.businesses : [];
      totalAvailable =
        typeof data?.total === 'number' && data.total >= 0 ? data.total : totalAvailable;

      offset += results.length;

      for (const biz of results) {
        if (!biz || typeof biz !== 'object') continue;
        const id = biz.id;
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        aggregated.push(biz);
        if (aggregated.length >= targetTotal) {
          break;
        }
      }

      if (results.length < batchLimit) {
        shouldContinue = false;
      } else if (totalAvailable !== null && offset >= totalAvailable) {
        shouldContinue = false;
      }
    }

    const simplified = aggregated.map(simplifyYelpBusiness).filter(Boolean);
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
        requestedLimit: targetTotal,
        returned: simplified.length,
        totalAvailable
      }
    });

    res.type('application/json').send(payload);
  } catch (err) {
    console.error('Restaurant proxy failed', err);
    res.status(500).json({ error: 'failed' });
  }
});

// --- Eventbrite proxy ---
const EVENTBRITE_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const EVENTBRITE_CACHE_MAX_ENTRIES = 200;

const eventbriteCache = new Map();

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

function eventbriteMemoryCacheKey({ scope, latitude, longitude, radiusMiles, startDate, endDate }) {
  const latPart = normalizeCoordinate(latitude, 3);
  const lonPart = normalizeCoordinate(longitude, 3);
  const radiusPart = Number.isFinite(radiusMiles) ? Number(radiusMiles.toFixed(1)) : 'none';
  return [scope, latPart, lonPart, radiusPart, startDate, endDate].join('::');
}

function eventbriteCacheKeyParts({ token, latitude, longitude, radiusMiles, startDate, endDate }) {
  const tokenPart = String(token || '');
  const latPart = normalizeCoordinate(latitude, 3);
  const lonPart = normalizeCoordinate(longitude, 3);
  const radiusPart = Number.isFinite(radiusMiles) ? Number(radiusMiles.toFixed(1)) : 'none';
  return [
    'eventbrite',
    tokenPart,
    `lat:${latPart}`,
    `lon:${lonPart}`,
    `radius:${radiusPart}`,
    `from:${startDate}`,
    `to:${endDate}`
  ];
}

function getEventbriteCacheEntry(key) {
  const entry = eventbriteCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > EVENTBRITE_CACHE_TTL_MS) {
    eventbriteCache.delete(key);
    return null;
  }
  eventbriteCache.delete(key);
  eventbriteCache.set(key, entry);
  return entry.value;
}

function setEventbriteCacheEntry(key, value) {
  eventbriteCache.set(key, { timestamp: Date.now(), value });
  if (eventbriteCache.size > EVENTBRITE_CACHE_MAX_ENTRIES) {
    const oldestKey = eventbriteCache.keys().next().value;
    if (oldestKey) {
      eventbriteCache.delete(oldestKey);
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

app.get('/api/eventbrite', async (req, res) => {
  const { token: queryToken, lat, lon, radius, startDate: startParam, days } = req.query || {};
  const latitude = normalizeCoordinate(lat, 4);
  const longitude = normalizeCoordinate(lon, 4);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ error: 'missing coordinates' });
  }

  const radiusMilesRaw = Number.parseFloat(radius);
  const radiusMiles = Number.isFinite(radiusMilesRaw) && radiusMilesRaw > 0 ? radiusMilesRaw : null;

  const today = toDateString(new Date());
  const normalizedStart = normalizeDateString(startParam) || today;
  const lookaheadDays = clampDays(days);
  const endDate = addDays(normalizedStart, lookaheadDays - 1) || normalizedStart;

  const effectiveToken = queryToken || EVENTBRITE_API_TOKEN;
  if (!effectiveToken) {
    return res.status(500).json({ error: 'missing eventbrite api token' });
  }

  const scope = queryToken ? 'manual' : 'server';
  const memoryKey = eventbriteMemoryCacheKey({
    scope,
    latitude,
    longitude,
    radiusMiles,
    startDate: normalizedStart,
    endDate
  });

  const cached = getEventbriteCacheEntry(memoryKey);
  if (cached) {
    return res.status(cached.status).type('application/json').send(cached.text);
  }

  const sharedCached = await readCachedResponse(
    EVENTBRITE_CACHE_COLLECTION,
    eventbriteCacheKeyParts({
      token: scope === 'manual' ? queryToken : effectiveToken,
      latitude,
      longitude,
      radiusMiles,
      startDate: normalizedStart,
      endDate
    }),
    EVENTBRITE_CACHE_TTL_MS
  );
  if (sharedCached) {
    setEventbriteCacheEntry(memoryKey, {
      status: sharedCached.status,
      text: sharedCached.body
    });
    sendCachedResponse(res, sharedCached);
    return;
  }

  const params = new URLSearchParams({
    'location.latitude': String(latitude),
    'location.longitude': String(longitude),
    expand: 'venue',
    sort_by: 'date',
    'start_date.range_start': `${normalizedStart}T00:00:00Z`,
    'start_date.range_end': `${endDate}T23:59:59Z`
  });

  if (Number.isFinite(radiusMiles)) {
    params.set('location.within', `${Math.min(Math.max(radiusMiles, 1), 1000).toFixed(1)}mi`);
  } else {
    params.set('location.within', '100.0mi');
  }

  const url = `https://www.eventbriteapi.com/v3/events/search/?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${effectiveToken}`
      }
    });
    const text = await response.text();
    if (response.ok) {
      setEventbriteCacheEntry(memoryKey, { status: response.status, text });
      await writeCachedResponse(
        EVENTBRITE_CACHE_COLLECTION,
        eventbriteCacheKeyParts({
          token: scope === 'manual' ? queryToken : effectiveToken,
          latitude,
          longitude,
          radiusMiles,
          startDate: normalizedStart,
          endDate
        }),
        {
          status: response.status,
          contentType: 'application/json',
          body: text,
          metadata: {
            latitude,
            longitude,
            radiusMiles: Number.isFinite(radiusMiles) ? radiusMiles : null,
            startDate: normalizedStart,
            endDate,
            usingDefaultToken: !queryToken
          }
        }
      );
    }
    res.status(response.status).type('application/json').send(text);
  } catch (err) {
    console.error('Eventbrite fetch failed', err);
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
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = parseNumberQuery(req.query.limit) ?? DEFAULT_MOVIE_LIMIT;
    const freshLimit = parseNumberQuery(req.query.freshLimit);
    const minScore = parseNumberQuery(req.query.minScore);
    const includeFresh = parseBooleanQuery(
      req.query.includeFresh ?? req.query.fresh ?? req.query.includeNew
    );
    const freshOnly =
      parseBooleanQuery(req.query.freshOnly ?? req.query.onlyFresh ?? req.query.newOnly) ||
      (typeof req.query.scope === 'string' && req.query.scope.toLowerCase() === 'new');
    const forceRefresh = parseBooleanQuery(req.query.refresh);

    const curatedLimit = Math.max(1, Number(limit) || 20);
    const fallbackFreshLimit = Math.max(1, Math.min(curatedLimit, 10));
    const effectiveFreshLimit = Math.max(1, Number(freshLimit) || fallbackFreshLimit);

    const catalogState = await movieCatalog.ensureCatalog({ forceRefresh });
    const hasCredentials = movieCatalog.hasTmdbCredentials();
    const curatedResults = freshOnly
      ? []
      : movieCatalog.searchCatalog(query, {
          limit: curatedLimit,
          minScore: minScore == null ? undefined : minScore
        });

    let freshResults = [];
    let freshError = null;
    const shouldFetchFresh =
      freshOnly ||
      includeFresh ||
      (!curatedResults.length && Boolean(query));

    if (shouldFetchFresh) {
      if (hasCredentials) {
        try {
          freshResults = await movieCatalog.fetchNewReleases({
            query,
            limit: freshOnly ? curatedLimit : effectiveFreshLimit,
            excludeIds: curatedResults.map(movie => movie.id)
          });
        } catch (err) {
          console.error('Failed to fetch new release movies', err);
          freshError = 'failed';
        }
      } else {
        freshError = 'credentials missing';
      }
    }

    const response = {
      results: freshOnly ? freshResults : curatedResults,
      curated: curatedResults,
      fresh: freshResults,
      metadata: {
        query: query || null,
        curatedCount: curatedResults.length,
        freshCount: freshResults.length,
        totalCatalogSize:
          catalogState?.metadata?.total ?? catalogState?.movies?.length ?? 0,
        catalogUpdatedAt:
          catalogState?.metadata?.updatedAt ||
          (catalogState?.updatedAt
            ? new Date(catalogState.updatedAt).toISOString()
            : null),
        minScore: minScore == null ? movieCatalog.MIN_SCORE : minScore,
        includeFresh: Boolean(shouldFetchFresh && hasCredentials),
        freshOnly: Boolean(freshOnly),
        source: catalogState?.metadata?.source || null,
        freshRequested: Boolean(shouldFetchFresh)
      }
    };

    if (freshOnly) {
      response.curated = curatedResults;
      response.metadata.curatedCount = curatedResults.length;
    }

    if (freshError) {
      response.metadata.freshError = freshError;
    }

    res.json(response);
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
