import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const parsers = vi.hoisted(() => ({
  parseMasterFile: vi.fn(),
  parseSystemReferenceFile: vi.fn(),
}))

vi.mock('../../src/features/master/master-import-parser', () => ({
  parseMasterFile: parsers.parseMasterFile,
}))

vi.mock('../../src/features/reconciliation/system-reference-import-parser', () => ({
  parseSystemReferenceFile: parsers.parseSystemReferenceFile,
}))

vi.mock('../../src/services/supabase-reconciliation-repository', () => ({
  SupabaseReconciliationRepository: class {},
}))

import { MasterSkuScreen } from '../../src/features/master/master-sku-screen'
import { SystemReferencePanel } from '../../src/features/reconciliation/system-reference-panel'

describe('preview file replacement', () => {
  it('discards the Master SKU preview before selecting another file', async () => {
    parsers.parseMasterFile.mockResolvedValue({
      totalRows: 1,
      validRows: 1,
      rejectedRows: 0,
      duplicateRows: 0,
      emptyRows: 0,
      rows: [{ rowNumber: 2, codigo: 'SKU-01', descripcion: 'Producto de prueba', normalizedCodigo: 'SKU-01', normalizedDescripcion: 'PRODUCTO DE PRUEBA', controlType: 'LEGACY', errors: [] }],
    })
    render(<MasterSkuScreen />)

    fireEvent.change(screen.getByLabelText('Archivo maestro (.csv o .xlsx)'), {
      target: { files: [new File(['codigo,descripcion\nSKU-01,Producto de prueba'], 'primero.csv', { type: 'text/csv' })] },
    })

    await screen.findByRole('button', { name: 'Cambiar archivo' })
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar archivo' }))

    expect(screen.queryByLabelText('Resumen de preview')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Archivo descartado')
    expect(parsers.parseMasterFile).toHaveBeenCalledTimes(1)
  })

  it('discards the RP preview before selecting another file', async () => {
    parsers.parseSystemReferenceFile.mockResolvedValue({
      fileName: 'primero.xlsx',
      fileSha256: 'a'.repeat(64),
      totalSourceRows: 1,
      itemCount: 1,
      serialItems: 0,
      batchItems: 0,
      legacyItems: 1,
      issues: [],
      items: [{ codigo: 'SKU-01', referenceType: 'LEGACY', referenceValue: null, quantity: 5, availableQuantity: 5, unitCode: 'UNI', expirationDate: null }],
    })
    render(<SystemReferencePanel inventoryId="inventory-1" inventoryStatus="PREPARADO" onMaterialized={() => undefined} />)

    fireEvent.change(screen.getByLabelText('Libro RP (.xlsx)'), {
      target: { files: [new File(['archivo de prueba'], 'primero.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })] },
    })

    await screen.findByRole('button', { name: 'Cambiar archivo' })
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar archivo' }))

    await waitFor(() => expect(screen.queryByLabelText('Resumen referencia sistema')).toBeNull())
    expect(screen.getByRole('status')).toHaveTextContent('Archivo descartado')
    expect(parsers.parseSystemReferenceFile).toHaveBeenCalledTimes(1)
  })
})
