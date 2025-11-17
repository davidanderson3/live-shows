import {
    initializeGlobalDragHandlers,
    enableGoalDragAndDrop
} from './dragAndDrop.js';

import * as helpers from './helpers.js';
const {
    loadDecisions,
    saveDecisions,
    saveGoalOrder,
    generateId,
    makeIconBtn,
    formatDaysUntil,
    linkify,
    pickDateRange,
    pickDate
} = helpers;
let loadGoalOrder;
try {
    loadGoalOrder = helpers.loadGoalOrder;
} catch {}
if (typeof loadGoalOrder !== 'function') {
    loadGoalOrder = async () => [];
}
let dedupeById = (list => {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.filter(it => {
        if (!it?.id || seen.has(it.id)) return false;
        seen.add(it.id);
        return true;
    });
});
try {
    if (typeof helpers.dedupeById === 'function') {
        dedupeById = helpers.dedupeById;
    }
} catch {}

import {
    attachTaskButtons,
    renderChildren
} from './tasks.js';
import { loadHourNotes, saveHourNotes } from './hourNotes.js';
import { currentUser } from './auth.js';


const openGoalIds = new Set();
// Expose for cleanup between sign-ins
window.openGoalIds = openGoalIds;
const goalList = document.getElementById('goalList');
const completedList = document.getElementById('completedList');

initializeGlobalDragHandlers();

function tempToColor(temp) {
    const min = 20;
    const max = 100;
    const t = Math.max(min, Math.min(max, temp));
    const ratio = (t - min) / (max - min);
    const hue = 240 - ratio * 240;
    return `hsl(${hue}, 90%, 85%)`;
}

export async function addCalendarGoal(date = '') {
    const text = prompt('New goal:');
    if (!text?.trim()) return;
    const defaultDate = date || new Date().toISOString().slice(0, 10);
    const range = await pickDateRange(defaultDate, '');
    if (range.start === null) return;
    const start = range.start || defaultDate;
    const end = range.end?.trim() || '';
    const all = await loadDecisions();
    const trimmed = text.trim();
    const newGoal = {
        id: generateId(),
        type: 'goal',
        text: trimmed,
        notes: '',
        completed: false,
        resolution: '',
        dateCompleted: '',
        parentGoalId: null,
        hiddenUntil: null,
        deadline: '',
        scheduled: start.trim(),
        scheduledEnd: end
    };
    const deduped = dedupeById([...all, newGoal]);

    const order = await loadGoalOrder();
    if (!order.includes(newGoal.id)) {
        await saveGoalOrder([...order, newGoal.id]);
    }

    await saveDecisions(deduped);
    // UI re-render handled by decisionsUpdated event
}

function collectDescendants(goalId, items) {
    const kids = items.filter(
        i => i.parentGoalId === goalId && (i.type === 'goal' || i.type === 'task')
    );
    return kids.flatMap(k => [k, ...(k.type === 'goal' ? collectDescendants(k.id, items) : [])]);
}

