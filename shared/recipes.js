function normalizeRecipeQuery(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function recipeCacheKeyParts(query) {
  const normalized = normalizeRecipeQuery(query);
  return ['spoonacular', normalized || 'default'];
}

module.exports = {
  normalizeRecipeQuery,
  recipeCacheKeyParts
};
