import { getCurrentUser, awaitAuthUser, db } from './auth.js';
import { DEFAULT_REMOTE_API_BASE } from './config.js';
import { ensureTmdbCredentialsLoaded } from './tmdbCredentials.js';

const TV_PREFS_KEY = 'tvPreferences';
const TV_API_KEY_STORAGE = 'tvApiKey';
const SHARED_API_KEY_STORAGE = 'moviesApiKey';
const DEFAULT_INTEREST = 3;
const INITIAL_DISCOVER_PAGES = 3;
const MAX_DISCOVER_PAGES = 10;
const MAX_DISCOVER_PAGES_LIMIT = 30;
const MAX_CREDIT_REQUESTS = 20;
const PREF_COLLECTION = 'tvPreferences';
const MIN_VOTE_AVERAGE = 7;
const MIN_VOTE_COUNT = 50;
const MIN_PRIORITY_RESULTS = 12;
const MIN_FEED_RESULTS = 10;

const DEFAULT_TMDB_PROXY_ENDPOINT =
  (typeof process !== 'undefined' && process.env && process.env.TMDB_PROXY_ENDPOINT) ||
  `${DEFAULT_REMOTE_API_BASE}/tmdbProxy`;

let proxyDisabled = false;
const unsupportedProxyEndpoints = new Set();
let loggedProxyCreditsUnsupported = false;

const SUPPRESSED_STATUSES = new Set(['watched', 'notInterested', 'interested']);

const FEED_FILTERS_KEY = 'tvFeedFilters';
const DEFAULT_FEED_FILTER_STATE = Object.freeze({
  minRating: '',
  minVotes: '',
  startYear: '',
  endYear: '',
  genreId: '',
  excludedGenreIds: ''
});

let feedFilterState = { ...DEFAULT_FEED_FILTER_STATE };

const TMDB_DISCOVER_HISTORY_LIMIT = 50;
const TMDB_DISCOVER_STATE_VERSION = 1;
const TMDB_DISCOVER_STATE_FIELD = 'tmdbTvDiscoverState';
const TMDB_DISCOVER_STATE_STORAGE_KEY = 'tvDiscoverState';
const TMDB_DISCOVER_STATE_PERSIST_DEBOUNCE_MS = 1500;
const tmdbDiscoverHistory = new Map();
let tmdbDiscoverStateDirty = false;
let tmdbDiscoverPersistTimer = null;

const domRefs = {
  list: null,
  interestedList: null,
  interestedFilters: null,
  watchedList: null,
  apiKeyInput: null,
  apiKeyContainer: null,
  tabs: null,
  streamSection: null,
  interestedSection: null,
  watchedSection: null,
  watchedSort: null,
  feedControls: null,
  feedStatus: null,
  feedMinRating: null,
  feedMinVotes: null,
  feedStartYear: null,
  feedEndYear: null,
  feedGenre: null
};

let currentMovies = [];
let currentPrefs = {};
let genreMap = {};
let activeApiKey = '';
let prefsLoadedFor = null;
let loadingPrefsPromise = null;
let activeUserId = null;
const activeInterestedGenres = new Set();
let refillInProgress = false;
let lastRefillAttempt = 0;
let pendingRefillCooldownTimer = null;
let feedExhausted = false;
let watchedSortMode = 'recent';
let activeInterestedGenre = null;
const handlers = {
  handleKeydown: null,
  handleChange: null
};

const STATUS_TONE_CLASSES = Object.freeze({
  info: 'movie-status--info',
  success: 'movie-status--success',
  warning: 'movie-status--warning',
  error: 'movie-status--error'
});

function escapeForAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let loadAttemptCounter = 0;

function formatTimestamp(value) {
  if (!Number.isFinite(value)) return '';
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (_) {
    return '';
  }
}

function summarizeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string' && err.message.trim()) {
    return err.message.trim();
  }
  if (typeof err.status === 'number') {
    return `Request failed with status ${err.status}`;
  }
  return 'Unknown error';
}

function updateFeedStatus(message, { tone = 'info', showSpinner = false } = {}) {
  const statusEl = domRefs.feedStatus;
  if (!statusEl) return;
  const normalizedMessage = typeof message === 'string' ? message : String(message ?? '');
  const isCooldownMessage = /before requesting more tv shows/i.test(normalizedMessage);

  if (isCooldownMessage) {
    const fallbackLabel = normalizedMessage.trim()
      ? normalizedMessage.trim()
      : 'Preparing more TV shows shortly';
    const ariaLabel = escapeForAttribute(fallbackLabel);
    statusEl.innerHTML = `
      <div class="tv-status__party" role="status" aria-live="polite"${
        ariaLabel ? ` aria-label="${ariaLabel}"` : ''
      }>
        <span class="movie-status__sr">${ariaLabel || 'Preparing more TV shows shortly'}</span>
        <div class="tv-status__stage">
          <span class="tv-status__dancer tv-status__dancer--left"></span>
          <span class="tv-status__dancer tv-status__dancer--center"></span>
          <span class="tv-status__dancer tv-status__dancer--right"></span>
        </div>
        <div class="tv-status__lights">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    `;
    statusEl.setAttribute('aria-busy', 'true');
    if (normalizedMessage.trim()) {
      console.info(normalizedMessage);
    }
  } else if (showSpinner) {
    const ariaLabel = normalizedMessage.trim() ? escapeForAttribute(normalizedMessage) : '';
    statusEl.innerHTML = `
      <div class="tv-status__party" role="status" aria-live="polite"${
        ariaLabel ? ` aria-label="${ariaLabel}"` : ''
      }>
        <span class="movie-status__sr">${ariaLabel}</span>
        <div class="tv-status__stage">
          <span class="tv-status__dancer tv-status__dancer--left"></span>
          <span class="tv-status__dancer tv-status__dancer--center"></span>
          <span class="tv-status__dancer tv-status__dancer--right"></span>
        </div>
        <div class="tv-status__lights">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    `;
    statusEl.setAttribute('aria-busy', 'true');
    if (normalizedMessage.trim()) {
      console.info(normalizedMessage);
    }
  } else {
    statusEl.textContent = normalizedMessage;
    statusEl.removeAttribute('aria-busy');
  }
  Object.values(STATUS_TONE_CLASSES).forEach(cls => {
    statusEl.classList.remove(cls);
  });
  const toneClass = STATUS_TONE_CLASSES[tone] || STATUS_TONE_CLASSES.info;
  statusEl.classList.add(toneClass);
  statusEl.classList.toggle('movie-status--loading', Boolean(showSpinner || isCooldownMessage));
}

function clampUserRating(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 10) return 10;
  return Math.round(value * 2) / 2;
}
const REFILL_COOLDOWN_MS = 5000;

function getNameList(input) {
  if (!input) return [];

  if (Array.isArray(input)) {
    return input
      .map(entry => {
        if (typeof entry === 'string') {
          return entry.trim();
        }
        if (entry && typeof entry.name === 'string') {
          return entry.name.trim();
        }
        return '';
      })
      .filter(Boolean);
  }

  if (typeof input === 'string') {
    return input
      .split(',')
      .map(name => name.trim())
      .filter(Boolean);
  }

  return [];
}

function meetsQualityThreshold(movie, minAverage = MIN_VOTE_AVERAGE, minVotes = MIN_VOTE_COUNT) {
  if (!movie || typeof movie !== 'object') return false;
  const average = Number(movie.vote_average ?? 0);
  const votes = Number(movie.vote_count ?? 0);
  if (!Number.isFinite(average) || !Number.isFinite(votes)) return false;
  return average >= minAverage && votes >= minVotes;
}

function loadLocalPrefs() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(TV_PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveLocalPrefs(prefs) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(TV_PREFS_KEY, JSON.stringify(prefs));
  } catch (_) {
    /* ignore */
  }
}

function loadLocalDiscoverState() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TMDB_DISCOVER_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function saveLocalDiscoverState(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (
      !state ||
      typeof state !== 'object' ||
      !state.entries ||
      typeof state.entries !== 'object' ||
      !Object.keys(state.entries).length
    ) {
      localStorage.removeItem(TMDB_DISCOVER_STATE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(TMDB_DISCOVER_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (_) {
    /* ignore */
  }
}

function sanitizeFeedFilterValue(name, rawValue) {
  const value = rawValue == null ? '' : String(rawValue).trim();
  if (!value) return '';

  if (name === 'minRating') {
    const number = Number.parseFloat(value.replace(',', '.'));
    if (!Number.isFinite(number)) return '';
    const clamped = Math.max(0, Math.min(10, number));
    return clamped.toString();
  }

  if (name === 'minVotes') {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return '';
    return Math.max(0, number).toString();
  }

  if (name === 'startYear' || name === 'endYear') {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return '';
    return number.toString();
  }

  if (name === 'genreId') {
    return value;
  }

  if (name === 'excludedGenreIds') {
    const list = Array.isArray(rawValue)
      ? rawValue
      : value.split(',');
    const normalized = list
      .map(entry => {
        if (entry == null) return '';
        const num = Number.parseInt(String(entry).trim(), 10);
        if (!Number.isFinite(num)) return '';
        return num.toString();
      })
      .filter(Boolean);
    if (!normalized.length) return '';
    const uniqueSorted = Array.from(new Set(normalized))
      .map(entry => Number.parseInt(entry, 10))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .map(entry => entry.toString());
    return uniqueSorted.join(',');
  }

  return value;
}

function sanitizeFeedFiltersState(state) {
  const base = { ...DEFAULT_FEED_FILTER_STATE };
  if (!state || typeof state !== 'object') {
    return base;
  }

  return {
    ...base,
    minRating: sanitizeFeedFilterValue('minRating', state.minRating),
    minVotes: sanitizeFeedFilterValue('minVotes', state.minVotes),
    startYear: sanitizeFeedFilterValue('startYear', state.startYear),
    endYear: sanitizeFeedFilterValue('endYear', state.endYear),
    genreId: sanitizeFeedFilterValue('genreId', state.genreId),
    excludedGenreIds: sanitizeFeedFilterValue('excludedGenreIds', state.excludedGenreIds)
  };
}

function loadFeedFilterStateFromStorage() {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULT_FEED_FILTER_STATE };
  }
  try {
    const raw = localStorage.getItem(FEED_FILTERS_KEY);
    if (!raw) return { ...DEFAULT_FEED_FILTER_STATE };
    const parsed = JSON.parse(raw);
    return sanitizeFeedFiltersState(parsed);
  } catch (_) {
    return { ...DEFAULT_FEED_FILTER_STATE };
  }
}

function saveFeedFilters(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    const sanitized = sanitizeFeedFiltersState(state);
    localStorage.setItem(FEED_FILTERS_KEY, JSON.stringify(sanitized));
  } catch (_) {
    /* ignore */
  }
}

function getExcludedGenreIdStrings() {
  const raw = typeof feedFilterState.excludedGenreIds === 'string'
    ? feedFilterState.excludedGenreIds
    : '';
  if (!raw) return [];
  return raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function getExcludedGenreIdSet() {
  const strings = getExcludedGenreIdStrings();
  const numbers = strings
    .map(value => Number.parseInt(value, 10))
    .filter(Number.isFinite);
  return new Set(numbers);
}

function buildExcludedGenreStateFromValues(values) {
  const numbers = Array.from(values)
    .map(value => Number.parseInt(value, 10))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!numbers.length) return '';
  return numbers.map(value => value.toString()).join(',');
}

function hasActiveFeedFilters() {
  return Object.values(feedFilterState).some(value => String(value ?? '').trim() !== '');
}

