import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';
import appOrServer from '../backend/server.js';

describe('sample descriptions', () => {
  it('loads and saves via Firestore', async () => {
    const setMock = vi.fn(() => Promise.resolve());
    const getMock = vi.fn(() => Promise.resolve({ data: () => ({ descriptions: { panel1: { top: 'test' } } }) }));
    vi.doMock('../js/auth.js', () => ({
      auth: { currentUser: null, onAuthStateChanged: vi.fn() },
      db: { collection: () => ({ doc: () => ({ set: setMock, get: getMock }) }) }
    }));
    vi.doMock('../js/helpers.js', () => ({ generateId: () => 'session1' }));
    vi.stubGlobal('localStorage', {
      getItem: () => 'session1',
      setItem: vi.fn(),
    });
    const { loadDescriptions, saveDescription } = await import('../js/descriptions.js');
    const loaded = await loadDescriptions();
    expect(loaded).toEqual({ panel1: { top: 'test' } });
    await saveDescription('panel1', 'top', 'hello');
    expect(setMock).toHaveBeenCalledWith({ descriptions: { panel1: { top: 'hello' } } }, { merge: true });
  });
});

describe('movies api', () => {
  it('returns curated catalog metadata', async () => {
    const res = await request(appOrServer).get('/api/movies?limit=1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body).toHaveProperty('curated');
    expect(Array.isArray(res.body.curated)).toBe(true);
    expect(res.body).toHaveProperty('fresh');
    expect(Array.isArray(res.body.fresh)).toBe(true);
    expect(res.body).toHaveProperty('metadata');
    expect(res.body.metadata).toHaveProperty('curatedCount');
    expect(res.body.metadata).toHaveProperty('totalCatalogSize');
  });
});

describe('movie ratings api', () => {
  it('returns normalized ratings from OMDb', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            Response: 'True',
            Ratings: [
              { Source: 'Rotten Tomatoes', Value: '94%' },
              { Source: 'Metacritic', Value: '81/100' }
            ],
            Metascore: '81',
            imdbRating: '8.7',
            Title: 'Sample Movie',
            Year: '2024',
            imdbID: 'tt1234567'
          })
      });

    try {
      const res = await request(appOrServer).get(
        '/api/movie-ratings?title=Sample%20Movie&year=2024&apiKey=test'
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        source: 'omdb',
        title: 'Sample Movie',
        year: '2024',
        imdbId: 'tt1234567'
      });
      expect(res.body.ratings).toEqual({
        rottenTomatoes: 94,
        metacritic: 81,
        imdb: 8.7
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('contact endpoint', () => {
  it.skip('requires sender and message', async () => {
    const res = await request(appOrServer).post('/contact').send({});
    expect(res.status).toBe(400);
  });
});

afterAll(() => {
  if (typeof appOrServer?.close === 'function') {
    appOrServer.close();
  }
});
