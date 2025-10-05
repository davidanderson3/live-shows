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

      const ul = document.createElement('ul');
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
          const li = document.createElement('li');
          const nameDiv = document.createElement('div');
          nameDiv.textContent = ev.name || 'Unnamed event';
          li.appendChild(nameDiv);
          const venue = ev._embedded?.venues?.[0];
          const locParts = [venue?.name, venue?.city?.name, venue?.state?.stateCode].filter(Boolean);
          if (locParts.length > 0) {
            const locDiv = document.createElement('div');
            locDiv.textContent = locParts.join(' - ');
            li.appendChild(locDiv);
          }
          const date = ev.dates?.start?.localDate;
          if (date) {
            const dateDiv = document.createElement('div');
            dateDiv.textContent = date;
            li.appendChild(dateDiv);
          }
          if (ev.url) {
            const link = document.createElement('a');
            link.href = ev.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'View Event';
            li.appendChild(link);
          }
          ul.appendChild(li);
        }
      }
      listEl.innerHTML = '';
      if (ul.children.length > 0) {
        listEl.appendChild(ul);
      } else {
        listEl.textContent = 'No upcoming shows.';
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
