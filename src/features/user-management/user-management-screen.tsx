import { useEffect, useMemo, useState } from 'react'
import type { AppRole } from '../../domain/auth/contracts'
import type { ManagedUser, ManageableInventory } from '../../domain/user-management/contracts'
import { SupabaseUserManagementRepository } from '../../services/supabase-user-management-repository'

const repository = new SupabaseUserManagementRepository()
const roles: AppRole[] = ['CONTADOR', 'ANALISTA', 'ADMIN']
type Form = { userId: string | null; email: string; displayName: string; role: AppRole; active: boolean; inventoryIds: string[]; password: string }
const fresh = (): Form => ({ userId: null, email: '', displayName: '', role: 'CONTADOR', active: true, inventoryIds: [], password: '' })

export function UserManagementScreen({ role }: { role: AppRole | null }) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [inventories, setInventories] = useState<ManageableInventory[]>([])
  const [form, setForm] = useState<Form>(fresh)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const isAdmin = role === 'ADMIN'
  const selected = useMemo(() => users.find((user) => user.user_id === form.userId) ?? null, [form.userId, users])

  async function reload() {
    if (!isAdmin) return
    setLoading(true)
    try {
      const data = await repository.list()
      setUsers(data.users); setInventories(data.inventories); setMessage('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible cargar usuarios.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  if (!isAdmin) return null
  const update = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }))
  const toggleAssignment = (inventoryId: string) => update('inventoryIds', form.inventoryIds.includes(inventoryId) ? form.inventoryIds.filter((id) => id !== inventoryId) : [...form.inventoryIds, inventoryId])
  const edit = (user: ManagedUser) => { setForm({ userId: user.user_id, email: user.email, displayName: user.display_name, role: user.role, active: user.active, inventoryIds: user.inventoryIds, password: '' }); setMessage('') }
  const reset = () => { setForm(fresh()); setMessage('') }
  async function save() {
    setLoading(true); setMessage('')
    try {
      if (form.userId) await repository.update({ userId: form.userId, displayName: form.displayName, role: form.role, active: form.active, inventoryIds: form.inventoryIds })
      else await repository.create({ email: form.email, displayName: form.displayName, role: form.role, inventoryIds: form.inventoryIds, password: form.password })
      setMessage(form.userId ? 'Usuario actualizado y auditado.' : 'Usuario creado. Comunique la contraseña inicial por un canal seguro.')
      reset(); await reload()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible guardar el usuario.') }
    finally { setLoading(false) }
  }
  async function setTemporaryPassword() {
    if (!form.userId) return
    setLoading(true); setMessage('')
    try {
      await repository.setTemporaryPassword({ userId: form.userId, password: form.password })
      update('password', ''); setMessage('Contraseña temporal actualizada y auditada. No se puede volver a consultar.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible actualizar la contraseña.') }
    finally { setLoading(false) }
  }

  return <section className="user-management-screen" aria-labelledby="user-management-title">
    <header><p className="eyebrow">Administración segura</p><h1 id="user-management-title">USUARIOS</h1><p>Solo ADMIN. Las contraseñas nunca se muestran, recuperan ni guardan en este sistema.</p></header>
    {message && <p className={message.includes('actualizado') || message.includes('creado') ? 'form-success' : 'form-error'} role="status">{message}</p>}
    <div className="user-management-layout">
      <section aria-label="Usuarios existentes"><div className="user-management-heading"><h2>Usuarios</h2><button className="button-secondary" type="button" onClick={() => void reload()} disabled={loading}>ACTUALIZAR</button></div>{users.length === 0 ? <p>Sin perfiles administrables.</p> : <ul className="user-list">{users.map((user) => <li key={user.user_id}><div><strong>{user.display_name}</strong><span>{user.email}</span><span>{user.role} · {user.active ? 'ACTIVO' : 'INACTIVO'}</span></div><button className="button-secondary" type="button" onClick={() => edit(user)} disabled={loading}>EDITAR</button></li>)}</ul>}</section>
      <form className="user-form" onSubmit={(event) => { event.preventDefault(); void save() }}><div className="user-management-heading"><h2>{selected ? 'Editar usuario' : 'Crear usuario'}</h2>{selected && <button className="button-secondary" type="button" onClick={reset} disabled={loading}>NUEVO</button>}</div>
        <label className="field"><span>Correo</span><input type="email" value={form.email} disabled={Boolean(form.userId)} autoComplete="off" onChange={(event) => update('email', event.target.value)} required /></label>
        <label className="field"><span>Nombre visible</span><input value={form.displayName} maxLength={160} onChange={(event) => update('displayName', event.target.value)} required /></label>
        <label className="field"><span>Rol</span><select value={form.role} onChange={(event) => update('role', event.target.value as AppRole)}>{roles.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        {form.userId && <label className="field"><span>Estado</span><select value={form.active ? 'active' : 'inactive'} onChange={(event) => update('active', event.target.value === 'active')}><option value="active">ACTIVO</option><option value="inactive">INACTIVO</option></select></label>}
        <fieldset className="assignment-field"><legend>Inventarios asignados</legend>{inventories.length ? inventories.map((inventory) => <label key={inventory.id}><input type="checkbox" checked={form.inventoryIds.includes(inventory.id)} onChange={() => toggleAssignment(inventory.id)} /> {inventory.name} · {inventory.status}</label>) : <p>Sin inventarios disponibles.</p>}</fieldset>
        <label className="field"><span>{form.userId ? 'Nueva contraseña temporal' : 'Contraseña inicial'}</span><input aria-label={form.userId ? 'Nueva contraseña temporal' : 'Contraseña inicial'} type="password" value={form.password} minLength={12} maxLength={128} autoComplete="new-password" onChange={(event) => update('password', event.target.value)} required={!form.userId} /><small>12 a 128 caracteres, con mayúscula, minúscula y número. Solo se envía al servicio de autenticación y no podrá volver a verse.</small></label>
        <button className="button-primary" type="submit" disabled={loading}>{form.userId ? 'GUARDAR CAMBIOS' : 'CREAR USUARIO'}</button>
        {form.userId && <button className="button-secondary" type="button" disabled={loading || form.password.length < 12} onClick={() => void setTemporaryPassword()}>ESTABLECER CONTRASEÑA TEMPORAL</button>}
      </form>
    </div>
  </section>
}
