export type RecountStage =
  | 'REQUIERE_2DO_CONTEO'
  | '2DO_CONTEO_ASIGNADO'
  | 'REQUIERE_3ER_CONTEO'
  | '3ER_CONTEO_ASIGNADO'
  | 'RESUELTO'

export type RecountRole = 'CONTADOR' | 'ANALISTA' | 'ADMIN'

export interface RecountObservation {
  round: 1 | 2 | 3
  userId: string
  quantity: number
  capturedAt: string
}

export interface RecountCase {
  id: string
  inventoryId: string
  codigo: string
  reference: string | null
  stage: RecountStage
  firstCount: RecountObservation
  secondCount: RecountObservation | null
  thirdCount: RecountObservation | null
  assignedSecondUserId: string | null
  assignedThirdAnalystId: string | null
  resolutionQuantity: number | null
}

export function createRecountCase(input: Omit<RecountCase, 'stage' | 'secondCount' | 'thirdCount' | 'assignedSecondUserId' | 'assignedThirdAnalystId' | 'resolutionQuantity'>): RecountCase {
  return { ...input, stage: 'REQUIERE_2DO_CONTEO', secondCount: null, thirdCount: null, assignedSecondUserId: null, assignedThirdAnalystId: null, resolutionQuantity: null }
}

export function assignSecondCount(item: RecountCase, assigneeUserId: string): RecountCase {
  if (item.stage !== 'REQUIERE_2DO_CONTEO') throw new Error('El caso no admite asignación de segundo conteo.')
  if (!assigneeUserId || assigneeUserId === item.firstCount.userId) throw new Error('El segundo conteo debe asignarse a otro usuario.')
  return { ...item, stage: '2DO_CONTEO_ASIGNADO', assignedSecondUserId: assigneeUserId }
}

export function recordSecondCount(item: RecountCase, observation: RecountObservation): RecountCase {
  if (item.stage !== '2DO_CONTEO_ASIGNADO' || observation.round !== 2) throw new Error('Segundo conteo fuera de secuencia.')
  if (observation.userId !== item.assignedSecondUserId) throw new Error('Usuario no asignado al segundo conteo.')
  if (observation.quantity <= 0 || !Number.isInteger(observation.quantity)) throw new Error('Cantidad inválida.')
  if (observation.quantity === item.firstCount.quantity) {
    return { ...item, secondCount: observation, stage: 'RESUELTO', resolutionQuantity: observation.quantity }
  }
  return { ...item, secondCount: observation, stage: 'REQUIERE_3ER_CONTEO' }
}

export function assignThirdCount(item: RecountCase, analystUserId: string, role: RecountRole): RecountCase {
  if (item.stage !== 'REQUIERE_3ER_CONTEO') throw new Error('El caso no admite tercer conteo.')
  if (role !== 'ANALISTA') throw new Error('El tercer conteo está reservado al ANALISTA.')
  if (!analystUserId) throw new Error('Analista requerido.')
  return { ...item, stage: '3ER_CONTEO_ASIGNADO', assignedThirdAnalystId: analystUserId }
}

export function recordThirdCount(item: RecountCase, observation: RecountObservation, role: RecountRole): RecountCase {
  if (item.stage !== '3ER_CONTEO_ASIGNADO' || observation.round !== 3) throw new Error('Tercer conteo fuera de secuencia.')
  if (role !== 'ANALISTA' || observation.userId !== item.assignedThirdAnalystId) throw new Error('Solo el ANALISTA asignado puede registrar el tercer conteo.')
  if (observation.quantity <= 0 || !Number.isInteger(observation.quantity)) throw new Error('Cantidad inválida.')
  return { ...item, thirdCount: observation, stage: 'RESUELTO', resolutionQuantity: observation.quantity }
}

export function blindSecondCountView(item: RecountCase, viewerUserId: string) {
  if (item.stage !== '2DO_CONTEO_ASIGNADO' || item.assignedSecondUserId !== viewerUserId) throw new Error('Caso no disponible para este usuario.')
  return { id: item.id, inventoryId: item.inventoryId, codigo: item.codigo, reference: item.reference, round: 2 as const }
}
