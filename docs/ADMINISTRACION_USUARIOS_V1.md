# Administración de usuarios v1

Estado: `IMPLEMENTED_LOCAL / PENDING_QA_DEPLOYMENT`

La administración de usuarios es exclusiva del rol `ADMIN`. La interfaz nunca recibe una clave de servicio de Supabase ni consulta `auth.users` directamente. Todas las operaciones pasan por la Edge Function autenticada `manage-users`, que vuelve a leer el perfil activo del solicitante antes de usar el cliente administrativo del servidor.

## Ciclo de vida

- Crear: el administrador define correo, nombre, rol, asignaciones y una contraseña inicial de 12 a 128 caracteres, con mayúscula, minúscula y número. La contraseña se entrega una sola vez por el formulario al servicio de Auth y no se devuelve.
- Editar: se permiten nombre, rol, inventarios y estado activo. No hay borrado operacional. Una cuenta inactiva queda vetada en Auth y sin autoridad efectiva por `profiles.active`.
- Contraseña olvidada o cambio: un ADMIN fija una nueva contraseña temporal. El valor no se almacena en PostgreSQL, en el cliente, ni en auditoría; tampoco se puede consultar o recuperar una contraseña anterior.
- Seguridad de continuidad: no se puede desactivar ni degradar al último ADMIN activo.

## Auditoría y límites

`public.user_management_events` registra actor, usuario objetivo, evento y metadatos no sensibles. Los eventos son visibles solo para ADMIN. La tabla no contiene correo ni contraseña, hashes, tokens ni datos de sesión.

La creación de Auth y el perfil transaccional son sistemas distintos. Si la creación de perfil falla tras crear el usuario Auth, el servicio veta ese usuario: no se elimina ni se permite acceso sin perfil. Un ADMIN puede completar o corregir el aprovisionamiento posteriormente.

La recuperación por correo y el cambio obligatorio en el primer inicio no se afirman en esta versión: requieren una política de correo/SMTP y una experiencia de cambio propia aprobadas. Esta versión cubre el flujo inmediato solicitado: el administrador establece una contraseña temporal segura y la comunica por un canal apropiado.
