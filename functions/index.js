const functions = require('firebase-functions');

const { readCachedResponse, writeCachedResponse } = require('../shared/cache');

const DEFAULT_REGION = 'us-central1';
const TMDB_BASE_URL = 'https://api.themoviedb.org';
const TMDB_CACHE_COLLECTION = 'tmdbCache';
const TMDB_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const YELP_BASE_URL = 'https://api.yelp.com/v3/businesses/search';
const YELP_CACHE_COLLECTION = 'yelpCache';
const YELP_CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes
const YELP_MAX_PAGE_LIMIT = 50;
const YELP_DEFAULT_TOTAL_LIMIT = 120;
const YELP_ABSOLUTE_MAX_LIMIT = 200;
const YELP_DETAILS_BASE_URL = 'https://api.yelp.com/v3/businesses';
const YELP_DETAILS_MAX_ENRICH = 40;
const YELP_DETAILS_CONCURRENCY = 5;
const EVENTBRITE_BASE_URL = 'https://www.eventbriteapi.com/v3/events/search/';
const EVENTBRITE_CACHE_COLLECTION = 'eventbriteCache';
const EVENTBRITE_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const EVENTBRITE_CACHE_MAX_ENTRIES = 200;

function normalizeCoordinate(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function normalizePositiveInteger(value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return null;
  const clamped = Math.min(Math.max(num, min), max);
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

function simplifyBusiness(biz, { details } = {}) {
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
    latitude:
      typeof biz.coordinates?.latitude === 'number' ? biz.coordinates.latitude : null,
    longitude:
      typeof biz.coordinates?.longitude === 'number' ? biz.coordinates.longitude : null,
    url: biz.url || '',
    distance: typeof biz.distance === 'number' ? biz.distance : null,
    ...(hasServiceInfo ? { serviceOptions } : {})
  };
}

function getYelpApiKey(req) {
  const headerKey = typeof req.get === 'function' ? req.get('x-api-key') : null;
  if (headerKey && headerKey.trim()) {
    return headerKey.trim();
  }
  const rawQueryKey =
    resolveSingle(req.query?.apiKey) || resolveSingle(req.query?.api_key) || null;
  if (typeof rawQueryKey === 'string' && rawQueryKey.trim()) {
    return rawQueryKey.trim();
  }
  const fromEnv = process.env.YELP_API_KEY;
  if (fromEnv) return fromEnv;
  const fromConfig = functions.config()?.yelp?.key;
  if (fromConfig) return fromConfig;
  return null;
}

function normalizeTmdbParams(params) {
  const normalized = [];
  if (!params) return normalized;
  for (const [key, value] of params.entries()) {
    if (key === 'api_key') continue;
    normalized.push([key, value]);
  }
  normalized.sort(([keyA, valueA], [keyB, valueB]) => {
    if (keyA === keyB) {
      return valueA.localeCompare(valueB);
    }
    return keyA.localeCompare(keyB);
  });
  return normalized.map(([key, value]) => ({ key, value }));
}

function tmdbCacheKeyParts(path, params) {
  const normalizedPath = String(path || '').trim();
  const normalizedParams = normalizeTmdbParams(params);
  const serializedParams = normalizedParams.map(entry => `${entry.key}=${entry.value}`).join('&');
  return {
    parts: ['tmdb', normalizedPath, serializedParams],
    normalizedPath,
    normalizedParams
  };
}

async function readTmdbCache(path, params) {
  const { parts } = tmdbCacheKeyParts(path, params);
  return readCachedResponse(TMDB_CACHE_COLLECTION, parts, TMDB_CACHE_TTL_MS);
}

async function writeTmdbCache(path, params, status, contentType, body, metadata = {}) {
  const { parts, normalizedPath, normalizedParams } = tmdbCacheKeyParts(path, params);
  await writeCachedResponse(TMDB_CACHE_COLLECTION, parts, {
    status,
    contentType,
    body,
    metadata: {
      path: normalizedPath,
      params: normalizedParams,
      ...metadata
    }
  });
}

const eventbriteCache = new Map();

function getEventbriteDefaultToken() {
  const fromEnv =
    process.env.EVENTBRITE_API_TOKEN ||
    process.env.EVENTBRITE_OAUTH_TOKEN ||
    process.env.EVENTBRITE_TOKEN;
  if (fromEnv) return fromEnv;
  const fromConfig = functions.config()?.eventbrite;
  if (fromConfig && typeof fromConfig === 'object') {
    return fromConfig.token || fromConfig.key || fromConfig.oauth_token || null;
  }
  return '2YR3RA4K6VCZVEUZMBG4';
}

function normalizeCoordinateFixed(value, digits = 3) {
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

function eventbriteMemoryCacheKey({ scope, latitude, longitude, radiusMiles, startDate, endDate }) {
  const latPart = normalizeCoordinateFixed(latitude, 3);
  const lonPart = normalizeCoordinateFixed(longitude, 3);
  const radiusPart = Number.isFinite(radiusMiles) ? Number(radiusMiles.toFixed(1)) : 'none';
  return [scope, latPart, lonPart, radiusPart, startDate, endDate].join('::');
}

function eventbriteCacheKeyParts({ token, latitude, longitude, radiusMiles, startDate, endDate }) {
  const tokenPart = String(token || '');
  const latPart = normalizeCoordinateFixed(latitude, 3);
  const lonPart = normalizeCoordinateFixed(longitude, 3);
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

const ALLOWED_ENDPOINTS = {
  discover: { path: '/3/discover/movie' },
  discover_tv: { path: '/3/discover/tv' },
  genres: { path: '/3/genre/movie/list' },
  tv_genres: { path: '/3/genre/tv/list' },
  credits: {
    path: query => {
      const rawId = query?.movie_id ?? query?.id ?? query?.movieId;
      const value = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!value && value !== 0) return null;
      const trimmed = String(value).trim();
      if (!trimmed) return null;
      return `/3/movie/${encodeURIComponent(trimmed)}/credits`;
    },
    omitParams: ['movie_id', 'movieId', 'id']
  },
  tv_credits: {
    path: query => {
      const rawId = query?.tv_id ?? query?.id;
      const value = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!value && value !== 0) return null;
      const trimmed = String(value).trim();
      if (!trimmed) return null;
      return `/3/tv/${encodeURIComponent(trimmed)}/credits`;
    },
    omitParams: ['tv_id', 'id']
  },
  movie_details: {
    path: query => {
      const rawId = query?.movie_id ?? query?.id ?? query?.movieId;
      const value = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!value && value !== 0) return null;
      const trimmed = String(value).trim();
      if (!trimmed) return null;
      return `/3/movie/${encodeURIComponent(trimmed)}`;
    },
    omitParams: ['movie_id', 'movieId', 'id']
  },
  tv_details: {
    path: query => {
      const rawId = query?.tv_id ?? query?.id;
      const value = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!value && value !== 0) return null;
      const trimmed = String(value).trim();
      if (!trimmed) return null;
      return `/3/tv/${encodeURIComponent(trimmed)}`;
    },
    omitParams: ['tv_id', 'id']
  },
  person_details: {
    path: query => {
      const rawId = query?.person_id ?? query?.id;
      const value = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!value && value !== 0) return null;
      const trimmed = String(value).trim();
      if (!trimmed) return null;
      return `/3/person/${encodeURIComponent(trimmed)}`;
    },
    omitParams: ['person_id', 'id']
  },
  search_multi: { path: '/3/search/multi' },
  search_movie: { path: '/3/search/movie' },
  search_tv: { path: '/3/search/tv' },
  trending_all: { path: '/3/trending/all/day' },
  trending_movies: { path: '/3/trending/movie/day' },
  trending_tv: { path: '/3/trending/tv/day' },
  popular_movies: { path: '/3/movie/popular' },
  popular_tv: { path: '/3/tv/popular' },
  upcoming_movies: { path: '/3/movie/upcoming' }
};

