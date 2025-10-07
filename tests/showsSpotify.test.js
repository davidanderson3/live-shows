import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// simple localStorage mock
const storage = (() => {
  let store = {};
  return {
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

global.localStorage = storage;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const makeSongkickEvent = ({
  id = 'event',
  name = 'Concert',
  latitude = 30.2672,
  longitude = -97.7431,
  date = '2024-01-01',
  time = '20:00:00',
  city = 'Austin',
  state = 'TX',
  artists = []
} = {}) => ({
  id,
  displayName: name,
  start: { date, time },
  location: { lat: latitude, lng: longitude, city: `${city}, ${state}` },
  venue: {
    displayName: 'Venue',
    metroArea: { displayName: city, state: { displayName: state } }
  },
  uri: `https://songkick.test/events/${id}`,
  performance: artists.map(artistName => ({ artist: { displayName: artistName } }))
});

const makeSongkickResponse = events => ({
  resultsPage: {
    status: 'ok',
    results: {
      event: events
    }
  }
});

describe('initShowsPanel', () => {
  let initShowsPanel;
  beforeEach(async () => {
    storage.clear();
    vi.resetModules();
    const dom = new JSDOM(`
      <button id="spotifyTokenBtn"></button>
      <span id="spotifyStatus"></span>
      <input id="songkickApiKey" />
      <input id="showsRadius" value="300" />
      <input id="showsArtistLimit" value="10" />
      <input type="checkbox" id="showsIncludeSuggestions" checked />
      <button id="songkickDiscoverBtn">Discover</button>
      <div id="songkickList"></div>
      <div id="songkickInterestedList"></div>
    `, { url: 'http://localhost/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.fetch = vi.fn();
    global.navigator = {
      geolocation: {
        getCurrentPosition: vi.fn(success => {
          success({
            coords: { latitude: 30.2672, longitude: -97.7431 }
          });
        })
      }
    };
    window.__NO_SPOTIFY_REDIRECT = true;
    ({ initShowsPanel } = await import('../js/shows.js'));
  });

  it('renders a preview when Spotify token is missing', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clientId: 'cid', hasSongkickKey: true })
    });

    await initShowsPanel();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.show-card--sample').length).toBeGreaterThan(0);
    expect(document.querySelector('.shows-preview-note')?.textContent).toContain('preview');
  });

  it('fetches Spotify artists and Songkick events', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasSongkickKey: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ name: 'The Band' }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSongkickResponse([
          makeSongkickEvent({ id: 'sk1', name: 'Concert', artists: ['The Band'] })
        ])
      });

    localStorage.setItem(
      'showsConfigV1',
      JSON.stringify({ radiusMiles: 300, artistLimit: 5, includeSuggestions: true })
    );
    localStorage.setItem('spotifyToken', 'token');
    await initShowsPanel();

    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1][0]).toContain('limit=10');
    expect(document.querySelectorAll('.show-card').length).toBe(1);
    expect(fetch.mock.calls[2][0]).toContain('/api/songkick');
    expect(fetch.mock.calls[2][0]).not.toContain('apiKey=');
    expect(document.querySelector('.show-card__title')?.textContent).toContain('Concert');
    expect(document.querySelector('.show-card__cta')?.textContent).toBe('Get Tickets');
    expect(document.querySelectorAll('.show-card__button').length).toBe(2);
  });

  it('respects updated configuration values on Discover reload', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasSongkickKey: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ name: 'Artist' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ resultsPage: { status: 'ok', results: { event: [] } } }) });

    localStorage.setItem('spotifyToken', 'token');
    await initShowsPanel();

    await flush();
    await flush();

    const artistLimitInput = document.getElementById('showsArtistLimit');
    const radiusInput = document.getElementById('showsRadius');
    const includeSuggestionsInput = document.getElementById('showsIncludeSuggestions');
    artistLimitInput.value = '6';
    artistLimitInput.dispatchEvent(new window.Event('change'));
    radiusInput.value = '150';
    radiusInput.dispatchEvent(new window.Event('change'));
    includeSuggestionsInput.checked = false;
    includeSuggestionsInput.dispatchEvent(new window.Event('change'));

    fetch.mockClear();
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ name: 'Second Artist', id: 'artist2' }] })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => makeSongkickResponse([]) });

    document.getElementById('songkickDiscoverBtn')._showsClickHandler();

    await flush();
    await flush();

    expect(fetch.mock.calls[0][0]).toContain('limit=6');
    const recommendationCall = fetch.mock.calls.find(call =>
      String(call[0]).includes('api.spotify.com/v1/recommendations')
    );
    expect(recommendationCall).toBeUndefined();
    const storedConfig = JSON.parse(localStorage.getItem('showsConfigV1') || '{}');
    expect(storedConfig).toMatchObject({
      artistLimit: 6,
      radiusMiles: 150,
      includeSuggestions: false
    });
  });

  it('falls back to genre-based Spotify seeds when artist recommendations are empty', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasSongkickKey: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { name: 'Artist One', id: 'artist1', genres: ['synthwave', 'electronic'] },
            { name: 'Artist Two', id: 'artist2', genres: ['indie pop'] }
          ]
        })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => makeSongkickResponse([]) })
      .mockResolvedValueOnce({ ok: true, json: async () => makeSongkickResponse([]) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tracks: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tracks: [
            {
              id: 'track1',
              name: 'New Song',
              artists: [{ name: 'Fresh Artist' }],
              external_urls: { spotify: 'https://spotify.test/track1' },
              album: { images: [] }
            }
          ]
        })
      });

    localStorage.setItem('spotifyToken', 'token');
    await initShowsPanel();

    await flush();
    await flush();
    await flush();

    const recommendationCalls = fetch.mock.calls.filter(call =>
      String(call[0]).includes('api.spotify.com/v1/recommendations')
    );
    expect(recommendationCalls.length).toBe(3);
    expect(recommendationCalls[0][0]).toContain('seed_artists=');
    expect(recommendationCalls[1][0]).toContain('seed_artists=');
    expect(recommendationCalls[1][0]).toContain('seed_genres=');
    expect(recommendationCalls[2][0]).toContain('seed_genres=');
    expect(document.querySelectorAll('.shows-suggestion').length).toBe(1);
  });

  it('only shows events within 300 miles of the user', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasSongkickKey: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ name: 'The Band' }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeSongkickResponse([
            makeSongkickEvent({
              id: 'near',
              name: 'Austin Gig',
              date: '2024-02-01',
              latitude: 30.2669,
              longitude: -97.7428,
              city: 'Austin',
              state: 'TX',
              artists: ['The Band']
            }),
            makeSongkickEvent({
              id: 'far',
              name: 'NYC Arena',
              date: '2024-03-01',
              latitude: 40.7505,
              longitude: -73.9934,
              city: 'New York',
              state: 'NY',
              artists: ['The Band']
            })
          ])
      });

    localStorage.setItem('spotifyToken', 'token');
    await initShowsPanel();

    await flush();
    await flush();

    const cards = Array.from(document.querySelectorAll('.show-card__title')).map(el => el.textContent);
    expect(cards).toEqual(['Austin Gig']);
  });

  it('lets the user mark a show as interested', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasSongkickKey: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ name: 'The Band' }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeSongkickResponse([
            makeSongkickEvent({
              id: 'event1',
              name: 'Club Night',
              date: '2024-04-01',
              latitude: 30.2669,
              longitude: -97.7428,
              city: 'Austin',
              state: 'TX',
              artists: ['The Band']
            })
          ])
      });

    localStorage.setItem('spotifyToken', 'token');
    await initShowsPanel();
    await flush();

    const interestedBtn = document.querySelector('.show-card__button');
    interestedBtn.dispatchEvent(new window.Event('click'));

    await flush();

    expect(document.querySelector('.show-card--interested')).not.toBeNull();
    const prefsAfterInterest = JSON.parse(localStorage.getItem('showsPreferences') || '{}');
    expect(prefsAfterInterest).toMatchObject({
      event1: { status: 'interested' }
    });

    interestedBtn.dispatchEvent(new window.Event('click'));
    await flush();

    expect(document.querySelector('.show-card--interested')).toBeNull();
  });

  it('moves not interested shows into a collapsible section', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasSongkickKey: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ name: 'Artist' }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeSongkickResponse([
            makeSongkickEvent({
              id: 'event1',
              name: 'Club Night',
              date: '2024-04-01',
              latitude: 30.2669,
              longitude: -97.7428,
              city: 'Austin',
              state: 'TX',
              artists: ['Artist']
            }),
            makeSongkickEvent({
              id: 'event2',
              name: 'Outdoor Fest',
              date: '2024-05-10',
              latitude: 30.2669,
              longitude: -97.7428,
              city: 'Austin',
              state: 'TX'
            })
          ])
      });

    localStorage.setItem('spotifyToken', 'token');
    await initShowsPanel();
    await flush();

    const notInterestedBtn = document.querySelector('.show-card__button--secondary');
    notInterestedBtn.dispatchEvent(new window.Event('click'));
    await flush();

    expect(document.querySelectorAll('.show-card').length).toBe(2);
    const summary = document.querySelector('.shows-dismissed__summary');
    expect(summary).not.toBeNull();
    expect(summary.textContent).toContain('Not Interested (1)');
    expect(document.querySelectorAll('.shows-dismissed .show-card').length).toBe(1);

    const dismissedButton = document.querySelector('.shows-dismissed .show-card__button--secondary');
    dismissedButton.dispatchEvent(new window.Event('click'));
    await flush();

    expect(document.querySelector('.shows-dismissed')).toBeNull();
    const prefsAfterUndo = JSON.parse(localStorage.getItem('showsPreferences') || '{}');
    expect(prefsAfterUndo).toEqual({});
  });

  it('wires the Discover button even when Spotify client ID is missing', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ clientId: '', hasSongkickKey: true })
    });

    await initShowsPanel();
    await flush();

    const discoverBtn = document.getElementById('songkickDiscoverBtn');
    expect(discoverBtn).not.toBeNull();

    fetch.mockClear();
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ name: 'Top Artist', id: 'artist1' }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeSongkickResponse([
            makeSongkickEvent({
              id: 'event1',
              name: 'Club Night',
              date: '2024-04-01',
              latitude: 30.2669,
              longitude: -97.7428,
              city: 'Austin',
              state: 'TX',
              artists: ['Top Artist']
            })
          ])
      });

    localStorage.setItem('spotifyToken', 'manual-token');
    discoverBtn._showsClickHandler();

    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toContain('api.spotify.com');
    expect(fetch.mock.calls[1][0]).toContain('/api/songkick');
    expect(document.querySelectorAll('.show-card').length).toBe(1);
    expect(discoverBtn.disabled).toBe(false);
    expect(discoverBtn.classList.contains('is-loading')).toBe(false);
  });

  it('retries geolocation when explicitly allowed after an earlier failure', async () => {
    const utils = window.__showsTestUtils;
    expect(utils).toBeDefined();

    const geolocationSpy = vi
      .fn()
      .mockImplementationOnce((success, error) => {
        error?.({ code: 1, message: 'User gesture required' });
      })
      .mockImplementation(success => {
        success({
          coords: { latitude: 30.2672, longitude: -97.7431 }
        });
      });

    navigator.geolocation.getCurrentPosition = geolocationSpy;

    const firstAttempt = await utils.getUserLocation();
    expect(firstAttempt).toBeNull();
    expect(geolocationSpy).toHaveBeenCalledTimes(1);

    const secondAttempt = await utils.getUserLocation({ allowRetry: true });
    expect(secondAttempt).toEqual({ latitude: 30.2672, longitude: -97.7431 });
    expect(geolocationSpy).toHaveBeenCalledTimes(2);
  });

  it('stores credentials and cached values during OAuth flow', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasSongkickKey: true }) })
      .mockRejectedValue(new Error('fail'));
    localStorage.setItem('spotifyToken', 'tok');
    await initShowsPanel();
    document.getElementById('spotifyTokenBtn').dispatchEvent(new window.Event('click'));

    await flush();

    expect(localStorage.getItem('spotifyCodeVerifier')).toBeTruthy();
    expect(localStorage.getItem('spotifyToken')).toBe('tok');
    expect(localStorage.getItem('songkickApiKey')).toBeFalsy();
  });

  it('exchanges authorization code for token', async () => {
    const dom = new JSDOM(`
      <button id="spotifyTokenBtn"></button>
      <span id="spotifyStatus"></span>
      <input id="songkickApiKey" />
      <input id="showsRadius" value="300" />
      <input id="showsArtistLimit" value="10" />
      <input type="checkbox" id="showsIncludeSuggestions" checked />
      <button id="songkickDiscoverBtn">Discover</button>
      <div id="songkickList"></div>
      <div id="songkickInterestedList"></div>
    `, { url: 'http://localhost/?code=abc' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasSongkickKey: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'newTok' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) });
    global.navigator = {
      geolocation: {
        getCurrentPosition: vi.fn(success => {
          success({
            coords: { latitude: 30.2672, longitude: -97.7431 }
          });
        })
      }
    };
    localStorage.setItem('spotifyCodeVerifier', 'ver');
    ({ initShowsPanel } = await import('../js/shows.js'));

    await initShowsPanel();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem('spotifyToken')).toBe('newTok');
    expect(document.getElementById('spotifyStatus')?.textContent).toBe('Spotify connected');
  });

  it('falls back to manual Songkick key input when server does not provide one', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasSongkickKey: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ name: 'Artist' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => makeSongkickResponse([]) });

    localStorage.setItem('spotifyToken', 'token');
    const input = document.getElementById('songkickApiKey');
    input.value = 'manualKey';

    await initShowsPanel();
    await flush();
    await flush();

    expect(fetch.mock.calls[2][0]).toContain('/api/songkick');
    expect(fetch.mock.calls[2][0]).toContain('apiKey=manualKey');
  });

  it('shows Spotify suggestions when no live shows are available', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasSongkickKey: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ name: 'Top Artist', id: 'artist1' }]
        })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => makeSongkickResponse([]) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tracks: [
            {
              id: 'track1',
              name: 'Song One',
              artists: [{ name: 'Artist A' }],
              external_urls: { spotify: 'https://spotify.com/track1' },
              album: { images: [{ url: 'https://img/1.jpg', width: 300 }] }
            },
            {
              id: 'track2',
              name: 'Song Two',
              artists: [{ name: 'Artist B' }],
              external_urls: { spotify: 'https://spotify.com/track2' },
              album: { images: [{ url: 'https://img/2.jpg', width: 300 }] }
            },
            {
              id: 'track3',
              name: 'Song Three',
              artists: [{ name: 'Artist C' }],
              external_urls: { spotify: 'https://spotify.com/track3' },
              album: { images: [{ url: 'https://img/3.jpg', width: 300 }] }
            },
            {
              id: 'track4',
              name: 'Song Four',
              artists: [{ name: 'Artist D' }],
              external_urls: { spotify: 'https://spotify.com/track4' },
              album: { images: [{ url: 'https://img/4.jpg', width: 300 }] }
            }
          ]
        })
      });

    localStorage.setItem('spotifyToken', 'token');
    await initShowsPanel();

    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(4);
    const suggestions = document.querySelectorAll('.shows-suggestion');
    expect(suggestions.length).toBe(4);
    expect(document.querySelector('.shows-suggestions__title')?.textContent).toContain('Spotify suggestions');
    expect(document.querySelector('.shows-empty')?.textContent).toContain('No nearby shows');
  });
});
