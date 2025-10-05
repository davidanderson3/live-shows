const functions = require('firebase-functions');

const DEFAULT_REGION = 'us-central1';
const TMDB_BASE_URL = 'https://api.themoviedb.org';

const ALLOWED_ENDPOINTS = {
  discover: '/3/discover/movie',
  genres: '/3/genre/movie/list'
};

function getTmdbApiKey() {
  const fromEnv = process.env.TMDB_API_KEY;
  if (fromEnv) return fromEnv;
  const fromConfig = functions.config()?.tmdb?.key;
  if (fromConfig) return fromConfig;
  return null;
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
    const targetPath = ALLOWED_ENDPOINTS[endpointKey];

    if (!targetPath) {
      res.status(400).json({ error: 'unsupported_endpoint' });
      return;
    }

    const apiKey = getTmdbApiKey();
    if (!apiKey) {
      console.error('TMDB API key missing for proxy request');
      res.status(500).json({ error: 'tmdb_key_not_configured' });
      return;
    }

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query || {})) {
      if (key === 'endpoint' || key === 'api_key') continue;
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
