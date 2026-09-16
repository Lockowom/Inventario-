# INVEN3

Sistema de captura para Inventario General físico, offline-first, con soporte Android, iOS y Web.

## Estado

**Fase actual:** Fase 2 — maestro SKU, preparación y distribución offline.

## Inicio rápido

```bash
cp .env.example .env.local
npm ci
npm run dev
```

La pantalla inicial es un diagnóstico de infraestructura. Las variables de Supabase son opcionales en Fase 0; nunca agregues una clave `service_role` al cliente.

### Verificación

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

### Plataformas nativas

El identificador de la aplicación es `com.lockowom.inven3`. Android e iOS consumen el bundle local de `dist/`:

```bash
npm run cap:android
npm run cap:ios
```

La certificación de SQLite, permisos de cámara y scanner requiere pruebas en dispositivos Android e iOS reales antes de una fase de captura.

## Principios

- Conteo físico ciego: no mostrar stock RP/Softland durante captura.
- Mobile-first y offline-first.
- Android + iOS mediante Capacitor.
- Web administrativa en Cloudflare Pages.
- Persistencia central en Supabase/PostgreSQL.
- Base local móvil en SQLite.
- Trazabilidad completa de conteos, correcciones, cortes y rectificaciones.
- Cortes automáticos sin duplicados ni solapamientos.
- Exportación XLSX limpia para RP, preservando ceros iniciales y fechas reales de Excel.
- GitHub es la fuente oficial de código y documentación del proyecto.

## Documentación oficial

- [`docs/BLUEPRINT_INVEN3_V1.0.md`](docs/BLUEPRINT_INVEN3_V1.0.md) — Blueprint Técnico y Funcional aprobado para INVEN3 v1.0.
- [`docs/MODELO_DATOS_V1.md`](docs/MODELO_DATOS_V1.md) — entidades, relaciones y constraints de Fase 1.
- [`docs/SEGURIDAD_RLS_V1.md`](docs/SEGURIDAD_RLS_V1.md) — políticas RLS y RPC protegidas.
- [`docs/AUTH_Y_ROLES_V1.md`](docs/AUTH_Y_ROLES_V1.md) — cliente Auth y modelo de roles.
- [`docs/MAESTRO_SKU_V1.md`](docs/MAESTRO_SKU_V1.md) — contrato, preview e importación del maestro SKU.
- [`docs/OFFLINE_MASTER_V1.md`](docs/OFFLINE_MASTER_V1.md) — snapshot local, versión y refresco offline.

## Regla de gobierno

Cualquier cambio funcional que modifique contratos, reglas de negocio, flujo de conteo, cortes, exportación RP, roles o ciclo de vida del inventario debe quedar documentado en este repositorio antes de implementarse.
