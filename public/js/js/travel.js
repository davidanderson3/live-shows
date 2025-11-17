import { db, getCurrentUser, auth } from './auth.js';
import { getRandomPlaces } from './samplePlaces.js';
import {
  pickDate,
  loadDecisions,
  saveDecisions,
  generateId,
  linkify
} from './helpers.js';
import { appendGoalToDOM } from './goals.js';

const BASE_KEY = 'travelData';

function storageKeyForUser(uid) {
  return uid ? `${BASE_KEY}-${uid}` : BASE_KEY;
}

function storageKey() {
  const user = getCurrentUser?.();
  return storageKeyForUser(user?.uid);
}

let lastUserId = null;

auth.onAuthStateChanged(user => {
  mapInitialized = false;
  travelData = [];
  if (lastUserId && lastUserId !== user?.uid) {
    localStorage.removeItem(storageKeyForUser(lastUserId));
  }
  lastUserId = user ? user.uid : null;
  if (!user) {
    localStorage.removeItem(BASE_KEY);
  }
  // Reload travel data for the newly authenticated user.
  // initTravelPanel safely exits if DOM is not ready or already initialized.
  initTravelPanel().catch(err =>
    console.error('Failed to reload travel data after auth change', err)
  );
});

let mapInitialized = false;
let map;
let markers = [];
let travelData = [];
let currentSearch = '';
let rowMarkerMap = new Map();
let markerRowMap = new Map();
let selectedRow = null;
let allTags = [];
let selectedTags = [];
let resultMarkers = [];
let sortByDistance = true;
let userCoords = null;
let showVisited = true;
const pageSize = Infinity;
let currentPage = 0;

function resizeTravelMap() {
  const mapEl = document.getElementById('travelMap');
  const tagFiltersEl = document.getElementById('travelTagFilters');
  if (!mapEl) return;
  const rect = mapEl.getBoundingClientRect();
  const availableHeight = window.innerHeight - rect.top - 16;
  const height = Math.min(rect.width, availableHeight);
  mapEl.style.height = `${height}px`;
  if (tagFiltersEl) {
    tagFiltersEl.style.height = `${height}px`;
  }
  if (map) {
    map.invalidateSize();
  }
}

window.addEventListener('resize', resizeTravelMap);

// Simple circle markers for map points. Visited places are green.
const createSvgUrl = color =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="2" fill="${color}"/></svg>`
  )}`;

const defaultIcon = L.icon({
  iconUrl: createSvgUrl('#DB4436'),
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12],
});

const visitedIcon = L.icon({
  iconUrl: createSvgUrl('#62AF44'),
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12],
});

// Search results use a distinct blue marker
const resultIcon = L.icon({
  iconUrl: createSvgUrl('#4285F4'),
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12],
});

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function ensureDefaultTag(place) {
  if (!Array.isArray(place.tags) || place.tags.length === 0) {
    place.tags = ['no tag'];
  }
}

function applyVisitedFlag(place) {
  if (typeof place.visited === 'undefined') {
    place.visited = /icon-503-62AF44/.test(place.styleUrl || '');
  }
}

