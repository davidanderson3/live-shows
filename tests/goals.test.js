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

vi.mock('../js/helpers.js', () => ({
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
  },
  formatDaysUntil: () => '',
  linkify: (t) => t
}));

vi.mock('../js/auth.js', () => ({ db: {}, auth: { onAuthStateChanged: vi.fn() }, currentUser: null, getCurrentUser: () => null }));

let renderGoalsAndSubitems;
let createGoalRow;
let helpers;

beforeEach(async () => {
  vi.resetModules();
  const dom = new JSDOM('<div id="goalList"></div><div id="completedList"></div><div id="calendarContent"></div>');
  global.window = dom.window;
  global.document = dom.window.document;
  global.firebase = { auth: () => ({ currentUser: null }) };
  helpers = await import('../js/helpers.js');
  helpers.loadGoalOrder.mockResolvedValue([]);
  helpers.pickDate.mockResolvedValue('');
  const mod = await import('../js/goals.js');
  renderGoalsAndSubitems = mod.renderGoalsAndSubitems;
  createGoalRow = mod.createGoalRow;
});

describe('completed goals ordering', () => {
  it('orders completed goals by most recent first', async () => {
    helpers.loadDecisions.mockResolvedValue([
      { id: 'g1', type: 'goal', completed: true, dateCompleted: '2023-01-01', parentGoalId: null },
      { id: 'g2', type: 'goal', completed: true, dateCompleted: '2023-02-01', parentGoalId: null },
      { id: 'g3', type: 'goal', completed: false, dateCompleted: '', parentGoalId: null }
    ]);

    await renderGoalsAndSubitems();

    const ids = [...document.getElementById('completedList').children].map(el => el.dataset.goalId);
    expect(ids).toEqual(['g2', 'g1']);
  });
});

describe('goal postponing', () => {
  it('sets hiddenUntil based on selected postpone option', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));

    const goal = {
      id: 'g1',
      type: 'goal',
      text: 'Test',
      notes: '',
      completed: false,
      dateCompleted: '',
      parentGoalId: null,
      hiddenUntil: null
    };

    helpers.loadDecisions.mockResolvedValue([goal]);

    const wrapper = document.createElement('div');
    wrapper.className = 'decision goal-card';
    wrapper.dataset.goalId = goal.id;
    const row = createGoalRow(goal);
    wrapper.appendChild(row);
    document.getElementById('goalList').appendChild(wrapper);

    const buttons = [...document.querySelectorAll('.postpone-option')];
    expect(buttons.some(btn => btn.textContent === '20 hours')).toBe(true);
    expect(buttons.some(btn => btn.textContent === 'Pick date…')).toBe(true);
    const option = buttons.find(btn => btn.textContent === '2 days');
    option.click();
    await Promise.resolve();

    expect(helpers.saveDecisions).toHaveBeenCalled();
    const calls = helpers.saveDecisions.mock.calls;
    const saved = calls[calls.length - 1][0][0];
    expect(saved.hiddenUntil).toBe(new Date('2023-01-03T00:00:00.000Z').toISOString());

    vi.useRealTimers();
  });

  it('allows postponing until a custom date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));

    const goal = {
      id: 'g1',
      type: 'goal',
      text: 'Test',
      notes: '',
      completed: false,
      dateCompleted: '',
      parentGoalId: null,
      hiddenUntil: null
    };

    helpers.loadDecisions.mockResolvedValue([goal]);
    helpers.pickDate.mockResolvedValue('2023-01-10');

    const wrapper = document.createElement('div');
    wrapper.className = 'decision goal-card';
    wrapper.dataset.goalId = goal.id;
    const row = createGoalRow(goal);
    wrapper.appendChild(row);
    document.getElementById('goalList').appendChild(wrapper);

    const pickBtn = [...document.querySelectorAll('.postpone-option')].find(b => b.textContent === 'Pick date…');
    pickBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(helpers.saveDecisions).toHaveBeenCalled();
    const saved = helpers.saveDecisions.mock.calls.at(-1)[0][0];
    expect(saved.hiddenUntil).toBe(new Date('2023-01-10T00:00:00.000Z').toISOString());

    vi.useRealTimers();
  });
});

