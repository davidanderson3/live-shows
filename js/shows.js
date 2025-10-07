const API_BASE_URL =
  (typeof window !== 'undefined' && window.apiBaseUrl) ||
  (typeof process !== 'undefined' && process.env.API_BASE_URL) ||
  (typeof window !== 'undefined' ? window.location.origin : '');

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let str = '';
  for (let i = 0; i < length; i++) {
    str += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return str;
}

async function pkceChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } else {
    const { createHash } = await import('crypto');
    return createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}

let cachedUserLocation = null;
let userLocationPromise = null;

const SHOW_PREFS_STORAGE_KEY = 'showsPreferences';
let currentShows = [];
let currentSuggestions = [];
let showsEmptyReason = null;

const SHOWS_CONFIG_STORAGE_KEY = 'showsConfigV1';
const DEFAULT_SHOWS_CONFIG = {
  radiusMiles: 300,
  artistLimit: 10,
  includeSuggestions: true
};

function normalizeShowsConfig(config = {}) {
  const radiusValue = Number.parseFloat(config.radiusMiles);
  const radiusMiles = Number.isFinite(radiusValue) && radiusValue > 0
    ? Math.min(Math.max(radiusValue, 25), 1000)
    : DEFAULT_SHOWS_CONFIG.radiusMiles;

  const artistValue = Number.parseInt(config.artistLimit, 10);
  const artistLimit = Number.isFinite(artistValue) && artistValue > 0
    ? Math.min(Math.max(artistValue, 1), 50)
    : DEFAULT_SHOWS_CONFIG.artistLimit;

  const includeSuggestions =
    typeof config.includeSuggestions === 'boolean'
      ? config.includeSuggestions
      : DEFAULT_SHOWS_CONFIG.includeSuggestions;

  return {
    radiusMiles,
    artistLimit,
    includeSuggestions
  };
}

function loadShowsConfig() {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_SHOWS_CONFIG };
  }
  try {
    const raw = localStorage.getItem(SHOWS_CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SHOWS_CONFIG };
    const parsed = JSON.parse(raw);
    return normalizeShowsConfig(parsed);
  } catch (err) {
    console.warn('Unable to parse shows config from storage', err);
    return { ...DEFAULT_SHOWS_CONFIG };
  }
}

function saveShowsConfig(config) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SHOWS_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('Unable to save shows config to storage', err);
  }
}

let showsConfig = loadShowsConfig();
let lastRequestedRadiusMiles = showsConfig.radiusMiles;

function updateShowsConfig(partial = {}) {
  showsConfig = normalizeShowsConfig({ ...showsConfig, ...partial });
  saveShowsConfig(showsConfig);
  return showsConfig;
}

function buildSampleShow({
  id,
  name,
  venueName,
  city,
  stateCode,
  distanceMiles,
  daysFromToday,
  imageUrl,
  note
}) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  const iso = date.toISOString();
  const venue = {
    name: venueName,
    city: { name: city },
    state: { stateCode },
    location: {
      latitude: '0',
      longitude: '0'
    }
  };
  return {
    id,
    isSample: true,
    sampleNote: note,
    event: {
      id,
      name,
      dates: {
        start: {
          localDate: iso.slice(0, 10),
          localTime: iso.slice(11, 16)
        }
      },
      images: [
        {
          ratio: '16_9',
          url: imageUrl
        }
      ],
      _embedded: { venues: [venue] },
      url: '#'
    },
    venue,
    distance: distanceMiles,
    order: 0
  };
}

const SAMPLE_PREVIEW_SHOWS = [
  buildSampleShow({
    id: 'sample-paramount',
    name: 'The Midnight Echo',
    venueName: 'Paramount Theatre',
    city: 'Austin',
    stateCode: 'TX',
    distanceMiles: 4,
    daysFromToday: 14,
    imageUrl:
      'https://images.unsplash.com/photo-1507874457470-272b3c8d8ee2?auto=format&fit=crop&w=960&q=80',
    note: 'A synthwave night packed with neon visuals and soaring hooks.'
  }),
  buildSampleShow({
    id: 'sample-stubb',
    name: 'Stubb’s Backyard Sessions',
    venueName: "Stubb's Waller Creek Amphitheater",
    city: 'Austin',
    stateCode: 'TX',
    distanceMiles: 8,
    daysFromToday: 24,
    imageUrl:
      'https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=960&q=80',
    note: 'Indie favorites with local openers and late-night food trucks.'
  }),
  buildSampleShow({
    id: 'sample-moody-center',
    name: 'Moody Center Block Party',
    venueName: 'Moody Center',
    city: 'Austin',
    stateCode: 'TX',
    distanceMiles: 42,
    daysFromToday: 37,
    imageUrl:
      'https://images.unsplash.com/photo-1519074002996-a69e7ac46a42?auto=format&fit=crop&w=960&q=80',
    note: 'A stadium-sized pop spectacle with immersive light design.'
  })
];

