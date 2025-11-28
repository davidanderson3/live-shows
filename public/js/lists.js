import {
  loadLists,
  saveLists,
  loadDecisions,
  saveDecisions,
  generateId,
  pickDate,
  makeIconBtn
} from './helpers.js';
import { appendGoalToDOM } from './goals.js';
import { auth } from './auth.js';

let listsArray = [];
// Track sort state for each list { [idx]: { colIdx:number, dir:1|-1 } }
const listSortStates = {};
const MAX_LIST_HEIGHT = 450; // px

auth.onAuthStateChanged(async () => {
  listsArray = await loadLists();
  initListsPanel();
});

// 1️⃣ One-time scaffold build

function addColumnInput() {
  const container = document.querySelector('#columnsContainer');

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.marginBottom = '0.5rem';

  const nameInp = document.createElement('input');
  nameInp.type = 'text';
  nameInp.placeholder = 'Column name';
  Object.assign(nameInp.style, { marginRight: '0.5rem', flex: '1' });
  row.append(nameInp);

  const widthInp = document.createElement('input');
  widthInp.type = 'number';
  widthInp.placeholder = 'Width';
  widthInp.value = 120;
  Object.assign(widthInp.style, { marginRight: '0.5rem', width: '4rem' });
  row.append(widthInp);

  const typeSel = document.createElement('select');
  ['text', 'number', 'date', 'checkbox', 'link', 'list'].forEach(type => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type;
    typeSel.append(opt);
  });
  Object.assign(typeSel.style, { marginRight: '0.5rem' });
  row.append(typeSel);

  const rem = document.createElement('button');
  rem.type = 'button';
  rem.textContent = '❌';
  Object.assign(rem.style, { background: 'none', border: 'none', cursor: 'pointer' });
  rem.addEventListener('click', () => row.remove());
  row.append(rem);

  container.append(row);
}

