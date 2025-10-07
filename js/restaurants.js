const API_BASE_URL =
  (typeof window !== 'undefined' && window.apiBaseUrl) ||
  (typeof process !== 'undefined' && process.env.API_BASE_URL) ||
  (typeof window !== 'undefined' && window.location?.origin) ||
  'https://us-central1-decision-maker-4e1d3.cloudfunctions.net';

let initialized = false;
let mapInstance = null;
let mapMarkersLayer = null;

const STORAGE_KEYS = {
  saved: 'restaurants:saved',
  hidden: 'restaurants:hidden'
};

let savedRestaurants = [];
let hiddenRestaurants = [];
let nearbyRestaurants = [];
let visibleNearbyRestaurants = [];
let currentView = 'nearby';
let isFetchingNearby = false;

const domRefs = {
  resultsRoot: null,
  nearbyContainer: null,
  savedContainer: null,
  hiddenContainer: null,
  tabButtons: []
};

const MAX_DISTANCE_METERS = 160934; // ~100 miles

function buildRestaurantsUrl(params) {
  const query = params.toString();
  const rawBase =
    API_BASE_URL && API_BASE_URL !== 'null' ? API_BASE_URL : '';
  if (!rawBase) {
    return `/api/restaurants?${query}`;
  }
  const trimmedBase = rawBase.replace(/\/$/, '');
  if (trimmedBase.endsWith('/api/restaurants') || trimmedBase.endsWith('/restaurantsProxy')) {
    return `${trimmedBase}?${query}`;
  }
  if (trimmedBase.endsWith('/api')) {
    return `${trimmedBase}/restaurants?${query}`;
  }
  if (/cloudfunctions\.net/i.test(trimmedBase)) {
    return `${trimmedBase}/restaurantsProxy?${query}`;
  }
  return `${trimmedBase}/api/restaurants?${query}`;
}

function normalizeId(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function sanitizeRestaurant(rest) {
  if (!rest || typeof rest !== 'object') return null;
  const allowedKeys = [
    'id',
    'name',
    'address',
    'city',
    'state',
    'zip',
    'phone',
    'rating',
    'reviewCount',
    'price',
    'categories',
    'cuisine',
    'latitude',
    'longitude',
    'url',
    'website',
    'distance'
  ];
  const sanitized = {};
  allowedKeys.forEach(key => {
    if (key in rest) {
      sanitized[key] = rest[key];
    }
  });
  return Object.keys(sanitized).length ? sanitized : null;
}

function dedupeRestaurants(items = []) {
  const map = new Map();
  items.forEach(item => {
    const sanitized = sanitizeRestaurant(item);
    const id = normalizeId(sanitized?.id);
    if (!id) return;
    map.set(id, sanitized);
  });
  return Array.from(map.values());
}

function readStoredList(key) {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupeRestaurants(parsed);
  } catch {
    return [];
  }
}

function writeStoredList(key, list) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {}
}

function loadStoredState() {
  savedRestaurants = dedupeRestaurants(readStoredList(STORAGE_KEYS.saved));
  hiddenRestaurants = dedupeRestaurants(readStoredList(STORAGE_KEYS.hidden));
}

function persistSaved() {
  writeStoredList(STORAGE_KEYS.saved, savedRestaurants);
}

function persistHidden() {
  writeStoredList(STORAGE_KEYS.hidden, hiddenRestaurants);
}

function isSaved(id) {
  const normalized = normalizeId(id);
  if (!normalized) return false;
  return savedRestaurants.some(item => normalizeId(item.id) === normalized);
}

function isHidden(id) {
  const normalized = normalizeId(id);
  if (!normalized) return false;
  return hiddenRestaurants.some(item => normalizeId(item.id) === normalized);
}

function setSavedRestaurants(items) {
  savedRestaurants = dedupeRestaurants(items);
  persistSaved();
}

function setHiddenRestaurants(items) {
  hiddenRestaurants = dedupeRestaurants(items);
  persistHidden();
}

