import { useMemo, useState } from 'react'
import type { ArtifactGeneration, CutRectification, F8Role, RectificationsRepository } from './contracts'

const statusLabel: Record<ArtifactGeneration['status'], string> = { REQUESTED: 'PENDIENTE DE GENERACIÓN', FILE_GENERATED: 'ARCHIVO GENERADO / VALIDACIÓN PENDIENTE', VALIDATED: 'VALIDADO / FINALIZACIÓN PENDIENTE', READY: 'LISTO', ERROR: 'REQUIERE REINTENTO' }
const scopeLabel: Record<ArtifactGeneration['scope'], string> = { RECTIFICATION_XLSX: 'XLSX DE RECTIFICACIÓN', CUT_SNAPSHOT: 'SNAPSHOT DEL CORTE', CUT_READY_BACKUP: 'RESPALDO TÉCNICO DEL CORTE', FINAL_FROZEN_BACKUP: 'RESPALDO FINAL DEL INVENTARIO' }
function shortHash(value: string | null) { return value ? `${value.slice(0, 12)}…` : '—' }
function date(value: string | null) { return value ? new Date(value).toLocaleString() : '—' }

export function ArtifactPanel({ artifacts, finalArtifacts, rectifications, role, inventoryFrozen, repository, onChanged }: { artifacts: ArtifactGeneration[]; finalArtifacts: ArtifactGeneration[]; rectifications: CutRectification[]; role: F8Role; inventoryFrozen: boolean; repository: RectificationsRepository; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const visible = useMemo(() => artifacts.filter((item) => role === 'ADMIN' || item.artifact_type !== 'TECHNICAL_BACKUP'), [artifacts, role])
  async function process(item: ArtifactGeneration) {
    if (busy) return
    setBusy(item.id); setMessage('')
    try { await repository.generateArtifact(item.id); setMessage('El artefacto fue procesado por el servidor.'); await onChanged() } catch { setMessage('No fue posible procesar el artefacto. No se expusieron detalles internos; puede reintentar con conexión al servidor.') } finally { setBusy(null) }
  }
  async function download(item: ArtifactGeneration) {
    if (busy) return
    setBusy(item.id); setMessage('')
    try { const file = await repository.downloadArtifact(item.id); window.open(file.signedUrl, '_blank', 'noopener,noreferrer'); setMessage(`Descarga autorizada: ${file.fileName}`) } catch { setMessage('La descarga autorizada no está disponible para este usuario.') } finally { setBusy(null) }
  }
  if (role === 'CONTADOR') return null
  return <section className="artifact-panel" aria-labelledby="artifact-title"><header><h2 id="artifact-title">EVIDENCIAS Y RESPALDOS</h2><p>Los artefactos se procesan y autorizan en el servidor. El snapshot conserva la evidencia original y no incorpora rectificaciones posteriores.</p></header>{message && <p className="form-warning" role="status" aria-live="polite">{message}</p>}<ArtifactList items={visible} rectifications={rectifications} busy={busy} onProcess={process} onDownload={download} />{role === 'ADMIN' && inventoryFrozen && <section className="final-backup" aria-labelledby="final-backup-title"><h3 id="final-backup-title">RESPALDO FINAL DEL INVENTARIO</h3><p>Respaldo técnico de evidencia. No es un archivo para importar directamente en RP.</p><ArtifactList items={finalArtifacts.filter((item) => item.scope === 'FINAL_FROZEN_BACKUP')} rectifications={rectifications} busy={busy} onProcess={process} onDownload={download} /></section>}</section>
}

function ArtifactList({ items, rectifications, busy, onProcess, onDownload }: { items: ArtifactGeneration[]; rectifications: CutRectification[]; busy: string | null; onProcess: (item: ArtifactGeneration) => Promise<void>; onDownload: (item: ArtifactGeneration) => Promise<void> }) {
  if (!items.length) return <p className="cuts-note">No hay artefactos autorizados para mostrar.</p>
  return <ul className="artifact-list">{items.map((item) => { const number = item.rectification_id ? rectifications.find((row) => row.id === item.rectification_id)?.rectification_number : undefined; return <li key={item.id}><div><strong>{item.scope === 'RECTIFICATION_XLSX' ? `${number ? `R${String(number).padStart(3, '0')} · ` : ''}XLSX DE RECTIFICACIÓN` : scopeLabel[item.scope]}</strong><span className="artifact-status">{statusLabel[item.status]} · {item.scope}</span></div><dl><div><dt>Solicitado</dt><dd>{date(item.created_at)}</dd></div><div><dt>AS_OF_AT</dt><dd>{date(item.as_of_at)}</dd></div>{item.file_name && <div><dt>Archivo</dt><dd>{item.file_name}</dd></div>}{item.size_bytes !== null && <div><dt>Tamaño</dt><dd>{item.size_bytes} bytes</dd></div>}{item.sha256 && <div><dt>SHA-256</dt><dd>{shortHash(item.sha256)}</dd></div>}</dl>{item.status === 'READY' ? <button className="button-primary" type="button" disabled={busy === item.id} onClick={() => void onDownload(item)}>{item.scope === 'RECTIFICATION_XLSX' ? 'DESCARGAR XLSX' : 'DESCARGAR'}</button> : <button className="button-primary" type="button" disabled={busy === item.id} onClick={() => void onProcess(item)}>{busy === item.id ? 'GENERANDO…' : 'PROCESAR ARTEFACTO'}</button>}</li> })}</ul>
}
