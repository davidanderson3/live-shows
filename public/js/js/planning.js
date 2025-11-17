import { getCurrentUser, db } from './auth.js';

export function calculateFinanceProjection({
  currentAge,
  retirementAge,
  savings,
  annualSavings = 0,
  income = 0,
  investmentReturnRate,
  annualRaise = 0,
  pension = 0,
  socialSecurity = 0,
  postYears = 0,
  withdrawalRate = 4,
  inflationRate = 0
}) {
  currentAge = Number(currentAge);
  retirementAge = Number(retirementAge);
  savings = Number(savings);
  annualSavings = Number(annualSavings !== undefined ? annualSavings : income);
  investmentReturnRate = Number(investmentReturnRate) / 100;
  annualRaise = Number(annualRaise) / 100;
  pension = Number(pension);
  socialSecurity = Number(socialSecurity);
  postYears = Number(postYears);
  withdrawalRate = Number(withdrawalRate) / 100;
  inflationRate = Number(inflationRate) / 100;

  const data = [];
  let balance = savings;
  let contribution = annualSavings;
  let yearIncome = Number(income);
  const years = retirementAge - currentAge;

  for (let i = 0; i <= years; i++) {
    if (i > 0) {
      balance += contribution;
      balance *= 1 + investmentReturnRate;
      contribution *= 1 + annualRaise;
      yearIncome *= 1 + annualRaise;
    }
    data.push({
      age: currentAge + i,
      balance: Math.round(balance),
      income: Math.round(yearIncome),
      realIncome: Math.round(yearIncome / Math.pow(1 + inflationRate, i))
    });
  }

  let postBalance = balance;
  let withdrawalAmount = 0;
  let socialSecurityAmount = socialSecurity;
  let pensionAmount = pension;
  for (let i = 1; i <= postYears; i++) {
    const age = retirementAge + i;
    postBalance *= 1 + investmentReturnRate;
    if (i === 1) {
      withdrawalAmount = postBalance * withdrawalRate;
    } else {
      withdrawalAmount *= 1.03;
      socialSecurityAmount *= 1 + inflationRate;
      pensionAmount *= 1 + inflationRate;
    }
    const withdrawal = Math.round(withdrawalAmount);
    postBalance -= withdrawal;
    const ssYear = Math.round(socialSecurityAmount);
    const pensionYear = Math.round(pensionAmount);
    const incomeYear = withdrawal + pensionYear + ssYear;
    data.push({
      age,
      balance: Math.round(postBalance),
      income: Math.round(incomeYear),
      realIncome: Math.round(incomeYear / Math.pow(1 + inflationRate, years + i)),
      withdrawal,
      pension: pensionYear,
      socialSecurity: ssYear
    });
  }

  return data;
}

export function estimateSocialSecurity({ income = 0, currentAge = 0, retirementAge = 0 }) {
  income = Number(income);
  currentAge = Number(currentAge);
  retirementAge = Number(retirementAge);
  const years = Math.min(35, Math.max(0, retirementAge - currentAge));
  if (!income || years === 0) return 0;
  const averageIncome = (income * years) / 35;
  return Math.round(averageIncome * 0.4);
}

const PLANNING_KEY = 'planningData';
let planningCache = null;
let planningInitialized = false;

function isObject(val) {
  return val && typeof val === 'object' && !Array.isArray(val);
}

