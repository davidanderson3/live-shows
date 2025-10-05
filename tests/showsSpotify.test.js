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
      <input id="spotifyToken" />
      <input id="ticketmasterApiKey" />
      <div id="ticketmasterList"></div>
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

    localStorage.setItem('spotifyToken', 'token');
    await initShowsPanel();

    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(document.querySelectorAll('.show-card').length).toBe(1);
    expect(fetch.mock.calls[2][0]).toContain('/api/ticketmaster');
    expect(fetch.mock.calls[2][0]).not.toContain('apiKey=');
    expect(document.querySelector('.show-card__title')?.textContent).toContain('Concert');
    expect(document.querySelector('.show-card__cta')?.textContent).toBe('Get Tickets');
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
      <input id="spotifyToken" />
      <input id="ticketmasterApiKey" />
      <div id="ticketmasterList"></div>
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
    expect(document.getElementById('spotifyToken').value).toBe('');
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
});
