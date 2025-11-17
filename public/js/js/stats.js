// File: stats.js

import { auth, db, getCurrentUser } from './auth.js';
import { SAMPLE_METRICS, SAMPLE_METRIC_DATA } from './sampleData.js';
import { makeIconBtn } from './helpers.js';

const METRICS_KEY = 'metricsConfig';
const STATS_KEY = 'metricsData';

// Currently selected date for metrics UI
let activeMetricsDate = todayKey();

/**
 * Returns today’s date key in YYYY-MM-DD using local time.
 */
function todayKey() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftSampleMetricData(data) {
  const today = new Date();
  const dates = Object.keys(data)
    .map(k => new Date(k))
    .filter(d => !isNaN(d));
  if (!dates.length) return data;
  const last = dates.sort((a, b) => b - a)[0];
  const diffDays = Math.round((today.setHours(0, 0, 0, 0) - last.setHours(0, 0, 0, 0)) / 86400000);
  if (!diffDays) return data;
  const msShift = diffDays * 86400000;
  const shifted = {};
  Object.keys(data).forEach(key => {
    const date = new Date(key);
    date.setDate(date.getDate() + diffDays);
    const newKey = date.toISOString().split('T')[0];
    const metrics = {};
    Object.keys(data[key]).forEach(id => {
      metrics[id] = data[key][id].map(entry => ({
        ...entry,
        timestamp: entry.timestamp + msShift
      }));
    });
    shifted[newKey] = metrics;
  });
  return shifted;
}

async function ensureDefaultMetrics() {
  const user = getCurrentUser();
  if (!user) {
    const stored = JSON.parse(localStorage.getItem(METRICS_KEY) || 'null');
    const updated = Array.isArray(stored) && stored.length ? stored : SAMPLE_METRICS.slice();
    updated.forEach(m => { if (!('direction' in m)) m.direction = 'higher'; applyUnitLabels(m); });
    localStorage.setItem(METRICS_KEY, JSON.stringify(updated));
    return updated;
  }

  const docRef = db.collection('users').doc(user.uid).collection('settings').doc('metricsConfig');
  const snap = await docRef.get();
  const current = snap.exists ? snap.data().metrics || [] : [];
  const updated = current;
  if (!snap.exists) {
    await docRef.set({ metrics: updated }, { merge: true });
  }
  updated.forEach(m => {
    if (!('direction' in m)) m.direction = 'higher';
    applyUnitLabels(m);
  });
  return updated;
}




/** FIRESTORE LOADERS & SAVERS **/
async function loadMetricsConfig() {
  const user = auth.currentUser;
  if (!user) {
    const stored = JSON.parse(localStorage.getItem(METRICS_KEY) || 'null');
    return Array.isArray(stored) && stored.length ? stored : SAMPLE_METRICS.slice();
  }
  const snap = await db
    .collection('users').doc(user.uid)
    .collection('settings').doc('metricsConfig')
    .get();
  let cfg = snap.exists ? snap.data().metrics : [];
  cfg = cfg.map(m => {
    if (m && m.hiddenUntil && typeof m.hiddenUntil.toDate === 'function') {
      return { ...m, hiddenUntil: m.hiddenUntil.toDate().toISOString() };
    }
    return m;
  });
  return cfg;
}

async function saveMetricsConfig(metrics) {
  await safeSaveMetricsConfig(() => metrics);
}

/**
 * Safely saves metricsConfig by merging into the existing doc.
 *
 * @param {(oldCfg: Array) => Array} merger
 *   A function that receives the *existing* metrics array and returns the new one.
 */
async function safeSaveMetricsConfig(merger) {
  const user = getCurrentUser();
  if (!user) {
    const old = JSON.parse(localStorage.getItem(METRICS_KEY) || '[]');
    const updated = merger(old.slice());
    localStorage.setItem(METRICS_KEY, JSON.stringify(updated));
    return;
  }

  // 1) Load whatever is currently saved
  const docRef = db
    .collection('users').doc(user.uid)
    .collection('settings').doc('metricsConfig');
  const snap = await docRef.get();
  const oldMetrics = snap.exists ? snap.data().metrics || [] : [];

  // 2) Let caller produce the updated array
  const newMetrics = merger(oldMetrics.slice());

  // 3) Only write *if* something actually changed
  const same =
    oldMetrics.length === newMetrics.length &&
    oldMetrics.every((m, i) => JSON.stringify(m) === JSON.stringify(newMetrics[i]));
  if (same) return;

  // 4) Merge-write back your new array
  await docRef.set({ metrics: newMetrics }, { merge: true });
}

