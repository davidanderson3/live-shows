import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../js/dragAndDrop.js', () => ({
  initializeGlobalDragHandlers: vi.fn(),
  enableGoalDragAndDrop: vi.fn()
}));

vi.mock('../js/tasks.js', () => ({
  attachTaskButtons: vi.fn(),
  renderChildren: vi.fn()
}));

vi.mock('../js/helpers.js', async () => {
  const actual = await vi.importActual('../js/helpers.js');
  return {
    ...actual,
    loadDecisions: vi.fn(),
    saveDecisions: vi.fn(async () => { window.dispatchEvent(new window.Event('decisionsUpdated')); }),
    saveGoalOrder: vi.fn(),
    loadGoalOrder: vi.fn(async () => []),
    generateId: vi.fn(() => 'g1'),
    pickDateRange: vi.fn(async () => ({ start: null, end: null })),
    pickDate: vi.fn(),
    makeIconBtn: (symbol, title, fn) => {
      const b = document.createElement('button');
      b.title = title;
      b.onclick = fn;
      return b;
    }
  };
});

vi.mock('../js/auth.js', () => ({ db: {}, auth: { onAuthStateChanged: vi.fn() }, currentUser: null, getCurrentUser: () => null }));

let renderGoalsAndSubitems;
let helpers;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-08-20T00:00:00'));
  vi.resetModules();
  const dom = new JSDOM('<div id="goalList"></div><div id="completedList"></div><div id="calendarContent"></div>');
  global.window = dom.window;
  global.document = dom.window.document;
  global.firebase = { auth: () => ({ currentUser: null }) };
  helpers = await import('../js/helpers.js');
  helpers.loadDecisions.mockResolvedValue([
    {
      id: 'g1',
      type: 'goal',
      text: 'Weekend goal',
      notes: '',
      completed: false,
      dateCompleted: '',
      parentGoalId: null,
      hiddenUntil: null,
      deadline: '',
      scheduled: '2025-08-23',
      scheduledEnd: '2025-08-24'
    }
  ]);
  const mod = await import('../js/goals.js');
  renderGoalsAndSubitems = mod.renderGoalsAndSubitems;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('weekend calendar display', () => {
  it('shows weekend days with year and days until', async () => {
    await renderGoalsAndSubitems();
    const hdr = document.querySelector('.weekend-section h3');
    const sat = new Date(2025, 7, 23);
    const sun = new Date(2025, 7, 24);
    const satLabel = sat.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    const sunLabel = sun.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    const satDays = helpers.formatDaysUntil('2025-08-23');
    const sunDays = helpers.formatDaysUntil('2025-08-24');
    expect(hdr.innerHTML).toBe(`Weekend:<br>${satLabel} (${satDays})<br>${sunLabel} (${sunDays})`);
  });
});