export function createGoalRow(goal, options = {}) {
    const row = document.createElement('div');
    row.className = 'decision-row';

    // ── Left group: toggle + checkbox ──
    const left = document.createElement('div');
    left.className = 'left-group';
    const toggle = document.createElement('span');
    toggle.className = 'toggle-triangle';
    toggle.style.marginRight = '6px';
    if (!options.hideArrow) {
        toggle.textContent = '▶';
        toggle.style.cursor = 'pointer';
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!goal.completed;

    // only attach the onchange logic if this row is a goal
    if (goal.type === 'goal') {
        checkbox.onchange = async () => {
            // 1) Update DB
            const items = await loadDecisions();
            const idx = items.findIndex(d => d.id === goal.id);
            if (idx === -1) return;

            items[idx].completed = checkbox.checked;
            items[idx].dateCompleted = checkbox.checked
                ? new Date().toISOString()
                : null;

            // 2) Update the UI immediately
            if (options.stayPut) {
                if (typeof options.onToggle === 'function') {
                    await options.onToggle(checkbox.checked, items);
                }
            } else {
                const wrapper = row.closest('.decision.goal-card') || row;
                if (checkbox.checked) {
                    completedList.appendChild(wrapper);
                } else {
                    goalList.appendChild(wrapper);
                }
            }

            // 3) Persist changes after updating UI
            await saveDecisions(items);
            updateGoalCounts(items);
        };
    }

    left.append(toggle, checkbox);
    row.appendChild(left);

    // ── Middle group: text ──
    const middle = document.createElement('div');
    middle.className = 'middle-group';
    const titleDiv = document.createElement('div');
    titleDiv.className = 'title-column';
    titleDiv.innerHTML = linkify(goal.text);
    middle.appendChild(titleDiv);
    if (goal.notes) {
        const noteDiv = document.createElement('div');
        noteDiv.className = 'note-text';
        noteDiv.innerHTML = linkify(goal.notes);
        middle.appendChild(noteDiv);
    }
    const buttonWrap = document.createElement('div');
    buttonWrap.className = 'button-row';
    if (options.itemsRef) {
        const descendants = collectDescendants(goal.id, options.itemsRef);
        if (descendants.length) {
            const done = descendants.filter(c => c.completed).length;
            const pct = Math.round((done / descendants.length) * 100);
            if (!goal.doLater) {
                row.style.background = `linear-gradient(90deg, rgba(144, 238, 144, 0.2) ${pct}%, #fbfdfc ${pct}%)`;
            }
            const prog = document.createElement('div');
            prog.className = 'progress-text';
            prog.textContent = `${pct}%`;
            buttonWrap.appendChild(prog);
        }
    }
    if (goal.type === 'goal') {
        attachEditButtons(goal, buttonWrap, row, options.itemsRef);
    }
    middle.appendChild(buttonWrap);
    row.appendChild(middle);

    const due = document.createElement('div');
    due.className = 'due-column';
    const rangeText = goal.scheduledEnd && goal.scheduledEnd !== goal.scheduled
        ? `${goal.scheduled} - ${goal.scheduledEnd}`
        : (goal.scheduled || '');
    let dueContent = goal.completed ? goal.dateCompleted : rangeText;
    due.innerHTML = dueContent;
    row.appendChild(due);
    return row;
}



export async function renderGoalsAndSubitems() {
  clearDOM();
  const { allDecisions, sortedGoals } = await loadAndSyncGoals();

  // 1) Render the calendar on the left
  const calendarContent = initCalendarSection();
  const todayList = initTodayScheduleSection();

  // kick off weather fetch but don't block UI
  const weatherPromise = window.fetchWeatherData?.();

  // 2) Hidden & completed goals below
  const hiddenContent = initHiddenSection();
  initCompletedSection();
  await renderRemainingGoals(allDecisions, sortedGoals, hiddenContent);
  updateGoalCounts(allDecisions);

  // first render without waiting on weather data
  renderCalendarSection(allDecisions, calendarContent, null);
  renderTodaySchedule(allDecisions, todayList, null);

  // update once weather data is ready
  if (weatherPromise) {
    try {
      const weatherData = (await weatherPromise)?.data || null;
      renderCalendarSection(allDecisions, calendarContent, weatherData);
      renderTodaySchedule(allDecisions, todayList, weatherData);
    } catch (err) {
      console.error('Weather fetch failed', err);
    }
  }
}


function clearDOM() {
    goalList.innerHTML = '';
    completedList.innerHTML = '';
    const hiddenContent = document.getElementById('hiddenContent');
    if (hiddenContent) hiddenContent.innerHTML = '';
}

let fixedMutualParents = false;

async function fixMutualParentGoals(items) {
    if (fixedMutualParents) return;
    const parentMap = {};
    for (const it of items) {
        if (it.type === 'goal' && it.parentGoalId) {
            parentMap[it.id] = it.parentGoalId;
        }
    }
    const toClear = new Set();
    for (const [id, parentId] of Object.entries(parentMap)) {
        if (parentMap[parentId] === id) {
            toClear.add(id);
            toClear.add(parentId);
        }
    }
    if (toClear.size) {
        let changed = false;
        for (const it of items) {
            if (toClear.has(it.id) && it.parentGoalId) {
                it.parentGoalId = null;
                changed = true;
            }
        }
        if (changed) await saveDecisions(items);
    }
    fixedMutualParents = true;
}

async function loadAndSyncGoals() {
    let allDecisions = await loadDecisions();
    console.log(`Loaded ${allDecisions.length} decisions for rendering`);
    // De-duplicate any decisions by ID so we don't render duplicate projects
    const deduped = dedupeById(allDecisions);
    if (deduped.length !== allDecisions.length) {
        console.warn(`Removed ${allDecisions.length - deduped.length} decisions with duplicate IDs`);
        allDecisions = deduped;
        try { await saveDecisions(allDecisions); } catch (err) { console.error(err); }
    } else {
        allDecisions = deduped;
    }
    await fixMutualParentGoals(allDecisions);
    const goals = allDecisions.filter(d => d.type === 'goal' && !d.parentGoalId);
    const goalMap = Object.fromEntries(goals.map(g => [g.id, g]));

    const user = currentUser;
    let goalOrder = [];

    if (user) {
        goalOrder = await loadGoalOrder();

        // Remove any duplicate IDs from persisted goal order
        const deduped = Array.from(new Set(goalOrder));

        const missing = goals.map(g => g.id).filter(id => !deduped.includes(id));

        // If we removed duplicates or found new goals, persist the cleaned order
        if (missing.length || deduped.length !== goalOrder.length) {
            goalOrder = [...deduped, ...missing];
            await saveGoalOrder(goalOrder);
        } else {
            goalOrder = deduped;
        }
    } else {
        goalOrder = goals.map(g => g.id);
    }

    const seenIds = new Set();
    const sortedGoals = goalOrder
        .filter(id => {
            if (seenIds.has(id)) return false;
            seenIds.add(id);
            return true;
        })
        .map(id => goalMap[id])
        .filter(Boolean);
    return { allDecisions, sortedGoals };
}

function initHiddenSection() {
    let hiddenSection = document.getElementById('hiddenList');
    if (!hiddenSection) {
        hiddenSection = document.createElement('div');
        hiddenSection.id = 'hiddenList';
        hiddenSection.innerHTML = `
      <h2 style="margin-top:32px" id="hiddenHeader">
        <span id="toggleHidden" style="cursor:pointer">▶</span> <span id="hiddenLabel">Hidden Projects</span>
      </h2>
      <div id="hiddenContent" style="display:none"></div>
      <hr style="margin: 40px 0;" />
    `;

        const container = goalList.parentNode;
        const completedSection = document.getElementById('completedSection');
        if (completedSection) container.insertBefore(hiddenSection, completedSection);
        else container.appendChild(hiddenSection);

        const toggleHidden = hiddenSection.querySelector('#toggleHidden');
        const hiddenContent = hiddenSection.querySelector('#hiddenContent');
        toggleHidden.onclick = () => {
            const open = hiddenContent.style.display === 'block';
            toggleHidden.textContent = open ? '▶' : '▼';
            hiddenContent.style.display = open ? 'none' : 'block';
        };
    }
    return hiddenSection.querySelector('#hiddenContent');
}

// initCalendarSection.js
function initCalendarSection() {
    // grab the static panel in your HTML:
    const calendarContent = document.getElementById('calendarContent');
    if (!calendarContent) {
        throw new Error('No #calendarContent found in DOM');
    }
    calendarContent.innerHTML = '';   // clear prior render
    return calendarContent;
}

function initTodayScheduleSection() {
    let container = document.getElementById('todaySchedule');
    if (!container) {
        const panel = document.getElementById('calendarPanel');
        const parent =
            panel?.querySelector('.right-column') ||
            panel?.querySelector('.full-column') ||
            document.body;
        container = document.createElement('div');
        container.id = 'todaySchedule';
        const target = document.getElementById('calendarContent');
        if (target && target.parentElement === parent) {
            parent.insertBefore(container, target);
        } else {
            parent.appendChild(container);
        }
    }
    container.innerHTML = '<h3>Daily Planner</h3><div id="todayScheduleList"></div>';
    return container.querySelector('#todayScheduleList');
}


export function renderTodaySchedule(_all, listEl, weather) {
    if (!listEl) return;

    const notes = loadHourNotes();

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const now = new Date();
    const currentHour = now.getHours();
    const weatherMap = {};
    if (weather && weather.hourly && weather.hourly.time) {
        weather.hourly.time.forEach((t, idx) => {
            const d = new Date(t);
            const key = t.slice(0, 10);
            if (!weatherMap[key]) weatherMap[key] = {};
            weatherMap[key][d.getHours()] = {
                temp: weather.hourly.temperature_2m[idx],
                rain: weather.hourly.precipitation_probability
                    ? weather.hourly.precipitation_probability[idx]
                    : undefined
            };
        });
    }

    listEl.innerHTML = '';

    for (let day = 0; day < 7; day++) {
        const current = new Date(start);
        current.setDate(start.getDate() + day);
        const key = current.toISOString().slice(0, 10);

        const section = document.createElement('div');
        section.className = 'day-section';

        const hdr = document.createElement('h4');
        hdr.textContent = current.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const middayTemp = weatherMap[key]?.[12]?.temp;
        if (middayTemp !== undefined) hdr.style.backgroundColor = tempToColor(middayTemp);
        section.appendChild(hdr);

        const startHour = day === 0 ? Math.max(6, currentHour + 1) : 6;
        for (let h = startHour; h < 22; h++) {
            const row = document.createElement('div');
            row.className = 'hour-row time-box';
            const label = document.createElement('div');
            label.className = 'hour-label';
            const h12 = h % 12 || 12;
            const ampm = h < 12 ? 'AM' : 'PM';
            label.textContent = `${h12} ${ampm}`;

            const w = weatherMap[key]?.[h];
            if (w) {
                const span = document.createElement('span');
                span.className = 'hour-weather';
                const icon = window.chooseWeatherIcon ? window.chooseWeatherIcon(w.rain) : '';
                const rainText = w.rain !== undefined ? ` <span class="rain-percent">${w.rain}%</span>` : '';
                span.innerHTML = `${icon} ${w.temp}\u00B0${rainText}`;
                label.appendChild(span);
                row.style.backgroundColor = tempToColor(w.temp);
                if (w.temp >= 58 && w.temp <= 77) {
                    row.classList.add('comfortable-temp');
                }
            }
            row.appendChild(label);

            const cell = document.createElement('div');
            cell.className = 'hour-events';
            cell.dataset.date = key;
            cell.dataset.hour = h;

            const noteText = notes[key]?.[h] || '';
            if (noteText) {
                const span = document.createElement('span');
                span.className = 'hour-note';
                span.textContent = noteText;
                cell.appendChild(span);
            }

            const openInput = () => {
                if (cell.querySelector('input.hour-input')) return;

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'hour-input';
                input.value = notes[key]?.[h] || '';

                cell.innerHTML = '';
                cell.appendChild(input);
                input.focus();

                const save = () => {
                    const text = input.value.trim();
                    if (text) {
                        if (!notes[key]) notes[key] = {};
                        notes[key][h] = text;
                    } else if (notes[key]) {
                        delete notes[key][h];
                        if (!Object.keys(notes[key]).length) delete notes[key];
                    }
                    saveHourNotes(notes);
                    cell.innerHTML = '';
                    if (text) {
                        const span = document.createElement('span');
                        span.className = 'hour-note';
                        span.textContent = text;
                        cell.appendChild(span);
                    }
                };

                // save once editing finishes
                input.addEventListener('blur', save);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') input.blur();
                });
            };
            cell.addEventListener('click', openInput);
            let pressTimer;
            row.addEventListener('touchstart', (e) => {
                e.preventDefault();
                pressTimer = setTimeout(openInput, 500);
            }, { passive: false });
            const cancelTimer = () => clearTimeout(pressTimer);
            row.addEventListener('touchend', cancelTimer);
            row.addEventListener('touchmove', cancelTimer);
            row.addEventListener('touchcancel', cancelTimer);
            row.appendChild(cell);
            section.appendChild(row);
        }

        listEl.appendChild(section);
    }
}


