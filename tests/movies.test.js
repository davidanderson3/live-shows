import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const firestoreDocMock = {
  set: vi.fn().mockResolvedValue(),
  get: vi.fn().mockResolvedValue({ exists: false })
};

const collectionMock = vi.fn(() => ({ doc: () => firestoreDocMock }));

const authModuleMock = {
  getCurrentUser: vi.fn(() => null),
  awaitAuthUser: vi.fn(() => Promise.resolve(null)),
  db: { collection: collectionMock }
};

vi.mock('../js/auth.js', () => authModuleMock);

let initMoviesPanel;

function buildDom() {
  return new JSDOM(`
    <div id="movieTabs" class="movie-tabs">
      <button class="movie-tab active" data-target="movieStreamSection"></button>
      <button class="movie-tab" data-target="savedMoviesSection"></button>
      <button class="movie-tab" data-target="watchedMoviesSection"></button>
    </div>
    <div id="movieStreamSection">
      <div id="movieFeedControls" class="movie-controls">
        <input id="movieFilterMinRating" type="number" />
        <input id="movieFilterMinVotes" type="number" />
        <input id="movieFilterStartYear" type="number" />
        <input id="movieFilterEndYear" type="number" />
        <select id="movieFilterGenre"></select>
      </div>
      <div id="movieStatus" class="movie-status"></div>
      <div id="movieList"></div>
    </div>
    <div id="savedMoviesSection" style="display:none">
      <div id="savedMoviesFilters" class="genre-filter"></div>
      <div id="savedMoviesList"></div>
    </div>
    <div id="watchedMoviesSection" style="display:none">
      <div id="watchedMoviesControls" class="movie-controls">
        <label for="watchedMoviesSort">Sort by:</label>
        <select id="watchedMoviesSort">
          <option value="recent">Recently Updated</option>
          <option value="ratingDesc">Rating: High to Low</option>
          <option value="ratingAsc">Rating: Low to High</option>
        </select>
      </div>
      <div id="watchedMoviesList"></div>
    </div>
    <div id="moviesApiKeyContainer"><input id="moviesApiKey" type="password" /></div>
  `);
}

function mockLocalStorage() {
  const store = new Map();
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
    clear: () => store.clear()
  };
}

function attachWindow(dom) {
  global.window = dom.window;
  global.document = dom.window.document;
  window.tmdbProxyEndpoint = '';
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: () => global.localStorage
  });
}

