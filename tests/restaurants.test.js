import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

function setupDom() {
  return new JSDOM(
    `
      <div id="restaurantsPanel">
      <div id="restaurantsMap"></div>
      <div id="restaurantsResults">
        <form id="restaurantsFilters">
          <fieldset>
            <label for="restaurantsDistanceSelect">Within</label>
            <select id="restaurantsDistanceSelect">
              <option value="1">1 mile</option>
              <option value="2">2 miles</option>
              <option value="3">3 miles</option>
              <option value="4">4 miles</option>
              <option value="5">5 miles</option>
              <option value="6">6 miles</option>
              <option value="7">7 miles</option>
              <option value="8">8 miles</option>
              <option value="9">9 miles</option>
              <option value="10">10 miles</option>
              <option value="15">15 miles</option>
              <option value="20">20 miles</option>
              <option value="25" selected>25 miles</option>
              <option value="35">35 miles</option>
              <option value="50">50 miles</option>
              <option value="75">75 miles</option>
              <option value="100">100 miles</option>
            </select>
          </fieldset>
        </form>
        <div class="restaurants-tabs" role="tablist">
          <button type="button" class="restaurants-tab is-active" data-view="nearby" aria-selected="true"></button>
          <button type="button" class="restaurants-tab" data-view="saved" aria-selected="false"></button>
        </div>
        <div id="restaurantsNearby"></div>
        <div id="restaurantsSaved" hidden></div>
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

  it('requests location and renders restaurants sorted by rating', async () => {
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
      { name: 'Second Place', rating: 4.1, reviewCount: 120, distance: 1500 },
      { name: 'Top Rated', rating: 4.8, reviewCount: 45, distance: 1200 }
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

  it('filters out distant restaurants when coordinates are provided', async () => {
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
    expect(headings).toEqual(['Local Favorite']);
  });

  it('updates nearby restaurants when the distance filter changes', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;
    window.localStorage.clear();

    const geoMock = {
      getCurrentPosition: vi.fn(success => {
        success({ coords: { latitude: 35.2271, longitude: -80.8431 } });
      })
    };
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: geoMock
    });
    global.navigator = window.navigator;

    const sampleData = [
      { name: 'Nearby Spot', rating: 4.6, reviewCount: 80, distance: 2500 },
      { name: 'Across Town', rating: 4.3, reviewCount: 60, distance: 75000 }
    ];

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ address: { city: 'Charlotte' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sampleData)
      });

    await initRestaurantsPanel();

    let headings = Array.from(
      document.querySelectorAll('#restaurantsNearby h3')
    ).map(el => el.textContent);
    expect(headings).toEqual(['Nearby Spot']);

    const distanceSelect = document.getElementById('restaurantsDistanceSelect');
    distanceSelect.value = '50';
    distanceSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

    headings = Array.from(
      document.querySelectorAll('#restaurantsNearby h3')
    ).map(el => el.textContent);
    expect(headings).toEqual(['Nearby Spot', 'Across Town']);
  });

  it('shows an empty state message when no restaurants match the selected distance', async () => {
    const dom = setupDom();
    global.window = dom.window;
    global.document = dom.window.document;
    window.localStorage.clear();

    const geoMock = {
      getCurrentPosition: vi.fn(success => {
        success({ coords: { latitude: 34.0522, longitude: -118.2437 } });
      })
    };
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: geoMock
    });
    global.navigator = window.navigator;

    const sampleData = [
      { name: 'Far Place', rating: 4.5, reviewCount: 90, distance: 10000 },
      { name: 'Very Far Place', rating: 4.1, reviewCount: 60, distance: 15000 }
    ];

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ address: { city: 'Los Angeles' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sampleData)
      });

    await initRestaurantsPanel();

    const distanceSelect = document.getElementById('restaurantsDistanceSelect');
    distanceSelect.value = '1';
    distanceSelect.dispatchEvent(new window.Event('change', { bubbles: true }));

    const message = document.querySelector('#restaurantsNearby .restaurants-message');
    expect(message?.textContent).toContain('No restaurants found within 1 mile.');
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

    const updatedSaveButton = document.querySelector('#restaurantsNearby .restaurant-action--secondary');
    expect(updatedSaveButton).toBeTruthy();
    expect(updatedSaveButton.textContent).toBe('Saved');
    updatedSaveButton.click();

    expect(savedContainer?.textContent).toContain('No saved restaurants yet.');
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
