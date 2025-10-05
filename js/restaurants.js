const API_BASE_URL =
  (typeof window !== 'undefined' && window.apiBaseUrl) ||
  (typeof process !== 'undefined' && process.env.API_BASE_URL) ||
  (typeof window !== 'undefined' ? window.location.origin : '');

let initialized = false;

function renderLoading(container) {
  container.innerHTML = '<em>Loading restaurants...</em>';
}

function renderMessage(container, message) {
  container.innerHTML = `<em>${message}</em>`;
}

function formatDistance(meters) {
  if (typeof meters !== 'number' || Number.isNaN(meters)) return '';
  const miles = meters / 1609.344;
  if (!Number.isFinite(miles)) return '';
  const precision = miles >= 10 ? 0 : 1;
  return `${miles.toFixed(precision)} mi`;
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
  const ul = document.createElement('ul');
  items.forEach(rest => {
    const li = document.createElement('li');
    li.className = 'restaurant-card';

    const title = document.createElement('h3');
    title.textContent = rest.name || 'Unnamed Restaurant';
    li.appendChild(title);

    const meta = document.createElement('ul');
    meta.className = 'restaurant-meta';

    if (rest.address) {
      const m = document.createElement('li');
      m.textContent = rest.address;
      meta.appendChild(m);
    }

    const details = [];
    if (rest.city) details.push(rest.city);
    if (rest.state) details.push(rest.state);
    if (rest.zip) details.push(rest.zip);
    if (details.length) {
      const m = document.createElement('li');
      m.textContent = details.join(', ');
      meta.appendChild(m);
    }

    const categoryText = Array.isArray(rest.categories) && rest.categories.length
      ? rest.categories.join(', ')
      : rest.cuisine;
    if (categoryText) {
      const m = document.createElement('li');
      m.textContent = `Cuisine: ${categoryText}`;
      meta.appendChild(m);
    }

    if (rest.phone) {
      const m = document.createElement('li');
      m.textContent = `Phone: ${rest.phone}`;
      meta.appendChild(m);
    }

    if (rest.price) {
      const m = document.createElement('li');
      m.textContent = `Price: ${rest.price}`;
      meta.appendChild(m);
    }

    if (rest.rating) {
      const m = document.createElement('li');
      const reviews = rest.reviewCount ? ` (${rest.reviewCount} reviews)` : '';
      m.textContent = `Rating: ${rest.rating}${reviews}`;
      meta.appendChild(m);
    }

    if (typeof rest.distance === 'number') {
      const distanceText = formatDistance(rest.distance);
      if (distanceText) {
        const m = document.createElement('li');
        m.textContent = `Distance: ${distanceText}`;
        meta.appendChild(m);
      }
    }

    if (rest.url || rest.website) {
      const m = document.createElement('li');
      const link = document.createElement('a');
      const href = rest.url || rest.website;
      link.href = href.startsWith('http') ? href : `https://${href}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Website';
      m.appendChild(link);
      meta.appendChild(m);
    }

    if (meta.childNodes.length) li.appendChild(meta);

    ul.appendChild(li);
  });
  container.innerHTML = '';
  container.appendChild(ul);
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
  if (latitude && longitude) {
    params.set('latitude', String(latitude));
    params.set('longitude', String(longitude));
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
