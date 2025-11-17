import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../js/dragAndDrop.js', () => ({
  initializeGlobalDragHandlers: vi.fn(),
  enableGoalDragAndDrop: vi.fn()
}));

vi.mock('../js/tasks.js', () => ({
  attachTaskButtons: vi.fn(),
  renderChildren: vi.fn()
}));

// Simple localStorage mock for Node environment
const storage = (() => {
  let store = {};
  return {
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();
global.localStorage = storage;
vi.mock('../js/helpers.js', () => ({
  loadDecisions: vi.fn(),
  saveDecisions: vi.fn(),
  saveGoalOrder: vi.fn(),
  generateId: vi.fn(),
  pickDate: vi.fn(async () => ''),
  pickDateRange: vi.fn(async () => ({ start: null, end: null })),
  makeIconBtn: () => document.createElement('button'),
  formatDaysUntil: () => '',
  linkify: (t) => t
}));
vi.mock('../js/goals.js', async () => {
  const actual = await vi.importActual('../js/goals.js');
  return { ...actual, renderGoalsAndSubitems: vi.fn() };
});
vi.mock('../js/auth.js', () => ({ db: {}, auth: { onAuthStateChanged: vi.fn() }, getCurrentUser: () => null }));

let renderTodaySchedule;
let helpers;

beforeEach(async () => {
  vi.resetModules();
  const html = `
    <div id="goalList"></div>
    <div id="completedList"></div>
    <div id="calendarPanel"><div class="right-column"></div></div>
    <div id="calendarContent"></div>
    <div id="test"></div>
  `;
  const today = new JSDOM(html);
  global.window = today.window;
  global.document = today.window.document;
  global.firebase = { auth: () => ({ currentUser: null }) };
  const mod = await import('../js/goals.js');
  renderTodaySchedule = mod.renderTodaySchedule;
  helpers = await import('../js/helpers.js');
});

describe('renderTodaySchedule', () => {
  it('renders a week of hourly rows and shows notes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-01-01T10:00:00Z'));

    const container = document.getElementById('test');
    const todayStr = new Date().toISOString().split('T')[0];
    localStorage.setItem('hourNotes', JSON.stringify({ [todayStr]: { '12': 'Lunch' } }));

    renderTodaySchedule([], container, null);
    const days = container.querySelectorAll('.day-section');
    expect(days.length).toBe(7);
    const firstDayRows = days[0].querySelectorAll('.hour-row');
    const startHour = Math.max(6, new Date().getHours() + 1);
    expect(firstDayRows.length).toBe(22 - startHour);
    expect(container.querySelector('.hour-note').textContent).toBe('Lunch');
    expect(container.querySelectorAll('li').length).toBe(0);
    vi.useRealTimers();
  });

  it('saves a note when edited', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-01-01T10:00:00Z'));

    const container = document.getElementById('test');
    const todayStr = new Date().toISOString().split('T')[0];
    localStorage.setItem('hourNotes', JSON.stringify({ [todayStr]: { '12': 'Lunch' } }));

    renderTodaySchedule([], container, null);
    const startHour = Math.max(6, new Date().getHours() + 1);
    const cell = container.querySelectorAll('.hour-events')[12 - startHour];
    cell.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const input = container.querySelector('input.hour-input');
    input.value = 'Brunch';
    input.dispatchEvent(new window.Event('input'));
    input.dispatchEvent(new window.Event('blur'));
    const stored = JSON.parse(localStorage.getItem('hourNotes'));
    expect(stored[todayStr]['12']).toBe('Brunch');
    vi.useRealTimers();
  });

  it('deletes a note when cleared', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-01-01T10:00:00Z'));

    const container = document.getElementById('test');
    const todayStr = new Date().toISOString().split('T')[0];
    localStorage.setItem('hourNotes', JSON.stringify({ [todayStr]: { '12': 'Lunch' } }));

    renderTodaySchedule([], container, null);
    const startHour = Math.max(6, new Date().getHours() + 1);
    const cell = container.querySelectorAll('.hour-events')[12 - startHour];
    cell.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const input = container.querySelector('input.hour-input');
    input.value = '';
    input.dispatchEvent(new window.Event('input'));
    input.dispatchEvent(new window.Event('blur'));

    const stored = JSON.parse(localStorage.getItem('hourNotes'));
    expect(stored[todayStr]).toBeUndefined();
    vi.useRealTimers();
  });

  it('opens an input on long press', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-01-01T10:00:00Z'));

    const container = document.getElementById('test');
    renderTodaySchedule([], container, null);

    const row = container.querySelector('.hour-row');
    row.dispatchEvent(new window.Event('touchstart', { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(500);

    const input = container.querySelector('input.hour-input');
    expect(input).not.toBeNull();
    vi.useRealTimers();
  });
});
