import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

function setupDom() {
  return new JSDOM(
    `
      <div id="restaurantsPanel">
      <div id="restaurantsMap"></div>
      <div id="restaurantsResults">
        <div class="restaurants-tabs" role="tablist">
          <button type="button" class="restaurants-tab is-active" data-view="nearby" aria-selected="true"></button>
          <button type="button" class="restaurants-tab" data-view="saved" aria-selected="false"></button>
          <button type="button" class="restaurants-tab" data-view="favorites" aria-selected="false"></button>
        </div>
        <div id="restaurantsNearby"></div>
        <div id="restaurantsSaved" hidden></div>
        <div id="restaurantsFavorites" hidden></div>
        <div id="restaurantsHiddenSection"></div>
      </div>
    </div>
  `,
    { url: 'https://example.com' }
  );
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

  it('requests location and renders restaurants sorted by distance', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;
    window.localStorage.clear();

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
      { name: 'Closest Diner', rating: 3.9, reviewCount: 10, distance: 500 },
      { name: 'Top Rated', rating: 4.8, reviewCount: 45, distance: 1200 },
      { name: 'Far Favorite', rating: 5.0, reviewCount: 200, distance: 5000 }
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
    expect(fetch.mock.calls[1][0]).toContain('limit=60');
    expect(fetch.mock.calls[1][0]).toContain('city=Austin');

    const results = document.getElementById('restaurantsResults');
    const headings = Array.from(results.querySelectorAll('h3')).map(el => el.textContent);
    expect(headings).toEqual(['Closest Diner', 'Top Rated', 'Far Favorite']);
  });

  it('shows message when location permission denied', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;
    window.localStorage.clear();

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
    window.localStorage.clear();

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

  it('renders all restaurants returned by the API', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;
    window.localStorage.clear();

    const geoMock = {
      getCurrentPosition: vi.fn(success => {
        success({ coords: { latitude: 37.7749, longitude: -122.4194 } });
      })
    };
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: geoMock
    });
    global.navigator = window.navigator;

    const sampleData = [
      { name: 'Local Favorite', rating: 4.5, reviewCount: 210, distance: 2000 },
      { name: 'Distant Gem', rating: 5.0, reviewCount: 12, distance: 500000 }
    ];

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ address: { city: 'San Francisco' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sampleData)
      });

    await initRestaurantsPanel();

    const results = document.getElementById('restaurantsResults');
    const headings = Array.from(results.querySelectorAll('h3')).map(el => el.textContent);
    expect(headings).toEqual(['Local Favorite', 'Distant Gem']);
  });

  it('requests more restaurants when the initial search returns none', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;
    window.localStorage.clear();

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

    const fallbackData = [
      { name: 'Fallback Favorite', rating: 4.5, reviewCount: 120, distance: 900 },
      { name: 'Backup Bistro', rating: 4.2, reviewCount: 80, distance: 1500 }
    ];

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ address: { city: 'Austin' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([])
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(fallbackData)
      });

    await initRestaurantsPanel();

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1][0]).toContain('latitude=30.2672');
    expect(fetch.mock.calls[1][0]).toContain('longitude=-97.7431');
    expect(fetch.mock.calls[1][0]).toContain('limit=60');
    expect(fetch.mock.calls[2][0]).toContain('city=Austin');
    expect(fetch.mock.calls[2][0]).toContain('limit=60');
    expect(fetch.mock.calls[2][0]).not.toContain('latitude=');
    expect(fetch.mock.calls[2][0]).not.toContain('longitude=');

    const results = document.getElementById('restaurantsResults');
    const headings = Array.from(results.querySelectorAll('h3')).map(el => el.textContent);
    expect(headings).toEqual(['Fallback Favorite', 'Backup Bistro']);
  });

  it('uses user coordinates to sort by true distance even when API distances are misleading', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;
    window.localStorage.clear();

    const geoMock = {
      getCurrentPosition: vi.fn(success => {
        success({ coords: { latitude: 37.7749, longitude: -122.4194 } });
      })
    };
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: geoMock
    });
    global.navigator = window.navigator;

    const sampleData = [
      {
        name: 'Far Bistro',
        rating: 4.9,
        reviewCount: 320,
        distance: 100,
        latitude: 37.8044,
        longitude: -122.2711
      },
      {
        name: 'Nearby Cafe',
        rating: 3.1,
        reviewCount: 12,
        distance: 5000,
        latitude: 37.7755,
        longitude: -122.4189
      }
    ];

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ address: { city: 'San Francisco' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sampleData)
      });

    await initRestaurantsPanel();

    const headings = Array.from(
      document.querySelectorAll('#restaurantsNearby h3')
    ).map(el => el.textContent);
    expect(headings).toEqual(['Nearby Cafe', 'Far Bistro']);
  });

  it('allows saving and unsaving restaurants', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;
    window.localStorage.clear();

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
      { id: 'one', name: 'Top Rated', rating: 4.8, reviewCount: 45, distance: 1200 },
      { id: 'two', name: 'Second Place', rating: 4.1, reviewCount: 120, distance: 1500 }
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

    const saveButton = document.querySelector('#restaurantsNearby .restaurant-action--secondary');
    expect(saveButton).toBeTruthy();
    expect(saveButton.textContent).toBe('Save');
    saveButton.click();

    const savedContainer = document.getElementById('restaurantsSaved');
    expect(savedContainer?.textContent).toContain('Top Rated');

    const nearbyContainer = document.getElementById('restaurantsNearby');
    expect(nearbyContainer?.textContent).not.toContain('Top Rated');

    const savedSectionButton = savedContainer?.querySelector('.restaurant-action--secondary');
    expect(savedSectionButton).toBeTruthy();
    expect(savedSectionButton?.textContent).toBe('Saved');
    savedSectionButton?.click();

    expect(savedContainer?.textContent).toContain('No saved restaurants yet.');
    expect(nearbyContainer?.textContent).toContain('Top Rated');
  });

  it('allows favoriting restaurants and keeps favorites in sync with saved list', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;
    window.localStorage.clear();

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
      { id: 'one', name: 'Top Rated', rating: 4.8, reviewCount: 45, distance: 1200 }
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

    const favoriteButton = document.querySelector(
      '#restaurantsNearby .restaurant-action--favorite'
    );
    expect(favoriteButton).toBeTruthy();
    expect(favoriteButton?.textContent).toBe('Favorite');
    favoriteButton?.click();

    const favoritesContainer = document.getElementById('restaurantsFavorites');
    expect(favoritesContainer?.textContent).toContain('Top Rated');

    const savedContainer = document.getElementById('restaurantsSaved');
    expect(savedContainer?.textContent).toContain('No saved restaurants yet.');

    const savedToggle = favoritesContainer?.querySelector('.restaurant-action--secondary');
    expect(savedToggle?.textContent).toBe('Saved');
    savedToggle?.click();

    expect(favoritesContainer?.textContent).toContain('No favorite restaurants yet.');
    expect(savedContainer?.textContent).toContain('No saved restaurants yet.');
    const nearbyContainer = document.getElementById('restaurantsNearby');
    expect(nearbyContainer?.textContent).toContain('Top Rated');
  });

  it('moves hidden restaurants to the hidden section', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;
    window.localStorage.clear();

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
      { id: 'one', name: 'Top Rated', rating: 4.8, reviewCount: 45, distance: 1200 },
      { id: 'two', name: 'Second Place', rating: 4.1, reviewCount: 120, distance: 1500 }
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

    const hideButton = Array.from(
      document.querySelectorAll('#restaurantsNearby .restaurant-action--danger')
    )[0];
    expect(hideButton).toBeTruthy();
    hideButton.click();

    const nearbyHeadings = Array.from(
      document.querySelectorAll('#restaurantsNearby h3')
    ).map(el => el.textContent);
    expect(nearbyHeadings).toEqual(['Second Place']);

    const hiddenSection = document.getElementById('restaurantsHiddenSection');
    expect(hiddenSection?.classList.contains('is-visible')).toBe(true);

    const toggle = hiddenSection?.querySelector('.restaurants-hidden-toggle');
    expect(toggle?.textContent).toContain('Hidden Restaurants (1)');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    toggle?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    const expandedToggle = hiddenSection?.querySelector('.restaurants-hidden-toggle');
    expect(expandedToggle?.getAttribute('aria-expanded')).toBe('true');

    const list = hiddenSection?.querySelector('.restaurants-hidden-list');
    expect(list?.hidden).toBe(false);
    expect(list?.textContent).toContain('Top Rated');
  });
});
