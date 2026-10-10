import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const roles = new Set(['CONTADOR', 'ANALISTA', 'ADMIN']);
type Role = 'CONTADOR' | 'ANALISTA' | 'ADMIN';

function message(error: unknown) {
  return error instanceof Error ? error.message : 'La operación de usuarios no pudo completarse.';
}
function badRequest(detail: string) { return Response.json({ error: detail }, { status: 400 }); }
function readText(value: unknown, field: string, max = 160) {
  if (typeof value !== 'string') throw new Error(`${field} es obligatorio.`);
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`${field} no es válido.`);
  return text;
}
function readRole(value: unknown): Role {
  if (typeof value !== 'string' || !roles.has(value)) throw new Error('El rol no es válido.');
  return value as Role;
}
function readInventoryIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id)) throw new Error('Las asignaciones no son válidas.');
  if (new Set(value).size !== value.length) throw new Error('Las asignaciones no pueden repetirse.');
  return value as string[];
}
function readPassword(value: unknown) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) throw new Error('La contraseña temporal debe tener entre 12 y 128 caracteres, mayúscula, minúscula y número.');
  return value;
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return badRequest('El cuerpo debe ser JSON.'); }
    const actor = await ctx.supabase.auth.getUser();
    if (actor.error || !actor.data.user) return Response.json({ error: 'Autenticación requerida.' }, { status: 401 });
    const profile = await ctx.supabase.from('profiles').select('role, active').eq('user_id', actor.data.user.id).maybeSingle();
    if (profile.error || !profile.data?.active || profile.data.role !== 'ADMIN') return Response.json({ error: 'Administración reservada para ADMIN.' }, { status: 403 });

    try {
      const action = body.action;
      if (action === 'list') {
        const [profiles, assignments, inventories] = await Promise.all([
          ctx.supabaseAdmin.from('profiles').select('user_id, display_name, role, active, created_at, updated_at').order('display_name'),
          ctx.supabaseAdmin.from('inventory_assignments').select('user_id, inventory_id, active').eq('active', true),
          ctx.supabaseAdmin.from('inventories').select('id, name, status').order('name'),
        ]);
        if (profiles.error) throw profiles.error;
        if (assignments.error) throw assignments.error;
        if (inventories.error) throw inventories.error;
        const authUsers: Array<{ id: string; email?: string }> = [];
        let page: number | null = 1;
        while (page !== null) {
          const result = await ctx.supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
          if (result.error) throw result.error;
          authUsers.push(...result.data.users);
          page = result.data.nextPage;
        }
        const email = new Map(authUsers.map((user) => [user.id, user.email ?? '']));
        const grouped = new Map<string, string[]>();
        for (const assignment of assignments.data) grouped.set(assignment.user_id, [...(grouped.get(assignment.user_id) ?? []), assignment.inventory_id]);
        return Response.json({ users: profiles.data.map((user) => ({ ...user, email: email.get(user.user_id) ?? '', inventoryIds: grouped.get(user.user_id) ?? [] })), inventories: inventories.data });
      }
      if (action === 'create') {
        const email = readText(body.email, 'El correo', 320).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('El correo no es válido.');
        const password = readPassword(body.password);
        const displayName = readText(body.displayName, 'El nombre');
        const role = readRole(body.role);
        const inventoryIds = readInventoryIds(body.inventoryIds);
        const created = await ctx.supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error || !created.data.user) throw created.error ?? new Error('No se creó el usuario de autenticación.');
        const provisioned = await ctx.supabaseAdmin.rpc('admin_upsert_user_profile_from_edge', { p_actor_user_id: actor.data.user.id, p_target_user_id: created.data.user.id, p_display_name: displayName, p_role: role, p_active: true, p_inventory_ids: inventoryIds, p_event_type: 'USER_CREATED' });
        if (provisioned.error) {
          await ctx.supabaseAdmin.auth.admin.updateUserById(created.data.user.id, { ban_duration: '876000h' });
          throw provisioned.error;
        }
        return Response.json({ user: { ...provisioned.data, email, inventoryIds } }, { status: 201 });
      }
      if (action === 'update') {
        const userId = readText(body.userId, 'El usuario', 64);
        const displayName = readText(body.displayName, 'El nombre');
        const role = readRole(body.role);
        if (typeof body.active !== 'boolean') throw new Error('El estado de usuario no es válido.');
        const inventoryIds = readInventoryIds(body.inventoryIds);
        const updated = await ctx.supabaseAdmin.rpc('admin_upsert_user_profile_from_edge', { p_actor_user_id: actor.data.user.id, p_target_user_id: userId, p_display_name: displayName, p_role: role, p_active: body.active, p_inventory_ids: inventoryIds, p_event_type: 'USER_UPDATED' });
        if (updated.error) throw updated.error;
        const authUpdated = await ctx.supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: body.active ? 'none' : '876000h' });
        if (authUpdated.error) throw authUpdated.error;
        return Response.json({ user: { ...updated.data, inventoryIds } });
      }
      if (action === 'set_temporary_password') {
        const userId = readText(body.userId, 'El usuario', 64);
        const password = readPassword(body.password);
        const changed = await ctx.supabaseAdmin.auth.admin.updateUserById(userId, { password });
        if (changed.error) throw changed.error;
        const audited = await ctx.supabaseAdmin.rpc('admin_record_user_password_reset_from_edge', { p_actor_user_id: actor.data.user.id, p_target_user_id: userId });
        if (audited.error) throw audited.error;
        return Response.json({ ok: true });
      }
      return badRequest('Acción de administración no reconocida.');
    } catch (error) {
      // Never log the request body: it can contain an administrator-selected password.
      console.error('manage-users failed', { action: body.action, error: message(error) });
      return Response.json({ error: message(error) }, { status: 400 });
    }
  }),
};