const SPOTIFY_SUGGESTION_LIMIT = 10;

function uniqueNonEmpty(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

async function requestSpotifyRecommendations(token, { artistSeeds = [], genreSeeds = [] } = {}) {
  if (!token || (!artistSeeds.length && !genreSeeds.length)) {
    return [];
  }

  const url = new URL('https://api.spotify.com/v1/recommendations');
  url.searchParams.set('limit', String(SPOTIFY_SUGGESTION_LIMIT));
  url.searchParams.set('market', 'from_token');
  if (artistSeeds.length) {
    url.searchParams.set('seed_artists', artistSeeds.join(','));
  }
  if (genreSeeds.length) {
    url.searchParams.set('seed_genres', genreSeeds.join(','));
  }

  let res;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (err) {
    console.warn('Failed to reach Spotify recommendations', err);
    return [];
  }

  if (res.status === 400 || res.status === 422) {
    return [];
  }

  if (!res.ok) {
    throw new Error(`Spotify suggestions HTTP ${res.status}`);
  }

  try {
    const data = await res.json();
    return Array.isArray(data?.tracks) ? data.tracks : [];
  } catch (err) {
    console.warn('Failed to parse Spotify recommendations', err);
    return [];
  }
}

function formatSpotifySuggestions(tracks) {
  if (!Array.isArray(tracks) || !tracks.length) {
    return [];
  }
  const seen = new Set();
  const suggestions = [];
  for (const track of tracks) {
    const id = track?.id || track?.uri || track?.name || '';
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    suggestions.push({
      id,
      name: track?.name || 'Spotify recommendation',
      artists: Array.isArray(track?.artists)
        ? track.artists
            .map(a => a?.name)
            .filter(Boolean)
            .join(', ')
        : '',
      url: track?.external_urls?.spotify || '',
      image: Array.isArray(track?.album?.images)
        ? (track.album.images.find(img => img?.width >= 200) || track.album.images[0])?.url || ''
        : ''
    });
    if (suggestions.length >= SPOTIFY_SUGGESTION_LIMIT) {
      break;
    }
  }
  return suggestions;
}

async function fetchSpotifySuggestions(token, artists) {
  if (!token || !Array.isArray(artists) || artists.length === 0) {
    return [];
  }

  const artistSeeds = uniqueNonEmpty(artists.map(artist => artist?.id));
  const genreSeeds = uniqueNonEmpty(
    artists.flatMap(artist => {
      if (!Array.isArray(artist?.genres)) return [];
      return artist.genres
        .map(genre => (typeof genre === 'string' ? genre.trim().toLowerCase() : ''))
        .filter(Boolean);
    })
  );

  const attempts = [];
  if (artistSeeds.length) {
    attempts.push({ artistSeeds: artistSeeds.slice(0, 5), genreSeeds: [] });
  }
  if (artistSeeds.length && genreSeeds.length) {
    const artistCount = Math.min(3, artistSeeds.length);
    const remaining = 5 - artistCount;
    attempts.push({
      artistSeeds: artistSeeds.slice(0, artistCount),
      genreSeeds: genreSeeds.slice(0, Math.min(remaining, genreSeeds.length))
    });
  }
  if (genreSeeds.length) {
    attempts.push({ artistSeeds: [], genreSeeds: genreSeeds.slice(0, 5) });
  }

  for (const attempt of attempts) {
    const tracks = await requestSpotifyRecommendations(token, attempt);
    if (tracks.length) {
      return formatSpotifySuggestions(tracks);
    }
  }

  return [];
}

const TICKETMASTER_CACHE_STORAGE_KEY = 'ticketmasterCacheV1';
const TICKETMASTER_CACHE_TTL = 1000 * 60 * 30; // 30 minutes
const MAX_TICKETMASTER_CACHE_ENTRIES = 50;

function normalizeTicketmasterCacheKey(keyword) {
  return (keyword || '').toLowerCase().trim();
}

function loadTicketmasterCache() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(TICKETMASTER_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn('Unable to load Ticketmaster cache', err);
    return {};
  }
}

function saveTicketmasterCache(cache) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(TICKETMASTER_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('Unable to persist Ticketmaster cache', err);
  }
}

const ticketmasterCache = loadTicketmasterCache();
const ticketmasterMemoryCache = new Map();

function ticketmasterCacheKey(keyword, scope = 'server') {
  const normalized = normalizeTicketmasterCacheKey(keyword);
  return normalized ? `${scope}:${normalized}` : '';
}

