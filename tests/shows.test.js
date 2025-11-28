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
const createFetchResponse = (payload = { events: [], segments: [] }) => ({
  ok: true,
  text: async () => JSON.stringify(payload),
  json: async () => payload
});
const getFutureIso = (daysAhead = 1) => {
  const target = new Date(Date.now() + Number(daysAhead) * 24 * 60 * 60 * 1000);
  return target.toISOString();
};

describe('initShowsPanel (Ticketmaster)', () => {
  let initShowsPanel;
  let dom;

  async function setup({ apiBaseUrl = 'http://localhost:3003' } = {}) {
    storage.clear();
    vi.resetModules();

    if (apiBaseUrl === undefined || apiBaseUrl === null) {
      delete process.env.API_BASE_URL;
    } else {
      process.env.API_BASE_URL = apiBaseUrl;
    }

    dom = new JSDOM(`
      <div class="shows-toolbar">
        <div class="shows-tab-buttons" role="tablist" aria-label="Live music view">
          <button type="button" id="showsTabAll" class="shows-tab-btn is-active" data-view="all" aria-selected="true">All</button>
          <button type="button" id="showsTabSaved" class="shows-tab-btn" data-view="saved" aria-selected="false">Saved</button>
        </div>
        <div class="shows-toolbar__actions">
          <div class="shows-toolbar__control shows-toolbar__control--distance">
            <label for="showsDistanceSelect">Distance</label>
            <select id="showsDistanceSelect">
              <option value="10">10 mi</option>
              <option value="25">25 mi</option>
              <option value="50">50 mi</option>
              <option value="75">75 mi</option>
              <option value="100">100 mi</option>
              <option value="125">125 mi</option>
              <option value="150">150 mi</option>
            </select>
          </div>
          <div class="shows-toolbar__control shows-toolbar__control--date">
            <label for="showsDateInput">Through</label>
            <div class="shows-date-picker">
              <input type="date" id="showsDateInput" />
            </div>
          </div>
          <div class="shows-toolbar__shortcut-group" role="group" aria-label="Quick action links">
            <a href="#" class="shows-date-chip shows-toolbar__shortcut" data-days="0">Today</a>
            <a href="#" class="shows-date-chip shows-toolbar__shortcut" data-days="7">Next 7 days</a>
            <a href="#" id="showsRefreshBtn" class="shows-discover-btn shows-toolbar__shortcut">Check for new events</a>
          </div>
        </div>
      </div>
      <div id="showsList" class="decision-container"></div>
    `, { url: 'http://localhost/' });

    global.window = dom.window;
    global.document = dom.window.document;

    const geoMock = {
      geolocation: {
        getCurrentPosition: vi.fn(success => {
          success({
            coords: { latitude: 30.2672, longitude: -97.7431 }
          });
        })
      }
    };
    Object.defineProperty(global, 'navigator', {
      value: geoMock,
      configurable: true
    });
    Object.defineProperty(dom.window, 'navigator', {
      value: geoMock,
      configurable: true
    });

    global.fetch = vi.fn().mockResolvedValue(createFetchResponse());
    dom.window.fetch = global.fetch;

    ({ initShowsPanel } = await import('../js/shows.js'));
  }

  afterEach(() => {
    delete process.env.API_BASE_URL;
    if (dom) {
      dom.window.close();
    }
  });

  it('automatically fetches nearby events', async () => {
    await setup();

    const liveShowResponse = {
      events: [
      {
        name: { text: 'Live Show' },
        start: { local: getFutureIso(3) },
          url: 'https://ticketmaster.test/events/1',
          venue: { name: 'Club', address: { city: 'Austin', region: 'TX' } },
          summary: 'An evening performance.'
        }
      ],
      segments: [
        {
          key: 'music',
          description: 'Live music',
          ok: true,
          status: 200,
          total: 1,
          requestUrl: 'https://ticketmaster.test/api/music'
        }
      ],
      cached: false
    };

    fetch.mockResolvedValueOnce(createFetchResponse(liveShowResponse));

    await initShowsPanel();
    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [showsRequest] = fetch.mock.calls[0];
    expect(showsRequest).toContain('/api/shows');
    expect(showsRequest).toContain('lat=30.2672');
    expect(showsRequest).toContain('lon=-97.7431');
    expect(showsRequest).toContain('radius=100');

    const cards = document.querySelectorAll('.show-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Live Show');

    const mediaLinks = document.querySelectorAll('.show-card__external-link');
    expect(mediaLinks.length).toBe(2);
    expect(mediaLinks[0].href).toContain('youtube.com');
    expect(mediaLinks[1].href).toContain('spotify.com');

    const summary = document.querySelector('.shows-list-summary');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain('Distance:');
    expect(summary?.textContent).toContain('Through');
    expect(summary?.textContent).toContain('Showing 1 upcoming event');

  });

  it('routes requests through the remote proxy when no API base override is provided', async () => {
    await setup({ apiBaseUrl: null });

    await initShowsPanel();

    await flush();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [showsRequest] = fetch.mock.calls[0];
    expect(showsRequest.startsWith('https://live-events-6f3e5.web.app/api/shows')).toBe(true);
  });

  it('shows a helpful message when geolocation fails', async () => {
    await setup();

    navigator.geolocation.getCurrentPosition.mockImplementationOnce((success, error) => {
      error({ code: 1, PERMISSION_DENIED: 1, message: 'Location access was denied.' });
    });

    await initShowsPanel();

    await flush();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders genre checkboxes with bulk actions and persistent hide control', async () => {
    await setup();

    fetch.mockResolvedValueOnce(
      createFetchResponse({
        events: [
          {
            name: { text: 'Genre Show' },
            start: { local: getFutureIso(5) },
            venue: { name: 'Side Stage', address: { city: 'Austin', region: 'TX' } },
            genres: ['Rock', 'Indie Rock']
          }
        ],
        segments: [],
        cached: false
      })
    );

    await initShowsPanel();
    await flush();
    await flush();

    const filtersPanel = document.querySelector('.shows-results__filters');
    expect(filtersPanel).not.toBeNull();

    const checkboxes = filtersPanel.querySelectorAll('.show-genre-checkbox input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThan(0);

    const actionLinks = Array.from(filtersPanel.querySelectorAll('.show-genre-action-link'));
    const checkAllLink = actionLinks.find(link => /check all/i.test(link.textContent));
    const checkNoneLink = actionLinks.find(link => /check none/i.test(link.textContent));
    expect(checkAllLink).toBeTruthy();
    expect(checkNoneLink).toBeTruthy();
    const tagHideButtons = filtersPanel.querySelectorAll('.show-genre-hide-btn');
    expect(tagHideButtons.length).toBeGreaterThan(0);

    checkNoneLink?.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    await flush();

    const emptyState = document.querySelector('.shows-empty');
    expect(emptyState).not.toBeNull();
    expect(emptyState.textContent).toContain('Select at least one tag');

    checkAllLink?.dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    await flush();

    const refreshedCheckboxes = document.querySelectorAll('.show-genre-checkbox input[type="checkbox"]');
    expect(Array.from(refreshedCheckboxes).every(box => box.checked)).toBe(true);

    const hiddenGenreName = tagHideButtons[0].closest('.show-genre-checkbox')?.dataset.genre || '';
    tagHideButtons[0].click();
    await flush();

    const filtersAfterHide = document.querySelector('.shows-results__filters');
    expect(filtersAfterHide).not.toBeNull();
    const remainingTags = filtersAfterHide.querySelectorAll('.show-genre-checkbox');
    expect(remainingTags.length).toBeLessThan(checkboxes.length);
    const hiddenGenresSaved = JSON.parse(localStorage.getItem('shows.hiddenGenres') || '[]');
    if (hiddenGenreName) {
      expect(hiddenGenresSaved).toContain(hiddenGenreName.toLowerCase());
    }
  });

  it('shows cached events without fetching until refreshed', async () => {
    await setup();

    localStorage.setItem(
      'shows.cachedEvents',
      JSON.stringify({
        events: [
          {
            name: { text: 'Cached Show' },
            start: { local: getFutureIso(7) },
            venue: { name: 'Cached Venue', address: { city: 'Austin', region: 'TX' } },
            summary: 'Previously fetched event.'
          }
        ],
        fetchedAt: 1700000000000
      })
    );

    await initShowsPanel();
    await flush();

    const showCallsAfterInit = fetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/api/shows')
    );
    expect(showCallsAfterInit.length).toBe(0);
    const cards = document.querySelectorAll('.show-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Cached Show');

    const summary = document.querySelector('.shows-list-summary');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain('Distance:');
    expect(summary?.textContent).toContain('Showing 1 cached event');

    fetch.mockClear();
    fetch.mockImplementation(url => {
      if (typeof url === 'string' && url.includes('/api/shows')) {
        return Promise.resolve(
          createFetchResponse({
            events: [],
            segments: [],
            cached: false
          })
        );
      }
      return Promise.resolve(createFetchResponse());
    });

    const refreshBtn = document.getElementById('showsRefreshBtn');
    refreshBtn.click();

    await flush();
    await flush();
    await flush();

    const showCallsAfterRefresh = fetch.mock.calls.filter(([url]) => {
      return typeof url === 'string' && url.includes('/api/shows');
    });
    expect(showCallsAfterRefresh.length).toBeGreaterThanOrEqual(1);
  });
});
