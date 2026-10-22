import * as XLSX from '@e965/xlsx'

export type RpReleaseManifest = {
  release_id: string
  inventory_id: string
  warehouse_id: string
  created_by: string
  created_at: string
  item_count: number
  schema_version: 'CUT2_09C'
  release_fingerprint: string
  ordered_items_digest: string
  export_version: 'CUT2_09C'
}

export type RpReleaseExportItem = {
  export_seq: number
  reference_id: string
  warehouse_id: string
  identity_type: string
  sku: string
  lot?: string | null
  serial?: string | null
  sealed_quantity: number
  source_cut_id?: string | null
}

export type RpReleaseExport = { manifest: RpReleaseManifest; release: { items: RpReleaseExportItem[]; inventory_id: string; created_at: string } }

const headers = ['Release ID', 'Inventory', 'Warehouse', 'Identity Type', 'SKU', 'Description', 'Lot', 'Serial', 'Sealed Qty', 'Baseline Qty', 'Delta / Adjustment Proposal', 'Source Cut', 'Sealed Reference', 'Created At']
const manifestHeaders = ['Release ID', 'Inventory ID', 'Warehouse ID', 'Created By', 'Created At', 'Item Count', 'Schema Version', 'Release Fingerprint', 'Ordered Items Digest', 'Export Version']

/** Excel treats leading formula tokens as executable expressions.  The apostrophe
 * is an XLSX presentation escape; the canonical server snapshot stays untouched. */
export function safeSpreadsheetText(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

export function rpReleaseFilename(manifest: RpReleaseManifest): string {
  return `RP_RELEASE_${manifest.inventory_id}_${manifest.warehouse_id}_${manifest.release_id}.xlsx`
}

export function generateRpReleaseXlsx(payload: RpReleaseExport): Uint8Array {
  const { manifest, release } = payload
  if (release.items.length !== manifest.item_count) throw new Error('El manifiesto no coincide con el snapshot de exportación.')
  const rows = release.items.map((item) => [
    safeSpreadsheetText(manifest.release_id), safeSpreadsheetText(release.inventory_id), safeSpreadsheetText(item.warehouse_id),
    safeSpreadsheetText(item.identity_type), safeSpreadsheetText(item.sku), '', safeSpreadsheetText(item.lot), safeSpreadsheetText(item.serial),
    item.sealed_quantity, '', '', safeSpreadsheetText(item.source_cut_id), safeSpreadsheetText(item.reference_id), safeSpreadsheetText(release.created_at),
  ])
  const manifestRow = [manifest.release_id, manifest.inventory_id, manifest.warehouse_id, manifest.created_by, manifest.created_at, manifest.item_count, manifest.schema_version, manifest.release_fingerprint, manifest.ordered_items_digest, manifest.export_version].map(safeSpreadsheetText)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'RP_RELEASE')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([manifestHeaders, manifestRow]), 'MANIFEST')
  return new Uint8Array(XLSX.write(book, { bookType: 'xlsx', type: 'array', compression: true }))
}

export function validateRpReleaseXlsx(bytes: Uint8Array, manifest: RpReleaseManifest): void {
  const book = XLSX.read(bytes, { type: 'array', cellFormula: true })
  if (book.SheetNames.join('|') !== 'RP_RELEASE|MANIFEST') throw new Error('El workbook RP debe contener las hojas RP_RELEASE y MANIFEST.')
  const releaseRows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.RP_RELEASE!, { header: 1, raw: true })
  const manifestRows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.MANIFEST!, { header: 1, raw: true })
  if (JSON.stringify(releaseRows[0]) !== JSON.stringify(headers) || releaseRows.length - 1 !== manifest.item_count) throw new Error('El contenido del RP no coincide con el manifiesto.')
  if (JSON.stringify(manifestRows[0]) !== JSON.stringify(manifestHeaders) || manifestRows[1]?.[0] !== manifest.release_id || manifestRows[1]?.[8] !== manifest.ordered_items_digest) throw new Error('La hoja MANIFEST no coincide con la versión canónica.')
  for (const sheet of Object.values(book.Sheets)) for (const cell of Object.values(sheet)) if (typeof cell === 'object' && cell && 'f' in cell) throw new Error('El XLSX RP no puede contener fórmulas.')
}
