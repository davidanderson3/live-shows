import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('https://www.gstatic.com/firebasejs/10.11.0/firebase-app-compat.js', () => ({}), { virtual: true });
vi.mock('https://www.gstatic.com/firebasejs/10.11.0/firebase-auth-compat.js', () => ({}), { virtual: true });
vi.mock('https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore-compat.js', () => ({}), { virtual: true });
vi.mock('https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js', () => ({
  initializeFirestore: vi.fn(),
  persistentLocalCache: vi.fn(() => ({})),
  persistentMultipleTabManager: vi.fn(() => ({}))
}), { virtual: true });
vi.mock('../js/cache.js', () => ({
  clearDecisionsCache: vi.fn(),
  clearGoalOrderCache: vi.fn()
}));

describe('auth persistence and UI updates', () => {
  it('updates UI on auth state change even if persistence setting fails', async () => {
    const dom = new JSDOM(`<button id="loginBtn"></button><button id="logoutBtn"></button><span id="userEmail"></span>`);
    global.window = dom.window;
    global.document = dom.window.document;

    const callbacks = [];
    const setPersistence = vi.fn().mockRejectedValue(new Error('fail'));
    const authMock = {
      setPersistence,
      onAuthStateChanged: vi.fn(cb => callbacks.push(cb)),
      signOut: vi.fn(),
      signInWithPopup: vi.fn(),
      currentUser: null
    };
    function authFn() { return authMock; }
    authFn.Auth = { Persistence: { LOCAL: 'LOCAL' } };

      global.firebase = {
        initializeApp: vi.fn(),
        app: vi.fn(() => ({})),
        auth: authFn,
        firestore: vi.fn(() => ({}))
      };

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
    const { initAuth, auth } = await import('../js/auth.js');
    await new Promise(r => setTimeout(r, 0));
    expect(auth.setPersistence).toHaveBeenCalledWith('LOCAL');
    expect(errorSpy).toHaveBeenCalled();

    const loginBtn = dom.window.document.getElementById('loginBtn');
    const logoutBtn = dom.window.document.getElementById('logoutBtn');
    const userEmail = dom.window.document.getElementById('userEmail');
    initAuth({ loginBtn, logoutBtn, userEmail }, () => {});

    callbacks[0]({ email: 'test@example.com' });
    expect(userEmail.textContent).toBe('test@example.com');
    expect(loginBtn.style.display).toBe('none');
    expect(logoutBtn.style.display).toBe('inline-block');

    callbacks[0](null);
    expect(userEmail.textContent).toBe('');
    expect(loginBtn.style.display).toBe('inline-block');
    expect(logoutBtn.style.display).toBe('none');

    errorSpy.mockRestore();
    delete global.firebase;
    delete global.window;
    delete global.document;
  });
});
