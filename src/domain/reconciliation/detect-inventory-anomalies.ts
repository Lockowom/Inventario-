export type ReconciliationControlType = 'SERIAL' | 'PARTIDA' | 'LEGACY'

export type InventoryAnomalyType =
  | 'SERIE_FISICA_NO_EN_SISTEMA'
  | 'SERIE_SISTEMA_NO_CONTADA'
  | 'PARTIDA_FISICA_NO_EN_SISTEMA'
  | 'PARTIDA_SISTEMA_NO_CONTADA'
  | 'DIFERENCIA_CANTIDAD_PARTIDA'
  | 'DIFERENCIA_CANTIDAD_SKU'
  | 'DUPLICADO_SERIE'

export interface ReferenceStockLine {
  codigo: string
  controlType: ReconciliationControlType
  reference?: string | null
  quantity: number
}

export interface PhysicalCountLine {
  codigo: string
  controlType: ReconciliationControlType
  reference?: string | null
  quantity: number
}

export interface InventoryAnomaly {
  type: InventoryAnomalyType
  codigo: string
  reference: string | null
  systemQuantity: number
  physicalQuantity: number
  difference: number
}

const norm = (value?: string | null) => (value ?? '').trim().toUpperCase()

export function detectInventoryAnomalies(reference: ReferenceStockLine[], physical: PhysicalCountLine[]): InventoryAnomaly[] {
  const anomalies: InventoryAnomaly[] = []
  const keys = new Set([...reference, ...physical].map((x) => `${norm(x.codigo)}|${x.controlType}|${norm(x.reference)}`))

  for (const key of [...keys].sort()) {
    const [codigo, controlType, referenceValue] = key.split('|') as [string, ReconciliationControlType, string]
    const systemRows = reference.filter((x) => norm(x.codigo) === codigo && x.controlType === controlType && norm(x.reference) === referenceValue)
    const physicalRows = physical.filter((x) => norm(x.codigo) === codigo && x.controlType === controlType && norm(x.reference) === referenceValue)
    const systemQuantity = systemRows.reduce((sum, x) => sum + x.quantity, 0)
    const physicalQuantity = physicalRows.reduce((sum, x) => sum + x.quantity, 0)
    const difference = physicalQuantity - systemQuantity
    const ref = referenceValue || null

    if (controlType === 'SERIAL') {
      if (physicalRows.length > 1) anomalies.push({ type: 'DUPLICADO_SERIE', codigo, reference: ref, systemQuantity, physicalQuantity, difference })
      if (systemQuantity === 0 && physicalQuantity > 0) anomalies.push({ type: 'SERIE_FISICA_NO_EN_SISTEMA', codigo, reference: ref, systemQuantity, physicalQuantity, difference })
      if (systemQuantity > 0 && physicalQuantity === 0) anomalies.push({ type: 'SERIE_SISTEMA_NO_CONTADA', codigo, reference: ref, systemQuantity, physicalQuantity, difference })
      continue
    }

    if (controlType === 'PARTIDA') {
      if (systemQuantity === 0 && physicalQuantity > 0) anomalies.push({ type: 'PARTIDA_FISICA_NO_EN_SISTEMA', codigo, reference: ref, systemQuantity, physicalQuantity, difference })
      else if (systemQuantity > 0 && physicalQuantity === 0) anomalies.push({ type: 'PARTIDA_SISTEMA_NO_CONTADA', codigo, reference: ref, systemQuantity, physicalQuantity, difference })
      else if (difference !== 0) anomalies.push({ type: 'DIFERENCIA_CANTIDAD_PARTIDA', codigo, reference: ref, systemQuantity, physicalQuantity, difference })
      continue
    }

    if (difference !== 0) anomalies.push({ type: 'DIFERENCIA_CANTIDAD_SKU', codigo, reference: null, systemQuantity, physicalQuantity, difference })
  }

  return anomalies
}
