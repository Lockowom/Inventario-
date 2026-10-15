import { getPlatformAdapter } from '../platform/runtime-platform'
import type { RestoredScannerResult } from '../platform/contracts'

/**
 * Runtime glue kept apart from scanner-restoration's pure parsing helpers.
 * This avoids creating a circular dependency between the Capacitor adapter and
 * the restoration logic that it uses to normalize native scanner results.
 */
export function subscribeToScannerRestoration(listener: (result: RestoredScannerResult) => void): Promise<() => Promise<void>> {
  return getPlatformAdapter().scanner.subscribeToRestoration(listener)
}