function getCachedTicketmasterResponse(keyword, scope = 'server') {
  const key = ticketmasterCacheKey(keyword, scope);
  if (!key) return null;

  const now = Date.now();
  const memoryEntry = ticketmasterMemoryCache.get(key);
  if (memoryEntry && now - memoryEntry.timestamp < TICKETMASTER_CACHE_TTL) {
    return memoryEntry.data;
  }

  const storedEntry = ticketmasterCache[key];
  if (storedEntry && now - storedEntry.timestamp < TICKETMASTER_CACHE_TTL) {
    ticketmasterMemoryCache.set(key, storedEntry);
    return storedEntry.data;
  }

  return null;
}

function setCachedTicketmasterResponse(keyword, data, scope = 'server') {
  const key = ticketmasterCacheKey(keyword, scope);
  if (!key) return;
  const entry = { timestamp: Date.now(), data };
  ticketmasterMemoryCache.set(key, entry);
  if (typeof localStorage === 'undefined') return;
  ticketmasterCache[key] = entry;

  const keys = Object.keys(ticketmasterCache);
  const now = Date.now();
  for (const existingKey of keys) {
    if (now - ticketmasterCache[existingKey].timestamp >= TICKETMASTER_CACHE_TTL) {
      delete ticketmasterCache[existingKey];
    }
  }

  const remainingKeys = Object.keys(ticketmasterCache);
  if (remainingKeys.length > MAX_TICKETMASTER_CACHE_ENTRIES) {
    remainingKeys
      .sort((a, b) => ticketmasterCache[a].timestamp - ticketmasterCache[b].timestamp)
      .slice(0, remainingKeys.length - MAX_TICKETMASTER_CACHE_ENTRIES)
      .forEach((oldKey) => {
        delete ticketmasterCache[oldKey];
      });
  }

  saveTicketmasterCache(ticketmasterCache);
}

function getStaleTicketmasterResponse(keyword, scope = 'server') {
  const key = ticketmasterCacheKey(keyword, scope);
  if (!key) return null;
  const memoryEntry = ticketmasterMemoryCache.get(key);
  if (memoryEntry) {
    return memoryEntry.data;
  }
  const storedEntry = ticketmasterCache[key];
  return storedEntry?.data || null;
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth's radius in miles
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatEventDate(start) {
  if (!start?.localDate) return '';
  const { localDate, localTime } = start;
  let isoString = localDate;
  if (localTime) {
    isoString += `T${localTime}`;
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return localTime ? `${localDate} ${localTime}` : localDate;
  }
  const options = { dateStyle: 'medium' };
  if (localTime) {
    options.timeStyle = 'short';
  }
  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch (err) {
    console.warn('Unable to format show date', err);
    return localTime ? `${localDate} ${localTime}` : localDate;
  }
}

async function getUserLocation({ allowRetry = false } = {}) {
  if (cachedUserLocation) {
    return cachedUserLocation;
  }

  if (allowRetry) {
    userLocationPromise = null;
  }

  if (userLocationPromise) {
    return userLocationPromise;
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    userLocationPromise = Promise.resolve(null);
    return null;
  }

  userLocationPromise = new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => {
        cachedUserLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        resolve(cachedUserLocation);
      },
      err => {
        console.warn('Unable to retrieve current location for shows list', err);
        cachedUserLocation = null;
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000
      }
    );
  });

  const result = await userLocationPromise;
  if (result || allowRetry) {
    userLocationPromise = null;
  } else {
    userLocationPromise = Promise.resolve(null);
  }
  return result;
}

function loadStoredShowPreferences() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SHOW_PREFS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn('Unable to parse show preferences from storage', err);
    return {};
  }
}

function saveShowPreferences(prefs) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SHOW_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.warn('Unable to save show preferences to storage', err);
  }
}

let showPreferences = loadStoredShowPreferences();

function updateShowStatus(id, status) {
  if (!id) return;
  const next = { ...showPreferences };
  if (!status) {
    delete next[id];
  } else {
    next[id] = { status, updatedAt: Date.now() };
  }
  showPreferences = next;
  saveShowPreferences(showPreferences);
  renderShowsList();
}

function getShowStatus(id) {
  return showPreferences[id]?.status || null;
}