function updateSaveButtonState(button, restId) {
  if (!button) return;
  const saved = isSaved(restId);
  button.textContent = saved ? 'Saved' : 'Save';
  button.classList.toggle('is-active', saved);
  button.setAttribute('aria-pressed', saved ? 'true' : 'false');
}

function toggleSaved(rest) {
  if (!rest) return;
  const id = normalizeId(rest.id);
  if (!id) return;
  const existingIndex = savedRestaurants.findIndex(item => normalizeId(item.id) === id);
  if (existingIndex >= 0) {
    savedRestaurants.splice(existingIndex, 1);
  } else {
    const sanitized = sanitizeRestaurant(rest);
    if (sanitized) {
      savedRestaurants.push(sanitized);
    }
  }
  setSavedRestaurants(savedRestaurants);
  renderAll();
}

function hideRestaurant(rest) {
  if (!rest) return;
  const id = normalizeId(rest.id);
  if (!id) return;
  if (!isHidden(id)) {
    const sanitized = sanitizeRestaurant(rest);
    if (sanitized) {
      hiddenRestaurants.push(sanitized);
      setHiddenRestaurants(hiddenRestaurants);
    }
  }
  if (isSaved(id)) {
    setSavedRestaurants(savedRestaurants.filter(item => normalizeId(item.id) !== id));
  }
  renderAll();
}

function restoreRestaurant(restId) {
  const id = normalizeId(restId);
  if (!id) return;
  if (!hiddenRestaurants.length) return;
  const filtered = hiddenRestaurants.filter(item => normalizeId(item.id) !== id);
  if (filtered.length === hiddenRestaurants.length) return;
  setHiddenRestaurants(filtered);
  renderAll();
}

function parseCoordinate(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return NaN;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function ensureMap() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (typeof window.L === 'undefined') return null;
  const mapElement = document.getElementById('restaurantsMap');
  if (!mapElement) return null;

  if (!mapInstance) {
    mapInstance = window.L.map(mapElement, {
      scrollWheelZoom: false
    });
    window.L
      .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      })
      .addTo(mapInstance);
  }

  if (!mapMarkersLayer) {
    mapMarkersLayer = window.L.layerGroup().addTo(mapInstance);
  }

  setTimeout(() => {
    try {
      mapInstance.invalidateSize();
    } catch {}
  }, 0);

  return mapInstance;
}

function clearMap() {
  if (mapMarkersLayer) {
    mapMarkersLayer.clearLayers();
  }
  const mapElement =
    typeof document !== 'undefined' ? document.getElementById('restaurantsMap') : null;
  if (mapElement) {
    mapElement.classList.add('restaurants-map--empty');
  }
  if (mapInstance) {
    try {
      mapInstance.setView([39.5, -98.35], 4);
    } catch {}
  }
}

function renderLoading(container) {
  ensureMap();
  container.innerHTML = '<div class="restaurants-message">Loading nearby restaurants…</div>';
}

function renderMessage(container, message) {
  ensureMap();
  container.innerHTML = `<div class="restaurants-message">${message}</div>`;
}

function formatDistance(meters) {
  if (typeof meters !== 'number' || Number.isNaN(meters)) return '';
  const miles = meters / 1609.344;
  if (!Number.isFinite(miles)) return '';
  const precision = miles >= 10 ? 0 : 1;
  return `${miles.toFixed(precision)} mi`;
}

function formatRating(rating) {
  const numeric = typeof rating === 'number' ? rating : Number(rating);
  if (!Number.isFinite(numeric)) return '';
  return numeric.toFixed(1).replace(/\.0$/, '');
}

