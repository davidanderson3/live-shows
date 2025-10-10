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
const YELP_DETAILS_BASE_URL = 'https://api.yelp.com/v3/businesses';
const YELP_CACHE_COLLECTION = 'yelpCache';
const YELP_CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes
const YELP_MAX_PAGE_LIMIT = 50;
const YELP_DEFAULT_TOTAL_LIMIT = 120;
const YELP_ABSOLUTE_MAX_LIMIT = 200;
const YELP_DETAILS_MAX_ENRICH = 40;
const YELP_DETAILS_CONCURRENCY = 5;
const EVENTBRITE_CACHE_COLLECTION = 'eventbriteCache';
const SPOONACULAR_CACHE_COLLECTION = 'recipeCache';
const SPOONACULAR_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const DEFAULT_MOVIE_LIMIT = 20;

function resolveTmdbApiKey() {
  return (
    process.env.TMDB_API_KEY ||
    process.env.TMDB_KEY ||
    process.env.TMDB_TOKEN ||
    ''
  );
}

function resolveTmdbProxyEndpoint() {
  return process.env.TMDB_PROXY_ENDPOINT || '';
}

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

function yelpCacheKeyParts({ city, latitude, longitude, cuisine, limit, radiusMiles }) {
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
  if (Number.isFinite(radiusMiles) && radiusMiles > 0) {
    parts.push(`radius:${Number(radiusMiles.toFixed(1))}`);
  } else {
    parts.push('radius:none');
  }
  return parts;
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function toDegrees(value) {
  return (Number(value) * 180) / Math.PI;
}

function normalizeLongitudeDegrees(value) {
  if (!Number.isFinite(value)) return null;
  let longitude = value;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function destinationPointMiles(latitude, longitude, distanceMiles, bearingDegrees) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (!Number.isFinite(distanceMiles) || distanceMiles <= 0) return null;
  const R = 3958.8; // Earth radius in miles
  const phi1 = toRadians(latitude);
  const lambda1 = toRadians(longitude);
  const theta = toRadians(bearingDegrees);
  const delta = distanceMiles / R;

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  const sinPhi2 = sinPhi1 * cosDelta + cosPhi1 * sinDelta * cosTheta;
  const phi2 = Math.asin(Math.min(Math.max(sinPhi2, -1), 1));
  const y = sinTheta * sinDelta * cosPhi1;
  const x = cosDelta - sinPhi1 * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);

  const lat2 = toDegrees(phi2);
  const lon2 = toDegrees(lambda2);
  const normalizedLon = normalizeLongitudeDegrees(lon2);

  if (!Number.isFinite(lat2) || !Number.isFinite(normalizedLon)) {
    return null;
  }

  return { latitude: lat2, longitude: normalizedLon };
}

