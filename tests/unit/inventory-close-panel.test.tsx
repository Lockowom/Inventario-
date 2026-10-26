import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InventoryClosePanel } from '../../src/features/supervision/inventory-close-panel'

const ready = {
  inventory_id: '10000000-0000-4000-8000-000000000001', warehouse_id: '20000000-0000-4000-8000-000000000001',
  current_status: 'ABIERTO', target_status: 'CERRADO' as const, is_ready: true, fingerprint: 'a'.repeat(64),
  blocker_codes: [], blockers: [], blocker_counts: { open_c2_count: 0, open_c3_count: 0, blocking_findings_count: 0, unresolved_reviews_count: 0, rp_pending_refs_count: 0, rp_ready_count: 0 }, material_summary: {},
}

describe('InventoryClosePanel', () => {
  it('presents server readiness then requires an explicit confirmation before the canonical close RPC', async () => {
    const previewInventoryClose = vi.fn().mockResolvedValue(ready)
    const closeInventoryFinal = vi.fn().mockResolvedValue({ inventory_id: ready.inventory_id, close_request_id: '30000000-0000-4000-8000-000000000001', status: 'CERRADO', fingerprint: ready.fingerprint, idempotent: false })
    render(<InventoryClosePanel inventoryId={ready.inventory_id} repository={{ previewInventoryClose, closeInventoryFinal }} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'REVISAR CIERRE' }))
    expect(await screen.findByText('INVENTARIO LISTO PARA CIERRE')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'CERRAR INVENTARIO' }))
    const dialog = screen.getByRole('dialog', { name: 'Confirmar cierre final' })
    expect(within(dialog).getByText(/no ajusta ERP/i)).toBeInTheDocument()
    expect(closeInventoryFinal).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'CONFIRMAR CIERRE' }))
    await waitFor(() => expect(closeInventoryFinal).toHaveBeenCalledWith(ready.inventory_id, ready.fingerprint, expect.any(String)))
    expect(await screen.findByText(/Inventario cerrado correctamente/)).toBeInTheDocument()
  })

  it('renders blockers from the server and keeps the close action unavailable', async () => {
    const previewInventoryClose = vi.fn().mockResolvedValue({ ...ready, is_ready: false, blocker_codes: ['OPEN_C2'], blockers: [{ code: 'OPEN_C2', count: 2, blocks_close: true }], blocker_counts: { ...ready.blocker_counts, open_c2_count: 2 } })
    render(<InventoryClosePanel inventoryId={ready.inventory_id} repository={{ previewInventoryClose, closeInventoryFinal: vi.fn() }} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'REVISAR CIERRE' }))
    expect(await screen.findByText('CIERRE BLOQUEADO')).toBeInTheDocument()
    expect(screen.getByText('Hay reconteos C2 abiertos.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CERRAR INVENTARIO' })).not.toBeInTheDocument()
  })

  it('shows the stale message and asks for a fresh preview instead of retrying the close', async () => {
    const previewInventoryClose = vi.fn().mockResolvedValue(ready)
    const closeInventoryFinal = vi.fn().mockRejectedValue(new Error('PREVIEW_STALE'))
    render(<InventoryClosePanel inventoryId={ready.inventory_id} repository={{ previewInventoryClose, closeInventoryFinal }} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'REVISAR CIERRE' }))
    await screen.findByText('INVENTARIO LISTO PARA CIERRE')
    fireEvent.click(screen.getByRole('button', { name: 'CERRAR INVENTARIO' }))
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRMAR CIERRE' }))
    expect(await screen.findByText(/cambió desde la última revisión/i)).toBeInTheDocument()
    await waitFor(() => expect(previewInventoryClose).toHaveBeenCalledTimes(2))
    expect(closeInventoryFinal).toHaveBeenCalledTimes(1)
  })

  it('does not issue a second close request when confirmation is double-clicked', async () => {
    const previewInventoryClose = vi.fn().mockResolvedValue(ready)
    let resolveClose: (value: { inventory_id: string; close_request_id: string; status: 'CERRADO'; fingerprint: string; idempotent: boolean }) => void
    const closeInventoryFinal = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveClose = resolve }))
    render(<InventoryClosePanel inventoryId={ready.inventory_id} repository={{ previewInventoryClose, closeInventoryFinal }} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'REVISAR CIERRE' }))
    await screen.findByText('INVENTARIO LISTO PARA CIERRE')
    fireEvent.click(screen.getByRole('button', { name: 'CERRAR INVENTARIO' }))
    const confirm = screen.getByRole('button', { name: 'CONFIRMAR CIERRE' })
    fireEvent.click(confirm); fireEvent.click(confirm)
    await waitFor(() => expect(closeInventoryFinal).toHaveBeenCalledTimes(1))
    resolveClose!({ inventory_id: ready.inventory_id, close_request_id: '30000000-0000-4000-8000-000000000001', status: 'CERRADO', fingerprint: ready.fingerprint, idempotent: false })
    expect(await screen.findByText(/Inventario cerrado correctamente/)).toBeInTheDocument()
  })

  it('does not expose a final-close action after the server reports CERRADO', async () => {
    const previewInventoryClose = vi.fn().mockResolvedValue({ ...ready, current_status: 'CERRADO', is_ready: false, blocker_codes: ['INVALID_LIFECYCLE'], blockers: [{ code: 'INVALID_LIFECYCLE', count: 1, blocks_close: true }] })
    render(<InventoryClosePanel inventoryId={ready.inventory_id} repository={{ previewInventoryClose, closeInventoryFinal: vi.fn() }} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'REVISAR CIERRE' }))
    expect(await screen.findByText(/El inventario está cerrado/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CERRAR INVENTARIO' })).not.toBeInTheDocument()
  })

  it('keeps the server denial readable and never fabricates a readiness state', async () => {
    const previewInventoryClose = vi.fn().mockRejectedValue(new Error('CAPABILITY_REQUIRED'))
    render(<InventoryClosePanel inventoryId={ready.inventory_id} repository={{ previewInventoryClose, closeInventoryFinal: vi.fn() }} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'REVISAR CIERRE' }))
    expect(await screen.findByText('No tienes autorización para cerrar este inventario.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CERRAR INVENTARIO' })).not.toBeInTheDocument()
  })

  it('returns focus to the close action when the explicit confirmation is cancelled with Escape', async () => {
    render(<InventoryClosePanel inventoryId={ready.inventory_id} repository={{ previewInventoryClose: vi.fn().mockResolvedValue(ready), closeInventoryFinal: vi.fn() }} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'REVISAR CIERRE' }))
    const trigger = await screen.findByRole('button', { name: 'CERRAR INVENTARIO' })
    fireEvent.click(trigger)
    const confirm = screen.getByRole('button', { name: 'CONFIRMAR CIERRE' })
    expect(confirm).toHaveFocus()
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'CANCELAR' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('refreshes server blockers after an inventory-not-ready response without retrying close', async () => {
    const previewInventoryClose = vi.fn()
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ ...ready, is_ready: false, blocker_codes: ['FINDING_BLOCKS_CLOSE'], blockers: [{ code: 'FINDING_BLOCKS_CLOSE', count: 1, blocks_close: true }] })
    const closeInventoryFinal = vi.fn().mockRejectedValue(new Error('INVENTORY_NOT_READY'))
    render(<InventoryClosePanel inventoryId={ready.inventory_id} repository={{ previewInventoryClose, closeInventoryFinal }} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'REVISAR CIERRE' }))
    await screen.findByRole('button', { name: 'CERRAR INVENTARIO' })
    fireEvent.click(screen.getByRole('button', { name: 'CERRAR INVENTARIO' }))
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRMAR CIERRE' }))
    expect(await screen.findByText(/todavía tiene bloqueos/i)).toBeInTheDocument()
    expect(await screen.findByText('FINDING_BLOCKS_CLOSE')).toBeInTheDocument()
    expect(closeInventoryFinal).toHaveBeenCalledTimes(1)
  })
})
