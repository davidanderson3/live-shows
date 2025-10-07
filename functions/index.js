const functions = require('firebase-functions');

const { readCachedResponse, writeCachedResponse } = require('../shared/cache');

const DEFAULT_REGION = 'us-central1';
const TMDB_BASE_URL = 'https://api.themoviedb.org';
const TMDB_CACHE_COLLECTION = 'tmdbCache';
const TMDB_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const YELP_BASE_URL = 'https://api.yelp.com/v3/businesses/search';
const YELP_CACHE_COLLECTION = 'yelpCache';
const YELP_CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

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

function simplifyBusiness(biz) {
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
    latitude:
      typeof biz.coordinates?.latitude === 'number' ? biz.coordinates.latitude : null,
    longitude:
      typeof biz.coordinates?.longitude === 'number' ? biz.coordinates.longitude : null,
    url: biz.url || '',
    distance: typeof biz.distance === 'number' ? biz.distance : null
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

    const cacheKey = yelpCacheKeyParts({ city, latitude, longitude, cuisine });
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

    const params = new URLSearchParams({
      categories: 'restaurants',
      limit: '50'
    });
    if (hasCoords) {
      params.set('latitude', String(latitude));
      params.set('longitude', String(longitude));
      params.set('sort_by', 'distance');
    } else if (city) {
      params.set('location', city);
    }
    if (cuisine) {
      params.set('term', cuisine);
    }

    try {
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
      const simplified = results.map(simplifyBusiness).filter(Boolean);
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
          total: simplified.length
        }
      });

      res.type('application/json').send(payload);
    } catch (err) {
      console.error('Restaurants proxy failed', err);
      res.status(500).json({ error: 'restaurants_proxy_failed' });
    }
  });
