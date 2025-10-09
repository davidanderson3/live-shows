import { describe, it, expect, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const storage = (() => {
  let store = {};
  return {
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: key => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

global.localStorage = storage;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('initShowsPanel (Eventbrite)', () => {
  let initShowsPanel;
  let dom;

  async function setup({ apiBaseUrl = 'http://localhost:3003', token } = {}) {
    storage.clear();
    vi.resetModules();

    if (token) {
      localStorage.setItem('eventbriteTokenV1', token);
    }

    if (apiBaseUrl === undefined || apiBaseUrl === null) {
      delete process.env.API_BASE_URL;
    } else {
      process.env.API_BASE_URL = apiBaseUrl;
    }

    dom = new JSDOM(`
      <input id="eventbriteApiToken" />
      <button id="eventbriteDiscoverBtn">Discover</button>
      <div id="eventbriteStatus"></div>
      <details id="eventbriteDebug" hidden>
        <summary>Latest API response</summary>
        <pre id="eventbriteDebugOutput"></pre>
      </details>
      <div id="eventbriteList"></div>
    `, { url: 'http://localhost/' });

    global.window = dom.window;
    global.document = dom.window.document;

    global.navigator = {
      geolocation: {
        getCurrentPosition: vi.fn(success => {
          success({
            coords: { latitude: 30.2672, longitude: -97.7431 }
          });
        })
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ events: [] })
    });

    ({ initShowsPanel } = await import('../js/shows.js'));
  }

  afterEach(() => {
    delete process.env.API_BASE_URL;
    if (dom) {
      dom.window.close();
    }
  });

  it('hydrates the Eventbrite token from storage and sets initial status', async () => {
    await setup({ token: 'stored-token' });

    await initShowsPanel();

    const tokenInput = document.getElementById('eventbriteApiToken');
    const status = document.getElementById('eventbriteStatus');

    expect(tokenInput.value).toBe('stored-token');
    expect(status.textContent).toContain('Enter your Eventbrite personal token');
  });

  it('fetches nearby events when Discover is clicked', async () => {
    await setup();

    fetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          events: [
            {
              name: { text: 'Live Show' },
              start: { local: '2024-01-01T20:00:00' },
              url: 'https://eventbrite.test/events/1',
              venue: { name: 'Club', address: { city: 'Austin', region: 'TX' } },
              summary: 'An evening performance.'
            }
          ]
        })
    });

    await initShowsPanel();

    const button = document.getElementById('eventbriteDiscoverBtn');
    button.click();

    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    const requestedUrl = fetch.mock.calls[0][0];
    expect(requestedUrl).toContain('/api/eventbrite');
    expect(requestedUrl).toContain('lat=30.2672');
    expect(requestedUrl).toContain('lon=-97.7431');
    expect(requestedUrl).toContain('radius=100');

    const cards = document.querySelectorAll('.show-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Live Show');

    const status = document.getElementById('eventbriteStatus');
    expect(status.textContent).toContain('Found 1 upcoming event');

    const debugContainer = document.getElementById('eventbriteDebug');
    const debugOutput = document.getElementById('eventbriteDebugOutput');
    expect(debugContainer.hidden).toBe(false);
    expect(debugOutput.textContent).toContain('Request URL:');
    expect(debugOutput.textContent).toContain('Live Show');
  });

  it('routes Eventbrite requests through the remote proxy when no API base override is provided', async () => {
    await setup({ apiBaseUrl: null });

    await initShowsPanel();

    const button = document.getElementById('eventbriteDiscoverBtn');
    button.click();

    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    const requestedUrl = fetch.mock.calls[0][0];
    expect(requestedUrl.startsWith('https://narrow-down.web.app/api/eventbrite')).toBe(true);
  });

  it('shows a helpful message when geolocation fails', async () => {
    await setup();

    navigator.geolocation.getCurrentPosition.mockImplementationOnce((success, error) => {
      error({ code: 1, PERMISSION_DENIED: 1 });
    });

    await initShowsPanel();

    document.getElementById('eventbriteDiscoverBtn').click();

    await flush();

    expect(fetch).not.toHaveBeenCalled();
    expect(document.getElementById('eventbriteStatus').textContent).toContain('Location access was denied');
    expect(document.getElementById('eventbriteDebug').hidden).toBe(true);
  });
});
