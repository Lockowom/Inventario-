import { z } from 'zod'
import { masterControlTypeSchema, normalizeMasterCode, normalizeMasterDescription, type MasterSku } from '../master/contracts'

export const LOCATION_PATTERN = /^(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2}$/
export const LOCATION_ERROR = 'Ubicación mal digitada. Verifique el formato y el pasillo. Ejemplos válidos: F-32-03 o C2-32-03.'
export const SERIAL_REQUIRED_ERROR = 'Favor introducir la serie. Si el producto no está etiquetado o no tiene una serie visible, favor hablar con el Analista de Inventario.'
export const SERIAL_LENGTH_ERROR = 'La serie ingresada supera el máximo permitido de 19 caracteres. Diríjase al Analista de Inventario con el producto para su revisión.'
export const BATCH_REQUIRED_ERROR = 'Favor introducir el lote/partida. Si el producto no está etiquetado o no tiene un lote visible, favor hablar con el Analista de Inventario.'
export const QUANTITY_ERROR = 'La cantidad contada debe ser mayor a 0. Ingrese al menos 1 unidad.'

export const countSyncStatusSchema = z.enum(['PENDING', 'SYNCING', 'CONFIRMED', 'FAILED', 'REJECTED'])
export type CountSyncStatus = z.infer<typeof countSyncStatusSchema>

export const physicalCountDraftSchema = z.object({
  ubicacion: z.string(),
  codigo: z.string(),
  serie: z.string().optional(),
  partida: z.string().optional(),
  piezaProducto: z.string().optional(),
  fechaVencimiento: z.string().optional().nullable(),
  talla: z.string().optional(),
  color: z.string().optional(),
  cantidadContada: z.string(),
})
export type PhysicalCountDraft = z.infer<typeof physicalCountDraftSchema>

export const validatedPhysicalCountSchema = z.object({
  ubicacion: z.string().regex(LOCATION_PATTERN, LOCATION_ERROR),
  codigo: z.string().min(1),
  serie: z.string().max(19).nullable(),
  partida: z.string().nullable(),
  piezaProducto: z.string().nullable(),
  fechaVencimiento: z.string().date().nullable(),
  talla: z.string().nullable(),
  color: z.string().nullable(),
  cantidadContada: z.number().int().positive(),
  descripcion: z.string().min(1),
  controlType: masterControlTypeSchema,
})
export type ValidatedPhysicalCount = z.infer<typeof validatedPhysicalCountSchema>

export const localCountRecordSchema = validatedPhysicalCountSchema.extend({
  id: z.uuid(),
  clientCountId: z.uuid(),
  inventoryId: z.uuid(),
  userId: z.uuid(),
  deviceId: z.uuid(),
  capturedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  syncStatus: countSyncStatusSchema,
  syncAttempts: z.number().int().nonnegative(),
  lastSyncError: z.string().nullable(),
})

// Alias de compatibilidad para consumidores de contratos ya existentes. El
// contrato semántico de Fase 3 es `localCountRecordSchema`.
export const countRecordSchema = localCountRecordSchema
export type LocalCountRecord = z.infer<typeof localCountRecordSchema>

export class PhysicalCountValidationError extends Error {
  public constructor(public readonly field: keyof PhysicalCountDraft | 'codigo', message: string) { super(message) }
}

export function normalizeLocation(value: string): string { return value.trim().toUpperCase() }
export function normalizeCountText(value: string | undefined | null): string | null {
  const normalized = value?.trim() ?? ''
  return normalized === '' ? null : normalized
}

export function validatePhysicalCountDraft(draftInput: PhysicalCountDraft, master: MasterSku | null): ValidatedPhysicalCount {
  const draft = physicalCountDraftSchema.parse(draftInput)
  const ubicacion = normalizeLocation(draft.ubicacion)
  if (!LOCATION_PATTERN.test(ubicacion)) throw new PhysicalCountValidationError('ubicacion', LOCATION_ERROR)
  const codigo = normalizeMasterCode(draft.codigo)
  if (!codigo || !master || master.codigo !== codigo) throw new PhysicalCountValidationError('codigo', 'Código mal ingresado')

  const serie = normalizeCountText(draft.serie)
  const partida = normalizeCountText(draft.partida)
  const cantidadRaw = draft.cantidadContada.trim()
  const rawDate = normalizeCountText(draft.fechaVencimiento)
  if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) throw new PhysicalCountValidationError('fechaVencimiento', 'La fecha de vencimiento debe ser una fecha válida.')
  if (rawDate) {
    const parsedDate = new Date(`${rawDate}T00:00:00.000Z`)
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== rawDate) throw new PhysicalCountValidationError('fechaVencimiento', 'La fecha de vencimiento debe ser una fecha válida.')
  }
  if (serie && serie.length > 19) throw new PhysicalCountValidationError('serie', SERIAL_LENGTH_ERROR)

  let cantidadContada: number
  if (master.controlType === 'SERIAL') {
    if (!serie) throw new PhysicalCountValidationError('serie', SERIAL_REQUIRED_ERROR)
    cantidadContada = 1
  } else {
    if (!/^[1-9][0-9]*$/.test(cantidadRaw)) throw new PhysicalCountValidationError('cantidadContada', QUANTITY_ERROR)
    cantidadContada = Number(cantidadRaw)
    if (!Number.isSafeInteger(cantidadContada)) throw new PhysicalCountValidationError('cantidadContada', QUANTITY_ERROR)
  }
  if (master.controlType === 'PARTIDA' && !partida) throw new PhysicalCountValidationError('partida', BATCH_REQUIRED_ERROR)

  return validatedPhysicalCountSchema.parse({
    ubicacion,
    codigo,
    serie: master.controlType === 'PARTIDA' ? null : serie,
    partida: master.controlType === 'SERIAL' ? null : partida,
    piezaProducto: normalizeCountText(draft.piezaProducto),
    fechaVencimiento: rawDate,
    talla: normalizeCountText(draft.talla),
    color: normalizeCountText(draft.color),
    cantidadContada,
    descripcion: normalizeMasterDescription(master.descripcion),
    controlType: master.controlType,
  })
}

export type PendingCapacity = 'NORMAL' | 'WARNING' | 'CRITICAL' | 'BLOCKED'
export function pendingCapacity(count: number): PendingCapacity {
  if (count >= 50) return 'BLOCKED'
  if (count >= 45) return 'CRITICAL'
  if (count >= 40) return 'WARNING'
  return 'NORMAL'
}
