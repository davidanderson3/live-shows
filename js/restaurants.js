import { API_BASE_URL, DEFAULT_REMOTE_API_BASE } from './config.js';

const FALLBACK_API_BASE = DEFAULT_REMOTE_API_BASE;

const TARGET_NEARBY_RESULTS = 60;
const MAX_NEARBY_RESULTS = 200;
const NEARBY_RESULTS_INCREMENT = 40;
const NEARBY_RADIUS_STEPS_MILES = [null, 25];

let initialized = false;
let mapInstance = null;
let mapMarkersLayer = null;
let mapMarkersById = new Map();
let activeMarkerKey = '';
let activeRestaurantCard = null;

const STORAGE_KEYS = {
  saved: 'restaurants:saved',
  favorites: 'restaurants:favorites',
  hidden: 'restaurants:hidden'
};

let savedRestaurants = [];
let favoriteRestaurants = [];
let hiddenRestaurants = [];
let isHiddenRestaurantsExpanded = false;
let nearbyRestaurants = [];
let visibleNearbyRestaurants = [];
let rawNearbyRestaurants = [];
let requestedNearbyLimit = TARGET_NEARBY_RESULTS;
let lastNearbyFetchOptions = null;
let currentView = 'nearby';
let isFetchingNearby = false;
let userLocation = null;
let nearbyRadiusIndex = 0;

const domRefs = {
  resultsRoot: null,
  nearbyContainer: null,
  savedContainer: null,
  favoritesContainer: null,
  hiddenContainer: null,
  tabButtons: []
};

