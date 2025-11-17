import { auth, db } from './auth.js';
import { generateId } from './helpers.js';

function getSampleSessionId() {
  const key = 'sampleSessionId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = generateId();
    localStorage.setItem(key, id);
  }
  return id;
}

export async function loadDescriptions() {
  if (auth.currentUser) return {};
  try {
    const sessionId = getSampleSessionId();
    const snap = await db.collection('sample').doc(sessionId).get();
    return snap.data()?.descriptions || {};
  } catch {
    return {};
  }
}

export async function initDescriptions() {
  const panelIds = Array.from(document.querySelectorAll('.tab-button'))
    .map(btn => btn.dataset.target)
    .filter(Boolean);

  const saved = await loadDescriptions();

  const descElems = [];

  panelIds.forEach(id => {
    const panel = document.getElementById(id);
    if (!panel) return;

    const header = panel.querySelector('.panel-header');
    const container = header?.parentElement || panel;

    const topDesc = document.createElement('textarea');
    topDesc.className = 'tab-description top-description';
    topDesc.value = saved[id]?.top || '';
    topDesc.style.display = 'none';
    if (header) {
      header.insertAdjacentElement('afterend', topDesc);
    } else {
      container.prepend(topDesc);
    }
    topDesc.addEventListener('input', () => saveDescription(id, 'top', topDesc.value));
    descElems.push(topDesc);

    const bottomDesc = document.createElement('textarea');
    bottomDesc.className = 'tab-description bottom-description';
    bottomDesc.value = saved[id]?.bottom || '';
    bottomDesc.style.display = 'none';
    container.appendChild(bottomDesc);
    bottomDesc.addEventListener('input', () => saveDescription(id, 'bottom', bottomDesc.value));
    descElems.push(bottomDesc);
  });

  const updateVisibility = (user) => {
    const show = !user;
    descElems.forEach(el => {
      el.style.display = show ? '' : 'none';
    });
  };

  auth.onAuthStateChanged(updateVisibility);
  updateVisibility(auth.currentUser);
}

export async function saveDescription(panelId, position, text) {
  if (auth.currentUser) return;
  try {
    const sessionId = getSampleSessionId();
    await db
      .collection('sample')
      .doc(sessionId)
      .set({ descriptions: { [panelId]: { [position]: text } } }, { merge: true });
  } catch {}
}
