import { loadDecisions, generateId, saveDecisions, makeIconBtn } from './helpers.js';

async function editDecision(decId) {
  const card = document.querySelector(`.decision-card[data-dec-id="${decId}"]`);
  if (!card) return;

  const items = await loadDecisions();
  const idx = items.findIndex(d => d.id === decId);
  if (idx === -1) return;
  const dec = items[idx];

  const editBtn = card.querySelector('.edit-decision-btn');
  const editing = card.dataset.editing === 'true';

  if (!editing) {
    card.dataset.editing = 'true';
    if (editBtn) editBtn.textContent = '💾';

    const titleInput = document.createElement('input');
    titleInput.value = dec.text;
    titleInput.style.width = '100%';

    const consInput = document.createElement('textarea');
    consInput.value = dec.considerations || '';
    consInput.rows = 2;
    consInput.style.width = '100%';
    consInput.style.marginTop = '4px';

    card.querySelector('.decision-title')?.replaceWith(titleInput);
    const conDiv = card.querySelector('.decision-considerations');
    if (conDiv) {
      conDiv.replaceWith(consInput);
    } else {
      card.insertBefore(consInput, card.children[1] || null);
    }
  } else {
    card.dataset.editing = '';
    if (editBtn) editBtn.textContent = '✏️';

    const newText = card.querySelector('input')?.value.trim() || '';
    const newCons = card.querySelector('textarea')?.value.trim() || '';
    items[idx].text = newText;
    items[idx].considerations = newCons;
    await saveDecisions(items);
    initDecisionsPanel();
  }
}

async function deleteDecision(decId) {
  if (!confirm('Delete this decision and all sub-decisions?')) return;
  let items = await loadDecisions();
  const idsToRemove = new Set();
  const gather = id => {
    idsToRemove.add(id);
    items.forEach(it => {
      if (it.parentGoalId === id) gather(it.id);
    });
  };
  gather(decId);
  items = items.filter(it => !idsToRemove.has(it.id));
  await saveDecisions(items);
  initDecisionsPanel();
}

