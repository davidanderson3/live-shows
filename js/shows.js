import { API_BASE_URL, DEFAULT_REMOTE_API_BASE } from './config.js';

const DEFAULT_EVENTBRITE_ENDPOINT =
  (typeof process !== 'undefined' &&
    process.env &&
    (process.env.EVENTBRITE_ENDPOINT || process.env.EVENTBRITE_PROXY_ENDPOINT)) ||
  `${DEFAULT_REMOTE_API_BASE}/eventbriteProxy`;

const EVENTBRITE_TOKEN_STORAGE_KEY = 'eventbriteTokenV1';
const DEFAULT_RADIUS_MILES = 100;
const DEFAULT_LOOKAHEAD_DAYS = 14;

const elements = {
  tokenInput: null,
  discoverButton: null,
  status: null,
  list: null,
  debugContainer: null,
  debugOutput: null
};

let discoverLabel = 'Discover';
let isDiscovering = false;
let initialized = false;

function normalizeEndpoint(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRemoteEndpoint(endpoint) {
  if (!endpoint) return false;
  if (/cloudfunctions\.net/i.test(endpoint)) {
    return true;
  }
  if (/^https?:\/\//i.test(endpoint) && typeof window !== 'undefined') {
    try {
      const resolved = new URL(endpoint, window.location.origin);
      return resolved.origin !== window.location.origin;
    } catch (err) {
      console.warn('Unable to resolve Eventbrite endpoint URL', err);
      return true;
    }
  }
  return /^https?:\/\//i.test(endpoint);
}

function resolveEventbriteEndpoint(baseUrl) {
  const override =
    (typeof window !== 'undefined' && 'eventbriteEndpoint' in window
      ? normalizeEndpoint(window.eventbriteEndpoint)
      : '') || '';

  if (override) {
    const trimmedOverride = override.replace(/\/$/, '');
    return {
      endpoint: trimmedOverride,
      isRemote: isRemoteEndpoint(trimmedOverride)
    };
  }

  const hasWindow = typeof window !== 'undefined';
  const locationOrigin = hasWindow && window.location?.origin
    ? window.location.origin.replace(/\/$/, '')
    : '';
  const hasExplicitApiBaseOverride =
    hasWindow &&
    Object.prototype.hasOwnProperty.call(window, 'apiBaseUrl') &&
    normalizeEndpoint(window.apiBaseUrl);

  const trimmedBase = normalizeEndpoint(baseUrl).replace(/\/$/, '');
  let baseOrigin = '';
  if (trimmedBase) {
    try {
      baseOrigin = new URL(trimmedBase, locationOrigin || undefined).origin;
    } catch {
      baseOrigin = '';
    }
  }

  const matchesWindowOrigin =
    hasWindow && locationOrigin && baseOrigin === locationOrigin;

  const hasWindowPort =
    hasWindow &&
    typeof window.location?.port === 'string' &&
    window.location.port !== '';

  if (
    matchesWindowOrigin &&
    trimmedBase &&
    trimmedBase === locationOrigin &&
    hasWindowPort
  ) {
    const endpoint = `${trimmedBase}/api/eventbrite`;
    return { endpoint, isRemote: isRemoteEndpoint(endpoint) };
  }

  if (!trimmedBase || (matchesWindowOrigin && !hasExplicitApiBaseOverride)) {
    return { endpoint: DEFAULT_EVENTBRITE_ENDPOINT, isRemote: true };
  }

  if (
    trimmedBase.endsWith('/api/eventbrite') ||
    trimmedBase.endsWith('/eventbriteProxy')
  ) {
    return {
      endpoint: trimmedBase,
      isRemote: isRemoteEndpoint(trimmedBase)
    };
  }

  if (trimmedBase.endsWith('/api')) {
    const endpoint = `${trimmedBase}/eventbrite`;
    return { endpoint, isRemote: isRemoteEndpoint(endpoint) };
  }

  if (/cloudfunctions\.net/i.test(trimmedBase)) {
    const endpoint = `${trimmedBase}/eventbriteProxy`;
    return { endpoint, isRemote: true };
  }

  const endpoint = `${trimmedBase}/api/eventbrite`;
  return { endpoint, isRemote: isRemoteEndpoint(endpoint) };
}

function appendQuery(endpoint, params) {
  if (!params) return endpoint;
  const joiner = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${joiner}${params.toString()}`;
}

function cacheElements() {
  elements.tokenInput = document.getElementById('eventbriteApiToken');
  elements.discoverButton = document.getElementById('eventbriteDiscoverBtn');
  elements.status = document.getElementById('eventbriteStatus');
  elements.list = document.getElementById('eventbriteList');
  elements.debugContainer = document.getElementById('eventbriteDebug');
  elements.debugOutput = document.getElementById('eventbriteDebugOutput');
  if (elements.discoverButton) {
    discoverLabel = elements.discoverButton.textContent || discoverLabel;
  }
}

function loadStoredToken() {
  if (typeof localStorage === 'undefined') return '';
  try {
    const value = localStorage.getItem(EVENTBRITE_TOKEN_STORAGE_KEY);
    return typeof value === 'string' ? value : '';
  } catch (err) {
    console.warn('Unable to read Eventbrite token from storage', err);
    return '';
  }
}

function saveToken(token) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (token) {
      localStorage.setItem(EVENTBRITE_TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(EVENTBRITE_TOKEN_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('Unable to persist Eventbrite token', err);
  }
}

function setStatus(message, tone = 'info') {
  if (!elements.status) return;
  elements.status.textContent = message || '';
  elements.status.dataset.tone = tone;
}

function setDebugInfo(info) {
  if (!elements.debugContainer || !elements.debugOutput) {
    return;
  }

  if (!info) {
    elements.debugContainer.hidden = true;
    elements.debugContainer.removeAttribute('data-state');
    elements.debugOutput.textContent = '';
    return;
  }

  const { requestUrl, response, responseText, error, fallbackUrl, primaryError } = info;
  const hasRequest = typeof requestUrl === 'string' && requestUrl.length > 0;
  const hasResponse =
    response && typeof response === 'object' && Object.keys(response).length > 0;
  const hasText = typeof responseText === 'string' && responseText.trim().length > 0;

  if (!hasRequest && !hasResponse && !hasText) {
    elements.debugContainer.hidden = true;
    elements.debugContainer.removeAttribute('data-state');
    elements.debugOutput.textContent = '';
    return;
  }

  const sections = [];

  if (hasRequest) {
    sections.push(`Request URL:\n${requestUrl}`);
  }

  if (fallbackUrl && fallbackUrl !== requestUrl) {
    sections.push(`Fallback URL:\n${fallbackUrl}`);
  }

  if (primaryError) {
    const parts = [];
    if (primaryError.requestUrl && primaryError.requestUrl !== requestUrl) {
      parts.push(`URL: ${primaryError.requestUrl}`);
    }
    if (primaryError.message) {
      parts.push(`Reason: ${primaryError.message}`);
    }
    if (primaryError.status) {
      parts.push(`Status: ${primaryError.status}`);
    }
    sections.push(`Initial attempt failed:\n${parts.join('\n') || String(primaryError)}`);
  }

  if (error) {
    sections.push(`Error:\n${error}`);
  }

  if (hasResponse) {
    try {
      sections.push(`Response JSON:\n${JSON.stringify(response, null, 2)}`);
    } catch (err) {
      sections.push('Response JSON: [unserializable]');
    }
  } else if (hasText) {
    sections.push(`Response Body:\n${responseText}`);
  }

  elements.debugOutput.textContent = sections.join('\n\n');
  elements.debugContainer.hidden = false;
  elements.debugContainer.dataset.state = error ? 'error' : 'success';
}

function setLoading(isLoading) {
  if (!elements.discoverButton) return;
  elements.discoverButton.disabled = isLoading;
  elements.discoverButton.textContent = isLoading ? 'Searching…' : discoverLabel;
}

function clearList() {
  if (!elements.list) return;
  elements.list.innerHTML = '';
}

function formatEventDate(start) {
  if (!start) return '';
  const iso = start.local || start.utc;
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return start.local || start.utc || '';
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  } catch (err) {
    console.warn('Unable to format Eventbrite date', err);
    return date.toLocaleString();
  }
}

function createEventCard(event) {
  const card = document.createElement('article');
  card.className = 'show-card';

  const content = document.createElement('div');
  content.className = 'show-card__content';
  card.appendChild(content);

  const header = document.createElement('div');
  header.className = 'show-card__header';
  content.appendChild(header);

  const title = document.createElement('h3');
  title.className = 'show-card__title';
  title.textContent = event?.name?.text?.trim() || 'Live music event';
  header.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'show-card__meta';

  const dateText = formatEventDate(event?.start);
  if (dateText) {
    const dateSpan = document.createElement('span');
    dateSpan.className = 'show-card__date';
    dateSpan.textContent = dateText;
    meta.appendChild(dateSpan);
  }

  const locationParts = [];
  if (event?.venue?.name) {
    locationParts.push(event.venue.name);
  }
  const cityParts = [event?.venue?.address?.city, event?.venue?.address?.region]
    .filter(Boolean)
    .join(', ');
  if (cityParts) {
    locationParts.push(cityParts);
  }
  if (locationParts.length) {
    const locationSpan = document.createElement('span');
    locationSpan.className = 'show-card__location';
    locationSpan.textContent = locationParts.join(' • ');
    meta.appendChild(locationSpan);
  }

  if (meta.childNodes.length) {
    content.appendChild(meta);
  }

  if (event?.summary?.trim()) {
    const summary = document.createElement('p');
    summary.className = 'show-card__sample-note';
    summary.textContent = event.summary.trim();
    content.appendChild(summary);
  }

  const cta = document.createElement('a');
  cta.className = 'show-card__cta';
  if (event?.url) {
    cta.href = event.url;
    cta.target = '_blank';
    cta.rel = 'noopener noreferrer';
  } else {
    cta.setAttribute('aria-disabled', 'true');
  }
  cta.textContent = 'View on Eventbrite';
  content.appendChild(cta);

  return card;
}

function renderEvents(events) {
  if (!elements.list) return;
  clearList();

  if (!Array.isArray(events) || events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'shows-empty';
    empty.textContent =
      'No upcoming music events were found nearby. Try expanding your search radius or checking again later.';
    elements.list.appendChild(empty);
    return;
  }

  for (const event of events) {
    elements.list.appendChild(createEventCard(event));
  }
}

function requestLocation() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not available in this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      },
      error => {
        if (error?.code === error.PERMISSION_DENIED) {
          reject(new Error('Location access was denied. Enable location sharing and try again.'));
        } else {
          reject(new Error('Unable to determine your location.'));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000
      }
    );
  });
}

function interpretEventbriteError(error) {
  if (!error) {
    return 'Unable to load Eventbrite events.';
  }

  const normalizedMessage = (error.message || '').toLowerCase();
  const status = typeof error.status === 'number' ? error.status : null;

  if (
    status === 401 ||
    normalizedMessage.includes('unauthorized') ||
    normalizedMessage.includes('invalid oauth token')
  ) {
    return 'Eventbrite rejected the token. Paste the personal OAuth token from Account Settings → Developer → Your personal token and try again.';
  }

  if (
    status === 404 ||
    normalizedMessage.includes('not_found') ||
    normalizedMessage.includes('not found')
  ) {
    if (error?.code === 'NOT_FOUND') {
      return 'Eventbrite reported that the proxy path does not exist. Ensure your backend exposes the /api/eventbrite route locally or use window.apiBaseUrl to point to a deployed backend with /eventbriteProxy before trying Discover again.';
    }
    return 'The Live Music proxy could not be reached. Start the local server with “npm start” or set window.apiBaseUrl to your deployed backend before trying Discover again.';
  }

  if (
    status === 500 &&
    normalizedMessage.includes('missing eventbrite api token')
  ) {
    return 'The server is missing an Eventbrite token. Enter your personal OAuth token above or configure EVENTBRITE_API_TOKEN on the backend.';
  }

  if (normalizedMessage) {
    return error.message;
  }

  return 'Unable to load Eventbrite events.';
}

async function performEventbriteRequest(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' }
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    console.warn('Unable to parse Eventbrite response', err);
    const parseError = new Error('Received an invalid response from Eventbrite.');
    parseError.requestUrl = url;
    parseError.responseText = text;
    throw parseError;
  }

  if (!response.ok) {
    const message =
      typeof data?.error_description === 'string' && data.error_description.trim().length > 0
        ? data.error_description
        : typeof data?.error === 'string' && data.error.trim().length > 0
          ? data.error
          : `Eventbrite request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.code = typeof data?.error === 'string' ? data.error : null;
    error.requestUrl = url;
    error.responseText = text;
    throw error;
  }

  return {
    events: Array.isArray(data?.events) ? data.events : [],
    raw: data,
    url,
    responseText: text
  };
}

