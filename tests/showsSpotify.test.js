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
                _embedded: { venues: [{ name: 'Venue', city: { name: 'City' }, state: { stateCode: 'ST' } }] },
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
    expect(document.querySelectorAll('#ticketmasterList li').length).toBe(1);
    expect(fetch.mock.calls[2][0]).toContain('/api/ticketmaster');
    expect(fetch.mock.calls[2][0]).not.toContain('apiKey=');
    expect(document.querySelector('#ticketmasterList li').textContent).toContain('Concert');
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