function initCompletedSection() {
    if (document.getElementById('completedSection')) return;
    const completedSection = document.createElement('div');
    completedSection.id = 'completedSection';

    const hdr = document.createElement('h2');
    hdr.id = 'completedHeader';
    const toggle = document.createElement('span');
    toggle.textContent = '▶';
    toggle.style.cursor = 'pointer';
    hdr.appendChild(toggle);
    const label = document.createElement('span');
    label.id = 'completedLabel';
    label.textContent = ' Completed';
    hdr.appendChild(label);

    const completedContent = document.createElement('div');
    completedContent.id = 'completedContent';
    completedContent.style.display = 'none';
    completedContent.appendChild(completedList);

    toggle.onclick = () => {
        const open = completedContent.style.display === 'block';
        toggle.textContent = open ? '▶' : '▼';
        completedContent.style.display = open ? 'none' : 'block';
    };

    completedSection.appendChild(hdr);
    completedSection.appendChild(completedContent);
    goalList.parentNode.appendChild(completedSection);
}

function renderCalendarSection(all, calendarContent, weather) {
    const scheduled = all
        .filter(
            g =>
                g.scheduled &&
                !g.completed &&
                !isNaN(Date.parse(g.scheduled))
        )
        .sort((a, b) => new Date(a.scheduled) - new Date(b.scheduled));

    const byDate = {};
    scheduled.forEach(goal => {
        const start = new Date(goal.scheduled);
        const end = goal.scheduledEnd && !isNaN(Date.parse(goal.scheduledEnd))
            ? new Date(goal.scheduledEnd)
            : new Date(goal.scheduled);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const key = d.toISOString().slice(0, 10);
            (byDate[key] = byDate[key] || []).push(goal);
        }
    });

    function parseKey(key) {
        const [y, m, d] = key.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    function keyFromDate(date) {
        return date.toISOString().slice(0, 10);
    }

    const dailyWeather = {};
    if (weather && weather.daily && weather.daily.time) {
        weather.daily.time.forEach((t, idx) => {
            dailyWeather[t] = {
                high: weather.daily.temperature_2m_max[idx],
                low: weather.daily.temperature_2m_min[idx],
                rain: weather.daily.precipitation_probability_max
                    ? weather.daily.precipitation_probability_max[idx]
                    : undefined
            };
        });
    }

    const dateKeys = Object.keys(byDate).sort();
    let start = new Date();
    start.setHours(0, 0, 0, 0);
    if (dateKeys.length) {
        const first = parseKey(dateKeys[0]);
        first.setHours(0, 0, 0, 0);
        if (first < start) start = first;
    }

    let end = dateKeys.length ? parseKey(dateKeys[dateKeys.length - 1]) : new Date(start);
    const extendEnd = new Date();
    extendEnd.setHours(0, 0, 0, 0);
    extendEnd.setMonth(extendEnd.getMonth() + 6);
    if (extendEnd > end) end = extendEnd;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let d = new Date(start); d <= end;) {
        const key = keyFromDate(d);
        const dow = d.getDay();

        if (dow === 6) {
            const sat = new Date(d);
            const sun = new Date(d); sun.setDate(d.getDate() + 1);
            const sunKey = keyFromDate(sun);
            if (sun < today) {
                delete byDate[key];
                delete byDate[sunKey];
                d.setDate(d.getDate() + 2);
                continue;
            }

            const section = document.createElement('div');
            section.className = 'weekend-section';

            const hdr = document.createElement('h3');
            const satLabel = sat.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
            const sunLabel = sun.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
            const satDays = formatDaysUntil(key);
            const sunDays = formatDaysUntil(sunKey);
            const isCurrentWeekend = today >= sat && today <= sun;
            if (isCurrentWeekend) section.classList.add('current-weekend');
            const satW = dailyWeather[key];
            const sunW = dailyWeather[sunKey];
            const satInfo = satW ? ` ${window.chooseWeatherIcon?.(satW.rain) || ''} ${satW.high}\u00B0/${satW.low}\u00B0${satW.rain !== undefined ? ` <span class="rain-percent">${satW.rain}%</span>` : ''}` : '';
            const sunInfo = sunW ? ` ${window.chooseWeatherIcon?.(sunW.rain) || ''} ${sunW.high}\u00B0/${sunW.low}\u00B0${sunW.rain !== undefined ? ` <span class="rain-percent">${sunW.rain}%</span>` : ''}` : '';
            hdr.innerHTML = `Weekend:<br>${satLabel} (${satDays})${satInfo}<br>${sunLabel} (${sunDays})${sunInfo}`;
            const highTemp = Math.max(satW?.high ?? -Infinity, sunW?.high ?? -Infinity);
            if (isFinite(highTemp)) hdr.style.backgroundColor = tempToColor(highTemp);
            section.appendChild(hdr);

            [key, sunKey].forEach(k => {
                (byDate[k] || []).forEach(goal => {
                    const wrapper = makeGoalWrapper(goal);
                    const row = createGoalRow(goal, { hideScheduled: true, itemsRef: all });
                    wrapper.appendChild(row);

                    const childrenContainer = document.createElement('div');
                    childrenContainer.className = 'goal-children';
                    childrenContainer.style.display = openGoalIds.has(goal.id) ? 'block' : 'none';
                    wrapper.appendChild(childrenContainer);
                    renderChildren(goal, all, childrenContainer);

                    setupToggle(wrapper, row, childrenContainer, goal.id);
                    section.appendChild(wrapper);
                });
                delete byDate[k];
            });

            calendarContent.appendChild(section);
            d.setDate(d.getDate() + 2);
        } else if (dow === 0) {
            const sat = new Date(d); sat.setDate(d.getDate() - 1);
            const satKey = keyFromDate(sat);
            if (d < today) {
                delete byDate[satKey];
                delete byDate[key];
                d.setDate(d.getDate() + 1);
                continue;
            }

            const section = document.createElement('div');
            section.className = 'weekend-section';

            const hdr = document.createElement('h3');
            const satLabel = sat.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
            const sunLabel = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
            const satDays = formatDaysUntil(satKey);
            const sunDays = formatDaysUntil(key);
            const isCurrentWeekend = today >= sat && today <= d;
            if (isCurrentWeekend) section.classList.add('current-weekend');
            const satW = dailyWeather[satKey];
            const sunW = dailyWeather[key];
            const satInfo = satW ? ` ${window.chooseWeatherIcon?.(satW.rain) || ''} ${satW.high}\u00B0/${satW.low}\u00B0${satW.rain !== undefined ? ` <span class="rain-percent">${satW.rain}%</span>` : ''}` : '';
            const sunInfo = sunW ? ` ${window.chooseWeatherIcon?.(sunW.rain) || ''} ${sunW.high}\u00B0/${sunW.low}\u00B0${sunW.rain !== undefined ? ` <span class="rain-percent">${sunW.rain}%</span>` : ''}` : '';
            hdr.innerHTML = `Weekend:<br>${satLabel} (${satDays})${satInfo}<br>${sunLabel} (${sunDays})${sunInfo}`;
            const highTemp2 = Math.max(satW?.high ?? -Infinity, sunW?.high ?? -Infinity);
            if (isFinite(highTemp2)) hdr.style.backgroundColor = tempToColor(highTemp2);
            section.appendChild(hdr);

            [satKey, key].forEach(k => {
                (byDate[k] || []).forEach(goal => {
                    const wrapper = makeGoalWrapper(goal);
                    const row = createGoalRow(goal, { hideScheduled: true, itemsRef: all });
                    wrapper.appendChild(row);

                    const childrenContainer = document.createElement('div');
                    childrenContainer.className = 'goal-children';
                    childrenContainer.style.display = openGoalIds.has(goal.id) ? 'block' : 'none';
                    wrapper.appendChild(childrenContainer);
                    renderChildren(goal, all, childrenContainer);

                    setupToggle(wrapper, row, childrenContainer, goal.id);
                    section.appendChild(wrapper);
                });
                delete byDate[k];
            });

            calendarContent.appendChild(section);
            d.setDate(d.getDate() + 1);
        } else {
            const header = document.createElement('h3');
            const dowLabel = d.toLocaleDateString(undefined, { weekday: 'short' });
            const dateStr = d.toLocaleDateString();
            const daysText = formatDaysUntil(key);
            const w = dailyWeather[key];
            const weatherInfo = w ? ` ${window.chooseWeatherIcon?.(w.rain) || ''} ${w.high}\u00B0/${w.low}\u00B0${w.rain !== undefined ? ` <span class="rain-percent">${w.rain}%</span>` : ''}` : '';
            header.innerHTML = `${dowLabel} ${dateStr} (${daysText})${weatherInfo}`;
            if (w) header.style.backgroundColor = tempToColor(w.high);
            calendarContent.appendChild(header);

            (byDate[key] || []).forEach(goal => {
                const wrapper = makeGoalWrapper(goal);
                const row = createGoalRow(goal, { hideScheduled: true, itemsRef: all });
                wrapper.appendChild(row);

                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'goal-children';
                childrenContainer.style.display = openGoalIds.has(goal.id) ? 'block' : 'none';
                wrapper.appendChild(childrenContainer);
                renderChildren(goal, all, childrenContainer);

                setupToggle(wrapper, row, childrenContainer, goal.id);
                calendarContent.appendChild(wrapper);
            });
            delete byDate[key];
            d.setDate(d.getDate() + 1);
        }
    }
}



