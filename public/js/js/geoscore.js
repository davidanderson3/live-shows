const STORAGE_KEY = 'geoscoreQuestions';

export const DEFAULT_QUESTIONS = [
  {
    question: 'Name a country in South America',
    answers: [
      { answer: 'Brazil', score: 10, count: 35 },
      { answer: 'Argentina', score: 9, count: 20 },
      { answer: 'Chile', score: 8, count: 15 },
      { answer: 'Peru', score: 7, count: 10 },
      { answer: 'Colombia', score: 6, count: 8 }
    ]
  },
  {
    question: 'Name a U.S. state that starts with M',
    answers: [
      { answer: 'Michigan', score: 10, count: 25 },
      { answer: 'Mississippi', score: 9, count: 15 },
      { answer: 'Montana', score: 8, count: 12 },
      { answer: 'Missouri', score: 7, count: 10 },
      { answer: 'Maryland', score: 6, count: 8 }
    ]
  },
  {
    question: 'Name a European capital city',
    answers: [
      { answer: 'Paris', score: 10, count: 28 },
      { answer: 'London', score: 9, count: 26 },
      { answer: 'Berlin', score: 8, count: 20 },
      { answer: 'Rome', score: 7, count: 18 },
      { answer: 'Madrid', score: 6, count: 12 }
    ]
  }
];

export async function loadQuestions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed;
    }
  } catch {}
  try {
    const res = await fetch('geoscore_questions.json');
    if (res.ok) {
      const data = await res.json();
      saveQuestions(data);
      return data;
    }
  } catch {}
  // If nothing stored, seed with defaults
  saveQuestions(DEFAULT_QUESTIONS);
  return JSON.parse(JSON.stringify(DEFAULT_QUESTIONS));
}

export function saveQuestions(qs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(qs));
  } catch {}
}

export async function initGeoScorePanel() {
  const container = document.getElementById('geoscoreAdmin');
  if (!container) return;
  container.innerHTML = '';

  const questions = await loadQuestions();
  let editingIndex = null;

  const form = document.createElement('div');
  form.id = 'geoscoreForm';

  const qInput = document.createElement('input');
  qInput.type = 'text';
  qInput.placeholder = 'Question';
  form.appendChild(qInput);

  const answersDiv = document.createElement('div');
  answersDiv.className = 'geoscore-answers';
  form.appendChild(answersDiv);

  const bulkInput = document.createElement('textarea');
  bulkInput.placeholder = 'Bulk answers (Answer|Score|Count per line)';
  form.appendChild(bulkInput);

  const bulkBtn = document.createElement('button');
  bulkBtn.type = 'button';
  bulkBtn.textContent = 'Add Bulk Answers';
  bulkBtn.addEventListener('click', () => {
    const lines = bulkInput.value.split('\n').map(l => l.trim()).filter(l => l);
    lines.forEach(line => {
      const [ans, sc = '', ct = ''] = line.split('|').map(p => p.trim());
      addAnswerField(ans, sc, ct);
    });
    bulkInput.value = '';
  });
  form.appendChild(bulkBtn);

  function addAnswerField(ans = '', score = '', count = 0) {
    const row = document.createElement('div');
    row.className = 'geoscore-answer-row';

    const a = document.createElement('input');
    a.type = 'text';
    a.placeholder = 'Answer';
    a.value = ans;

    const s = document.createElement('input');
    s.type = 'number';
    s.placeholder = 'Score';
    s.value = score;

    const c = document.createElement('input');
    c.type = 'number';
    c.placeholder = 'Count';
    c.value = count;

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '✖';
    rm.addEventListener('click', () => row.remove());

    row.append(a, s, c, rm);
    answersDiv.appendChild(row);
  }

  addAnswerField();

  const addAnswerBtn = document.createElement('button');
  addAnswerBtn.type = 'button';
  addAnswerBtn.textContent = 'Add Answer';
  addAnswerBtn.addEventListener('click', () => addAnswerField());
  form.appendChild(addAnswerBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save Question';
  saveBtn.addEventListener('click', () => {
    const question = qInput.value.trim();
    if (!question) return;
    const answers = Array.from(answersDiv.querySelectorAll('.geoscore-answer-row')).map(row => {
      const [a, s, c] = row.querySelectorAll('input');
      return {
        answer: a.value.trim(),
        score: Number(s.value) || 0,
        count: Number(c.value) || 0
      };
    }).filter(a => a.answer);
    if (editingIndex !== null) {
      questions[editingIndex] = { question, answers };
    } else {
      questions.push({ question, answers });
    }
    saveQuestions(questions);
    renderList();
    qInput.value = '';
    answersDiv.innerHTML = '';
    addAnswerField();
    editingIndex = null;
    saveBtn.textContent = 'Save Question';
    cancelEditBtn.style.display = 'none';
  });
  form.appendChild(saveBtn);

  const cancelEditBtn = document.createElement('button');
  cancelEditBtn.type = 'button';
  cancelEditBtn.textContent = 'Cancel';
  cancelEditBtn.style.display = 'none';
  cancelEditBtn.addEventListener('click', () => {
    editingIndex = null;
    qInput.value = '';
    answersDiv.innerHTML = '';
    addAnswerField();
    saveBtn.textContent = 'Save Question';
    cancelEditBtn.style.display = 'none';
  });
  form.appendChild(cancelEditBtn);

  container.appendChild(form);

  const list = document.createElement('ul');
  list.id = 'geoscoreList';
  container.appendChild(list);

  function renderList() {
    list.innerHTML = '';
    questions.forEach((q, idx) => {
      const li = document.createElement('li');

      const header = document.createElement('div');
      header.textContent = q.question;
      li.appendChild(header);

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => {
        editingIndex = idx;
        qInput.value = q.question;
        answersDiv.innerHTML = '';
        q.answers.forEach(a => addAnswerField(a.answer, a.score, a.count));
        saveBtn.textContent = 'Update Question';
        cancelEditBtn.style.display = 'inline-block';
      });
      li.appendChild(edit);

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.addEventListener('click', () => {
        questions.splice(idx, 1);
        saveQuestions(questions);
        renderList();
      });
      li.appendChild(del);

      const ansList = document.createElement('ul');
      q.answers.forEach(a => {
        const ai = document.createElement('li');
        ai.textContent = `${a.answer} (${a.count || 0})`;
        ansList.appendChild(ai);
      });
      li.appendChild(ansList);

      list.appendChild(li);
    });
  }

  renderList();
}

if (typeof window !== 'undefined') {
  window.initGeoScorePanel = initGeoScorePanel;
}