function buildRestaurantsUrl(params) {
  const query = params.toString();
  const rawBase =
    API_BASE_URL && API_BASE_URL !== 'null' ? API_BASE_URL : '';
  if (!rawBase) {
    const fallbackBase = FALLBACK_API_BASE.replace(/\/$/, '');
    return `${fallbackBase}/restaurantsProxy?${query}`;
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

function resolveNearbyLimit(limit) {
  const raw = typeof limit === 'string' ? Number(limit) : limit;
  const numeric = Number.isFinite(raw) ? Math.floor(raw) : TARGET_NEARBY_RESULTS;
  if (numeric <= 0) return TARGET_NEARBY_RESULTS;
  return Math.min(numeric, MAX_NEARBY_RESULTS);
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
  savedRestaurants = sortByDistance(
    dedupeRestaurants(readStoredList(STORAGE_KEYS.saved))
  );
  favoriteRestaurants = sortByDistance(
    dedupeRestaurants(readStoredList(STORAGE_KEYS.favorites))
  );
  hiddenRestaurants = dedupeRestaurants(readStoredList(STORAGE_KEYS.hidden));
  syncFavoritesWithSaved();
}

function persistSaved() {
  writeStoredList(STORAGE_KEYS.saved, savedRestaurants);
}

function persistFavorites() {
  writeStoredList(STORAGE_KEYS.favorites, favoriteRestaurants);
}

function persistHidden() {
  writeStoredList(STORAGE_KEYS.hidden, hiddenRestaurants);
}

function isSaved(id) {
  const normalized = normalizeId(id);
  if (!normalized) return false;
  return savedRestaurants.some(item => normalizeId(item.id) === normalized);
}

function isFavorite(id) {
  const normalized = normalizeId(id);
  if (!normalized) return false;
  return favoriteRestaurants.some(item => normalizeId(item.id) === normalized);
}

function isHidden(id) {
  const normalized = normalizeId(id);
  if (!normalized) return false;
  return hiddenRestaurants.some(item => normalizeId(item.id) === normalized);
}

function setSavedRestaurants(items) {
  savedRestaurants = sortByDistance(dedupeRestaurants(items));
  persistSaved();
  syncFavoritesWithSaved();
}

function setFavoriteRestaurants(items) {
  favoriteRestaurants = sortByDistance(dedupeRestaurants(items));
  persistFavorites();
  syncFavoritesWithSaved();
}

function setHiddenRestaurants(items) {
  hiddenRestaurants = dedupeRestaurants(items);
  persistHidden();
  syncFavoritesWithSaved();
}

function updateSaveButtonState(button, restId) {
  if (!button) return;
  const saved = isSaved(restId);
  button.textContent = saved ? 'Saved' : 'Save';
  button.classList.toggle('is-active', saved);
  button.setAttribute('aria-pressed', saved ? 'true' : 'false');
}

function updateFavoriteButtonState(button, restId) {
  if (!button) return;
  const favorite = isFavorite(restId);
  button.textContent = favorite ? 'Favorited' : 'Favorite';
  button.classList.toggle('is-active', favorite);
  button.setAttribute('aria-pressed', favorite ? 'true' : 'false');
}

function syncFavoritesWithSaved() {
  const savedIds = new Set(
    savedRestaurants
      .map(item => normalizeId(item.id))
      .filter(id => typeof id === 'string' && id)
  );
  const filtered = favoriteRestaurants.filter(item => {
    const id = normalizeId(item.id);
    return id && savedIds.has(id) && !isHidden(id);
  });
  if (filtered.length !== favoriteRestaurants.length) {
    favoriteRestaurants = filtered;
    persistFavorites();
  }
}

function toggleSaved(rest) {
  if (!rest) return;
  const id = normalizeId(rest.id);
  if (!id) return;
  const existingIndex = savedRestaurants.findIndex(item => normalizeId(item.id) === id);
  if (existingIndex >= 0) {
    savedRestaurants.splice(existingIndex, 1);
    const filteredFavorites = favoriteRestaurants.filter(
      item => normalizeId(item.id) !== id
    );
    if (filteredFavorites.length !== favoriteRestaurants.length) {
      setFavoriteRestaurants(filteredFavorites);
    }
  } else {
    const sanitized = sanitizeRestaurant(rest);
    if (sanitized) {
      savedRestaurants.push(sanitized);
    }
  }
  setSavedRestaurants(savedRestaurants);
  renderAll();
}

function toggleFavorite(rest) {
  if (!rest) return;
  const id = normalizeId(rest.id);
  if (!id) return;
  const existingIndex = favoriteRestaurants.findIndex(
    item => normalizeId(item.id) === id
  );
  if (existingIndex >= 0) {
    const updatedFavorites = favoriteRestaurants.filter(
      item => normalizeId(item.id) !== id
    );
    setFavoriteRestaurants(updatedFavorites);
  } else {
    const sanitized = sanitizeRestaurant(rest);
    if (!sanitized) return;
    if (!isSaved(id)) {
      setSavedRestaurants([...savedRestaurants, sanitized]);
    }
    setFavoriteRestaurants([...favoriteRestaurants, sanitized]);
  }
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
  if (isFavorite(id)) {
    setFavoriteRestaurants(
      favoriteRestaurants.filter(item => normalizeId(item.id) !== id)
    );
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

function setUserLocation(latitude, longitude) {
  const lat = parseCoordinate(latitude);
  const lon = parseCoordinate(longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    userLocation = { latitude: lat, longitude: lon };
  } else {
    userLocation = null;
  }
}

function clearUserLocation() {
  userLocation = null;
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function computeHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function computeDistanceFromUser(rest) {
  if (!userLocation) return null;
  const lat = parseCoordinate(rest.latitude);
  const lon = parseCoordinate(rest.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return computeHaversineDistanceMeters(userLocation.latitude, userLocation.longitude, lat, lon);
}

function normalizeRestaurant(item) {
  const sanitized = sanitizeRestaurant(item);
  if (!sanitized) return null;

  const normalized = { ...sanitized };
  const computedDistance = computeDistanceFromUser(sanitized);
  const providedDistance = getDistanceValue(item);
  const sanitizedDistance = getDistanceValue(sanitized);
  const distanceValue = Number.isFinite(computedDistance)
    ? computedDistance
    : Number.isFinite(providedDistance)
      ? providedDistance
      : Number.isFinite(sanitizedDistance)
        ? sanitizedDistance
        : null;

  if (Number.isFinite(distanceValue)) {
    normalized.distance = distanceValue;
  } else {
    delete normalized.distance;
  }

  return normalized;
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
  mapMarkersById.clear();
  activeMarkerKey = '';
  setActiveRestaurantCard(null);
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

function getMarkerKey(rest) {
  if (!rest) return '';
  const id = normalizeId(rest.id);
  if (id) return id;
  const lat = parseCoordinate(rest.latitude);
  const lng = parseCoordinate(rest.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat},${lng}`;
  }
  return '';
}

function findRestaurantCardByKey(key) {
  if (!key || typeof document === 'undefined') return null;
  const cards = document.querySelectorAll('.restaurant-card');
  for (const card of cards) {
    if (card.dataset.restaurantId === key) {
      return card;
    }
  }
  return null;
}

function setActiveRestaurantCard(card) {
  if (!card || !card.isConnected) {
    if (activeRestaurantCard && activeRestaurantCard.isConnected) {
      activeRestaurantCard.classList.remove('is-active');
    }
    activeRestaurantCard = null;
    return;
  }

  if (activeRestaurantCard && activeRestaurantCard !== card && activeRestaurantCard.isConnected) {
    activeRestaurantCard.classList.remove('is-active');
  }

  card.classList.add('is-active');
  activeRestaurantCard = card;
}

function highlightMapMarker(key, { pan = true, openPopup = true } = {}) {
  if (!key) return;
  const marker = mapMarkersById.get(key);
  if (!marker) return;

  if (activeMarkerKey && activeMarkerKey !== key) {
    const previousMarker = mapMarkersById.get(activeMarkerKey);
    if (previousMarker) {
      const previousElement = previousMarker.getElement();
      if (previousElement) {
        previousElement.classList.remove('is-active');
      }
    }
  }

  activeMarkerKey = key;

  const element = marker.getElement();
  if (element) {
    element.classList.add('is-active');
  } else {
    marker.once('add', () => {
      const el = marker.getElement();
      if (el) {
        el.classList.add('is-active');
      }
    });
  }

  if (openPopup && typeof marker.openPopup === 'function') {
    marker.openPopup();
  }

  const map = ensureMap();
  if (pan && map) {
    try {
      map.panTo(marker.getLatLng(), { animate: true });
    } catch {}
  }
}

function activateRestaurant(key, { card, pan = true, openPopup = true, updateCard = true } = {}) {
  if (!key) return;

  if (updateCard) {
    const targetCard = card || findRestaurantCardByKey(key);
    setActiveRestaurantCard(targetCard);
  }

  highlightMapMarker(key, { pan, openPopup });
}

function refreshActiveMarkerHighlight() {
  if (!activeMarkerKey) return;
  if (!mapMarkersById.has(activeMarkerKey)) {
    setActiveRestaurantCard(null);
    return;
  }
  const card = findRestaurantCardByKey(activeMarkerKey);
  activateRestaurant(activeMarkerKey, {
    card,
    pan: false,
    openPopup: false
  });
}

function focusRestaurantOnMap(rest, card) {
  const key = getMarkerKey(rest);
  if (!key) return;
  activateRestaurant(key, { card });
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
    const sanitized = sanitizePhone(rest.phone);
    if (sanitized) {
      const link = document.createElement('a');
      link.href = `tel:${sanitized}`;
      link.textContent = rest.phone;
      link.rel = 'nofollow';
      phone.append('Phone: ', link);
    } else {
      phone.textContent = `Phone: ${rest.phone}`;
    }
    meta.appendChild(phone);
  }

  const numericReviews =
    typeof rest.reviewCount === 'number'
      ? rest.reviewCount
      : typeof rest.reviewCount === 'string'
        ? Number(rest.reviewCount)
        : NaN;
  if (Number.isFinite(numericReviews) && numericReviews > 0) {
    const reviews = document.createElement('li');
    reviews.textContent = `Reviews: ${numericReviews.toLocaleString()}`;
    meta.appendChild(reviews);
  }

  const distanceText = formatDistance(rest.distance);
  if (distanceText) {
    const distance = document.createElement('li');
    distance.textContent = `Distance: ${distanceText}`;
    meta.appendChild(distance);
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
  if (href && !/yelp\.com/i.test(href)) {
    const normalized = href.startsWith('http') ? href : `https://${href}`;
    const websiteLink = document.createElement('a');
    websiteLink.href = normalized;
    websiteLink.target = '_blank';
    websiteLink.rel = 'noopener noreferrer';
    websiteLink.className = 'restaurant-action';
    websiteLink.textContent = 'Visit Website';
    actions.appendChild(websiteLink);
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

  const favoriteButton = document.createElement('button');
  favoriteButton.type = 'button';
  favoriteButton.className = 'restaurant-action restaurant-action--favorite';
  updateFavoriteButtonState(favoriteButton, rest.id);
  favoriteButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(rest);
  });
  actions.appendChild(favoriteButton);

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

  const markerKey = getMarkerKey(rest);
  if (markerKey) {
    card.dataset.restaurantId = markerKey;
  }

  const header = document.createElement('div');
  header.className = 'restaurant-card__header';

  const title = document.createElement('h3');
  const name = rest.name || 'Unnamed Restaurant';
  const href = typeof rest.url === 'string' && rest.url
    ? rest.url
    : typeof rest.website === 'string'
      ? rest.website
      : '';
  if (href && /yelp\.com/i.test(href)) {
    const normalized = href.startsWith('http') ? href : `https://${href}`;
    const link = document.createElement('a');
    link.href = normalized;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'restaurant-card__title-link';
    link.textContent = name;
    title.appendChild(link);
  } else {
    title.textContent = name;
  }
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

  card.addEventListener('click', () => {
    focusRestaurantOnMap(rest, card);
  });

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
  mapMarkersById.clear();

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
    const key = getMarkerKey(rest);
    if (key) {
      mapMarkersById.set(key, marker);
      marker.on('click', () => {
        activateRestaurant(key, { pan: false });
      });
    }
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

  refreshActiveMarkerHighlight();
}

function getDistanceValue(rest) {
  if (!rest || typeof rest !== 'object') return Infinity;

  const rawDistance =
    typeof rest.distance === 'number'
      ? rest.distance
      : typeof rest.distance === 'string'
        ? Number(rest.distance)
        : NaN;

  return Number.isFinite(rawDistance) && rawDistance >= 0 ? rawDistance : Infinity;
}

function sortByDistance(items) {
  return [...items].sort((a, b) => {
    const distanceA = getDistanceValue(a);
    const distanceB = getDistanceValue(b);

    if (distanceA === distanceB) {
      const nameA = typeof a?.name === 'string' ? a.name.toLowerCase() : '';
      const nameB = typeof b?.name === 'string' ? b.name.toLowerCase() : '';
      return nameA.localeCompare(nameB);
    }

    return distanceA - distanceB;
  });
}

function getReviewCountValue(rest) {
  if (!rest || typeof rest !== 'object') return 0;

  const raw =
    typeof rest.reviewCount === 'number'
      ? rest.reviewCount
      : typeof rest.reviewCount === 'string'
        ? Number(rest.reviewCount)
        : NaN;

  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function updateNearbyRestaurants() {
  const list = Array.isArray(rawNearbyRestaurants) ? rawNearbyRestaurants : [];
  const normalized = list.map(normalizeRestaurant).filter(Boolean);
  const filtered = normalized.filter(rest => getReviewCountValue(rest) >= 5);
  const prioritized = filtered.length ? filtered : normalized;
  nearbyRestaurants = sortByDistance(prioritized);
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
  refreshActiveMarkerHighlight();
}

function resetNearbyRadius() {
  nearbyRadiusIndex = 0;
}

function getCurrentNearbyRadiusMiles() {
  const value = NEARBY_RADIUS_STEPS_MILES[nearbyRadiusIndex];
  return Number.isFinite(value) && value > 0 ? value : null;
}

function canExpandNearbyRadius() {
  return nearbyRadiusIndex < NEARBY_RADIUS_STEPS_MILES.length - 1;
}

function advanceNearbyRadius() {
  if (canExpandNearbyRadius()) {
    nearbyRadiusIndex += 1;
  }
  return getCurrentNearbyRadiusMiles();
}

function shouldRequestMoreNearby() {
  if (!lastNearbyFetchOptions) return false;
  if (!Array.isArray(rawNearbyRestaurants) || !rawNearbyRestaurants.length) {
    return false;
  }
  if (requestedNearbyLimit >= MAX_NEARBY_RESULTS) return false;
  if (rawNearbyRestaurants.length < requestedNearbyLimit) return false;
  return true;
}

async function requestAdditionalNearbyRestaurants() {
  if (isFetchingNearby) return;
  if (!shouldRequestMoreNearby()) return;
  if (!lastNearbyFetchOptions) return;

  const nextLimit = resolveNearbyLimit(requestedNearbyLimit + NEARBY_RESULTS_INCREMENT);
  if (nextLimit <= requestedNearbyLimit) return;

  isFetchingNearby = true;

  try {
    const options = { ...lastNearbyFetchOptions };
    const data = await fetchRestaurants({ ...options, limit: nextLimit });
    requestedNearbyLimit = nextLimit;
    if (Array.isArray(data)) {
      rawNearbyRestaurants = data;
      updateNearbyRestaurants();
    }
  } catch (err) {
    console.error('Additional restaurant search failed', err);
  } finally {
    isFetchingNearby = false;
    renderAll();
  }
}

function renderNearbySection() {
  const container = domRefs.nearbyContainer;
  if (!container) return;
  if (isFetchingNearby && !nearbyRestaurants.length) return;
  visibleNearbyRestaurants = nearbyRestaurants.filter(
    rest => !isHidden(rest.id) && !isSaved(rest.id)
  );
  const shouldLoadMore =
    !visibleNearbyRestaurants.length &&
    !isFetchingNearby &&
    shouldRequestMoreNearby();

  if (shouldLoadMore) {
    requestAdditionalNearbyRestaurants();
    renderRestaurantsList(container, [], 'Searching for more restaurants…');
    return;
  }

  const emptyMessage = isFetchingNearby
    ? 'Searching for more restaurants…'
    : 'No restaurants found.';
  renderRestaurantsList(container, visibleNearbyRestaurants, emptyMessage);
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
  const favoriteIds = new Set(
    favoriteRestaurants
      .map(item => normalizeId(item.id))
      .filter(id => typeof id === 'string' && id)
  );
  const visibleSaved = list.filter(rest => !favoriteIds.has(normalizeId(rest.id)));
  renderRestaurantsList(container, visibleSaved, 'No saved restaurants yet.');
}

function renderFavoritesSection() {
  const container = domRefs.favoritesContainer;
  if (!container) return;
  let list = favoriteRestaurants;
  const filtered = list.filter(rest => !isHidden(rest.id));
  if (filtered.length !== list.length) {
    setFavoriteRestaurants(filtered);
    list = favoriteRestaurants;
  }
  renderRestaurantsList(container, list, 'No favorite restaurants yet.');
}

function renderHiddenSection() {
  const container = domRefs.hiddenContainer;
  if (!container) return;
  container.innerHTML = '';
  if (!hiddenRestaurants.length) {
    container.classList.remove('is-visible');
    isHiddenRestaurantsExpanded = false;
    return;
  }

  container.classList.add('is-visible');

  const count = hiddenRestaurants.length;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'restaurants-hidden-toggle';
  toggle.setAttribute('aria-expanded', String(isHiddenRestaurantsExpanded));
  toggle.setAttribute('aria-controls', 'restaurantsHiddenList');

  const label = document.createElement('span');
  label.className = 'restaurants-hidden-toggle-label';
  label.textContent = `Hidden Restaurants (${count})`;
  toggle.appendChild(label);

  const icon = document.createElement('span');
  icon.className = 'restaurants-hidden-toggle-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '▸';
  toggle.appendChild(icon);

  toggle.addEventListener('click', () => {
    isHiddenRestaurantsExpanded = !isHiddenRestaurantsExpanded;
    renderHiddenSection();
  });

  container.appendChild(toggle);

  const list = document.createElement('div');
  list.className = 'restaurants-hidden-list';
  list.id = 'restaurantsHiddenList';
  list.hidden = !isHiddenRestaurantsExpanded;

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
  } else if (currentView === 'favorites') {
    updateMap(favoriteRestaurants);
  } else if (isFetchingNearby && !nearbyRestaurants.length) {
    clearMap();
  } else {
    updateMap(visibleNearbyRestaurants);
  }
}

function renderAll() {
  renderNearbySection();
  renderSavedSection();
  renderFavoritesSection();
  renderHiddenSection();
  updateMapForCurrentView();
}

function setActiveView(view) {
  const validViews = ['nearby', 'saved', 'favorites'];
  const targetView = validViews.includes(view) ? view : 'nearby';
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
  if (domRefs.favoritesContainer) {
    domRefs.favoritesContainer.hidden = targetView !== 'favorites';
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

async function fetchRestaurants({
  latitude,
  longitude,
  city,
  radiusMiles,
  skipCoordinates = false,
  limit
}) {
  const params = new URLSearchParams();
  const parsedLatitude =
    typeof latitude === 'string' ? Number(latitude) : latitude;
  const parsedLongitude =
    typeof longitude === 'string' ? Number(longitude) : longitude;
  const rawRadius = typeof radiusMiles === 'string' ? Number(radiusMiles) : radiusMiles;
  const hasLatitude = Number.isFinite(parsedLatitude);
  const hasLongitude = Number.isFinite(parsedLongitude);
  const shouldIncludeCoords = !skipCoordinates && hasLatitude && hasLongitude;

  const effectiveLimit = resolveNearbyLimit(limit);
  if (Number.isFinite(effectiveLimit) && effectiveLimit > 0) {
    params.set('limit', String(effectiveLimit));
  }

  if (shouldIncludeCoords) {
    params.set('latitude', String(parsedLatitude));
    params.set('longitude', String(parsedLongitude));
  }
  if (Number.isFinite(rawRadius) && rawRadius > 0) {
    params.set('radius', String(rawRadius));
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
  requestedNearbyLimit = TARGET_NEARBY_RESULTS;
  lastNearbyFetchOptions = null;
  resetNearbyRadius();
  renderMessage(targetContainer, 'Requesting your location…');
  clearMap();
  clearUserLocation();

  let position;
  try {
    position = await getCurrentPosition();
  } catch (err) {
    console.error('Geolocation error', err);
    isFetchingNearby = false;
    rawNearbyRestaurants = [];
    nearbyRestaurants = [];
    visibleNearbyRestaurants = [];
    clearUserLocation();
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
    setUserLocation(latitude, longitude);
    const city = await reverseGeocodeCity(latitude, longitude);
    const initialLimit = resolveNearbyLimit(requestedNearbyLimit);
    const baseOptions = { latitude, longitude, city, skipCoordinates: false };
    const initialRadius = getCurrentNearbyRadiusMiles();
    let fetchOptions =
      Number.isFinite(initialRadius) && initialRadius > 0
        ? { ...baseOptions, radiusMiles: initialRadius }
        : { ...baseOptions };
    let data = await fetchRestaurants({ ...fetchOptions, limit: initialLimit });

    while ((!Array.isArray(data) || data.length === 0) && canExpandNearbyRadius()) {
      renderMessage(targetContainer, 'Searching for more restaurants…');
      const nextRadius = advanceNearbyRadius();
      const nextOptions =
        Number.isFinite(nextRadius) && nextRadius > 0
          ? { ...baseOptions, radiusMiles: nextRadius }
          : { ...baseOptions };
      fetchOptions = nextOptions;
      data = await fetchRestaurants({ ...nextOptions, limit: initialLimit });
    }

    if ((!Array.isArray(data) || data.length === 0) && city) {
      renderMessage(targetContainer, 'Searching for more restaurants…');
      fetchOptions = { ...baseOptions, skipCoordinates: true };
      data = await fetchRestaurants({ ...fetchOptions, limit: initialLimit });
    }

    rawNearbyRestaurants = Array.isArray(data) ? data : [];
    requestedNearbyLimit = initialLimit;
    lastNearbyFetchOptions = fetchOptions;
    updateNearbyRestaurants();
    isFetchingNearby = false;
    renderAll();
  } catch (err) {
    console.error('Restaurant search failed', err);
    isFetchingNearby = false;
    rawNearbyRestaurants = [];
    nearbyRestaurants = [];
    visibleNearbyRestaurants = [];
    clearUserLocation();
    requestedNearbyLimit = TARGET_NEARBY_RESULTS;
    lastNearbyFetchOptions = null;
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
  domRefs.favoritesContainer = document.getElementById('restaurantsFavorites');
  domRefs.hiddenContainer = document.getElementById('restaurantsHiddenSection');
  domRefs.tabButtons = Array.from(resultsContainer.querySelectorAll('.restaurants-tab'));

  loadStoredState();

  domRefs.tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      setActiveView(button.dataset.view);
    });
  });

  renderSavedSection();
  renderFavoritesSection();
  renderHiddenSection();
  setActiveView(currentView);

  await loadNearbyRestaurants(domRefs.nearbyContainer);
}

if (typeof window !== 'undefined') {
  loadStoredState();
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEYS.saved) {
      savedRestaurants = dedupeRestaurants(readStoredList(STORAGE_KEYS.saved));
      savedRestaurants = sortByDistance(savedRestaurants);
      syncFavoritesWithSaved();
      renderSavedSection();
      renderFavoritesSection();
      updateMapForCurrentView();
    } else if (event.key === STORAGE_KEYS.favorites) {
      favoriteRestaurants = sortByDistance(
        dedupeRestaurants(readStoredList(STORAGE_KEYS.favorites))
      );
      syncFavoritesWithSaved();
      renderFavoritesSection();
      updateMapForCurrentView();
    } else if (event.key === STORAGE_KEYS.hidden) {
      hiddenRestaurants = dedupeRestaurants(readStoredList(STORAGE_KEYS.hidden));
      syncFavoritesWithSaved();
      renderHiddenSection();
      renderNearbySection();
      renderSavedSection();
      renderFavoritesSection();
      updateMapForCurrentView();
    }
  });
  window.initRestaurantsPanel = initRestaurantsPanel;
  window.dispatchEvent(new Event('restaurantsPanelReady'));
}