async function renderRemainingGoals(all, sortedGoals, hiddenContent) {
    hiddenContent.innerHTML = '';
    const now = Date.now();
    const rendered = new Set();
    const completedWrappers = [];

    sortedGoals.forEach(goal => {
        if (rendered.has(goal.id)) return;
        rendered.add(goal.id);

        const wrapper = makeGoalWrapper(goal);
                const row = createGoalRow(goal, { hideScheduled: true, itemsRef: all });
        wrapper.appendChild(row);

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'goal-children';
        childrenContainer.style.display = openGoalIds.has(goal.id) ? 'block' : 'none';
        wrapper.appendChild(childrenContainer);
        renderChildren(goal, all, childrenContainer);

        setupToggle(wrapper, row, childrenContainer, goal.id);

        const hideUntil = goal.hiddenUntil ? Date.parse(goal.hiddenUntil) || 0 : 0;
        const isHidden = hideUntil && now < hideUntil;

        if (!goal.completed && !isHidden) {
            goalList.appendChild(wrapper);
        } else if (isHidden) {
            addHiddenControls(wrapper, row, goal, hiddenContent);
        } else {
            completedWrappers.push({ wrapper, date: goal.dateCompleted });
        }
    });

    completedWrappers
        .sort((a, b) => {
            const ad = Date.parse(a.date) || 0;
            const bd = Date.parse(b.date) || 0;
            return bd - ad;
        })
        .forEach(item => completedList.appendChild(item.wrapper));
}

