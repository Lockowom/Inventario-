import * as XLSX from '@e965/xlsx'
import { describe, expect, it } from 'vitest'
import { createMasterFingerprint, deriveMasterControlType, normalizeMasterCode, validMasterItems } from '../../src/domain/master/contracts'
import { parseMasterClipboard, parseMasterCsv, parseMasterXlsx } from '../../src/features/master/master-import-parser'

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

  it('autodetecta coma y punto y coma, conservando campos quoted con delimitadores', () => {
    const comma = parseMasterCsv('\uFEFFCODIGO,DESCRIPCION\r\n00001,"Producto, con coma"')
    const semicolon = parseMasterCsv('CODIGO;DESCRIPCION\n00002;"Producto; con punto y coma"')
    expect(validMasterItems(comma)[0]).toMatchObject({ codigo: '00001', descripcion: 'Producto, con coma' })
    expect(validMasterItems(semicolon)[0]).toMatchObject({ codigo: '00002', descripcion: 'Producto; con punto y coma' })
  })

  it('reporta vacíos y duplicados sin habilitar una importación parcial', () => {
    const preview = parseMasterCsv('CODIGO,DESCRIPCION\n,Sin código\nA1,\n a1 ,Duplicado')
    expect(preview.validRows).toBe(0)
    expect(preview.rejectedRows).toBe(3)
    expect(preview.emptyRows).toBe(2)
    expect(preview.duplicateRows).toBe(1)
    expect(preview.rows[2]?.errors).toContain('CODIGO DUPLICADO')
  })

  it('acepta pegado directo desde Excel/Sheets como TSV con encabezados', () => {
    const preview = parseMasterClipboard('Cod. Producto\tProducto\n00001234\tProducto legacy\nNVI75200055P\tProducto partida')
    expect(preview.rejectedRows).toBe(0)
    expect(validMasterItems(preview)).toEqual([
      { codigo: '00001234', descripcion: 'Producto legacy', controlType: 'LEGACY' },
      { codigo: 'NVI75200055P', descripcion: 'Producto partida', controlType: 'PARTIDA' },
    ])
  })

  it('acepta pegado de dos columnas sin encabezados y conserva ceros iniciales', () => {
    const preview = parseMasterClipboard('00000123\tProducto uno\n0WA46651050S\tProducto serial')
    expect(preview.rejectedRows).toBe(0)
    expect(validMasterItems(preview)).toEqual([
      { codigo: '00000123', descripcion: 'Producto uno', controlType: 'LEGACY' },
      { codigo: '0WA46651050S', descripcion: 'Producto serial', controlType: 'SERIAL' },
    ])
  })

  it('preserva códigos XLSX de texto con ceros iniciales y no inventa ceros para una celda numérica', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['CODIGO', 'DESCRIPCION'], ['00725', 'Uno'], ['00001', 'Dos'], ['001234', 'Tres'], [725, 'Número original']])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Maestro')
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const preview = await parseMasterXlsx(bytes)
    expect(validMasterItems(preview).map((item) => item.codigo)).toEqual(['00725', '00001', '001234', '725'])
  })

  it('acepta encabezados nativos del stock RP y preserva el contrato de control', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Cod. Producto', 'Producto', 'Cod. U. Medida', 'Disponible', 'Reserva', 'Transitoria', 'Consignación', 'Stock Total'],
      ['001234', 'Producto legacy', 'UNI', 1, 0, 0, 0, 1],
      ['000725P', 'Producto partida', 'UNI', 2, 0, 0, 0, 2],
      ['000123S', 'Producto serial', 'UNI', 1, 0, 0, 0, 1],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'STOCK TOTAL')
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const preview = await parseMasterXlsx(bytes)

    expect(preview.rejectedRows).toBe(0)
    expect(validMasterItems(preview)).toEqual([
      { codigo: '001234', descripcion: 'Producto legacy', controlType: 'LEGACY' },
      { codigo: '000725P', descripcion: 'Producto partida', controlType: 'PARTIDA' },
      { codigo: '000123S', descripcion: 'Producto serial', controlType: 'SERIAL' },
    ])
  })

  it('prioriza la hoja STOCK TOTAL aunque el libro tenga otra hoja primero', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['OTRO'], ['IGNORAR']]), 'PORTADA')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Cod. Producto', 'Producto'],
      ['001234', 'Producto correcto'],
    ]), 'STOCK TOTAL')
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const preview = await parseMasterXlsx(bytes)
    expect(validMasterItems(preview)).toEqual([
      { codigo: '001234', descripcion: 'Producto correcto', controlType: 'LEGACY' },
    ])
  })

  it('genera el mismo fingerprint para la misma semántica sin importar el orden', async () => {
    const first = [{ codigo: '00001', descripcion: 'Uno', controlType: 'LEGACY' as const }, { codigo: 'ABCSP', descripcion: 'Dos', controlType: 'PARTIDA' as const }]
    const second = [...first].reverse()
    await expect(createMasterFingerprint(first)).resolves.toBe(await createMasterFingerprint(second))
  })
})
