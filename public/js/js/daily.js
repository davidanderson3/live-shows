import { loadDecisions, saveDecisions, generateId, makeIconBtn, linkify } from './helpers.js';
import { db, currentUser } from './auth.js';

// Shared skip intervals (same as goals)
const skipOptions = [
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
  { label: '3 months', value: 2160 }
];

function tempToColor(temp) {
  const min = 20;
  const max = 100;
  const t = Math.max(min, Math.min(max, temp));
  const ratio = (t - min) / (max - min);
  const hue = 240 - ratio * 240;
  return `hsl(${hue}, 90%, 85%)`;
}

export async function quickAddTask(recurs, text, timeOfDay) {
  if (!['daily', 'weekly', 'monthly'].includes(recurs)) {
    throw new Error('Invalid recurrence');
  }
  if (recurs === 'daily' && !timeOfDay) {
    throw new Error('Daily tasks require a section');
  }
  const newTask = {
    id: generateId(),
    type: 'task',
    text: `${text}`,
    notes: '',
    recurs,
    ...(recurs === 'daily' ? { timeOfDay } : {}),
    parentGoalId: null,
    completed: false,
    dateCompleted: '',
    resolution: '',
    dependencies: [],
    hiddenUntil: null,
    skipUntil: null
  };
  const updated = [...await loadDecisions(), newTask];
  await saveDecisions(updated);
  const active = document.querySelector('.tab-button.active')?.dataset.target;
  if (active === 'dailyPanel') {
    await renderDailyTasks(currentUser, db);
  }
}

const COMPLETION_KEY = 'taskCompletions';

