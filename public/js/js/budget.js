export const FEDERAL_TAX_RATE = 0.10;
/**
 * Calculates a monthly budget summary.
 *
 * When no annual salary is provided, the `netPay` argument is treated as the
 * gross monthly income and taxes are deducted from it.
 *
 * The returned expenses exclude federal taxes and represent only recurring
 * expenses and subscriptions.
*/
export function calculateMonthlyBudget({ salary, netPay, categories, incomeCategories = {} }) {
  salary = Number(salary) || 0;
  netPay = Number(netPay) || 0;
  const cats = { ...categories };
  Object.keys(cats).forEach(k => { cats[k] = Number(cats[k]) || 0; });
  const incomes = { ...incomeCategories };
  Object.keys(incomes).forEach(k => { incomes[k] = Number(incomes[k]) || 0; });

  const monthlyIncome = salary ? salary / 12 : netPay;
  const federalTax = Math.round(monthlyIncome * FEDERAL_TAX_RATE);
  const tax = federalTax;

  const additionalIncome = Object.values(incomes).reduce((s, v) => s + v, 0);
  const calculatedNetPay = monthlyIncome - tax + additionalIncome;
  const categoryTotal = Object.values(cats).reduce((s, v) => s + v, 0);
  const expenses = categoryTotal;
  const leftover = monthlyIncome + additionalIncome - categoryTotal;
  return {
    federalTax,
    tax,
    netPay: calculatedNetPay,
    monthlyIncome,
    expenses,
    leftover,
    income: additionalIncome
  };
}

import { getCurrentUser, db } from './auth.js';
import { makeIconBtn } from './helpers.js';

const BUDGET_KEY = 'budgetConfig';
let budgetCache = null;

const DEFAULT_RECURRING = [
  ['mortgageInterest', 'Mortgage Interest'],
  ['mortgagePrincipal', 'Mortgage Principal'],
  ['escrow', 'Escrow'],
  ['rent', 'Rent'],
  ['electric', 'Electric'],
  ['water', 'Water'],
  ['gas', 'Gas'],
  ['internet', 'Internet'],
  ['cell', 'Cell Phone'],
  ['food', 'Food'],
  ['transGas', 'Gas (Car)'],
  ['carPayment', 'Car Payment'],
  ['tolls', 'Tolls'],
  ['insurance', 'Car Insurance'],
  ['healthInsurance', 'Health Insurance'],
  ['dentalInsurance', 'Dental Insurance'],
  ['savings', 'Savings'],
  ['investmentAccounts', 'Investment Accounts'],
  ['federalDeductions', 'Federal Deductions'],
  ['stateTaxes', 'State Taxes'],
  ['misc', 'Misc']
];

function isObject(val) {
  return val && typeof val === 'object' && !Array.isArray(val);
}

function deepMerge(base = {}, override = {}) {
  const out = {};
  for (const key of Object.keys(override)) {
    const bVal = base[key];
    const oVal = override[key];
    if (isObject(bVal) && isObject(oVal)) {
      out[key] = deepMerge(bVal, oVal);
    } else {
      out[key] = oVal;
    }
  }
  return out;
}

function migrateSubscriptions(data = {}) {
  data.subscriptions = data.subscriptions || {};
  if (data.prime) {
    data.subscriptions['Amazon Prime'] = data.prime;
    delete data.prime;
  }
  if (data.spotify) {
    data.subscriptions['Spotify'] = data.spotify;
    delete data.spotify;
  }
  return data;
}

