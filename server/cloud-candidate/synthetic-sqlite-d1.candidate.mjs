// Synthetic-only D1 compatibility experiment for the account service.
// This module does not open files, start listeners, migrate data, or provide a
// production storage adapter. The caller supplies an already opened test DB.
import { DatabaseSync } from 'node:sqlite';

const readParams = values => values.map(value => {
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  if (typeof value === 'boolean') return Number(value);
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  throw Error('unsupported D1 parameter');
});

// This is intentionally a small, fail-closed subset. SQL comes from the
// reviewed account source, never a request. Unsupported D1 methods and SQL
// transaction control are not guessed or exposed.
export function createSyntheticSqliteD1({ enabled = false, database } = {}) {
  if (enabled !== true || !(database instanceof DatabaseSync)) throw Error('synthetic SQLite D1 disabled');
  const statements = new WeakMap();
  const changeCounter = database.prepare('SELECT total_changes() AS value');
  const lastChange = database.prepare('SELECT changes() AS value');

  function prepare(sql, values = []) {
    if (typeof sql !== 'string' || sql.length === 0 || sql.length > 65536 ||
        !/^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) throw Error('unsupported D1 statement');
    const compiled = database.prepare(sql);
    if (sql.slice(compiled.sourceSQL.length).trim() !== '') throw Error('multiple SQL statements forbidden');
    const params = readParams(values), item = Object.freeze({
      bind(...next) { return prepare(sql, next); },
      async all() { return execute(item); },
      async run() { return execute(item); },
      async first(column) {
        const row = execute(item).results[0] ?? null;
        if (column === undefined || row === null) return row;
        if (typeof column !== 'string' || !Object.hasOwn(row, column)) throw Error('unknown column');
        return row[column];
      },
    });
    statements.set(item, { compiled, params });
    return item;
  }

  function execute(item) {
    const data = statements.get(item);
    if (!data) throw Error('statement belongs to another database');
    const before = changeCounter.get().value;
    const results = data.compiled.columns().length ? data.compiled.all(...data.params) : (data.compiled.run(...data.params), []);
    const changed = changeCounter.get().value !== before;
    return { success: true, results, meta: { changes: changed ? lastChange.get().value : 0 } };
  }

  return Object.freeze({
    prepare,
    async batch(items) {
      if (!Array.isArray(items) || items.length === 0 || items.length > 512 || items.some(item => !statements.has(item))) throw Error('invalid D1 batch');
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = items.map(execute);
        database.exec('COMMIT');
        return result;
      } catch (error) {
        try { database.exec('ROLLBACK'); } catch { throw Error('synthetic SQLite rollback failed'); }
        throw error;
      }
    },
  });
}
