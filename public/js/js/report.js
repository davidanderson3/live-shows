import { loadDecisions } from './helpers.js';

function getLastNDates(n) {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < n; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
    }
    return dates.reverse();
}

function matchDate(dateCompleted, targetDate) {
    if (!dateCompleted) return false;
    const normalized = new Date(dateCompleted).toISOString().split('T')[0];
    return normalized === targetDate;
}

function isDailyTask(item) {
    return item.type === 'task' && item.recurs === 'daily';
}


export async function renderDailyTaskReport(user, db) {

    const [decisions, completionsSnap] = await Promise.all([
        loadDecisions(),
        db.collection('taskCompletions').doc(user.uid).get()
    ]);



    const completionMap = completionsSnap.exists ? completionsSnap.data() : {};
    const dates = getLastNDates(10);

    const headerRow = document.getElementById('headerRow');
    const tbody = document.getElementById('reportBody');

    for (const date of dates) {
        const completedIds = completionMap[date] || [];
    }

    const tasks = decisions.filter(t => t.type === 'task' && t.text.startsWith('[Daily]'));



    for (const task of tasks) {
        const tr = document.createElement('tr');
        const taskCell = document.createElement('td');
        taskCell.textContent = task.text;
        tr.appendChild(taskCell);

        for (const date of dates) {
            const td = document.createElement('td');
            const completedIds = completionMap[date] || [];
            if (completedIds.includes(task.id)) {
                td.classList.add('completed');
                td.textContent = '✓';
            } else {
                td.textContent = '';
            }
            tr.appendChild(td);
        }

        tbody.appendChild(tr);
    }

    if (tasks.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = dates.length + 1;
        td.textContent = 'No daily tasks found.';
        td.style.textAlign = 'center';
        tr.appendChild(td);
        tbody.appendChild(tr);
    }
}