async function fetchEventbriteEvents({ latitude, longitude, token }) {
  const params = new URLSearchParams({
    lat: latitude.toFixed(4),
    lon: longitude.toFixed(4),
    radius: String(DEFAULT_RADIUS_MILES),
    days: String(DEFAULT_LOOKAHEAD_DAYS)
  });

  if (token) {
    params.set('token', token);
  }

  const { endpoint, isRemote } = resolveEventbriteEndpoint(API_BASE_URL);
  const url = appendQuery(endpoint, params);

  try {
    return await performEventbriteRequest(url);
  } catch (err) {
    const shouldAttemptFallback =
      !isRemote &&
      (!err || err.status === 404 || err.name === 'TypeError' || err.code === 'NOT_FOUND');

    if (!shouldAttemptFallback) {
      throw err;
    }

    console.warn(
      'Primary Eventbrite endpoint failed, retrying with remote proxy',
      err?.message || err
    );

    const fallbackUrl = appendQuery(DEFAULT_EVENTBRITE_ENDPOINT, params);
    const result = await performEventbriteRequest(fallbackUrl);
    result.fallbackUrl = fallbackUrl;
    result.primaryError = err;
    return result;
  }
}

async function discoverNearbyShows() {
  if (isDiscovering) {
    return;
  }
  isDiscovering = true;
  setLoading(true);

  try {
    setStatus('Finding your location…');
    setDebugInfo(null);
    const location = await requestLocation();

    if (!location) {
      setStatus('Unable to access your location.');
      clearList();
      return;
    }

    const token = elements.tokenInput?.value?.trim() || '';
    saveToken(token);

    setStatus('Searching Eventbrite for nearby music events…');
    const result = await fetchEventbriteEvents({
      latitude: location.latitude,
      longitude: location.longitude,
      token
    });

    renderEvents(result.events);
    setDebugInfo({
      requestUrl: result.url,
      response: result.raw,
      responseText: result.responseText,
      fallbackUrl: result.fallbackUrl,
      primaryError: result.primaryError || null
    });

    if (result.events.length > 0) {
      setStatus(`Found ${result.events.length} upcoming event${result.events.length === 1 ? '' : 's'}.`);
    } else {
      setStatus('No music events found near you right now.', 'warning');
    }
  } catch (err) {
    console.error('Unable to load Eventbrite events', err);
    setStatus(interpretEventbriteError(err), 'error');
    setDebugInfo({
      requestUrl: err.requestUrl,
      responseText: err.responseText,
      error: err.message
    });
    clearList();
  } finally {
    setLoading(false);
    isDiscovering = false;
  }
}

function handleTokenInput() {
  if (!elements.tokenInput) return;
  const token = elements.tokenInput.value.trim();
  saveToken(token);
}

export async function initShowsPanel() {
  if (initialized) {
    return;
  }
  initialized = true;
  cacheElements();

  if (elements.tokenInput) {
    elements.tokenInput.value = loadStoredToken();
    elements.tokenInput.addEventListener('change', handleTokenInput);
    elements.tokenInput.addEventListener('blur', handleTokenInput);
    elements.tokenInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleTokenInput();
        discoverNearbyShows();
      }
    });
  }

  if (elements.discoverButton) {
    elements.discoverButton.addEventListener('click', () => {
      handleTokenInput();
      discoverNearbyShows();
    });
  }

  if (elements.status) {
    setStatus('Enter your Eventbrite personal token and select “Discover” to find nearby shows.');
  }
}

window.initShowsPanel = initShowsPanel;
