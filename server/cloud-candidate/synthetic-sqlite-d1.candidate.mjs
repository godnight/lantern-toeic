// Synthetic-test wrapper; this module opens no files and starts no services.
import { createSqliteD1Core } from './sqlite-d1-core.candidate.mjs';

export function createSyntheticSqliteD1({ enabled = false, database } = {}) {
  if (enabled !== true) throw Error('synthetic SQLite D1 disabled');
  return createSqliteD1Core({ enabled, database });
}
