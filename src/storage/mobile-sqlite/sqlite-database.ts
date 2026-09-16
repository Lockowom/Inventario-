/**
 * Puerto técnico interno del adaptador SQLite móvil.
 * No debe ser importado desde domain ni desde futuros casos de uso.
 */
export interface SqliteResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  values: Row[]
}

export interface SqliteDatabase {
  initialize(): Promise<void>
  transaction<T>(operation: () => Promise<T>): Promise<T>
  execute(statement: string, values?: readonly unknown[]): Promise<void>
  query<Row extends Record<string, unknown>>(statement: string, values?: readonly unknown[]): Promise<SqliteResult<Row>>
  close(): Promise<void>
}
