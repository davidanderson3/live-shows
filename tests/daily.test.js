import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../js/helpers.js', () => ({
  loadDecisions: vi.fn(),
  saveDecisions: vi.fn(),
  generateId: vi.fn(),
  makeIconBtn: (sym, title, fn) => {
    const b = document.createElement('button');
    b.textContent = sym;
    b.onclick = fn;
    return b;
  },
  linkify: t => t,
  pickDate: vi.fn()
}));

vi.mock('../js/auth.js', () => ({ db: {}, currentUser: null, auth: { onAuthStateChanged: vi.fn() } }));
describe('daily task ordering', () => {
  let renderDailyTasks;
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const now = new Date('2024-01-10T12:00:00Z');
    vi.setSystemTime(now);

    const dom = new JSDOM('<div id="dailyPanel"></div>', { url: 'https://example.com' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;

    const yesterdayKey = new Date(now.getTime() - 86400000).toLocaleDateString('en-CA');
    localStorage.setItem('taskCompletions', JSON.stringify({ [yesterdayKey]: ['a'] }));

    const helpers = await import('../js/helpers.js');
    helpers.loadDecisions.mockResolvedValue([
      { id: 'a', type: 'task', text: 'A', recurs: 'daily' },
      { id: 'b', type: 'task', text: 'B', recurs: 'daily' },
      { id: 'c', type: 'task', text: 'C', recurs: 'daily' }
    ]);

    ({ renderDailyTasks } = await import('../js/daily.js'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves unfinished tasks from previous day to top', async () => {
    await renderDailyTasks(null, {});
    const ids = Array.from(document.querySelectorAll('#dailyTasksList .daily-task-wrapper'))
      .map(el => el.dataset.taskId);
    expect(ids).toEqual(['b', 'c', 'a']);
  });
});

describe('routine task reordering', () => {
  let renderDailyTasks;
  let helpers;
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const dom = new JSDOM('<div id="dailyPanel"></div>', { url: 'https://example.com' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;

    helpers = await import('../js/helpers.js');
    helpers.loadDecisions.mockResolvedValue([
      { id: 'a', type: 'task', text: 'A', recurs: 'daily' },
      { id: 'b', type: 'task', text: 'B', recurs: 'daily' }
    ]);
    helpers.saveDecisions.mockResolvedValue();

    ({ renderDailyTasks } = await import('../js/daily.js'));
  });

  it('moves task up and persists order', async () => {
    await renderDailyTasks(null, {});
    const upBtn = [...document.querySelector('[data-task-id="b"]').querySelectorAll('button')]
      .find(b => b.textContent === '⬆️');
    upBtn.click();
    await new Promise(r => setTimeout(r, 0));
    const ids = Array.from(document.querySelectorAll('#morningTasksList .daily-task-wrapper'))
      .map(el => el.dataset.taskId);
    expect(ids).toEqual(['b', 'a']);
    const lastCall = helpers.saveDecisions.mock.calls.at(-1)[0];
    expect(lastCall).toEqual([
      expect.objectContaining({ id: 'b', text: 'B', recurs: 'daily' }),
      expect.objectContaining({ id: 'a', text: 'A', recurs: 'daily' })
    ]);
  });

  it('moves task up without triggering reload', async () => {
    helpers.saveDecisions.mockImplementation((items, opts) => {
      if (!opts?.skipNotify) {
        window.dispatchEvent(new window.Event('decisionsUpdated'));
      }
      return Promise.resolve();
    });
    const reloadSpy = vi.fn();
    window.addEventListener('decisionsUpdated', reloadSpy);
    await renderDailyTasks(null, {});
    reloadSpy.mockClear();
    const upBtn = [...document.querySelector('[data-task-id="b"]').querySelectorAll('button')]
      .find(b => b.textContent === '⬆️');
    upBtn.click();
    await new Promise(r => setTimeout(r, 0));
    expect(reloadSpy).not.toHaveBeenCalled();
    const opts = helpers.saveDecisions.mock.calls.at(-1)[1];
    expect(opts).toEqual({ skipNotify: true });
  });
});

describe('missed task shading', () => {
  let renderDailyTasks;
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const now = new Date('2024-01-10T12:00:00Z');
    vi.setSystemTime(now);

    const dom = new JSDOM('<div id="dailyPanel"></div>', { url: 'https://example.com' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;

    const yesterday = new Date(now.getTime() - 86400000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);
    localStorage.setItem('taskCompletions', JSON.stringify({
      [yesterday.toLocaleDateString('en-CA')]: ['t1'],
      [twoDaysAgo.toLocaleDateString('en-CA')]: ['t2'],
      [threeDaysAgo.toLocaleDateString('en-CA')]: ['t3']
    }));

    const helpers = await import('../js/helpers.js');
    helpers.loadDecisions.mockResolvedValue([
      { id: 't1', type: 'task', text: 'A', recurs: 'daily' },
      { id: 't2', type: 'task', text: 'B', recurs: 'daily' },
      { id: 't3', type: 'task', text: 'C', recurs: 'daily' }
    ]);

    ({ renderDailyTasks } = await import('../js/daily.js'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('darkens tasks based on days missed', async () => {
    await renderDailyTasks(null, {});
    const t1 = document.querySelector('[data-task-id="t1"] .daily-task').style.background;
    const t2 = document.querySelector('[data-task-id="t2"] .daily-task').style.background;
    const t3 = document.querySelector('[data-task-id="t3"] .daily-task').style.background;
    expect(t1).toBe('rgb(255, 250, 240)');
    expect(t2).toBe('rgba(255, 165, 0, 0.2)');
    expect(t3).toBe('rgba(255, 165, 0, 0.3)');
  });
});

describe('hidden and completed sections', () => {
  it('renders hidden and completed tasks in separate sections', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const now = new Date('2024-01-10T12:00:00Z');
    vi.setSystemTime(now);

    const dom = new JSDOM('<div id="dailyPanel"></div>', { url: 'https://example.com' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;

    const todayKey = now.toLocaleDateString('en-CA');
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekKey = monday.toISOString().split('T')[0];
    localStorage.setItem('taskCompletions', JSON.stringify({ [todayKey]: ['c'], [weekKey]: ['cw'] }));

    const future = new Date(now.getTime() + 3600000).toISOString();
    const helpers = await import('../js/helpers.js');
    helpers.loadDecisions.mockResolvedValue([
      { id: 'h', type: 'task', text: 'Hidden', recurs: 'daily', timeOfDay: 'morning', hiddenUntil: future },
      { id: 'hw', type: 'task', text: 'Hidden weekly', recurs: 'weekly', hiddenUntil: future },
      { id: 'c', type: 'task', text: 'Done', recurs: 'daily', timeOfDay: 'morning' },
      { id: 'cw', type: 'task', text: 'Done weekly', recurs: 'weekly' }
    ]);

    const { renderDailyTasks } = await import('../js/daily.js');
    await renderDailyTasks(null, {});

    expect(document.querySelector('#hiddenTasksList [data-task-id="h"]')).toBeTruthy();
    expect(document.querySelector('#hiddenTasksList [data-task-id="hw"]')).toBeTruthy();
    expect(document.querySelector('#completedTasksList [data-task-id="c"]')).toBeTruthy();
    expect(document.querySelector('#completedTasksList [data-task-id="cw"]')).toBeTruthy();
    expect(
      document.querySelector('#hiddenTasksList [data-task-id="h"] .task-category')
        ?.textContent
    ).toBe(' (Morning)');
    expect(
      document.querySelector('#hiddenTasksList [data-task-id="hw"] .task-category')
        ?.textContent
    ).toBe(' (Weekly)');
    expect(
      document.querySelector('#completedTasksList [data-task-id="c"] .task-category')
        ?.textContent
    ).toBe(' (Morning)');
    expect(
      document.querySelector('#completedTasksList [data-task-id="cw"] .task-category')
        ?.textContent
    ).toBe(' (Weekly)');
    vi.useRealTimers();
  });
});

describe('quickAddTask', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('saves task and reloads list', async () => {
    const dom = new JSDOM(`
      <button class="tab-button active" data-target="dailyPanel"></button>
      <div id="dailyPanel"></div>
    `, { url: 'https://example.com' });
    global.window = dom.window;
    global.document = dom.window.document;

    const helpers = await import('../js/helpers.js');
    helpers.loadDecisions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'x1', type: 'task', text: 'Test', recurs: 'daily' }]);
    helpers.saveDecisions.mockResolvedValue();
    helpers.generateId.mockReturnValue('x1');

    const daily = await import('../js/daily.js');
    await daily.quickAddTask('daily', 'Test', 'morning');
    expect(helpers.saveDecisions).toHaveBeenCalled();
    expect(document.querySelector('#dailyTasksList input[type="checkbox"]')).toBeTruthy();
  });
});

describe('time of day sections', () => {
  it('renders tasks into respective containers', async () => {
    vi.resetModules();
    const dom = new JSDOM('<div id="dailyPanel"></div>', { url: 'https://example.com' });
    global.window = dom.window;
    global.document = dom.window.document;

    const helpers = await import('../js/helpers.js');
    helpers.loadDecisions.mockResolvedValue([
      { id: 'f', type: 'task', text: 'F', recurs: 'daily', timeOfDay: 'firstThing' },
      { id: 'm', type: 'task', text: 'M', recurs: 'daily', timeOfDay: 'morning' },
      { id: 'a', type: 'task', text: 'A', recurs: 'daily', timeOfDay: 'afternoon' },
      { id: 'e', type: 'task', text: 'E', recurs: 'daily', timeOfDay: 'evening' },
      { id: 'b', type: 'task', text: 'B', recurs: 'daily', timeOfDay: 'endOfDay' }
    ]);

    const { renderDailyTasks } = await import('../js/daily.js');
    await renderDailyTasks(null, {});
    expect(document.querySelector('#firstThingTasksList [data-task-id="f"]')).toBeTruthy();
    expect(document.querySelector('#morningTasksList [data-task-id="m"]')).toBeTruthy();
    expect(document.querySelector('#afternoonTasksList [data-task-id="a"]')).toBeTruthy();
    expect(document.querySelector('#eveningTasksList [data-task-id="e"]')).toBeTruthy();
    expect(document.querySelector('#endOfDayTasksList [data-task-id="b"]')).toBeTruthy();
  });
});

  describe('editing daily tasks', () => {
    it('allows inline editing with time of day', async () => {
      vi.resetModules();
      const dom = new JSDOM('<div id="dailyPanel"></div>', { url: 'https://example.com' });
      global.window = dom.window;
      global.document = dom.window.document;

      const helpers = await import('../js/helpers.js');
      helpers.loadDecisions
        .mockResolvedValueOnce([{ id: 't1', type: 'task', text: 'Old', recurs: 'daily', timeOfDay: 'morning', notes: '' }])
        .mockResolvedValueOnce([{ id: 't1', type: 'task', text: 'Old', recurs: 'daily', timeOfDay: 'morning', notes: '' }]);
      helpers.saveDecisions.mockResolvedValue();

      const { renderDailyTasks } = await import('../js/daily.js');
      await renderDailyTasks(null, {});

      const editBtn = Array.from(document.querySelectorAll('.daily-task button')).find(b => b.textContent === '✏️');
      editBtn.click();
      const label = document.querySelector('.daily-task > div:nth-child(2)');
      label.querySelector('input').value = 'New';
      label.querySelector('textarea').value = 'N';
      label.querySelector('select').value = 'evening';
      editBtn.click();
      await new Promise(r => setTimeout(r, 0));

      expect(helpers.saveDecisions).toHaveBeenCalledWith([
        { id: 't1', type: 'task', text: 'New', recurs: 'daily', timeOfDay: 'evening', notes: 'N' }
      ]);
      expect(document.querySelector('#eveningTasksList [data-task-id="t1"]')).toBeTruthy();
    });

    it('moves task to selected section on save', async () => {
      vi.resetModules();
      const dom = new JSDOM('<div id="dailyPanel"></div>', { url: 'https://example.com' });
      global.window = dom.window;
      global.document = dom.window.document;

      const helpers = await import('../js/helpers.js');
      helpers.loadDecisions
        .mockResolvedValueOnce([{ id: 't1', type: 'task', text: 'Old', recurs: 'daily', timeOfDay: 'morning', notes: '' }])
        .mockResolvedValueOnce([{ id: 't1', type: 'task', text: 'Old', recurs: 'daily', timeOfDay: 'morning', notes: '' }]);
      helpers.saveDecisions.mockResolvedValue();

      const { renderDailyTasks } = await import('../js/daily.js');
      await renderDailyTasks(null, {});

      const editBtn = Array.from(document.querySelectorAll('.daily-task button')).find(b => b.textContent === '✏️');
      editBtn.click();
      const label = document.querySelector('.daily-task > div:nth-child(2)');
      label.querySelector('input').value = 'New';
      label.querySelector('textarea').value = 'N';
      label.querySelector('select').value = 'endOfDay';
      editBtn.click();
      await new Promise(r => setTimeout(r, 0));

      expect(helpers.saveDecisions).toHaveBeenCalledWith([
        { id: 't1', type: 'task', text: 'New', recurs: 'daily', timeOfDay: 'endOfDay', notes: 'N' }
      ]);
      expect(document.querySelector('#endOfDayTasksList [data-task-id="t1"]')).toBeTruthy();
    });
  });

describe('empty routine sections', () => {
  it('hides sections with no tasks', async () => {
    vi.resetModules();
    const dom = new JSDOM('<div id="dailyPanel"></div>', { url: 'https://example.com' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;

    const helpers = await import('../js/helpers.js');
    helpers.loadDecisions.mockResolvedValue([
      { id: 'm', type: 'task', text: 'M', recurs: 'daily', timeOfDay: 'morning' }
    ]);

    const { renderDailyTasks } = await import('../js/daily.js');
    await renderDailyTasks(null, {});

    expect(document.getElementById('dailyTasksList').style.display).not.toBe('none');
    expect(document.getElementById('weeklyTasksList').style.display).toBe('none');
    expect(document.getElementById('monthlyTasksList').style.display).toBe('none');
    expect(document.getElementById('hiddenTasksSection').style.display).toBe('none');
    expect(document.getElementById('completedTasksSection').style.display).toBe('none');
    expect(document.getElementById('firstThingTasksList').style.display).toBe('none');
    expect(document.getElementById('afternoonTasksList').style.display).toBe('none');
    expect(document.getElementById('eveningTasksList').style.display).toBe('none');
    expect(document.getElementById('endOfDayTasksList').style.display).toBe('none');
    expect(document.getElementById('morningTasksList').style.display).not.toBe('none');
  });
});

describe('routine section headers', () => {
  it('hides daily subsection headers when last task completed', async () => {
    vi.resetModules();
    const dom = new JSDOM('<div id="dailyPanel"></div>', { url: 'https://example.com' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;

    const helpers = await import('../js/helpers.js');
    helpers.loadDecisions.mockResolvedValue([
      { id: 'm1', type: 'task', text: 'M', recurs: 'daily', timeOfDay: 'morning' }
    ]);

    const { renderDailyTasks } = await import('../js/daily.js');
    await renderDailyTasks(null, {});

    const list = document.getElementById('morningTasksList');
    const hdr = list.previousElementSibling;
    expect(hdr.style.display).not.toBe('none');

    const cb = list.querySelector('input[type="checkbox"]');
    cb.checked = true;
    cb.dispatchEvent(new dom.window.Event('change'));
    await new Promise(r => setTimeout(r, 0));

    expect(list.style.display).toBe('none');
    expect(hdr.style.display).toBe('none');
  });

  it('hides weekly section header when last task completed', async () => {
    vi.resetModules();
    const dom = new JSDOM('<div id="dailyPanel"><h3 id="weeklyHeader">Weekly</h3><div id="weeklyTasksList" class="decision-container"></div></div>', { url: 'https://example.com' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;

    const helpers = await import('../js/helpers.js');
    helpers.loadDecisions.mockResolvedValue([
      { id: 'w1', type: 'task', text: 'W', recurs: 'weekly' }
    ]);

    const { renderDailyTasks } = await import('../js/daily.js');
    await renderDailyTasks(null, {});

    const list = document.getElementById('weeklyTasksList');
    const hdr = document.getElementById('weeklyHeader');
    expect(hdr.style.display).not.toBe('none');

    const cb = list.querySelector('input[type="checkbox"]');
    cb.checked = true;
    cb.dispatchEvent(new dom.window.Event('change'));
    await new Promise(r => setTimeout(r, 0));

    expect(list.style.display).toBe('none');
    expect(hdr.style.display).toBe('none');
  });
});
