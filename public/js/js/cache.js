let decisionsCache = null;
let goalOrderCache = null;

export function getDecisionsCache() {
  return decisionsCache;
}

export function setDecisionsCache(items) {
  decisionsCache = items;
}

export function clearDecisionsCache() {
  decisionsCache = null;
}

export function getGoalOrderCache() {
  return goalOrderCache;
}

export function setGoalOrderCache(order) {
  goalOrderCache = order;
}

export function clearGoalOrderCache() {
  goalOrderCache = null;
}
