import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

function setupDom() {
  return new JSDOM(`
    <div id="restaurantsPanel">
      <div id="restaurantsResults"></div>
    </div>
  `);
}

describe('initRestaurantsPanel', () => {
  let initRestaurantsPanel;

  beforeEach(async () => {
    vi.resetModules();
    ({ initRestaurantsPanel } = await import('../js/restaurants.js'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
    delete global.window;
    delete global.document;
    delete global.navigator;
  });

  it('requests location and renders restaurants sorted by rating', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;

    const geoMock = {
      getCurrentPosition: vi.fn(success => {
        success({ coords: { latitude: 30.2672, longitude: -97.7431 } });
      })
    };
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: geoMock
    });
    global.navigator = window.navigator;

    const sampleData = [
      { name: 'Second Place', rating: 4.1, reviewCount: 120 },
      { name: 'Top Rated', rating: 4.8, reviewCount: 45 }
    ];

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ address: { city: 'Austin' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sampleData)
      });

    await initRestaurantsPanel();

    expect(geoMock.getCurrentPosition).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toContain('reverse');
    expect(fetch.mock.calls[1][0]).toContain('latitude=30.2672');
    expect(fetch.mock.calls[1][0]).toContain('longitude=-97.7431');
    expect(fetch.mock.calls[1][0]).toContain('city=Austin');

    const results = document.getElementById('restaurantsResults');
    const headings = Array.from(results.querySelectorAll('h3')).map(el => el.textContent);
    expect(headings[0]).toBe('Top Rated');
  });

  it('shows message when location permission denied', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;

    const geoMock = {
      getCurrentPosition: vi.fn((_, error) => {
        error({ code: 1 });
      })
    };
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: geoMock
    });
    global.navigator = window.navigator;

    global.fetch = vi.fn();

    await initRestaurantsPanel();

    const results = document.getElementById('restaurantsResults');
    expect(results.textContent).toContain('Location access is required');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows API error messages', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;

    const geoMock = {
      getCurrentPosition: vi.fn(success => {
        success({ coords: { latitude: 40.0, longitude: -74.0 } });
      })
    };
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: geoMock
    });
    global.navigator = window.navigator;

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ address: { city: 'New York' } })
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'failed' })
      });

    await initRestaurantsPanel();

    const results = document.getElementById('restaurantsResults');
    expect(results.textContent).toContain('failed');
  });
});
