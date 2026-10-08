export type ScannerComponentStatus =
  | { kind: 'READY'; message: string }
  | { kind: 'PREPARING'; message: string }
  | { kind: 'UNAVAILABLE'; message: string }

let current: ScannerComponentStatus | null = null
const listeners = new Set<(status: ScannerComponentStatus | null) => void>()

export function getScannerComponentStatus(): ScannerComponentStatus | null { return current }

export function setScannerComponentStatus(status: ScannerComponentStatus | null) {
  current = status
  listeners.forEach((listener) => listener(current))
}

export function subscribeScannerComponentStatus(listener: (status: ScannerComponentStatus | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