/**
 * Save a metric entry (with local-date key) for the current user.
 *
 * @param {string} metricId
 * @param {number|string} value
 * @param {any} extra
 */
async function recordMetric(metricId, value, extra = null, dayKey = activeMetricsDate) {
  const user = getCurrentUser();
  const entry = {
    timestamp: Date.now(),
    value,
    extra
  };

  const isPostponed = extra && extra.postponed;

  if (!user) {
    let all = JSON.parse(localStorage.getItem(STATS_KEY) || 'null');
    if (!all || !Object.keys(all).length) {
      all = shiftSampleMetricData(JSON.parse(JSON.stringify(SAMPLE_METRIC_DATA)));
    } else if (!all[todayKey()]) {
      const shifted = shiftSampleMetricData(JSON.parse(JSON.stringify(SAMPLE_METRIC_DATA)));
      all[todayKey()] = shifted[todayKey()];
    }
    const day = dayKey;
    all[day] = all[day] || {};
    if (isPostponed) {
      const arr = all[day][metricId] || [];
      arr.push(entry);
      all[day][metricId] = arr;
    } else {
      all[day][metricId] = [entry];
    }
    localStorage.setItem(STATS_KEY, JSON.stringify(all));
    return;
  }

  // Use local-date key for grouping
  const ref = db
    .collection('users').doc(user.uid)
    .collection('dailyStats').doc(dayKey);
  try {
    if (isPostponed) {
      const snap = await ref.get();
      const prev = snap.exists && snap.data().metrics && Array.isArray(snap.data().metrics[metricId])
        ? snap.data().metrics[metricId]
        : [];
      await ref.set({
        metrics: {
          [metricId]: [...prev, entry]
        }
      }, { merge: true });
    } else {
      await ref.set({
        metrics: {
          [metricId]: [entry]
        }
      }, { merge: true });
    }
  } catch (err) {
    console.warn('Falling back to local metric cache:', err);
    const all = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
    const day = dayKey;
    all[day] = all[day] || {};
    if (isPostponed) {
      const arr = all[day][metricId] || [];
      arr.push(entry);
      all[day][metricId] = arr;
    } else {
      all[day][metricId] = [entry];
    }
    localStorage.setItem(STATS_KEY, JSON.stringify(all));
  }
}

async function deleteMetricEntry(metricId, dayKey, index) {
  const user = getCurrentUser();
  if (!user) {
    const all = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
    if (all[dayKey] && Array.isArray(all[dayKey][metricId])) {
      all[dayKey][metricId].splice(index, 1);
      if (!all[dayKey][metricId].length) {
        delete all[dayKey][metricId];
        if (!Object.keys(all[dayKey]).length) delete all[dayKey];
      }
      localStorage.setItem(STATS_KEY, JSON.stringify(all));
    }
    return;
  }
  const ref = db
    .collection('users').doc(user.uid)
    .collection('dailyStats').doc(dayKey);
  const snap = await ref.get();
  const data = snap.exists && snap.data().metrics ? snap.data().metrics : {};
  const arr = Array.isArray(data[metricId]) ? data[metricId].slice() : [];
  if (index < 0 || index >= arr.length) return;
  arr.splice(index, 1);
  await ref.set({ metrics: { [metricId]: arr } }, { merge: true });
}

async function loadAllStats() {
  const user = auth.currentUser;
  if (!user) {
    let stored = JSON.parse(localStorage.getItem(STATS_KEY) || 'null');
    if (!stored || !Object.keys(stored).length) {
      stored = shiftSampleMetricData(JSON.parse(JSON.stringify(SAMPLE_METRIC_DATA)));
      localStorage.setItem(STATS_KEY, JSON.stringify(stored));
    } else if (!stored[todayKey()]) {
      const shifted = shiftSampleMetricData(JSON.parse(JSON.stringify(SAMPLE_METRIC_DATA)));
      stored[todayKey()] = shifted[todayKey()];
      localStorage.setItem(STATS_KEY, JSON.stringify(stored));
    }
    return stored;
  }
  try {
    const snaps = await db
      .collection('users').doc(user.uid)
      .collection('dailyStats')
      .get();
    const out = {};
    snaps.forEach(doc => out[doc.id] = doc.data().metrics || {});
    return out;
  } catch (err) {
    console.warn('Failed to load stats from Firestore, using cache:', err);
    return JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
  }
}