describe('addCalendarGoal', () => {
  it('renders goal in calendar section and main list', async () => {
    helpers.loadDecisions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'g1',
          type: 'goal',
          text: 'My calendar goal',
          notes: '',
          completed: false,
          resolution: '',
          dateCompleted: '',
          parentGoalId: null,
          hiddenUntil: null,
          scheduled: '2024-01-02',
          scheduledEnd: ''
        }
      ]);
    const mod = await import('../js/goals.js');
    const { addCalendarGoal } = mod;
    const renderDone = new Promise(resolve => {
      window.addEventListener('decisionsUpdated', () => {
        renderGoalsAndSubitems().then(resolve);
      }, { once: true });
    });

    global.prompt = vi.fn()
      .mockReturnValueOnce('My calendar goal')
      .mockReturnValueOnce('');

    helpers.pickDateRange.mockResolvedValue({ start: '2024-01-02', end: '' });
    await addCalendarGoal('2024-01-02');
    await renderDone;

    const content = document.getElementById('calendarContent');
    expect(content.children.length).toBeGreaterThan(0);
    // goal should also appear in the main goal list
    expect(document.getElementById('goalList').children.length).toBe(1);
  });

  it('uses provided date when none selected', async () => {
    helpers.saveDecisions.mockClear();
    helpers.loadDecisions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    global.prompt = vi.fn()
      .mockReturnValueOnce('My calendar goal')
      .mockReturnValueOnce('');
    helpers.pickDateRange.mockResolvedValue({ start: '', end: '' });
    const mod = await import('../js/goals.js');
    const { addCalendarGoal } = mod;
    await addCalendarGoal('2024-01-02');
    expect(helpers.saveDecisions).toHaveBeenCalled();
    const saved = helpers.saveDecisions.mock.calls[0][0].pop();
    expect(saved.scheduled).toBe('2024-01-02');
  });

  it('saves goal order when user signed in', async () => {
    helpers.loadDecisions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    global.prompt = vi.fn()
      .mockReturnValueOnce('Cal goal')
      .mockReturnValueOnce('');
    helpers.pickDateRange.mockResolvedValue({ start: '2024-01-02', end: '' });

    global.firebase = { auth: () => ({ currentUser: { uid: 'u1' } }) };
    helpers.loadGoalOrder.mockResolvedValue(['a']);

    const mod = await import('../js/goals.js');
    const { addCalendarGoal } = mod;
    await addCalendarGoal('2024-01-02');

    const calls = helpers.saveGoalOrder.mock.calls.map(c => c[0]);
    expect(calls).toContainEqual(['a', 'g1']);
  });

  it('updates goal order before saving decisions for signed-in users', async () => {
    helpers.loadDecisions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    global.prompt = vi.fn()
      .mockReturnValueOnce('Cal goal')
      .mockReturnValueOnce('');
    helpers.pickDateRange.mockResolvedValue({ start: '2024-01-02', end: '' });

    global.firebase = { auth: () => ({ currentUser: { uid: 'u1' } }) };
    helpers.loadGoalOrder.mockResolvedValue(['a']);

    const mod = await import('../js/goals.js');
    const { addCalendarGoal } = mod;
    await addCalendarGoal('2024-01-02');

    const saveOrderCall = helpers.saveGoalOrder.mock.invocationCallOrder[0];
    const saveDecisionsCall = helpers.saveDecisions.mock.invocationCallOrder[0];
    expect(saveOrderCall).toBeLessThan(saveDecisionsCall);
  });
});

