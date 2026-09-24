import { ArtifactPanel } from '../features/rectifications/artifact-panel'
import { RectificationPanel } from '../features/rectifications/rectification-panel'
import { SupervisionScreen } from '../features/supervision/supervision-screen'
import { CutsScreen } from '../features/cuts/cuts-screen'
import { MasterSkuScreen } from '../features/master/master-sku-screen'
import { CountingScreen } from '../features/counting/counting-screen'
import type { RectificationsRepository } from '../features/rectifications/contracts'

const repository: RectificationsRepository = {
  rectifyCut: async () => ({ id: 'rectification-001', rectification_number: 1, idempotent: false }),
  rectifications: async () => [],
  artifacts: async () => [],
  generateArtifact: async () => undefined,
  downloadArtifact: async () => ({ signedUrl: 'https://example.invalid/file', fileName: 'INVEN3_CERTIFICATION.xlsx' }),
  masterItem: async (_inventoryId, codigo) => ({ codigo, descripcion: 'Descripción de certificación', control_type: 'LEGACY' }),
}

/** Test-only composition enabled solely by VITE_CERTIFICATION_FIXTURE=1. */
export function CertificationFixture() {
  const values = { ubicacion: 'A-01-01', codigo: '00001', serie: '', partida: '00725', pieza_producto: '001234', fecha_vencimiento: '2027-04-10', talla: 'L', color: 'Negro', cantidad_contada: 3, descripcion: 'Producto de certificación' }
  return <main className="app-shell certification-fixture">
    <header><p className="eyebrow">Fase 9 · fixture determinista</p><h1>INVEN3 CERTIFICATION</h1><p>Datos sintéticos no productivos para regresión visual y accesibilidad.</p></header>
    <SupervisionScreen /><CutsScreen /><MasterSkuScreen /><CountingScreen runtime={null} />
    <RectificationPanel inventoryId="11111111-1111-4111-8111-111111111111" cut={{ id: 'cut-001', cut_number: 1, status: 'READY' }} items={[{ count_record_id: 'record-001', export_seq: 1, snapshot: values }]} rectifications={[]} role="ANALISTA" repository={repository} onChanged={async () => undefined} />
    <ArtifactPanel role="ADMIN" inventoryFrozen={false} rectifications={[]} repository={repository} onChanged={async () => undefined} finalArtifacts={[]} artifacts={[
      { id: 'artifact-requested', inventory_id: '11111111-1111-4111-8111-111111111111', cut_id: 'cut-001', rectification_id: null, artifact_type: 'TECHNICAL_BACKUP', scope: 'CUT_SNAPSHOT', status: 'REQUESTED', created_at: '2026-09-24T12:00:00.000Z', as_of_at: '2026-09-24T12:00:00.000Z', file_name: null, sha256: null, size_bytes: null, error_safe: null },
      { id: 'artifact-error', inventory_id: '11111111-1111-4111-8111-111111111111', cut_id: 'cut-001', rectification_id: null, artifact_type: 'TECHNICAL_BACKUP', scope: 'CUT_READY_BACKUP', status: 'ERROR', created_at: '2026-09-24T12:00:00.000Z', as_of_at: '2026-09-24T12:00:00.000Z', file_name: null, sha256: null, size_bytes: null, error_safe: 'SAFE_ERROR' },
      { id: 'artifact-ready', inventory_id: '11111111-1111-4111-8111-111111111111', cut_id: 'cut-001', rectification_id: null, artifact_type: 'RECTIFICATION_XLSX', scope: 'RECTIFICATION_XLSX', status: 'READY', created_at: '2026-09-24T12:00:00.000Z', as_of_at: '2026-09-24T12:00:00.000Z', file_name: 'INVEN3_CERTIFICATION.xlsx', sha256: 'a'.repeat(64), size_bytes: 1024, error_safe: null },
    ]} />
  </main>
}
