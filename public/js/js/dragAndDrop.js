
import { saveGoalOrder, loadDecisions, saveDecisions } from './helpers.js';

let dragSrcEl = null;

/**
 * Call once on startup to suppress unwanted default drag behavior.
 */
export function initializeGlobalDragHandlers() {
    ['dragover', 'drop', 'dragenter', 'dragstart'].forEach(event => {
        document.addEventListener(event, e => {
            const allowed =
                e.target.closest('.decision') ||
                e.target.closest('.goal-card') ||
                e.target.closest('.daily-task-wrapper') ||
                e.target.closest('.list-tab');

            if (!allowed) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    });
}

/**
 * Enables drag-and-drop reordering for a goal card.
 *
 * @param {HTMLElement} wrapper  The .goal-card element
 */
export function enableGoalDragAndDrop(wrapper) {
    const goalList = document.getElementById('goalList');

    wrapper.addEventListener('dragstart', e => {
        if (e.target.closest('[data-task-id]')) {
            // Don’t hijack a task drag
            e.stopPropagation();
            return;
        }
        dragSrcEl = wrapper;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', wrapper.dataset.goalId);
        wrapper.classList.add('dragging');
    });

    wrapper.addEventListener('dragover', e => {
        if (e.target.closest('[data-task-id]')) return;
        e.preventDefault();
        e.stopPropagation();
        wrapper.classList.add('goal-drop-indicator');
    });

    wrapper.addEventListener('dragleave', () => {
        wrapper.classList.remove('goal-drop-indicator');
    });

    wrapper.addEventListener('drop', async e => {
        if (e.target.closest('[data-task-id]')) return;
        e.preventDefault();
        e.stopPropagation();
        wrapper.classList.remove('goal-drop-indicator');

        if (dragSrcEl && dragSrcEl !== wrapper) {
            const draggedId = dragSrcEl.dataset.goalId;
            const dropTargetId = wrapper.dataset.goalId;
            const siblings = [...goalList.children];
            const from = siblings.findIndex(el => el.dataset.goalId === draggedId);
            const to = siblings.findIndex(el => el.dataset.goalId === dropTargetId);

            if (from > -1 && to > -1) {
                goalList.insertBefore(dragSrcEl, from < to ? wrapper.nextSibling : wrapper);
                const newOrder = [...goalList.children].map(el => el.dataset.goalId).filter(Boolean);
                await saveGoalOrder(newOrder);
            }
        }
        dragSrcEl = null;
    });

    wrapper.addEventListener('dragend', () => {
        wrapper.classList.remove('dragging');
    });
}

/**
 * Enables drag-and-drop reordering for tasks within a goal.
 *
 * @param {HTMLElement} wrapper  The .decision.indent-1 element
 * @param {HTMLElement} taskList The container div.task-list
 * @param {string}      goalId   The parent goal’s ID
 */
export function enableTaskDragAndDrop(wrapper, taskList, goalId) {
    wrapper.addEventListener('dragstart', e => {
        e.stopPropagation();
        dragSrcEl = wrapper;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', wrapper.dataset.taskId);
        wrapper.classList.add('dragging');
    });

    wrapper.addEventListener('dragover', e => {
        e.preventDefault();
        e.stopPropagation();
        wrapper.classList.add('drag-over');
    });

    wrapper.addEventListener('dragleave', () => {
        wrapper.classList.remove('drag-over');
    });

    wrapper.addEventListener('drop', async e => {
        e.preventDefault();
        e.stopPropagation();
        wrapper.classList.remove('drag-over');

        const droppedId = e.dataTransfer.getData('text/plain');
        const targetId = wrapper.dataset.taskId;
        if (!droppedId || droppedId === targetId) return;

        // reorder the DOM
        const children = [...taskList.children].filter(el => el.dataset.taskId);
        const fromIdx = children.findIndex(el => el.dataset.taskId === droppedId);
        const toIdx = children.findIndex(el => el.dataset.taskId === targetId);
        if (fromIdx === -1 || toIdx === -1) return;

        const draggedEl = children[fromIdx];
        taskList.insertBefore(draggedEl, fromIdx < toIdx ? wrapper.nextSibling : wrapper);

        // persist the new order
        const updated = await loadDecisions();
        const underGoal = updated.filter(i => i.parentGoalId === goalId && !i.completed);
        const others = updated.filter(i => i.parentGoalId !== goalId || i.completed);
        const newOrder = [...taskList.children].map(el => el.dataset.taskId);
        const reordered = newOrder.map(id => underGoal.find(t => t.id === id)).filter(Boolean);
        await saveDecisions([...others, ...reordered]);

        // re-render only this goal’s tasks
        const items = await loadDecisions();
        const parentGoal = items.find(i => i.id === goalId);
        const container = wrapper.closest('.goal-children');
        if (parentGoal && container) {
            // assume renderChildren is globally available
            renderChildren(parentGoal, items, container);
        }
    });

    wrapper.addEventListener('dragend', () => {
        wrapper.classList.remove('dragging');
    });
}