export async function loadBudgetData() {
  const user = getCurrentUser?.();

  let localData = {};
  const stored = localStorage.getItem(BUDGET_KEY);
  if (stored) {
    try {
      localData = JSON.parse(stored) || {};
    } catch (err) {
      console.warn('Failed to parse budget data:', err);
    }
  }

  if (!user) {
    localStorage.removeItem(BUDGET_KEY);
    budgetCache = migrateSubscriptions({});
    budgetCache.recurring = {};
    budgetCache.subscriptions = {};
    budgetCache.goalRecurring = {};
    budgetCache.goalSubscriptions = {};
    return budgetCache;
  }

  let cloudData = {};
  let cloudExists = false;
  try {
    const snap = await db
      .collection('users').doc(user.uid)
      .collection('settings').doc(BUDGET_KEY)
      .get();
    if (snap) {
      cloudExists = !!snap.exists;
      cloudData = cloudExists ? snap.data() : {};
    }
  } catch (err) {
    console.error('Failed to fetch budget data:', err);
  }

  const localTs = localData.lastUpdated || 0;
  const cloudTs = cloudData.lastUpdated || 0;
  const useCloud = cloudTs > localTs || (cloudTs === localTs && !Object.keys(localData).length);
  const older = useCloud ? localData : cloudData;
  const newer = useCloud ? cloudData : localData;
  budgetCache = migrateSubscriptions(deepMerge(older, newer));
  budgetCache.recurring = budgetCache.recurring || {};
  budgetCache.subscriptions = budgetCache.subscriptions || {};
  budgetCache.goalRecurring = budgetCache.goalRecurring || {};
  budgetCache.goalSubscriptions = budgetCache.goalSubscriptions || {};
  budgetCache.lastUpdated = Math.max(localTs, cloudTs);

  let shouldSave = !cloudExists;
  if (cloudExists && localTs > cloudTs) {
    const ask = () => {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        return window.confirm('Upload local budget changes to the cloud?');
      }
      return false;
    };
    shouldSave = ask();
  }

  if (shouldSave) {
    try {
      await db
        .collection('users').doc(user.uid)
        .collection('settings').doc(BUDGET_KEY)
        .set(budgetCache, { merge: true });
    } catch (err) {
      console.error('Failed to save budget data:', err);
    }
  }

  localStorage.setItem(BUDGET_KEY, JSON.stringify(budgetCache));
  return budgetCache;
}

export async function saveBudgetData(data) {
  budgetCache = migrateSubscriptions(data || {});
  budgetCache.recurring = budgetCache.recurring || {};
  budgetCache.subscriptions = budgetCache.subscriptions || {};
  budgetCache.goalRecurring = budgetCache.goalRecurring || {};
  budgetCache.goalSubscriptions = budgetCache.goalSubscriptions || {};
  budgetCache.lastUpdated = Date.now();
  const user = getCurrentUser?.();
  if (!user) {
    localStorage.removeItem(BUDGET_KEY);
    return;
  }
  localStorage.setItem(BUDGET_KEY, JSON.stringify(budgetCache));
  try {
    await db
      .collection('users').doc(user.uid)
      .collection('settings').doc(BUDGET_KEY)
      .set(budgetCache, { merge: true });
  } catch (err) {
    console.error('Failed to save budget data:', err);
  }
}

