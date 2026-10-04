import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const compare = (left, right) => {
  const a = Buffer.from(left || '', 'hex');
  const b = Buffer.from(right || '', 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

export class GatewayStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS pair_codes(hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,secret_hash TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT);
      CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id),institution_name TEXT NOT NULL,dirty INTEGER NOT NULL DEFAULT 1,dirty_version INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS items_device ON items(device_id);
      CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,received_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS webhook_events_received ON webhook_events(received_at);`);
    if (
      !this.db
        .prepare('PRAGMA table_info(items)')
        .all()
        .some((column) => column.name === 'dirty_version')
    ) {
      this.db.exec('ALTER TABLE items ADD COLUMN dirty_version INTEGER NOT NULL DEFAULT 0');
    }
  }
  close() {
    this.db.close();
  }
  createPairCode(ttlMs = 10 * 60_000) {
    const code = randomBytes(24).toString('base64url');
    this.db.prepare('DELETE FROM pair_codes WHERE expires_at < ?').run(Date.now());
    this.db.prepare('INSERT INTO pair_codes VALUES (?,?)').run(digest(code), Date.now() + ttlMs);
    return code;
  }
  installBootstrapCode(code) {
    if (typeof code !== 'string' || code.length < 40 || code.length > 256)
      throw Error('invalid_bootstrap_code');
    this.db.prepare('DELETE FROM pair_codes WHERE expires_at < ?').run(Date.now());
    this.db.prepare('INSERT INTO pair_codes VALUES (?,?)').run(digest(code), Date.now() + 60_000);
  }
  pair(code) {
    if (typeof code !== 'string' || code.length > 256) return null;
    const hash = digest(code);
    const row = this.db.prepare('SELECT expires_at FROM pair_codes WHERE hash=?').get(hash);
    if (!row || row.expires_at < Date.now()) return null;
    this.db.prepare('DELETE FROM pair_codes WHERE hash=?').run(hash);
    const id = randomUUID(),
      secret = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO devices(id,secret_hash,created_at) VALUES(?,?,?)')
      .run(id, digest(secret), new Date().toISOString());
    return { deviceId: id, deviceSecret: secret };
  }
  authenticate(header) {
    const match = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,})$/.exec(header || '');
    if (!match) return null;
    const row = this.db
      .prepare('SELECT secret_hash,revoked_at FROM devices WHERE id=?')
      .get(match[1]);
    return row && !row.revoked_at && compare(row.secret_hash, digest(match[2])) ? match[1] : null;
  }
  revoke(id) {
    return (
      this.db
        .prepare('UPDATE devices SET revoked_at=? WHERE id=? AND revoked_at IS NULL')
        .run(new Date().toISOString(), id).changes > 0
    );
  }
  ownItem(deviceId, itemId) {
    return this.db.prepare('SELECT * FROM items WHERE id=? AND device_id=?').get(itemId, deviceId);
  }
  items(deviceId) {
    return this.db
      .prepare(
        'SELECT id,institution_name,dirty,dirty_version,created_at FROM items WHERE device_id=? ORDER BY created_at DESC',
      )
      .all(deviceId);
  }
  saveItem(deviceId, itemId, name) {
    this.db
      .prepare(
        `INSERT INTO items(id,device_id,institution_name,created_at) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET institution_name=excluded.institution_name WHERE device_id=excluded.device_id`,
      )
      .run(itemId, deviceId, name, new Date().toISOString());
    return Boolean(this.ownItem(deviceId, itemId));
  }
  deleteItem(deviceId, itemId) {
    this.db.prepare('DELETE FROM items WHERE id=? AND device_id=?').run(itemId, deviceId);
  }
  markDirty(itemId, eventId) {
    this.db
      .prepare('DELETE FROM webhook_events WHERE received_at < ?')
      .run(new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString());
    const item = this.db.prepare('SELECT id FROM items WHERE id=?').get(itemId);
    if (!item) return false;
    const inserted = this.db
      .prepare('INSERT OR IGNORE INTO webhook_events(id,item_id,received_at) VALUES(?,?,?)')
      .run(eventId, itemId, new Date().toISOString());
    if (inserted.changes)
      this.db
        .prepare('UPDATE items SET dirty=1,dirty_version=dirty_version+1 WHERE id=?')
        .run(itemId);
    return Boolean(inserted.changes);
  }
  clearDirty(deviceId, itemId, version) {
    return (
      this.db
        .prepare('UPDATE items SET dirty=0 WHERE id=? AND device_id=? AND dirty_version=?')
        .run(itemId, deviceId, version).changes > 0
    );
  }
}