function updateFeedGenreUI() {
  const container = domRefs.feedGenre;
  if (!container) return;

  const currentValue = feedFilterState.genreId ?? '';
  const includeButtons = container.querySelectorAll('.genre-filter-include-btn');
  includeButtons.forEach(btn => {
    const value = btn.dataset.genre ?? '';
    const isActive = value === currentValue;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  const includeValueEl = container.querySelector('.genre-filter-include-value');
  if (includeValueEl) {
    includeValueEl.innerHTML = '';

    if (
      currentValue &&
      genreMap &&
      Object.prototype.hasOwnProperty.call(genreMap, currentValue)
    ) {
      const chip = document.createElement('span');
      chip.className = 'genre-filter-chip';

      const text = document.createElement('span');
      text.className = 'genre-filter-chip-text';
      text.textContent = genreMap[currentValue] || 'Selected';
      chip.appendChild(text);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'genre-filter-chip-remove';
      removeBtn.setAttribute('aria-label', 'Clear genre filter');
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        setFeedFilter('genreId', '', { sanitize: true, persist: true });
      });
      chip.appendChild(removeBtn);

      includeValueEl.appendChild(chip);
    } else {
      const span = document.createElement('span');
      span.className = 'genre-filter-active-empty';
      span.textContent = 'All genres';
      includeValueEl.appendChild(span);
    }
  }

  const excludedSet = getExcludedGenreIdSet();
  const excludedStrings = getExcludedGenreIdStrings();
  const excludeButtons = container.querySelectorAll('.genre-filter-exclude-btn');
  excludeButtons.forEach(btn => {
    if (btn.dataset.action === 'clear') {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
      return;
    }
    const value = btn.dataset.genre ?? '';
    const numeric = Number.parseInt(value, 10);
    const isActive = Number.isFinite(numeric) && excludedSet.has(numeric);
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  const excludeValueEl = container.querySelector('.genre-filter-exclude-value');
  if (excludeValueEl) {
    excludeValueEl.innerHTML = '';

    if (!excludedStrings.length) {
      const span = document.createElement('span');
      span.className = 'genre-filter-active-empty genre-filter-exclude-empty';
      span.textContent = 'No exclusions';
      excludeValueEl.appendChild(span);
    } else {
      excludedStrings.forEach(value => {
        const chip = document.createElement('span');
        chip.className = 'genre-filter-chip genre-filter-chip--exclude';

        const text = document.createElement('span');
        text.className = 'genre-filter-chip-text';
        text.textContent = genreMap?.[value] || 'Excluded';
        chip.appendChild(text);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'genre-filter-chip-remove';
        const label = genreMap?.[value] || 'genre';
        removeBtn.setAttribute('aria-label', `Allow ${label}`);
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
          const next = getExcludedGenreIdSet();
          const numeric = Number.parseInt(value, 10);
          if (!Number.isFinite(numeric)) return;
          next.delete(numeric);
          const nextState = buildExcludedGenreStateFromValues(next);
          setFeedFilter('excludedGenreIds', nextState, { sanitize: true, persist: true });
        });
        chip.appendChild(removeBtn);

        excludeValueEl.appendChild(chip);
      });
    }
  }
}

function updateFeedFilterInputsFromState() {
  if (domRefs.feedMinRating) {
    domRefs.feedMinRating.value = feedFilterState.minRating ?? '';
  }
  if (domRefs.feedMinVotes) {
    domRefs.feedMinVotes.value = feedFilterState.minVotes ?? '';
  }
  if (domRefs.feedStartYear) {
    domRefs.feedStartYear.value = feedFilterState.startYear ?? '';
  }
  if (domRefs.feedEndYear) {
    domRefs.feedEndYear.value = feedFilterState.endYear ?? '';
  }
  if (domRefs.feedGenre) {
    updateFeedGenreUI();
  }
}

function setFeedFilter(name, rawValue, { sanitize = false, persist = true } = {}) {
  if (!Object.prototype.hasOwnProperty.call(feedFilterState, name)) return;

  const rawString = rawValue == null ? '' : String(rawValue);
  const value = sanitize
    ? sanitizeFeedFilterValue(name, rawString)
    : rawString.trim();

  const hasChanged = feedFilterState[name] !== value;
  if (hasChanged) {
    feedFilterState = { ...feedFilterState, [name]: value };
  }

  if (sanitize) {
    updateFeedFilterInputsFromState();
  }

  if (persist) {
    saveFeedFilters(feedFilterState);
  }

  if (hasChanged || sanitize) {
    renderFeed();
  }
}

function populateFeedGenreOptions() {
  const container = domRefs.feedGenre;
  if (!container) return;

  const entries = Object.entries(genreMap || {}).sort((a, b) => {
    const nameA = String(a[1] ?? '');
    const nameB = String(b[1] ?? '');
    return nameA.localeCompare(nameB);
  });

  const currentValue = feedFilterState.genreId ?? '';
  const availableIds = new Set(entries.map(([id]) => String(id)));
  const needsReset = currentValue && !availableIds.has(currentValue);
  const excludedStrings = getExcludedGenreIdStrings();
  const validExcludedStrings = excludedStrings.filter(value => availableIds.has(value));
  const needsExcludedReset = excludedStrings.length !== validExcludedStrings.length;

  container.innerHTML = '';

  const buttonsWrap = document.createElement('div');
  buttonsWrap.className = 'genre-filter-buttons genre-filter-buttons--include';
  buttonsWrap.setAttribute('role', 'group');
  buttonsWrap.setAttribute('aria-label', 'Filter TV shows by genre');

  const createButton = (value, label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'genre-filter-btn genre-filter-include-btn';
    btn.dataset.genre = value;
    btn.textContent = label;
    btn.addEventListener('click', handleFeedGenreButtonClick);
    buttonsWrap.appendChild(btn);
  };

  createButton('', 'All Genres');
  entries.forEach(([id, name]) => {
    createButton(String(id), String(name || 'Unknown'));
  });

  container.appendChild(buttonsWrap);

  const activeWrap = document.createElement('div');
  activeWrap.className = 'genre-filter-active genre-filter-include-active';

  const label = document.createElement('span');
  label.className = 'genre-filter-active-label';
  label.textContent = 'Active filter:';
  activeWrap.appendChild(label);

  const valueEl = document.createElement('div');
  valueEl.className = 'genre-filter-active-value genre-filter-include-value';
  activeWrap.appendChild(valueEl);

  container.appendChild(activeWrap);

  const excludeSection = document.createElement('div');
  excludeSection.className = 'genre-filter-exclude-section';

  const excludeHeading = document.createElement('span');
  excludeHeading.className = 'genre-filter-exclude-heading';
  excludeHeading.textContent = 'Exclude genres';
  excludeSection.appendChild(excludeHeading);

  const excludeButtonsWrap = document.createElement('div');
  excludeButtonsWrap.className = 'genre-filter-buttons genre-filter-buttons--exclude';
  excludeButtonsWrap.setAttribute('role', 'group');
  excludeButtonsWrap.setAttribute('aria-label', 'Exclude genres from TV stream');

  const createExcludeButton = (value, label, { action } = {}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'genre-filter-btn genre-filter-exclude-btn';
    if (action) {
      btn.dataset.action = action;
    } else {
      btn.dataset.genre = value;
    }
    btn.textContent = label;
    btn.addEventListener('click', handleFeedExcludeGenreButtonClick);
    excludeButtonsWrap.appendChild(btn);
  };

  createExcludeButton('', 'Clear exclusions', { action: 'clear' });
  entries.forEach(([id, name]) => {
    const labelText = String(name || 'Unknown');
    createExcludeButton(String(id), `Exclude ${labelText}`, {});
  });

  excludeSection.appendChild(excludeButtonsWrap);

  const excludeActiveWrap = document.createElement('div');
  excludeActiveWrap.className = 'genre-filter-active genre-filter-exclude-active';

  const excludeActiveLabel = document.createElement('span');
  excludeActiveLabel.className = 'genre-filter-active-label';
  excludeActiveLabel.textContent = 'Excluded genres:';
  excludeActiveWrap.appendChild(excludeActiveLabel);

  const excludeActiveValue = document.createElement('div');
  excludeActiveValue.className = 'genre-filter-active-value genre-filter-exclude-value';
  excludeActiveWrap.appendChild(excludeActiveValue);

  excludeSection.appendChild(excludeActiveWrap);
  container.appendChild(excludeSection);

  if (needsReset) {
    setFeedFilter('genreId', '', { sanitize: false, persist: true });
  }
  if (needsExcludedReset) {
    const sanitized = sanitizeFeedFilterValue(
      'excludedGenreIds',
      validExcludedStrings.join(',')
    );
    setFeedFilter('excludedGenreIds', sanitized, { sanitize: false, persist: true });
  }

  updateFeedGenreUI();
}

function handleFeedGenreButtonClick(event) {
  event.preventDefault();
  const button = event.currentTarget;
  if (!button) return;

  const value = button.dataset.genre ?? '';
  const currentValue = feedFilterState.genreId ?? '';
  const nextValue = currentValue === value ? '' : value;

  if (nextValue === currentValue) return;

  setFeedFilter('genreId', nextValue, { sanitize: true, persist: true });
}

function attachFeedFilterInput(element, name) {
  if (!element) return;

  if (element._feedFilterInputHandler) {
    element.removeEventListener('input', element._feedFilterInputHandler);
  }
  if (element._feedFilterChangeHandler) {
    element.removeEventListener('change', element._feedFilterChangeHandler);
  }

  const inputHandler = event => {
    setFeedFilter(name, event.target.value, { persist: false });
  };

  const changeHandler = event => {
    setFeedFilter(name, event.target.value, { sanitize: true, persist: true });
  };

  element._feedFilterInputHandler = inputHandler;
  element._feedFilterChangeHandler = changeHandler;
  element.addEventListener('input', inputHandler);
  element.addEventListener('change', changeHandler);
}

function attachFeedFilterSelect(element, name) {
  if (!element) return;

  if (element._feedFilterSelectHandler) {
    element.removeEventListener('change', element._feedFilterSelectHandler);
  }

  const handler = event => {
    setFeedFilter(name, event.target.value, { sanitize: true, persist: true });
  };

  element._feedFilterSelectHandler = handler;
  element.addEventListener('change', handler);
}

function handleFeedExcludeGenreButtonClick(event) {
  event.preventDefault();
  const button = event.currentTarget;
  if (!button) return;

  if (button.dataset.action === 'clear') {
    if (!getExcludedGenreIdStrings().length) return;
    setFeedFilter('excludedGenreIds', '', { sanitize: true, persist: true });
    return;
  }

  const value = button.dataset.genre ?? '';
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return;

  const next = getExcludedGenreIdSet();
  if (next.has(numeric)) {
    next.delete(numeric);
  } else {
    next.add(numeric);
  }

  const nextState = buildExcludedGenreStateFromValues(next);
  setFeedFilter('excludedGenreIds', nextState, { sanitize: true, persist: true });
}

async function loadPreferences() {
  if (!loadingPrefsPromise) {
    loadingPrefsPromise = (async () => {
      const authed = await awaitAuthUser().catch(() => null);
      const user = getCurrentUser() || authed;
      const key = user?.uid || 'anonymous';
      activeUserId = user?.uid || null;
      if (prefsLoadedFor === key) return currentPrefs;
      let prefs = {};
      if (user) {
        try {
          const snap = await db.collection(PREF_COLLECTION).doc(user.uid).get();
          const data = snap.exists ? snap.data() : null;
          const storedPrefs = data?.prefs;
          prefs = (storedPrefs && typeof storedPrefs === 'object') ? storedPrefs : {};
          hydrateTmdbDiscoverState(data?.[TMDB_DISCOVER_STATE_FIELD] || null);
        } catch (err) {
          console.error('Failed to load TV show preferences', err);
          prefs = {};
          hydrateTmdbDiscoverState(null);
        }
      } else {
        prefs = loadLocalPrefs();
        hydrateTmdbDiscoverState(loadLocalDiscoverState());
      }
      prefsLoadedFor = key;
      currentPrefs = prefs || {};
      return currentPrefs;
    })().finally(() => {
      loadingPrefsPromise = null;
    });
  }
  return loadingPrefsPromise;
}

