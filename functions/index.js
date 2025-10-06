const functions = require('firebase-functions');

const { readCachedResponse, writeCachedResponse } = require('../shared/cache');
const { normalizeRecipeQuery, recipeCacheKeyParts } = require('../shared/recipes');

const DEFAULT_REGION = 'us-central1';
const TMDB_BASE_URL = 'https://api.themoviedb.org';
const SPOONACULAR_BASE_URL = 'https://api.spoonacular.com/recipes/complexSearch';
const TMDB_CACHE_COLLECTION = 'tmdbCache';
const TMDB_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const RECIPE_CACHE_COLLECTION = 'recipeCache';
const RECIPE_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

async function readRecipeCache(query) {
  return readCachedResponse(
    RECIPE_CACHE_COLLECTION,
    recipeCacheKeyParts(query),
    RECIPE_CACHE_TTL_MS
  );
}

async function writeRecipeCache(query, status, contentType, body) {
  await writeCachedResponse(RECIPE_CACHE_COLLECTION, recipeCacheKeyParts(query), {
    status,
    contentType,
    body,
    metadata: {
      query,
      normalizedQuery: normalizeRecipeQuery(query)
    }
  });
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
      const rawId = query?.movie_id;
      const value = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!value && value !== 0) return null;
      const trimmed = String(value).trim();
      if (!trimmed) return null;
      return `/3/movie/${encodeURIComponent(trimmed)}/credits`;
    },
    omitParams: ['movie_id']
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
      const rawId = query?.movie_id ?? query?.id;
      const value = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!value && value !== 0) return null;
      const trimmed = String(value).trim();
      if (!trimmed) return null;
      return `/3/movie/${encodeURIComponent(trimmed)}`;
    },
    omitParams: ['movie_id', 'id']
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

function getSpoonacularApiKey() {
  const fromEnv = process.env.SPOONACULAR_KEY;
  if (fromEnv) return fromEnv;
  const fromConfig = functions.config()?.spoonacular?.key;
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
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

exports.spoonacularProxy = functions
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

    const rawQuery = resolveSingle(req.query?.query);
    const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'missing_query' });
      return;
    }

    const rawOverrideKey = resolveSingle(req.query?.apiKey || req.query?.api_key);
    const overrideKey = typeof rawOverrideKey === 'string' ? rawOverrideKey.trim() : '';
    const apiKey = overrideKey || getSpoonacularApiKey();

    if (!apiKey) {
      console.error('Spoonacular API key missing for proxy request');
      res.status(500).json({ error: 'spoonacular_key_not_configured' });
      return;
    }

    const params = new URLSearchParams({
      query,
      number: '50',
      offset: '0',
      addRecipeInformation: 'true',
      apiKey
    });

    const cached = await readRecipeCache(query);
    if (cached) {
      res.status(cached.status);
      res.type(cached.contentType);
      res.send(cached.body);
      return;
    }

    try {
      const spoonacularResponse = await fetch(`${SPOONACULAR_BASE_URL}?${params.toString()}`, {
        headers: {
          Accept: 'application/json'
        }
      });

      const payload = await spoonacularResponse.text();
      const contentType = spoonacularResponse.headers.get('content-type') || 'application/json';
      if (spoonacularResponse.ok) {
        await writeRecipeCache(query, spoonacularResponse.status, contentType, payload);
      }
      res.status(spoonacularResponse.status);
      res.type(contentType);
      res.send(payload);
    } catch (err) {
      console.error('Spoonacular proxy failed', err);
      res.status(500).json({ error: 'spoonacular_proxy_failed' });
    }
  });