async function editOutcome(decId, index) {
  const li = document.querySelector(`li[data-dec-id="${decId}"][data-out-index="${index}"]`);
  if (!li) return;

  const items = await loadDecisions();
  const dec = items.find(d => d.id === decId);
  if (!dec || !dec.outcomes[index]) return;

  const editBtn = li.querySelector('.edit-outcome-btn');
  const editing = li.dataset.editing === 'true';

  if (!editing) {
    li.dataset.editing = 'true';
    if (editBtn) editBtn.textContent = '💾';

    const textInput = document.createElement('input');
    textInput.value = dec.outcomes[index].text;
    textInput.style.width = '100%';

    const stepsInput = document.createElement('input');
    stepsInput.value = (dec.outcomes[index].nextSteps || []).join(', ');
    stepsInput.style.width = '100%';
    stepsInput.style.marginTop = '4px';

    li.innerHTML = '';
    li.appendChild(textInput);
    li.appendChild(stepsInput);
    const btnRow = document.createElement('span');
    btnRow.className = 'button-row';
    btnRow.append(editBtn, makeIconBtn('❌', 'Cancel', () => initDecisionsPanel()));
    li.appendChild(btnRow);
  } else {
    li.dataset.editing = '';
    if (editBtn) editBtn.textContent = '✏️';

    const inputs = li.querySelectorAll('input');
    const newText = inputs[0]?.value.trim() || '';
    const newSteps = (inputs[1]?.value || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    dec.outcomes[index] = { text: newText, nextSteps: newSteps };
    await saveDecisions(items);
    initDecisionsPanel();
  }
}

async function deleteOutcome(decId, index) {
  if (!confirm('Delete this outcome?')) return;
  const items = await loadDecisions();
  const dec = items.find(d => d.id === decId);
  if (!dec) return;
  dec.outcomes.splice(index, 1);
  await saveDecisions(items);
  initDecisionsPanel();
}

export async function addDecision(parentId = null) {
  if (parentId === null) {
    parentId = prompt('Parent decision ID (optional):', '') || null;
    if (parentId) parentId = parentId.trim();
  }
  const text = prompt('Decision:');
  if (!text) return;
  const out = prompt('Outcomes (comma separated):', '') || '';
  const outcomeTexts = out.split(',').map(o => o.trim()).filter(Boolean);
  const cons = prompt('Considerations (optional):', '') || '';
  const outcomes = [];
  for (const oText of outcomeTexts) {
    const stepInput = prompt(`Next steps for "${oText}" (comma separated):`, '') || '';
    const steps = stepInput.split(',').map(s => s.trim()).filter(Boolean);
    outcomes.push({ text: oText, nextSteps: steps });
  }
  const items = await loadDecisions();
  const newDecision = {
    id: generateId(),
    type: 'goal',
    text: text.trim(),
    notes: '',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: parentId,
    hiddenUntil: null,
    deadline: '',
    scheduled: '',
    scheduledEnd: '',
    outcomes,
    considerations: cons.trim()
  };
  await saveDecisions([...items, newDecision]);
  initDecisionsPanel();
}

export async function initDecisionsPanel() {
  const panel = document.getElementById('decisionsPanel');
  if (!panel) return;

  const treeContainer = panel.querySelector('#decisionTree');
  treeContainer.innerHTML = '';

  const allItems = await loadDecisions();
  const items = allItems.filter(it => Array.isArray(it.outcomes));

  function buildTree(parentId) {
    const ul = document.createElement('ul');
    const children = items.filter(d => d.parentGoalId === parentId);
    children.forEach(dec => {
      const li = document.createElement('li');
      const card = document.createElement('div');
      card.className = 'decision-card';
      card.dataset.decId = dec.id;

      const btnRow = document.createElement('div');
      btnRow.className = 'button-row';
      const editBtn = makeIconBtn('✏️', 'Edit decision', () => editDecision(dec.id));
      editBtn.classList.add('edit-decision-btn');
      const delBtn = makeIconBtn('❌', 'Delete decision', () => deleteDecision(dec.id));
      btnRow.append(editBtn, delBtn);
      card.appendChild(btnRow);
      const title = document.createElement('div');
      title.className = 'decision-title';
      title.textContent = dec.text;
      card.appendChild(title);

      if (dec.considerations) {
        const conDiv = document.createElement('div');
        conDiv.className = 'decision-considerations';
        conDiv.textContent = dec.considerations;
        card.appendChild(conDiv);
      }

      if (dec.outcomes.length) {
        const outHeader = document.createElement('div');
        outHeader.className = 'decision-section';
        outHeader.textContent = 'Outcomes:';
        card.appendChild(outHeader);
        const ulOut = document.createElement('ul');
        dec.outcomes.forEach((o, idx) => {
          const liOut = document.createElement('li');
          liOut.dataset.decId = dec.id;
          liOut.dataset.outIndex = idx;
          const spanText = document.createElement('span');
          spanText.textContent = o.text;
          liOut.appendChild(spanText);

          const btns = document.createElement('span');
          btns.className = 'button-row';
          btns.style.marginLeft = '6px';
          const editOutBtn = makeIconBtn('✏️', 'Edit outcome', () => editOutcome(dec.id, idx));
          editOutBtn.classList.add('edit-outcome-btn');
          btns.append(
            editOutBtn,
            makeIconBtn('❌', 'Delete outcome', () => deleteOutcome(dec.id, idx))
          );
          liOut.appendChild(btns);

          if (Array.isArray(o.nextSteps) && o.nextSteps.length) {
            const stepsUl = document.createElement('ul');
            o.nextSteps.forEach(step => {
              const stepLi = document.createElement('li');
              stepLi.textContent = step;
              stepsUl.appendChild(stepLi);
            });
            liOut.appendChild(stepsUl);
          }
          ulOut.appendChild(liOut);
        });
        card.appendChild(ulOut);
      }

      li.appendChild(card);
      const childUl = buildTree(dec.id);
      if (childUl.children.length) li.appendChild(childUl);
      ul.appendChild(li);
    });
    return ul;
  }

  const tree = buildTree(null);
  treeContainer.appendChild(tree);
}

window.initDecisionsPanel = initDecisionsPanel;
window.addDecision = addDecision;