export async function initTravelPanel() {
  const panel = document.getElementById('travelPanel');
  if (!panel) return;
  if (mapInitialized) {
    // panel is being re-shown; resize the map to fill its container
    resizeTravelMap();
    return;
  }
  mapInitialized = true;

  const mapEl = document.getElementById('travelMap');
  const tableBody = document.querySelector('#travelTable tbody');
  const searchInput = document.getElementById('travelSearch');
  const placeInput = document.getElementById('placeSearch');
  const resultsList = document.getElementById('placeResults');
  const clearResultsBtn = document.getElementById('clearPlaceSearch');
  const searchPlaceBtn = document.getElementById('placeSearchBtn');
  const tagFiltersDiv = document.getElementById('travelTagFilters');
  const placeCountEl = document.getElementById('placeCount');
  const paginationDiv = document.getElementById('paginationControls');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const pageInfoSpan = document.getElementById('pageInfo');
  const showVisitedToggle = document.getElementById('showVisitedToggle');
  const addPlaceModal = document.getElementById('addPlaceModal');
  const addPlaceForm = document.getElementById('addPlaceForm');
  const placeTagsDiv = document.getElementById('placeTags');
  const extraTagsInput = document.getElementById('extraTags');
  const placeCancelBtn = document.getElementById('placeCancel');
  map = L.map(mapEl, {
    maxBounds: [
      [-90, -180],
      [90, 180]
    ],
    maxBoundsViscosity: 1.0,
    worldCopyJump: false,
    doubleClickZoom: false
  }).setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    noWrap: true
  }).addTo(map);
  resizeTravelMap();

  async function openAddPlaceForm(lat, lon) {
    if (!addPlaceModal || !addPlaceForm || !placeTagsDiv) {
      const name = prompt('Place name:');
      if (!name) return;
      const description = prompt('Description:');
      const tagsStr = prompt('Tags (comma separated):');
      const rating = prompt('Rating:');
      const date = await pickDate('');
      const visited = confirm('Visited?');
      await storePlace({
        name,
        description: description || '',
        lat,
        lon,
        tags: tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [],
        Rating: rating || '',
        Date: date || '',
        visited
      });
      return;
    }

    addPlaceForm.reset();
    if (extraTagsInput) extraTagsInput.value = '';
    placeTagsDiv.innerHTML = '';
    allTags.forEach(tag => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = tag;
      label.append(cb, document.createTextNode(tag));
      placeTagsDiv.append(label);
    });
    addPlaceModal.style.display = 'flex';

    const submitHandler = async e => {
      e.preventDefault();
      const name = addPlaceForm.querySelector('#placeName').value.trim();
      if (!name) return;
      const description = addPlaceForm
        .querySelector('#placeDescription')
        .value.trim();
      const rating = addPlaceForm.querySelector('#placeRating').value.trim();
      const date = addPlaceForm.querySelector('#placeDate').value.trim();
      const visited = addPlaceForm.querySelector('#placeVisited').checked;
      const tags = Array.from(
        placeTagsDiv.querySelectorAll('input[type="checkbox"]:checked')
      ).map(cb => cb.value);
      if (extraTagsInput && extraTagsInput.value.trim()) {
        tags.push(
          ...extraTagsInput.value
            .split(',')
            .map(t => t.trim())
            .filter(Boolean)
        );
      }
      addPlaceModal.style.display = 'none';
      addPlaceForm.removeEventListener('submit', submitHandler);
      await storePlace({
        name,
        description,
        lat,
        lon,
        tags,
        Rating: rating,
        Date: date,
        visited
      });
    };

    addPlaceForm.addEventListener('submit', submitHandler);
    const cancelHandler = () => {
      addPlaceModal.style.display = 'none';
      addPlaceForm.removeEventListener('submit', submitHandler);
    };
    placeCancelBtn?.addEventListener('click', cancelHandler, { once: true });
  }

  map.on('dblclick', e => openAddPlaceForm(e.latlng.lat, e.latlng.lng));

  let initialRemoteLoadComplete = false;
  let pendingAdds = [];
  let pendingUpdates = [];
  let pendingDeletes = [];

  const user = getCurrentUser?.();
  const cached = user ? localStorage.getItem(storageKey()) : null;
  travelData = cached ? JSON.parse(cached) : user ? [] : getRandomPlaces();
  travelData.forEach(p => {
    ensureDefaultTag(p);
    applyVisitedFlag(p);
  });

  allTags = Array.from(new Set(travelData.flatMap(p => p.tags || []))).sort();

  const renderTagFilters = () => {
    if (!tagFiltersDiv) return;
    tagFiltersDiv.innerHTML = '';
    allTags.forEach(tag => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = tag;
      btn.className = 'tag-filter-button';
      if (selectedTags.includes(tag)) btn.classList.add('active');
      btn.addEventListener('click', () => {
        if (selectedTags.includes(tag)) {
          selectedTags = selectedTags.filter(t => t !== tag);
        } else {
          selectedTags.push(tag);
        }
        currentPage = 0;
        renderTagFilters();
        renderList(currentSearch);
      });
      tagFiltersDiv.append(btn);
    });
  };

  renderTagFilters();

  function updatePagination(total) {
    if (!paginationDiv) return;
    const totalPages = Math.ceil(total / pageSize) || 1;
    pageInfoSpan.textContent = `${currentPage + 1} / ${totalPages}`;
    prevPageBtn.disabled = currentPage === 0;
    nextPageBtn.disabled = currentPage >= totalPages - 1;
  }

  prevPageBtn?.addEventListener('click', () => {
    if (currentPage > 0) {
      currentPage -= 1;
      renderList(currentSearch);
    }
  });

  nextPageBtn?.addEventListener('click', () => {
    currentPage += 1;
    renderList(currentSearch);
  });

  if (showVisitedToggle) {
    showVisitedToggle.checked = showVisited;
    showVisitedToggle.addEventListener('change', () => {
      showVisited = showVisitedToggle.checked;
      currentPage = 0;
      renderList(currentSearch);
    });
  }

  const renderList = (term = '', customItems = null) => {
    tableBody.innerHTML = '';
    if (customItems) currentPage = 0;
    markers.forEach(m => m.remove());
    markers = [];
    rowMarkerMap.clear();
    markerRowMap.clear();
    let items;
    if (Array.isArray(customItems)) {
      items = customItems;
    } else {
      items = travelData.filter(
        p =>
          p.name.toLowerCase().includes(term.toLowerCase()) &&
          (selectedTags.length === 0 ||
            (Array.isArray(p.tags) && selectedTags.some(t => p.tags.includes(t)))) &&
          (showVisited || !p.visited)
      );
    }

    if (sortByDistance && userCoords) {
      items.sort(
        (a, b) =>
          haversine(userCoords[0], userCoords[1], a.lat, a.lon) -
          haversine(userCoords[0], userCoords[1], b.lat, b.lon)
      );
    }
    const total = items.length;
    let start;
    let pageItems;
    if (pageSize === Infinity) {
      start = 0;
      pageItems = items;
      if (paginationDiv) paginationDiv.style.display = 'none';
    } else {
      start = currentPage * pageSize;
      pageItems = items.slice(start, start + pageSize);
      if (paginationDiv) paginationDiv.style.display = '';
      updatePagination(total);
    }
    if (placeCountEl) {
      const end =
        pageSize === Infinity ? total : Math.min(start + pageItems.length, total);
      placeCountEl.textContent =
        total === 0 ? 'Showing 0 of 0' : `Showing ${start + 1}-${end} of ${total}`;
    }

    pageItems.forEach((p, index) => {
      const icon =
        p.visited || /icon-503-62AF44/.test(p.styleUrl)
          ? visitedIcon
          : defaultIcon;
      const m = L.marker([p.lat, p.lon], { icon }).addTo(map).bindPopup(p.name);
      markers.push(m);
      Object.defineProperty(p, 'marker', {
        value: m,
        enumerable: false,
        configurable: true,
        writable: true,
      });
      m.on('click', () => {
        const row = markerRowMap.get(m);
        if (row) {
          if (selectedRow) selectedRow.classList.remove('selected-row');
          selectedRow = row;
          row.classList.add('selected-row');
        }
      });
      if (term && items.length === 1 && index === 0) {
        map.setView([p.lat, p.lon], 8);
        m.openPopup();
      }
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      const nameLink = document.createElement('a');
      nameLink.href = `https://www.google.com/search?q=${encodeURIComponent(p.name)}`;
      nameLink.textContent = p.name;
      nameLink.target = '_blank';
      nameTd.appendChild(nameLink);
      nameTd.dataset.label = 'Name';
      const descTd = document.createElement('td');
      descTd.innerHTML = linkify(p.description || '');
      descTd.dataset.label = 'Description';
      const tagsTd = document.createElement('td');
      tagsTd.textContent = Array.isArray(p.tags) ? p.tags.join(', ') : '';
      tagsTd.dataset.label = 'Tags';
      const ratingTd = document.createElement('td');
      ratingTd.textContent = p.Rating || '';
      ratingTd.dataset.label = 'Rating';
      const dateTd = document.createElement('td');
      dateTd.textContent = p.Date || '';
      dateTd.dataset.label = 'Date';
      const visitedTd = document.createElement('td');
      visitedTd.textContent = p.visited ? '✅' : '';
      visitedTd.dataset.label = 'Visited';
      if (p.visited) visitedTd.classList.add('visited-icon');
      const distTd = document.createElement('td');
      distTd.dataset.label = 'Distance (mi)';
      if (userCoords) {
        const dist = haversine(userCoords[0], userCoords[1], p.lat, p.lon);
        distTd.textContent = dist.toFixed(1);
      } else {
        distTd.textContent = '';
      }
      const actionsTd = document.createElement('td');
      actionsTd.dataset.label = 'Actions';
      actionsTd.style.whiteSpace = 'nowrap';

      const editBtn = document.createElement('button');
      editBtn.textContent = '✏️';
      editBtn.title = 'Edit';
      Object.assign(editBtn.style, { background: 'none', border: 'none', cursor: 'pointer' });
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        tr.innerHTML = '';
        const form = document.createElement('form');
        form.style.display = 'flex';
        form.style.flexWrap = 'wrap';
        form.style.gap = '4px';
        const td = document.createElement('td');
        td.colSpan = 8;
        td.className = 'edit-cell';

        const nameInput = document.createElement('input');
        nameInput.value = p.name || '';
        nameInput.placeholder = 'name';
        const descInput = document.createElement('input');
        descInput.value = p.description || '';
        descInput.placeholder = 'description';
        const tagsInput = document.createElement('input');
        tagsInput.value = Array.isArray(p.tags) ? p.tags.join(', ') : '';
        tagsInput.placeholder = 'tags';
        const tagList = document.createElement('datalist');
        const listId = `tag-list-${Date.now()}-${Math.random()}`;
        tagList.id = listId;
        tagsInput.setAttribute('list', listId);
        const updateTagSuggestions = () => {
          const val = tagsInput.value;
          const parts = val.split(',');
          const partial = parts.pop().trim().toLowerCase();
          const prefix = parts.map(t => t.trim()).filter(Boolean).join(', ');
          const used = parts.map(t => t.trim()).filter(Boolean);
          tagList.innerHTML = '';
          allTags
            .filter(t =>
              t.toLowerCase().startsWith(partial) && !used.includes(t)
            )
            .forEach(t => {
              const option = document.createElement('option');
              option.value = prefix ? `${prefix}, ${t}` : t;
              tagList.appendChild(option);
            });
        };
        tagsInput.addEventListener('input', updateTagSuggestions);
        updateTagSuggestions();
        const ratingInput = document.createElement('input');
        ratingInput.value = p.Rating || '';
        ratingInput.placeholder = 'rating';
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.value = p.Date || '';
        const visitedInput = document.createElement('input');
        visitedInput.type = 'checkbox';
        visitedInput.checked = !!p.visited;
        visitedInput.title = 'Visited';
        const visitedLabel = document.createElement('label');
        visitedLabel.style.whiteSpace = 'nowrap';
        visitedLabel.append(visitedInput, ' Visited');

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        [saveBtn, cancelBtn].forEach(b =>
          Object.assign(b.style, {
            background: 'none',
            border: '1px solid #999',
            padding: '2px 6px',
            marginTop: '0'
          })
        );

        visitedLabel.style.display = 'flex';
        visitedLabel.style.alignItems = 'center';

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '4px';
        btnRow.append(saveBtn, cancelBtn);

        form.append(
          nameInput,
          descInput,
          tagsInput,
          tagList,
          ratingInput,
          dateInput,
          visitedLabel,
          btnRow
        );
        td.append(form);
        tr.append(td);

        form.addEventListener('submit', async ev => {
          ev.preventDefault();
          p.name = nameInput.value.trim();
          p.description = descInput.value.trim();
          p.tags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
          ensureDefaultTag(p);
          p.Rating = ratingInput.value.trim();
          p.Date = dateInput.value.trim();
          p.visited = visitedInput.checked;
          const user = getCurrentUser?.();
          if (user) {
            localStorage.setItem(storageKey(), JSON.stringify(travelData));
            if (p.id) {
              if (initialRemoteLoadComplete) {
                try {
                  await db
                    .collection('users')
                    .doc(user.uid)
                    .collection('travel')
                    .doc(p.id)
                    .set(p, { merge: true });
                } catch (err) {
                  console.error('Failed to update place', err);
                }
              } else {
                pendingUpdates.push({ id: p.id, data: JSON.parse(JSON.stringify(p)) });
              }
            }
          }
          allTags = Array.from(new Set(travelData.flatMap(pl => pl.tags || []))).sort();
          renderTagFilters();
          renderList(currentSearch);
        });
        cancelBtn.addEventListener('click', e2 => {
          e2.preventDefault();
          renderList(currentSearch);
        });
      });
      actionsTd.append(editBtn);

      const goalBtn = document.createElement('button');
      goalBtn.textContent = '🎯';
      goalBtn.title = 'Add as goal';
      Object.assign(goalBtn.style, { background: 'none', border: 'none', cursor: 'pointer' });
      goalBtn.addEventListener('click', async e => {
        e.stopPropagation();
        await addPlaceAsGoal(p);
      });
      actionsTd.append(goalBtn);

      const delBtn = document.createElement('button');
      delBtn.textContent = '❌';
      delBtn.title = 'Delete';
      Object.assign(delBtn.style, { background: 'none', border: 'none', cursor: 'pointer' });
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Delete this place?')) return;
        await deletePlace(p);
      });
      actionsTd.append(delBtn);

      tr.append(
        nameTd,
        descTd,
        tagsTd,
        ratingTd,
        dateTd,
        visitedTd,
        distTd,
        actionsTd
      );
      tableBody.append(tr);
      rowMarkerMap.set(tr, m);
      markerRowMap.set(m, tr);

      tr.addEventListener('click', e => {
        // If the user clicked a link inside the row, allow the link to
        // navigate without selecting the row or moving the map.
        if (e.target.closest('a')) return;

        if (selectedRow) selectedRow.classList.remove('selected-row');
        selectedRow = tr;
        tr.classList.add('selected-row');
        map.setView([p.lat, p.lon], 8);
        m.openPopup();
        // mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Don't auto-scroll to the map when selecting a place
      });
    });
  };

  const renderDefaultList = () => {
    currentPage = 0;
    renderList('');
  };
    
    async function loadTripAdvisorPlaces() {
      const listEl = document.getElementById('tripAdvisorList');
      if (!listEl) return;

      const getStoredKey = () => {
        try {
          return localStorage.getItem('tripAdvisorApiKey') || '';
        } catch (err) {
          console.warn('Unable to read stored TripAdvisor key', err);
          return '';
        }
      };

      const setStoredKey = key => {
        if (!key) return;
        try {
          localStorage.setItem('tripAdvisorApiKey', key);
        } catch (err) {
          console.warn('Unable to persist TripAdvisor key', err);
        }
      };

      const apiKey = window.tripAdvisorApiKey || getStoredKey();
      if (!apiKey) {
        listEl.innerHTML = '';
        const li = document.createElement('li');
        li.innerHTML =
          'Add your RapidAPI key to fetch nearby attractions. Open the console and run <code>localStorage.setItem(\'tripAdvisorApiKey\', \'YOUR_KEY\')</code>, or set <code>window.tripAdvisorApiKey</code> before loading the page.';
        listEl.appendChild(li);
        return;
      }

      if (!window.tripAdvisorApiKey) {
        window.tripAdvisorApiKey = apiKey;
        setStoredKey(apiKey);
      }

      const [lat, lon] = userCoords || [0, 0];
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        limit: '5',
        currency: 'USD'
      });

      try {
        const res = await fetch(
          `https://travel-advisor.p.rapidapi.com/attractions/list-by-latlng?${params.toString()}`,
          {
            headers: {
              'X-RapidAPI-Key': apiKey,
              'X-RapidAPI-Host': 'travel-advisor.p.rapidapi.com'
            }
          }
        );

        if (!res.ok) {
          const message =
            res.status === 401
              ? 'TripAdvisor API key is missing or invalid. Verify the key in RapidAPI.'
              : `TripAdvisor request failed (${res.status}).`;
          console.error('TripAdvisor fetch failed', res.status, res.statusText);
          listEl.textContent = message;
          return;
        }

        const data = await res.json();
        const places = data.data || data.results || [];
        listEl.innerHTML = '';
        places.forEach(pl => {
          const name = pl.name || pl.title || pl.location_string || 'Unknown';
          const lat = parseFloat(pl.latitude || pl.lat || pl.coordinates?.latitude || 0);
          const lon = parseFloat(pl.longitude || pl.lon || pl.coordinates?.longitude || 0);
          const li = document.createElement('li');
          li.textContent = name;
          const btn = document.createElement('button');
          btn.textContent = 'Add';
          btn.addEventListener('click', async () => {
            await storePlace({
              name,
              description: pl.description || '',
              lat,
              lon,
              tags: [],
              Rating: '',
              Date: '',
              visited: false
            });
          });
          li.appendChild(btn);
          listEl.appendChild(li);
        });
      } catch (err) {
        console.error('TripAdvisor fetch failed', err);
        listEl.textContent = 'Failed to load places. Check your network connection and API key.';
      }
    }

    const clearSearchResults = () => {
      if (resultsList) resultsList.innerHTML = '';
      resultMarkers.forEach(m => m.remove());
      resultMarkers = [];
    };
    clearResultsBtn?.addEventListener('click', () => {
      if (placeInput) placeInput.value = '';
      clearSearchResults();
    });

    async function flushPendingOperations() {
    const user = getCurrentUser?.();
    if (!initialRemoteLoadComplete || !user) return;
    for (const place of pendingAdds) {
      try {
        const docRef = await db
          .collection('users')
          .doc(user.uid)
          .collection('travel')
          .add(place);
        place.id = docRef.id;
      } catch (err) {
        console.error('Failed to save place to Firestore', err);
      }
    }
    pendingAdds = [];
    for (const { id, data } of pendingUpdates) {
      try {
        await db
          .collection('users')
          .doc(user.uid)
          .collection('travel')
          .doc(id)
          .set(data, { merge: true });
      } catch (err) {
        console.error('Failed to update place', err);
      }
    }
    pendingUpdates = [];
    for (const id of pendingDeletes) {
      try {
        await db
          .collection('users')
          .doc(user.uid)
          .collection('travel')
          .doc(id)
          .delete();
      } catch (err) {
        console.error('Failed to delete place', err);
      }
    }
    pendingDeletes = [];
  }

  async function storePlace(place) {
    ensureDefaultTag(place);
    applyVisitedFlag(place);
    const user = getCurrentUser?.();
    travelData.push(place);
    if (user) {
      localStorage.setItem(storageKey(), JSON.stringify(travelData));
      if (initialRemoteLoadComplete) {
        try {
          const docRef = await db
            .collection('users')
            .doc(user.uid)
            .collection('travel')
            .add(place);
          place.id = docRef.id;
        } catch (err) {
          console.error('Failed to save place to Firestore', err);
        }
      } else {
        pendingAdds.push(place);
      }
    }
    allTags = Array.from(new Set(travelData.flatMap(p => p.tags || []))).sort();
    renderTagFilters();
    renderList(currentSearch);
  }

  async function deletePlace(p) {
    const user = getCurrentUser?.();
    if (user && p.id) {
      if (initialRemoteLoadComplete) {
        try {
          await db
            .collection('users')
            .doc(user.uid)
            .collection('travel')
            .doc(p.id)
            .delete();
        } catch (err) {
          console.error('Failed to delete place', err);
        }
      } else {
        pendingDeletes.push(p.id);
      }
    }
    travelData.splice(travelData.indexOf(p), 1);
    if (user) {
      localStorage.setItem(storageKey(), JSON.stringify(travelData));
    }
    allTags = Array.from(new Set(travelData.flatMap(pl => pl.tags || []))).sort();
    renderTagFilters();
    renderList(currentSearch);
  }

  async function addPlaceAsGoal(place) {
    const all = await loadDecisions();
    const newGoal = {
      id: generateId(),
      type: 'goal',
      text: `Visit ${place.name}`,
      notes: place.description || '',
      completed: false,
      resolution: '',
      dateCompleted: '',
      parentGoalId: null,
      hiddenUntil: null,
      deadline: '',
      scheduled: place.Date || '',
      scheduledEnd: ''
    };
    await saveDecisions([...all, newGoal]);
    appendGoalToDOM(newGoal, [...all, newGoal]);
  }


  if (searchInput) {
    searchInput.addEventListener('input', e => {
      currentSearch = e.target.value;
      currentPage = 0;
      renderList(currentSearch);
    });
  }

  if (user) {
    db
      .collection('users')
      .doc(user.uid)
      .collection('travel')
      .onSnapshot(
        { includeMetadataChanges: true },
        snap => {
          const fromServer = !snap.metadata.fromCache;
          const data = snap.docs.map(doc => {
            const d = { id: doc.id, ...doc.data() };
            ensureDefaultTag(d);
            applyVisitedFlag(d);
            return d;
          });
          if (fromServer || travelData.length === 0) {
            travelData = data;
            localStorage.setItem(storageKey(), JSON.stringify(travelData));
            allTags = Array.from(
              new Set(travelData.flatMap(p => p.tags || []))
            ).sort();
            renderTagFilters();
            renderList(currentSearch);
          }
          if (fromServer && !initialRemoteLoadComplete) {
            initialRemoteLoadComplete = true;
            flushPendingOperations();
          }
        },
        err => {
          console.error('Failed to sync travel data', err);
        }
      );
  } else {
    initialRemoteLoadComplete = true;
  }


  const renderInitial = () => {
    renderDefaultList();
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        userCoords = [pos.coords.latitude, pos.coords.longitude];
        renderInitial();
        loadTripAdvisorPlaces();
      },
      () => {
        // location retrieval failed; still render list without userCoords
        renderInitial();
        loadTripAdvisorPlaces();
      }
    );
  } else {
    renderInitial();
    loadTripAdvisorPlaces();
  }

  const dmsToDecimal = (deg, min, sec, dir) => {
    const dec = Number(deg) + Number(min) / 60 + Number(sec) / 3600;
    return /[SW]/i.test(dir) ? -dec : dec;
  };
  const ddmToDecimal = (deg, min, dir) => {
    const dec = Number(deg) + Number(min) / 60;
    return /[SW]/i.test(dir) ? -dec : dec;
  };
  const parseCoordinates = input => {
    const ddMatch = input.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (ddMatch) {
      return { lat: parseFloat(ddMatch[1]), lon: parseFloat(ddMatch[2]) };
    }
    const dmsMatch = input.match(/^[\s]*?(\d{1,3})[°\s]\s*(\d{1,2})['\s]\s*(\d{1,2}(?:\.\d+)?)["\s]?\s*([NS])[,\s]+(\d{1,3})[°\s]\s*(\d{1,2})['\s]\s*(\d{1,2}(?:\.\d+)?)["\s]?\s*([EW])\s*$/i);
    if (dmsMatch) {
      const lat = dmsToDecimal(dmsMatch[1], dmsMatch[2], dmsMatch[3], dmsMatch[4]);
      const lon = dmsToDecimal(dmsMatch[5], dmsMatch[6], dmsMatch[7], dmsMatch[8]);
      return { lat, lon };
    }
    const ddmMatch = input.match(/^\s*(\d{1,3})[°\s]\s*(\d{1,2}(?:\.\d+)?)[']?\s*([NS])[,\s]+(\d{1,3})[°\s]\s*(\d{1,2}(?:\.\d+)?)[']?\s*([EW])\s*$/i);
    if (ddmMatch) {
      const lat = ddmToDecimal(ddmMatch[1], ddmMatch[2], ddmMatch[3]);
      const lon = ddmToDecimal(ddmMatch[4], ddmMatch[5], ddmMatch[6]);
      return { lat, lon };
    }
    return null;
  };

  const searchForPlace = async () => {
    if (!placeInput) return;
    const term = placeInput.value.trim();
    if (!term) return;
    clearSearchResults();
    const existingMatches = travelData.filter(p =>
      p.name.toLowerCase().includes(term.toLowerCase())
    );
    existingMatches.forEach(p => {
      const li = document.createElement('li');
      li.textContent = p.name;
      li.classList.add('existing-place');
      li.addEventListener('click', () => {
        map.setView([p.lat, p.lon], 8);
        p.marker?.openPopup();
      });
      resultsList?.append(li);
    });
    const coords = parseCoordinates(term);
    if (coords) {
      const { lat, lon } = coords;
      const m = L.marker([lat, lon], { icon: resultIcon }).addTo(map);
      resultMarkers.push(m);
      const popupDiv = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      const btn = document.createElement('button');
      btn.textContent = 'Add to list';
      popupDiv.append(title, btn);
      m.bindPopup(popupDiv);
      btn.addEventListener('click', async () => {
        const name = prompt('Place name:', '');
        if (!name) return;
        await storePlace({ name, description: '', lat, lon, tags: [], Rating: '', Date: '', visited: false });
        clearSearchResults();
        placeInput.value = '';
      });
      const li = document.createElement('li');
      li.textContent = title.textContent;
      li.classList.add('search-result');
      li.addEventListener('click', () => {
        map.setView([lat, lon], 8);
        m.openPopup();
      });
      if (resultsList) resultsList.append(li);
      map.setView([lat, lon], 8);
      return;
    }
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(term)}`);
      const data = await resp.json();
      if (data && data.length) {
        const latLngs = [];
        data.forEach(res => {
          const { lat, lon, display_name } = res;
          const latitude = parseFloat(lat);
          const longitude = parseFloat(lon);
          latLngs.push([latitude, longitude]);
          const m = L.marker([latitude, longitude], { icon: resultIcon }).addTo(map);
          resultMarkers.push(m);
          const popupDiv = document.createElement('div');
          const title = document.createElement('div');
          title.textContent = display_name;
          const btn = document.createElement('button');
          btn.textContent = 'Add to list';
          popupDiv.append(title, btn);
          m.bindPopup(popupDiv);
          btn.addEventListener('click', async () => {
            const name = prompt('Place name:', display_name.split(',')[0]);
            if (!name) return;
            await storePlace({ name, description: '', lat: latitude, lon: longitude, tags: [], Rating: '', Date: '', visited: false });
            clearSearchResults();
            placeInput.value = '';
          });

          const li = document.createElement('li');
          li.textContent = display_name;
          li.classList.add('search-result');
          li.addEventListener('click', () => {
            map.setView([latitude, longitude], 8);
            m.openPopup();
          });
          if (resultsList) resultsList.append(li);
        });
        if (latLngs.length === 1) {
          map.setView(latLngs[0], 8);
        } else {
          map.fitBounds(latLngs);
        }
      } else {
        alert('Place not found');
      }
    } catch (err) {
      console.error('Error searching place', err);
    }
  };

  placeInput?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    searchForPlace();
  });

  searchPlaceBtn?.addEventListener('click', e => {
    e.preventDefault();
    searchForPlace();
  });

  const addBtn = document.getElementById('addPlaceBtn');
  addBtn?.addEventListener('click', async () => {
    const name = prompt('Place name:');
    const description = prompt('Description:');
    const tags = prompt('Tags (comma separated):');
    const rating = prompt('Rating:');
    const date = await pickDate('');
    const visited = confirm('Visited?');
    const lat = parseFloat(prompt('Latitude:'));
    const lon = parseFloat(prompt('Longitude:'));
    if (!name || Number.isNaN(lat) || Number.isNaN(lon)) return;
    const place = {
      name,
      description: description || '',
      lat,
      lon,
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      Rating: rating || '',
      Date: date || '',
      visited
    };
    await storePlace(place);
  });

}

window.initTravelPanel = initTravelPanel;