function getTmdbApiKey() {
  const fromEnv = process.env.TMDB_API_KEY;
  if (fromEnv) return fromEnv;
  const fromConfig = functions.config()?.tmdb?.key;
  if (fromConfig) return fromConfig;
  return null;
}

function getTmdbProxyEndpoint() {
  const fromEnv = process.env.TMDB_PROXY_ENDPOINT;
  if (fromEnv) return fromEnv;
  const fromConfig = functions.config()?.tmdb?.proxy_endpoint;
  if (fromConfig) return fromConfig;
  return '';
}

function resolveSingle(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function withCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Api-Key'
  );
}

exports.tmdbProxy = functions
  .region(DEFAULT_REGION)
  .https.onRequest(async (req, res) => {
    withCors(res);

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const endpointKey = String(req.query.endpoint || 'discover');
    const endpointConfig = ALLOWED_ENDPOINTS[endpointKey];

    if (!endpointConfig) {
      res.status(400).json({ error: 'unsupported_endpoint' });
      return;
    }

    let targetPath = null;
    if (typeof endpointConfig === 'string') {
      targetPath = endpointConfig;
    } else if (endpointConfig && typeof endpointConfig.path === 'function') {
      targetPath = endpointConfig.path(req.query || {});
    } else if (endpointConfig && endpointConfig.path) {
      targetPath = endpointConfig.path;
    }

    if (!targetPath) {
      res.status(400).json({ error: 'invalid_endpoint_params' });
      return;
    }

    const apiKey = getTmdbApiKey();
    if (!apiKey) {
      console.error('TMDB API key missing for proxy request');
      res.status(500).json({ error: 'tmdb_key_not_configured' });
      return;
    }

    const params = new URLSearchParams();
    const omitParams = new Set(['endpoint', 'api_key']);
    if (endpointConfig && Array.isArray(endpointConfig.omitParams)) {
      endpointConfig.omitParams.forEach(param => omitParams.add(param));
    }

    for (const [key, value] of Object.entries(req.query || {})) {
      if (omitParams.has(key)) continue;
      if (Array.isArray(value)) {
        value.forEach(v => params.append(key, String(v)));
      } else if (value !== undefined) {
        params.append(key, String(value));
      }
    }
    params.set('api_key', apiKey);

    const targetUrl = `${TMDB_BASE_URL}${targetPath}?${params.toString()}`;

    const cached = await readTmdbCache(targetPath, params);
    if (cached) {
      res.status(cached.status);
      res.type(cached.contentType);
      res.send(cached.body);
      return;
    }

    try {
      const tmdbResponse = await fetch(targetUrl, {
        headers: {
          'Accept': 'application/json'
        }
      });

      const payload = await tmdbResponse.text();
      const contentType = tmdbResponse.headers.get('content-type') || 'application/json';
      if (tmdbResponse.ok) {
        await writeTmdbCache(targetPath, params, tmdbResponse.status, contentType, payload, {
          endpoint: endpointKey
        });
      }
      res.status(tmdbResponse.status);
      res.type(contentType);
      res.send(payload);
    } catch (err) {
      console.error('TMDB proxy failed', err);
      res.status(500).json({ error: 'tmdb_proxy_failed' });
    }
  });

