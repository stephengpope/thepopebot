import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import { getDb } from './index.js';
import { settings } from './schema.js';

const KEY_PREFIX = 'tpb_';

// In-memory cache: Map<keyHash, {id, name}> or null (not loaded)
let _cache = null;

/**
 * Generate a new API key: tpb_ + 64 hex chars (32 random bytes).
 * @returns {string}
 */
export function generateApiKey() {
  return KEY_PREFIX + randomBytes(32).toString('hex');
}

/**
 * Hash an API key using SHA-256.
 * @param {string} key - Raw API key
 * @returns {string} Hex digest
 */
export function hashApiKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Lazy-load all API key hashes into the in-memory cache Map.
 * @returns {Map<string, {id: string, name: string}>}
 */
function _ensureCache() {
  if (_cache !== null) return _cache;

  const db = getDb();
  const rows = db
    .select()
    .from(settings)
    .where(eq(settings.type, 'api_key'))
    .all();

  _cache = new Map();
  for (const row of rows) {
    const parsed = JSON.parse(row.value);
    _cache.set(parsed.key_hash, { id: row.id, name: row.key });
  }
  return _cache;
}

/**
 * Clear the in-memory cache (call after create/delete).
 */
export function invalidateApiKeyCache() {
  _cache = null;
}

/**
 * Create a new named API key. Does NOT delete existing keys.
 * @param {string} createdBy - User ID
 * @param {string} name - Display name for the key (stored in settings.key column)
 * @returns {{ key: string, record: object }}
 */
export function createApiKeyRecord(createdBy, name) {
  const db = getDb();

  const key = generateApiKey();
  const keyHash = hashApiKey(key);
  const keyPrefix = key.slice(0, 8); // "tpb_" + first 4 hex chars
  const now = Date.now();

  const record = {
    id: randomUUID(),
    type: 'api_key',
    key: name,
    value: JSON.stringify({ key_prefix: keyPrefix, key_hash: keyHash, last_used_at: null }),
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(settings).values(record).run();
  invalidateApiKeyCache();

  return {
    key,
    record: {
      id: record.id,
      name,
      keyPrefix,
      createdAt: now,
      lastUsedAt: null,
    },
  };
}

/**
 * Get all API keys metadata (no hashes).
 * Existing keys stored with key='api_key' are returned with name='api_key'.
 * @returns {object[]}
 */
export function getApiKeys() {
  const db = getDb();
  const rows = db
    .select()
    .from(settings)
    .where(eq(settings.type, 'api_key'))
    .all();

  return rows.map((row) => {
    const parsed = JSON.parse(row.value);
    return {
      id: row.id,
      name: row.key,
      keyPrefix: parsed.key_prefix,
      createdAt: row.createdAt,
      lastUsedAt: parsed.last_used_at,
    };
  });
}

/**
 * Delete an API key by its UUID primary key.
 * @param {string} id - UUID of the settings row
 */
export function deleteApiKeyById(id) {
  const db = getDb();
  db.delete(settings).where(eq(settings.id, id)).run();
  invalidateApiKeyCache();
}

/**
 * Verify a raw API key against the cached hash Map.
 * Timing-safe comparison applied per entry.
 * @param {string} rawKey - Raw API key from request header
 * @returns {object|null} Record if valid, null otherwise
 */
export function verifyApiKey(rawKey) {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;

  const keyHash = hashApiKey(rawKey);
  const cache = _ensureCache();

  if (cache.size === 0) return null;

  const a = Buffer.from(keyHash, 'hex');
  for (const [storedHash, entry] of cache) {
    const b = Buffer.from(storedHash, 'hex');
    if (a.length === b.length && timingSafeEqual(a, b)) {
      // Update last_used_at in background (non-blocking)
      try {
        const db = getDb();
        const now = Date.now();
        const row = db.select().from(settings).where(eq(settings.id, entry.id)).get();
        if (row) {
          const parsed = JSON.parse(row.value);
          parsed.last_used_at = now;
          db.update(settings)
            .set({ value: JSON.stringify(parsed), updatedAt: now })
            .where(eq(settings.id, entry.id))
            .run();
        }
      } catch {
        // Non-fatal: last_used_at is informational
      }
      return entry;
    }
  }

  return null;
}