function computeRank(val, allValues, direction) {
  if (!allValues.length) return '—';
  const dir = (direction || '').toLowerCase();
  const numeric = allValues
    .map(v => typeof v === 'string' ? parseFloat(v) : v)
    .filter(v => typeof v === 'number' && !isNaN(v));
  val = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(val) || !numeric.length) return '—';
  const sorted = numeric.slice().sort((a, b) => dir === 'lower' ? a - b : b - a);
  const index = sorted.findIndex(v => v === val);
  return index >= 0 ? `${index + 1}/${sorted.length}` : '—';
}




/** PERCENTILE & SUMMARY RENDER **/
function computePercentile(val, allValues) {
  const numeric = allValues
    .map(v => typeof v === 'string' ? parseFloat(v) : v)
    .filter(v => typeof v === 'number' && !isNaN(v));
  val = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(val) || !numeric.length) return 0;
  const sorted = numeric.slice().sort((a, b) => a - b);
  const below = sorted.filter(v => v < val).length;
  return Math.round((below / sorted.length) * 100);
}

function applyUnitLabels(cfg) {
  cfg.unitLabel = {
    pounds: 'pounds',
    rating: 'rating out of 10',
    minutes: 'minutes',
    time_mmss: 'minutes and seconds',
    list: 'list',
    count: 'count'
  }[cfg.unit] || cfg.unit;
}

function summarizeListValue(str) {
  const lines = String(str)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  if (!lines.length) return 0;
  const nums = lines.map(l => parseFloat(l));
  return nums.every(n => !isNaN(n))
    ? nums.reduce((sum, n) => sum + n, 0)
    : lines.length;
}

let metricChartInstance = null;

function updateMetricsDateUI() {
  const lbl = document.getElementById('metricsDateLabel');
  const prev = document.getElementById('metricPrevDayBtn');
  const next = document.getElementById('metricNextDayBtn');
  if (lbl) lbl.textContent = activeMetricsDate;
  if (prev) prev.disabled = false;
  if (next) next.disabled = activeMetricsDate === todayKey();
}

function changeMetricsDate(delta) {
  const d = new Date(activeMetricsDate);
  d.setDate(d.getDate() + delta);
  const newKey = d.toISOString().split('T')[0];
  if (newKey > todayKey()) return;
  activeMetricsDate = newKey;
  updateMetricsDateUI();
  renderStatsSummary();
}

async function showMetricGraph(cfg) {
  const allStats = await loadAllStats();
  const labels = [];
  const data = [];
  // Gather raw metric values by date
  Object.keys(allStats).sort().forEach(date => {
    const entries = (allStats[date][cfg.id] || []).filter(e => !(e.extra && e.extra.postponed));
    if (!entries.length) return;
    const latest = entries.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
    let val = latest.value;
    if (cfg.unit === 'list' && typeof val === 'string') {
      val = summarizeListValue(val);
    }
    labels.push(date);
    data.push(val);
  });

  // Calculate 7-day rolling average
  const rolling = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - 6);
    const window = data.slice(start, i + 1).filter(v => typeof v === 'number' && !isNaN(v));
    if (window.length) {
      const avg = window.reduce((sum, v) => sum + v, 0) / window.length;
      rolling.push(avg);
    } else {
      rolling.push(null);
    }
  }

  const modal = document.getElementById('metricChartModal');
  const canvas = document.getElementById('metricChartCanvas');
  if (metricChartInstance) metricChartInstance.destroy();
  metricChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: cfg.label,
          data,
          fill: false,
          borderColor: '#3e95cd'
        },
        {
          label: '7-day Avg',
          data: rolling,
          fill: false,
          borderColor: '#e96d06',
          borderDash: [5, 5]
        }
      ]
    },
    options: { responsive: true }
  });
  modal.style.display = 'flex';
}