async function renderDailyTasksImpl(currentUser, db) {
  const panel = document.getElementById('dailyPanel');
  if (!panel) return;

  // — ensure our container exists
  let container = panel.querySelector('#dailyTasksList');
  if (!container) {
    container = document.createElement('div');
    container.id = 'dailyTasksList';
    container.className = 'decision-container';
    panel.appendChild(container);
  }
  // — ensure firstThing/morning/afternoon/evening/endOfDay containers exist
  let firstThingContainer = container.querySelector('#firstThingTasksList');
  if (!firstThingContainer) {
    firstThingContainer = document.createElement('div');
    firstThingContainer.id = 'firstThingTasksList';
    firstThingContainer.className = 'decision-container';
    const hdr = document.createElement('h3');
    hdr.textContent = 'First Thing';
    container.appendChild(hdr);
    container.appendChild(firstThingContainer);
  }
  let morningContainer = container.querySelector('#morningTasksList');
  if (!morningContainer) {
    const divider = document.createElement('hr');
    divider.style.margin = '5px 0';
    container.appendChild(divider);
    morningContainer = document.createElement('div');
    morningContainer.id = 'morningTasksList';
    morningContainer.className = 'decision-container';
    const hdr = document.createElement('h3');
    hdr.textContent = 'Morning';
    container.appendChild(hdr);
    container.appendChild(morningContainer);
  }
  let afternoonContainer = container.querySelector('#afternoonTasksList');
  if (!afternoonContainer) {
    const divider = document.createElement('hr');
    divider.style.margin = '5px 0';
    container.appendChild(divider);
    afternoonContainer = document.createElement('div');
    afternoonContainer.id = 'afternoonTasksList';
    afternoonContainer.className = 'decision-container';
    const hdr = document.createElement('h3');
    hdr.textContent = 'Afternoon';
    container.appendChild(hdr);
    container.appendChild(afternoonContainer);
  }
  let eveningContainer = container.querySelector('#eveningTasksList');
  if (!eveningContainer) {
    const divider = document.createElement('hr');
    divider.style.margin = '5px 0';
    container.appendChild(divider);
    eveningContainer = document.createElement('div');
    eveningContainer.id = 'eveningTasksList';
    eveningContainer.className = 'decision-container';
    const hdr = document.createElement('h3');
    hdr.textContent = 'Evening';
    container.appendChild(hdr);
    container.appendChild(eveningContainer);
  }
  let endOfDayContainer = container.querySelector('#endOfDayTasksList');
  if (!endOfDayContainer) {
    const divider = document.createElement('hr');
    divider.style.margin = '5px 0';
    container.appendChild(divider);
    endOfDayContainer = document.createElement('div');
    endOfDayContainer.id = 'endOfDayTasksList';
    endOfDayContainer.className = 'decision-container';
    const hdr = document.createElement('h3');
    hdr.textContent = 'End of Day';
    container.appendChild(hdr);
    container.appendChild(endOfDayContainer);
  }
  // — ensure our weekly container exists
  const wrapper = container.parentElement || panel;
  let weeklyContainer = panel.querySelector('#weeklyTasksList');
  if (!weeklyContainer) {
    weeklyContainer = document.createElement('div');
    weeklyContainer.id = 'weeklyTasksList';
    weeklyContainer.className = 'decision-container';
    wrapper.appendChild(weeklyContainer);
  }
  // — ensure our monthly container exists
  let monthlyContainer = panel.querySelector('#monthlyTasksList');
  if (!monthlyContainer) {
    monthlyContainer = document.createElement('div');
    monthlyContainer.id = 'monthlyTasksList';
    monthlyContainer.className = 'decision-container';
    wrapper.appendChild(monthlyContainer);
  }
  let hiddenContainer = panel.querySelector('#hiddenTasksList');
  if (!hiddenContainer) {
    const details = document.createElement('details');
    details.id = 'hiddenTasksSection';
    const summary = document.createElement('summary');
    summary.textContent = 'Hidden Tasks';
    details.appendChild(summary);
    hiddenContainer = document.createElement('div');
    hiddenContainer.id = 'hiddenTasksList';
    hiddenContainer.className = 'decision-container';
    details.appendChild(hiddenContainer);
    wrapper.appendChild(details);
  }
  let completedContainer = panel.querySelector('#completedTasksList');
  if (!completedContainer) {
    const details = document.createElement('details');
    details.id = 'completedTasksSection';
    const summary = document.createElement('summary');
    summary.textContent = 'Completed Tasks';
    details.appendChild(summary);
    completedContainer = document.createElement('div');
    completedContainer.id = 'completedTasksList';
    completedContainer.className = 'decision-container';
    details.appendChild(completedContainer);
    wrapper.appendChild(details);
  }
  // — Inject CSS once to remove green focus/active backgrounds on buttons
  if (!document.getElementById('dailyTasks-btn-reset-css')) {
    const style = document.createElement('style');
    style.id = 'dailyTasks-btn-reset-css';
    style.textContent = `
      .daily-task-wrapper button:focus,
      .daily-task-wrapper button:active {
        background: none !important;
        outline: none !important;
      }
      @keyframes flash {
        0%   { background-color: #ffff99; }
        100% { background-color: transparent; }
      }
      .flash {
        animation: flash 1s ease-out;
      }
    `;
    document.head.appendChild(style);
  }

  // — Clear and load all tasks
  firstThingContainer.innerHTML = '';
  morningContainer.innerHTML = '';
  afternoonContainer.innerHTML = '';
  eveningContainer.innerHTML = '';
  endOfDayContainer.innerHTML = '';
  weeklyContainer.innerHTML = '';
  monthlyContainer.innerHTML = '';
  hiddenContainer.innerHTML = '';
  completedContainer.innerHTML = '';

  const loaded = await loadDecisions();
  // De-duplicate tasks by ID to prevent rendering duplicates
  const seenIds = new Set();
  const all = loaded.filter(item => {
    if (!item?.id || seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  });
  if (all.length !== loaded.length) {
    try { await saveDecisions(all); } catch (err) { console.error(err); }
  }

  // — Migrate legacy prefixes and set defaults
  let migrated = false;
  for (const t of all) {
    if (t.type === 'task') {
      if (t.text.startsWith('[Daily]')) {
        t.recurs = t.recurs || 'daily';
        t.text = t.text.replace(/^\[Daily\]\s*/, '');
        migrated = true;
      }
      const match = t.text.match(/^\[(Morning|Afternoon|Evening|First Thing|End of Day|Before Bed)\]\s*/i);
      if (match) {
        const map = {
          'morning': 'morning',
          'afternoon': 'afternoon',
          'evening': 'evening',
          'first thing': 'firstThing',
          'end of day': 'endOfDay',
          'before bed': 'endOfDay'
        };
        t.timeOfDay = map[match[1].toLowerCase()];
        t.text = t.text.replace(match[0], '').trim();
        migrated = true;
      }
      if (t.timeOfDay === 'beforeBed') {
        t.timeOfDay = 'endOfDay';
        migrated = true;
      }
      if (t.recurs === 'daily' && !t.timeOfDay) {
        t.timeOfDay = 'morning';
        migrated = true;
      }
    }
  }
  if (migrated) {
    try { await saveDecisions(all); }
    catch (err) { console.error(err); alert('⚠️ Failed to migrate old tasks.'); }
  }

  // ——— No add form for recurring tasks

  // — Load today’s completions
  // — Compute keys and completion sets
  const todayKey = new Date().toLocaleDateString('en-CA');
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const weekKey = monday.toISOString().split('T')[0];
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthKey = monthStart.toISOString().split('T')[0];
  let completionMap = {};
  if (currentUser) {
    const snap = await db.collection('taskCompletions').doc(currentUser.uid).get();
    completionMap = snap.exists ? snap.data() : {};
  } else {
    completionMap = JSON.parse(localStorage.getItem(COMPLETION_KEY) || '{}');
  }
  const dailyDone = new Set(completionMap[todayKey] || []);
  const weeklyDone = new Set(completionMap[weekKey] || []);
  const monthlyDone = new Set(completionMap[monthKey] || []);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = yesterday.toLocaleDateString('en-CA');
  const yesterdayDone = new Set(completionMap[yesterdayKey] || []);

  // ——— No weekly or monthly add forms

  // Track completions for each recurrence period
  const doneDaily = new Set(completionMap[todayKey] || []);
  const doneWeekly = new Set(completionMap[weekKey] || []);
  const doneMonthly = new Set(completionMap[monthKey] || []);

  // — Prepare and split lists
  const nowMs = Date.now();
  const dailyAll = all.filter(t => t.type === 'task' && t.recurs === 'daily');
  const dailyHidden = dailyAll.filter(t => {
    const hideUntil = t.hiddenUntil || t.skipUntil;
    return hideUntil && nowMs < new Date(hideUntil).getTime() && !doneDaily.has(t.id);
  });
  const dailyVisible = dailyAll.filter(t => {
    const hideUntil = t.hiddenUntil || t.skipUntil;
    return !hideUntil || nowMs >= new Date(hideUntil).getTime();
  });
  const activeList = dailyVisible.filter(t => !doneDaily.has(t.id));
  const dailyCompleted = dailyAll.filter(t => doneDaily.has(t.id));

  const buckets = {
    firstThing: { missed: [], done: [] },
    morning: { missed: [], done: [] },
    afternoon: { missed: [], done: [] },
    evening: { missed: [], done: [] },
    endOfDay: { missed: [], done: [] }
  };
  for (const t of activeList) {
    const section = t.timeOfDay || 'morning';
    const bucket = buckets[section] || buckets.morning;
    if (yesterdayDone.has(t.id)) bucket.done.push(t);
    else bucket.missed.push(t);
  }
  const targetMap = {
    firstThing: firstThingContainer,
    morning: morningContainer,
    afternoon: afternoonContainer,
    evening: eveningContainer,
    endOfDay: endOfDayContainer
  };
  for (const [section, data] of Object.entries(buckets)) {
    const target = targetMap[section] || morningContainer;
    for (const t of [...data.missed, ...data.done]) {
      target.appendChild(makeTaskElement(t, 'daily', target));
    }
  }
  const weeklyAll = all.filter(t => t.type === 'task' && t.recurs === 'weekly');
  const weeklyHidden = weeklyAll.filter(t => {
    const hideUntil = t.hiddenUntil || t.skipUntil;
    return hideUntil && nowMs < new Date(hideUntil).getTime() && !doneWeekly.has(t.id);
  });
  const weeklyVisible = weeklyAll.filter(t => {
    const hideUntil = t.hiddenUntil || t.skipUntil;
    return !hideUntil || nowMs >= new Date(hideUntil).getTime();
  });
  const weeklyActive = weeklyVisible.filter(t => !doneWeekly.has(t.id));
  const weeklyCompleted = weeklyAll.filter(t => doneWeekly.has(t.id));

  for (const t of weeklyActive)
    weeklyContainer.appendChild(makeTaskElement(t, 'weekly'));

  const monthlyAll = all.filter(t => t.type === 'task' && t.recurs === 'monthly');
  const monthlyHidden = monthlyAll.filter(t => {
    const hideUntil = t.hiddenUntil || t.skipUntil;
    return hideUntil && nowMs < new Date(hideUntil).getTime() && !doneMonthly.has(t.id);
  });
  const monthlyVisible = monthlyAll.filter(t => {
    const hideUntil = t.hiddenUntil || t.skipUntil;
    return !hideUntil || nowMs >= new Date(hideUntil).getTime();
  });
  const monthlyActive = monthlyVisible.filter(t => !doneMonthly.has(t.id));
  const monthlyCompleted = monthlyAll.filter(t => doneMonthly.has(t.id));

  for (const t of monthlyActive)
    monthlyContainer.appendChild(makeTaskElement(t, 'monthly'));

  // Populate hidden and completed sections
  const hiddenTasks = [
    ...dailyHidden.map(t => ({ task: t, period: 'daily' })),
    ...weeklyHidden.map(t => ({ task: t, period: 'weekly' })),
    ...monthlyHidden.map(t => ({ task: t, period: 'monthly' }))
  ];
  hiddenTasks.forEach(({ task, period }) => {
    const target =
      period === 'daily'
        ? targetMap[task.timeOfDay || 'morning']
        : period === 'weekly'
          ? weeklyContainer
          : monthlyContainer;
    hiddenContainer.appendChild(
      makeTaskElement(task, period, target, getCategoryLabel(task, period))
    );
  });

  const completedTasks = [
    ...dailyCompleted.map(t => ({ task: t, period: 'daily' })),
    ...weeklyCompleted.map(t => ({ task: t, period: 'weekly' })),
    ...monthlyCompleted.map(t => ({ task: t, period: 'monthly' }))
  ];
  completedTasks.forEach(({ task, period }) => {
    const target =
      period === 'daily'
        ? targetMap[task.timeOfDay || 'morning']
        : period === 'weekly'
          ? weeklyContainer
          : monthlyContainer;
    completedContainer.appendChild(
      makeTaskElement(task, period, target, getCategoryLabel(task, period))
    );
  });

  function toggleSection(listEl) {
    const hasTasks = !!listEl.querySelector('.daily-task-wrapper');
    const hdr = listEl.previousElementSibling;
    listEl.style.display = hasTasks ? '' : 'none';
    if (hdr && hdr.tagName === 'H3') hdr.style.display = hasTasks ? '' : 'none';
  }

  function toggleSubsection(listEl) {
    const hasTasks = !!listEl.querySelector('.daily-task-wrapper');
    const hdr = listEl.previousElementSibling;
    const prev = hdr?.previousElementSibling;
    listEl.style.display = hasTasks ? '' : 'none';
    if (hdr && hdr.tagName === 'H3') hdr.style.display = hasTasks ? '' : 'none';
    if (prev && prev.tagName === 'HR') prev.style.display = hasTasks ? '' : 'none';
  }

  function toggleDetails(detailsEl, listEl) {
    const hasTasks = !!listEl.querySelector('.daily-task-wrapper');
    detailsEl.style.display = hasTasks ? '' : 'none';
  }

  // Remove any duplicate task elements by ID
  const wrappers = Array.from(panel.querySelectorAll('.daily-task-wrapper'));
  const renderedIds = new Set();
  for (const w of wrappers) {
    const id = w.dataset.taskId;
    if (renderedIds.has(id)) w.remove();
    else renderedIds.add(id);
  }

  // Hide empty subsections and categories
  [firstThingContainer, morningContainer, afternoonContainer, eveningContainer, endOfDayContainer].forEach(toggleSubsection);
  toggleSection(container);
  toggleSection(weeklyContainer);
  toggleSection(monthlyContainer);
  toggleDetails(hiddenContainer.parentElement, hiddenContainer);
  toggleDetails(completedContainer.parentElement, completedContainer);

  // ——— Helpers —————————————————————————

  async function onToggleTaskCompletion(task, cb, wrapper, listEl, setRef, key) {
    try {
      completionMap[key] = completionMap[key] || [];
      if (cb.checked) {
        completionMap[key].push(task.id);
        setRef.add(task.id);
      } else {
        completionMap[key] = completionMap[key].filter(id => id !== task.id);
        setRef.delete(task.id);
      }
      if (currentUser) {
        await db.collection('taskCompletions').doc(currentUser.uid).set(completionMap, { merge: true });
      } else {
        localStorage.setItem(COMPLETION_KEY, JSON.stringify(completionMap));
      }
      if (cb.checked) {
        wrapper.remove();
      } else {
        listEl.prepend(wrapper);
      }

      if (listEl === weeklyContainer) {
        toggleSection(weeklyContainer);
      } else if (listEl === monthlyContainer) {
        toggleSection(monthlyContainer);
      } else {
        toggleSubsection(listEl);
        toggleSection(container);
      }
      toggleDetails(completedContainer.parentElement, completedContainer);
    } catch (err) {
      console.error(err);
      alert('⚠️ Could not update completion. Reverting.');
      cb.checked = !cb.checked;
    }
  }

  function getDaysMissed(taskId) {
    let last = null;
    for (const [date, ids] of Object.entries(completionMap)) {
      if (ids.includes(taskId)) {
        const d = new Date(date);
        if (!last || d > last) last = d;
      }
    }
    if (!last) return 0;
    const diff = Math.floor((now - last) / 86400000);
    return Math.max(diff - 1, 0);
  }

  function getWeeksMissed(taskId) {
    let last = null;
    for (const [date, ids] of Object.entries(completionMap)) {
      if (ids.includes(taskId)) {
        const d = new Date(date);
        if (!last || d > last) last = d;
      }
    }
    if (!last) return 0;
    const diffWeeks = Math.floor((monday - last) / 604800000);
    return Math.max(diffWeeks - 1, 0);
  }

  function getMonthsMissed(taskId) {
    let last = null;
    for (const [date, ids] of Object.entries(completionMap)) {
      if (ids.includes(taskId)) {
        const d = new Date(date);
        if (!last || d > last) last = d;
      }
    }
    if (!last) return 0;
    const diffMonths = (monthStart.getFullYear() - last.getFullYear()) * 12 +
      (monthStart.getMonth() - last.getMonth());
    return Math.max(diffMonths - 1, 0);
  }

  function getCategoryLabel(task, period) {
    if (period === 'daily') {
      const map = {
        firstThing: 'First Thing',
        morning: 'Morning',
        afternoon: 'Afternoon',
        evening: 'Evening',
        endOfDay: 'End of Day'
      };
      return map[task.timeOfDay || 'morning'] || 'Daily';
    }
    return period.charAt(0).toUpperCase() + period.slice(1);
  }

  function makeTaskElement(task, period = 'daily', listElOverride, categoryLabel) {
    const config = {
      daily: { set: doneDaily, key: todayKey, container: container },
      weekly: { set: doneWeekly, key: weekKey, container: weeklyContainer },
      monthly: { set: doneMonthly, key: monthKey, container: monthlyContainer }
    };
    const { set, key, container: defaultList } = config[period];
    const listEl = listElOverride || defaultList;
    const isDone = set.has(task.id);
    const wrapper = document.createElement('div');
    wrapper.className = 'daily-task-wrapper';
    wrapper.draggable = true;
    wrapper.dataset.taskId = task.id;
    Object.assign(wrapper.style, {
      pointerEvents: 'auto',
      userSelect: 'none',
      touchAction: 'auto',
      position: 'relative',
      zIndex: '1'
    });

    const row = document.createElement('div');
    row.className = 'daily-task';
    let bgColor = '#fffaf0';
    let borderColor = '#ffbb55';
    if (period === 'daily' && !isDone) {
      const missed = getDaysMissed(task.id);
      if (missed > 0) {
        const intensity = Math.min(missed, 7);
        const alpha = 0.2 + (intensity - 1) * 0.1;
        bgColor = `rgba(255,165,0,${alpha})`;
        borderColor = `rgba(255,165,0,${Math.min(alpha + 0.2, 1)})`;
      }
    } else if (period === 'weekly' && !isDone) {
      const missed = getWeeksMissed(task.id);
      if (missed > 0) {
        const intensity = Math.min(missed, 7);
        const alpha = 0.2 + (intensity - 1) * 0.1;
        bgColor = `rgba(255,165,0,${alpha})`;
        borderColor = `rgba(255,165,0,${Math.min(alpha + 0.2, 1)})`;
      }
    } else if (period === 'monthly' && !isDone) {
      const missed = getMonthsMissed(task.id);
      if (missed > 0) {
        const intensity = Math.min(missed, 7);
        const alpha = 0.2 + (intensity - 1) * 0.1;
        bgColor = `rgba(255,165,0,${alpha})`;
        borderColor = `rgba(255,165,0,${Math.min(alpha + 0.2, 1)})`;
      }
    }
    Object.assign(row.style, {
      display: 'grid',
      gridTemplateColumns: '24px 1fr auto',
      alignItems: 'center',
      columnGap: '10px',
      padding: '1.5px 12px',
      borderRadius: '8px',
      background: bgColor,
      borderLeft: `4px solid ${borderColor}`,
      marginBottom: '0',
      opacity: isDone ? '0.6' : '1'
    });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isDone;
    cb.addEventListener('change', () =>
      onToggleTaskCompletion(task, cb, wrapper, listEl, set, key)
    );

    const label = document.createElement('div');
    const titleSpan = document.createElement('div');
    titleSpan.style.overflowWrap = 'anywhere';
    titleSpan.innerHTML = linkify(task.text);
    if (categoryLabel) {
      const catSpan = document.createElement('span');
      catSpan.className = 'task-category';
      catSpan.textContent = ` (${categoryLabel})`;
      titleSpan.appendChild(catSpan);
    }
    label.appendChild(titleSpan);
    if (task.notes) {
      const noteSpan = document.createElement('div');
      noteSpan.className = 'note-text';
      noteSpan.style.overflowWrap = 'anywhere';
      noteSpan.innerHTML = linkify(task.notes);
      label.appendChild(noteSpan);
    }
    Object.assign(label.style, {
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
      minWidth: 0
    });

    const btns = document.createElement('div');
    btns.style.display = 'flex';
    btns.style.gap = '8px';

    // Move up
    btns.append(makeIconBtn('⬆️', 'Move up', async () => {
      const prev = wrapper.previousElementSibling;
      if (prev) {
        prev.before(wrapper);
        if (period === 'daily') {
          try { await persistReorder(); }
          catch { alert('⚠️ Could not save new order.'); }
        }
      }
    }));

    // Edit
    let editing = false;
    const editBtn = makeIconBtn('✏️', 'Edit', async () => {
      if (!editing) {
        editing = true;
        editBtn.textContent = '💾';
        const textInput = document.createElement('input');
        textInput.value = task.text;
        textInput.style.width = '100%';
        const notesInput = document.createElement('textarea');
        notesInput.value = task.notes || '';
        notesInput.rows = 2;
        notesInput.style.width = '100%';
        notesInput.style.marginTop = '1px';
        const select = document.createElement('select');
        ['firstThing', 'morning', 'afternoon', 'evening', 'endOfDay'].forEach(val => {
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent =
            val === 'firstThing' ? 'First Thing'
            : val === 'endOfDay' ? 'End of Day'
            : val.charAt(0).toUpperCase() + val.slice(1);
          select.appendChild(opt);
        });
        select.value = task.timeOfDay || 'morning';
        select.style.marginTop = '1px';
        label.innerHTML = '';
        label.append(textInput, notesInput, select);
      } else {
        editing = false;
        editBtn.textContent = '✏️';
        const newText = label.querySelector('input')?.value.trim();
        const newNotes = label.querySelector('textarea')?.value.trim();
        const newTime = label.querySelector('select')?.value || 'morning';
        try {
          const allDecs = await loadDecisions();
          const idx = allDecs.findIndex(t => t.id === task.id);
          if (idx === -1) return;
          allDecs[idx].text = newText;
          allDecs[idx].notes = newNotes;
          allDecs[idx].timeOfDay = newTime;
          await saveDecisions(allDecs);

          // update local task and label without re-rendering everything
          task.text = newText;
          task.notes = newNotes;
          const prevTime = task.timeOfDay;
          task.timeOfDay = newTime;

          label.innerHTML = '';
          const titleSpan = document.createElement('div');
          titleSpan.style.overflowWrap = 'anywhere';
          titleSpan.innerHTML = linkify(newText);
          label.appendChild(titleSpan);
          if (newNotes) {
            const noteSpan = document.createElement('div');
            noteSpan.className = 'note-text';
            noteSpan.style.overflowWrap = 'anywhere';
            noteSpan.innerHTML = linkify(newNotes);
            label.appendChild(noteSpan);
          }

          if (newTime !== prevTime) {
            const target = targetMap[newTime] || morningContainer;
            target.appendChild(wrapper);
          }
        } catch {
          alert('⚠️ Could not save edit.');
        }
      }
    });
    btns.append(editBtn);

    // Skip interval (clock + dropdown menu)
    const clockBtn = makeIconBtn('🕒', 'Skip interval', () => toggleMenu());
    const menu = document.createElement('div');
    Object.assign(menu.style, {
      position: 'absolute', background: '#fff', border: '1px solid #ccc', borderRadius: '6px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.15)', padding: '6px 0', fontSize: '0.9em',
      display: 'none', zIndex: '9999', minWidth: '120px'
    });
    document.body.appendChild(menu);
    skipOptions.forEach(opt => {
      const optBtn = document.createElement('button'); optBtn.type = 'button'; optBtn.textContent = opt.label;
      Object.assign(optBtn.style, {
        display: 'block', width: '100%', padding: '4px 12px', border: 'none', background: 'white',
        color: '#333', textAlign: 'left', cursor: 'pointer'
      });
      optBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const allDecs = await loadDecisions();
          const idx = allDecs.findIndex(d => d.id === task.id);
          if (idx === -1) return;
          const hideUntil = new Date(Date.now() + opt.value * 3600000).toISOString();
          allDecs[idx].hiddenUntil = hideUntil;
          allDecs[idx].skipUntil = hideUntil;
          await saveDecisions(allDecs);
        menu.style.display = 'none'; wrapper.remove();
      });
      menu.appendChild(optBtn);
    });
    function toggleMenu() {
      const rect = clockBtn.getBoundingClientRect();
      menu.style.top = `${rect.bottom + window.scrollY}px`;
      menu.style.left = `${rect.left + window.scrollX}px`;
      menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    }
    document.addEventListener('click', e => {
      if (!menu.contains(e.target) && e.target !== clockBtn) menu.style.display = 'none';
    });
    btns.append(clockBtn);


    // Delete
    btns.append(makeIconBtn('❌', 'Delete', async () => {
      if (!confirm('Delete this task?')) return;
      try {
        const remaining = (await loadDecisions()).filter(t => t.id !== task.id);
        await saveDecisions(remaining);
        wrapper.remove();
      } catch {
        alert('⚠️ Could not delete task.');
      }
    }));

    row.append(cb, label, btns);
    wrapper.appendChild(row);
    return wrapper;
  }

  async function persistReorder() {
    const wrappers = Array.from(container.querySelectorAll('.daily-task-wrapper'));
    const ids = wrappers.map(w => w.dataset.taskId);
    const others = all.filter(t => !ids.includes(t.id));
    const reordered = ids.map(id => all.find(t => t.id === id)).filter(Boolean);
    await saveDecisions([...others, ...reordered], { skipNotify: true });
  }
}

let currentRender = Promise.resolve();

export function renderDailyTasks(currentUser, db) {
  currentRender = currentRender.finally(async () => {
    try {
      await renderDailyTasksImpl(currentUser, db);
    } finally {
      currentRender = Promise.resolve();
    }
  });
  return currentRender;
}

document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('dailyPanel');
  if (panel && panel.style.display !== 'none') {
    // Render tasks for the current user if the Daily tab is visible
    renderDailyTasks(currentUser, db);
  }
});

window.renderDailyTasks = renderDailyTasks;
window.quickAddTask = quickAddTask;