describe('editing scheduled date', () => {
  it('re-renders goals when schedule changes', async () => {
    const goal = {
      id: 'g1',
      type: 'goal',
      text: 'Test',
      notes: '',
      completed: false,
      dateCompleted: '',
      parentGoalId: null,
      scheduled: '2024-01-01',
      scheduledEnd: ''
    };

    helpers.loadDecisions.mockResolvedValue([goal]);

    const mod = await import('../js/goals.js');
    const { createGoalRow } = mod;

    const wrapper = document.createElement('div');
    wrapper.className = 'decision goal-card';
    wrapper.dataset.goalId = goal.id;
    const row = createGoalRow(goal);
    wrapper.appendChild(row);
    document.getElementById('goalList').appendChild(wrapper);

    const editBtn = row.querySelector('button[title="Edit"]');
    editBtn.click();
    await Promise.resolve();

    row.querySelector('.middle-group input').value = 'Test';
    const inputs = row.querySelectorAll('.due-column input');
    inputs[0].value = '2024-02-01';

    editBtn.click();
    await Promise.resolve();
    await Promise.resolve();

  expect(document.getElementById('goalList').contains(wrapper)).toBe(true);
  });
});

describe('parent goal styling', () => {
  it('uses the same row layout whether collapsed or expanded', async () => {
    const parent = { id: 'p1', type: 'goal', text: 'P', notes: '', completed: false, parentGoalId: null };
    const child = { id: 'c1', type: 'goal', text: 'C', notes: '', completed: false, parentGoalId: 'p1' };
    helpers.loadDecisions.mockReset();
    helpers.loadDecisions.mockResolvedValue([parent, child]);

    await renderGoalsAndSubitems();
    let row = document.querySelector('#goalList .decision-row');
    expect(row.classList.contains('parent-summary')).toBe(false);

    window.openGoalIds.add('p1');
    await renderGoalsAndSubitems();
    row = document.querySelector('#goalList .decision-row');
    expect(row.classList.contains('parent-summary')).toBe(false);
  });
});

describe('project progress', () => {
  it('shows percent of child items completed', () => {
    const goal = { id: 'g1', type: 'goal', text: 'G', notes: '', completed: false, parentGoalId: null };
    const t1 = { id: 't1', type: 'task', parentGoalId: 'g1', completed: true };
    const g2 = { id: 'g2', type: 'goal', parentGoalId: 'g1', completed: false };
    const row = createGoalRow(goal, { itemsRef: [goal, t1, g2] });
    const prog = row.querySelector('.progress-text');
    expect(prog.textContent).toBe('50%');
    expect(row.style.background).toMatch(/50%/);
  });
  it('includes nested subgoals and tasks in progress', () => {
    const goal = { id: 'g1', type: 'goal', text: 'G', notes: '', completed: false, parentGoalId: null };
    const g2 = { id: 'g2', type: 'goal', parentGoalId: 'g1', completed: false };
    const t1 = { id: 't1', type: 'task', parentGoalId: 'g2', completed: true };
    const row = createGoalRow(goal, { itemsRef: [goal, g2, t1] });
    const prog = row.querySelector('.progress-text');
    expect(prog.textContent).toBe('50%');
  });
});

describe('do later button', () => {
  it('toggles doLater and adds class', async () => {
    const goal = {
      id: 'g1',
      type: 'goal',
      text: 'G',
      notes: '',
      completed: false,
      parentGoalId: null,
      doLater: false
    };
    helpers.loadDecisions.mockResolvedValue([goal]);
    helpers.saveDecisions.mockClear();

    const wrapper = document.createElement('div');
    wrapper.className = 'decision goal-card';
    wrapper.dataset.goalId = goal.id;
    document.getElementById('goalList').appendChild(wrapper);

    const row = createGoalRow(goal, { itemsRef: [goal] });
    wrapper.appendChild(row);

    const btn = row.querySelector('button[title="Mark as do later"]');
    await btn.onclick(new window.Event('click'));

    const saved = helpers.saveDecisions.mock.calls[0][0][0];
    expect(saved.doLater).toBe(true);
    expect(wrapper.classList.contains('do-later')).toBe(true);
  });
});