async function showMetricValues(cfg) {
  const allStats = await loadAllStats();
  const entries = [];
  Object.keys(allStats).forEach(day => {
    const arr = allStats[day][cfg.id] || [];
    arr.forEach((entry, idx) => {
      entries.push({ day, entry, index: idx });
    });
  });
  entries.sort((a, b) => b.entry.timestamp - a.entry.timestamp);
  const list = document.getElementById('metricValuesList');
  list.innerHTML = '';
  entries.forEach(({ day, entry, index }) => {
    let display = entry.value;
    if (cfg.unit === 'time_mmss') {
      const m = Math.floor(display);
      const s = String(Math.round((display - m) * 60)).padStart(2, '0');
      display = `${m}:${s}`;
    }
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' });
    const txt = document.createElement('span');
    txt.textContent = `${day} – ${display}`;
    if (cfg.unit === 'list' && typeof entry.value === 'string') txt.style.whiteSpace = 'pre-wrap';
    row.appendChild(txt);
    const del = document.createElement('span');
    del.textContent = '❌';
    del.style.cursor = 'pointer';
    del.addEventListener('click', async () => {
      await deleteMetricEntry(cfg.id, day, index);
      await showMetricValues(cfg);
      await renderStatsSummary();
    });
    row.appendChild(del);
    list.appendChild(row);
  });
  if (!entries.length) {
    const none = document.createElement('div');
    none.textContent = 'No entries';
    list.appendChild(none);
  }
  const modal = document.getElementById('metricValuesModal');
  modal.style.display = 'flex';
}

