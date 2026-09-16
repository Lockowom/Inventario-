import Dexie, { type EntityTable } from 'dexie'

export interface WebRuntimeState { key: string; value: string }

export class Inven3WebDatabase extends Dexie {
  public runtimeState!: EntityTable<WebRuntimeState, 'key'>

  public constructor() {
    super('inven3')
    this.version(1).stores({ runtimeState: 'key' })
  }
}