function generateExpandedSearchCenters(
  latitude,
  longitude,
  { rings = 6, startDistanceMiles = 18, ringStepMiles = 14 } = {}
) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
  const centers = [];
  const seen = new Set();

  for (let ring = 0; ring < rings; ring += 1) {
    const distanceMiles = startDistanceMiles + ring * ringStepMiles;
    if (!Number.isFinite(distanceMiles) || distanceMiles <= 0) continue;

    const bearingsCount = Math.min(16, 6 + ring * 2);
    const bearings = Array.from({ length: bearingsCount }, (_, index) => {
      const baseAngle = (360 / bearingsCount) * index;
      const offset = ring % 2 === 0 ? 0 : 180 / bearingsCount;
      return (baseAngle + offset) % 360;
    });

    for (const bearing of bearings) {
      const point = destinationPointMiles(latitude, longitude, distanceMiles, bearing);
      if (!point) continue;
      const key = `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      centers.push(point);
    }
  }

  return centers;
}

async function fetchYelpBusinessesWithPagination(baseParams, { yelpKey, targetTotal, aggregated, seenIds }) {
  let offset = 0;
  let totalAvailable = null;
  let shouldContinue = true;

  while (shouldContinue && aggregated.length < targetTotal) {
    const remainingNeeded = targetTotal - aggregated.length;
    const batchLimit = Math.min(YELP_MAX_PAGE_LIMIT, remainingNeeded);
    if (batchLimit <= 0) break;

    const params = new URLSearchParams(baseParams);
    params.set('limit', String(batchLimit));
    if (offset > 0) {
      params.set('offset', String(offset));
    } else {
      params.delete('offset');
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
      const error = new Error(message);
      error.status = apiRes.status || 500;
      throw error;
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

  return { totalAvailable };
}

function parseYelpBoolean(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  }
  return null;
}

function deriveYelpServiceOptions({ searchBiz = null, details = null } = {}) {
  const result = { takeout: null, sitDown: null };

  function setOption(key, value) {
    if (typeof value !== 'boolean') return;
    if (value) {
      result[key] = true;
    } else if (result[key] !== true) {
      result[key] = false;
    }
  }

  function applyTransactions(transactions) {
    if (!Array.isArray(transactions)) return;
    const normalized = transactions
      .map(item => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
      .filter(Boolean);
    if (normalized.some(entry => ['pickup', 'delivery', 'takeout'].includes(entry))) {
      setOption('takeout', true);
    }
    if (
      normalized.some(entry => ['dine-in', 'dinein', 'dine_in', 'restaurant_reservation'].includes(entry))
    ) {
      setOption('sitDown', true);
    }
  }

  applyTransactions(searchBiz?.transactions);
  applyTransactions(details?.transactions);

  const attributes =
    (details && typeof details.attributes === 'object' && details.attributes) ||
    (searchBiz && typeof searchBiz.attributes === 'object' && searchBiz.attributes) ||
    {};

  const takeoutAttr = parseYelpBoolean(attributes.RestaurantsTakeOut);
  if (takeoutAttr !== null) setOption('takeout', takeoutAttr);

  const deliveryAttr = parseYelpBoolean(attributes.RestaurantsDelivery);
  if (deliveryAttr !== null) setOption('takeout', deliveryAttr);

  const tableServiceAttr = parseYelpBoolean(attributes.RestaurantsTableService);
  if (tableServiceAttr !== null) setOption('sitDown', tableServiceAttr);

  const reservationsAttr = parseYelpBoolean(attributes.RestaurantsReservations);
  if (reservationsAttr) {
    setOption('sitDown', true);
  } else if (reservationsAttr === false) {
    setOption('sitDown', false);
  }

  const serviceOptions =
    details && typeof details.service_options === 'object' ? details.service_options : null;
  if (serviceOptions) {
    const takeoutOption = parseYelpBoolean(serviceOptions.takeout);
    if (takeoutOption !== null) setOption('takeout', takeoutOption);
    const dineInOption = parseYelpBoolean(serviceOptions.dine_in ?? serviceOptions.dineIn);
    if (dineInOption !== null) setOption('sitDown', dineInOption);
  }

  return result;
}

async function fetchYelpBusinessDetails(businesses, apiKey, { limit, concurrency } = {}) {
  if (!Array.isArray(businesses) || !businesses.length) {
    return new Map();
  }
  const uniqueIds = [];
  const seen = new Set();
  for (const biz of businesses) {
    const id = typeof biz?.id === 'string' ? biz.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniqueIds.push(id);
    if (limit && uniqueIds.length >= limit) break;
  }

  const results = new Map();
  const ids = uniqueIds;
  if (!ids.length) return results;

  const workerCount = Math.max(1, Math.min(concurrency || 1, ids.length));
  let index = 0;

  async function runWorker() {
    while (index < ids.length) {
      const currentIndex = index++;
      const id = ids[currentIndex];
      const url = `${YELP_DETAILS_BASE_URL}/${encodeURIComponent(id)}`;
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${apiKey}`
          }
        });
        if (!response.ok) {
          continue;
        }
        const data = await response.json().catch(() => null);
        if (!data || typeof data !== 'object') {
          continue;
        }
        const detailSubset = {
          attributes:
            data.attributes && typeof data.attributes === 'object' ? data.attributes : undefined,
          transactions: Array.isArray(data.transactions) ? data.transactions : undefined,
          service_options:
            data.service_options && typeof data.service_options === 'object'
              ? data.service_options
              : undefined
        };
        results.set(id, detailSubset);
      } catch (err) {
        console.error('Yelp business details fetch failed', err);
      }
    }
  }

  const workers = Array.from({ length: workerCount }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function simplifyYelpBusiness(biz, { details } = {}) {
  if (!biz || typeof biz !== 'object') return null;
  const serviceOptions = deriveYelpServiceOptions({ searchBiz: biz, details });
  const hasServiceInfo =
    typeof serviceOptions.takeout === 'boolean' || typeof serviceOptions.sitDown === 'boolean';
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
    distance: typeof biz.distance === 'number' ? biz.distance : null,
    ...(hasServiceInfo ? { serviceOptions } : {})
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
// Allow API routes (like /api/eventbrite) to continue past the static middleware
// when no matching asset is found. Express 5 changes the default `fallthrough`
// behavior, so we explicitly enable it to avoid returning a 404 before our API
// handlers get a chance to run.
app.use(
  express.static(path.resolve(__dirname, '../'), {
    fallthrough: true
  })
);

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

app.get('/api/tmdb-config', (req, res) => {
  const apiKey = resolveTmdbApiKey();
  const proxyEndpoint = resolveTmdbProxyEndpoint();

  if (!apiKey && !proxyEndpoint) {
    return res.status(404).json({ error: 'tmdb_config_unavailable' });
  }

  const payload = {
    hasKey: Boolean(apiKey),
    hasProxy: Boolean(proxyEndpoint)
  };

  if (apiKey) {
    payload.apiKey = apiKey;
  }
  if (proxyEndpoint) {
    payload.proxyEndpoint = proxyEndpoint;
  }

  res.json(payload);
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

  const parsedRadius = parseNumberQuery(req.query?.radius);
  const radiusMiles =
    Number.isFinite(parsedRadius) && parsedRadius > 0 ? Math.min(parsedRadius, 25) : null;
  const radiusMeters =
    Number.isFinite(radiusMiles) && radiusMiles > 0
      ? Math.min(Math.round(radiusMiles * 1609.34), 40000)
      : null;

  const cacheKeyParts = yelpCacheKeyParts({
    city,
    latitude,
    longitude,
    cuisine,
    limit: targetTotal,
    radiusMiles
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
      if (Number.isFinite(radiusMeters) && radiusMeters > 0) {
        baseParams.set('radius', String(radiusMeters));
      }
    } else if (city) {
      baseParams.set('location', String(city));
    }
    if (cuisine) {
      baseParams.set('term', String(cuisine));
    }

    const aggregated = [];
    const seenIds = new Set();
    let totalAvailable = null;

    const baseMeta = await fetchYelpBusinessesWithPagination(baseParams, {
      yelpKey,
      targetTotal,
      aggregated,
      seenIds
    });
    if (baseMeta && typeof baseMeta.totalAvailable === 'number') {
      totalAvailable = baseMeta.totalAvailable;
    }

    if (hasCoords && aggregated.length < targetTotal) {
      const ringsNeeded = Math.min(8, 3 + Math.ceil((targetTotal - aggregated.length) / 40));
      const startDistanceMiles = Math.max(
        12,
        Number.isFinite(radiusMiles) && radiusMiles > 0 ? Math.min(radiusMiles * 0.8, 28) : 18
      );
      const expansionCenters = generateExpandedSearchCenters(latitude, longitude, {
        rings: ringsNeeded,
        startDistanceMiles,
        ringStepMiles: 14
      });
      const expansionRadiusMeters = 40000; // Yelp API maximum

      for (const center of expansionCenters) {
        if (aggregated.length >= targetTotal) break;
        const params = new URLSearchParams(baseParams);
        params.set('latitude', String(center.latitude));
        params.set('longitude', String(center.longitude));
        params.set('radius', String(expansionRadiusMeters));

        try {
          const meta = await fetchYelpBusinessesWithPagination(params, {
            yelpKey,
            targetTotal,
            aggregated,
            seenIds
          });
          if (meta && typeof meta.totalAvailable === 'number') {
            if (totalAvailable === null) {
              totalAvailable = meta.totalAvailable;
            } else {
              totalAvailable = Math.max(totalAvailable, meta.totalAvailable);
            }
          }
        } catch (err) {
          console.warn('Expanded Yelp search attempt failed', err);
        }
      }
    }

    if (city && aggregated.length < targetTotal) {
      const locationParams = new URLSearchParams(baseParams);
      locationParams.delete('latitude');
      locationParams.delete('longitude');
      locationParams.delete('radius');
      locationParams.delete('sort_by');
      locationParams.set('location', String(city));
      try {
        const meta = await fetchYelpBusinessesWithPagination(locationParams, {
          yelpKey,
          targetTotal,
          aggregated,
          seenIds
        });
        if (meta && typeof meta.totalAvailable === 'number') {
          if (totalAvailable === null) {
            totalAvailable = meta.totalAvailable;
          } else {
            totalAvailable = Math.max(totalAvailable, meta.totalAvailable);
          }
        }
      } catch (err) {
        console.warn('City-based Yelp search attempt failed', err);
      }
    }

    const detailsMap = await fetchYelpBusinessDetails(aggregated, yelpKey, {
      limit: YELP_DETAILS_MAX_ENRICH,
      concurrency: YELP_DETAILS_CONCURRENCY
    });
    const simplified = aggregated
      .map(biz => simplifyYelpBusiness(biz, { details: detailsMap.get(biz.id) }))
      .filter(Boolean);
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
        totalAvailable,
        radiusMiles: Number.isFinite(radiusMiles) ? radiusMiles : null
      }
    });

    res.type('application/json').send(payload);
  } catch (err) {
    console.error('Restaurant proxy failed', err);
    const status =
      err && typeof err.status === 'number' && err.status >= 400 ? err.status : 500;
    const message =
      err && typeof err.message === 'string' && err.message ? err.message : 'failed';
    res.status(status).json({ error: message });
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

function eventbriteMemoryCacheKey({
  scope,
  latitude,
  longitude,
  radiusMiles,
  startDate,
  endDate,
  segment
}) {
  const latPart = normalizeCoordinate(latitude, 3);
  const lonPart = normalizeCoordinate(longitude, 3);
  const radiusPart = Number.isFinite(radiusMiles) ? Number(radiusMiles.toFixed(1)) : 'none';
  return [scope, latPart, lonPart, radiusPart, startDate, endDate, segment || 'all'].join('::');
}

function eventbriteCacheKeyParts({
  token,
  latitude,
  longitude,
  radiusMiles,
  startDate,
  endDate,
  segment
}) {
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
    `to:${endDate}`,
    `segment:${segment || 'all'}`
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

const EVENTBRITE_SEGMENTS = [
  {
    key: 'music',
    description: 'Live music',
    params: { categories: '103' }
  },
  {
    key: 'comedy',
    description: 'Comedy',
    params: { subcategories: '3004' }
  }
];

function extractEventStart(event) {
  const start = event?.start;
  if (!start) return Number.POSITIVE_INFINITY;
  const raw = start.utc || start.local;
  if (!raw) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
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

  async function fetchSegment({ key, params: segmentParams, description }) {
    const memoryKey = eventbriteMemoryCacheKey({
      scope,
      latitude,
      longitude,
      radiusMiles,
      startDate: normalizedStart,
      endDate,
      segment: key
    });

    const cached = getEventbriteCacheEntry(memoryKey);
    if (cached) {
      return { segment: key, description, status: cached.status, text: cached.text };
    }

    const sharedCached = await readCachedResponse(
      EVENTBRITE_CACHE_COLLECTION,
      eventbriteCacheKeyParts({
        token: scope === 'manual' ? queryToken : effectiveToken,
        latitude,
        longitude,
        radiusMiles,
        startDate: normalizedStart,
        endDate,
        segment: key
      }),
      EVENTBRITE_CACHE_TTL_MS
    );
    if (sharedCached) {
      const payload = {
        segment: key,
        description,
        status: sharedCached.status,
        text: sharedCached.body
      };
      setEventbriteCacheEntry(memoryKey, { status: sharedCached.status, text: sharedCached.body });
      return payload;
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

    for (const [paramKey, value] of Object.entries(segmentParams)) {
      params.set(paramKey, value);
    }

    const url = `https://www.eventbriteapi.com/v3/events/search/?${params.toString()}`;

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
          endDate,
          segment: key
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
            segment: key,
            segmentDescription: description,
            usingDefaultToken: !queryToken
          }
        }
      );
    }

    return { segment: key, description, status: response.status, text };
  }

  try {
    const segmentResponses = await Promise.all(
      EVENTBRITE_SEGMENTS.map(segment =>
        fetchSegment(segment).catch(err => ({ segment: segment.key, description: segment.description, error: err }))
      )
    );

    const dedupedEvents = new Map();
    const segmentSummaries = [];
    let successfulSegment = false;

    for (const result of segmentResponses) {
      const { segment, description } = result;
      if (result.error) {
        console.error('Eventbrite segment fetch failed', description || segment, result.error);
        segmentSummaries.push({
          key: segment,
          description,
          ok: false,
          error: result.error.message || 'Unknown error'
        });
        continue;
      }

      if (result.status < 200 || result.status >= 300) {
        segmentSummaries.push({
          key: segment,
          description,
          ok: false,
          status: result.status
        });
        continue;
      }

      successfulSegment = true;

      let data;
      try {
        data = result.text ? JSON.parse(result.text) : null;
      } catch (err) {
        console.warn('Unable to parse Eventbrite segment response', segment, err);
        segmentSummaries.push({
          key: segment,
          description,
          ok: false,
          error: 'Invalid JSON response'
        });
        continue;
      }

      const events = Array.isArray(data?.events) ? data.events : [];
      for (const event of events) {
        const eventId = event?.id || `${segment}::${JSON.stringify(event)}`;
        if (!dedupedEvents.has(eventId)) {
          dedupedEvents.set(eventId, event);
        }
      }

      segmentSummaries.push({
        key: segment,
        description,
        ok: true,
        status: result.status,
        total: events.length
      });
    }

    if (!successfulSegment) {
      res.status(502).json({ error: 'failed', segments: segmentSummaries });
      return;
    }

    const combinedEvents = Array.from(dedupedEvents.values()).sort((a, b) => extractEventStart(a) - extractEventStart(b));

    res.status(200).json({
      events: combinedEvents,
      segments: segmentSummaries,
      generatedAt: new Date().toISOString()
    });
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
