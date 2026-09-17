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
  {
    version: 3,
    up: async (database) => {
      await database.execute("create table if not exists local_device_identity (identity_key text primary key check (identity_key = 'installation'), device_id text not null unique, created_at text not null)")
      await database.execute("create table if not exists local_count_records (id text primary key, client_count_id text not null unique, inventory_id text not null, user_id text not null, device_id text not null, ubicacion text not null, codigo text not null, serie text, partida text, pieza_producto text, fecha_vencimiento text, talla text, color text, cantidad_contada integer not null check (cantidad_contada > 0), descripcion text not null, control_type text not null check (control_type in ('SERIAL', 'PARTIDA', 'LEGACY')), captured_at text not null, created_at text not null, sync_status text not null check (sync_status in ('PENDING', 'SYNCING', 'CONFIRMED', 'FAILED', 'REJECTED')), sync_attempts integer not null default 0 check (sync_attempts >= 0), last_sync_error text)")
      await database.execute('create index if not exists local_count_records_inventory_idx on local_count_records (inventory_id)')
      await database.execute('create index if not exists local_count_records_user_idx on local_count_records (user_id)')
      await database.execute('create index if not exists local_count_records_codigo_idx on local_count_records (codigo)')
      await database.execute('create index if not exists local_count_records_captured_at_idx on local_count_records (captured_at desc)')
      await database.execute('create index if not exists local_count_records_sync_status_idx on local_count_records (sync_status)')
    },
  },
  {
    version: 4,
    up: async (database) => {
      await database.execute("create table if not exists local_counting_context (context_key text primary key check (context_key = 'active'), user_id text not null, inventory_id text not null, inventory_status text not null check (inventory_status = 'ABIERTO'), verified_at text not null)")
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
