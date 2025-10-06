const functions = require('firebase-functions');
const admin = require('firebase-admin');

const DEFAULT_REGION = 'us-central1';
const TMDB_BASE_URL = 'https://api.themoviedb.org';
const SPOONACULAR_BASE_URL = 'https://api.spoonacular.com/recipes/complexSearch';
const RECIPE_CACHE_COLLECTION = 'recipeCache';
const RECIPE_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

let firestore = null;
let firestoreInitFailed = false;

function getFirestore() {
  if (firestore || firestoreInitFailed) {
    return firestore;
  }
  try {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    firestore = admin.firestore();
  } catch (err) {
    firestoreInitFailed = true;
    firestore = null;
    console.error('Failed to initialize Firestore', err);
  }
  return firestore;
}

function normalizeRecipeQuery(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function recipeCacheId(query) {
  const normalized = normalizeRecipeQuery(query);
  if (!normalized) return 'default';
  return Buffer.from(normalized, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function readRecipeCache(query) {
  const db = getFirestore();
  if (!db) return null;
  try {
    const doc = await db.collection(RECIPE_CACHE_COLLECTION).doc(recipeCacheId(query)).get();
    if (!doc.exists) return null;
    const data = doc.data() || {};
    const fetchedAt = data.fetchedAt;
    if (!fetchedAt || typeof fetchedAt.toMillis !== 'function') return null;
    if (Date.now() - fetchedAt.toMillis() > RECIPE_CACHE_TTL_MS) return null;
    if (typeof data.body !== 'string' || !data.body) return null;
    return {
      status: typeof data.status === 'number' ? data.status : 200,
      contentType:
        typeof data.contentType === 'string' && data.contentType
          ? data.contentType
          : 'application/json',
      body: data.body
    };
  } catch (err) {
    console.error('Failed to read recipe cache', err);
    return null;
  }
}

async function writeRecipeCache(query, status, contentType, body) {
  const db = getFirestore();
  if (!db) return;
  try {
    await db
      .collection(RECIPE_CACHE_COLLECTION)
      .doc(recipeCacheId(query))
      .set({
        query,
        normalizedQuery: normalizeRecipeQuery(query),
        status,
        contentType,
        body,
        fetchedAt: admin.firestore.FieldValue.serverTimestamp()
      });
  } catch (err) {
    console.error('Failed to write recipe cache', err);
  }
}

const ALLOWED_ENDPOINTS = {
  discover: { path: '/3/discover/movie' },
  genres: { path: '/3/genre/movie/list' },
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
  }
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

    try {
      const tmdbResponse = await fetch(targetUrl, {
        headers: {
          'Accept': 'application/json'
        }
      });

      const payload = await tmdbResponse.text();
      res.status(tmdbResponse.status);
      res.type(tmdbResponse.headers.get('content-type') || 'application/json');
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