function makeGoalWrapper(goal) {
    const wrapper = document.createElement('div');
    wrapper.className = 'decision goal-card';
    if (goal.doLater) wrapper.classList.add('do-later');
    wrapper.dataset.goalId = goal.id;
    wrapper.setAttribute('draggable', 'true');
    enableGoalDragAndDrop(wrapper);
    return wrapper;
}

function setupToggle(wrapper, row, childrenContainer, id) {
    const toggle = row.querySelector('.toggle-triangle');
    toggle.onclick = () => {
        const open = childrenContainer.style.display === 'block';
        toggle.textContent = open ? '▶' : '▼';
        childrenContainer.style.display = open ? 'none' : 'block';
        wrapper.setAttribute('draggable', open ? 'true' : 'false');
        open ? openGoalIds.delete(id) : openGoalIds.add(id);
    };
}



function addHiddenControls(wrapper, row, goal, hiddenContent) {
    const hideUntil = Date.parse(goal.hiddenUntil);

    const middle = row.querySelector('.middle-group');
    const buttonRow = row.querySelector('.button-row');

    const info = document.createElement('div');
    info.className = 'hidden-info';
    info.textContent = `Hidden until ${new Date(hideUntil).toLocaleString()}`;

    const unhideBtn = document.createElement('button');
    unhideBtn.type = 'button';
    unhideBtn.textContent = 'Unhide';
    Object.assign(unhideBtn.style, {
        background: '#88c', color: '#fff',
        border: '1px solid #88c', borderRadius: '4px',
        padding: '2px 6px', cursor: 'pointer', fontSize: '0.9em'
    });
    unhideBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const items = await loadDecisions();
        const idx = items.findIndex(d => d.id === goal.id);
        if (idx !== -1) {
            items[idx].hiddenUntil = null;
            await saveDecisions(items);
        }
    });

    if (buttonRow) {
        middle.insertBefore(info, buttonRow);
    } else {
        middle.appendChild(info);
    }
    middle.appendChild(unhideBtn);

    wrapper.classList.add('hidden-goal');
    hiddenContent.appendChild(wrapper);
}

