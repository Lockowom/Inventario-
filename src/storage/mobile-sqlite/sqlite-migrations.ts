import type { SqliteDatabase } from './sqlite-database'

export interface SqliteMigration {
  version: number
  up(database: SqliteDatabase): Promise<void>
}

interface SqliteVersionRow extends Record<string, unknown> {
  user_version: number
}

/**
 * Version 1 represents the schema-free Phase 0 SQLite baseline. Version 2
 * introduces the persisted master snapshot. Future phases append migrations;
 * no migration may lower or rewrite a completed version.
 */
export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  { version: 1, up: async () => undefined },
  {
    version: 2,
    up: async (database) => {
      await database.execute("create table if not exists inven3_master_sku (inventory_id text not null, codigo text not null, descripcion text not null, control_type text not null check (control_type in ('SERIAL', 'PARTIDA', 'LEGACY')), cached_at text not null, unique (inventory_id, codigo))")
      await database.execute('create table if not exists inven3_master_metadata (inventory_id text primary key, master_version integer not null check (master_version > 0), row_count integer not null check (row_count > 0), fingerprint text not null, cached_at text not null)')
    },
  },
]

export async function applySqliteMigrations(database: SqliteDatabase, migrations: readonly SqliteMigration[] = SQLITE_MIGRATIONS): Promise<void> {
  const ordered = [...migrations].sort((left, right) => left.version - right.version)
  if (ordered.length === 0 || ordered.some((migration, index) => migration.version !== index + 1)) throw new Error('La lista de migraciones SQLite no es contigua.')
  const current = (await database.query<SqliteVersionRow>('pragma user_version')).values[0]?.user_version ?? 0
  const latest = ordered.at(-1)!.version
  if (!Number.isInteger(current) || current < 0) throw new Error('La versión SQLite actual no es válida.')
  if (current > latest) throw new Error(`La base local requiere una versión más reciente de INVEN3 (v${current}).`)

  for (const migration of ordered) {
    if (migration.version <= current) continue
    await database.transaction(async () => {
      await migration.up(database)
      await database.execute(`pragma user_version = ${migration.version}`)
    })
  }
}
