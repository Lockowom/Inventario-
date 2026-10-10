import type { LocalHealthProbe, LocalHealthProbeResult } from '../../domain/device-health/contracts'
import { Inven3WebDatabase } from './inven3-web-database'

/** Uses a transient runtime key and leaves no business or persistent probe data behind. */
export class DexieLocalHealthProbe implements LocalHealthProbe {
  public constructor(private readonly database: Inven3WebDatabase) {}

  public async probe(): Promise<LocalHealthProbeResult> {
    await this.database.open()
    const key = `health_probe:${crypto.randomUUID()}`
    const value = 'inven3-health-probe-v1'
    await this.database.transaction('rw', this.database.runtimeState, async () => {
      await this.database.runtimeState.get(key)
      await this.database.runtimeState.put({ key, value })
      const stored = await this.database.runtimeState.get(key)
      if (stored?.value !== value) throw new Error('Local persistence probe failed')
      await this.database.runtimeState.delete(key)
      if (await this.database.runtimeState.get(key)) throw new Error('Local persistence probe residue')
    })
    return { databaseOperational: true, persistenceOperational: true, storageEstimate: await storageEstimate() }
  }
}

async function storageEstimate(): Promise<{ usage?: number; quota?: number } | null> {
  const storage = globalThis.navigator?.storage
  if (!storage?.estimate) return null
  try {
    const estimate = await storage.estimate()
    const usage = typeof estimate.usage === 'number' ? estimate.usage : undefined
    const quota = typeof estimate.quota === 'number' ? estimate.quota : undefined
    return usage === undefined && quota === undefined ? null : { usage, quota }
  } catch { return null }
}
