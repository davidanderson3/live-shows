import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../js/auth.js', () => ({ currentUser: null, auth: { onAuthStateChanged: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  delete global.window;
  delete global.document;
  delete global.localStorage;
  delete global.history;
});

describe('initTabs (streamlined)', () => {
  function setupStorage(savedPanel) {
    const store = new Map();
    if (savedPanel) store.set('lastPanel', savedPanel);
    return {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: key => { store.delete(key); },
      clear: () => { store.clear(); }
    };
  }

  async function initTabsWithDom(savedPanel) {
    const dom = new JSDOM(`
      <button class="tab-button" data-target="moviesPanel"></button>
      <button class="tab-button" data-target="showsPanel"></button>
      <button class="tab-button" data-target="restaurantsPanel"></button>
      <div id="moviesPanel"></div>
      <div id="showsPanel"></div>
      <div id="restaurantsPanel"></div>
    `, { url: 'http://localhost/' });

    global.window = dom.window;
    global.document = dom.window.document;
    global.history = dom.window.history;
    global.localStorage = setupStorage(savedPanel);

    global.window.initMoviesPanel = vi.fn();
    global.window.initShowsPanel = vi.fn();
    global.window.initRestaurantsPanel = vi.fn();

    const mod = await import('../js/tabs.js');
    await mod.initTabs(null, {});
    dom.window.dispatchEvent(new dom.window.Event('DOMContentLoaded'));

    return dom;
  }

  it('activates the saved panel when available', async () => {
    const dom = await initTabsWithDom('showsPanel');
    const active = dom.window.document.querySelector('.tab-button.active');
    expect(active?.dataset.target).toBe('showsPanel');
    expect(dom.window.document.getElementById('showsPanel').style.display).toBe('flex');
    expect(dom.window.initShowsPanel).toHaveBeenCalled();
  });

  it('defaults to moviesPanel when saved panel is missing', async () => {
    const dom = await initTabsWithDom('unknownPanel');
    const active = dom.window.document.querySelector('.tab-button.active');
    expect(active?.dataset.target).toBe('moviesPanel');
    expect(dom.window.document.getElementById('moviesPanel').style.display).toBe('flex');
    expect(dom.window.initMoviesPanel).toHaveBeenCalled();
  });

  it('activates restaurants panel when saved', async () => {
    const dom = await initTabsWithDom('restaurantsPanel');
    const active = dom.window.document.querySelector('.tab-button.active');
    expect(active?.dataset.target).toBe('restaurantsPanel');
    expect(dom.window.document.getElementById('restaurantsPanel').style.display).toBe('flex');
    expect(dom.window.initRestaurantsPanel).toHaveBeenCalled();
  });
});