function sanitizePhone(phone) {
  if (typeof phone !== 'string') return '';
  const trimmed = phone.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return '';
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

function createRatingBadge(rating, reviewCount) {
  const displayRating = formatRating(rating);
  if (!displayRating) return null;

  const badge = document.createElement('span');
  badge.className = 'rating-badge';

  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '★';
  badge.appendChild(icon);

  const score = document.createElement('span');
  score.textContent = displayRating;
  badge.appendChild(score);

  if (typeof reviewCount === 'number' && reviewCount > 0) {
    const reviews = document.createElement('span');
    reviews.textContent = `(${reviewCount})`;
    badge.appendChild(reviews);
    badge.setAttribute(
      'aria-label',
      `Rated ${displayRating} out of 5 based on ${reviewCount} reviews`
    );
    badge.title = `Rated ${displayRating} out of 5 from ${reviewCount} reviews`;
  } else {
    badge.setAttribute('aria-label', `Rated ${displayRating} out of 5`);
    badge.title = `Rated ${displayRating} out of 5`;
  }

  return badge;
}

function createAddress(rest) {
  const lines = [];
  if (rest.address) lines.push(rest.address);

  const localityParts = [rest.city, rest.state].filter(Boolean).join(', ');
  const postalLine = [localityParts, rest.zip].filter(Boolean).join(' ');
  if (postalLine.trim()) lines.push(postalLine.trim());

  if (!lines.length) return null;

  const address = document.createElement('p');
  address.className = 'restaurant-card__address';
  lines.forEach((line, index) => {
    if (!line) return;
    if (index > 0) {
      address.appendChild(document.createElement('br'));
    }
    address.appendChild(document.createTextNode(line));
  });
  return address;
}

function createMetaList(rest) {
  const meta = document.createElement('ul');
  meta.className = 'restaurant-meta';

  if (rest.price) {
    const price = document.createElement('li');
    price.textContent = `Price: ${rest.price}`;
    meta.appendChild(price);
  }

  if (rest.phone) {
    const phone = document.createElement('li');
    phone.textContent = `Phone: ${rest.phone}`;
    meta.appendChild(phone);
  }

  return meta.childNodes.length ? meta : null;
}

function createCuisineChips(rest) {
  const categories = Array.isArray(rest.categories)
    ? rest.categories.filter(Boolean)
    : rest.cuisine
      ? [rest.cuisine]
      : [];
  if (!categories.length) return null;

  const chips = document.createElement('div');
  chips.className = 'restaurant-chips';
  categories.slice(0, 6).forEach(category => {
    const chip = document.createElement('span');
    chip.className = 'restaurant-chip';
    chip.textContent = category;
    chips.appendChild(chip);
  });
  return chips;
}

function createActions(rest) {
  const actions = document.createElement('div');
  actions.className = 'restaurant-actions';

  const href = typeof rest.url === 'string' && rest.url
    ? rest.url
    : typeof rest.website === 'string'
      ? rest.website
      : '';
  if (href) {
    const normalized = href.startsWith('http') ? href : `https://${href}`;
    const websiteLink = document.createElement('a');
    websiteLink.href = normalized;
    websiteLink.target = '_blank';
    websiteLink.rel = 'noopener noreferrer';
    websiteLink.className = 'restaurant-action';
    websiteLink.textContent = href.includes('yelp.com') ? 'View on Yelp' : 'View Website';
    actions.appendChild(websiteLink);
  }

  const lat = parseCoordinate(rest.latitude);
  const lng = parseCoordinate(rest.longitude);
  let directionsHref = '';
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    directionsHref = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  } else if (rest.address) {
    directionsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      rest.address
    )}`;
  }
  if (directionsHref) {
    const directions = document.createElement('a');
    directions.href = directionsHref;
    directions.target = '_blank';
    directions.rel = 'noopener noreferrer';
    directions.className = 'restaurant-action';
    directions.textContent = 'Directions';
    actions.appendChild(directions);
  }

  const phone = sanitizePhone(rest.phone);
  if (phone) {
    const call = document.createElement('a');
    call.href = `tel:${phone}`;
    call.className = 'restaurant-action';
    call.textContent = 'Call';
    actions.appendChild(call);
  }

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'restaurant-action restaurant-action--secondary';
  updateSaveButtonState(saveButton, rest.id);
  saveButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleSaved(rest);
  });
  actions.appendChild(saveButton);

  const hideButton = document.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'restaurant-action restaurant-action--danger';
  hideButton.textContent = 'Hide Forever';
  hideButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    hideRestaurant(rest);
  });
  actions.appendChild(hideButton);

  return actions;
}

function createRestaurantCard(rest) {
  const card = document.createElement('article');
  card.className = 'restaurant-card';

  const header = document.createElement('div');
  header.className = 'restaurant-card__header';

  const title = document.createElement('h3');
  title.textContent = rest.name || 'Unnamed Restaurant';
  header.appendChild(title);

  const ratingBadge = createRatingBadge(rest.rating, rest.reviewCount);
  if (ratingBadge) header.appendChild(ratingBadge);

  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'restaurant-card__body';

  const address = createAddress(rest);
  if (address) body.appendChild(address);

  const meta = createMetaList(rest);
  if (meta) body.appendChild(meta);

  const chips = createCuisineChips(rest);
  if (chips) body.appendChild(chips);

  card.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'restaurant-card__footer';

  const distanceText = formatDistance(rest.distance);
  if (distanceText) {
    const distance = document.createElement('span');
    distance.className = 'restaurant-distance';
    distance.textContent = distanceText;
    footer.appendChild(distance);
  }

  const actions = createActions(rest);
  if (actions) footer.appendChild(actions);

  if (footer.childNodes.length) {
    card.appendChild(footer);
  }

  return card;
}

function updateMap(items = []) {
  if (!items || !items.length) {
    clearMap();
    return;
  }

  const map = ensureMap();
  if (!map || !mapMarkersLayer) return;

  mapMarkersLayer.clearLayers();

  const bounds = [];
  items.forEach(rest => {
    const lat = parseCoordinate(rest.latitude);
    const lng = parseCoordinate(rest.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const marker = window.L.marker([lat, lng]);
    const popupLines = [`<strong>${rest.name || 'Restaurant'}</strong>`];
    const rating = formatRating(rest.rating);
    if (rating) {
      const reviews =
        typeof rest.reviewCount === 'number' && rest.reviewCount > 0
          ? ` (${rest.reviewCount})`
          : '';
      popupLines.push(`Rating: ${rating}${reviews}`);
    }
    if (rest.address) {
      popupLines.push(rest.address);
    }
    marker.bindPopup(popupLines.join('<br>'));
    marker.addTo(mapMarkersLayer);
    bounds.push([lat, lng]);
  });

  const mapElement = document.getElementById('restaurantsMap');
  if (mapElement) {
    if (bounds.length) {
      mapElement.classList.remove('restaurants-map--empty');
    } else {
      mapElement.classList.add('restaurants-map--empty');
    }
  }

  if (!bounds.length) {
    clearMap();
    return;
  }

  if (bounds.length === 1) {
    map.setView(bounds[0], 14);
  } else {
    const layerBounds = window.L.latLngBounds(bounds);
    map.fitBounds(layerBounds, { padding: [24, 24], maxZoom: 15 });
  }
}

function computeRatingScore(rest) {
  if (!rest) return -Infinity;

  const rawRating =
    typeof rest.rating === 'number'
      ? rest.rating
      : typeof rest.rating === 'string'
        ? Number(rest.rating)
        : NaN;
  const rating = Number.isFinite(rawRating) ? rawRating : -Infinity;
  if (!Number.isFinite(rating)) return -Infinity;

  const rawReviews =
    typeof rest.reviewCount === 'number'
      ? rest.reviewCount
      : typeof rest.reviewCount === 'string'
        ? Number(rest.reviewCount)
        : 0;
  const reviewCount = Number.isFinite(rawReviews) && rawReviews > 0 ? rawReviews : 0;

  if (!reviewCount) {
    return rating;
  }

  const reviewBoost = Math.min(0.3, Math.log10(reviewCount + 1) * 0.1);
  return rating + reviewBoost;
}

function sortByRating(items) {
  return [...items].sort((a, b) => {
    const scoreA = computeRatingScore(a);
    const scoreB = computeRatingScore(b);
    if (scoreA === scoreB) {
      const ratingA = typeof a.rating === 'number' ? a.rating : -Infinity;
      const ratingB = typeof b.rating === 'number' ? b.rating : -Infinity;
      if (ratingA === ratingB) {
        const reviewsA = typeof a.reviewCount === 'number' ? a.reviewCount : -Infinity;
        const reviewsB = typeof b.reviewCount === 'number' ? b.reviewCount : -Infinity;
        return reviewsB - reviewsA;
      }
      return ratingB - ratingA;
    }
    return scoreB - scoreA;
  });
}

function filterByDistance(items, maxDistance) {
  if (!Array.isArray(items) || !items.length) return [];
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) return items;

  const nearby = items.filter(item => {
    const distance = typeof item.distance === 'number' ? item.distance : NaN;
    return Number.isFinite(distance) && distance <= maxDistance;
  });

  return nearby.length ? nearby : items;
}

function renderRestaurantsList(container, items, emptyMessage) {
  if (!container) return;
  const list = Array.isArray(items) ? items : [];
  container.innerHTML = '';

  if (!list.length) {
    const message = document.createElement('div');
    message.className = 'restaurants-message';
    message.textContent = emptyMessage;
    container.appendChild(message);
    return;
  }

  ensureMap();

  const grid = document.createElement('div');
  grid.className = 'restaurants-grid';

  list.forEach(rest => {
    const card = createRestaurantCard(rest);
    grid.appendChild(card);
  });

  container.appendChild(grid);
}

function renderNearbySection() {
  const container = domRefs.nearbyContainer;
  if (!container) return;
  if (isFetchingNearby && !nearbyRestaurants.length) return;
  visibleNearbyRestaurants = nearbyRestaurants.filter(rest => !isHidden(rest.id));
  renderRestaurantsList(container, visibleNearbyRestaurants, 'No restaurants found.');
}

function renderSavedSection() {
  const container = domRefs.savedContainer;
  if (!container) return;
  let list = savedRestaurants;
  const filtered = list.filter(rest => !isHidden(rest.id));
  if (filtered.length !== list.length) {
    setSavedRestaurants(filtered);
    list = savedRestaurants;
  }
  renderRestaurantsList(container, list, 'No saved restaurants yet.');
}

function renderHiddenSection() {
  const container = domRefs.hiddenContainer;
  if (!container) return;
  container.innerHTML = '';
  if (!hiddenRestaurants.length) {
    container.classList.remove('is-visible');
    return;
  }

  container.classList.add('is-visible');

  const heading = document.createElement('h4');
  heading.textContent = 'Hidden Restaurants';
  container.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'restaurants-hidden-list';

  hiddenRestaurants.forEach(rest => {
    const item = document.createElement('div');
    item.className = 'restaurants-hidden-item';

    const name = document.createElement('span');
    name.className = 'restaurants-hidden-name';
    name.textContent = rest.name || 'Unnamed Restaurant';
    item.appendChild(name);

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Restore';
    button.addEventListener('click', () => {
      restoreRestaurant(rest.id);
    });
    item.appendChild(button);

    list.appendChild(item);
  });

  container.appendChild(list);
}

function updateMapForCurrentView() {
  if (currentView === 'saved') {
    updateMap(savedRestaurants);
  } else if (isFetchingNearby && !nearbyRestaurants.length) {
    clearMap();
  } else {
    updateMap(visibleNearbyRestaurants);
  }
}

function renderAll() {
  renderNearbySection();
  renderSavedSection();
  renderHiddenSection();
  updateMapForCurrentView();
}

function setActiveView(view) {
  const targetView = view === 'saved' ? 'saved' : 'nearby';
  currentView = targetView;
  domRefs.tabButtons.forEach(button => {
    const isActive = button.dataset.view === targetView;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  if (domRefs.nearbyContainer) {
    domRefs.nearbyContainer.hidden = targetView !== 'nearby';
  }
  if (domRefs.savedContainer) {
    domRefs.savedContainer.hidden = targetView !== 'saved';
  }
  updateMapForCurrentView();
}

async function reverseGeocodeCity(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(latitude),
    lon: String(longitude)
  });
  const url = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    });
    if (!res.ok) return '';
    const data = await res.json();
    const address = data?.address || {};
    return (
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.locality ||
      address.county ||
      ''
    );
  } catch (err) {
    console.warn('Reverse geocoding failed', err);
    return '';
  }
}

async function fetchRestaurants({ latitude, longitude, city }) {
  const params = new URLSearchParams();
  const parsedLatitude =
    typeof latitude === 'string' ? Number(latitude) : latitude;
  const parsedLongitude =
    typeof longitude === 'string' ? Number(longitude) : longitude;
  const hasLatitude = Number.isFinite(parsedLatitude);
  const hasLongitude = Number.isFinite(parsedLongitude);

  if (hasLatitude && hasLongitude) {
    params.set('latitude', String(parsedLatitude));
    params.set('longitude', String(parsedLongitude));
  }
  if (city) {
    params.set('city', String(city));
  }

  const url = buildRestaurantsUrl(params);
  const res = await fetch(url);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message = errBody?.error || `Request failed: ${res.status}`;
    throw new Error(message);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject);
  });
}

async function loadNearbyRestaurants(container) {
  const targetContainer = container || domRefs.nearbyContainer;
  if (!targetContainer) return;

  isFetchingNearby = true;
  renderMessage(targetContainer, 'Requesting your location…');
  clearMap();

  let position;
  try {
    position = await getCurrentPosition();
  } catch (err) {
    console.error('Geolocation error', err);
    isFetchingNearby = false;
    nearbyRestaurants = [];
    visibleNearbyRestaurants = [];
    if (err && typeof err.code === 'number' && err.code === 1) {
      renderMessage(targetContainer, 'Location access is required to show nearby restaurants.');
    } else {
      renderMessage(targetContainer, 'Unable to determine your location.');
    }
    updateMapForCurrentView();
    return;
  }

  renderLoading(targetContainer);

  try {
    const { latitude, longitude } = position.coords;
    const city = await reverseGeocodeCity(latitude, longitude);
    const data = await fetchRestaurants({ latitude, longitude, city });
    const nearby = filterByDistance(data, MAX_DISTANCE_METERS);
    const sorted = sortByRating(nearby);
    nearbyRestaurants = sorted;
    isFetchingNearby = false;
    renderAll();
  } catch (err) {
    console.error('Restaurant search failed', err);
    isFetchingNearby = false;
    nearbyRestaurants = [];
    visibleNearbyRestaurants = [];
    const message = err?.message || 'Failed to load restaurants.';
    renderMessage(targetContainer, message);
    renderSavedSection();
    renderHiddenSection();
    updateMapForCurrentView();
  }
}

export async function initRestaurantsPanel() {
  if (initialized) return;
  initialized = true;

  const resultsContainer = document.getElementById('restaurantsResults');
  if (!resultsContainer) return;

  domRefs.resultsRoot = resultsContainer;
  domRefs.nearbyContainer = document.getElementById('restaurantsNearby');
  domRefs.savedContainer = document.getElementById('restaurantsSaved');
  domRefs.hiddenContainer = document.getElementById('restaurantsHiddenSection');
  domRefs.tabButtons = Array.from(resultsContainer.querySelectorAll('.restaurants-tab'));

  loadStoredState();

  domRefs.tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      setActiveView(button.dataset.view);
    });
  });

  renderSavedSection();
  renderHiddenSection();
  setActiveView(currentView);

  await loadNearbyRestaurants(domRefs.nearbyContainer);
}

if (typeof window !== 'undefined') {
  loadStoredState();
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEYS.saved) {
      savedRestaurants = dedupeRestaurants(readStoredList(STORAGE_KEYS.saved));
      renderSavedSection();
      updateMapForCurrentView();
    } else if (event.key === STORAGE_KEYS.hidden) {
      hiddenRestaurants = dedupeRestaurants(readStoredList(STORAGE_KEYS.hidden));
      renderHiddenSection();
      renderNearbySection();
      updateMapForCurrentView();
    }
  });
  window.initRestaurantsPanel = initRestaurantsPanel;
  window.dispatchEvent(new Event('restaurantsPanelReady'));
}
