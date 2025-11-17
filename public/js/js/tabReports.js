import { loadDecisions, loadLists } from './helpers.js';

export async function initTabReports(user, db) {
  const decisions = await loadDecisions();
  renderGoalsReport(decisions);
  const lists = await loadLists();
  renderListsReport(lists);
  // Calendar and Metrics tabs currently have no data-driven reports
}

export function renderGoalsReport(items) {
  const container = document.getElementById('goalsReport');
  if (!container) return;
  container.innerHTML = '';
}

function renderListsReport(lists) {
  const container = document.getElementById('listsReport');
  if (!container) return;
  if (!lists.length) {
    container.textContent = 'No lists yet.';
    return;
  }
  container.innerHTML = '<h3>List Sizes</h3><canvas></canvas>';
  const ctx = container.querySelector('canvas').getContext('2d');
  const labels = lists.map(l => l.name);
  const data = lists.map(l => (l.items || []).length);
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Items',
        data,
        backgroundColor: '#5bc0de'
      }]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } }
    }
  });
  container.textContent = `Lists: ${lists.length}`;
}

