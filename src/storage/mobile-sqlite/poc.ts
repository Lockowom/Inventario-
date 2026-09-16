import type { LocalDatabase } from '../local-database'

export interface SqlitePocResult { inserted: number; updated: number; persisted: boolean }

export async function runSqliteProofOfConcept(database: LocalDatabase): Promise<SqlitePocResult> {
  await database.initialize()
  await database.execute('CREATE TABLE IF NOT EXISTS inven3_sqlite_poc (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  await database.transaction(async () => {
    await database.execute('INSERT OR REPLACE INTO inven3_sqlite_poc (id, value) VALUES (?, ?)', ['poc', 'created'])
    await database.execute('UPDATE inven3_sqlite_poc SET value = ? WHERE id = ?', ['updated', 'poc'])
  })
  const rows = await database.query<{ id: string; value: string }>('SELECT id, value FROM inven3_sqlite_poc WHERE id = ?', ['poc'])
  const record = rows.values[0]
  if (!record || record.value !== 'updated') throw new Error('La PoC SQLite no pudo leer el registro actualizado.')
  await database.close()
  await database.initialize()
  const reopenedRows = await database.query<{ id: string; value: string }>('SELECT id, value FROM inven3_sqlite_poc WHERE id = ?', ['poc'])
  const reopenedRecord = reopenedRows.values[0]
  await database.close()
  if (!reopenedRecord || reopenedRecord.value !== 'updated') throw new Error('La PoC SQLite no conservó el registro al reabrir la base.')
  return { inserted: 1, updated: 1, persisted: true }
}