// 3️⃣ Debounce helper that returns a promise which resolves
// once the wrapped function has actually run. This allows
// callers to `await` persistence and be sure the save completed
// before continuing (important when the page might unload).
function debounce(fn, delay) {
  let timer;
  let pendingPromise = null;
  let resolvePending;
  let rejectPending;

  return (...args) => {
    clearTimeout(timer);

    if (!pendingPromise) {
      pendingPromise = new Promise((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
    }

    timer = setTimeout(async () => {
      try {
        const result = await fn(...args);
        resolvePending(result);
      } catch (err) {
        rejectPending(err);
      } finally {
        pendingPromise = null;
        resolvePending = null;
        rejectPending = null;
      }
    }, delay);

    return pendingPromise;
  };
}

function getSortValue(item, col, colIdx) {
  if (colIdx === 0) {
    return (item[col.name + '_label'] || item[col.name] || '').toString().toLowerCase();
  }
  const val = item[col.name];
  switch (col.type) {
    case 'number':
      return Number(val) || 0;
    case 'date':
      return new Date(val || 0).getTime();
    case 'checkbox':
      return val ? 1 : 0;
    default:
      return (val || '').toString().toLowerCase();
  }
}


/* 3️⃣  LISTS PANEL – only the top section changes */
async function initListsPanel() {
  if (document.querySelector('.tab-button.active')?.dataset.target !== 'listsPanel') {
    return;
  }
  const panel = document.getElementById('listsPanel');
  if (!panel) return;

  const content = panel.querySelector('.full-column');
  if (!content) return;

  // Preserve existing elements before we clear
  const header = content.querySelector('.panel-header');
  const topDesc = content.querySelector('.tab-description.top-description');
  const bottomDesc = content.querySelector('.tab-description.bottom-description');

  // Clear existing content but keep header & descriptions
  content.innerHTML = '';
  if (header) content.appendChild(header);
  if (topDesc) content.appendChild(topDesc);

  // ─── 2) Create static scaffolding ──────────────────────────
  const tabsContainer = document.createElement('div');
  tabsContainer.id = 'listTabs';
  tabsContainer.style.margin = '0.5rem 0';

  const listsContainer = document.createElement('div');
  listsContainer.id = 'listsContainer';

  const itemForm = document.createElement('div');
  itemForm.id = 'itemForm';
  itemForm.style.margin = '0.5rem 0';

  const listActions = document.createElement('div');
  listActions.id = 'listActions';
  listActions.style.margin = '0.5rem 0';

  const listWrapper = document.createElement('div');
  listWrapper.id = 'listWrapper';
  listWrapper.className = 'list-wrapper';

  const createForm = document.createElement('div');
  createForm.id = 'listForm';
  createForm.innerHTML = `
    <h3>Create New List</h3>
    <label for="listName">List Name:</label>
    <input type="text" id="listName" placeholder="My List" style="margin-left:.5rem">
    <div id="columnsContainer" style="margin:.5rem 0">
      <label>Columns:</label>
    </div>
    <button type="button" id="addColumnBtn">+ Column</button>
    <button type="button" id="createListBtn">Create List</button>
    <hr/>
  `;

  // ─── 3) Create the Add-Column button but don’t append yet ───
  const addColumnBtnForList = document.createElement('button');
  addColumnBtnForList.type = 'button';
  addColumnBtnForList.id = 'addColumnToListBtn';
  addColumnBtnForList.textContent = '+ Add Column';
  addColumnBtnForList.style.alignSelf = 'flex-end';
  addColumnBtnForList.style.margin = '0.5rem 0';

  // ─── 4) Append scaffolding (button will go just after listsContainer) ───
  listWrapper.append(
    listsContainer,
    addColumnBtnForList,
    itemForm,
    listActions
  );
  content.append(
    tabsContainer,
    listWrapper
  );

  const formsWrapper = document.getElementById('listsFormWrapper');
  if (formsWrapper) {
    formsWrapper.innerHTML = '';
    formsWrapper.append(createForm);
  } else {
    content.append(createForm);
  }

  function initHiddenSection() {
    let hidden = document.getElementById('hiddenLists');
    if (!hidden) {
      hidden = document.createElement('div');
      hidden.id = 'hiddenLists';
      hidden.innerHTML = `
        <h3 style="margin-top:32px" id="hiddenListsHeader">
          <span id="toggleHiddenLists" style="cursor:pointer">▶</span>
          <span id="hiddenListsLabel">Hidden Lists</span>
        </h3>
        <div id="hiddenListsContent" style="display:none"></div>
        <hr style="margin:40px 0;" />
      `;
      content.append(hidden);
      const toggle = hidden.querySelector('#toggleHiddenLists');
      const hiddenListsContent = hidden.querySelector('#hiddenListsContent');
      toggle.onclick = () => {
        const open = hiddenListsContent.style.display === 'block';
        toggle.textContent = open ? '▶' : '▼';
        hiddenListsContent.style.display = open ? 'none' : 'block';
      };
    }
    return hidden.querySelector('#hiddenListsContent');
  }

  const hiddenContent = initHiddenSection();
  if (bottomDesc) {
    // place bottom description before hidden lists section
    content.insertBefore(bottomDesc, hiddenContent.parentElement);
  }


  // ─── 5) Load data & wire persistence ─────────────────────────
  listsArray = await loadLists();
  const persist = debounce(() => saveLists(listsArray), 250);

  function isHidden(list) {
    const hideUntil = list.hiddenUntil ? Date.parse(list.hiddenUntil) || 0 : 0;
    return hideUntil && Date.now() < hideUntil;
  }

  function renderHiddenLists() {
    if (!hiddenContent) return;
    hiddenContent.innerHTML = '';
    const now = Date.now();
    let count = 0;
    listsArray.forEach((list, idx) => {
      const hideUntil = list.hiddenUntil ? Date.parse(list.hiddenUntil) || 0 : 0;
      if (hideUntil && now < hideUntil) {
        count++;
        const div = document.createElement('div');
        div.style.margin = '4px 0';
        div.textContent = `${list.name} (hidden until ${new Date(hideUntil).toLocaleString()})`;
        const unhide = document.createElement('button');
        unhide.type = 'button';
        unhide.textContent = 'Unhide';
        Object.assign(unhide.style, {
          marginLeft: '8px',
          marginTop: '0',
          cursor: 'pointer'
        });
        unhide.addEventListener('click', async () => {
          listsArray[idx].hiddenUntil = null;
          await persist();
          renderTabs();
          // Ensure a list is visible and selected after unhiding.
          // Display the list we just unhid so its table becomes active.
          const target = idx;
          if (!isHidden(listsArray[target])) {
            selectList(target);
          } else {
            const firstActive = listsArray.findIndex(l => !isHidden(l));
            if (firstActive !== -1) selectList(firstActive);
              else {
                listsContainer.innerHTML = '';
                itemForm.innerHTML = '';
                itemForm.style.border = '';
                itemForm.style.padding = '';
                itemForm.style.borderRadius = '';
                listActions.innerHTML = '';
              }
            }
          });
          div.appendChild(unhide);
          hiddenContent.appendChild(div);
      }
    });
    const label = document.getElementById('hiddenListsLabel');
    if (label) label.textContent = `Hidden Lists (${count})`;
  }

  // ─── 6) Helper: render the tab buttons ──────────────────────
  let dragTabEl = null;

  function renderTabs() {
    tabsContainer.innerHTML = '';
    listsArray.forEach((list, idx) => {
      if (isHidden(list)) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-tab';
      btn.draggable = true;
      btn.dataset.idx = idx;
      btn.textContent = list.name;
      btn.addEventListener('click', () => selectList(idx));

      btn.addEventListener('dragstart', e => {
        dragTabEl = btn;
        btn.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      btn.addEventListener('dragend', () => {
        btn.classList.remove('dragging');
        dragTabEl = null;
      });

      btn.addEventListener('dragover', e => {
        e.preventDefault();
        btn.classList.add('drag-over');
      });

      btn.addEventListener('dragleave', () => {
        btn.classList.remove('drag-over');
      });

      btn.addEventListener('drop', async e => {
        e.preventDefault();
        btn.classList.remove('drag-over');
        if (dragTabEl && dragTabEl !== btn) {
          const from = Number(dragTabEl.dataset.idx);
          const to   = Number(btn.dataset.idx);
          const [moved] = listsArray.splice(from, 1);
          listsArray.splice(to, 0, moved);
          await persist();
          renderTabs();
          selectList(to);
        }
      });

      tabsContainer.append(btn);
    });
    renderHiddenLists();
  }

  // ─── 7) Helper: when a tab is selected ──────────────────────
  let selectedListIndex = 0;
  function selectList(idx) {
    selectedListIndex = idx;
    Array.from(tabsContainer.children).forEach(b =>
      b.classList.toggle('active', Number(b.dataset.idx) === idx)
    );
    renderSelectedList();
    renderItemForm();
  }

  async function onCreateList() {
    // 1) Read and validate the list name
    const name = document.querySelector('#listName').value.trim();
    if (!name) {
      alert('List needs a name.');
      return;
    }

    // 2) Gather column definitions (name+type) from the create form
    const rows = Array.from(document.querySelectorAll('#columnsContainer > div'));
    const cols = rows.map(row => {
      const inputs = row.querySelectorAll('input');
      const nameInp = inputs[0];
      const widthInp = inputs[1];
      const typeSel = row.querySelector('select');
      return {
        name: nameInp.value.trim(),
        type: typeSel.value,
        width: parseInt(widthInp.value, 10) || undefined
      };
    }).filter(col => col.name);

    if (!cols.length) {
      alert('Add at least one column.');
      return;
    }

    // 3) Build the newList object before using it
    const newList = { name, columns: cols, items: [], hiddenUntil: null };

    // 4) Push, persist, re-render, and select the new tab
    listsArray.push(newList);
    await persist();
    renderTabs();
    selectList(listsArray.length - 1);
    const modal = document.getElementById('listsFormModal');
    if (modal) modal.style.display = 'none';
  }

  // Then immediately bind it (and column-input) in the same scope:
  document.getElementById('addColumnBtn')
    .addEventListener('click', addColumnInput);
  document.getElementById('createListBtn')
    .addEventListener('click', onCreateList);

  // 4️⃣ Finally, do the initial render
  renderTabs();
  const firstActiveInit = listsArray.findIndex(l => !isHidden(l));
  if (firstActiveInit !== -1) selectList(firstActiveInit);


  function renderSelectedList() {
    const list = listsArray[selectedListIndex] || { columns: [], items: [] };
    const { columns, items } = list;

    listsContainer.innerHTML = '';
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    // Map rows to any list elements they contain
    const ulsToCheck = new Map();

    // Header
    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    columns.forEach((col, colIdx) => {
      const th = document.createElement('th');
      th.textContent = col.name;
      th.style.border = '1px solid #ccc';
      th.style.padding = '8px';
      th.style.cursor = 'pointer';
      if (col.width) th.style.width = col.width + 'px';
      th.style.position = 'relative';

      const sortState = listSortStates[selectedListIndex];
      if (sortState && sortState.colIdx === colIdx) {
        th.textContent += sortState.dir === 1 ? ' \u25B2' : ' \u25BC';
      }

      th.addEventListener('click', async () => {
        const current = listSortStates[selectedListIndex] || {};
        const dir = current.colIdx === colIdx ? -current.dir : 1;
        listSortStates[selectedListIndex] = { colIdx, dir };

        const cmp = (a, b) => {
          const vA = getSortValue(a, col, colIdx);
          const vB = getSortValue(b, col, colIdx);
          if (vA > vB) return dir;
          if (vA < vB) return -dir;
          return 0;
        };

        listsArray[selectedListIndex].items.sort(cmp);
        await persist();
        renderSelectedList();
      });

      // ─── Resizer to adjust column width ────────────────────────
      const resizer = document.createElement('div');
      resizer.className = 'col-resizer';
      resizer.addEventListener('mousedown', e => {
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = th.offsetWidth;
        const onMouseMove = evt => {
          const newWidth = Math.max(40, startWidth + evt.clientX - startX);
          th.style.width = newWidth + 'px';
          Array.from(table.rows).forEach(row => {
            const cell = row.cells[colIdx];
            if (cell) cell.style.width = newWidth + 'px';
          });
        };
        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          col.width = parseInt(th.style.width, 10);
          persist();
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
      th.append(resizer);

      headerRow.append(th);
    });
    const actionsTh = document.createElement('th');
    actionsTh.textContent = 'Actions';
    actionsTh.style.border = '1px solid #ccc';
    actionsTh.style.padding = '8px';
    headerRow.append(actionsTh);

    // Body
    const tbody = document.createElement('tbody');
    const hiddenRows = [];
    items.forEach((item, rowIdx) => {
      const hideUntil = item.hiddenUntil ? Date.parse(item.hiddenUntil) || 0 : 0;
      if (hideUntil && Date.now() < hideUntil) {
        hiddenRows.push({ item, rowIdx });
        return;
      }
      const tr = tbody.insertRow();

      // Data cells
      columns.forEach((col, colIdx) => {
        const td = tr.insertCell();
        td.style.border = '1px solid #ccc';
        td.style.padding = '8px';
        td.dataset.label = col.name;
        if (col.width) td.style.width = col.width + 'px';

        if (colIdx === 0) {
          const url = item[col.name] || '';
          const label = item[col.name + '_label'] || item[col.name] || '';
          if (url) {
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.textContent = label;
            td.append(a);
          } else {
            td.textContent = label;
          }
        }
        else if (col.type === 'checkbox') {
          td.textContent = item[col.name] ? '✔️' : '';
        }
        else if (col.type === 'list') {
          const lines = (item[col.name] || '').split('\n').filter(l => l.trim());
          if (lines.length) {
            const ul = document.createElement('ul');
            lines.forEach(line => {
              const li = document.createElement('li');
              li.textContent = line;
              ul.append(li);
            });
            td.style.position = 'relative';
            td.append(ul);
            const arr = ulsToCheck.get(tr) || [];
            arr.push(ul);
            ulsToCheck.set(tr, arr);
          }
        }
        else {
          td.textContent = item[col.name] || '';
        }
      });

      // Actions cell
      const actionCell = tr.insertCell();
      actionCell.style.border = '1px solid #ccc';
      actionCell.style.padding = '8px';
      actionCell.dataset.label = 'Actions';
      actionCell.style.whiteSpace = 'nowrap';

      // Up button
      const upBtn = makeIconBtn('⬆️', 'Move up', async () => {
        if (rowIdx === 0) return; // already at top
        const itemsArr = listsArray[selectedListIndex].items;
        [itemsArr[rowIdx - 1], itemsArr[rowIdx]] = [itemsArr[rowIdx], itemsArr[rowIdx - 1]];
        await persist();
        renderSelectedList();
        selectList(selectedListIndex);
      });
      actionCell.append(upBtn);

      // Edit button
      const edit = document.createElement('button');
      edit.textContent = '✏️';
      edit.title = 'Edit';
      Object.assign(edit.style, { background: 'none', border: 'none', cursor: 'pointer' });
      edit.addEventListener('click', () => openRowEditor(rowIdx));
      actionCell.append(edit);

      // Delete button
      const del = document.createElement('button');
      del.textContent = '❌';
      del.title = 'Delete';
      Object.assign(del.style, { background: 'none', border: 'none', cursor: 'pointer' });
      del.addEventListener('click', async () => {
        if (!confirm('Delete this row?')) return;
        listsArray[selectedListIndex].items.splice(rowIdx, 1);
        await persist();
        renderSelectedList();
        selectList(selectedListIndex);
      });
      actionCell.append(del);

      // Add as goal button
      const goalBtn = document.createElement('button');
      goalBtn.textContent = '🎯';
      goalBtn.title = 'Add as goal';
      Object.assign(goalBtn.style, { background: 'none', border: 'none', cursor: 'pointer' });
      goalBtn.addEventListener('click', async () => {
        await addListItemGoal(rowIdx);
      });
      actionCell.append(goalBtn);

      const hideBtn = document.createElement('button');
      hideBtn.textContent = '🕒';
      hideBtn.title = 'Hide item';
      Object.assign(hideBtn.style, { background: 'none', border: 'none', cursor: 'pointer' });

      const menu = document.createElement('div');
      Object.assign(menu.style, {
        position: 'absolute',
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: '6px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
        padding: '6px 0',
        fontSize: '0.9em',
        display: 'none',
        zIndex: '9999',
        minWidth: '120px'
      });
      document.body.appendChild(menu);

      const options = [
        { label: '1 hour', value: 1 },
        { label: '2 hours', value: 2 },
        { label: '4 hours', value: 4 },
        { label: '6 hours', value: 6 },
        { label: '8 hours', value: 8 },
        { label: '10 hours', value: 10 },
        { label: '12 hours', value: 12 },
        { label: '14 hours', value: 14 },
        { label: '20 hours', value: 20 },
        { label: '1 day', value: 24 },
        { label: '2 days', value: 48 },
        { label: '3 days', value: 72 },
        { label: '4 days', value: 96 },
        { label: '1 week', value: 168 },
        { label: '2 weeks', value: 336 },
        { label: '1 month', value: 720 },
        { label: '2 months', value: 1440 },
        { label: '3 months', value: 2160 },
        { label: 'Pick date…', value: 'date' }
      ];
      options.forEach(opt => {
        const optBtn = document.createElement('button');
        optBtn.type = 'button';
        optBtn.textContent = opt.label;
        optBtn.classList.add('postpone-option');
        Object.assign(optBtn.style, {
          display: 'block',
          width: '100%',
          padding: '4px 12px',
          border: 'none',
          background: 'white',
          color: '#333',
          textAlign: 'left',
          cursor: 'pointer'
        });
        optBtn.addEventListener('click', async e => {
          e.stopPropagation();
          let hideUntil;
          if (opt.value === 'date') {
            const input = await pickDate('');
            if (!input) return;
            const dt = new Date(input);
            if (isNaN(dt)) return;
            hideUntil = dt.toISOString();
          } else {
            hideUntil = new Date(Date.now() + opt.value * 3600 * 1000).toISOString();
          }
          listsArray[selectedListIndex].items[rowIdx].hiddenUntil = hideUntil;
          await persist();
          menu.style.display = 'none';
          renderSelectedList();
        });
        menu.appendChild(optBtn);
      });

      hideBtn.addEventListener('click', e => {
        e.stopPropagation();
        const rect = hideBtn.getBoundingClientRect();
        menu.style.top = `${rect.bottom + window.scrollY}px`;
        menu.style.left = `${rect.left + window.scrollX}px`;
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
      });

      document.addEventListener('click', e => {
        if (!menu.contains(e.target) && e.target !== hideBtn) {
          menu.style.display = 'none';
        }
      });

      actionCell.append(hideBtn);
    });

    table.append(tbody);
    listsContainer.append(table);

    if (hiddenRows.length) {
      const hiddenDiv = document.createElement('div');
      hiddenDiv.innerHTML = `
        <h4 style="margin-top:16px" id="hiddenItemsHeader">
          <span id="toggleHiddenItems" style="cursor:pointer">▶</span>
          <span id="hiddenItemsLabel">Hidden Items (${hiddenRows.length})</span>
        </h4>
        <div id="hiddenItemsContent" style="display:none"></div>
      `;
      const toggle = hiddenDiv.querySelector('#toggleHiddenItems');
      const content = hiddenDiv.querySelector('#hiddenItemsContent');
      toggle.onclick = () => {
        const open = content.style.display === 'block';
        toggle.textContent = open ? '▶' : '▼';
        content.style.display = open ? 'none' : 'block';
      };
      hiddenRows.forEach(({ item, rowIdx }) => {
        const div = document.createElement('div');
        div.style.margin = '4px 0';
        const first = columns[0];
        const label = item[first.name + '_label'] || item[first.name] || '';
        const until = new Date(Date.parse(item.hiddenUntil)).toLocaleString();
        div.textContent = `${label} (hidden until ${until})`;
        const unhide = document.createElement('button');
        unhide.type = 'button';
        unhide.textContent = 'Unhide';
        Object.assign(unhide.style, {
          marginLeft: '8px',
          marginTop: '0',
          cursor: 'pointer'
        });
        unhide.addEventListener('click', () => unhideListItem(selectedListIndex, rowIdx));
        div.appendChild(unhide);
        content.appendChild(div);
      });
      listsContainer.append(hiddenDiv);
    }
    setTimeout(() => {
      ulsToCheck.forEach((uls, row) => {
        const needs = uls.some(ul => ul.scrollHeight > MAX_LIST_HEIGHT);
        if (!needs) return;

        uls.forEach(ul => {
          if (ul.scrollHeight > MAX_LIST_HEIGHT) {
            ul.style.maxHeight = `${MAX_LIST_HEIGHT}px`;
            ul.style.overflow = 'hidden';
          }
        });

        const resizer = document.createElement('div');
        resizer.className = 'list-resizer';
        resizer.addEventListener('mousedown', e => {
          e.preventDefault();
          const startY = e.clientY;
          const startHeight = parseInt(uls[0].style.maxHeight) || MAX_LIST_HEIGHT;
          const onMove = evt => {
            const newHeight = Math.max(40, startHeight + evt.clientY - startY);
            uls.forEach(ul => {
              ul.style.maxHeight = `${newHeight}px`;
            });
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
        row.style.position = 'relative';
        row.append(resizer);
      });
    }, 0);
  }



function openRowEditor(rowIdx) {
    const list = listsArray[selectedListIndex];
    const columns = list.columns;
    const values = list.items[rowIdx];

    let editor = document.getElementById('rowEditorForm');
    if (editor) editor.remove();

    editor = document.createElement('div');
    editor.id = 'rowEditorForm';
    Object.assign(editor.style, {
      position: 'fixed',
      top: '10%',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#fff',
      padding: '1rem',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      zIndex: '1000',
      maxHeight: '80%',
      overflowY: 'auto',
      minWidth: '320px'
    });
    editor.innerHTML = '<h3>Edit Row & Schema</h3>';

    const colsDiv = document.createElement('div');
    editor.append(colsDiv);

    function redraw() {
      colsDiv.innerHTML = '';
      columns.forEach((col, i) => {
        const row = document.createElement('div');
        row.className = 'editor-row';
        Object.assign(row.style, { display: 'flex', alignItems: 'center', marginBottom: '0.5rem' });

        // 1) column name
        const nameInp = document.createElement('input');
        nameInp.value = col.name;
        nameInp.style.flex = '1.2';
        row.append(nameInp);

        // 2) type selector
        const typeSel = document.createElement('select');
        ['text', 'number', 'date', 'checkbox', 'link', 'list'].forEach(t => {
          const opt = document.createElement('option');
          opt.value = t; opt.textContent = t;
          if (t === col.type) opt.selected = true;
          typeSel.append(opt);
        });
        Object.assign(typeSel.style, { flex: '0.8', margin: '0 0.5rem' });
        row.append(typeSel);

        const widthInp = document.createElement('input');
        widthInp.type = 'number';
        widthInp.value = col.width || 120;
        widthInp.placeholder = 'Width';
        Object.assign(widthInp.style, { width: '4rem', marginRight: '0.5rem' });
        row.append(widthInp);

        // 3) value inputs
        let urlInp, lblInp, valInp;
        if (i === 0) {
          // URL field
          urlInp = document.createElement('input');
          urlInp.type = 'url';
          urlInp.value = values[col.name] || '';
          urlInp.placeholder = 'URL';
          Object.assign(urlInp.style, { flex: '1.5', marginRight: '0.5rem' });
          row.append(urlInp);

          // Label field
          lblInp = document.createElement('input');
          lblInp.type = 'text';
          lblInp.value = values[col.name + '_label'] || '';
          lblInp.placeholder = 'Link text';
          lblInp.style.flex = '1.5';
          row.append(lblInp);
        }
        else if (col.type === 'list') {
          valInp = document.createElement('textarea');
          valInp.rows = 5;
          valInp.value = values[col.name] || '';
          valInp.placeholder = 'One item per line';
          Object.assign(valInp.style, { flex: '3', width: '100%' });
          row.append(valInp);
        }
        else if (col.type === 'checkbox') {
          valInp = document.createElement('input');
          valInp.type = 'checkbox';
          valInp.checked = !!values[col.name];
          valInp.style.flex = '3';
          row.append(valInp);
        }
        else {
          valInp = document.createElement('input');
          valInp.type = col.type === 'link' ? 'url' : col.type;
          valInp.value = values[col.name] || '';
          valInp.placeholder = 'Value';
          valInp.style.flex = '3';
          row.append(valInp);
        }

        // 4) remove column
        const rem = document.createElement('button');
        rem.textContent = '❌';
        rem.style.marginLeft = '0.5rem';
        rem.addEventListener('click', () => {
          if (!confirm(`Remove column "${col.name}"?`)) return;
          columns.splice(i, 1);
          delete values[col.name];
          delete values[col.name + '_label'];
          redraw();
        });
        row.append(rem);

        // 5) wire updates
        nameInp.addEventListener('blur', () => {
          const nm = nameInp.value.trim();
          if (nm && nm !== col.name) {
            values[nm] = values[col.name];
            values[nm + '_label'] = values[col.name + '_label'];
            delete values[col.name];
            delete values[col.name + '_label'];
            col.name = nm;
            redraw();
          }
        });
        typeSel.addEventListener('change', () => col.type = typeSel.value);
        widthInp.addEventListener('blur', () => {
          const w = parseInt(widthInp.value, 10);
          col.width = isNaN(w) ? undefined : w;
        });
        if (urlInp) urlInp.addEventListener('blur', () => { values[col.name] = urlInp.value.trim(); });
        if (lblInp) lblInp.addEventListener('blur', () => { values[col.name + '_label'] = lblInp.value.trim(); });
        if (valInp) {
          if (col.type === 'checkbox') {
            valInp.addEventListener('change', () => { values[col.name] = valInp.checked; });
          } else {
            valInp.addEventListener('blur', () => { values[col.name] = valInp.value.trim(); });
          }
        }

        colsDiv.append(row);
      });
    }

    // add‐column
    const addColBtn = document.createElement('button');
    addColBtn.textContent = '+ Add Column';
    Object.assign(addColBtn.style, { display: 'block', margin: '0.5rem 0 0.5rem auto' });
    addColBtn.addEventListener('click', () => {
      const nm = prompt('New column name:');
      if (!nm) return;
      const width = parseInt(prompt('Column width in pixels?', '120') || '120', 10);
      columns.push({ name: nm.trim(), type: 'text', width: isNaN(width) ? undefined : width });
      values[nm.trim()] = '';
      redraw();
    });
    editor.append(addColBtn);

    // save & cancel
    const btns = document.createElement('div');
    btns.style.textAlign = 'right';

    const save = document.createElement('button');
    save.textContent = 'Save';
    save.style.marginRight = '0.5rem';
    save.addEventListener('click', async () => {
      await persist();
      renderTabs();
      renderSelectedList();
      renderItemForm();
      editor.remove();
    });

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => editor.remove());

    btns.append(cancel, save);
    editor.append(btns);

    document.body.append(editor);
    redraw();
  }

  async function addListItemGoal(rowIdx) {
    const list = listsArray[selectedListIndex];
    if (!list || !list.columns.length) return;
    const item = list.items[rowIdx];
    if (!item) return;
    const first = list.columns[0];
    const text = (item[first.name + '_label'] || item[first.name] || '').trim();
    if (!text) return;

    const all = await loadDecisions();
    const newGoal = {
      id: generateId(),
      type: 'goal',
      text,
      notes: '',
      completed: false,
      resolution: '',
      dateCompleted: '',
      parentGoalId: null,
      hiddenUntil: null,
      deadline: '',
      scheduled: '',
      scheduledEnd: ''
    };

    const updated = [...all, newGoal];
    await saveDecisions(updated);
    appendGoalToDOM(newGoal, updated);
  }

  async function unhideListItem(listIdx, rowIdx) {
    listsArray[listIdx].items[rowIdx].hiddenUntil = null;
    await persist();
    renderSelectedList();
  }


  // ─── 9) Helper: render the “Add Item” form ────────────────
  // File: js/lists.js

  function renderItemForm() {
    const list = listsArray[selectedListIndex] || { name: '', columns: [] };

    itemForm.innerHTML = `
    <h4 style="margin:0 0 .5rem;">Add to “${list.name}”</h4>
    <div id="itemInputs" style="display:flex;gap:.5rem;flex-wrap:wrap"></div>
  `;
    Object.assign(itemForm.style, {
      border: '1px solid #88c',
      padding: '.5rem',
      borderRadius: '4px'
    });
    listActions.innerHTML = '';
    const inputsContainer = itemForm.querySelector('#itemInputs');

    list.columns.forEach((col, colIdx) => {
      if (colIdx === 0) {
        const urlInp = document.createElement('input');
        urlInp.type = 'url';
        urlInp.name = col.name;
        urlInp.placeholder = `${col.name} URL (optional)`;
        Object.assign(urlInp.style, {
          flex: '1 1 auto', minWidth: '6rem', padding: '.25rem', fontSize: '.9rem'
        });
        inputsContainer.append(urlInp);

        const lblInp = document.createElement('input');
        lblInp.type = 'text';
        lblInp.name = `${col.name}_label`;
        lblInp.placeholder = `${col.name} text`;
        Object.assign(lblInp.style, {
          flex: '1 1 auto', minWidth: '6rem', padding: '.25rem', fontSize: '.9rem'
        });
        inputsContainer.append(lblInp);
      } else if (col.type === 'list') {
        const txt = document.createElement('textarea');
        txt.name = col.name;
        txt.rows = 2;
        txt.placeholder = col.name;
        Object.assign(txt.style, {
          flex: '1 1 100%', padding: '.25rem', fontSize: '.9rem'
        });
        inputsContainer.append(txt);
      } else {
        const inp = document.createElement('input');
        inp.type = col.type === 'link' ? 'url' : col.type;
        inp.name = col.name;
        if (col.type !== 'checkbox') inp.placeholder = col.name;
        Object.assign(inp.style, {
          flex: '1 1 auto', minWidth: '6rem', padding: '.25rem', fontSize: '.9rem'
        });
        inputsContainer.append(inp);
      }
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-item-btn';
    addBtn.innerHTML = '<span class="plus-icon">+</span> Add';
    Object.assign(addBtn.style, {
      padding: '.25rem .75rem', fontSize: '.9rem', cursor: 'pointer', marginTop: '.5rem'
    });
    addBtn.addEventListener('click', async () => {
      const newItem = { hiddenUntil: null };
      inputsContainer.querySelectorAll('input,textarea').forEach(i => {
        newItem[i.name] = i.type === 'checkbox' ? i.checked : i.value.trim();
        if (i.type === 'checkbox') i.checked = false; else i.value = '';
      });
      listsArray[selectedListIndex].items.push(newItem);
      await persist();
      renderSelectedList();
    });
    itemForm.append(addBtn);

    const hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.textContent = '🕒 Hide List';
    Object.assign(hideBtn.style, {
      display: 'block',
      marginTop: '0.5rem',
      background: 'none',
      border: '1px solid #88c',
      color: '#88c',
      cursor: 'pointer',
      padding: '.25rem .75rem'
    });
    listActions.append(hideBtn);

    const menu = document.createElement('div');
    Object.assign(menu.style, {
      position: 'absolute',
      background: '#fff',
      border: '1px solid #ccc',
      borderRadius: '6px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
      padding: '6px 0',
      fontSize: '0.9em',
      display: 'none',
      zIndex: '9999',
      minWidth: '120px'
    });
    document.body.appendChild(menu);

    const options = [
      { label: '1 hour', value: 1 },
      { label: '2 hours', value: 2 },
      { label: '4 hours', value: 4 },
      { label: '6 hours', value: 6 },
      { label: '8 hours', value: 8 },
      { label: '10 hours', value: 10 },
      { label: '12 hours', value: 12 },
      { label: '14 hours', value: 14 },
      { label: '20 hours', value: 20 },
      { label: '1 day', value: 24 },
      { label: '2 days', value: 48 },
      { label: '3 days', value: 72 },
      { label: '4 days', value: 96 },
      { label: '1 week', value: 168 },
      { label: '2 weeks', value: 336 },
      { label: '1 month', value: 720 },
      { label: '2 months', value: 1440 },
      { label: '3 months', value: 2160 },
      { label: 'Pick date…', value: 'date' }
    ];

    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt.label;
      btn.classList.add('postpone-option');
      Object.assign(btn.style, {
        display: 'block',
        width: '100%',
        padding: '4px 12px',
        border: 'none',
        background: 'white',
        color: '#333',
        textAlign: 'left',
        cursor: 'pointer'
      });
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        let hideUntil;
        if (opt.value === 'date') {
          const input = await pickDate('');
          if (!input) return;
          const dt = new Date(input);
          if (isNaN(dt)) return;
          hideUntil = dt.toISOString();
        } else {
          hideUntil = new Date(Date.now() + opt.value * 3600 * 1000).toISOString();
        }
        listsArray[selectedListIndex].hiddenUntil = hideUntil;
        await persist();
        menu.style.display = 'none';
        renderTabs();
        const firstActive = listsArray.findIndex(l => !isHidden(l));
        if (firstActive !== -1) selectList(firstActive);
          else {
            listsContainer.innerHTML = '';
            itemForm.innerHTML = '';
            itemForm.style.border = '';
            itemForm.style.padding = '';
            itemForm.style.borderRadius = '';
            listActions.innerHTML = '';
          }
        });
        menu.appendChild(btn);
      });

    hideBtn.addEventListener('click', e => {
      e.stopPropagation();
      const rect = hideBtn.getBoundingClientRect();
      menu.style.top = `${rect.bottom + window.scrollY}px`;
      menu.style.left = `${rect.left + window.scrollX}px`;
      menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    });

    document.addEventListener('click', e => {
      if (!menu.contains(e.target) && e.target !== hideBtn) {
        menu.style.display = 'none';
      }
    });

    const deleteListBtn = document.createElement('button');
    deleteListBtn.type = 'button';
    deleteListBtn.textContent = 'Delete This List';
    Object.assign(deleteListBtn.style, {
      display: 'block',
      marginTop: '0.5rem',
      background: 'none',
      border: '1px solid #f00',
      color: '#f00',
      cursor: 'pointer',
      padding: '.25rem .75rem'
    });
    deleteListBtn.addEventListener('click', async () => {
      if (!confirm(`Delete the entire list “${list.name}”? This cannot be undone.`)) return;
      listsArray.splice(selectedListIndex, 1);
      await persist();
      renderTabs();
      if (listsArray.length) {
        selectedListIndex = Math.max(0, selectedListIndex - 1);
        selectList(selectedListIndex);
        } else {
          listsContainer.innerHTML = '';
          itemForm.innerHTML = '';
          itemForm.style.border = '';
          itemForm.style.padding = '';
          itemForm.style.borderRadius = '';
          listActions.innerHTML = '';
        }
      });
      listActions.append(deleteListBtn);
    }


  // ───10) Hook up the Add-Column button ─────────────────────
  addColumnBtnForList.addEventListener('click', async () => {
    const colName = (prompt('Enter new column name:') || '').trim();
    if (!colName) return;
    const colType = (prompt('Enter column type (text,number,date,checkbox,link,list):', 'text') || '')
      .trim().toLowerCase();
    const width = parseInt(prompt('Column width in pixels?', '120') || '120', 10);
    if (!['text', 'number', 'date', 'checkbox', 'link', 'list'].includes(colType)) {
      return alert('Invalid column type.');
    }
    const list = listsArray[selectedListIndex];
    if (list.columns.find(c => c.name === colName)) {
      return alert('Column exists.');
    }
    list.columns.push({ name: colName, type: colType, width: isNaN(width) ? undefined : width });
    list.items.forEach(i => i[colName] = colType === 'checkbox' ? false : '');
    await persist();
    renderSelectedList();
    renderItemForm();
  });

  // ───11) Initial render ────────────────────────────────────
  renderTabs();
  const firstActiveIdx = listsArray.findIndex(l => !isHidden(l));
  if (firstActiveIdx !== -1) {
    selectList(firstActiveIdx);
    addColumnBtnForList.style.display = 'block';
  } else {
    addColumnBtnForList.style.display = 'none';
    const toggle = document.getElementById('toggleHiddenLists');
    const content = document.getElementById('hiddenListsContent');
    if (toggle && content) {
      toggle.textContent = '▼';
      content.style.display = 'block';
    }
  }

  // Hide button already placed in header
}


window.initListsPanel = initListsPanel;

function openListsFormModal() {
  const modal = document.getElementById('listsFormModal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.querySelector('input,textarea')?.focus();
  function close(e) {
    if (e.target === modal) {
      modal.style.display = 'none';
      modal.removeEventListener('click', close);
    }
  }
  modal.addEventListener('click', close);
}

window.openListsFormModal = openListsFormModal;
