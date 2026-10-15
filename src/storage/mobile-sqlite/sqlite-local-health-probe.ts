import type { LocalHealthProbe, LocalHealthProbeResult } from '../../domain/device-health/contracts'
import type { SqliteDatabase } from './sqlite-database'

interface VersionRow extends Record<string, unknown> { user_version: number }
const TEMP_TABLE = 'health_probe'
const MARKER = 'inven3-health-probe-v1'

/** A temporary table proves SQLite durability primitives without changing its schema or business data. */
export class SqliteLocalHealthProbe implements LocalHealthProbe {
  public constructor(private readonly database: SqliteDatabase) {}

  public async probe(): Promise<LocalHealthProbeResult> {
    await this.database.initialize()
    const version = (await this.database.query<VersionRow>('pragma user_version')).values[0]?.user_version
    if (!Number.isInteger(version) || Number(version) < 0) throw new Error('Invalid SQLite user_version')
    await this.database.transaction(async () => {
      await this.database.execute(`create temp table ${TEMP_TABLE} (marker text not null)`)
      await this.database.execute(`insert into ${TEMP_TABLE} (marker) values (?)`, [MARKER])
      const row = (await this.database.query<{ marker: string }>(`select marker from ${TEMP_TABLE}`)).values[0]
      if (row?.marker !== MARKER) throw new Error('SQLite local health probe failed')
      await this.database.execute(`delete from ${TEMP_TABLE}`)
      await this.database.execute(`drop table ${TEMP_TABLE}`)
    })
    return { databaseOperational: true, persistenceOperational: true, storageEstimate: null }
  }
}