function updateGoalCounts(items) {
    const now = Date.now();
    const rootGoals = items.filter(i => i.type === 'goal' && !i.parentGoalId);
    const active = rootGoals.filter(g => {
        const hideUntil = g.hiddenUntil ? Date.parse(g.hiddenUntil) || 0 : 0;
        return !g.completed && (!hideUntil || now >= hideUntil);
    }).length;
    const hidden = rootGoals.filter(g => {
        const hideUntil = g.hiddenUntil ? Date.parse(g.hiddenUntil) || 0 : 0;
        return hideUntil && now < hideUntil;
    }).length;
    const completed = rootGoals.filter(g => g.completed).length;

    const projectsHeader = document.getElementById('projectsHeader');
    if (projectsHeader) projectsHeader.textContent = `Projects (${active})`;
    const hiddenLabel = document.getElementById('hiddenLabel');
    if (hiddenLabel) hiddenLabel.textContent = `Hidden Projects (${hidden})`;
    const completedLabel = document.getElementById('completedLabel');
    if (completedLabel) completedLabel.textContent = ` Completed (${completed})`;
}

export function appendGoalToDOM(goal, allItems) {
    const wrapper = makeGoalWrapper(goal);
    const row = createGoalRow(goal, { hideScheduled: true, itemsRef: allItems });
    wrapper.appendChild(row);

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'goal-children';
    childrenContainer.style.display = openGoalIds.has(goal.id) ? 'block' : 'none';
    wrapper.appendChild(childrenContainer);
    renderChildren(goal, allItems, childrenContainer);

    const now = Date.now();
    const subs = allItems.filter(it =>
        it.parentGoalId === goal.id &&
        it.type === 'goal' &&
        !it.completed &&
        (!it.hiddenUntil || now >= (Date.parse(it.hiddenUntil) || 0))
    );
    setupToggle(wrapper, row, childrenContainer, goal.id);

    goalList.appendChild(wrapper);
    updateGoalCounts(allItems);
}

export function refreshGoalInDOM(goal, allItems) {
    const wrapper = document.querySelector(`[data-goal-id="${goal.id}"]`);
    if (!wrapper) return;

    const wasOpen = openGoalIds.has(goal.id);

    wrapper.innerHTML = '';
    wrapper.classList.toggle('do-later', !!goal.doLater);
    const row = createGoalRow(goal, { hideScheduled: true, itemsRef: allItems });
    wrapper.appendChild(row);

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'goal-children';
    childrenContainer.style.display = wasOpen ? 'block' : 'none';
    wrapper.appendChild(childrenContainer);
    renderChildren(goal, allItems, childrenContainer);
    setupToggle(wrapper, row, childrenContainer, goal.id);

    const hideUntil = goal.hiddenUntil ? Date.parse(goal.hiddenUntil) || 0 : 0;
    const isHidden = hideUntil && Date.now() < hideUntil;

    if (isHidden) {
        const hiddenContent = document.getElementById('hiddenContent');
        if (hiddenContent) addHiddenControls(wrapper, row, goal, hiddenContent);
    } else {
        const target = goal.parentGoalId
            ? document.querySelector(`[data-goal-id="${goal.parentGoalId}"] .goal-children`)
            : goalList;
        if (wrapper.parentElement !== target && target) {
            target.appendChild(wrapper);
        }
    }

    updateGoalCounts(allItems);
}

/**
 * Attach ✏️, 🕒, ❌ buttons to a goal-row.
 *
 * @param {Object} item         The goal object
 * @param {HTMLElement} buttonWrap  The .button-row container in the goal’s row
 */
