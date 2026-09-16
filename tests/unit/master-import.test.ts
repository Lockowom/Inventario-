import * as XLSX from '@e965/xlsx'
import { describe, expect, it } from 'vitest'
import { createMasterFingerprint, deriveMasterControlType, normalizeMasterCode, validMasterItems } from '../../src/domain/master/contracts'
import { parseMasterCsv, parseMasterXlsx } from '../../src/features/master/master-import-parser'

describe('maestro SKU: normalización e importación', () => {
  it('deriva SERIAL, PARTIDA y LEGACY desde el código normalizado', () => {
    expect(deriveMasterControlType(normalizeMasterCode(' serie-s '))).toBe('SERIAL')
    expect(deriveMasterControlType(normalizeMasterCode(' lote-p '))).toBe('PARTIDA')
    expect(deriveMasterControlType(normalizeMasterCode(' 00001234 '))).toBe('LEGACY')
  })

  it('preserva ceros iniciales, trim y mayúsculas al parsear CSV', () => {
    const preview = parseMasterCsv('codigo,descripcion\n 00001234 , Producto uno \nNVI75200055P,Producto dos')
    expect(preview.validRows).toBe(2)
    expect(validMasterItems(preview)).toMatchObject([{ codigo: '00001234', descripcion: 'Producto uno', controlType: 'LEGACY' }, { codigo: 'NVI75200055P', controlType: 'PARTIDA' }])
  })

  it('reporta vacíos y duplicados sin habilitar una importación parcial', () => {
    const preview = parseMasterCsv('CODIGO,DESCRIPCION\n,Sin código\nA1,\n a1 ,Duplicado')
    expect(preview.validRows).toBe(0)
    expect(preview.rejectedRows).toBe(3)
    expect(preview.emptyRows).toBe(2)
    expect(preview.duplicateRows).toBe(1)
    expect(preview.rows[2]?.errors).toContain('CODIGO DUPLICADO')
  })

  it('parsea XLSX sin transformar un código de texto con ceros iniciales', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['CODIGO', 'DESCRIPCION'], ['00725', 'Producto con lote']])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Maestro')
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const preview = await parseMasterXlsx(bytes)
    expect(validMasterItems(preview)[0]).toMatchObject({ codigo: '00725', descripcion: 'Producto con lote' })
  })

  it('genera el mismo fingerprint para la misma semántica sin importar el orden', async () => {
    const first = [{ codigo: '00001', descripcion: 'Uno', controlType: 'LEGACY' as const }, { codigo: 'ABCSP', descripcion: 'Dos', controlType: 'PARTIDA' as const }]
    const second = [...first].reverse()
    await expect(createMasterFingerprint(first)).resolves.toBe(await createMasterFingerprint(second))
  })
})
