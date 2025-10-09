import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.resolve(__dirname, '../data/media-state.json');
const outputPath = path.resolve(__dirname, '../reports/media-summary.md');

const RATING_BUCKETS = [
  { label: '≥9.0', min: 9 },
  { label: '8.0–8.9', min: 8, max: 8.9 },
  { label: '7.0–7.9', min: 7, max: 7.9 },
  { label: '6.0–6.9', min: 6, max: 6.9 },
  { label: '<6.0', min: -Infinity, max: 5.99 }
];

function bucketRating(value) {
  if (value == null || Number.isNaN(value)) return 'Unrated';
  for (const bucket of RATING_BUCKETS) {
    if (bucket.max == null && value >= bucket.min) return bucket.label;
    if (bucket.min === -Infinity && value <= bucket.max) return bucket.label;
    if (value >= bucket.min && value <= bucket.max) return bucket.label;
  }
  return 'Unrated';
}

function buildRatingDistribution(items, key = 'rating') {
  const counts = new Map();
  for (const item of items) {
    const value = Number(item?.[key]);
    const label = bucketRating(Number.isFinite(value) ? value : null);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => {
    const order = RATING_BUCKETS.map(b => b.label);
    const idxA = order.indexOf(a[0]);
    const idxB = order.indexOf(b[0]);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA === -1 && idxB === -1) return a[0].localeCompare(b[0]);
    return idxA === -1 ? 1 : -1;
  });
}

function aggregateGenres(items) {
  const counts = new Map();
  for (const item of items) {
    const genres = Array.isArray(item?.genres) ? item.genres : [];
    for (const raw of genres) {
      const genre = typeof raw === 'string' ? raw.trim() : '';
      if (!genre) continue;
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function formatDistribution(entries) {
  if (!entries.length) return 'none';
  return entries.map(([label, count]) => `${label}: ${count}`).join(', ');
}

function formatTopGenres(items, limit = 5) {
  const genres = aggregateGenres(items).slice(0, limit);
  if (!genres.length) return 'none';
  return genres.map(([name, count]) => `${name} (${count})`).join(', ');
}

function average(values) {
  const filtered = values.filter(v => Number.isFinite(v));
  if (!filtered.length) return null;
  const total = filtered.reduce((sum, v) => sum + v, 0);
  return total / filtered.length;
}

function summarizeStream(title, items) {
  const total = items.length;
  const shown = items.filter(item => item.shown).length;
  const hidden = total - shown;
  const ratingDistribution = buildRatingDistribution(items);
  const topGenres = formatTopGenres(items);

  return [
    `### ${title}`,
    `* **Titles**: ${total} (shown: ${shown}, hidden: ${hidden})`,
    `* **Rating distribution**: ${formatDistribution(ratingDistribution)}`,
    `* **Top genres**: ${topGenres}`,
    ''
  ].join('\n');
}

function summarizeSaved(title, items) {
  const total = items.length;
  const interestCounts = new Map();
  for (const item of items) {
    const level = Number(item?.interestLevel);
    const label = Number.isFinite(level) ? level : 'unknown';
    interestCounts.set(label, (interestCounts.get(label) || 0) + 1);
  }
  const sortedInterest = Array.from(interestCounts.entries()).sort((a, b) => {
    if (typeof a[0] === 'number' && typeof b[0] === 'number') return b[0] - a[0];
    if (typeof a[0] === 'number') return -1;
    if (typeof b[0] === 'number') return 1;
    return String(a[0]).localeCompare(String(b[0]));
  });
  const ratingDistribution = buildRatingDistribution(items);
  const topGenres = formatTopGenres(items);

  const interestText = sortedInterest.length
    ? sortedInterest.map(([level, count]) => `${level}: ${count}`).join(', ')
    : 'none recorded';

  return [
    `### ${title}`,
    `* **Titles saved**: ${total}`,
    `* **Interest levels**: ${interestText}`,
    `* **Rating distribution**: ${formatDistribution(ratingDistribution)}`,
    `* **Top genres**: ${topGenres}`,
    ''
  ].join('\n');
}

function summarizeWatched(title, items) {
  const total = items.length;
  const globalRatings = items.map(item => Number(item?.rating));
  const personalRatings = items.map(item => Number(item?.personalRating));
  const avgGlobal = average(globalRatings);
  const avgPersonal = average(personalRatings);
  const ratingDistribution = buildRatingDistribution(items);
  const personalDistribution = buildRatingDistribution(items, 'personalRating');
  const topGenres = formatTopGenres(items);

  const avgLineParts = [];
  if (avgGlobal != null) avgLineParts.push(`catalog rating avg: ${avgGlobal.toFixed(2)}`);
  if (avgPersonal != null) avgLineParts.push(`personal rating avg: ${avgPersonal.toFixed(2)}`);
  const averageLine = avgLineParts.length ? avgLineParts.join(' | ') : 'no ratings recorded';

  return [
    `### ${title}`,
    `* **Titles watched**: ${total}`,
    `* **Average ratings**: ${averageLine}`,
    `* **Catalog rating distribution**: ${formatDistribution(ratingDistribution)}`,
    `* **Personal rating distribution**: ${formatDistribution(personalDistribution)}`,
    `* **Top genres**: ${topGenres}`,
    ''
  ].join('\n');
}

async function main() {
  const raw = await readFile(dataPath, 'utf8');
  const state = JSON.parse(raw);

  const sections = [
    '# Media Library Summary',
    '',
    '## Movies',
    summarizeStream('Movie Stream', state.movieStream || []),
    summarizeSaved('Saved Movies', state.movieSaved || []),
    summarizeWatched('Watched Movies', state.movieWatched || []),
    '## TV Shows',
    summarizeStream('Show Stream', state.tvStream || []),
    summarizeSaved('Saved Shows', state.tvSaved || []),
    summarizeWatched('Watched Shows', state.tvWatched || []),
  ];

  await writeFile(outputPath, sections.join('\n'));
}

main().catch(err => {
  console.error('Failed to generate media summary:', err);
  process.exit(1);
});
