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

describe('initShowsPanel', () => {
  let initShowsPanel;
  beforeEach(async () => {
    storage.clear();
    vi.resetModules();
    const dom = new JSDOM(`
      <button id="spotifyTokenBtn"></button>
      <span id="spotifyStatus"></span>
      <input id="ticketmasterApiKey" />
      <input id="showsRadius" value="300" />
      <input id="showsArtistLimit" value="10" />
      <input type="checkbox" id="showsIncludeSuggestions" checked />
      <button id="ticketmasterDiscoverBtn">Discover</button>
      <div id="ticketmasterList"></div>
      <div id="ticketmasterInterestedList"></div>
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
      json: async () => ({ clientId: 'cid', hasTicketmasterKey: true })
    });

    await initShowsPanel();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.show-card--sample').length).toBeGreaterThan(0);
    expect(document.querySelector('.shows-preview-note')?.textContent).toContain('preview');
  });

  it('fetches Spotify artists and Ticketmaster events', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasTicketmasterKey: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ name: 'The Band' }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _embedded: {
            events: [
              {
                name: 'Concert',
                dates: { start: { localDate: '2024-01-01' } },
                _embedded: {
                  venues: [
                    {
                      name: 'Venue',
                      city: { name: 'City' },
                      state: { stateCode: 'ST' },
                      location: { latitude: '30.26', longitude: '-97.74' }
                    }
                  ]
                },
                url: 'http://example.com'
              }
            ]
          }
        })
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
    expect(fetch.mock.calls[2][0]).toContain('/api/ticketmaster');
    expect(fetch.mock.calls[2][0]).not.toContain('apiKey=');
    expect(document.querySelector('.show-card__title')?.textContent).toContain('Concert');
    expect(document.querySelector('.show-card__cta')?.textContent).toBe('Get Tickets');
    expect(document.querySelectorAll('.show-card__button').length).toBe(2);
  });

  it('respects updated configuration values on Discover reload', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasTicketmasterKey: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ name: 'Artist' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ _embedded: { events: [] } }) });

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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ _embedded: { events: [] } }) });

    document.getElementById('ticketmasterDiscoverBtn')._showsClickHandler();

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

  it('only shows events within 300 miles of the user', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasTicketmasterKey: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ name: 'The Band' }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _embedded: {
            events: [
              {
                id: 'near',
                name: 'Austin Gig',
                dates: { start: { localDate: '2024-02-01' } },
                _embedded: {
                  venues: [
                    {
                      name: 'Continental Club',
                      city: { name: 'Austin' },
                      state: { stateCode: 'TX' },
                      location: { latitude: '30.2669', longitude: '-97.7428' }
                    }
                  ]
                },
                url: 'http://example.com/austin'
              },
              {
                id: 'far',
                name: 'NYC Arena',
                dates: { start: { localDate: '2024-03-01' } },
                _embedded: {
                  venues: [
                    {
                      name: 'Madison Square Garden',
                      city: { name: 'New York' },
                      state: { stateCode: 'NY' },
                      location: { latitude: '40.7505', longitude: '-73.9934' }
                    }
                  ]
                },
                url: 'http://example.com/nyc'
              }
            ]
          }
        })
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasTicketmasterKey: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ name: 'The Band' }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _embedded: {
            events: [
              {
                id: 'event1',
                name: 'Club Night',
                dates: { start: { localDate: '2024-04-01' } },
                _embedded: {
                  venues: [
                    {
                      name: 'The Club',
                      city: { name: 'Austin' },
                      state: { stateCode: 'TX' },
                      location: { latitude: '30.2669', longitude: '-97.7428' }
                    }
                  ]
                },
                url: 'http://example.com/club'
              }
            ]
          }
        })
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasTicketmasterKey: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ name: 'Artist' }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _embedded: {
            events: [
              {
                id: 'event1',
                name: 'Club Night',
                dates: { start: { localDate: '2024-04-01' } },
                _embedded: {
                  venues: [
                    {
                      name: 'The Club',
                      city: { name: 'Austin' },
                      state: { stateCode: 'TX' },
                      location: { latitude: '30.2669', longitude: '-97.7428' }
                    }
                  ]
                },
                url: 'http://example.com/club'
              },
              {
                id: 'event2',
                name: 'Outdoor Fest',
                dates: { start: { localDate: '2024-05-10' } },
                _embedded: {
                  venues: [
                    {
                      name: 'Zilker Park',
                      city: { name: 'Austin' },
                      state: { stateCode: 'TX' },
                      location: { latitude: '30.2669', longitude: '-97.7428' }
                    }
                  ]
                }
              }
            ]
          }
        })
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
      json: async () => ({ clientId: '', hasTicketmasterKey: true })
    });

    await initShowsPanel();
    await flush();

    const discoverBtn = document.getElementById('ticketmasterDiscoverBtn');
    expect(discoverBtn).not.toBeNull();

    fetch.mockClear();
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ name: 'Top Artist', id: 'artist1' }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _embedded: {
            events: [
              {
                id: 'event1',
                name: 'Club Night',
                dates: { start: { localDate: '2024-04-01' } },
                _embedded: {
                  venues: [
                    {
                      name: 'The Club',
                      city: { name: 'Austin' },
                      state: { stateCode: 'TX' },
                      location: { latitude: '30.2669', longitude: '-97.7428' }
                    }
                  ]
                },
                url: 'http://example.com/club'
              }
            ]
          }
        })
      });

    localStorage.setItem('spotifyToken', 'manual-token');
    discoverBtn._showsClickHandler();

    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toContain('api.spotify.com');
    expect(fetch.mock.calls[1][0]).toContain('/api/ticketmaster');
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasTicketmasterKey: true }) })
      .mockRejectedValue(new Error('fail'));
    localStorage.setItem('spotifyToken', 'tok');
    await initShowsPanel();
    document.getElementById('spotifyTokenBtn').dispatchEvent(new window.Event('click'));

    await flush();

    expect(localStorage.getItem('spotifyCodeVerifier')).toBeTruthy();
    expect(localStorage.getItem('spotifyToken')).toBe('tok');
    expect(localStorage.getItem('ticketmasterApiKey')).toBeFalsy();
  });

  it('exchanges authorization code for token', async () => {
    const dom = new JSDOM(`
      <button id="spotifyTokenBtn"></button>
      <span id="spotifyStatus"></span>
      <input id="ticketmasterApiKey" />
      <input id="showsRadius" value="300" />
      <input id="showsArtistLimit" value="10" />
      <input type="checkbox" id="showsIncludeSuggestions" checked />
      <button id="ticketmasterDiscoverBtn">Discover</button>
      <div id="ticketmasterList"></div>
      <div id="ticketmasterInterestedList"></div>
    `, { url: 'http://localhost/?code=abc' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasTicketmasterKey: true }) })
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

  it('falls back to manual Ticketmaster key input when server does not provide one', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasTicketmasterKey: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ name: 'Artist' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ _embedded: { events: [] } }) });

    localStorage.setItem('spotifyToken', 'token');
    const input = document.getElementById('ticketmasterApiKey');
    input.value = 'manualKey';

    await initShowsPanel();
    await flush();
    await flush();

    expect(fetch.mock.calls[2][0]).toContain('apiKey=manualKey');
  });

  it('shows Spotify suggestions when no live shows are available', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'cid', hasTicketmasterKey: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ name: 'Top Artist', id: 'artist1' }]
        })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ _embedded: { events: [] } }) })
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