export async function initBudgetPanel() {
  const panel = document.getElementById('budgetContainer');
  if (!panel) return;
  const saved = await loadBudgetData();
  panel.innerHTML = `
    <div id="budgetLayout">
      <div id="budgetHeader" class="budget-header">
        <div id="budgetSummary" class="budget-summary"></div>
      </div>
      <table id="budgetTable">
        <thead>
          <tr>
            <th>Type</th>
            <th>Category</th>
            <th>Current</th>
            <th>Goal</th>
            <th>Change</th>
            <th>% Change</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="budgetTbody"></tbody>
      </table>
    </div>
  `;

  const tbody = panel.querySelector('#budgetTbody');
  const summary = panel.querySelector('#budgetSummary');
  const removedBuiltIns = new Set(saved.removedBuiltIns || []);

  const sectionRows = {};

  function addSection(title) {
    const tr = document.createElement('tr');
    tr.className = 'section-row';
    tr.dataset.section = title;
    const th = document.createElement('th');
    th.colSpan = 7;
    th.textContent = title;
    tr.append(th);
    tbody.append(tr);
    sectionRows[title] = tr;
  }

  function insertRowInSection(section, tr) {
    const header = sectionRows[section];
    if (!header) {
      tbody.append(tr);
      return;
    }
    let ref = header;
    while (ref.nextSibling && !ref.nextSibling.classList.contains('section-row')) {
      ref = ref.nextSibling;
    }
    tbody.insertBefore(tr, ref.nextSibling);
  }

  function addRow(name = '', current = '', goal = '', key = '', type = 'expense', section = 'Other Expenses') {
    const id = key || Math.random().toString(36).slice(2);
    const tr = document.createElement('tr');
    tr.className = 'budget-row';
    tr.dataset.id = id;
    tr.dataset.type = type;
    if (key) tr.dataset.field = key;
    tr.innerHTML = `
      <td class="type-cell">${type === 'income' ? 'Income' : type === 'subscription' ? 'Subscription' : 'Expense'}</td>
      <td class="cat-name">${name}</td>
      <td><input type="number" class="current-cost" value="${current}"></td>
      <td><input type="number" class="goal-cost" value="${goal}"></td>
      <td class="change-cell"></td>
      <td class="percent-cell"></td>
      <td class="actions"></td>
    `;
    const actions = tr.querySelector('.actions');
    const up = makeIconBtn('⬆️', 'Move up', () => {
      const prev = tr.previousElementSibling;
      if (prev) tbody.insertBefore(tr, prev);
      render();
    });
    const rem = makeIconBtn('❌', 'Remove', () => {
      if (key && type === 'expense') removedBuiltIns.add(key);
      tr.remove();
      render();
    });
    actions.append(up, rem);
    insertRowInSection(section, tr);
  }

  const SECTION_LOOKUP = {
    mortgageInterest: 'Mortgage/Rent',
    mortgagePrincipal: 'Mortgage/Rent',
    escrow: 'Mortgage/Rent',
    rent: 'Mortgage/Rent',
    electric: 'Utilities',
    water: 'Utilities',
    gas: 'Utilities',
    internet: 'Utilities',
    cell: 'Utilities',
    transGas: 'Transportation',
    carPayment: 'Transportation',
    tolls: 'Transportation',
    insurance: 'Insurance',
    healthInsurance: 'Insurance',
    dentalInsurance: 'Insurance',
    federalDeductions: 'Taxes',
    stateTaxes: 'Taxes'
  };

  const SECTION_ORDER = [
    'Income',
    'Mortgage/Rent',
    'Utilities',
    'Transportation',
    'Insurance',
    'Taxes',
    'Other Expenses',
    'Subscriptions'
  ];
  SECTION_ORDER.forEach(addSection);

  const incomeNames = new Set([
    ...Object.keys(saved.incomeRecurring || {}),
    ...Object.keys(saved.goalIncomeRecurring || {})
  ]);
  incomeNames.forEach(n =>
    addRow(n, saved.incomeRecurring?.[n] ?? '', saved.goalIncomeRecurring?.[n] ?? '', '', 'income', 'Income')
  );

  const recurNames = new Set([
    ...Object.keys(saved.recurring || {}),
    ...Object.keys(saved.goalRecurring || {})
  ]);
  DEFAULT_RECURRING.forEach(([key, label]) => {
    if (!removedBuiltIns.has(key)) {
      const section = SECTION_LOOKUP[key] || 'Other Expenses';
      addRow(label, saved[key] ?? '', saved[`goal_${key}`] ?? '', key, 'expense', section);
    }
  });
  recurNames.forEach(n => {
    const section = SECTION_LOOKUP[n] || 'Other Expenses';
    addRow(n, saved.recurring?.[n] ?? '', saved.goalRecurring?.[n] ?? '', '', 'expense', section);
  });

  const subNames = new Set([
    ...Object.keys(saved.subscriptions || {}),
    ...Object.keys(saved.goalSubscriptions || {})
  ]);
  subNames.forEach(n =>
    addRow(n, saved.subscriptions?.[n] ?? '', saved.goalSubscriptions?.[n] ?? '', '', 'subscription', 'Subscriptions')
  );

  function openBudgetItemForm(prefill) {
    if (prefill && prefill.name) {
      const { name, current = '', goal = '', type = 'expense' } = prefill;
      const section = type === 'income'
        ? 'Income'
        : type === 'subscription'
          ? 'Subscriptions'
          : 'Other Expenses';
      addRow(name, current, goal, '', type, section);
      render();
      return;
    }
    const modal = document.getElementById('bottomAddModal');
    if (!modal) return;
    const title = document.getElementById('bottomAddTitle');
    const options = document.getElementById('bottomAddOptions');
    const sectionEl = document.getElementById('bottomAddSection');
    const textEl = document.getElementById('bottomAddText');
    const cancel = document.getElementById('bottomAddCancel');
    const submit = document.getElementById('bottomAddSubmit');

    title.textContent = 'Add Budget Item';
    options.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <label>Type
          <select id="budgetItemType">
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="subscription">Subscription</option>
          </select>
        </label>
        <label>Name<br><input type="text" id="budgetItemName"></label>
        <label>Current<br><input type="number" id="budgetItemCurrent"></label>
        <label>Goal<br><input type="number" id="budgetItemGoal"></label>
      </div>
    `;
    sectionEl.style.display = 'none';
    textEl.style.display = 'none';

    function close() {
      modal.style.display = 'none';
      cancel.removeEventListener('click', onCancel);
      submit.removeEventListener('click', onSubmit);
    }
    function onCancel() { close(); }
    function onSubmit() {
      const type = document.getElementById('budgetItemType').value;
      const name = document.getElementById('budgetItemName').value.trim();
      const current = document.getElementById('budgetItemCurrent').value;
      const goal = document.getElementById('budgetItemGoal').value;
      if (!name) { alert('Name required'); return; }
      const section = type === 'income'
        ? 'Income'
        : type === 'subscription'
          ? 'Subscriptions'
          : 'Other Expenses';
      addRow(name, current, goal, '', type, section);
      render();
      close();
    }

    cancel.addEventListener('click', onCancel);
    submit.addEventListener('click', onSubmit);
    modal.style.display = 'flex';
    document.getElementById('budgetItemName').focus();
  }

  if (typeof window !== 'undefined') {
    window.openBudgetItemForm = openBudgetItemForm;
  }

  function collectData() {
    const categoriesCurrent = {};
    const categoriesGoal = {};
    const incomeCurrent = {};
    const incomeGoal = {};
    const saveData = {
      removedBuiltIns: Array.from(removedBuiltIns),
      recurring: {},
      goalRecurring: {},
      subscriptions: {},
      goalSubscriptions: {},
      incomeRecurring: {},
      goalIncomeRecurring: {}
    };
    tbody.querySelectorAll('tr').forEach(row => {
      if (row.classList.contains('section-row')) return;
      const name = row.querySelector('.cat-name').textContent.trim();
      const curVal = row.querySelector('.current-cost').value;
      const goalVal = row.querySelector('.goal-cost').value;
      const field = row.dataset.field;
      const type = row.dataset.type || 'expense';
      if (!name) return;
      if (type === 'income') {
        incomeCurrent[name] = curVal;
        incomeGoal[name] = goalVal;
        if (curVal) saveData.incomeRecurring[name] = curVal;
        if (goalVal) saveData.goalIncomeRecurring[name] = goalVal;
      } else if (type === 'subscription') {
        categoriesCurrent[name] = curVal;
        categoriesGoal[name] = goalVal;
        if (curVal) saveData.subscriptions[name] = curVal;
        if (goalVal) saveData.goalSubscriptions[name] = goalVal;
      } else {
        categoriesCurrent[name] = curVal;
        categoriesGoal[name] = goalVal;
        if (field) {
          saveData[field] = curVal;
          saveData['goal_' + field] = goalVal;
        } else {
          if (curVal) saveData.recurring[name] = curVal;
          if (goalVal) saveData.goalRecurring[name] = goalVal;
        }
      }
    });
    return { categoriesCurrent, categoriesGoal, incomeCurrent, incomeGoal, saveData };
  }

  function render(save = true) {
    const { categoriesCurrent, categoriesGoal, incomeCurrent, incomeGoal, saveData } = collectData();
    tbody.querySelectorAll('tr').forEach(row => {
      if (row.classList.contains('section-row')) return;
      const cur = parseFloat(row.querySelector('.current-cost').value) || 0;
      const goal = parseFloat(row.querySelector('.goal-cost').value) || 0;
      const diff = goal - cur;
      const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
      row.querySelector('.change-cell').textContent = `${sign}$${Math.abs(diff).toFixed(2)}`;
      let pct;
      if (cur === 0) {
        pct = goal === 0 ? '0%' : 'n/a';
      } else {
        pct = ((Math.abs(diff) / cur) * 100).toFixed(1) + '%';
        if (sign) pct = sign + pct;
      }
      row.querySelector('.percent-cell').textContent = pct;
    });
    const toNumber = obj => Object.values(obj).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    const totalCur = toNumber(categoriesCurrent);
    const totalGoal = toNumber(categoriesGoal);
    const incomeCurTotal = toNumber(incomeCurrent);
    const incomeGoalTotal = toNumber(incomeGoal);
    const leftoverCur = incomeCurTotal - totalCur;
    const leftoverGoal = incomeGoalTotal - totalGoal;
    summary.innerHTML = `
      <table class="budget-summary-table">
        <tr><th>Current</th><th>Goal</th></tr>
        <tr>
          <td>Income: $${incomeCurTotal.toLocaleString()}</td>
          <td>Income: $${incomeGoalTotal.toLocaleString()}</td>
        </tr>
        <tr>
          <td>Expenses: $${totalCur.toLocaleString()}</td>
          <td>Expenses: $${totalGoal.toLocaleString()}</td>
        </tr>
        <tr>
          <td>Leftover: $${leftoverCur.toLocaleString()}</td>
          <td>Leftover: $${leftoverGoal.toLocaleString()}</td>
        </tr>
      </table>
    `;
    if (save) saveBudgetData(saveData);
  }

  tbody.addEventListener('input', () => render(false));
  tbody.addEventListener('change', () => render(true));

  render(false);
}

if (typeof window !== 'undefined') {
  window.initBudgetPanel = initBudgetPanel;
}
