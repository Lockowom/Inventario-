import * as XLSX from '@e965/xlsx'
import { describe, expect, it } from 'vitest'
import { buildSnapshot, buildTechnicalBackup, canonicalJson, canonicalNdjson, generateRectificationXlsx, RECTIFICATION_HEADERS, sha256, validateRectificationXlsx, validateSnapshot, validateTechnicalBackup } from '../../supabase/functions/_shared/artifact-contract'

const source = {
  generation: { id: '10000000-0000-0000-0000-000000000001', artifact_type: 'RECTIFICATION_XLSX', scope: 'RECTIFICATION_XLSX', as_of_at: '2027-05-15T00:00:00.000Z' },
  inventory: { id: '20000000-0000-0000-0000-000000000001', name: 'Inventory' },
  cut: { id: '30000000-0000-0000-0000-000000000001', cut_number: 4 },
  rectification: { id: '40000000-0000-0000-0000-000000000001', rectification_number: 1, count_record_id: '50000000-0000-0000-0000-000000000001', created_by: '60000000-0000-0000-0000-000000000001', created_at: '2027-05-15T00:00:00.000Z', reason: 'Evidence', request_id: '70000000-0000-0000-0000-000000000001', old_values_sha256: 'a'.repeat(64), new_values_sha256: 'b'.repeat(64), old_values: { ubicacion: 'A-01-01', codigo: '000123', serie: '000001', partida: '0007', pieza_producto: '0001', fecha_vencimiento: '2027-05-15', talla: null, color: null, cantidad_contada: 1, descripcion: 'Original' }, new_values: { ubicacion: 'A-01-01', codigo: '000123', serie: '000001', partida: '0007', pieza_producto: '0001', fecha_vencimiento: null, talla: null, color: null, cantidad_contada: 2, descripcion: 'Correcto' } },
  cut_items: [{ export_seq: 1, codigo: '000123' }], cut_xlsx: { file_name: 'base.xlsx', sha256: 'c'.repeat(64), size_bytes: 1 }, cuts: [{ cut_number: 4 }], rectifications: [], artifacts: [],
}

describe('F8C artifact contract', () => {
  it('creates deterministic physical RECTIFICATION_XLSX bytes with numeric UTC date cells', () => {
    const first = generateRectificationXlsx(source); const second = generateRectificationXlsx(source); expect([...first]).toEqual([...second]); validateRectificationXlsx(first, source)
    const book = XLSX.read(first, { type: 'array', cellDates: false, cellFormula: true, cellNF: true }); expect(book.SheetNames).toEqual(['RECTIFICACION', 'VALORES']); expect(XLSX.utils.sheet_to_json(book.Sheets.VALORES!, { header: 1, raw: true, defval: null })[0]).toEqual(RECTIFICATION_HEADERS)
    expect(book.Sheets.VALORES!.G2).toMatchObject({ t: 'n', v: 46522, z: 'dd-mm-yyyy' }); expect(book.Sheets.VALORES!.G3).toBeUndefined(); expect(book.Sheets.VALORES!.C2!.v).toBe('000123'); expect(book.Sheets.VALORES!.E2!.v).toBe('0007'); expect(book.Sheets.VALORES!.J3!.v).toBe(2)
    expect(Object.values(book.Sheets).flatMap((sheet) => Object.values(sheet ?? {})).some((cell) => typeof cell === 'object' && cell && 'f' in cell)).toBe(false)
  })
  it('canonically serializes and validates immutable snapshots', () => { const first = buildSnapshot(source); const second = buildSnapshot({ ...source, inventory: { name: 'Inventory', id: source.inventory.id } }); expect([...first]).toEqual([...second]); validateSnapshot(first, source); expect(new TextDecoder().decode(first).charCodeAt(0)).not.toBe(0xfeff) })
  it('creates byte-for-byte deterministic valid ZIP backups', async () => { const backupSource = { ...source, generation: { ...source.generation, artifact_type: 'TECHNICAL_BACKUP', scope: 'CUT_READY_BACKUP' } }; const first = await buildTechnicalBackup(backupSource); const second = await buildTechnicalBackup(backupSource); expect([...first]).toEqual([...second]); expect(await sha256(first)).toBe(await sha256(second)); await validateTechnicalBackup(first, backupSource) })
  it('sorts JSON object keys without changing array order', () => { expect(new TextDecoder().decode(canonicalJson({ z: 1, a: [{ b: 2, a: 1 }] }))).toBe('{"a":[{"a":1,"b":2}],"z":1}') })
  it('canonically serializes NDJSON records with one terminating newline', () => { expect(new TextDecoder().decode(canonicalNdjson([{ z: 1, a: 2 }, { b: 1, a: 2 }]))).toBe('{"a":2,"z":1}\n{"a":2,"b":1}\n') })
})
