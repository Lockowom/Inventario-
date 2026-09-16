export interface SqlResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  values: Row[]
}

export interface LocalDatabase {
  initialize(): Promise<void>
  transaction<T>(operation: () => Promise<T>): Promise<T>
  execute(statement: string, values?: readonly unknown[]): Promise<void>
  query<Row extends Record<string, unknown>>(statement: string, values?: readonly unknown[]): Promise<SqlResult<Row>>
  close(): Promise<void>
}