async function savePreferences(prefs) {
  currentPrefs = prefs;
  const authed = await awaitAuthUser().catch(() => null);
  const user = getCurrentUser() || authed || (activeUserId ? { uid: activeUserId } : null);
  const uid = user?.uid || activeUserId;
  if (!uid) {
    saveLocalPrefs(prefs);
    return;
  }
  activeUserId = uid;
  try {
    await db.collection(PREF_COLLECTION).doc(uid).set({ prefs }, { merge: true });
  } catch (err) {
    console.error('Failed to save TV show preferences', err);
  }
}

function persistApiKey(key) {
  if (!key) return;
  activeApiKey = key;
  if (typeof window !== 'undefined') {
    window.tmdbApiKey = key;
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(TV_API_KEY_STORAGE, key);
      localStorage.setItem(SHARED_API_KEY_STORAGE, key);
    } catch (_) {
      /* ignore */
    }
  }
  if (domRefs.apiKeyContainer) {
    domRefs.apiKeyContainer.style.display = 'none';
  }
}

function resolveApiKey() {
  if (activeApiKey) {
    return activeApiKey;
  }
  const value = domRefs.apiKeyInput?.value;
  return typeof value === 'string' ? value.trim() : '';
}

function getTmdbProxyEndpoint() {
  if (proxyDisabled) return '';
  if (typeof window !== 'undefined' && 'tmdbProxyEndpoint' in window) {
    const value = window.tmdbProxyEndpoint;
    return typeof value === 'string' ? value : '';
  }
  return DEFAULT_TMDB_PROXY_ENDPOINT;
}

function disableTmdbProxy() {
  if (proxyDisabled) return;
  proxyDisabled = true;
  if (domRefs.apiKeyContainer) {
    domRefs.apiKeyContainer.style.display = '';
  }
}

function isProxyEndpointSupported(endpoint) {
  if (!endpoint) return false;
  if (proxyDisabled) return false;
  return !unsupportedProxyEndpoints.has(endpoint);
}

function summarizeProxyError(error) {
  if (!error || typeof error !== 'object') {
    return 'unknown error';
  }

  const parts = [];

  if (typeof error.status === 'number') {
    parts.push(`status ${error.status}`);
  }

  if (error.code) {
    parts.push(`code "${error.code}"`);
  }

  const body = typeof error.body === 'string' ? error.body.trim() : '';
  if (body) {
    parts.push(`body: ${body.slice(0, 120)}${body.length > 120 ? '…' : ''}`);
  }

  if (!parts.length) {
    return 'unknown error';
  }

  return parts.join(', ');
}

function isProxyParameterError(err) {
  if (!err || typeof err !== 'object') {
    return false;
  }
  return err.code === 'unsupported_endpoint' || err.code === 'invalid_endpoint_params';
}

async function callTmdbProxy(endpoint, params = {}) {
  const proxyEndpoint = getTmdbProxyEndpoint();
  if (!proxyEndpoint) {
    throw new Error('TMDB proxy endpoint not configured');
  }

  const url = new URL(proxyEndpoint);
  url.searchParams.set('endpoint', endpoint);
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(v => url.searchParams.append(key, String(v)));
    } else if (value != null) {
      url.searchParams.set(key, String(value));
    }
  });

  let response;
  try {
    response = await fetch(url.toString());
  } catch (err) {
    disableTmdbProxy();
    throw err;
  }

  if (!response.ok) {
    const error = new Error(`TMDB proxy request failed (status ${response.status})`);
    error.endpoint = endpoint;
    error.status = response.status;
    if (response.statusText) {
      error.statusText = response.statusText;
    }
    try {
      error.body = await response.text();
    } catch (_) {
      error.body = null;
    }

    let parsedBody = null;
    if (typeof error.body === 'string' && error.body.trim()) {
      try {
        parsedBody = JSON.parse(error.body);
      } catch (_) {
        parsedBody = null;
      }
    }

    if (parsedBody && parsedBody.error && !error.code) {
      error.code = parsedBody.error;
    }

    if (parsedBody && parsedBody.message && !error.messageDetail) {
      error.messageDetail = parsedBody.message;
    }

    const shouldDisableProxy = (() => {
      if (response.status >= 500) return true;
      if (response.status === 401 || response.status === 403) return true;
      const bodyText = typeof error.body === 'string' ? error.body : '';
      if (!bodyText) return false;
      if (bodyText.includes('tmdb_key_not_configured')) return true;
      if (response.status === 400) {
        try {
          const parsed = parsedBody || JSON.parse(bodyText);
          const code = parsed?.error;
          if (code === 'unsupported_endpoint') {
            if (endpoint) {
              unsupportedProxyEndpoints.add(endpoint);
            }
            return false;
          }
          if (code === 'invalid_endpoint_params') {
            return false;
          }
          return false;
        } catch (_) {
          return false;
        }
      }
      return false;
    })();

    if (shouldDisableProxy) {
      disableTmdbProxy();
    }

    throw error;
  }
  return response.json();
}

function summarizeMovie(movie) {
  return {
    id: movie.id,
    title: movie.title || movie.name || '',
    release_date: movie.release_date || '',
    poster_path: movie.poster_path || '',
    overview: movie.overview || '',
    vote_average: movie.vote_average ?? null,
    vote_count: movie.vote_count ?? null,
    genre_ids: Array.isArray(movie.genre_ids) ? movie.genre_ids : [],
    topCast: getNameList(movie.topCast).slice(0, 5),
    directors: getNameList(movie.directors).slice(0, 3)
  };
}

function makeActionButton(label, handler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'movie-action';
  btn.textContent = label;
  btn.addEventListener('click', handler);
  return btn;
}

function appendMeta(list, label, value) {
  if (!value && value !== 0) return;
  const item = document.createElement('li');
  const strong = document.createElement('strong');
  strong.textContent = `${label}:`;
  item.append(strong, ` ${value}`);
  list.appendChild(item);
}

function getReleaseDate(movie) {
  if (!movie) return '';
  const raw = String(movie.release_date || movie.first_air_date || '').trim();
  return raw;
}

function getReleaseYear(movie) {
  const releaseDate = getReleaseDate(movie);
  if (!releaseDate) return '';
  const [year] = releaseDate.split('-');
  return (year || '').trim();
}

function getGenreNames(movie) {
  if (!movie) return [];
  const ids = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
  return ids.map(id => genreMap[id]).filter(Boolean);
}

function appendGenresMeta(list, movie) {
  const genres = getGenreNames(movie);
  if (genres.length) {
    appendMeta(list, 'Genres', genres.join(', '));
  }
}

function hasActiveInterestedGenres() {
  return activeInterestedGenres.size > 0;
}

function toggleInterestedGenre(value) {
  if (!value) {
    if (!hasActiveInterestedGenres()) return;
    activeInterestedGenres.clear();
    renderInterestedList();
    return;
  }

  if (activeInterestedGenres.has(value)) {
    activeInterestedGenres.delete(value);
  } else {
    activeInterestedGenres.add(value);
  }
  renderInterestedList();
}

function removeInterestedGenre(value) {
  if (!value) return;
  if (activeInterestedGenres.delete(value)) {
    renderInterestedList();
  }
}

function renderInterestedFilters(genres) {
  const container = domRefs.interestedFilters;
  if (!container) return;

  if (!genres.length) {
    container.innerHTML = '';
    container.style.display = 'none';
    activeInterestedGenres.clear();
    return;
  }

  container.style.display = '';
  container.innerHTML = '';

  const sorted = [...new Set(genres)].sort((a, b) => a.localeCompare(b));

  const buttonsWrap = document.createElement('div');
  buttonsWrap.className = 'genre-filter-buttons';

  const createButton = (label, value) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'genre-filter-btn';
    const isActive = value ? activeInterestedGenres.has(value) : !hasActiveInterestedGenres();
    if (isActive) {
      btn.classList.add('active');
    }
    btn.textContent = label;
    btn.dataset.genre = value ?? '';
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    btn.addEventListener('click', () => {
      toggleInterestedGenre(value ?? null);
    });
    return btn;
  };

  buttonsWrap.appendChild(createButton('All', null));
  sorted.forEach(name => {
    buttonsWrap.appendChild(createButton(name, name));
  });

  const activeWrap = document.createElement('div');
  activeWrap.className = 'genre-filter-active';

  if (hasActiveInterestedGenres()) {
    const label = document.createElement('span');
    label.className = 'genre-filter-active-label';
    label.textContent = 'Filtering by:';
    activeWrap.appendChild(label);

    Array.from(activeInterestedGenres)
      .sort((a, b) => a.localeCompare(b))
      .forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'genre-filter-chip';

        const text = document.createElement('span');
        text.className = 'genre-filter-chip-text';
        text.textContent = name;
        chip.appendChild(text);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'genre-filter-chip-remove';
        removeBtn.setAttribute('aria-label', `Remove ${name} filter`);
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => removeInterestedGenre(name));
        chip.appendChild(removeBtn);

        activeWrap.appendChild(chip);
      });
  }

  container.append(buttonsWrap, activeWrap);
}

function appendPeopleMeta(list, label, names) {
  const values = getNameList(names);
  if (!values.length) return;
  appendMeta(list, label, values.join(', '));
}

function getVoteAverageValue(movie) {
  if (!movie) return null;
  const value = Number(movie.vote_average);
  return Number.isFinite(value) ? value : null;
}

function getVoteCountValue(movie) {
  if (!movie) return null;
  const value = Number(movie.vote_count);
  return Number.isFinite(value) ? value : null;
}

function getFilterFloat(value, min = -Infinity, max = Infinity) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const number = Number.parseFloat(trimmed.replace(',', '.'));
  if (!Number.isFinite(number)) return null;
  const clamped = Math.min(max, Math.max(min, number));
  return clamped;
}

function getFilterInt(value, min = -Infinity, max = Infinity) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const number = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(number)) return null;
  const clamped = Math.min(max, Math.max(min, number));
  return clamped;
}

