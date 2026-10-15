import { useState, type FormEvent } from 'react'
import { authService } from './auth-service'

export interface LoginService {
  signIn(email: string, password: string): Promise<unknown>
}

export function LoginScreen({ service = authService, onSignedIn }: { service?: LoginService; onSignedIn?: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await service.signIn(email, password)
      setPassword('')
      onSignedIn?.()
    } catch {
      setError('No fue posible iniciar sesión. Verifique las credenciales y vuelva a intentar.')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="login-shell">
    <section className="login-card" aria-labelledby="login-title">
      <p className="eyebrow">Acceso seguro</p>
      <h1 id="login-title">INVEN3</h1>
      <p className="login-description">Ingrese con una cuenta autorizada para el inventario activo.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <form onSubmit={(event) => void submit(event)}>
        <label className="field"><span>Correo</span><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="field"><span>Contraseña</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="button-primary login-submit" type="submit" disabled={submitting}>{submitting ? 'VALIDANDO…' : 'INICIAR SESIÓN'}</button>
      </form>
    </section>
  </main>
}
