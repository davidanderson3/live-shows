import { initSettingsPage } from './settings.js';
import { initAuth } from './auth.js';
import { applySiteName } from './siteName.js';

function initAuthForPage() {
  const uiRefs = {
    logoutBtn: document.getElementById('logoutBtn'),
    bottomLogoutBtn: document.getElementById('bottomLogoutBtn')
  };
  initAuth(uiRefs, () => {});
}

  function initPage() {
    applySiteName();
    initSettingsPage();
    initAuthForPage();
  }

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}
