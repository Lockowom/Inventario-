import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CountingScreen, type CountingRuntime } from '../../src/features/counting/counting-screen'
import { resetAfterSuccessfulSave } from '../../src/features/counting/form-state'
import { validatePhysicalCountDraft, type PhysicalCountDraft } from '../../src/domain/count/contracts'
import type { MasterSku } from '../../src/domain/master/contracts'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const deviceId = '33333333-3333-4333-8333-333333333333'

function master(controlType: MasterSku['controlType']): MasterSku {
  return { inventoryId, codigo: `${controlType}-SKU`, descripcion: `Producto ${controlType}`, controlType, cachedAt: '2026-10-08T00:00:00.000Z' }
}

function runtime(): CountingRuntime {
  return {
    context: { inventoryId, userId, inventoryStatus: 'ABIERTO' },
    masters: {
      getMetadata: async () => ({ inventoryId, masterVersion: 1, rowCount: 3, fingerprint: 'a'.repeat(64), cachedAt: '2026-10-08T00:00:00.000Z' }),
      findByCode: async (_inventoryId: string, code: string) => (['SERIAL', 'PARTIDA', 'LEGACY'] as const).includes(code as 'SERIAL' | 'PARTIDA' | 'LEGACY') ? master(code as MasterSku['controlType']) : null,
      listByInventory: async () => [], replaceSnapshot: async () => undefined,
    },
    counts: { getOrCreateDeviceId: async () => deviceId, countPendingByDevice: async () => 0, listOwnCounts: async () => [] },
  } as unknown as CountingRuntime
}

async function resolve(controlType: MasterSku['controlType']) {
  render(<CountingScreen runtime={runtime()} captureGate={{ blocked: false, message: null }} />)
  const code = await screen.findByLabelText('CODIGO')
  fireEvent.change(code, { target: { value: controlType } })
  fireEvent.blur(code)
  await screen.findByText('✓ PRODUCTO IDENTIFICADO')
}

describe('Conteo Físico 2.0', () => {
  it('oculta Pieza, Talla y Color, y sitúa la descripción identificada debajo del código', async () => {
    await resolve('LEGACY')
    expect(screen.queryByLabelText('PIEZA DEL PRODUCTO')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Talla del producto')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Color del Producto')).not.toBeInTheDocument()
    expect(screen.getByText('Producto LEGACY')).toBeVisible()
    expect(screen.queryByLabelText('DESCRIPCION')).not.toBeInTheDocument()
  })

  it('muestra sólo los campos operativos para SERIAL y fija cantidad en uno', async () => {
    await resolve('SERIAL')
    expect(screen.getByLabelText('SERIE')).toBeEnabled()
    await waitFor(() => expect(screen.getByLabelText('SERIE')).toHaveFocus())
    expect(screen.queryByLabelText('PARTIDA')).not.toBeInTheDocument()
    expect(screen.getByLabelText('CANTIDAD CONTADA')).toHaveValue('1')
    expect(screen.getByLabelText('CANTIDAD CONTADA')).toHaveAttribute('readonly')
  })

  it('muestra Partida, pero no Serie, para productos PARTIDA', async () => {
    await resolve('PARTIDA')
    expect(screen.getByLabelText('PARTIDA')).toBeEnabled()
    await waitFor(() => expect(screen.getByLabelText('PARTIDA')).toHaveFocus())
    expect(screen.queryByLabelText('SERIE')).not.toBeInTheDocument()
    expect(screen.getByLabelText('CANTIDAD CONTADA')).toBeEnabled()
  })

  it('oculta Serie y Partida para LEGACY, y bloquea código no encontrado', async () => {
    await resolve('LEGACY')
    expect(screen.queryByLabelText('SERIE')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('PARTIDA')).not.toBeInTheDocument()

    const code = screen.getByLabelText('CODIGO')
    fireEvent.change(code, { target: { value: 'NO-EXISTE' } })
    fireEvent.blur(code)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('CÓDIGO NO ENCONTRADO EN MAESTRO'))
    expect(screen.getByRole('button', { name: 'GUARDAR CONTEO' })).toBeDisabled()
  })

  it('conserva ubicación al resetear y normaliza los campos ocultos a null', () => {
    const draft: PhysicalCountDraft = { ubicacion: 'F-32-03', codigo: 'LEGACY-SKU', piezaProducto: '', talla: '', color: '', cantidadContada: '2' }
    expect(resetAfterSuccessfulSave(draft)).toMatchObject({ ubicacion: 'F-32-03', codigo: '', piezaProducto: '', talla: '', color: '' })
    expect(validatePhysicalCountDraft(draft, master('LEGACY'))).toMatchObject({ piezaProducto: null, talla: null, color: null })
  })
})