function attachEditButtons(item, buttonWrap, row, itemsRef) {
    // ⬆️ Move goal up
    if (row) {
        const upBtn = makeIconBtn('⬆️', 'Move goal up', async () => {
            const wrapper = row.closest('.goal-card');
            const container = wrapper?.parentElement;
            if (!wrapper || !container) return;

            let prev = wrapper.previousElementSibling;
            while (prev && !prev.dataset.goalId) {
                prev = prev.previousElementSibling;
            }
            if (!prev) return;

            container.insertBefore(wrapper, prev);

            if (!item.parentGoalId) {
                const newOrder = [...goalList.children]
                    .map(el => el.dataset.goalId)
                    .filter(Boolean);
                await saveGoalOrder(newOrder);
            } else {
                const all = await loadDecisions();
                const siblings = all.filter(
                    d => d.parentGoalId === item.parentGoalId && d.type === 'goal' && !d.completed
                );
                const other = all.filter(
                    d => d.parentGoalId !== item.parentGoalId || d.type !== 'goal' || d.completed
                );
                const ids = [...container.children]
                    .filter(el => el.dataset.goalId)
                    .map(el => el.dataset.goalId);
                const reordered = ids
                    .map(id => siblings.find(g => g.id === id))
                    .filter(Boolean);
                const updated = [...other, ...reordered];
                await saveDecisions(updated);
                if (Array.isArray(itemsRef)) {
                    itemsRef.splice(0, itemsRef.length, ...updated);
                }
            }
        });
        buttonWrap.appendChild(upBtn);
    }

    // ✏️ Edit icon button
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.innerHTML = '✏️';
    editBtn.title = 'Edit';
    Object.assign(editBtn.style, {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: '1.2em'
    });
    buttonWrap.appendChild(editBtn);

    // 🕒 Hide select (only for incomplete goals)
    if (!item.completed) {
        const clockBtn = document.createElement('button');
        clockBtn.type = 'button';
        clockBtn.innerHTML = '🕒';
        clockBtn.title = 'Temporarily hide';
        Object.assign(clockBtn.style, {
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '1.2em'
        });
        buttonWrap.appendChild(clockBtn);

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
            // mark as a postpone‐menu button so global styles skip it
            btn.classList.add('postpone-option');

            // base styling
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

            // click handler
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const all = await loadDecisions();
                const idx = all.findIndex(d => d.id === item.id);
                if (idx === -1) return;
                let hideUntil;
                if (opt.value === 'date') {
                    const input = await pickDate('');
                    if (!input) return;
                    const dt = new Date(input);
                    if (isNaN(dt)) return;
                    hideUntil = dt.toISOString();
                } else {
                    hideUntil = new Date(
                        Date.now() + opt.value * 3600 * 1000
                    ).toISOString();
                }
                all[idx].hiddenUntil = hideUntil;
                await saveDecisions(all);
                menu.style.display = 'none';
                const wrapper = buttonWrap.closest('.decision.goal-card');
                if (wrapper) wrapper.style.display = 'none';
                updateGoalCounts(all);
            });

            menu.appendChild(btn);
        });


        clockBtn.addEventListener('click', e => {
            e.stopPropagation();
            const rect = clockBtn.getBoundingClientRect();
            menu.style.top = `${rect.bottom + window.scrollY}px`;
            menu.style.left = `${rect.left + window.scrollX}px`;
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', e => {
            if (!menu.contains(e.target) && e.target !== clockBtn) {
                menu.style.display = 'none';
            }
        });

        const laterBtn = makeIconBtn(
            '⏳',
            item.doLater ? 'Remove do later' : 'Mark as do later',
            async () => {
                const all = await loadDecisions();
                const idx = all.findIndex(d => d.id === item.id);
                if (idx === -1) return;
                const newState = !all[idx].doLater;
                all[idx].doLater = newState;
                await saveDecisions(all);
                item.doLater = newState;
                const wrapper = buttonWrap.closest('.decision.goal-card');
                const rowEl = buttonWrap.closest('.decision-row');
                if (rowEl) rowEl.style.background = '';
                if (wrapper) wrapper.classList.toggle('do-later', newState);
                refreshGoalInDOM(item, all);
            }
        );
        buttonWrap.appendChild(laterBtn);
    }

    // 📅 Schedule button
    const calendarBtn = makeIconBtn('📅', 'Add to calendar', async () => {
        const range = await pickDateRange(
            item.scheduled || new Date().toISOString().slice(0, 10),
            item.scheduledEnd || ''
        );
        if (!range.start) return;
        const all = await loadDecisions();
        const idx = all.findIndex(d => d.id === item.id);
        if (idx !== -1) {
            all[idx].scheduled = range.start.trim();
            all[idx].scheduledEnd = range.end.trim();
            await saveDecisions(all);
            item.scheduled = range.start.trim();
            item.scheduledEnd = range.end.trim();
            refreshGoalInDOM(item, all);
        }
    });
    buttonWrap.appendChild(calendarBtn);

    // ❌ Delete icon button for goals
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = '❌';
    deleteBtn.title = 'Delete';
    Object.assign(deleteBtn.style, {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: '1.2em'
    });
    buttonWrap.appendChild(deleteBtn);

    // Prevent clicks from interfering with drag
    [editBtn, deleteBtn].forEach(btn => {
        btn.addEventListener('mousedown', e => e.stopPropagation());
        btn.addEventListener('click', e => e.stopPropagation());
    });

    // **New delete handler: only remove this card**
    deleteBtn.addEventListener('click', async () => {
        if (!confirm(`Delete goal: "${item.text}"?`)) return;
        const all = await loadDecisions();
        const filtered = all.filter(d => d.id !== item.id && d.parentGoalId !== item.id);
        await saveDecisions(filtered);
        const wrapper = deleteBtn.closest('.decision.goal-card');
        if (wrapper) wrapper.remove();
        updateGoalCounts(filtered);
    });

    // ——————— “Edit” → “Save” in-place ———————
    let editing = false;
    editBtn.addEventListener('click', async () => {
        const row = editBtn.closest('.decision-row');
        const wrapper = editBtn.closest('.goal-card');
        const childrenContainer = wrapper?.querySelector('.goal-children');
        const middle = row.querySelector('.middle-group');
        const due = row.querySelector('.due-column');
        if (!middle || !due) return;

        if (!editing) {
            editing = true;
            editBtn.innerHTML = '💾';
            if (wrapper) {
                wrapper.setAttribute('draggable', 'false');
            }

            const textInput = document.createElement('input');
            const notesInput = document.createElement('textarea');
            const scheduledInput = document.createElement('input');
            const scheduledEndInput = document.createElement('input');
            const parentSelect = document.createElement('select');

            textInput.value = item.text;
            textInput.style.width = '100%';
            textInput.style.marginTop = '4px';

            notesInput.value = item.notes || '';
            notesInput.rows = 4; // give extra space for editing notes
            notesInput.style.width = '100%';
            notesInput.style.marginTop = '4px';

            scheduledInput.type = 'date';
            scheduledInput.value = item.scheduled || '';
            scheduledInput.style.width = '100%';

            scheduledEndInput.type = 'date';
            scheduledEndInput.value = item.scheduledEnd || '';
            scheduledEndInput.style.width = '100%';
            scheduledEndInput.style.marginTop = '4px';

            const allItems = await loadDecisions();
            const goals = allItems.filter(g =>
                g.type === 'goal' &&
                g.id !== item.id &&
                !g.completed // only active or hidden
            );
            const noneOpt = document.createElement('option');
            noneOpt.value = '';
            noneOpt.textContent = '(no parent)';
            parentSelect.appendChild(noneOpt);
            goals.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g.id;
                opt.textContent = g.text;
                if (g.id === item.parentGoalId) opt.selected = true;
                parentSelect.appendChild(opt);
            });
            parentSelect.style.marginLeft = '8px';
            parentSelect.style.width = '100%';

            const buttonWrap = row.querySelector('.button-row');

            middle.innerHTML = '';
            middle.appendChild(textInput);
            middle.appendChild(notesInput);

            due.innerHTML = '';
            due.appendChild(scheduledInput);
            due.appendChild(scheduledEndInput);
            due.appendChild(parentSelect);
            if (buttonWrap) {
                buttonWrap.style.marginTop = '6px';
                due.appendChild(buttonWrap);
            }
            row.classList.add('editing');

        } else {
            const newText = middle.querySelector('input')?.value.trim();
            const newNotes = middle.querySelector('textarea')?.value.trim();
            const [startInput, endInput] = due.querySelectorAll('input');
            const newScheduled = startInput?.value.trim();
            const newScheduledEnd = endInput?.value.trim();
            const newParent = due.querySelector('select')?.value || null;

            const all = await loadDecisions();
            const idx = all.findIndex(d => d.id === item.id);
            if (idx !== -1) {
                if (newParent && all.find(g => g.id === newParent)?.parentGoalId === item.id) {
                    alert('Cannot create circular parent relationship.');
                    return;
                }
                editing = false;
                const needsMove =
                    all[idx].parentGoalId !== (newParent || null) ||
                    all[idx].scheduled !== newScheduled ||
                    (all[idx].scheduledEnd || '') !== newScheduledEnd;
                all[idx].text = newText;
                all[idx].notes = newNotes;
                    all[idx].scheduled = newScheduled;
                    all[idx].scheduledEnd = newScheduledEnd;
                    all[idx].parentGoalId = newParent || null;
                    await saveDecisions(all);

                // update DOM if staying in place
                if (!needsMove) {
                    item.text = newText;
                    item.notes = newNotes;
                    item.scheduled = newScheduled;
                    item.scheduledEnd = newScheduledEnd;
                    item.parentGoalId = newParent || null;

                    const buttonWrap = row.querySelector('.button-row');

                    middle.innerHTML = '';
                    const titleDiv = document.createElement('div');
                    titleDiv.innerHTML = linkify(newText);
                    middle.appendChild(titleDiv);
                    if (newNotes) {
                        const noteDiv = document.createElement('div');
                        noteDiv.className = 'note-text';
                        noteDiv.innerHTML = linkify(newNotes);
                        middle.appendChild(noteDiv);
                    }
                    if (buttonWrap) middle.appendChild(buttonWrap);

                    due.innerHTML = '';
                    const rangeText = newScheduledEnd && newScheduledEnd !== newScheduled
                        ? `${newScheduled} - ${newScheduledEnd}`
                        : (newScheduled || '');
                    let dueContent = item.completed ? item.dateCompleted : rangeText;
                    due.innerHTML = dueContent;
                } else {
                    item.text = newText;
                    item.notes = newNotes;
                    item.scheduled = newScheduled;
                    item.scheduledEnd = newScheduledEnd;
                    item.parentGoalId = newParent || null;
                    refreshGoalInDOM(item, all);
                }
            }

            row.classList.remove('editing');
            editBtn.innerHTML = '✏️';
            if (wrapper) {
                const open = childrenContainer && childrenContainer.style.display === 'block';
                wrapper.setAttribute('draggable', open ? 'false' : 'true');
            }
        }
    });
}