function renderShowsList() {
  const listEl = document.getElementById('ticketmasterList');
  const interestedEl = document.getElementById('ticketmasterInterestedList');
  if (!listEl && !interestedEl) return;

  if (listEl) {
    listEl.innerHTML = '';
  }
  if (interestedEl) {
    interestedEl.innerHTML = '';
  }

  if (!currentShows.length) {
    if (listEl) {
      const radiusLabel = Math.round(
        lastRequestedRadiusMiles || DEFAULT_SHOWS_CONFIG.radiusMiles
      );
      const emptyMessage =
        showsEmptyReason === 'noNearby'
          ? `No nearby shows within ${radiusLabel} miles.`
          : 'No shows available right now.';
      const emptyEl = document.createElement('p');
      emptyEl.className = 'shows-empty';
      emptyEl.textContent = emptyMessage;
      listEl.appendChild(emptyEl);

      if (currentSuggestions.length) {
        const suggestionHeader = document.createElement('h4');
        suggestionHeader.className = 'shows-suggestions__title';
        suggestionHeader.textContent = 'Spotify suggestions to explore:';
        listEl.appendChild(suggestionHeader);

        const suggestionList = document.createElement('ul');
        suggestionList.className = 'shows-suggestions';

        for (const suggestion of currentSuggestions) {
          const item = document.createElement('li');
          item.className = 'shows-suggestion';

          if (suggestion.image) {
            const thumb = document.createElement('img');
            thumb.className = 'shows-suggestion__image';
            thumb.src = suggestion.image;
            thumb.alt = `${suggestion.name} cover art`;
            thumb.loading = 'lazy';
            item.appendChild(thumb);
          }

          const content = document.createElement('div');
          content.className = 'shows-suggestion__content';

          const title = document.createElement('p');
          title.className = 'shows-suggestion__name';
          title.textContent = suggestion.name;
          content.appendChild(title);

          if (suggestion.artists) {
            const artists = document.createElement('p');
            artists.className = 'shows-suggestion__artists';
            artists.textContent = suggestion.artists;
            content.appendChild(artists);
          }

          if (suggestion.url) {
            const link = document.createElement('a');
            link.href = suggestion.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'shows-suggestion__link';
            link.textContent = 'Listen on Spotify';
            content.appendChild(link);
          }

          item.appendChild(content);
          suggestionList.appendChild(item);
        }

        listEl.appendChild(suggestionList);
      }
    }
    if (interestedEl) {
      const emptyInterested = document.createElement('p');
      emptyInterested.className = 'shows-empty';
      emptyInterested.textContent = 'No saved live music events yet.';
      interestedEl.appendChild(emptyInterested);
    }
    return;
  }

  const active = [];
  const dismissed = [];
  const interested = [];
  for (const item of currentShows) {
    const status = getShowStatus(item.id);
    const enriched = { ...item, status };
    if (status === 'interested') {
      interested.push(enriched);
    }
    if (status === 'notInterested') {
      dismissed.push(enriched);
    } else {
      active.push(enriched);
    }
  }

  if (listEl) {
    if (active.length) {
      const activeList = document.createElement('ul');
      activeList.className = 'shows-grid';
      for (const item of active) {
        activeList.appendChild(createShowCard(item));
      }
      listEl.appendChild(activeList);
    } else {
      const noActive = document.createElement('p');
      noActive.className = 'shows-empty';
      const radiusLabel = Math.round(
        lastRequestedRadiusMiles || DEFAULT_SHOWS_CONFIG.radiusMiles
      );
      noActive.textContent = dismissed.length
        ? 'No other shows right now. Review ones you previously skipped below.'
        : `No nearby shows within ${radiusLabel} miles.`;
      listEl.appendChild(noActive);
    }

    if (dismissed.length) {
      const dismissedSection = document.createElement('details');
      dismissedSection.className = 'shows-dismissed';

      const summary = document.createElement('summary');
      summary.className = 'shows-dismissed__summary';
      summary.textContent = `Not Interested (${dismissed.length})`;
      dismissedSection.appendChild(summary);

      const dismissedList = document.createElement('ul');
      dismissedList.className = 'shows-grid shows-grid--dismissed';
      for (const item of dismissed) {
        dismissedList.appendChild(createShowCard(item));
      }
      dismissedSection.appendChild(dismissedList);

      listEl.appendChild(dismissedSection);
    }
  }

  if (interestedEl) {
    if (interested.length) {
      const interestedList = document.createElement('ul');
      interestedList.className = 'shows-grid';
      for (const item of interested) {
        interestedList.appendChild(createShowCard(item));
      }
      interestedEl.appendChild(interestedList);
    } else {
      const emptyInterested = document.createElement('p');
      emptyInterested.className = 'shows-empty';
      emptyInterested.textContent = 'No saved live music events yet. Mark events as Interested to add them here.';
      interestedEl.appendChild(emptyInterested);
    }
  }
}