function deepMerge(base = {}, override = {}) {
  const out = { ...base };
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

export function clearPlanningCache() {
  planningCache = null;
  planningInitialized = false;
  try {
    localStorage.removeItem(PLANNING_KEY);
  } catch (err) {
    console.warn('Failed to clear planning data:', err);
  }
}

export async function loadPlanningData({ recoverLocal = false } = {}) {
  const user = getCurrentUser?.();
  if (!user) {
    localStorage.removeItem(PLANNING_KEY);
    planningCache = {};
    return planningCache;
  }

  // Always pull from Firestore first and treat it as authoritative
  let cloudData = {};
  try {
    const snap = await db
      .collection('users').doc(user.uid)
      .collection('settings').doc(PLANNING_KEY)
      .get();
    if (snap) {
      cloudData = snap.exists ? snap.data() : {};
    }
  } catch (err) {
    console.error('Failed to fetch planning data:', err);
  }
  const hasCloudData = Object.keys(cloudData).length > 0;

  planningCache = cloudData || {};
  if (!planningCache.lastUpdated) {
    planningCache.lastUpdated = Date.now();
  }
  const cloudTs = planningCache.lastUpdated || 0;

  // Load any local data but do not automatically merge it
  let localData = {};
  const stored = localStorage.getItem(PLANNING_KEY);
  if (stored) {
    try {
      localData = JSON.parse(stored) || {};
    } catch (err) {
      console.warn('Failed to parse stored planning data:', err);
    }
  }

  if (!hasCloudData && Object.keys(localData).length) {
    planningCache = { ...localData };
    planningCache.lastUpdated = planningCache.lastUpdated || Date.now();
    localStorage.setItem(PLANNING_KEY, JSON.stringify(planningCache));
    return planningCache;
  }

  const localTs = localData.lastUpdated || 0;
  let shouldMerge = recoverLocal;
  if (!shouldMerge && localTs > cloudTs && Object.keys(localData).length) {
    if (typeof window !== 'undefined' && window.confirm) {
      shouldMerge = window.confirm('Local planning data found. Merge with cloud data?');
    }
  }

  if (shouldMerge) {
    planningCache = deepMerge(cloudData, localData);
    planningCache.lastUpdated = Date.now();
    try {
      await db
        .collection('users').doc(user.uid)
        .collection('settings').doc(PLANNING_KEY)
        .set(planningCache, { merge: true });
      // Clear local copy once it's synced to avoid repeat merges
      localStorage.removeItem(PLANNING_KEY);
    } catch (err) {
      console.error('Failed to save planning data:', err);
    }
  } else {
    // Use the cloud data as is and overwrite any stale local copy
    localStorage.setItem(PLANNING_KEY, JSON.stringify(planningCache));
  }

  if (planningCache && planningCache.finance) {
    console.log('Finance data found:', planningCache.finance);
  } else {
    console.log('No finance data found in planning cache');
  }

  return planningCache;
}

export async function savePlanningData(data) {
  planningCache = { ...(data || {}) };
  planningCache.lastUpdated = Date.now();
  const user = getCurrentUser?.();
  if (!user) {
    localStorage.removeItem(PLANNING_KEY);
    return;
  }
  localStorage.setItem(PLANNING_KEY, JSON.stringify(planningCache));
  try {
    await db
      .collection('users').doc(user.uid)
      .collection('settings').doc(PLANNING_KEY)
      .set(planningCache, { merge: true });
  } catch (err) {
    console.error('Failed to save planning data:', err);
  }
}
async function saveAssetSnapshotToDB(snapshot) {
  const user = getCurrentUser?.();
  if (!user) return;
  try {
    const dayId = snapshot.timestamp.slice(0, 10);
    await db
      .collection('users').doc(user.uid)
      .collection('assetHistory').doc(dayId)
      .set(snapshot);
  } catch (err) {
    console.error('Failed to save asset snapshot:', err);
  }
}

async function loadAssetHistoryFromDB() {
  const user = getCurrentUser?.();
  if (!user) return [];
  try {
    const snap = await db.collection('users').doc(user.uid)
      .collection('assetHistory')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
    return snap.docs.map(doc => doc.data());
  } catch (err) {
    console.error('Failed to load asset history:', err);
    return [];
  }
}

export async function initPlanningPanel() {
  const panel = document.getElementById('planningPanel');
  if (!panel || planningInitialized) return;
  const user = getCurrentUser?.();
  if (!user) return;
  planningInitialized = true;

  const saved = await loadPlanningData();
  let currentData = saved || {};
  currentData.finance = currentData.finance || {};
  currentData.assets = currentData.assets || {};
  currentData.budget = currentData.budget || {};
  currentData.history = (currentData.history || [])
    .filter(r => r.timestamp && !isNaN(new Date(r.timestamp).getTime()))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .reduce((acc, cur) => {
      const day = new Date(cur.timestamp).toDateString();
      acc[day] = cur;
      return acc;
    }, {});
  currentData.history = Object.values(currentData.history);
  localStorage.setItem(PLANNING_KEY, JSON.stringify(currentData));

  const container = document.getElementById('planningContainer');
  container.innerHTML = `
    <div class="planning-grid">
      <form id="planningForm" class="planning-form">
        <div class="planning-section">
          <h3>Finances</h3>
        <label>Current Age <input type="number" name="curAge" value="${currentData.finance.curAge ?? ''}" /></label>
        <label>Retirement Age <input type="number" name="retAge" value="${currentData.finance.retAge ?? ''}" /></label>
        <label>Current Net Income <input type="number" name="income" value="${currentData.finance.income ?? ''}" /></label>
        <label>Annual Savings <input type="number" name="annualSavings" value="${currentData.finance.annualSavings ?? ''}" /></label>
        <label>Annual Raise % <input type="number" name="annualRaise" value="${currentData.finance.annualRaise ?? ''}" /></label>
        <label>Inflation Rate % <input type="number" name="inflation" value="${currentData.finance.inflation ?? 0}" /></label>
        <label>Estimated Pension <input type="number" name="pension" value="${currentData.finance.pension ?? ''}" /></label>
        <label>Retirement Withdrawal % <input type="number" name="withdrawalRate" value="${currentData.finance.withdrawalRate ?? 4}" /></label>
        <label>Post Years <input type="number" name="postYears" value="${currentData.finance.postYears ?? 30}" /></label>
        <label>Social Security <input type="number" name="socialSecurity" value="${currentData.finance.socialSecurity ?? ''}" /></label>
        <div id="ssEstimate" style="margin-bottom:0.5em;font-style:italic"></div>
      </div>
      <div class="planning-section">
        <h3>Assets</h3>
        <label>Real Estate <input type="number" name="realEstate" value="${currentData.assets.realEstate ?? ''}" /></label>
        <label>Car <input type="number" name="carValue" value="${currentData.assets.carValue ?? ''}" /></label>
        <label>Savings <input type="number" name="assetSavings" value="${currentData.assets.assetSavings ?? ''}" /></label>
        <label>Savings Return Rate % <input type="number" name="savingsReturnRate" value="${currentData.finance.savingsReturnRate ?? ''}" /></label>
        <label>Checking <input type="number" name="checking" value="${currentData.assets.checking ?? ''}" /></label>
        <label>Investment Accounts <input type="number" name="investment" value="${currentData.assets.investment ?? ''}" /></label>
        <label>Investment Return Rate % <input type="number" name="investmentReturnRate" value="${currentData.finance.investmentReturnRate ?? ''}" /></label>
      </div>
      <div class="planning-section">
        <h3>Liabilities</h3>
        <label>Rolling Credit <input type="number" name="rollingCredit" value="${currentData.budget.rollingCredit ?? ''}" /></label>
      </div>
      </form>
      <div class="planning-columns">
        <div id="workingColumn" class="planning-right"></div>
        <div id="retirementColumn" class="planning-right" style="margin-top:0;border-left:4px solid #d0decf;"></div>
      </div>
      <div id="assetsTotal" class="full-column" style="margin-top:1em;flex-basis:100%;"></div>
    </div>
    <div id="assetHistory" style="margin-top:1em;"></div>
  `;

  const form = container.querySelector('#planningForm');
  const assetsTotalDiv = container.querySelector('#assetsTotal');
  const workingColumnDiv = container.querySelector('#workingColumn');
  const retirementTableDiv = container.querySelector('#retirementColumn');
  const ssEstimateDiv = container.querySelector('#ssEstimate');
  const assetHistoryDiv = container.querySelector('#assetHistory');

  async function renderAssetHistory() {
    const dbHistory = await loadAssetHistoryFromDB();
    const combined = [...(currentData.history || []), ...dbHistory]
      .filter(r => r.timestamp && !isNaN(new Date(r.timestamp).getTime()))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .reduce((acc, cur) => {
        const day = new Date(cur.timestamp).toDateString();
        if (!acc.some(x => new Date(x.timestamp).toDateString() === day)) {
          acc.push(cur);
        }
        return acc;
      }, []);
    assetHistoryDiv.innerHTML = '<h3>Asset History</h3><table><thead><tr><th>Date</th><th>Age</th><th>Balance</th></tr></thead><tbody>' +
      combined.map(r => `<tr><td>${new Date(r.timestamp).toLocaleDateString()}</td><td>${r.age}</td><td>$${r.balance.toLocaleString()}</td></tr>`).join('') +
      '</tbody></table>';
  }

  function renderAll() {
    const values = {
      curAge: form.curAge.value,
      retAge: form.retAge.value,
      income: Number(form.income.value || 0),
      annualSavings: Number(form.annualSavings.value || 0),
      annualRaise: form.annualRaise.value,
      inflation: form.inflation.value,
      investmentReturnRate: Number(form.investmentReturnRate.value || 0),
      savingsReturnRate: Number(form.savingsReturnRate.value || 0),
      pension: Number(form.pension.value || 0),
      withdrawalRate: Number(form.withdrawalRate.value || 4),
      postYears: Number(form.postYears.value || 30),
      socialSecurity: Number(form.socialSecurity.value || 0),
      realEstate: Number(form.realEstate.value || 0),
      carValue: Number(form.carValue.value || 0),
      assetSavings: Number(form.assetSavings.value || 0),
      checking: Number(form.checking.value || 0),
      investment: Number(form.investment.value || 0),
      rollingCredit: Number(form.rollingCredit.value || 0),
      mortgage: 0
    };

    const estimatedSS = estimateSocialSecurity({
      income: values.income,
      currentAge: values.curAge,
      retirementAge: values.retAge
    });
    values.socialSecurity = values.socialSecurity || estimatedSS;
    ssEstimateDiv.textContent = values.socialSecurity === estimatedSS && estimatedSS
      ? `Estimated Social Security: $${estimatedSS.toLocaleString()}`
      : '';

    const assetTotal =
      values.realEstate + values.carValue + values.assetSavings + values.checking +
      values.investment - values.rollingCredit;
    assetsTotalDiv.textContent = `Total Assets: $${assetTotal.toLocaleString()}`;

    const investmentAssets = values.realEstate + values.carValue + values.investment;
    const savingsAssets = values.assetSavings + values.checking;
    const combinedReturnRate = assetTotal > 0
      ? ((investmentAssets * values.investmentReturnRate) + (savingsAssets * values.savingsReturnRate)) / assetTotal
      : 0;

    const finData = calculateFinanceProjection({
      currentAge: values.curAge,
      retirementAge: values.retAge,
      savings: assetTotal,
      income: values.income,
      annualSavings: values.annualSavings,
      annualRaise: values.annualRaise,
      inflationRate: values.inflation,
      investmentReturnRate: combinedReturnRate,
      pension: values.pension,
      socialSecurity: values.socialSecurity,
      postYears: values.postYears,
      withdrawalRate: values.withdrawalRate
    });

    function buildFinanceTable(rows, showExtras = true) {
      let html = '<table><thead><tr><th>Age</th><th>Balance</th><th>Income</th>';
      if (showExtras) {
        html += '<th>Withdrawals</th><th>Pension</th><th>Social Security</th>';
      }
      html += '</tr></thead><tbody>';
      html += rows.map(r => {
        let row = `<tr><td>${r.age}</td><td>$${r.balance.toLocaleString()}</td><td>${r.income ? '$' + r.income.toLocaleString() : ''}</td>`;
        if (showExtras) {
          row += `<td>${r.withdrawal ? '$' + r.withdrawal.toLocaleString() : ''}</td><td>${r.pension ? '$' + r.pension.toLocaleString() : ''}</td><td>${r.socialSecurity ? '$' + r.socialSecurity.toLocaleString() : ''}</td>`;
        }
        row += '</tr>';
        return row;
      }).join('');
      html += '</tbody></table>';
      return html;
    }

    const retirementAgeNum = Number(values.retAge);
    const workingData = finData.filter(r => r.age <= retirementAgeNum);
    const retirementData = finData.filter(r => r.age > retirementAgeNum);

    workingColumnDiv.innerHTML = `<h3 style="margin:0 0 4px;">Working Years</h3>${buildFinanceTable(workingData, false)}`;
    retirementTableDiv.innerHTML = `<h3 style="margin:0 0 4px;">Retirement</h3>${buildFinanceTable(retirementData)}`;

    currentData.finance = {
      curAge: values.curAge,
      retAge: values.retAge,
      income: values.income,
      annualSavings: values.annualSavings,
      annualRaise: values.annualRaise,
      inflation: values.inflation,
      investmentReturnRate: values.investmentReturnRate,
      savingsReturnRate: values.savingsReturnRate,
      pension: values.pension,
      withdrawalRate: values.withdrawalRate,
      postYears: values.postYears,
      socialSecurity: values.socialSecurity
    };
    currentData.assets = {
      realEstate: values.realEstate,
      carValue: values.carValue,
      assetSavings: values.assetSavings,
      checking: values.checking,
      investment: values.investment
    };
    currentData.budget = {
      rollingCredit: values.rollingCredit
    };

    const hist = currentData.history;
    const last = hist[hist.length - 1];
    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const required = ['curAge', 'realEstate', 'carValue', 'assetSavings', 'checking', 'investment', 'rollingCredit'];
    const allFilled = required.every(name => form[name].value.trim() !== '');
    if (allFilled && assetTotal > 0) {
      const snapObj = { timestamp: nowIso, age: values.curAge, balance: assetTotal };
      if (!last || new Date(last.timestamp).toDateString() !== nowDate.toDateString()) {
        hist.push(snapObj);
      } else {
        Object.assign(last, snapObj);
      }
      saveAssetSnapshotToDB(snapObj);
      savePlanningData(currentData);
    }

    renderAssetHistory();
  }

  form.addEventListener('input', renderAll);
  form.addEventListener('change', renderAll);
  renderAll();
}

if (typeof window !== 'undefined') {
  window.initPlanningPanel = initPlanningPanel;
  window.clearPlanningCache = clearPlanningCache;
}
