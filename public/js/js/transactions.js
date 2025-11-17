export async function initTransactionsPanel() {
  const panel = document.getElementById('transactionsPanel');
  if (!panel) return;
  panel.innerHTML = '<p>Loading...</p>';
  try {
    const res = await fetch('/api/transactions');
    if (!res.ok) throw new Error('Request failed');
    const data = await res.json();
    const txns = data.transactions || [];
    let html = '<table class="transactions-table"><thead><tr><th>Date</th><th>Name</th><th>Amount</th></tr></thead><tbody>';
    for (const tx of txns) {
      html += `<tr><td>${tx.date}</td><td>${tx.name}</td><td>${tx.amount}</td></tr>`;
    }
    html += '</tbody></table>';
    panel.innerHTML = html;
  } catch (err) {
    console.error('Failed to load transactions', err);
    panel.innerHTML = '<p class="error">Failed to load transactions</p>';
  }
}

if (typeof window !== 'undefined') {
  window.initTransactionsPanel = initTransactionsPanel;
}
