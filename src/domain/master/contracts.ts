import { z } from 'zod'

export const masterControlTypeSchema = z.enum(['SERIAL', 'PARTIDA', 'LEGACY'])
export type MasterControlType = z.infer<typeof masterControlTypeSchema>

export function normalizeMasterCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

export function normalizeMasterDescription(value: unknown): string {
  return String(value ?? '').trim()
}

export function deriveMasterControlType(codigo: string): MasterControlType {
  if (codigo.endsWith('S')) return 'SERIAL'
  if (codigo.endsWith('P')) return 'PARTIDA'
  return 'LEGACY'
}

export const masterSkuSchema = z.object({
  inventoryId: z.uuid(),
  codigo: z.string().trim().min(1).transform((value) => normalizeMasterCode(value)),
  descripcion: z.string().trim().min(1),
  controlType: masterControlTypeSchema,
  cachedAt: z.string().datetime(),
})
export type MasterSku = z.infer<typeof masterSkuSchema>

export const masterImportRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  codigo: z.string(),
  descripcion: z.string(),
  normalizedCodigo: z.string(),
  normalizedDescripcion: z.string(),
  controlType: masterControlTypeSchema.optional(),
  errors: z.array(z.string()),
})
export type MasterImportRow = z.infer<typeof masterImportRowSchema>

export const masterImportPreviewSchema = z.object({
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  rejectedRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  emptyRows: z.number().int().nonnegative(),
  rows: z.array(masterImportRowSchema),
})
export type MasterImportPreview = z.infer<typeof masterImportPreviewSchema>

export const masterMetadataSchema = z.object({
  inventoryId: z.uuid(),
  masterVersion: z.number().int().positive(),
  rowCount: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  cachedAt: z.string().datetime(),
})
export type MasterMetadata = z.infer<typeof masterMetadataSchema>

export function validMasterItems(preview: MasterImportPreview): Array<Pick<MasterSku, 'codigo' | 'descripcion' | 'controlType'>> {
  return preview.rows
    .filter((row) => row.errors.length === 0 && row.controlType)
    .map((row) => ({ codigo: row.normalizedCodigo, descripcion: row.normalizedDescripcion, controlType: row.controlType! }))
}

export async function createMasterFingerprint(items: ReadonlyArray<Pick<MasterSku, 'codigo' | 'descripcion' | 'controlType'>>): Promise<string> {
  const canonical = [...items]
    .map((item) => `${normalizeMasterCode(item.codigo)}\u001f${normalizeMasterDescription(item.descripcion)}\u001f${item.controlType}`)
    .sort()
    .join('\u001e')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
