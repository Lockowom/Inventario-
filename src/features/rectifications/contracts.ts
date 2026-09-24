import type { MasterControlType } from '../../domain/master/contracts'

export type F8Role = 'CONTADOR' | 'ANALISTA' | 'ADMIN'

export type PhysicalPayload = {
  ubicacion: string
  codigo: string
  serie: string
  partida: string
  pieza_producto: string
  fecha_vencimiento: string
  talla: string
  color: string
  cantidad_contada: number
}

export type EvidenceValues = PhysicalPayload & { descripcion?: string | null }

export type CutItem = {
  count_record_id: string
  export_seq: number
  snapshot: EvidenceValues
}

export type CutRectification = {
  id: string
  cut_id: string
  count_record_id: string
  rectification_number: number
  old_values: EvidenceValues
  new_values: EvidenceValues
  reason: string
  created_at: string
  created_by: string
}

export type ArtifactStatus = 'REQUESTED' | 'FILE_GENERATED' | 'VALIDATED' | 'READY' | 'ERROR'
export type ArtifactScope = 'RECTIFICATION_XLSX' | 'CUT_SNAPSHOT' | 'CUT_READY_BACKUP' | 'FINAL_FROZEN_BACKUP'

export type ArtifactGeneration = {
  id: string
  inventory_id: string
  cut_id: string | null
  rectification_id: string | null
  artifact_type: 'RECTIFICATION_XLSX' | 'SNAPSHOT' | 'TECHNICAL_BACKUP'
  scope: ArtifactScope
  status: ArtifactStatus
  created_at: string
  as_of_at: string | null
  file_name: string | null
  sha256: string | null
  size_bytes: number | null
  error_safe: string | null
}

export type MasterItem = { codigo: string; descripcion: string; control_type: MasterControlType }

export type RectifyCutInput = {
  cutId: string
  countRecordId: string
  physicalPayload: PhysicalPayload
  reason: string
  requestId: string
}

export type RectificationResult = { id: string; rectification_number: number; idempotent: boolean }

export interface RectificationsRepository {
  rectifyCut(input: RectifyCutInput): Promise<RectificationResult>
  rectifications(cutId: string, countRecordId?: string): Promise<CutRectification[]>
  artifacts(inventoryId: string, cutId?: string): Promise<ArtifactGeneration[]>
  generateArtifact(artifactGenerationId: string): Promise<void>
  downloadArtifact(artifactGenerationId: string): Promise<{ signedUrl: string; fileName: string }>
  masterItem(inventoryId: string, codigo: string): Promise<MasterItem | null>
}