function getMovieReleaseYear(movie) {
  if (!movie) return null;
  const raw = String(movie.release_date || movie.first_air_date || '').trim();
  if (!raw) return null;
  const year = Number.parseInt(raw.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function getMovieGenreIdSet(movie) {
  const ids = new Set();
  if (movie && Array.isArray(movie.genre_ids)) {
    movie.genre_ids.forEach(id => {
      const num = Number(id);
      if (Number.isFinite(num)) {
        ids.add(num);
      }
    });
  }
  if (movie && Array.isArray(movie.genres)) {
    movie.genres.forEach(entry => {
      const num = Number(entry?.id);
      if (Number.isFinite(num)) {
        ids.add(num);
      }
    });
  }
  return ids;
}

function applyFeedFilters(movies) {
  if (!Array.isArray(movies) || !movies.length) return [];

  const minRating = getFilterFloat(feedFilterState.minRating, 0, 10);
  const minVotes = getFilterInt(feedFilterState.minVotes, 0);
  let startYear = getFilterInt(feedFilterState.startYear, 1800, 3000);
  let endYear = getFilterInt(feedFilterState.endYear, 1800, 3000);

  if (startYear != null && endYear != null && endYear < startYear) {
    const temp = startYear;
    startYear = endYear;
    endYear = temp;
  }

  const rawGenreId = feedFilterState.genreId;
  const genreId = rawGenreId != null && String(rawGenreId).trim() !== ''
    ? Number.parseInt(rawGenreId, 10)
    : null;
  const hasGenreFilter = Number.isFinite(genreId);
  const excludedGenreIds = getExcludedGenreIdSet();
  const hasExcludedGenres = excludedGenreIds.size > 0;

  return movies.filter(movie => {
    if (minRating != null) {
      const rating = getVoteAverageValue(movie);
      if (rating == null || rating < minRating) {
        return false;
      }
    }

    if (minVotes != null) {
      const votes = getVoteCountValue(movie);
      if (votes == null || votes < minVotes) {
        return false;
      }
    }

    if (startYear != null || endYear != null) {
      const year = getMovieReleaseYear(movie);
      if (startYear != null && (year == null || year < startYear)) {
        return false;
      }
      if (endYear != null && (year == null || year > endYear)) {
        return false;
      }
    }

    let ids = null;
    if (hasGenreFilter || hasExcludedGenres) {
      ids = getMovieGenreIdSet(movie);
    }

    if (hasGenreFilter) {
      if (!ids.has(genreId)) {
        return false;
      }
    }

    if (hasExcludedGenres) {
      for (const excludedId of excludedGenreIds) {
        if (ids.has(excludedId)) {
          return false;
        }
      }
    }

    return true;
  });
}

function createRatingElement(movie) {
  const rating = getVoteAverageValue(movie);
  const votes = getVoteCountValue(movie);
  if (rating == null && votes == null) return null;
  const ratingEl = document.createElement('p');
  ratingEl.className = 'movie-rating';
  if (rating == null) {
    ratingEl.textContent = 'Rating not available';
  } else {
    const votesText = votes == null ? '' : ` (${votes} votes)`;
    ratingEl.textContent = `Rating: ${rating.toFixed(1)} / 10${votesText}`;
  }
  return ratingEl;
}

function createUserRatingElement(pref) {
  if (!pref || !pref.movie) return null;

  const container = document.createElement('label');
  container.className = 'movie-personal-rating';
  container.textContent = 'Your Rating: ';

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.max = '10';
  input.step = '0.5';
  input.inputMode = 'decimal';
  input.placeholder = '—';

  if (pref.userRating != null && pref.userRating !== '') {
    const rating = clampUserRating(Number(pref.userRating));
    if (rating != null) {
      input.value = rating.toString();
    }
  }

  input.addEventListener('change', event => {
    const value = Number.parseFloat(event.target.value);
    if (Number.isNaN(value)) {
      setUserRating(pref.movie.id, null);
      return;
    }
    setUserRating(pref.movie.id, value);
  });

  container.appendChild(input);

  return container;
}

function applyCreditsToMovie(movie, credits) {
  if (!movie || !credits) return;
  const cast = Array.isArray(credits.cast) ? credits.cast : [];
  const crew = Array.isArray(credits.crew) ? credits.crew : [];

  const topCast = cast
    .filter(person => person && typeof person.name === 'string')
    .slice(0, 5)
    .map(person => person.name.trim())
    .filter(Boolean);

  const directors = crew
    .filter(person => person && person.job === 'Director' && typeof person.name === 'string')
    .map(person => person.name.trim())
    .filter(Boolean);

  if (topCast.length) {
    movie.topCast = Array.from(new Set(topCast));
  }
  if (directors.length) {
    movie.directors = Array.from(new Set(directors));
  }
}

function hasEnrichedCredits(movie) {
  if (!movie) return false;
  const cast = getNameList(movie.topCast);
  const directors = getNameList(movie.directors);
  return cast.length > 0 && directors.length > 0;
}

async function fetchCreditsDirect(tvId, apiKey) {
  if (!apiKey) return null;
  try {
    const url = new URL(`https://api.themoviedb.org/3/tv/${tvId}/credits`);
    url.searchParams.set('api_key', apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch credits directly for TV show', tvId, err);
    return null;
  }
}

async function fetchCreditsFromProxy(tvId) {
  if (!tvId && tvId !== 0) return null;

  const paramVariants = [{ tv_id: tvId }, { id: tvId }, { tvId }];
  let lastParamError = null;

  for (const params of paramVariants) {
    try {
      const credits = await callTmdbProxy('tv_credits', params);
      if (credits) {
        return credits;
      }
      return null;
    } catch (err) {
      if (!isProxyParameterError(err)) {
        throw err;
      }
      if (err && err.code === 'unsupported_endpoint') {
        unsupportedProxyEndpoints.add('credits');
        throw err;
      }
      lastParamError = err;
    }
  }

  if (lastParamError) {
    unsupportedProxyEndpoints.add('credits');
    throw lastParamError;
  }

  return null;
}

async function fetchCreditsViaDetailsFromProxy(tvId) {
  if (!tvId && tvId !== 0) return null;

  const baseParams = { append_to_response: 'credits' };
  const paramVariants = [
    { ...baseParams, tv_id: tvId },
    { ...baseParams, id: tvId },
    { ...baseParams, tvId }
  ];

  let lastParamError = null;

  for (const params of paramVariants) {
    try {
      const details = await callTmdbProxy('tv_details', params);
      if (details && typeof details === 'object' && details.credits) {
        return details.credits;
      }
      return null;
    } catch (err) {
      if (err && err.status === 400 && !isProxyParameterError(err)) {
        unsupportedProxyEndpoints.add('tv_details');
        if (!err.code) {
          err.code = 'unsupported_endpoint';
        }
      }
      if (!isProxyParameterError(err)) {
        throw err;
      }
      lastParamError = err;
    }
  }

  if (lastParamError) {
    unsupportedProxyEndpoints.add('tv_details');
    throw lastParamError;
  }

  return null;
}

async function fetchCreditsForMovie(tvId, { usingProxy, apiKey }) {
  if (!tvId) return null;
  const proxyEndpoint = getTmdbProxyEndpoint();
  const proxyAvailable = usingProxy && Boolean(proxyEndpoint);
  let needsDetailsFallback =
    proxyAvailable && !isProxyEndpointSupported('credits') && isProxyEndpointSupported('tv_details');

  if (proxyAvailable && isProxyEndpointSupported('credits')) {
    try {
      const credits = await fetchCreditsFromProxy(tvId);
      if (credits) {
        return credits;
      }
    } catch (err) {
      const summary = summarizeProxyError(err);
      if (isProxyParameterError(err)) {
        needsDetailsFallback =
          proxyAvailable && isProxyEndpointSupported('tv_details');
        if (!loggedProxyCreditsUnsupported) {
          console.info(
            `TMDB proxy credits endpoint unavailable (${summary}), attempting tv_details fallback.`
          );
          loggedProxyCreditsUnsupported = true;
        }
      } else {
        console.warn(
          `TMDB proxy credits request failed (${summary}), attempting direct fallback`,
          err
        );
        disableTmdbProxy();
        const direct = await fetchCreditsDirect(tvId, apiKey);
        if (direct) return direct;
        return null;
      }
    }
  }

  if (proxyAvailable && needsDetailsFallback && isProxyEndpointSupported('tv_details')) {
    try {
      const credits = await fetchCreditsViaDetailsFromProxy(tvId);
      if (credits) {
        return credits;
      }
    } catch (err) {
      const summary = summarizeProxyError(err);
      if (isProxyParameterError(err)) {
        // Swallow and fall back to direct fetching below.
      } else {
        console.warn(
          `TMDB proxy movie details request failed (${summary}), attempting direct fallback`,
          err
        );
        disableTmdbProxy();
        const direct = await fetchCreditsDirect(tvId, apiKey);
        if (direct) return direct;
        return null;
      }
    }
  }

  return fetchCreditsDirect(tvId, apiKey);
}

async function enrichMoviesWithCredits(movies, options = {}) {
  if (!Array.isArray(movies) || !movies.length) return;
  const { prefetchedCredits, ...fetchOptions } = options;
  const byId = new Map();
  movies.forEach(movie => {
    if (!movie || movie.id == null) return;
    byId.set(String(movie.id), movie);
  });

  if (prefetchedCredits && typeof prefetchedCredits === 'object') {
    Object.entries(prefetchedCredits).forEach(([id, credits]) => {
      const movie = byId.get(String(id));
      if (!movie) return;
      applyCreditsToMovie(movie, credits);
    });
  }

  const limit = Math.min(MAX_CREDIT_REQUESTS, movies.length);
  const targets = movies
    .slice(0, limit)
    .filter(movie => movie && movie.id != null && !hasEnrichedCredits(movie));
  if (!targets.length) return;

  const creditsList = await Promise.all(
    targets.map(movie => fetchCreditsForMovie(movie.id, fetchOptions))
  );

  creditsList.forEach((credits, index) => {
    const movie = targets[index];
    if (!movie) return;
    applyCreditsToMovie(movie, credits);
  });
}

async function setStatus(movie, status, options = {}) {
  if (!movie || movie.id == null) return;
  const usingProxy = Boolean(getTmdbProxyEndpoint());
  const apiKey = resolveApiKey();
  if (!getNameList(movie.directors).length || !getNameList(movie.topCast).length) {
    if (usingProxy || apiKey) {
      try {
        const credits = await fetchCreditsForMovie(movie.id, { usingProxy, apiKey });
        applyCreditsToMovie(movie, credits);
      } catch (err) {
        console.warn('Failed to enrich TV show credits before saving status', movie.id, err);
      }
    }
  }
  await loadPreferences();
  const id = String(movie.id);
  const next = { ...currentPrefs };
  const snapshot = summarizeMovie(movie);
  const entry = next[id] ? { ...next[id] } : {};
  const skipRatingPrompt = Boolean(options.skipRatingPrompt);
  entry.status = status;
  entry.updatedAt = Date.now();
  if (status === 'interested') {
    entry.interest = options.interest ?? entry.interest ?? DEFAULT_INTEREST;
    entry.movie = snapshot;
    delete entry.userRating;
  } else if (status === 'watched') {
    entry.movie = snapshot;
    delete entry.interest;
  } else if (status === 'notInterested') {
    delete entry.movie;
    delete entry.interest;
    delete entry.userRating;
  }
  next[id] = entry;
  await savePreferences(next);
  pruneSuppressedMovies();
  refreshUI();
  if (status === 'watched' && !skipRatingPrompt) {
    await promptForUserRating(movie);
  }
  if (!getFeedMovies(currentMovies).length) {
    requestAdditionalMovies();
  }
}

async function promptForUserRating(movie) {
  if (!movie || movie.id == null) return;
  const hasWindow = typeof window !== 'undefined' && window;
  const promptFn = hasWindow && typeof window.prompt === 'function' ? window.prompt : null;
  if (!promptFn) return;

  const title = (movie.name || movie.title || '').trim() || 'this show';
  const message = `Rate "${title}" on a scale of 0-10 (leave blank to skip).`;

  let response;
  try {
    response = promptFn(message, '');
  } catch (err) {
    console.warn('Failed to prompt for show rating', movie.id, err);
    return;
  }

  if (response == null) return;
  if (typeof response !== 'string') return;

  const trimmed = response.trim();
  if (!trimmed) return;

  const value = Number.parseFloat(trimmed);
  if (Number.isNaN(value)) return;

  await setUserRating(movie.id, value);
}

async function setUserRating(tvId, rating) {
  await loadPreferences();
  const id = String(tvId);
  const pref = currentPrefs[id];
  if (!pref || pref.status !== 'watched') return;

  const next = { ...currentPrefs };
  const entry = { ...pref };

  if (rating == null) {
    delete entry.userRating;
  } else {
    entry.userRating = clampUserRating(rating);
  }
  entry.updatedAt = Date.now();
  next[id] = entry;
  await savePreferences(next);
  refreshUI();
}

async function clearStatus(tvId) {
  await loadPreferences();
  const id = String(tvId);
  const next = { ...currentPrefs };
  const removed = next[id];
  delete next[id];
  await savePreferences(next);
  if (removed && removed.movie) {
    const exists = Array.isArray(currentMovies)
      ? currentMovies.some(movie => String(movie?.id) === id)
      : false;
    if (!exists) {
      const restored = { ...removed.movie };
      currentMovies = [restored, ...(Array.isArray(currentMovies) ? currentMovies : [])];
      currentMovies = applyPriorityOrdering(currentMovies);
      feedExhausted = false;
    }
  }
  pruneSuppressedMovies();
  refreshUI();
  if (!getFeedMovies(currentMovies).length) {
    requestAdditionalMovies();
  }
}

function getFeedMovies(movies) {
  if (!Array.isArray(movies) || !movies.length) return [];

  return movies.filter(movie => !isMovieSuppressed(movie?.id));
}

function isMovieSuppressed(tvId) {
  if (tvId == null) return false;
  const pref = currentPrefs[String(tvId)];
  return Boolean(pref && SUPPRESSED_STATUSES.has(pref.status));
}

function pruneSuppressedMovies() {
  if (!Array.isArray(currentMovies) || !currentMovies.length) return;
  currentMovies = currentMovies.filter(movie => !isMovieSuppressed(movie?.id));
  feedExhausted = false;
}

async function requestAdditionalMovies() {
  const now = Date.now();
  if (refillInProgress) {
    const started = formatTimestamp(lastRefillAttempt);
    const label = started ? ` (started at ${started})` : '';
    updateFeedStatus(`TV show request already in progress${label}.`, {
      tone: 'info',
      showSpinner: true
    });
    return;
  }
  if (now - lastRefillAttempt < REFILL_COOLDOWN_MS) {
    const waitMs = Math.max(0, REFILL_COOLDOWN_MS - (now - lastRefillAttempt));
    const waitSeconds = Math.ceil(waitMs / 1000);
    updateFeedStatus(`Waiting ${waitSeconds}s before requesting more TV shows...`, {
      tone: 'info'
    });
    if (!pendingRefillCooldownTimer) {
      pendingRefillCooldownTimer = setTimeout(() => {
        pendingRefillCooldownTimer = null;
        requestAdditionalMovies();
      }, waitMs);
    }
    return;
  }
  if (pendingRefillCooldownTimer) {
    clearTimeout(pendingRefillCooldownTimer);
    pendingRefillCooldownTimer = null;
  }
  refillInProgress = true;
  lastRefillAttempt = now;
  feedExhausted = false;
  try {
    await loadMovies({ attemptStart: now });
  } finally {
    refillInProgress = false;
    renderFeed();
  }
}

function renderFeed() {
  const listEl = domRefs.list;
  if (!listEl) return;

  if (!currentMovies.length) {
    if (refillInProgress) {
      listEl.innerHTML = '<em>Loading more TV shows...</em>';
      updateFeedStatus('Waiting for TV shows from TMDB...', { tone: 'info', showSpinner: true });
      return;
    }
    if (feedExhausted) {
      listEl.innerHTML = hasActiveFeedFilters()
        ? '<em>No TV shows match the current filters.</em>'
        : '<em>No TV shows found.</em>';
      updateFeedStatus(
        hasActiveFeedFilters()
          ? 'TMDB did not return TV shows that match your filters.'
          : 'TMDB did not return any TV shows. Try again later.',
        { tone: 'warning' }
      );
      return;
    }
    listEl.innerHTML = '<em>Loading more TV shows...</em>';
    updateFeedStatus('Requesting the first batch of TV shows...', {
      tone: 'info',
      showSpinner: true
    });
    requestAdditionalMovies();
    return;
  }

  const availableMovies = getFeedMovies(currentMovies);

  if (!availableMovies.length) {
    if (refillInProgress) {
      listEl.innerHTML = '<em>Loading more TV shows...</em>';
      updateFeedStatus('All current results are hidden; waiting for new TV shows...', {
        tone: 'info',
        showSpinner: true
      });
      return;
    }
    listEl.innerHTML = '<em>Loading more TV shows...</em>';
    updateFeedStatus(
      'All fetched TV shows are hidden by saved statuses. Looking for fresh titles...',
      { tone: 'warning', showSpinner: true }
    );
    requestAdditionalMovies();
    return;
  }

  const filteredMovies = applyFeedFilters(availableMovies);

  if (!filteredMovies.length) {
    if (refillInProgress) {
      listEl.innerHTML = '<em>Loading more TV shows...</em>';
      updateFeedStatus('Filters removed the current batch; waiting for more TV shows...', {
        tone: 'info',
        showSpinner: true
      });
      return;
    }
    if (feedExhausted) {
      listEl.innerHTML = hasActiveFeedFilters()
        ? '<em>No TV shows match the current filters.</em>'
        : '<em>No TV shows found.</em>';
      updateFeedStatus(
        hasActiveFeedFilters()
          ? 'Filters are hiding every TV show that is currently available.'
          : 'TMDB did not return any additional TV shows.',
        { tone: 'warning' }
      );
      return;
    }
    listEl.innerHTML = '<em>Loading more TV shows...</em>';
    const hiddenByFilters = availableMovies.length;
    updateFeedStatus(
      hiddenByFilters
        ? `Filters are hiding ${hiddenByFilters} show${hiddenByFilters === 1 ? '' : 's'}; requesting more options...`
        : 'Filters removed the current batch; requesting more TV shows...',
      { tone: 'warning', showSpinner: true }
    );
    requestAdditionalMovies();
    return;
  }

  const ul = document.createElement('ul');
  filteredMovies.forEach(movie => {
    const li = document.createElement('li');
    li.className = 'movie-card';

    if (movie.poster_path) {
      const img = document.createElement('img');
      img.src = `https://image.tmdb.org/t/p/w200${movie.poster_path}`;
      img.alt = `${movie.title || movie.name || 'Movie'} poster`;
      li.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'movie-info';

    const title = (movie.title || movie.name || '').trim();
    const releaseDate = getReleaseDate(movie);
    const year = getReleaseYear(movie);
    const titleEl = document.createElement('h3');
    titleEl.textContent = year ? `${title} (${year})` : title;
    info.appendChild(titleEl);

    const btnRow = document.createElement('div');
    btnRow.className = 'button-row';
    btnRow.append(
      makeActionButton('Watched Already', () => setStatus(movie, 'watched')),
      makeActionButton('Not Interested', () => setStatus(movie, 'notInterested')),
      makeActionButton('Interested', () => setStatus(movie, 'interested', { interest: DEFAULT_INTEREST }))
    );
    info.appendChild(btnRow);

    const metaList = document.createElement('ul');
    metaList.className = 'movie-meta';

    appendGenresMeta(metaList, movie);
    appendMeta(metaList, 'Average Score', movie.vote_average ?? 'N/A');
    appendMeta(metaList, 'Votes', movie.vote_count ?? 'N/A');
    if (releaseDate) {
      appendMeta(metaList, 'Release Date', releaseDate);
    }
    appendPeopleMeta(metaList, 'Director', movie.directors);
    appendPeopleMeta(metaList, 'Cast', movie.topCast);

    if (metaList.childNodes.length) {
      info.appendChild(metaList);
    }

    if (movie.overview) {
      const overview = document.createElement('p');
      overview.textContent = movie.overview;
      info.appendChild(overview);
    }

    li.appendChild(info);
    ul.appendChild(li);
  });

  listEl.innerHTML = '';
  listEl.appendChild(ul);
  updateFeedStatus(
    `Showing ${filteredMovies.length} show${filteredMovies.length === 1 ? '' : 's'} (updated ${formatTimestamp(
      Date.now()
    )}).`,
    { tone: 'success' }
  );
}

function renderInterestedList() {
  const listEl = domRefs.interestedList;
  if (!listEl) return;

  const allEntries = Object.values(currentPrefs)
    .filter(pref => pref.status === 'interested' && pref.movie)
    .sort((a, b) => (b.interest ?? 0) - (a.interest ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const genres = [];
  allEntries.forEach(pref => {
    const names = getGenreNames(pref.movie);
    if (names.length) {
      genres.push(...names);
    }
  });

  let removed = false;
  Array.from(activeInterestedGenres).forEach(name => {
    if (!genres.includes(name)) {
      activeInterestedGenres.delete(name);
      removed = true;
    }
  });

  if (removed && !genres.length) {
    activeInterestedGenres.clear();
  }

  renderInterestedFilters(genres);

  if (!allEntries.length) {
    listEl.innerHTML = '<em>No interested TV shows yet.</em>';
    return;
  }

  const selectedGenres = Array.from(activeInterestedGenres);
  const entries = selectedGenres.length
    ? allEntries.filter(pref => {
        const names = getGenreNames(pref.movie);
        return names.some(name => activeInterestedGenres.has(name));
      })
    : allEntries;

  if (!entries.length) {
    listEl.innerHTML = '<em>No interested TV shows for the selected genre.</em>';
    return;
  }

  const ul = document.createElement('ul');
  entries.forEach(pref => {
    const movie = pref.movie;
    const li = document.createElement('li');
    li.className = 'movie-card';

    if (movie.poster_path) {
      const img = document.createElement('img');
      img.src = `https://image.tmdb.org/t/p/w200${movie.poster_path}`;
      img.alt = `${movie.title || 'TV Show'} poster`;
      li.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'movie-info';

    const releaseDate = getReleaseDate(movie);
    const year = getReleaseYear(movie);
    const titleEl = document.createElement('h3');
    const titleText = movie.title || 'Untitled';
    titleEl.textContent = year ? `${titleText} (${year})` : titleText;
    info.appendChild(titleEl);

    const interestRow = document.createElement('div');
    interestRow.className = 'interest-row';
    const label = document.createElement('span');
    label.textContent = `Interest: ${pref.interest ?? DEFAULT_INTEREST}`;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '1';
    slider.max = '5';
    slider.value = String(pref.interest ?? DEFAULT_INTEREST);
    slider.addEventListener('input', () => {
      label.textContent = `Interest: ${slider.value}`;
    });
    slider.addEventListener('change', async () => {
      const updated = { ...currentPrefs };
      const entry = updated[String(movie.id)];
      if (entry) {
        entry.interest = Number(slider.value);
        entry.updatedAt = Date.now();
        await savePreferences(updated);
        renderInterestedList();
      }
    });

    interestRow.append(label, slider);
    info.appendChild(interestRow);

    if (movie.overview) {
      const overview = document.createElement('p');
      overview.textContent = movie.overview;
      info.appendChild(overview);
    }

    const metaList = document.createElement('ul');
    metaList.className = 'movie-meta';
    appendGenresMeta(metaList, movie);
    appendPeopleMeta(metaList, 'Director', movie.directors);
    appendPeopleMeta(metaList, 'Cast', movie.topCast);
    if (metaList.childNodes.length) {
      info.appendChild(metaList);
    }

    const controls = document.createElement('div');
    controls.className = 'button-row';
    controls.append(makeActionButton('Remove', () => clearStatus(movie.id)));
    info.appendChild(controls);

    li.appendChild(info);
    ul.appendChild(li);
  });

  listEl.innerHTML = '';
  listEl.appendChild(ul);
}

function renderWatchedList() {
  const listEl = domRefs.watchedList;
  if (!listEl) return;

  const entries = Object.values(currentPrefs).filter(
    pref => pref.status === 'watched' && pref.movie
  );

  const sorted = entries.slice();

  const byUpdatedAt = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  const getEffectiveRating = pref => {
    if (pref.userRating != null) {
      const rating = clampUserRating(Number(pref.userRating));
      if (rating != null) return rating;
    }
    return getVoteAverageValue(pref.movie);
  };

  const byRatingDesc = (a, b) => {
    const aRating = getEffectiveRating(a);
    const bRating = getEffectiveRating(b);
    if (aRating == null && bRating == null) return byUpdatedAt(a, b);
    if (aRating == null) return 1;
    if (bRating == null) return -1;
    if (bRating !== aRating) return bRating - aRating;
    const aVotes = getVoteCountValue(a.movie);
    const bVotes = getVoteCountValue(b.movie);
    if (aVotes == null && bVotes == null) return byUpdatedAt(a, b);
    if (aVotes == null) return 1;
    if (bVotes == null) return -1;
    if (bVotes !== aVotes) return bVotes - aVotes;
    return byUpdatedAt(a, b);
  };
  const byRatingAsc = (a, b) => {
    const aRating = getEffectiveRating(a);
    const bRating = getEffectiveRating(b);
    if (aRating == null && bRating == null) return byUpdatedAt(a, b);
    if (aRating == null) return 1;
    if (bRating == null) return -1;
    if (aRating !== bRating) return aRating - bRating;
    const aVotes = getVoteCountValue(a.movie);
    const bVotes = getVoteCountValue(b.movie);
    if (aVotes == null && bVotes == null) return byUpdatedAt(a, b);
    if (aVotes == null) return 1;
    if (bVotes == null) return -1;
    if (aVotes !== bVotes) return aVotes - bVotes;
    return byUpdatedAt(a, b);
  };

  if (watchedSortMode === 'ratingDesc') {
    sorted.sort(byRatingDesc);
  } else if (watchedSortMode === 'ratingAsc') {
    sorted.sort(byRatingAsc);
  } else {
    sorted.sort(byUpdatedAt);
  }

  if (domRefs.watchedSort) {
    domRefs.watchedSort.value = watchedSortMode;
  }

  if (!sorted.length) {
    listEl.innerHTML = '<em>No watched TV shows yet.</em>';
    return;
  }

  const rated = [];
  const unrated = [];

  const hasUserRating = pref => {
    if (pref.userRating == null || pref.userRating === '') return false;
    return clampUserRating(Number(pref.userRating)) != null;
  };

  sorted.forEach(pref => {
    if (hasUserRating(pref)) {
      rated.push(pref);
    } else {
      unrated.push(pref);
    }
  });

  const createCard = pref => {
    const movie = pref.movie;
    const li = document.createElement('li');
    li.className = 'movie-card';

    if (movie.poster_path) {
      const img = document.createElement('img');
      img.src = `https://image.tmdb.org/t/p/w200${movie.poster_path}`;
      img.alt = `${movie.title || 'TV Show'} poster`;
      li.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'movie-info';

    const releaseDate = getReleaseDate(movie);
    const year = getReleaseYear(movie);
    const titleEl = document.createElement('h3');
    const titleText = movie.title || 'Untitled';
    titleEl.textContent = year ? `${titleText} (${year})` : titleText;
    info.appendChild(titleEl);

    const ratingEl = createRatingElement(movie);
    if (ratingEl) {
      info.appendChild(ratingEl);
    }

    const personalRatingEl = createUserRatingElement(pref);
    if (personalRatingEl) {
      info.appendChild(personalRatingEl);
    }

    if (movie.overview) {
      const overview = document.createElement('p');
      overview.textContent = movie.overview;
      info.appendChild(overview);
    }

    const metaList = document.createElement('ul');
    metaList.className = 'movie-meta';
    appendMeta(metaList, 'Average Score', movie.vote_average ?? 'N/A');
    appendMeta(metaList, 'Votes', movie.vote_count ?? 'N/A');
    if (releaseDate) {
      appendMeta(metaList, 'Release Date', releaseDate);
    }
    appendGenresMeta(metaList, movie);
    appendPeopleMeta(metaList, 'Director', movie.directors);
    appendPeopleMeta(metaList, 'Cast', movie.topCast);
    if (metaList.childNodes.length) {
      info.appendChild(metaList);
    }

    const controls = document.createElement('div');
    controls.className = 'button-row';
    controls.append(makeActionButton('Remove', () => clearStatus(movie.id)));
    info.appendChild(controls);

    li.appendChild(info);
    return li;
  };

  const createColumn = (title, prefs, emptyMessage) => {
    const column = document.createElement('section');
    column.className = 'watched-column';

    const heading = document.createElement('h4');
    heading.textContent = title;
    column.appendChild(heading);

    if (!prefs.length) {
      const empty = document.createElement('p');
      empty.className = 'watched-empty';
      empty.innerHTML = `<em>${emptyMessage}</em>`;
      column.appendChild(empty);
      return column;
    }

    const columnList = document.createElement('ul');
    prefs.forEach(pref => {
      columnList.appendChild(createCard(pref));
    });
    column.appendChild(columnList);
    return column;
  };

  const container = document.createElement('div');
  container.className = 'watched-columns';
  container.appendChild(createColumn('Rated', rated, 'No rated shows yet.'));
  container.appendChild(createColumn('Unrated', unrated, 'No unrated shows yet.'));

  listEl.innerHTML = '';
  listEl.appendChild(container);
}

function refreshUI() {
  renderFeed();
  renderInterestedList();
  renderWatchedList();
}

function selectPriorityCandidates(movies) {
  if (!Array.isArray(movies) || !movies.length) return [];

  const thresholds = [
    { minAverage: MIN_VOTE_AVERAGE, minVotes: MIN_VOTE_COUNT },
    {
      minAverage: Math.max(6.5, MIN_VOTE_AVERAGE - 0.5),
      minVotes: Math.max(25, Math.floor(MIN_VOTE_COUNT / 2))
    },
    { minAverage: 6, minVotes: 10 }
  ];

  let bestFallback = [];
  for (const { minAverage, minVotes } of thresholds) {
    const filtered = movies.filter(movie => meetsQualityThreshold(movie, minAverage, minVotes));
    if (filtered.length >= MIN_PRIORITY_RESULTS) {
      return filtered;
    }
    if (filtered.length && bestFallback.length === 0) {
      bestFallback = filtered;
    }
  }

  if (bestFallback.length) return bestFallback;

  return movies.filter(movie => {
    const average = Number(movie?.vote_average ?? NaN);
    const votes = Number(movie?.vote_count ?? NaN);
    return Number.isFinite(average) && Number.isFinite(votes);
  });
}

function applyPriorityOrdering(movies) {
  if (!Array.isArray(movies) || !movies.length) return movies || [];

  const candidates = selectPriorityCandidates(movies);
  if (!candidates.length) return [];

  const maxVotes = Math.max(...candidates.map(m => Math.max(0, m.vote_count || 0)), 1);
  const now = Date.now();
  const yearMs = 365 * 24 * 60 * 60 * 1000;

  return candidates
    .map(movie => {
      const rawAverage = Math.max(0, Math.min(10, movie.vote_average ?? 0)) / 10;
      const votes = Math.max(0, movie.vote_count || 0);
      const voteVolume = Math.log10(votes + 1) / Math.log10(maxVotes + 1);

      const confidence = Math.min(1, votes / 150);
      const adjustedAverage = rawAverage * confidence + 0.6 * (1 - confidence);

      let recency = 0.5;
      if (movie.release_date) {
        const release = new Date(movie.release_date).getTime();
        if (!Number.isNaN(release)) {
          const diff = now - release;
          if (diff <= 0) {
            recency = 1;
          } else if (diff >= yearMs) {
            recency = 0;
          } else {
            recency = 1 - diff / yearMs;
          }
        }
      }

      const priority = (adjustedAverage * 0.3) + (Math.sqrt(Math.max(0, voteVolume)) * 0.5) + (recency * 0.2);
      return { ...movie, __priority: priority };
    })
    .sort((a, b) => (b.__priority ?? 0) - (a.__priority ?? 0));
}

async function fetchDiscoverPageDirect(apiKey, page) {
  const params = new URLSearchParams({
    api_key: apiKey,
    sort_by: 'popularity.desc',
    include_adult: 'false',
    include_video: 'false',
    language: 'en-US',
    page: String(page)
  });
  const rawGenreId = feedFilterState.genreId;
  const genreId = rawGenreId != null && String(rawGenreId).trim() !== ''
    ? Number.parseInt(rawGenreId, 10)
    : null;
  if (Number.isFinite(genreId)) {
    params.set('with_genres', String(genreId));
  }
  const excludedGenres = getExcludedGenreIdStrings();
  if (excludedGenres.length) {
    params.set('without_genres', excludedGenres.join(','));
  }
  const res = await fetch(`https://api.themoviedb.org/3/discover/tv?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch TV shows');
  const data = await res.json();
  const totalPages = Number(data.total_pages);
  return {
    results: Array.isArray(data.results) ? data.results : [],
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : null
  };
}

async function fetchGenreMapDirect(apiKey) {
  try {
    const res = await fetch(`https://api.themoviedb.org/3/genre/tv/list?api_key=${apiKey}`);
    if (!res.ok) return {};
    const data = await res.json();
    return Object.fromEntries((data.genres || []).map(g => [g.id, g.name]));
  } catch (_) {
    return {};
  }
}

async function fetchDiscoverPageFromProxy(page) {
  const rawGenreId = feedFilterState.genreId;
  const genreId = rawGenreId != null && String(rawGenreId).trim() !== ''
    ? Number.parseInt(rawGenreId, 10)
    : null;
  const excludedGenres = getExcludedGenreIdStrings();
  const data = await callTmdbProxy('discover_tv', {
    sort_by: 'popularity.desc',
    include_adult: 'false',
    include_video: 'false',
    language: 'en-US',
    page: String(page),
    ...(Number.isFinite(genreId) ? { with_genres: String(genreId) } : {}),
    ...(excludedGenres.length ? { without_genres: excludedGenres.join(',') } : {})
  });
  const totalPages = Number(data?.total_pages);
  return {
    results: Array.isArray(data?.results) ? data.results : [],
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : null
  };
}

function normalizeGenreMap(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const entries = raw
      .map(entry => {
        const id = Number(entry?.id);
        const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
        if (!Number.isFinite(id) || !name) return null;
        return [id, name];
      })
      .filter(Boolean);
    return entries.length ? Object.fromEntries(entries) : null;
  }
  if (typeof raw === 'object') {
    const entries = Object.entries(raw)
      .map(([id, value]) => {
        const numericId = Number(id);
        const name = typeof value === 'string' ? value.trim() : '';
        if (!Number.isFinite(numericId) || !name) return null;
        return [numericId, name];
      })
      .filter(Boolean);
    return entries.length ? Object.fromEntries(entries) : null;
  }
  return null;
}

function normalizeCreditsMap(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const normalized = {};
  Object.entries(raw).forEach(([id, credits]) => {
    if (!credits || typeof credits !== 'object') return;
    const cast = Array.isArray(credits.cast) ? credits.cast : [];
    const crew = Array.isArray(credits.crew) ? credits.crew : [];
    if (!cast.length && !crew.length) return;
    normalized[String(id)] = { cast, crew };
  });
  return Object.keys(normalized).length ? normalized : null;
}

function buildTmdbDiscoverKey({ usingProxy }) {
  const parts = [
    usingProxy ? 'proxy' : 'direct',
    feedFilterState.minRating ?? '',
    feedFilterState.minVotes ?? '',
    feedFilterState.startYear ?? '',
    feedFilterState.endYear ?? '',
    feedFilterState.genreId ?? '',
    feedFilterState.excludedGenreIds ?? ''
  ];
  return parts.map(value => String(value ?? '').trim()).join('|');
}

function normalizeTmdbDiscoverStateEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const now = Date.now();
  const nextPageRaw = Number(raw.nextPage);
  const allowedRaw = Number(raw.allowedPages);
  const totalRaw = Number(raw.totalPages);
  const updatedRaw = Number(raw.updatedAt ?? raw.lastAttempt);
  const lastAttemptRaw = Number(raw.lastAttempt);
  const nextPage = Number.isFinite(nextPageRaw) && nextPageRaw > 0 ? Math.floor(nextPageRaw) : 1;
  const allowedPages = Math.max(
    MAX_DISCOVER_PAGES,
    Number.isFinite(allowedRaw) && allowedRaw > 0 ? Math.floor(allowedRaw) : MAX_DISCOVER_PAGES,
    nextPage
  );
  const totalPages = Number.isFinite(totalRaw) && totalRaw > 0 ? Math.floor(totalRaw) : null;
  const updatedAt = Number.isFinite(updatedRaw) && updatedRaw > 0 ? Math.floor(updatedRaw) : now;
  const lastAttempt = Number.isFinite(lastAttemptRaw) && lastAttemptRaw > 0 ? Math.floor(lastAttemptRaw) : null;
  return {
    nextPage,
    allowedPages,
    totalPages,
    exhausted: Boolean(raw.exhausted),
    updatedAt,
    lastAttempt
  };
}

function hydrateTmdbDiscoverState(raw) {
  tmdbDiscoverHistory.clear();
  const container =
    raw && typeof raw === 'object'
      ? (raw.entries && typeof raw.entries === 'object' ? raw.entries : raw)
      : {};
  Object.entries(container).forEach(([key, value]) => {
    const normalized = normalizeTmdbDiscoverStateEntry(value);
    if (!key || !normalized) return;
    tmdbDiscoverHistory.set(String(key), normalized);
  });
  while (tmdbDiscoverHistory.size > TMDB_DISCOVER_HISTORY_LIMIT) {
    const oldest = tmdbDiscoverHistory.keys().next().value;
    if (oldest == null) break;
    tmdbDiscoverHistory.delete(oldest);
  }
  tmdbDiscoverStateDirty = false;
}

function getSerializableTmdbDiscoverState() {
  const entries = {};
  tmdbDiscoverHistory.forEach((value, key) => {
    entries[key] = {
      nextPage: value.nextPage,
      allowedPages: value.allowedPages,
      totalPages: value.totalPages ?? null,
      exhausted: Boolean(value.exhausted),
      updatedAt: value.updatedAt ?? Date.now(),
      lastAttempt: value.lastAttempt ?? null
    };
  });
  return { version: TMDB_DISCOVER_STATE_VERSION, entries };
}

function scheduleTmdbDiscoverPersist() {
  if (tmdbDiscoverPersistTimer) return;
  tmdbDiscoverPersistTimer = setTimeout(() => {
    tmdbDiscoverPersistTimer = null;
    persistTmdbDiscoverState().catch(err => {
      console.warn('Failed to persist TMDB discover state', err);
    });
  }, TMDB_DISCOVER_STATE_PERSIST_DEBOUNCE_MS);
  if (tmdbDiscoverPersistTimer && typeof tmdbDiscoverPersistTimer.unref === 'function') {
    tmdbDiscoverPersistTimer.unref();
  }
}

async function persistTmdbDiscoverState({ immediate = false } = {}) {
  if (!tmdbDiscoverStateDirty && !immediate) return;
  const serialized = getSerializableTmdbDiscoverState();
  if (activeUserId) {
    if (!db || typeof db.collection !== 'function') {
      saveLocalDiscoverState(serialized);
      tmdbDiscoverStateDirty = false;
      return;
    }
    try {
      await db
        .collection(PREF_COLLECTION)
        .doc(activeUserId)
        .set({ [TMDB_DISCOVER_STATE_FIELD]: serialized }, { merge: true });
      tmdbDiscoverStateDirty = false;
    } catch (err) {
      console.warn('Failed to write TMDB discover state to Firestore', err);
      if (immediate) {
        throw err;
      }
      scheduleTmdbDiscoverPersist();
    }
  } else {
    saveLocalDiscoverState(serialized);
    tmdbDiscoverStateDirty = false;
  }
}

function markTmdbDiscoverStateDirty({ immediate = false } = {}) {
  tmdbDiscoverStateDirty = true;
  if (immediate) {
    persistTmdbDiscoverState({ immediate: true }).catch(err => {
      console.warn('Immediate TMDB discover state persistence failed', err);
    });
    return;
  }
  scheduleTmdbDiscoverPersist();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (!tmdbDiscoverStateDirty) return;
    try {
      persistTmdbDiscoverState({ immediate: true });
    } catch (_) {
      /* ignore */
    }
  });
}

function readTmdbDiscoverState(key) {
  if (!key) return null;
  const entry = tmdbDiscoverHistory.get(key);
  if (!entry) return null;
  return { ...entry };
}

function writeTmdbDiscoverState(key, state) {
  if (!key || !state) return;
  const normalizedTotal = Number.isFinite(state.totalPages) && state.totalPages > 0
    ? Math.floor(state.totalPages)
    : null;
  const normalizedAllowed = Number.isFinite(state.allowedPages) && state.allowedPages > 0
    ? Math.floor(state.allowedPages)
    : MAX_DISCOVER_PAGES;
  const nextPage = Number.isFinite(state.nextPage) && state.nextPage > 0
    ? Math.floor(state.nextPage)
    : 1;
  const payload = normalizeTmdbDiscoverStateEntry({
    nextPage,
    allowedPages: normalizedAllowed,
    totalPages: normalizedTotal,
    exhausted: Boolean(state.exhausted),
    updatedAt: Date.now(),
    lastAttempt: Date.now()
  });
  if (!payload) return;
  const existing = tmdbDiscoverHistory.get(key);
  const isSame =
    existing &&
    existing.nextPage === payload.nextPage &&
    existing.allowedPages === payload.allowedPages &&
    (existing.totalPages ?? null) === (payload.totalPages ?? null) &&
    Boolean(existing.exhausted) === Boolean(payload.exhausted);
  if (isSame) {
    tmdbDiscoverHistory.set(key, {
      ...existing,
      updatedAt: payload.updatedAt,
      lastAttempt: payload.lastAttempt
    });
    return;
  }
  tmdbDiscoverHistory.delete(key);
  tmdbDiscoverHistory.set(key, payload);
  while (tmdbDiscoverHistory.size > TMDB_DISCOVER_HISTORY_LIMIT) {
    const oldest = tmdbDiscoverHistory.keys().next().value;
    if (oldest == null) break;
    tmdbDiscoverHistory.delete(oldest);
  }
  markTmdbDiscoverStateDirty();
}

function normalizeCachedMovie(movie) {
  if (!movie || typeof movie !== 'object') return null;
  const normalized = { ...movie };

  if (normalized.vote_average == null && normalized.score != null) {
    const average = Number(normalized.score);
    if (Number.isFinite(average)) {
      normalized.vote_average = average;
    }
  }

  if (normalized.vote_count == null && normalized.voteCount != null) {
    const votes = Number.parseInt(normalized.voteCount, 10);
    if (Number.isFinite(votes)) {
      normalized.vote_count = votes;
    }
  }

  if (!normalized.release_date && typeof normalized.releaseDate === 'string') {
    normalized.release_date = normalized.releaseDate;
  }

  if (!normalized.title && typeof normalized.name === 'string') {
    normalized.title = normalized.name;
  }

  return normalized;
}

function collectMoviesFromCache(results, suppressedIds) {
  const seen = new Set();
  const collected = [];
  (Array.isArray(results) ? results : []).forEach(movie => {
    if (!movie || movie.id == null) return;
    const idKey = String(movie.id);
    if (seen.has(idKey)) return;
    seen.add(idKey);
    if (suppressedIds.has(idKey)) return;
    const normalized = normalizeCachedMovie(movie);
    if (!normalized) return;
    collected.push(normalized);
  });
  return applyPriorityOrdering(collected);
}

async function tryFetchCachedMovies() {
  return null;
}

async function fetchMoviesFromTmdb({
  usingProxy,
  apiKey,
  minFeedSize,
  suppressedIds,
  existingMovies = []
}) {
  const seen = new Set();
  const collected = [];

  (Array.isArray(existingMovies) ? existingMovies : []).forEach(movie => {
    if (!movie || movie.id == null) return;
    const idKey = String(movie.id);
    if (seen.has(idKey)) return;
    seen.add(idKey);
    collected.push(movie);
  });

  let prioritized = applyPriorityOrdering(collected);
  if (applyFeedFilters(prioritized).length >= minFeedSize) {
    return prioritized;
  }

  const requestKey = buildTmdbDiscoverKey({ usingProxy });
  const history = readTmdbDiscoverState(requestKey);
  let page = Math.max(1, history?.nextPage || 1);
  let allowedPages = Math.max(
    MAX_DISCOVER_PAGES,
    Number.isFinite(history?.allowedPages) && history.allowedPages > 0
      ? history.allowedPages
      : MAX_DISCOVER_PAGES,
    page
  );
  let totalPages = Number.isFinite(history?.totalPages) && history.totalPages > 0
    ? history.totalPages
    : Infinity;
  let reachedEnd = false;
  let madeNetworkRequest = false;

  const commitProgress = ({ exhausted } = {}) => {
    if (!madeNetworkRequest) return;
    const normalizedTotal = Number.isFinite(totalPages) && totalPages > 0 ? totalPages : null;
    const payload = {
      nextPage: Math.max(1, page),
      allowedPages: Math.max(allowedPages, MAX_DISCOVER_PAGES, page),
      totalPages: normalizedTotal,
      exhausted:
        exhausted != null
          ? exhausted
          : (reachedEnd && (normalizedTotal == null ? true : page - 1 >= normalizedTotal))
    };
    writeTmdbDiscoverState(requestKey, payload);
  };

  if (
    history &&
    history.exhausted &&
    Number.isFinite(history.totalPages) &&
    history.totalPages > 0 &&
    page > history.totalPages
  ) {
    return prioritized.length ? prioritized : applyPriorityOrdering(collected);
  }

  while (page <= allowedPages && page <= totalPages) {
    const currentPage = page;
    const { results, totalPages: reportedTotal } = usingProxy
      ? await fetchDiscoverPageFromProxy(currentPage)
      : await fetchDiscoverPageDirect(apiKey, currentPage);
    madeNetworkRequest = true;

    if (Number.isFinite(reportedTotal) && reportedTotal > 0) {
      totalPages = reportedTotal;
    }

    const pageResults = Array.isArray(results) ? results : [];
    pageResults.forEach(movie => {
      if (!movie || movie.id == null) return;
      const idKey = String(movie.id);
      if (seen.has(idKey)) return;
      seen.add(idKey);
      if (!suppressedIds.has(idKey)) {
        collected.push(movie);
      }
    });

    prioritized = applyPriorityOrdering(collected);

    const feedMovies = applyFeedFilters(prioritized);
    if (feedMovies.length >= minFeedSize) {
      page = currentPage + 1;
      commitProgress({ exhausted: false });
      return prioritized;
    }

    if (!pageResults.length && (!Number.isFinite(totalPages) || currentPage >= totalPages)) {
      reachedEnd = true;
      page = currentPage + 1;
      break;
    }

    page = currentPage + 1;

    if (page > allowedPages && allowedPages < MAX_DISCOVER_PAGES_LIMIT) {
      allowedPages = Math.min(
        MAX_DISCOVER_PAGES_LIMIT,
        Math.max(allowedPages + INITIAL_DISCOVER_PAGES, page)
      );
    }
  }

  if (!reachedEnd && madeNetworkRequest && Number.isFinite(totalPages) && totalPages > 0 && page > totalPages) {
    reachedEnd = true;
  }

  commitProgress({});

  return prioritized.length ? prioritized : applyPriorityOrdering(collected);
}

async function fetchMovies({ usingProxy, apiKey, minFeedSize = MIN_FEED_RESULTS }) {
  const suppressedIds = new Set(
    Object.entries(currentPrefs)
      .filter(([, pref]) => pref && SUPPRESSED_STATUSES.has(pref.status))
      .map(([id]) => id)
  );

  const cacheResult = await tryFetchCachedMovies({ suppressedIds, minFeedSize });
  let movies = Array.isArray(cacheResult?.movies) ? cacheResult.movies : [];
  let usedTmdbFallback = false;

  if (!cacheResult || !cacheResult.satisfied) {
    try {
      movies = await fetchMoviesFromTmdb({
        usingProxy,
        apiKey,
        minFeedSize,
        suppressedIds,
        existingMovies: movies
      });
      usedTmdbFallback = true;
    } catch (err) {
      if (!movies.length) {
        throw err;
      }
      console.warn('TMDB fallback failed but cached TV shows are available', err);
      usedTmdbFallback = false;
    }
  }

  return {
    movies,
    genres: cacheResult?.genres || null,
    credits: cacheResult?.credits || null,
    usedTmdbFallback,
    fromCache: Boolean(cacheResult?.movies?.length)
  };
}

async function fetchGenreMapFromProxy() {
  try {
    const data = await callTmdbProxy('tv_genres', { language: 'en-US' });
    return Object.fromEntries((data.genres || []).map(g => [g.id, g.name]));
  } catch (_) {
    return {};
  }
}

async function loadMovies({ attemptStart } = {}) {
  const listEl = domRefs.list;
  if (!listEl) return;

  const proxyEndpoint = getTmdbProxyEndpoint();
  const usingProxy = Boolean(proxyEndpoint);

  const inputKey = domRefs.apiKeyInput?.value.trim();
  let apiKey = activeApiKey || inputKey;
  let usingTestFallback = false;

  if (!apiKey && typeof window !== 'undefined' && window.tmdbApiKey) {
    apiKey = window.tmdbApiKey;
  }

  // Allow automated tests to exercise the flow without a real TMDB key.
  const inVitest =
    typeof process !== 'undefined' &&
    process.env &&
    (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test');

  if (!apiKey && inVitest && !usingProxy) {
    apiKey = '__TEST_FALLBACK_API_KEY__';
    usingTestFallback = true;
  }

  if (!usingProxy && !apiKey) {
    listEl.innerHTML = '<em>TMDB API key not provided.</em>';
    updateFeedStatus('TMDB API key not provided. Enter a key or enable the proxy to load TV shows.', {
      tone: 'warning'
    });
    return;
  }

  if (!usingProxy && !activeApiKey) {
    if (usingTestFallback) {
      activeApiKey = apiKey;
    } else if (apiKey) {
      persistApiKey(apiKey);
    }
  }

  const attemptNumber = ++loadAttemptCounter;
  const startedLabel = formatTimestamp(
    Number.isFinite(attemptStart) ? attemptStart : Date.now()
  );
  const sourceLabel = usingProxy ? 'TMDB proxy service' : 'direct TMDB API';
  const attemptIntro = usingProxy
    ? 'Checking the TV show cache before reaching out to the TMDB proxy service with your saved preferences.'
    : 'Checking the TV show cache before contacting TMDB directly using your API key.';
  const fallbackNote = usingProxy
    ? ' If this route fails we will automatically switch to your TMDB API key.'
    : '';
  updateFeedStatus(
    `Loading TV shows (attempt ${attemptNumber})${
      startedLabel ? ` started at ${startedLabel}` : ''
    }. ${attemptIntro}${fallbackNote}`,
    { tone: 'info', showSpinner: true }
  );

  listEl.innerHTML = '<em>Loading...</em>';
  try {
    const {
      movies,
      genres: cachedGenreMap,
      credits: prefetchedCredits,
      usedTmdbFallback,
      fromCache
    } = await fetchMovies({ usingProxy, apiKey, minFeedSize: MIN_FEED_RESULTS });
    await enrichMoviesWithCredits(movies, {
      usingProxy,
      apiKey,
      prefetchedCredits
    });
    let genres = cachedGenreMap;
    const needsGenreFetch =
      !genres || !Object.keys(genres).length || usedTmdbFallback;
    if (needsGenreFetch) {
      genres = usingProxy ? await fetchGenreMapFromProxy() : await fetchGenreMapDirect(apiKey);
    }
    currentMovies = Array.isArray(movies) ? movies : [];
    genreMap = genres || {};
    populateFeedGenreOptions();
    updateFeedFilterInputsFromState();
    feedExhausted = !currentMovies.length;
    refreshUI();
    const availableCount = getFeedMovies(currentMovies).length;
    const completedLabel = formatTimestamp(Date.now());
    const finalSourceLabel = !usedTmdbFallback && fromCache
      ? 'the TV show cache'
      : `the ${sourceLabel}`;
    updateFeedStatus(
      `Loaded ${movies.length} TV show${movies.length === 1 ? '' : 's'} on attempt ${attemptNumber}${
        completedLabel ? ` at ${completedLabel}` : ''
      } using ${finalSourceLabel}. ${availableCount} ${
        availableCount === 1 ? 'match' : 'matches'
      } your current filters.`,
      { tone: availableCount ? 'success' : 'warning' }
    );
  } catch (err) {
    if (usingProxy) {
      console.warn('TMDB proxy unavailable, falling back to direct API', err);
      updateFeedStatus(
        `Attempt ${attemptNumber} using the TMDB proxy service failed (${summarizeProxyError(
          err
        )}). Switching to your direct TMDB API key.`,
        { tone: 'warning' }
      );
      disableTmdbProxy();
      if (!apiKey) {
        listEl.innerHTML =
          '<em>TMDB proxy is unavailable. Please enter your TMDB API key to continue.</em>';
        updateFeedStatus(
          'TMDB proxy is unavailable and no API key is configured. Enter a TMDB API key to continue.',
          { tone: 'error' }
        );
        return;
      }
      await loadMovies();
      return;
    }
    console.error('Failed to load TV shows', err);
    listEl.textContent = 'Failed to load TV shows.';
    updateFeedStatus(
      `Attempt ${attemptNumber} using the ${sourceLabel} failed (${summarizeError(
        err
      )}). No TV shows were loaded. Check your TMDB API key and try again.`,
      { tone: 'error' }
    );
  }
}

export async function initTvPanel() {
  domRefs.list = document.getElementById('tvList');
  if (!domRefs.list) return;

  await ensureTmdbCredentialsLoaded().catch(err => {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Unable to preload TMDB credentials for TV panel', err);
    }
  });

  domRefs.interestedList = document.getElementById('savedTvList');
  domRefs.interestedFilters = document.getElementById('savedTvFilters');
  domRefs.watchedList = document.getElementById('watchedTvList');
  domRefs.apiKeyInput = document.getElementById('tvApiKey');
  domRefs.apiKeyContainer = document.getElementById('tvApiKeyContainer');
  domRefs.tabs = document.getElementById('tvTabs');
  domRefs.streamSection = document.getElementById('tvStreamSection');
  domRefs.interestedSection = document.getElementById('savedTvSection');
  domRefs.watchedSection = document.getElementById('watchedTvSection');
  domRefs.watchedSort = document.getElementById('watchedTvSort');
  domRefs.feedControls = document.getElementById('tvFeedControls');
  domRefs.feedStatus = document.getElementById('tvStatus');
  domRefs.feedMinRating = document.getElementById('tvFilterMinRating');
  domRefs.feedMinVotes = document.getElementById('tvFilterMinVotes');
  domRefs.feedStartYear = document.getElementById('tvFilterStartYear');
  domRefs.feedEndYear = document.getElementById('tvFilterEndYear');
  domRefs.feedGenre = document.getElementById('tvFilterGenre');

  loadAttemptCounter = 0;

  currentPrefs = await loadPreferences();

  feedFilterState = loadFeedFilterStateFromStorage();
  updateFeedFilterInputsFromState();

  attachFeedFilterInput(domRefs.feedMinRating, 'minRating');
  attachFeedFilterInput(domRefs.feedMinVotes, 'minVotes');
  attachFeedFilterInput(domRefs.feedStartYear, 'startYear');
  attachFeedFilterInput(domRefs.feedEndYear, 'endYear');

  const storedKey =
    (typeof window !== 'undefined' && window.tmdbApiKey) ||
    (typeof localStorage !== 'undefined' && localStorage.getItem(TV_API_KEY_STORAGE)) ||
    (typeof localStorage !== 'undefined' &&
      localStorage.getItem(SHARED_API_KEY_STORAGE)) ||
    '';
  activeApiKey = storedKey || '';
  if (domRefs.apiKeyInput && storedKey) {
    domRefs.apiKeyInput.value = storedKey;
    if (domRefs.apiKeyContainer) domRefs.apiKeyContainer.style.display = 'none';
  }

  if (domRefs.apiKeyInput && !getTmdbProxyEndpoint()) {
    if (!handlers.handleKeydown) {
      handlers.handleKeydown = e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          persistApiKey(domRefs.apiKeyInput.value.trim());
          loadMovies();
        }
      };
    }
    if (!handlers.handleChange) {
      handlers.handleChange = () => {
        persistApiKey(domRefs.apiKeyInput.value.trim());
        loadMovies();
      };
    }
    domRefs.apiKeyInput.removeEventListener('keydown', handlers.handleKeydown);
    domRefs.apiKeyInput.removeEventListener('change', handlers.handleChange);
    domRefs.apiKeyInput.addEventListener('keydown', handlers.handleKeydown);
    domRefs.apiKeyInput.addEventListener('change', handlers.handleChange);
  }

  if (domRefs.apiKeyContainer && getTmdbProxyEndpoint()) {
    domRefs.apiKeyContainer.style.display = 'none';
  }

  if (domRefs.tabs) {
    domRefs.tabs.setAttribute('role', 'tablist');
    const buttons = Array.from(domRefs.tabs.querySelectorAll('.movie-tab'));
    buttons.forEach(btn => {
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
      if (btn._movieTabHandler) {
        btn.removeEventListener('click', btn._movieTabHandler);
      }
      const handler = () => {
        buttons.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        const target = btn.dataset.target;
        if (domRefs.streamSection) {
          domRefs.streamSection.style.display =
            target === 'tvStreamSection' ? '' : 'none';
        }
        if (domRefs.interestedSection) {
          domRefs.interestedSection.style.display =
            target === 'savedTvSection' ? '' : 'none';
          if (target === 'savedTvSection') renderInterestedList();
        }
        if (domRefs.watchedSection) {
          domRefs.watchedSection.style.display =
            target === 'watchedTvSection' ? '' : 'none';
          if (target === 'watchedTvSection') renderWatchedList();
        }
      };
      btn._movieTabHandler = handler;
      btn.addEventListener('click', handler);
    });
  }

  if (domRefs.watchedSort) {
    if (domRefs.watchedSort._moviesSortHandler) {
      domRefs.watchedSort.removeEventListener(
        'change',
        domRefs.watchedSort._moviesSortHandler
      );
    }
    const handler = () => {
      const value = domRefs.watchedSort?.value || 'recent';
      watchedSortMode = value;
      renderWatchedList();
    };
    domRefs.watchedSort._moviesSortHandler = handler;
    domRefs.watchedSort.addEventListener('change', handler);
    domRefs.watchedSort.value = watchedSortMode;
  }

  await loadMovies();
}

if (typeof window !== 'undefined') {
  window.initTvPanel = initTvPanel;
}