async function renderStatsSummary(dayKey = activeMetricsDate) {
  const config = await loadMetricsConfig();
  config.forEach(cfg => {
    if (!('direction' in cfg)) cfg.direction = 'higher';
    applyUnitLabels(cfg);
  });
  const allStats = await loadAllStats();
  const unitByMetric = config.reduce((a, m) => (a[m.id] = m.unit, a), {});
  const valuesByMetric = {}, lastEntryByMetric = {};
  Object.values(allStats).forEach(day => {
    Object.entries(day).forEach(([id, entries]) => {
      entries.filter(e => !(e.extra && e.extra.postponed)).forEach(entry => {
        let v = entry.value;
        if (unitByMetric[id] === 'list' && typeof v === 'string') {
          v = summarizeListValue(v);
        }
        (valuesByMetric[id] = valuesByMetric[id] || []).push(v);
        const ts = entry.timestamp || 0;
        if (!lastEntryByMetric[id] || ts > lastEntryByMetric[id]) {
          lastEntryByMetric[id] = ts;
        }
      });
    });
  });
  config.sort((a, b) => {
    const tsA = lastEntryByMetric[a.id] || 0;
    const tsB = lastEntryByMetric[b.id] || 0;
    return tsA - tsB;
  });
  const container = document.getElementById('genericStatsSummary');
  if (!container) return;
  Object.assign(container.style, { width: '100%', maxWidth: '100%', padding: '0', margin: '0' });
  container.innerHTML = '';
  const table = document.createElement('table');
  Object.assign(table.style, { width: '100%', borderCollapse: 'collapse', marginTop: '16px' });
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  // header row
  ['Metric', 'Value', 'Rank', 'Percentile', 'Average', 'Actions'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    Object.assign(th.style, { borderBottom: '2px solid #444', textAlign: 'left', padding: '8px' });
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  const today = dayKey;
  let visible = 0, filled = 0;
  for (const cfg of config) {
    if (cfg.hiddenUntil && Date.now() < Date.parse(cfg.hiddenUntil)) {
      continue;
    }
    const entries = ((allStats[today] || {})[cfg.id]) || [];
    const validEntries = entries.filter(e => !(e.extra && e.extra.postponed));
    const wasPostponed = entries.some(e => e.extra && e.extra.postponed);

    // Hide metrics that were postponed for today until the next day
    if (today === todayKey() && wasPostponed && !validEntries.length) {
      continue;
    }

    visible++;
    let display = '—', editValue = '', pct = '—', rank = '—', pctValue = null;
    const latestEntry = entries.reduce((a, b) => (!a || a.timestamp < b.timestamp) ? b : a, null);
    if (validEntries.length) {
      filled++;
      const latest = validEntries.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
      let val;
      if (cfg.unit === 'time_mmss') {
        const m = Math.floor(latest.value), s = String(Math.round((latest.value - m) * 60)).padStart(2, '0');
        display = `${m}:${s}`;
        editValue = display;
        val = latest.value;
      } else if (cfg.unit === 'list' && typeof latest.value === 'string') {
        const listVal = summarizeListValue(latest.value);
        display = String(listVal);
        editValue = latest.value;
        val = listVal;
      } else {
        display = `${latest.value}`;
        editValue = display;
        val = latest.value;
      }
      const allVals = valuesByMetric[cfg.id] || [];
      const raw = computePercentile(val, allVals);
      pctValue = cfg.direction === 'lower' ? 100 - raw : raw;
      pct = `${pctValue}th`;
      rank = computeRank(val, allVals, cfg.direction);
    } else if (wasPostponed && latestEntry && latestEntry.value != null) {
      // show the postponed value but exclude it from stats
      if (cfg.unit === 'time_mmss') {
        const m = Math.floor(latestEntry.value), s = String(Math.round((latestEntry.value - m) * 60)).padStart(2, '0');
        display = `${m}:${s}`;
        editValue = display;
      } else if (cfg.unit === 'list' && typeof latestEntry.value === 'string') {
        const listVal = summarizeListValue(latestEntry.value);
        display = String(listVal);
        editValue = latestEntry.value;
      } else {
        display = `${latestEntry.value}`;
        editValue = display;
      }
    }
    const row = document.createElement('tr');
    row.dataset.metricId = cfg.id;
    const lastTs = lastEntryByMetric[cfg.id];
    const daysSince = lastTs ? (Date.now() - lastTs) / 86400000 : Infinity;
    const intensity = Math.min(daysSince / 7, 1);
    row.style.backgroundColor = `rgba(255,165,0,${intensity})`;
    const td1 = document.createElement('td');
    td1.textContent = cfg.label;
    td1.dataset.label = 'Metric';
    Object.assign(td1.style, { padding: '8px', borderBottom: '1px solid #ddd', cursor: 'pointer', textDecoration: 'underline' });
    td1.addEventListener('click', () => showMetricGraph(cfg));
    row.appendChild(td1);
    // inside renderStatsSummary(), in the Today’s Value cell:
    const td2 = document.createElement('td');
    Object.assign(td2.style, { padding: '8px', borderBottom: '1px solid #ddd' });
    td2.dataset.label = 'Value';
    const span = document.createElement('span');
    span.textContent = `${display} ${cfg.unitLabel}`;
    if (cfg.unit === 'list' && editValue) span.title = editValue;
    span.style.marginRight = '8px';
    span.style.cursor = 'pointer';
    span.addEventListener('click', () => showMetricValues(cfg));
    td2.appendChild(span);
    const valueEdit = document.createElement('span');
    valueEdit.textContent = '✏️';
    valueEdit.style.cursor = 'pointer';
    valueEdit.addEventListener('click', async () => {
      td2.innerHTML = '';
      let inp;
      if (cfg.unit === 'rating') {
        inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '1';
        inp.max = '10';
        inp.step = '1';
        inp.placeholder = '1–10';
      } else if (cfg.unit === 'list') {
        inp = document.createElement('textarea');
        inp.rows = 4;
        inp.style.width = '100%';
        inp.placeholder = cfg.unitLabel;
      } else {
        inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = cfg.unitLabel;
      }
      inp.value = editValue;
      td2.appendChild(inp);
      inp.focus();
      const saveIcon = document.createElement('span');
      saveIcon.textContent = '💾';
      saveIcon.style.cursor = 'pointer';
      saveIcon.style.marginLeft = '8px';
      saveIcon.addEventListener('click', async () => {
        const raw = inp.value.trim();
        let v;
        if (!raw) return alert('Enter a value');
        if (cfg.unit === 'time_mmss') {
          const [m, s] = raw.split(':').map(n => parseInt(n, 10));
          if (isNaN(m) || isNaN(s)) return alert('Bad MM:SS');
          v = m + s / 60;
        } else if (cfg.unit === 'rating') {
          v = parseInt(raw, 10);
          if (isNaN(v) || v < 1 || v > 10) return alert('Enter 1–10');
        } else if (cfg.unit === 'list') {
          v = raw;
        } else {
          v = parseFloat(raw);
          if (isNaN(v)) return alert('Invalid number');
        }
        await recordMetric(cfg.id, v, null, activeMetricsDate);
        await renderStatsSummary();
      });
      td2.appendChild(saveIcon);
      const cancel = document.createElement('span');
      cancel.textContent = '❌';
      cancel.style.cursor = 'pointer';
      cancel.style.marginLeft = '4px';
      cancel.addEventListener('click', () => renderStatsSummary());
      td2.appendChild(cancel);
    });
    td2.appendChild(valueEdit);
    row.appendChild(td2);

    const td3 = document.createElement('td');
    td3.textContent = rank;
    td3.dataset.label = 'Rank';
    Object.assign(td3.style, { padding: '8px', borderBottom: '1px solid #ddd' });
    row.appendChild(td3);
    const td4 = document.createElement('td');
    td4.textContent = pct;
    td4.dataset.label = 'Percentile';
    Object.assign(td4.style, { padding: '8px', borderBottom: '1px solid #ddd' });
    row.appendChild(td4);
    const rawVals = valuesByMetric[cfg.id] || [];
    const numericVals = rawVals.filter(v => typeof v === 'number' && !isNaN(v));
    let avg = '—';
    if (numericVals.length) {
      const sum = numericVals.reduce((s, v) => s + v, 0);
      const denom = numericVals.length;
      avg = (sum / denom).toFixed(2);
    }
    const tdAvg = document.createElement('td');
    tdAvg.textContent = avg;
    tdAvg.dataset.label = 'Average';
    Object.assign(tdAvg.style, { padding: '8px', borderBottom: '1px solid #ddd' });
    row.appendChild(tdAvg);

    const tdActions = document.createElement('td');
    tdActions.dataset.label = 'Actions';
    Object.assign(tdActions.style, { padding: '8px', borderBottom: '1px solid #ddd' });

    const upBtn = makeIconBtn('⬆️', 'Move metric up', async () => {
      const prev = row.previousElementSibling;
      if (prev) {
        tbody.insertBefore(row, prev);
        const ids = Array.from(tbody.children).map(r => r.dataset.metricId);
        await safeSaveMetricsConfig(oldCfg => {
          const ordered = ids.map(id => oldCfg.find(m => m.id === id)).filter(Boolean);
          const remaining = oldCfg.filter(m => !ids.includes(m.id));
          return [...ordered, ...remaining];
        });
      }
    });
    tdActions.appendChild(upBtn);

    const clockBtn = makeIconBtn('🕒', 'Postpone', () => {});
    clockBtn.style.marginLeft = '8px';
    tdActions.appendChild(clockBtn);

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
      { label: '3 months', value: 2160 }
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
        const allCfg = await loadMetricsConfig();
        const idx = allCfg.findIndex(m => m.id === cfg.id);
        if (idx !== -1) {
          allCfg[idx].hiddenUntil = new Date(Date.now() + opt.value * 3600 * 1000).toISOString();
          await saveMetricsConfig(allCfg);
        }
        menu.style.display = 'none';
        await renderStatsSummary();
      });
      menu.appendChild(btn);
    });

    clockBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (menu.style.display === 'block') {
        menu.style.display = 'none';
        return;
      }
      menu.style.display = 'block';
      const rect = clockBtn.getBoundingClientRect();
      menu.style.top = `${rect.bottom + window.scrollY}px`;
      let left = rect.left - menu.offsetWidth + window.scrollX;
      if (left < 0) left = 0;
      menu.style.left = `${left}px`;
    });

    document.addEventListener('click', e => {
      if (!menu.contains(e.target) && e.target !== clockBtn) {
        menu.style.display = 'none';
      }
    });
    const configEdit = makeIconBtn('✏️', 'Edit metric', () => {
      renderConfigForm();
      openMetricsConfigForm(cfg);
    });
    configEdit.style.marginLeft = '8px';
    tdActions.appendChild(configEdit);

    const del = makeIconBtn('❌', 'Delete metric', async () => {
      await saveMetricsConfig((await loadMetricsConfig()).filter(m => m.id !== cfg.id));
      await renderConfigForm();
      await renderStatsSummary();
    });
    del.style.marginLeft = '8px';
    tdActions.appendChild(del);

    row.appendChild(tdActions);

    if (pctValue !== null) {
      row.style.background = `linear-gradient(to right, rgba(0,128,0,0.15) ${pctValue}%, transparent ${pctValue}%)`;
    }

    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  container.appendChild(table);
  if (visible && visible === filled) {
    table.classList.add('all-complete');
    setTimeout(() => table.classList.remove('all-complete'), 2500);
  }
}



