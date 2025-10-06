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
    <div id="movieStreamSection"></div>
    <div id="savedMoviesSection" style="display:none">
      <div id="savedMoviesFilters" class="genre-filter"></div>
      <div id="savedMoviesList"></div>
    </div>
    <div id="watchedMoviesSection" style="display:none">
      <div id="watchedMoviesList"></div>
    </div>
    <div id="movieList"></div>
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
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: () => global.localStorage
  });
}

function configureFetchResponses(responses) {
  global.fetch = vi.fn();
  responses.forEach(res => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(res)
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

    configureFetchResponses([page, empty, credits, genres]);

    await initMoviesPanel();

    const movieTitles = Array.from(document.querySelectorAll('#movieList li h3')).map(h => h.textContent);
    expect(movieTitles).toHaveLength(1);
    expect(movieTitles[0]).toContain('Top Tier');
    expect(document.querySelector('#movieList').textContent).not.toContain('Too Few Votes');
    expect(document.querySelector('#movieList').textContent).not.toContain('Too Low Rating');
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

    configureFetchResponses([page, empty, credits, genres]);

    await initMoviesPanel();

    const interestedBtn = Array.from(document.querySelectorAll('#movieList li button')).find(
      b => b.textContent === 'Interested'
    );
    interestedBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.querySelector('#movieList').textContent).toContain('No new movies right now.');
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

    const filterButtons = Array.from(document.querySelectorAll('#savedMoviesFilters button')).map(btn =>
      btn.textContent
    );
    expect(filterButtons).toEqual(['All', 'Comedy', 'Drama']);

    const listTitles = () =>
      Array.from(document.querySelectorAll('#savedMoviesList h3')).map(h => h.textContent);

    expect(listTitles()).toHaveLength(2);

    const comedyButton = Array.from(document.querySelectorAll('#savedMoviesFilters button')).find(
      btn => btn.dataset.genre === 'Comedy'
    );
    comedyButton?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    const comedyTitles = listTitles();
    expect(comedyTitles).toHaveLength(1);
    expect(comedyTitles[0]).toContain('Comedy Night');

    const allButton = Array.from(document.querySelectorAll('#savedMoviesFilters button')).find(
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

    configureFetchResponses([page, empty, credits, genres]);

    await initMoviesPanel();

    const watchedBtn = Array.from(document.querySelectorAll('#movieList li button')).find(
      b => b.textContent === 'Watched Already'
    );
    watchedBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.querySelector('#watchedMoviesList').textContent).toContain('Classic Film');
    const watchedMeta = document.querySelector('#watchedMoviesList .movie-meta')?.textContent || '';
    expect(watchedMeta).toContain('Genres: Adventure');
    
    const removeBtn = document.querySelector('#watchedMoviesList button');
    removeBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.querySelector('#movieList').textContent).toContain('Classic Film');
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

    expect(firestoreDocMock.set).toHaveBeenCalled();
  });
});