function renderShowsPreview(listEl, radiusMiles, message) {
  if (!listEl) return;

  const radiusLabel = Math.round(radiusMiles || DEFAULT_SHOWS_CONFIG.radiusMiles);
  listEl.innerHTML = '';

  const prompt = document.createElement('p');
  prompt.className = 'shows-empty';
  prompt.innerHTML =
    message ||
    `Connect your Spotify account to discover live music within <strong>${radiusLabel} miles</strong> of you.`;
  listEl.appendChild(prompt);

  const previewIntro = document.createElement('p');
  previewIntro.className = 'shows-preview-note';
  previewIntro.textContent = 'Here is a preview of the event cards you will unlock:';
  listEl.appendChild(previewIntro);

  const previewList = document.createElement('ul');
  previewList.className = 'shows-grid shows-grid--preview';

  SAMPLE_PREVIEW_SHOWS.forEach((item, index) => {
    const previewItem = { ...item, status: null, order: index };
    previewList.appendChild(createShowCard(previewItem));
  });

  listEl.appendChild(previewList);
}

function createShowCard(item) {
  const { event, venue, distance, status } = item;

  const li = document.createElement('li');
  li.className = 'show-card';
  const isSample = Boolean(item.isSample);
  if (status === 'interested') {
    li.classList.add('show-card--interested');
  }
  if (isSample) {
    li.classList.add('show-card--sample');
  }

  const imageUrl =
    event.images?.find(image => image.ratio === '16_9')?.url || event.images?.[0]?.url;
  if (imageUrl) {
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'show-card__media';
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = `${event.name || 'Event'} poster`;
    img.loading = 'lazy';
    imageWrapper.appendChild(img);
    li.appendChild(imageWrapper);
  }

  const content = document.createElement('div');
  content.className = 'show-card__content';

  const header = document.createElement('header');
  header.className = 'show-card__header';

  const nameHeading = document.createElement('h3');
  nameHeading.className = 'show-card__title';
  nameHeading.textContent = event.name || 'Unnamed event';
  header.appendChild(nameHeading);

  if (status === 'interested') {
    const chip = document.createElement('span');
    chip.className = 'show-card__status';
    chip.textContent = 'Interested';
    header.appendChild(chip);
  }

  const meta = document.createElement('div');
  meta.className = 'show-card__meta';

  const date = event.dates?.start?.localDate;
  if (date) {
    const dateDiv = document.createElement('div');
    dateDiv.className = 'show-card__date';
    dateDiv.textContent = formatEventDate(event.dates?.start);
    meta.appendChild(dateDiv);
  }

  if (Number.isFinite(distance)) {
    const distanceDiv = document.createElement('div');
    distanceDiv.className = 'show-card__tag';
    distanceDiv.textContent = `${distance.toFixed(0)} miles away`;
    meta.appendChild(distanceDiv);
  }

  if (meta.childElementCount > 0) {
    header.appendChild(meta);
  }

  content.appendChild(header);

  const locParts = [venue?.name, venue?.city?.name, venue?.state?.stateCode].filter(Boolean);
  if (locParts.length > 0) {
    const locDiv = document.createElement('div');
    locDiv.className = 'show-card__location';
    locDiv.textContent = locParts.join(' · ');
    content.appendChild(locDiv);
  }

  const actions = document.createElement('div');
  actions.className = 'show-card__actions';

  const interestedBtn = document.createElement('button');
  interestedBtn.type = 'button';
  interestedBtn.className = 'show-card__button';
  interestedBtn.textContent = 'Interested';
  if (status === 'interested') {
    interestedBtn.classList.add('is-active');
    interestedBtn.setAttribute('aria-pressed', 'true');
  } else {
    interestedBtn.setAttribute('aria-pressed', 'false');
  }
  if (isSample) {
    interestedBtn.disabled = true;
    interestedBtn.title = 'Connect Spotify to save events';
  } else {
    interestedBtn.addEventListener('click', () => {
      const currentStatus = getShowStatus(item.id);
      const nextStatus = currentStatus === 'interested' ? null : 'interested';
      updateShowStatus(item.id, nextStatus);
    });
  }
  actions.appendChild(interestedBtn);

  const notInterestedBtn = document.createElement('button');
  notInterestedBtn.type = 'button';
  notInterestedBtn.className = 'show-card__button show-card__button--secondary';
  const isDismissed = status === 'notInterested';
  notInterestedBtn.textContent = isDismissed ? 'Undo Not Interested' : 'Not Interested';
  if (isDismissed) {
    notInterestedBtn.classList.add('is-active');
  }
  if (isSample) {
    notInterestedBtn.disabled = true;
    notInterestedBtn.title = 'Connect Spotify to refine results';
  } else {
    notInterestedBtn.addEventListener('click', () => {
      const currentStatus = getShowStatus(item.id);
      const nextStatus = currentStatus === 'notInterested' ? null : 'notInterested';
      updateShowStatus(item.id, nextStatus);
    });
  }
  actions.appendChild(notInterestedBtn);

  content.appendChild(actions);

  if (isSample && item.sampleNote) {
    const note = document.createElement('p');
    note.className = 'show-card__sample-note';
    note.textContent = item.sampleNote;
    content.appendChild(note);
  }

  if (event.url || isSample) {
    const link = document.createElement('a');
    link.href = event.url || '#';
    link.className = 'show-card__cta';
    if (isSample) {
      link.textContent = 'Preview only';
      link.removeAttribute('target');
      link.removeAttribute('rel');
      link.setAttribute('aria-disabled', 'true');
    } else {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Get Tickets';
    }
    content.appendChild(link);
  }

  li.appendChild(content);
  return li;
}