async function renderConfigForm() {
  let config = await loadMetricsConfig();
  config = await ensureDefaultMetrics();
  config.forEach(m => { if (!('direction' in m)) m.direction = 'higher'; applyUnitLabels(m); });

  const section = document.getElementById('metricsConfigSection');
  if (!section) return;
  section.innerHTML = '<div id="configFormContainer" style="display:none;"></div>';
}

function openMetricsConfigForm(metricToEdit = null) {
  const formContainer = document.getElementById('configFormContainer');
  if (!formContainer) return;
  const labelVal = metricToEdit ? metricToEdit.label : '';
  const unitVal = metricToEdit ? metricToEdit.unit : 'pounds';
  const dirVal = metricToEdit ? metricToEdit.direction : 'higher';

  formContainer.innerHTML =
    `<form id="configForm">` +
    `<input type="text" id="metricLabel" value="${labelVal}" required style="margin-right:8px;">` +
    `<select id="metricUnit" required style="margin:0 8px;">` +
    `<option value="pounds"${unitVal === 'pounds' ? ' selected' : ''}>pounds</option>` +
    `<option value="rating"${unitVal === 'rating' ? ' selected' : ''}>rating out of 10</option>` +
    `<option value="minutes"${unitVal === 'minutes' ? ' selected' : ''}>minutes</option>` +
    `<option value="time_mmss"${unitVal === 'time_mmss' ? ' selected' : ''}>MM:SS</option>` +
    `<option value="list"${unitVal === 'list' ? ' selected' : ''}>list</option>` +
    `<option value="count"${unitVal === 'count' ? ' selected' : ''}>count</option>` +
    `</select>` +
    `<select id="metricDirection" required style="margin:0 8px;">` +
    `<option value="higher"${dirVal === 'higher' ? ' selected' : ''}>Higher is better</option>` +
    `<option value="lower"${dirVal === 'lower' ? ' selected' : ''}>Lower is better</option>` +
    `</select>` +
    `<button type="submit">${metricToEdit ? 'Save Changes' : 'Add Metric'}</button>` +
    `<button type="button" id="cancelConfig" style="margin-left:8px;">✖️</button>` +
    `</form>`;

  formContainer.style.display = 'block';
  const labelInput = document.getElementById('metricLabel');
  labelInput.focus();

  document.getElementById('cancelConfig').addEventListener('click', () => {
    formContainer.style.display = 'none';
    formContainer.innerHTML = '';
  });

  document.getElementById('configForm').addEventListener('submit', async e => {
    e.preventDefault();
    const label = document.getElementById('metricLabel').value.trim();
    const unit = document.getElementById('metricUnit').value;
    const dir = document.getElementById('metricDirection').value;
    if (!label || !unit || !dir) return alert('Please enter all fields');
    const id = metricToEdit ? metricToEdit.id : label.toLowerCase().replace(/\W+/g, '_');
    const newMetric = { id, label, unit, direction: dir };
    const oldCfg = await loadMetricsConfig();
    const filtered = oldCfg.filter(m => m.id !== id);
    await saveMetricsConfig([...filtered, newMetric]);
    formContainer.style.display = 'none';
    formContainer.innerHTML = '';
    await renderConfigForm();
    await renderStatsSummary();
  });
}

