const KEY = 'siteName';
const DEFAULT_NAME = 'Dashboard';

export function getSiteName() {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(KEY) || DEFAULT_NAME;
    }
  } catch {}
  return DEFAULT_NAME;
}

export function setSiteName(name) {
  try {
    if (typeof localStorage !== 'undefined') {
      const trimmed = name?.trim();
      if (trimmed) {
        localStorage.setItem(KEY, trimmed);
      } else {
        localStorage.removeItem(KEY);
      }
    }
  } catch {}
}

export function applySiteName() {
  const name = getSiteName();
  document.querySelectorAll('.site-name').forEach(el => {
    el.textContent = name;
  });
  if (typeof document !== 'undefined' && document.title) {
    document.title = document.title.replace(/Dashboard/g, name);
  }
}
