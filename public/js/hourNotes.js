import { SAMPLE_HOUR_NOTES } from './sampleData.js';
import { getCurrentUser } from './auth.js';

const NOTES_KEY = 'hourNotes';

function shiftSampleHourNotes(notes) {
  const today = new Date();
  const dates = Object.keys(notes)
    .map(d => new Date(d))
    .filter(d => !isNaN(d));
  if (!dates.length) return notes;
  const earliest = dates.sort((a, b) => a - b)[0];
  if (earliest > today) return notes;
  const shiftDays = Math.ceil((today - earliest) / 86400000) + 1;
  const shifted = {};
  Object.entries(notes).forEach(([date, hours]) => {
    const d = new Date(date);
    if (isNaN(d)) return;
    d.setDate(d.getDate() + shiftDays);
    shifted[d.toISOString().slice(0, 10)] = hours;
  });
  return shifted;
}

export function loadHourNotes() {
  try {
    const stored = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}');
    if (stored && Object.keys(stored).length) return stored;
  } catch {}

  const current = getCurrentUser?.();
  if (current) {
    return {};
  }

  const sample = shiftSampleHourNotes(SAMPLE_HOUR_NOTES);
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(sample));
  } catch {}
  return sample;
}

export function saveHourNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes || {}));
}
