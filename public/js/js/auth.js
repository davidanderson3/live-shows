// js/auth.js
import "https://www.gstatic.com/firebasejs/10.11.0/firebase-app-compat.js";
import "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth-compat.js";
import "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore-compat.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { clearDecisionsCache, clearGoalOrderCache } from './cache.js';

export let currentUser = null;

const firebaseConfig = {
  apiKey: "AIzaSyBbet_bmwm8h8G5CqvmzrdAnc3AO-0IKa8",
  authDomain: "decision-maker-4e1d3.firebaseapp.com",
  projectId: "decision-maker-4e1d3",
  storageBucket: "decision-maker-4e1d3.firebasestorage.app",
  messagingSenderId: "727689864651",
  appId: "1:727689864651:web:0100c3894790b8c188c24e",
  measurementId: "G-7EJVQN0WT3"
};

firebase.initializeApp(firebaseConfig);
export const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err => {
  console.error('Failed to set auth persistence:', err);
});

initializeFirestore(firebase.app(), {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

export const db = firebase.firestore();

export function getCurrentUser() {
  return auth.currentUser;
}

let authReadyPromise = null;

export function awaitAuthUser() {
  if (!authReadyPromise) {
    authReadyPromise = new Promise(resolve => {
      const unsubscribe = auth.onAuthStateChanged(user => {
        currentUser = user;
        unsubscribe();
        resolve(user);
      });
    });
  }
  return authReadyPromise;
}

export function initAuth({ loginBtn, logoutBtn, userEmail, bottomLoginBtn, bottomLogoutBtn }, onLogin) {
  const safeSet = (el, key, value) => {
    if (el) el[key] = value;
  };

  const usesSingleBottomBtn = bottomLogoutBtn && !bottomLoginBtn;

  const loginButtons = [loginBtn].filter(Boolean);
  if (!usesSingleBottomBtn && bottomLoginBtn) loginButtons.push(bottomLoginBtn);

  const logoutButtons = [logoutBtn].filter(Boolean);
  if (!usesSingleBottomBtn && bottomLogoutBtn) logoutButtons.push(bottomLogoutBtn);

  const updateBottomBtn = (user) => {
    if (!bottomLogoutBtn || !usesSingleBottomBtn) return;
    const img = bottomLogoutBtn.querySelector('img');
    if (img) {
      img.src = user ? 'assets/sign-out.svg' : 'assets/sign-in.svg';
      img.alt = user ? 'Sign Out' : 'Sign In';
    }
    bottomLogoutBtn.onclick = user ? logoutAction : loginAction;
    bottomLogoutBtn.style.display = 'inline-block';
  };

  const loginAction = async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      const result = await firebase.auth().signInWithPopup(provider);
      currentUser = result.user;
      clearDecisionsCache();
      clearGoalOrderCache();
      safeSet(userEmail, 'textContent', currentUser.email);
      updateBottomBtn(currentUser);
      // onAuthStateChanged will trigger onLogin
    } catch (err) {
      console.error('Login failed:', err);
    }
  };

  loginButtons.forEach(btn => btn && (btn.onclick = loginAction));

  const logoutAction = async () => {
    await auth.signOut();
    currentUser = null;
    clearDecisionsCache();
    clearGoalOrderCache();
    safeSet(userEmail, 'textContent', '');
    loginButtons.forEach(b => safeSet(b, 'style', 'display: inline-block'));
    logoutButtons.forEach(b => safeSet(b, 'style', 'display: none'));
    updateBottomBtn(null);
    // onAuthStateChanged will trigger onLogin
  };

  logoutButtons.forEach(btn => btn && (btn.onclick = logoutAction));

  auth.onAuthStateChanged(user => {
    currentUser = user;
    clearDecisionsCache();
    clearGoalOrderCache();
    safeSet(userEmail, 'textContent', user?.email || '');
    loginButtons.forEach(b => safeSet(b, 'style', user ? 'display:none' : 'display:inline-block'));
    logoutButtons.forEach(b => safeSet(b, 'style', user ? 'display:inline-block' : 'display:none'));
    updateBottomBtn(user);
    if (user) {
      try { localStorage.removeItem('budgetConfig'); } catch (e) { /* ignore */ }
    }
    onLogin(user);
  });
}

