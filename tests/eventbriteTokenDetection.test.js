import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';

const ORIGINAL_ENV = { ...process.env };

const resetEnv = () => {
  if (ORIGINAL_ENV.EVENTBRITE_API_TOKEN === undefined) {
    delete process.env.EVENTBRITE_API_TOKEN;
  } else {
    process.env.EVENTBRITE_API_TOKEN = ORIGINAL_ENV.EVENTBRITE_API_TOKEN;
  }
  if (ORIGINAL_ENV.EVENTBRITE_OAUTH_TOKEN === undefined) {
    delete process.env.EVENTBRITE_OAUTH_TOKEN;
  } else {
    process.env.EVENTBRITE_OAUTH_TOKEN = ORIGINAL_ENV.EVENTBRITE_OAUTH_TOKEN;
  }
  if (ORIGINAL_ENV.EVENTBRITE_TOKEN === undefined) {
    delete process.env.EVENTBRITE_TOKEN;
  } else {
    process.env.EVENTBRITE_TOKEN = ORIGINAL_ENV.EVENTBRITE_TOKEN;
  }
  if (ORIGINAL_ENV.SPOTIFY_CLIENT_ID === undefined) {
    delete process.env.SPOTIFY_CLIENT_ID;
  } else {
    process.env.SPOTIFY_CLIENT_ID = ORIGINAL_ENV.SPOTIFY_CLIENT_ID;
  }
  if (ORIGINAL_ENV.NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  }
};

describe('spotify client id endpoint', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.EVENTBRITE_API_TOKEN;
    delete process.env.EVENTBRITE_OAUTH_TOKEN;
    delete process.env.EVENTBRITE_TOKEN;
    delete process.env.SPOTIFY_CLIENT_ID;
    vi.resetModules();
  });

  afterEach(() => {
    resetEnv();
    vi.resetModules();
  });

  it('reports when an EVENTBRITE_TOKEN fallback is configured', async () => {
    process.env.SPOTIFY_CLIENT_ID = 'cid-from-env';
    process.env.EVENTBRITE_TOKEN = 'fallback-token';

    const module = await import('../backend/server.js');
    const app = module.default || module;

    const res = await request(app).get('/api/spotify-client-id');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      clientId: 'cid-from-env',
      hasEventbriteToken: true
    });
  });
});
