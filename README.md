# INVEN3

Sistema de captura para Inventario General físico, offline-first, con soporte Android, iOS y Web.

## Estado

**Fase actual:** planificación cerrada / preparación de implementación.

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

## Regla de gobierno

Cualquier cambio funcional que modifique contratos, reglas de negocio, flujo de conteo, cortes, exportación RP, roles o ciclo de vida del inventario debe quedar documentado en este repositorio antes de implementarse.
