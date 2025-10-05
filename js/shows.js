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
let userLocationRequested = false;

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

async function getUserLocation() {
  if (userLocationRequested) {
    return cachedUserLocation;
  }
  userLocationRequested = true;
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return null;
  }
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000
      });
    });
    cachedUserLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    };
  } catch (err) {
    console.warn('Unable to retrieve current location for shows list', err);
    cachedUserLocation = null;
  }
  return cachedUserLocation;
}

export async function initShowsPanel() {
  const listEl = document.getElementById('ticketmasterList');
  if (!listEl) return;
  const tokenBtn = document.getElementById('spotifyTokenBtn');
  const tokenInput = document.getElementById('spotifyToken');
  const statusEl = document.getElementById('spotifyStatus');
  const apiKeyInput = document.getElementById('ticketmasterApiKey');

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
    listEl.textContent = 'Spotify client ID not configured.';
    return;
  }

  if (serverHasTicketmasterKey && apiKeyInput) {
    apiKeyInput.style.display = 'none';
  }

  const redirectUri = window.location.origin + window.location.pathname;

  const updateSpotifyStatus = () => {
    const storedToken =
      (typeof localStorage !== 'undefined' && localStorage.getItem('spotifyToken')) || '';
    if (storedToken) {
      if (tokenBtn) tokenBtn.textContent = 'Logged in';
      if (statusEl) statusEl.textContent = 'Logged in';
      if (tokenInput) {
        tokenInput.disabled = true;
        tokenInput.style.display = 'none';
      }
    } else {
      if (tokenBtn) tokenBtn.textContent = 'Login to Spotify';
      if (statusEl) statusEl.textContent = '';
      if (tokenInput) {
        tokenInput.disabled = false;
        tokenInput.style.display = '';
      }
    }
  };

  updateSpotifyStatus();

  const startAuth = async () => {
    if (!spotifyClientId) {
      listEl.textContent = 'Spotify client ID not configured.';
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
  if (authCode && tokenInput) {
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
        if (tokenInput) tokenInput.value = '';
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

  const loadShows = async () => {
    const token =
      tokenInput?.value.trim() ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('spotifyToken')) || '';
    const manualApiKey =
      apiKeyInput?.value.trim() ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('ticketmasterApiKey')) || '';
    const requiresManualApiKey = !serverHasTicketmasterKey;

    if (!token) {
      listEl.textContent = 'Please login to Spotify.';
      return;
    }

    if (tokenInput?.value && typeof localStorage !== 'undefined') {
      localStorage.setItem('spotifyToken', token);
      updateSpotifyStatus();
    }

    if (requiresManualApiKey && !manualApiKey) {
      listEl.textContent = 'Please enter your Ticketmaster API key.';
      return;
    }

    if (requiresManualApiKey && apiKeyInput?.value && typeof localStorage !== 'undefined') {
      localStorage.setItem('ticketmasterApiKey', manualApiKey);
    } else if (!requiresManualApiKey && typeof localStorage !== 'undefined') {
      localStorage.removeItem('ticketmasterApiKey');
    }
    listEl.innerHTML = '<em>Loading...</em>';
    try {
      const artistRes = await fetch('https://api.spotify.com/v1/me/top/artists?limit=10', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (artistRes.status === 401) {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('spotifyToken');
        }
        updateSpotifyStatus();
        listEl.textContent = 'Please login to Spotify again.';
        return;
      }
      if (!artistRes.ok) throw new Error(`Spotify HTTP ${artistRes.status}`);
      const artistData = await artistRes.json();
      const artists = artistData.items || [];
      if (artists.length === 0) {
        listEl.textContent = 'No artists found.';
        return;
      }

      const userLocation = await getUserLocation();
      if (!userLocation) {
        listEl.innerHTML =
          '<p class="shows-empty">Allow location access to see shows within 300 miles.</p>';
        return;
      }
      const eventsMap = new Map();
      let eventCounter = 0;
      for (const artist of artists) {
        const tmUrl = new URL(`${API_BASE_URL}/api/ticketmaster`);
        tmUrl.searchParams.set('keyword', artist.name);
        if (requiresManualApiKey) {
          tmUrl.searchParams.set('apiKey', manualApiKey);
        }
        const res = await fetch(tmUrl.toString());
        if (!res.ok) continue;
        const data = await res.json();
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
          if (Number.isFinite(distance) && distance > 300) {
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
              event: ev,
              venue,
              distance,
              order: eventCounter++
            });
          }
        }
      }
      listEl.innerHTML = '';
      if (eventsMap.size > 0) {
        const ul = document.createElement('ul');
        ul.className = 'shows-grid';
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
        for (const { event, venue, distance } of events) {
          const li = document.createElement('li');
          li.className = 'show-card';
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
          const meta = document.createElement('div');
          meta.className = 'show-card__meta';
          const locParts = [venue?.name, venue?.city?.name, venue?.state?.stateCode].filter(Boolean);
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
          if (locParts.length > 0) {
            const locDiv = document.createElement('div');
            locDiv.className = 'show-card__location';
            locDiv.textContent = locParts.join(' · ');
            content.appendChild(locDiv);
          }
          if (event.url) {
            const link = document.createElement('a');
            link.href = event.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'show-card__cta';
            link.textContent = 'Get Tickets';
            content.appendChild(link);
          }
          li.appendChild(content);
          ul.appendChild(li);
        }
        listEl.appendChild(ul);
      } else {
        listEl.textContent = 'No nearby shows within 300 miles.';
      }
    } catch (err) {
      console.error('Failed to load shows', err);
      listEl.textContent = 'Failed to load shows.';
    }
  };

  tokenBtn?.addEventListener('click', startAuth);

  await loadShows();
}

window.initShowsPanel = initShowsPanel;
