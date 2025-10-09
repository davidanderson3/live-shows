const DEFAULT_REMOTE_API_BASE = 'https://narrow-down.web.app/api';

function isLocalHost(hostname) {
  if (!hostname) return false;
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.endsWith('.local')
  );
}

function resolveDefaultApiBase() {
  if (typeof window === 'undefined') {
    return DEFAULT_REMOTE_API_BASE;
  }

  const { location } = window;
  if (!location) {
    return DEFAULT_REMOTE_API_BASE;
  }

  const { protocol, origin, hostname } = location;
  if (protocol === 'file:') {
    return DEFAULT_REMOTE_API_BASE;
  }

  if (isLocalHost(hostname)) {
    return origin || '';
  }

  if (!hostname) {
    return DEFAULT_REMOTE_API_BASE;
  }

  return DEFAULT_REMOTE_API_BASE;
}

export const API_BASE_URL =
  (typeof window !== 'undefined' && window.apiBaseUrl) ||
  (typeof process !== 'undefined' && process.env && process.env.API_BASE_URL) ||
  resolveDefaultApiBase();

export { DEFAULT_REMOTE_API_BASE };