export async function initMetricsUI() {
  activeMetricsDate = todayKey();
  updateMetricsDateUI();
  const prev = document.getElementById('metricPrevDayBtn');
  const next = document.getElementById('metricNextDayBtn');
  if (prev && !prev.dataset.bound) {
    prev.addEventListener('click', () => changeMetricsDate(-1));
    prev.dataset.bound = '1';
  }
  if (next && !next.dataset.bound) {
    next.addEventListener('click', () => changeMetricsDate(1));
    next.dataset.bound = '1';
  }
  await ensureDefaultMetrics();
  await renderStatsSummary();
  await renderConfigForm();
}

auth.onAuthStateChanged(user => {
  if (!user) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMetricsUI);
  } else {
    initMetricsUI();
  }
});

window._statsDebug = {
  loadMetricsConfig,
  renderStatsSummary,
  renderConfigForm,
  loadAllStats
};

const metricModal = document.getElementById('metricChartModal');
if (metricModal) {
  metricModal.addEventListener('click', e => {
    if (e.target === metricModal) metricModal.style.display = 'none';
  });
}

const metricValuesModal = document.getElementById('metricValuesModal');
if (metricValuesModal) {
  metricValuesModal.addEventListener('click', e => {
    if (e.target === metricValuesModal) metricValuesModal.style.display = 'none';
  });
}

window.initMetricsUI = initMetricsUI;
window.openMetricsConfigForm = openMetricsConfigForm;
