const { getFirestore, serverTimestamp } = require('./firestore');

function serializePart(part) {
  if (part === null || part === undefined) return '';
  if (typeof part === 'string') return part;
  if (typeof part === 'number' || typeof part === 'boolean') return String(part);
  if (typeof URLSearchParams !== 'undefined' && part instanceof URLSearchParams) {
    return Array.from(part.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
  }
  if (Array.isArray(part)) {
    return part.map(serializePart).join('|');
  }
  if (typeof part === 'object') {
    return Object.entries(part)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key}:${serializePart(value)}`)
      .join(',');
  }
  return String(part);
}

function buildCacheId(parts) {
  const normalized = Array.isArray(parts) ? parts.map(serializePart) : [serializePart(parts)];
  const raw = normalized.join('||');
  return Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function readCachedResponse(collection, parts, ttlMs) {
  const db = getFirestore();
  if (!db) return null;
  const docId = buildCacheId(parts);
  try {
    const snap = await db.collection(collection).doc(docId).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const fetchedAt = data.fetchedAt;
    const fetchedMs =
      fetchedAt && typeof fetchedAt.toMillis === 'function' ? fetchedAt.toMillis() : null;
    if (!fetchedMs) return null;
    if (typeof ttlMs === 'number' && ttlMs > 0 && Date.now() - fetchedMs > ttlMs) {
      return null;
    }
    if (typeof data.body !== 'string' || !data.body) return null;
    return {
      status: typeof data.status === 'number' ? data.status : 200,
      contentType:
        typeof data.contentType === 'string' && data.contentType
          ? data.contentType
          : 'application/json',
      body: data.body,
      metadata: data.metadata || null
    };
  } catch (err) {
    console.error(`Failed to read cache entry ${collection}/${docId}`, err);
    return null;
  }
}

async function writeCachedResponse(collection, parts, payload = {}) {
  if (typeof payload.body !== 'string' || !payload.body.length) {
    return;
  }
  const db = getFirestore();
  if (!db) return;
  const docId = buildCacheId(parts);
  const normalizedParts = Array.isArray(parts)
    ? parts.map(serializePart)
    : [serializePart(parts)];
  try {
    await db
      .collection(collection)
      .doc(docId)
      .set({
        keyParts: normalizedParts,
        status: typeof payload.status === 'number' ? payload.status : 200,
        contentType:
          typeof payload.contentType === 'string' && payload.contentType
            ? payload.contentType
            : 'application/json',
        body: payload.body,
        metadata:
          payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : null,
        fetchedAt: serverTimestamp()
      });
  } catch (err) {
    console.error(`Failed to write cache entry ${collection}/${docId}`, err);
  }
}

module.exports = {
  buildCacheId,
  readCachedResponse,
  writeCachedResponse,
  serializePart
};
