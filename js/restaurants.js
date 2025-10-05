const API_BASE_URL =
  (typeof window !== 'undefined' && window.apiBaseUrl) ||
  (typeof process !== 'undefined' && process.env.API_BASE_URL) ||
  (typeof window !== 'undefined' ? window.location.origin : '');

let initialized = false;
let mapInstance = null;
let mapMarkersLayer = null;

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
  clearMap();
}

function renderMessage(container, message) {
  ensureMap();
  container.innerHTML = `<div class="restaurants-message">${message}</div>`;
  clearMap();
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

  const lat = typeof rest.latitude === 'number' ? rest.latitude : Number(rest.latitude);
  const lng = typeof rest.longitude === 'number' ? rest.longitude : Number(rest.longitude);
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

  return actions.childNodes.length ? actions : null;
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
    const lat = typeof rest.latitude === 'number' ? rest.latitude : Number(rest.latitude);
    const lng = typeof rest.longitude === 'number' ? rest.longitude : Number(rest.longitude);
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

function sortByRating(items) {
  return [...items].sort((a, b) => {
    const ratingA = typeof a.rating === 'number' ? a.rating : -Infinity;
    const ratingB = typeof b.rating === 'number' ? b.rating : -Infinity;
    if (ratingA === ratingB) {
      const reviewsA = typeof a.reviewCount === 'number' ? a.reviewCount : -Infinity;
      const reviewsB = typeof b.reviewCount === 'number' ? b.reviewCount : -Infinity;
      return reviewsB - reviewsA;
    }
    return ratingB - ratingA;
  });
}

function renderResults(container, items) {
  if (!items.length) {
    renderMessage(container, 'No restaurants found.');
    return;
  }

  ensureMap();

  const grid = document.createElement('div');
  grid.className = 'restaurants-grid';

  items.forEach(rest => {
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

    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);

  updateMap(items);
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

  const base = API_BASE_URL ? API_BASE_URL.replace(/\/$/, '') : '';
  const url = `${base}/api/restaurants?${params.toString()}`;
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
  renderMessage(container, 'Requesting your location…');

  let position;
  try {
    position = await getCurrentPosition();
  } catch (err) {
    console.error('Geolocation error', err);
    if (err && typeof err.code === 'number' && err.code === 1) {
      renderMessage(container, 'Location access is required to show nearby restaurants.');
    } else {
      renderMessage(container, 'Unable to determine your location.');
    }
    return;
  }

  renderLoading(container);

  try {
    const { latitude, longitude } = position.coords;
    const city = await reverseGeocodeCity(latitude, longitude);
    const data = await fetchRestaurants({ latitude, longitude, city });
    const sorted = sortByRating(data);
    renderResults(container, sorted);
  } catch (err) {
    console.error('Restaurant search failed', err);
    renderMessage(container, err?.message || 'Failed to load restaurants.');
  }
}

export async function initRestaurantsPanel() {
  if (initialized) return;
  initialized = true;

  const resultsContainer = document.getElementById('restaurantsResults');
  if (!resultsContainer) return;

  await loadNearbyRestaurants(resultsContainer);
}

if (typeof window !== 'undefined') {
  window.initRestaurantsPanel = initRestaurantsPanel;
  window.dispatchEvent(new Event('restaurantsPanelReady'));
}