function configureFetchResponses(responses) {
  const queue = Array.isArray(responses) ? [...responses] : [];
  const fallback = queue.length ? queue[queue.length - 1] : {};
  global.fetch = vi.fn().mockImplementation(() => {
    const next = queue.length ? queue.shift() : fallback;
    if (next && typeof next === 'object' && 'ok' in next && typeof next.ok === 'boolean') {
      const { ok, json } = next;
      if (typeof json === 'function') {
        return Promise.resolve({ ok, json });
      }
      const payload = { ...next };
      return Promise.resolve({
        ok,
        json: () => Promise.resolve(payload.jsonPayload ?? payload.body ?? payload.data ?? {})
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(next ?? {})
    });
  });
}

describe('initMoviesPanel', () => {
  beforeEach(async () => {
    vi.resetModules();
    authModuleMock.getCurrentUser.mockReturnValue(null);
    authModuleMock.awaitAuthUser.mockResolvedValue(null);
    firestoreDocMock.get.mockResolvedValue({ exists: false });
    firestoreDocMock.set.mockClear();
    collectionMock.mockReturnValue({ doc: () => firestoreDocMock });
    ({ initMoviesPanel } = await import('../js/movies.js'));
    global.localStorage = mockLocalStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
    delete global.window;
    delete global.document;
    delete global.localStorage;
  });

  it('renders movies with action buttons and metadata', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbApiKey = 'TEST_KEY';

    const page = {
      results: [
        {
          id: 1,
          title: 'Sample Movie',
          release_date: '2024-01-01',
          vote_average: 7.5,
          vote_count: 120,
          overview: 'An exciting film.',
          genre_ids: [28],
          poster_path: '/poster.jpg'
        }
      ]
    };
    const empty = { results: [] };
    const credits = {
      cast: [
        { name: 'Lead Star' },
        { name: 'Supporting Actor' }
      ],
      crew: [
        { job: 'Director', name: 'Jane Doe' },
        { job: 'Producer', name: 'Producer Person' }
      ]
    };
    const genres = { genres: [{ id: 28, name: 'Action' }] };

    configureFetchResponses([page, empty, credits, genres]);

    await initMoviesPanel();

    const card = document.querySelector('#movieList li');
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Sample Movie');
    expect(card.textContent).toContain('Average Score: 7.5');
    expect(card.textContent).toContain('Votes: 120');
    const metaText = card.querySelector('.movie-meta')?.textContent || '';
    expect(metaText).toContain('Genres: Action');
    expect(metaText).toContain('Director: Jane Doe');
    expect(metaText).toContain('Cast: Lead Star, Supporting Actor');

    const buttons = Array.from(card.querySelectorAll('button')).map(b => b.textContent);
    expect(buttons).toEqual(['Watched Already', 'Not Interested', 'Interested']);

    const img = card.querySelector('img');
    expect(img?.src).toContain('https://image.tmdb.org/t/p/w200/poster.jpg');

    const statusText = document.getElementById('movieStatus')?.textContent || '';
    expect(statusText).toContain('Loaded 1 movie on attempt 1');
    expect(statusText).toContain('1 match your current filters');
  });

  it('provides guidance when TMDB API key is missing', async () => {
    const dom = buildDom();
    attachWindow(dom);

    const originalVitest = process.env.VITEST;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';

    try {
      await initMoviesPanel();
    } finally {
      if (originalVitest === undefined) {
        delete process.env.VITEST;
      } else {
        process.env.VITEST = originalVitest;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }

    const listText = document.getElementById('movieList')?.innerHTML || '';
    expect(listText).toContain('TMDB API key not provided');
    const statusText = document.getElementById('movieStatus')?.textContent || '';
    expect(statusText).toBe(
      'TMDB API key not provided. Enter a key or enable the proxy to load movies.'
    );
  });

  it('reports failure details when TMDB request fails', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbApiKey = 'FAIL_KEY';

    configureFetchResponses([{ ok: false }]);

    await initMoviesPanel();

    const statusText = document.getElementById('movieStatus')?.textContent || '';
    expect(statusText).toBe(
      'Attempt 1 using the direct TMDB API failed (Failed to fetch movies). No movies were loaded. Check your TMDB API key and try again.'
    );
  });

  it('filters out movies below rating or vote thresholds', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbApiKey = 'TEST_KEY';

    const page = {
      results: [
        {
          id: 42,
          title: 'Top Tier',
          release_date: '2024-02-01',
          vote_average: 8.5,
          vote_count: 500,
          overview: 'Critically acclaimed.',
          genre_ids: []
        },
        {
          id: 43,
          title: 'Too Few Votes',
          release_date: '2024-02-02',
          vote_average: 8.5,
          vote_count: 20,
          overview: 'Not enough data.',
          genre_ids: []
        },
        {
          id: 44,
          title: 'Too Low Rating',
          release_date: '2024-02-03',
          vote_average: 6.5,
          vote_count: 600,
          overview: 'Audience lukewarm.',
          genre_ids: []
        }
      ]
    };
    const empty = { results: [] };
    const credits = {
      cast: [{ name: 'Award Winner' }],
      crew: [{ job: 'Director', name: 'Visionary Director' }]
    };
    const genres = { genres: [] };
    const morePage = {
      results: [
        {
          id: 10,
          title: 'Another Remote Pick',
          release_date: '2024-05-05',
          vote_average: 7.5,
          vote_count: 95,
          overview: 'Extra selection.',
          genre_ids: []
        }
      ]
    };
    const moreCredits = {
      cast: [{ name: 'Backup Star' }],
      crew: [{ job: 'Director', name: 'Backup Director' }]
    };

    configureFetchResponses([
      page,
      empty,
      credits,
      genres,
      morePage,
      empty,
      moreCredits,
      genres,
      morePage,
      empty,
      moreCredits,
      genres
    ]);

    await initMoviesPanel();

    const movieTitles = Array.from(document.querySelectorAll('#movieList li h3')).map(h => h.textContent);
    expect(movieTitles).toHaveLength(1);
    expect(movieTitles[0]).toContain('Top Tier');
    expect(document.querySelector('#movieList').textContent).not.toContain('Too Few Votes');
    expect(document.querySelector('#movieList').textContent).not.toContain('Too Low Rating');
  });

  it('refills the feed for restrictive filters before showing no-match message', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbApiKey = 'TEST_KEY';

    const initialPage = {
      results: [
        {
          id: 100,
          title: 'Solid Choice',
          release_date: '2022-01-01',
          vote_average: 7.4,
          vote_count: 210,
          overview: 'Popular but below new threshold.',
          genre_ids: []
        }
      ],
      total_pages: 1
    };
    const emptyPage = { results: [], total_pages: 1 };
    const credits = {
      cast: [{ name: 'Reliable Star' }],
      crew: [{ job: 'Director', name: 'Steady Director' }]
    };
    const genres = { genres: [] };

    configureFetchResponses([
      initialPage,
      emptyPage,
      credits,
      genres,
      emptyPage,
      genres
    ]);

    await initMoviesPanel();

    const listEl = document.getElementById('movieList');
    expect(listEl.textContent).toContain('Solid Choice');

    const minRatingInput = document.getElementById('movieFilterMinRating');
    minRatingInput.value = '9';
    minRatingInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    minRatingInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    expect(listEl.innerHTML).toContain('Loading more movies...');

    await new Promise(resolve => setTimeout(resolve, 10));
    await new Promise(resolve => setTimeout(resolve, 10));
    for (let i = 0; i < 10 && listEl.innerHTML.includes('Loading more movies'); i += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    expect(global.fetch.mock.calls.length).toBeGreaterThan(4);
    expect(listEl.innerHTML).toContain('No movies match the current filters.');
  });

  it('marks the selected movie tab clearly', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbApiKey = 'TEST_KEY';

    configureFetchResponses([
      { results: [], total_pages: 1 },
      { genres: [] }
    ]);

    await initMoviesPanel();

    const tabs = Array.from(document.querySelectorAll('#movieTabs .movie-tab'));
    expect(tabs).toHaveLength(3);
    expect(tabs[0].classList.contains('active')).toBe(true);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(tabs[2].getAttribute('aria-selected')).toBe('false');

    tabs[1].dispatchEvent(new window.Event('click'));

    expect(tabs[0].classList.contains('active')).toBe(false);
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].classList.contains('active')).toBe(true);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });

  it('prioritizes movies using weighted score (75% average, 25% votes)', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbApiKey = 'TEST_KEY';

    const page = {
      results: [
        {
          id: 10,
          title: 'High Votes',
          release_date: '2024-05-01',
          vote_average: 8,
          vote_count: 400,
          overview: 'Popular film.',
          genre_ids: []
        },
        {
          id: 11,
          title: 'Low Votes',
          release_date: '2024-06-01',
          vote_average: 8,
          vote_count: 80,
          overview: 'Less popular film.',
          genre_ids: []
        }
      ]
    };
    const empty = { results: [] };
    const creditsHigh = {
      cast: [{ name: 'Popular Lead' }],
      crew: [{ job: 'Director', name: 'High Director' }]
    };
    const creditsLow = {
      cast: [{ name: 'Indie Lead' }],
      crew: [{ job: 'Director', name: 'Low Director' }]
    };
    const genres = { genres: [] };

    configureFetchResponses([page, empty, creditsHigh, creditsLow, genres]);

    await initMoviesPanel();

    const headings = Array.from(document.querySelectorAll('#movieList li h3')).map(h => h.textContent);
    expect(headings[0]).toContain('High Votes');
    expect(headings[1]).toContain('Low Votes');
  });

  it('moves interested movies to the interested list with adjustable slider', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbApiKey = 'TEST_KEY';

    const page = {
      results: [
        {
          id: 2,
          title: 'Future Hit',
          release_date: '2024-03-15',
          vote_average: 8.2,
          vote_count: 84,
          overview: 'Must-watch film.',
          genre_ids: [18],
          poster_path: '/future.jpg'
        }
      ]
    };
    const empty = { results: [] };
    const credits = {
      cast: [{ name: 'Breakout Star' }],
      crew: [{ job: 'Director', name: 'Indie Director' }]
    };
    const genres = { genres: [{ id: 18, name: 'Drama' }] };
    const morePage = {
      results: [
        {
          id: 3,
          title: 'Next Up',
          release_date: '2023-11-10',
          vote_average: 7.9,
          vote_count: 110,
          overview: 'Another great option.',
          genre_ids: [18]
        }
      ]
    };
    const moreCredits = {
      cast: [{ name: 'Another Star' }],
      crew: [{ job: 'Director', name: 'New Director' }]
    };

    configureFetchResponses([
      page,
      empty,
      credits,
      genres,
      morePage,
      empty,
      moreCredits,
      genres
    ]);

    await initMoviesPanel();

    const interestedBtn = Array.from(document.querySelectorAll('#movieList li button')).find(
      b => b.textContent === 'Interested'
    );
    interestedBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.querySelector('#movieList').textContent).toContain('Next Up');
    const slider = document.querySelector('#savedMoviesList input[type="range"]');
    expect(slider).not.toBeNull();
    expect(slider.value).toBe('3');

    const label = document.querySelector('#savedMoviesList .interest-row span');
    expect(label?.textContent).toBe('Interest: 3');

    slider.value = '5';
    slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    slider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(label?.textContent).toBe('Interest: 5');
    const stored = JSON.parse(global.localStorage.getItem('moviePreferences'));
    expect(stored['2'].interest).toBe(5);
    const meta = document.querySelector('#savedMoviesList .movie-meta')?.textContent || '';
    expect(meta).toContain('Genres: Drama');
    expect(meta).toContain('Director: Indie Director');
    expect(meta).toContain('Cast: Breakout Star');
  });

  it('filters saved movies by genre tags', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbApiKey = 'TEST_KEY';

    const userId = 'genre-user';
    authModuleMock.getCurrentUser.mockReturnValue({ uid: userId });
    authModuleMock.awaitAuthUser.mockResolvedValue({ uid: userId });

    firestoreDocMock.get.mockResolvedValue({
      exists: true,
      data: () => ({
        prefs: {
          '1': {
            status: 'interested',
            interest: 4,
            updatedAt: 2,
            movie: {
              id: 1,
              title: 'Drama Pick',
              release_date: '2023-01-01',
              poster_path: '',
              overview: '',
              genre_ids: [101]
            }
          },
          '2': {
            status: 'interested',
            interest: 3,
            updatedAt: 1,
            movie: {
              id: 2,
              title: 'Comedy Night',
              release_date: '2023-02-02',
              poster_path: '',
              overview: '',
              genre_ids: [102]
            }
          }
        }
      })
    });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            genres: [
              { id: 101, name: 'Drama' },
              { id: 102, name: 'Comedy' }
            ]
          })
      });

    await initMoviesPanel();

    const filterButtons = Array.from(
      document.querySelectorAll('#savedMoviesFilters .genre-filter-buttons button')
    ).map(btn => btn.textContent);
    expect(filterButtons).toEqual(['All', 'Comedy', 'Drama']);

    const listTitles = () =>
      Array.from(document.querySelectorAll('#savedMoviesList h3')).map(h => h.textContent);

    expect(listTitles()).toHaveLength(2);

    const comedyButton = Array.from(
      document.querySelectorAll('#savedMoviesFilters .genre-filter-buttons button')
    ).find(
      btn => btn.dataset.genre === 'Comedy'
    );
    comedyButton?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    const comedyTitles = listTitles();
    expect(comedyTitles).toHaveLength(1);
    expect(comedyTitles[0]).toContain('Comedy Night');

    const activeGenres = () =>
      Array.from(document.querySelectorAll('.genre-filter-chip-text')).map(el => el.textContent);

    expect(activeGenres()).toEqual(['Comedy']);

    const removeChipBtn = document.querySelector('.genre-filter-chip-remove');
    removeChipBtn?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    expect(activeGenres()).toHaveLength(0);
    expect(listTitles()).toHaveLength(2);

    const allButton = Array.from(
      document.querySelectorAll('#savedMoviesFilters .genre-filter-buttons button')
    ).find(
      btn => btn.dataset.genre === ''
    );
    allButton?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    expect(listTitles()).toHaveLength(2);
  });

  it('routes movie requests through the Cloud Function proxy', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbProxyEndpoint = 'https://mock-functions.net/tmdbProxy';

    const page = {
      results: [
        {
          id: 7,
          title: 'Stored Key Movie',
          release_date: '2023-12-01',
          vote_average: 7.2,
          vote_count: 75,
          overview: 'Stored key data.',
          genre_ids: []
        }
      ]
    };
    const empty = { results: [] };
    const credits = {
      cast: [{ name: 'Proxy Star' }],
      crew: [{ job: 'Director', name: 'Proxy Director' }]
    };
    const genres = { genres: [] };

    configureFetchResponses([page, empty, credits, genres]);

    await initMoviesPanel();
    const calledUrls = fetch.mock.calls.map(args => args[0]);
    expect(calledUrls.length).toBeGreaterThan(0);
    expect(calledUrls.every(url => String(url).startsWith('https://mock-functions.net/tmdbProxy'))).toBe(true);
    expect(calledUrls.some(url => String(url).includes('endpoint=discover'))).toBe(true);
    expect(calledUrls.some(url => String(url).includes('endpoint=genres'))).toBe(true);
    expect(calledUrls.some(url => String(url).includes('endpoint=credits'))).toBe(true);
    expect(calledUrls.some(url => String(url).includes('api_key='))).toBe(false);
    expect(global.localStorage.getItem('moviesApiKey')).toBeNull();
  });

  it('retries credits proxy requests with legacy parameter names when needed', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbProxyEndpoint = 'https://mock-functions.net/tmdbProxy';

    const page = {
      results: [
        {
          id: 42,
          title: 'Legacy Param Movie',
          release_date: '2024-06-01',
          vote_average: 7.8,
          vote_count: 120,
          overview: 'Testing legacy proxy parameters.',
          genre_ids: []
        }
      ]
    };
    const empty = { results: [] };
    const credits = {
      cast: [{ name: 'Proxy Legacy Star' }],
      crew: [{ job: 'Director', name: 'Legacy Director' }]
    };
    const genres = { genres: [] };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(empty) })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({ error: 'invalid_endpoint_params' }))
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(credits) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(genres) });

    await initMoviesPanel();

    expect(global.fetch).toHaveBeenCalledTimes(5);
    const firstCreditsUrl = String(global.fetch.mock.calls[2][0]);
    const retryCreditsUrl = String(global.fetch.mock.calls[3][0]);
    expect(firstCreditsUrl).toContain('endpoint=credits');
    expect(firstCreditsUrl).toContain('movie_id=');
    expect(retryCreditsUrl).toContain('endpoint=credits');
    expect(retryCreditsUrl).toContain('movieId=');

    const listContent = document.getElementById('movieList')?.textContent || '';
    expect(listContent).toContain('Proxy Legacy Star');
  });

  it('falls back to movie details when credits proxy endpoint is unavailable', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbProxyEndpoint = 'https://mock-functions.net/tmdbProxy';

    const page = {
      results: [
        {
          id: 451,
          title: 'Fallback Feature',
          release_date: '2024-07-04',
          vote_average: 8.2,
          vote_count: 180,
          overview: 'Needs alternate credits path.',
          genre_ids: []
        }
      ]
    };
    const empty = { results: [] };
    const details = {
      credits: {
        cast: [{ name: 'Fallback Star' }],
        crew: [{ job: 'Director', name: 'Fallback Director' }]
      }
    };
    const genres = { genres: [] };

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(empty) })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({ error: 'unsupported_endpoint' }))
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(details) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(genres) });

    await initMoviesPanel();

    expect(global.fetch).toHaveBeenCalledTimes(5);
    const creditsUrl = String(global.fetch.mock.calls[2][0]);
    expect(creditsUrl).toContain('endpoint=credits');
    const detailsUrl = String(global.fetch.mock.calls[3][0]);
    expect(detailsUrl).toContain('endpoint=movie_details');
    expect(detailsUrl).toContain('append_to_response=credits');

    const listContent = document.getElementById('movieList')?.textContent || '';
    expect(listContent).toContain('Fallback Star');
    expect(listContent).toContain('Fallback Director');
  });

  it('moves watched movies to the watched list and allows removal', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbApiKey = 'TEST_KEY';

    const page = {
      results: [
        {
          id: 3,
          title: 'Classic Film',
          release_date: '1999-07-16',
          vote_average: 9.1,
          vote_count: 900,
          overview: 'A timeless classic.',
          genre_ids: [12]
        }
      ]
    };
    const empty = { results: [] };
    const credits = {
      cast: [{ name: 'Iconic Star' }],
      crew: [{ job: 'Director', name: 'Famed Director' }]
    };
    const genres = { genres: [{ id: 12, name: 'Adventure' }] };
    const morePage = {
      results: [
        {
          id: 8,
          title: 'Fresh Release',
          release_date: '2024-02-20',
          vote_average: 8.4,
          vote_count: 210,
          overview: 'A brand new hit.',
          genre_ids: [12]
        }
      ]
    };
    const moreCredits = {
      cast: [{ name: 'Newcomer Star' }],
      crew: [{ job: 'Director', name: 'Rising Director' }]
    };

    configureFetchResponses([
      page,
      empty,
      credits,
      genres,
      morePage,
      empty,
      moreCredits,
      genres
    ]);

    await initMoviesPanel();

    const watchedBtn = Array.from(document.querySelectorAll('#movieList li button')).find(
      b => b.textContent === 'Watched Already'
    );
    watchedBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.querySelector('#watchedMoviesList').textContent).toContain('Classic Film');
    const ratingText = document.querySelector('#watchedMoviesList .movie-rating')?.textContent || '';
    expect(ratingText).toContain('Rating: 9.1');
    expect(ratingText).toContain('900 votes');
    const watchedMeta = document.querySelector('#watchedMoviesList .movie-meta')?.textContent || '';
    expect(watchedMeta).toContain('Genres: Adventure');
    expect(watchedMeta).toContain('Director: Famed Director');
    expect(watchedMeta).toContain('Cast: Iconic Star');
    
    expect(watchedMeta).toContain('Average Score: 9.1');
    expect(watchedMeta).toContain('Release Date: 1999-07-16');

    const removeBtn = document.querySelector('#watchedMoviesList button');
    removeBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.querySelector('#movieList').textContent).toContain('Classic Film');
  });

  it('sorts watched movies by rating when selected', async () => {
    const dom = buildDom();
    attachWindow(dom);
    window.tmdbApiKey = 'TEST_KEY';

    const page = {
      results: [
        {
          id: 20,
          title: 'Low Rated',
          release_date: '2020-01-01',
          vote_average: 7.4,
          vote_count: 200,
          overview: 'Solid enough.',
          genre_ids: []
        },
        {
          id: 21,
          title: 'High Rated',
          release_date: '2021-05-10',
          vote_average: 9.4,
          vote_count: 850,
          overview: 'Critically acclaimed.',
          genre_ids: []
        }
      ],
      total_pages: 1
    };
    const creditsA = { cast: [], crew: [] };
    const creditsB = { cast: [], crew: [] };
    const genres = { genres: [] };

    configureFetchResponses([page, creditsA, creditsB, genres]);

    await initMoviesPanel();

    const cards = Array.from(document.querySelectorAll('#movieList li'));
    const lowCard = cards.find(card => card.textContent.includes('Low Rated'));
    const highCard = cards.find(card => card.textContent.includes('High Rated'));
    const lowWatch = lowCard
      ? Array.from(lowCard.querySelectorAll('button')).find(b => b.textContent === 'Watched Already')
      : null;
    const highWatch = highCard
      ? Array.from(highCard.querySelectorAll('button')).find(b => b.textContent === 'Watched Already')
      : null;

    expect(lowWatch).toBeTruthy();
    expect(highWatch).toBeTruthy();

    lowWatch?.click();
    highWatch?.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.querySelectorAll('#watchedMoviesList .movie-card')).toHaveLength(2);

    const sortSelect = document.getElementById('watchedMoviesSort');
    sortSelect.value = 'ratingDesc';
    sortSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const titlesDesc = Array.from(
      document.querySelectorAll('#watchedMoviesList .movie-card h3')
    ).map(el => el.textContent);
    expect(titlesDesc[0]).toContain('High Rated');
    expect(titlesDesc[1]).toContain('Low Rated');

    sortSelect.value = 'ratingAsc';
    sortSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    const titlesAsc = Array.from(
      document.querySelectorAll('#watchedMoviesList .movie-card h3')
    ).map(el => el.textContent);
    expect(titlesAsc[0]).toContain('Low Rated');
    expect(titlesAsc[1]).toContain('High Rated');
  });

  it('saves preferences to Firestore for authenticated users', async () => {
    const dom = buildDom();
    attachWindow(dom);

    const userId = 'user123';
    authModuleMock.awaitAuthUser.mockResolvedValue({ uid: userId });
    authModuleMock.getCurrentUser.mockReturnValue({ uid: userId });
    firestoreDocMock.get.mockResolvedValue({ exists: true, data: () => ({ prefs: {} }) });

    const page = {
      results: [
        {
          id: 9,
          title: 'Firestore Movie',
          release_date: '2024-04-01',
          vote_average: 7,
          vote_count: 120,
          overview: 'Stored remotely.',
          genre_ids: []
        }
      ]
    };
    const empty = { results: [] };
    const credits = {
      cast: [{ name: 'Remote Star' }],
      crew: [{ job: 'Director', name: 'Remote Director' }]
    };
    const genres = { genres: [] };

    configureFetchResponses([page, empty, credits, genres]);

    await initMoviesPanel();

    const interestedBtn = Array.from(document.querySelectorAll('#movieList li button')).find(
      b => b.textContent === 'Interested'
    );
    interestedBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(firestoreDocMock.set).toHaveBeenCalled();
  });
});
