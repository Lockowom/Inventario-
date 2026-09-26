import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LoginScreen } from '../../src/features/auth/login-screen'

describe('LoginScreen', () => {
  it('inicia sesión con correo y contraseña y notifica el éxito', async () => {
    const signIn = vi.fn().mockResolvedValue({})
    const onSignedIn = vi.fn()
    render(<LoginScreen service={{ signIn }} onSignedIn={onSignedIn} />)

    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'qa-analista@inven3-qa.test' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto-qa' } })
    fireEvent.click(screen.getByRole('button', { name: 'INICIAR SESIÓN' }))

    await waitFor(() => expect(signIn).toHaveBeenCalledWith('qa-analista@inven3-qa.test', 'secreto-qa'))
    expect(onSignedIn).toHaveBeenCalledOnce()
  })

  it('no expone el error técnico de Auth al usuario', async () => {
    const signIn = vi.fn().mockRejectedValue(new Error('internal auth detail'))
    render(<LoginScreen service={{ signIn }} />)
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'qa@example.test' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'incorrecta' } })
    fireEvent.click(screen.getByRole('button', { name: 'INICIAR SESIÓN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible iniciar sesión')
    expect(screen.queryByText('internal auth detail')).not.toBeInTheDocument()
  })
})
