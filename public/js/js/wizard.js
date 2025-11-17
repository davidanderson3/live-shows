import { parseNaturalDate, generateId, loadDecisions, saveDecisions, saveGoalOrder, loadGoalOrder } from './helpers.js';
import { appendGoalToDOM, refreshGoalInDOM } from './goals.js';


export const wizardState = {
  step: 0,
  goalText: '',
  calendarStartDate: '',
  calendarEndDate: '',
  subgoals: [],
  editingGoalId: null
};

let wizardContainer = null;
let addProjectBtn = null;

export function initWizard(uiRefs) {
  // Early exit if key UI elements are missing
  if (!uiRefs?.wizardContainer || !uiRefs?.addProjectBtn) {
    console.warn('⚠️ initWizard skipped — missing required UI elements.');
    return;
  }

  ({
    wizardContainer,
    addProjectBtn
  } = uiRefs);

  uiRefs.addProjectBtn.onclick = () => {
    Object.assign(wizardState, {
      step: 0,
      goalText: '',
      calendarStartDate: '',
      calendarEndDate: '',
      subgoals: [],
      editingGoalId: null
    });
    wizardContainer.style.display = 'flex';
    addProjectBtn.style.display = 'none';
    renderWizardStep(uiRefs.wizardStep, uiRefs.backBtn);
  };

  uiRefs.cancelBtn.onclick = () => {
    wizardContainer.style.display = 'none';
    addProjectBtn.style.display = 'none';
  };

  uiRefs.backBtn.onclick = () => {
    wizardState.step--;
    renderWizardStep(uiRefs.wizardStep, uiRefs.backBtn);
  };

  uiRefs.nextBtn.onclick = async () => {
    const nextBtn = uiRefs.nextBtn;
    nextBtn.disabled = true;

    try {
      if (wizardState.step === 0) {
        const input = document.getElementById('goalTextInput');
        if (!input) {
          renderWizardStep(uiRefs.wizardStep, uiRefs.backBtn);
          return;
        }
        wizardState.goalText = input.value.trim();
        if (!wizardState.goalText) {
          alert("Project cannot be empty.");
          return;
        }
      } else if (wizardState.step === 1) {
        const textarea = document.getElementById('taskList');
        if (!textarea) {
          renderWizardStep(uiRefs.wizardStep, uiRefs.backBtn);
          return;
        }
        wizardState.subgoals = textarea.value
          .split('\n').map(t => t.trim()).filter(Boolean);
      } else if (wizardState.step === 2) {
        const startInput = document.getElementById('goalStartInput');
        const endInput = document.getElementById('goalEndInput');
        if (startInput) {
          const val = startInput.value.trim();
          wizardState.calendarStartDate = parseNaturalDate(val) || val;
        }
        if (endInput) {
          const val = endInput.value.trim();
          wizardState.calendarEndDate = parseNaturalDate(val) || val;
        }
        await saveGoalWizard();
        return;
      }

      wizardState.step++;
      renderWizardStep(uiRefs.wizardStep, uiRefs.backBtn);
    } finally {
      nextBtn.disabled = false;
    }
  };

  // Advance wizard when Enter is pressed on inputs
  if (wizardContainer.addEventListener) {
    wizardContainer.addEventListener('keydown', e => {
      if (e.key === 'Enter' &&
          e.target.tagName !== 'TEXTAREA' &&
          e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        uiRefs.nextBtn.click();
      }
    });
  }
}

function renderWizardStep(container, backBtn) {
  container.innerHTML = '';
  backBtn.style.display = wizardState.step > 0 ? 'inline-block' : 'none';

  if (wizardState.step === 0) {
    container.innerHTML = `
      <label for="goalTextInput"><strong>Project:</strong></label>
      <input id="goalTextInput" value="${wizardState.goalText}" style="margin-left:8px; width: 80%;" />
    `;
  } else if (wizardState.step === 1) {
    container.innerHTML = `
      <label>Subprojects (optional):</label>
      <textarea id="taskList" rows="4" placeholder="One per line">${wizardState.subgoals.join('\n')}</textarea>
    `;
  } else {
    container.innerHTML = `
      <label for="goalStartInput">Start date (optional):</label>
      <input id="goalStartInput" type="date" value="${wizardState.calendarStartDate}" style="margin-left:8px;" />
      <br/>
      <label for="goalEndInput">End date (optional):</label>
      <input id="goalEndInput" type="date" value="${wizardState.calendarEndDate}" style="margin-left:8px;" />
    `;
  }
  container.querySelector('input, textarea')?.focus();
}

async function saveGoalWizard() {
  const all = await loadDecisions();

  const isEdit = !!wizardState.editingGoalId;
  const goalId = isEdit ? wizardState.editingGoalId : generateId();

  const newGoal = {
    id: goalId,
    type: 'goal',
    text: wizardState.goalText,
    notes: '',
    completed: false,
    resolution: '',
    dateCompleted: '',
    parentGoalId: null,
    hiddenUntil: null,
    deadline: '',
    scheduled: wizardState.calendarStartDate || '',
    scheduledEnd: wizardState.calendarEndDate || ''
  };

  const newItems = [newGoal];

  wizardState.subgoals.forEach(goalText => {
    newItems.push({
      id: generateId(),
      type: 'goal',
      text: goalText,
      notes: '',
      completed: false,
      resolution: '',
      dateCompleted: '',
      parentGoalId: goalId,
      hiddenUntil: null,
      deadline: '',
      scheduled: '',
      scheduledEnd: ''
    });
  });

  const updatedItems = isEdit
    ? all.filter(item => item.id !== goalId && item.parentGoalId !== goalId)
    : all;

  await saveDecisions([...updatedItems, ...newItems]);

  // calendarStartDate/End already persisted on the goal above

  const currentGoalOrder = await loadGoalOrder();
  const newGoalOrder = isEdit ? currentGoalOrder : [...currentGoalOrder, goalId];
  await saveGoalOrder(newGoalOrder);

  wizardState.editingGoalId = null;
    wizardContainer.style.display = 'none';
    addProjectBtn.style.display = 'none';
  if (isEdit) {
    refreshGoalInDOM(newGoal, [...updatedItems, ...newItems]);
  } else {
    appendGoalToDOM(newGoal, [...updatedItems, ...newItems]);
  }
}

export { saveGoalWizard };
