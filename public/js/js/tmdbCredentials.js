import { API_BASE_URL } from './config.js';

const STORAGE_KEYS = Object.freeze(['moviesApiKey', 'tvApiKey']);
const CANDIDATE_PATHS = Object.freeze(['/api/tmdb-config', '/tmdbConfig']);

let credentialsPromise = null;
let cachedKey = '';

function shouldBypassRemoteFetch() {
  if (typeof process === 'undefined' || !process || !process.env) {
    return false;
  }
  return Boolean(process.env.VITEST || process.env.NODE_ENV === 'test');
}

function buildCandidateUrls() {
  const urls = new Set();
  const base = typeof API_BASE_URL === 'string' ? API_BASE_URL.trim() : '';
  const normalizedBase = base.replace(/\/+$/, '');

  for (const path of CANDIDATE_PATHS) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (normalizedBase) {
      urls.add(`${normalizedBase}${normalizedPath}`);
    }
    urls.add(normalizedPath);
  }

  return Array.from(urls);
}

async function fetchConfig(url) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid TMDB config response');
  }
  return data;
}

function persistKey(key) {
  if (!key) return;
  if (typeof window !== 'undefined') {
    window.tmdbApiKey = key;
  }
  if (typeof localStorage !== 'undefined') {
    try {
      STORAGE_KEYS.forEach(storageKey => {
        localStorage.setItem(storageKey, key);
      });
    } catch (_) {
      /* ignore storage failures */
    }
  }
}

function persistProxyEndpoint(value) {
  if (typeof value !== 'string' || !value.trim()) return;
  if (typeof window !== 'undefined') {
    window.tmdbProxyEndpoint = value.trim();
  }
}

export async function ensureTmdbCredentialsLoaded() {
  if (typeof window !== 'undefined' && window.tmdbApiKey) {
    return window.tmdbApiKey;
  }
  if (cachedKey) {
    return cachedKey;
  }
  if (shouldBypassRemoteFetch()) {
    return typeof window !== 'undefined' ? window.tmdbApiKey || '' : '';
  }
  if (typeof fetch !== 'function') {
    return typeof window !== 'undefined' ? window.tmdbApiKey || '' : '';
  }
  if (!credentialsPromise) {
    credentialsPromise = (async () => {
      const urls = buildCandidateUrls();
      let lastError = null;
      for (const url of urls) {
        try {
          const config = await fetchConfig(url);
          if (typeof config.proxyEndpoint === 'string') {
            persistProxyEndpoint(config.proxyEndpoint);
          }
          const key = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
          if (key) {
            persistKey(key);
            cachedKey = key;
            return key;
          }
        } catch (err) {
          lastError = err;
        }
      }
      if (lastError && typeof console !== 'undefined' && console.warn) {
        console.warn('Failed to load TMDB credentials automatically', lastError);
      }
      return typeof window !== 'undefined' ? window.tmdbApiKey || '' : '';
    })()
      .catch(err => {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('TMDB credential lookup failed', err);
        }
        credentialsPromise = null;
        return typeof window !== 'undefined' ? window.tmdbApiKey || '' : '';
      });
  }

  const key = await credentialsPromise;
  if (key && !cachedKey) {
    cachedKey = key;
  }
  return key;
}