if (typeof window !== 'undefined') {
  window.__showsTestUtils = { getUserLocation };
}

export async function initShowsPanel() {
  const listEl = document.getElementById('ticketmasterList');
  if (!listEl) return;
  const interestedListEl = document.getElementById('ticketmasterInterestedList');
  const tokenBtn = document.getElementById('spotifyTokenBtn');
  const statusEl = document.getElementById('spotifyStatus');
  const apiKeyInput = document.getElementById('ticketmasterApiKey');
  const tabsContainer = document.getElementById('showsTabs');
  const discoverBtn = document.getElementById('ticketmasterDiscoverBtn');
  const radiusInput = document.getElementById('showsRadius');
  const artistLimitInput = document.getElementById('showsArtistLimit');
  const includeSuggestionsInput = document.getElementById('showsIncludeSuggestions');

  const setDiscoverButtonState = isLoading => {
    if (!discoverBtn) return;
    if (!discoverBtn.dataset.defaultText) {
      discoverBtn.dataset.defaultText = discoverBtn.textContent.trim() || 'Discover';
    }
    discoverBtn.disabled = isLoading;
    discoverBtn.classList.toggle('is-loading', isLoading);
    discoverBtn.textContent = isLoading
      ? 'Loading…'
      : discoverBtn.dataset.defaultText;
  };

  const applyConfigToInputs = config => {
    if (radiusInput) {
      radiusInput.value = String(config.radiusMiles);
    }
    if (artistLimitInput) {
      artistLimitInput.value = String(config.artistLimit);
    }
    if (includeSuggestionsInput) {
      includeSuggestionsInput.checked = Boolean(config.includeSuggestions);
    }
  };

  applyConfigToInputs(showsConfig);

  const readConfigFromInputs = () => {
    const partial = {};
    if (radiusInput) {
      partial.radiusMiles = Number.parseFloat(radiusInput.value);
    }
    if (artistLimitInput) {
      partial.artistLimit = Number.parseInt(artistLimitInput.value, 10);
    }
    if (includeSuggestionsInput) {
      partial.includeSuggestions = includeSuggestionsInput.checked;
    }
    const next = updateShowsConfig(partial);
    applyConfigToInputs(next);
    return next;
  };

  const handleConfigChange = () => {
    readConfigFromInputs();
  };

  radiusInput?.addEventListener('change', handleConfigChange);
  radiusInput?.addEventListener('blur', handleConfigChange);
  artistLimitInput?.addEventListener('change', handleConfigChange);
  artistLimitInput?.addEventListener('blur', handleConfigChange);
  includeSuggestionsInput?.addEventListener('change', handleConfigChange);

  if (tabsContainer) {
    const tabButtons = Array.from(tabsContainer.querySelectorAll('.shows-tab'));
    const sections = new Map(
      tabButtons.map(btn => [btn.dataset.target, document.getElementById(btn.dataset.target)])
    );
    tabButtons.forEach(btn => {
      if (btn._showsTabHandler) {
        btn.removeEventListener('click', btn._showsTabHandler);
      }
      const handler = () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sections.forEach((section, id) => {
          if (!section) return;
          section.style.display = id === btn.dataset.target ? '' : 'none';
        });
      };
      btn._showsTabHandler = handler;
      btn.addEventListener('click', handler);
    });
    const initialTab =
      tabButtons.find(btn => btn.classList.contains('active')) || tabButtons[0];
    if (initialTab?._showsTabHandler) {
      initialTab._showsTabHandler();
    }
  }

  let spotifyClientId = '';
  let serverHasTicketmasterKey = false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/spotify-client-id`);
    if (res.ok) {
      const data = await res.json();
      spotifyClientId = data.clientId || '';
      serverHasTicketmasterKey = Boolean(data.hasTicketmasterKey);
    }
  } catch (err) {
    console.error('Failed to fetch Spotify client ID', err);
  }
  if (!spotifyClientId) {
    if (listEl && !listEl.textContent) {
      listEl.textContent = 'Spotify client ID not configured.';
    }
    if (interestedListEl && !interestedListEl.childElementCount) {
      interestedListEl.innerHTML = '';
      const warning = document.createElement('p');
      warning.className = 'shows-empty';
      warning.textContent = 'Spotify client ID not configured.';
      interestedListEl.appendChild(warning);
    }
  }

  if (serverHasTicketmasterKey && apiKeyInput) {
    apiKeyInput.style.display = 'none';
  }

  const redirectUri = window.location.origin + window.location.pathname;

  const updateSpotifyStatus = () => {
    const storedToken =
      (typeof localStorage !== 'undefined' && localStorage.getItem('spotifyToken')) || '';
    if (tokenBtn) {
      tokenBtn.textContent = storedToken ? 'Reconnect Spotify' : 'Login to Spotify';
    }
    if (statusEl) {
      statusEl.textContent = storedToken ? 'Spotify connected' : 'Not connected';
      statusEl.classList.toggle('shows-spotify-status', Boolean(storedToken));
    }
  };

  if (statusEl) {
    statusEl.setAttribute('aria-live', 'polite');
  }

  updateSpotifyStatus();

  const startAuth = async () => {
    if (!spotifyClientId) {
      listEl.textContent = 'Spotify client ID not configured.';
      if (interestedListEl) {
        interestedListEl.innerHTML = '';
        const warning = document.createElement('p');
        warning.className = 'shows-empty';
        warning.textContent = 'Spotify client ID not configured.';
        interestedListEl.appendChild(warning);
      }
      return;
    }
    const verifier = randomString(64);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('spotifyCodeVerifier', verifier);
    }
    const challenge = await pkceChallenge(verifier);
    const authUrl =
      'https://accounts.spotify.com/authorize' +
      `?response_type=code&client_id=${encodeURIComponent(spotifyClientId)}` +
      `&scope=${encodeURIComponent('user-top-read')}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      '&code_challenge_method=S256' +
      `&code_challenge=${challenge}`;
    if (!window.__NO_SPOTIFY_REDIRECT) {
      try {
        window.location.href = authUrl;
      } catch (e) {
        // jsdom doesn't implement navigation; ignore
      }
    }
  };

  const params = new URLSearchParams(window.location.search);
  const authCode = params.get('code');
  if (authCode) {
    try {
      const verifier =
        (typeof localStorage !== 'undefined' && localStorage.getItem('spotifyCodeVerifier')) || '';
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        client_id: spotifyClientId,
        code_verifier: verifier
      });
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });
      if (res.ok) {
        const data = await res.json();
        const accessToken = data.access_token || '';
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('spotifyToken', accessToken);
        }
        updateSpotifyStatus();
      }
    } catch (err) {
      console.error('Failed to exchange code', err);
    } finally {
      window.history.replaceState({}, '', redirectUri);
    }
  }

  async function loadShows({ triggeredByUser = false } = {}) {
    if (triggeredByUser) setDiscoverButtonState(true);
    const stopLoading = () => {
      if (triggeredByUser) setDiscoverButtonState(false);
    };

    const { radiusMiles, artistLimit, includeSuggestions } = readConfigFromInputs();
    lastRequestedRadiusMiles = radiusMiles;

    const token =
      (typeof localStorage !== 'undefined' && localStorage.getItem('spotifyToken')) || '';
    const manualApiKey =
      apiKeyInput?.value.trim() ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('ticketmasterApiKey')) || '';
    const requiresManualApiKey = !serverHasTicketmasterKey;

    if (!token) {
      currentShows = [];
      currentSuggestions = [];
      showsEmptyReason = 'preview';
      renderShowsPreview(listEl, radiusMiles);
      if (interestedListEl) {
        interestedListEl.innerHTML = '';
        const prompt = document.createElement('p');
        prompt.className = 'shows-empty';
        prompt.textContent = 'Connect Spotify to start saving live music events.';
        interestedListEl.appendChild(prompt);
      }
      stopLoading();
      return;
    }

    if (requiresManualApiKey && !manualApiKey) {
      currentShows = [];
      currentSuggestions = [];
      listEl.textContent = 'Please enter your Ticketmaster API key.';
      stopLoading();
      return;
    }

    if (requiresManualApiKey && apiKeyInput?.value && typeof localStorage !== 'undefined') {
      localStorage.setItem('ticketmasterApiKey', manualApiKey);
    } else if (!requiresManualApiKey && typeof localStorage !== 'undefined') {
      localStorage.removeItem('ticketmasterApiKey');
    }

    listEl.innerHTML = '<em>Loading...</em>';
    try {
      const artistRes = await fetch(
        `https://api.spotify.com/v1/me/top/artists?limit=${artistLimit}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (artistRes.status === 401) {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('spotifyToken');
        }
        updateSpotifyStatus();
        renderShowsPreview(
          listEl,
          radiusMiles,
          'Spotify session expired. <strong>Login again</strong> to refresh your personalized shows.'
        );
        if (interestedListEl) {
          interestedListEl.innerHTML = '';
          const prompt = document.createElement('p');
          prompt.className = 'shows-empty';
          prompt.textContent = 'Connect Spotify to start saving live music events.';
          interestedListEl.appendChild(prompt);
        }
        return;
      }
      if (!artistRes.ok) throw new Error(`Spotify HTTP ${artistRes.status}`);
      const artistData = await artistRes.json();
      const artists = artistData.items || [];
      if (artists.length === 0) {
        currentShows = [];
        currentSuggestions = [];
        listEl.innerHTML =
          '<p class="shows-empty">Spotify did not return any top artists yet. Listen to a few artists and try again.</p>';
        return;
      }

      const userLocation = await getUserLocation({ allowRetry: triggeredByUser });
      if (!userLocation) {
        currentShows = [];
        currentSuggestions = [];
        listEl.innerHTML =
          `<p class="shows-empty">Allow location access to see shows within ${Math.round(
            radiusMiles
          )} miles.</p>`;
        return;
      }

      const eventsMap = new Map();
      let eventCounter = 0;
      const apiBase =
        API_BASE_URL && API_BASE_URL !== 'null'
          ? API_BASE_URL.replace(/\/$/, '')
          : '';
      for (const artist of artists) {
        const params = new URLSearchParams({ keyword: artist.name });
        if (requiresManualApiKey) {
          params.set('apiKey', manualApiKey);
        }
        const tmUrl = `${apiBase}/api/ticketmaster?${params.toString()}`;
        const cacheScope = requiresManualApiKey ? 'manual' : 'server';
        let data = getCachedTicketmasterResponse(artist.name, cacheScope);
        if (!data) {
          const res = await fetch(tmUrl);
          if (!res.ok) {
            if (res.status === 429) {
              console.warn('Ticketmaster rate limit reached for', artist.name);
              data = getStaleTicketmasterResponse(artist.name, cacheScope);
              if (!data) {
                continue;
              }
            } else {
              continue;
            }
          }
          if (!data) {
            data = await res.json();
            setCachedTicketmasterResponse(artist.name, data, cacheScope);
          }
        }
        const events = data._embedded?.events;
        if (!Array.isArray(events)) continue;
        for (const ev of events) {
          const venue = ev._embedded?.venues?.[0];
          const lat = Number.parseFloat(venue?.location?.latitude);
          const lon = Number.parseFloat(venue?.location?.longitude);
          let distance = null;
          if (
            userLocation &&
            Number.isFinite(lat) &&
            Number.isFinite(lon)
          ) {
            distance = calculateDistanceMiles(
              userLocation.latitude,
              userLocation.longitude,
              lat,
              lon
            );
          }
          if (Number.isFinite(distance) && distance > radiusMiles) {
            continue;
          }
          if (distance == null) {
            continue;
          }
          const eventKey =
            ev.id ||
            `${artist.id || artist.name || 'artist'}-${ev.url || ev.name || eventCounter}`;
          if (!eventsMap.has(eventKey)) {
            eventsMap.set(eventKey, {
              id: eventKey,
              event: ev,
              venue,
              distance,
              order: eventCounter++
            });
          }
        }
      }

      if (eventsMap.size > 0) {
        const events = Array.from(eventsMap.values());
        if (cachedUserLocation) {
          events.sort((a, b) => {
            const aDist = a.distance;
            const bDist = b.distance;
            if (aDist == null && bDist == null) return a.order - b.order;
            if (aDist == null) return 1;
            if (bDist == null) return -1;
            if (aDist === bDist) return a.order - b.order;
            return aDist - bDist;
          });
        }
        currentShows = events;
        currentSuggestions = [];
        showsEmptyReason = null;
        renderShowsList();
      } else {
        currentShows = [];
        showsEmptyReason = 'noNearby';
        try {
          currentSuggestions = includeSuggestions
            ? await fetchSpotifySuggestions(token, artists)
            : [];
        } catch (err) {
          console.warn('Failed to load Spotify suggestions', err);
          currentSuggestions = [];
        }
        renderShowsList();
      }
    } catch (err) {
      console.error('Failed to load shows', err);
      currentShows = [];
      currentSuggestions = [];
      listEl.textContent = 'Failed to load shows.';
    } finally {
      stopLoading();
    }
  }

  tokenBtn?.addEventListener('click', startAuth);

  if (discoverBtn) {
    if (discoverBtn._showsClickHandler) {
      discoverBtn.removeEventListener('click', discoverBtn._showsClickHandler);
    }
    const handler = () => {
      loadShows({ triggeredByUser: true });
    };
    discoverBtn._showsClickHandler = handler;
    discoverBtn.addEventListener('click', handler);
  }

  await loadShows();
}

window.initShowsPanel = initShowsPanel;
