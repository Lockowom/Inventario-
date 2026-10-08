export const C2_SERIAL_POLICY = Object.freeze({
  sweepThreshold: 70,
  anomalyRatioThreshold: 0.20,
})

export type RecountSubtaskStrategy = 'BATCH_LOCATION_RECOUNT' | 'TARGETED_SERIAL_SEARCH' | 'SERIAL_SWEEP' | 'LEGACY_LOCATION_RECOUNT'
export type RecountSubtaskStatus = 'PENDING' | 'ACTIVE' | 'COUNTED' | 'ZERO_CONFIRMED' | 'INACCESSIBLE' | 'ESCALATED'
export type C3Consensus = 'CONFIRM_C1' | 'CONFIRM_C2' | 'REVIEW_REQUIRED'

export function chooseSerialStrategy(input: { seriesAtLocation: number; anomaliesAtLocation: number }): 'TARGETED_SERIAL_SEARCH' | 'SERIAL_SWEEP' {
  const series = Math.max(0, Math.trunc(input.seriesAtLocation))
  const anomalies = Math.max(0, Math.trunc(input.anomaliesAtLocation))
  if (series >= C2_SERIAL_POLICY.sweepThreshold) return 'SERIAL_SWEEP'
  return series > 0 && anomalies / series >= C2_SERIAL_POLICY.anomalyRatioThreshold ? 'SERIAL_SWEEP' : 'TARGETED_SERIAL_SEARCH'
}

export function c3Consensus(c1: number, c2: number, c3: number): C3Consensus {
  if (c3 === c1) return 'CONFIRM_C1'
  if (c3 === c2) return 'CONFIRM_C2'
  return 'REVIEW_REQUIRED'
}

/** Quantity equality is insufficient for serialized stock. */
export function serialSetsMatch(expected: readonly string[], observed: readonly string[]): boolean {
  const normalize = (values: readonly string[]) => new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))
  const left = normalize(expected); const right = normalize(observed)
  return left.size === right.size && [...left].every((value) => right.has(value))
}

export function canCompleteSubtasks(subtasks: ReadonlyArray<{ status: RecountSubtaskStatus }>): boolean {
  return subtasks.length > 0 && subtasks.every((subtask) => subtask.status !== 'PENDING' && subtask.status !== 'ACTIVE')
}

export function requiresAnalystReview(subtasks: ReadonlyArray<{ status: RecountSubtaskStatus }>): boolean {
  return subtasks.some((subtask) => subtask.status === 'INACCESSIBLE' || subtask.status === 'ESCALATED')
}

export function totalCompletedBatchQuantity(subtasks: ReadonlyArray<{ status: RecountSubtaskStatus; countedQuantity: number | null }>): number {
  return subtasks.reduce((total, subtask) => total + (subtask.status === 'COUNTED' ? subtask.countedQuantity ?? 0 : 0), 0)
}

/** Warehouse order: aisles first, TECHO last. Unknown valid locations remain deterministic. */
export function sortExecutionLocations(locations: readonly string[]): string[] {
  return [...new Set(locations.map((location) => location.trim().toUpperCase()).filter(Boolean))]
    .sort((left, right) => locationKey(left).localeCompare(locationKey(right), 'es'))
}

function locationKey(location: string): string {
  if (location === 'TECHO') return 'ZZZZ'
  const match = /^(C2|[A-Z])-(\d{2})-(\d{2})$/.exec(location)
  if (!match) return `ZZZY-${location}`
  const [, aisle = '', bay = '', level = ''] = match
  return `${aisle.padEnd(2, '0')}-${bay}-${level}`
}