exports.tmdbConfig = functions
  .region(DEFAULT_REGION)
  .https.onRequest((req, res) => {
    withCors(res);

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const apiKey = getTmdbApiKey();
    const proxyEndpoint = getTmdbProxyEndpoint();

    if (!apiKey && !proxyEndpoint) {
      res.status(404).json({ error: 'tmdb_config_unavailable' });
      return;
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

exports.restaurantsProxy = functions
  .region(DEFAULT_REGION)
  .https.onRequest(async (req, res) => {
    withCors(res);

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const rawCity = resolveSingle(req.query?.city);
    const city = typeof rawCity === 'string' ? rawCity.trim() : '';
    const rawCuisine = resolveSingle(req.query?.cuisine);
    const cuisine = typeof rawCuisine === 'string' ? rawCuisine.trim() : '';
    const latitude = normalizeCoordinate(resolveSingle(req.query?.latitude));
    const longitude = normalizeCoordinate(resolveSingle(req.query?.longitude));
    const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);

    if (!hasCoords && !city) {
      res.status(400).json({ error: 'missing_location' });
      return;
    }

    const apiKey = getYelpApiKey(req);
    if (!apiKey) {
      res.status(500).json({ error: 'missing_yelp_api_key' });
      return;
    }

    const rawLimit =
      resolveSingle(req.query?.limit) || resolveSingle(req.query?.maxResults);
    const requestedLimit = normalizePositiveInteger(rawLimit, {
      min: 1,
      max: YELP_ABSOLUTE_MAX_LIMIT
    });
    const targetTotal = requestedLimit || YELP_DEFAULT_TOTAL_LIMIT;

    const rawRadius = resolveSingle(req.query?.radius);
    const parsedRadius =
      rawRadius === undefined || rawRadius === null || rawRadius === ''
        ? null
        : Number.parseFloat(rawRadius);
    const radiusMiles =
      Number.isFinite(parsedRadius) && parsedRadius > 0 ? Math.min(parsedRadius, 25) : null;
    const radiusMeters =
      Number.isFinite(radiusMiles) && radiusMiles > 0
        ? Math.min(Math.round(radiusMiles * 1609.34), 40000)
        : null;

    const cacheKey = yelpCacheKeyParts({
      city,
      latitude,
      longitude,
      cuisine,
      limit: targetTotal,
      radiusMiles
    });
    const cached = await readCachedResponse(
      YELP_CACHE_COLLECTION,
      cacheKey,
      YELP_CACHE_TTL_MS
    );
    if (cached) {
      res.status(cached.status);
      res.type(cached.contentType);
      res.send(cached.body);
      return;
    }

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
      baseParams.set('location', city);
    }
    if (cuisine) {
      baseParams.set('term', cuisine);
    }

    try {
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
            Authorization: `Bearer ${apiKey}`
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

      const detailsMap = await fetchYelpBusinessDetails(aggregated, apiKey, {
        limit: YELP_DETAILS_MAX_ENRICH,
        concurrency: YELP_DETAILS_CONCURRENCY
      });
      const simplified = aggregated
        .map(biz => simplifyBusiness(biz, { details: detailsMap.get(biz.id) }))
        .filter(Boolean);
      const payload = JSON.stringify(simplified);

      await writeCachedResponse(YELP_CACHE_COLLECTION, cacheKey, {
        status: 200,
        contentType: 'application/json',
        body: payload,
        metadata: {
          city,
          hasCoords,
          latitude: hasCoords ? latitude : null,
          longitude: hasCoords ? longitude : null,
          cuisine,
          requestedLimit: targetTotal,
          returned: simplified.length,
          totalAvailable,
          radiusMiles: Number.isFinite(radiusMiles) ? radiusMiles : null
        }
      });

      res.type('application/json').send(payload);
    } catch (err) {
      console.error('Restaurants proxy failed', err);
      res.status(500).json({ error: 'restaurants_proxy_failed' });
    }
  });

exports.eventbriteProxy = functions
  .region(DEFAULT_REGION)
  .https.onRequest(async (req, res) => {
    withCors(res);

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const query = req.query || {};
    const latitude = normalizeCoordinateFixed(resolveSingle(query.lat), 4);
    const longitude = normalizeCoordinateFixed(resolveSingle(query.lon), 4);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      res.status(400).json({ error: 'missing_coordinates' });
      return;
    }

    const radiusRaw = resolveSingle(query.radius);
    const radiusMilesRaw = Number.parseFloat(radiusRaw);
    const radiusMiles =
      Number.isFinite(radiusMilesRaw) && radiusMilesRaw > 0 ? radiusMilesRaw : null;

    const startParam = resolveSingle(query.startDate);
    const today = toDateString(new Date());
    const normalizedStart = normalizeDateString(startParam) || today;
    const lookaheadDays = clampDays(resolveSingle(query.days));
    const endDate = addDays(normalizedStart, lookaheadDays - 1) || normalizedStart;

    const rawToken = resolveSingle(query.token);
    const queryToken = typeof rawToken === 'string' ? rawToken.trim() : '';
    const effectiveToken = queryToken || getEventbriteDefaultToken();

    if (!effectiveToken) {
      res.status(500).json({ error: 'missing_eventbrite_api_token' });
      return;
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
      res.status(cached.status).type('application/json').send(cached.text);
      return;
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
      res.status(sharedCached.status);
      res.type(sharedCached.contentType || 'application/json');
      res.send(sharedCached.body);
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
      const clamped = Math.min(Math.max(radiusMiles, 1), 1000).toFixed(1);
      params.set('location.within', `${clamped}mi`);
    } else {
      params.set('location.within', '100.0mi');
    }

    const targetUrl = `${EVENTBRITE_BASE_URL}?${params.toString()}`;

    try {
      const response = await fetch(targetUrl, {
        headers: {
          Authorization: `Bearer ${effectiveToken}`
        }
      });

      const text = await response.text();
      setEventbriteCacheEntry(memoryKey, { status: response.status, text });

      if (response.ok) {
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
      console.error('Eventbrite proxy failed', err);
      res.status(500).json({ error: 'eventbrite_proxy_failed' });
    }
  });
