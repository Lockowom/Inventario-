import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), setTemporaryPassword: vi.fn() }))
vi.mock('../../src/services/supabase-user-management-repository', () => ({ SupabaseUserManagementRepository: class { list = mocks.list; create = mocks.create; update = mocks.update; setTemporaryPassword = mocks.setTemporaryPassword } }))
import { UserManagementScreen } from '../../src/features/user-management/user-management-screen'

const id = '11111111-1111-4111-8111-111111111111'
describe('UserManagementScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue({ users: [{ user_id: id, email: 'counter@example.com', display_name: 'Counter', role: 'CONTADOR', active: true, created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', inventoryIds: [] }], inventories: [] })
    mocks.create.mockResolvedValue({}); mocks.update.mockResolvedValue({}); mocks.setTemporaryPassword.mockResolvedValue({})
  })
  it('hides the privileged screen from non-admin roles', () => {
    const { container } = render(<UserManagementScreen role="ANALISTA" />)
    expect(container).toBeEmptyDOMElement()
  })
  it('creates a user without ever rendering a stored password', async () => {
    render(<UserManagementScreen role="ADMIN" />)
    await flush()
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Nombre visible'), { target: { value: 'New user' } })
    fireEvent.change(screen.getByLabelText('Contraseña inicial'), { target: { value: 'Temporary-password-12' } })
    fireEvent.click(screen.getByRole('button', { name: 'CREAR USUARIO' }))
    await flush()
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.com', password: 'Temporary-password-12' }))
    expect(screen.getByText(/no podrá volver a verse/i)).toBeInTheDocument()
  })
  it('only sends a temporary password after an explicit selected-user action', async () => {
    render(<UserManagementScreen role="ADMIN" />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'EDITAR' }))
    fireEvent.change(screen.getByLabelText('Nueva contraseña temporal'), { target: { value: 'Temporary-password-12' } })
    fireEvent.click(screen.getByRole('button', { name: 'ESTABLECER CONTRASEÑA TEMPORAL' }))
    await flush()
    expect(mocks.setTemporaryPassword).toHaveBeenCalledWith({ userId: id, password: 'Temporary-password-12' })
  })
  it('persists a typed temporary password when the administrator saves an existing user', async () => {
    render(<UserManagementScreen role="ADMIN" />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'EDITAR' }))
    fireEvent.change(screen.getByLabelText('Nueva contraseña temporal'), { target: { value: 'Temporary-password-12' } })
    expect(screen.getByRole('button', { name: 'GUARDAR CAMBIOS Y CONTRASEÑA' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'GUARDAR CAMBIOS Y CONTRASEÑA' }))
    await flush()
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ userId: id }))
    expect(mocks.setTemporaryPassword).toHaveBeenCalledWith({ userId: id, password: 'Temporary-password-12' })
    expect(screen.getByText('Usuario y contraseña temporal actualizados y auditados.')).toBeInTheDocument()
  })
})
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }
