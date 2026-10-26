# CUT2-10C — Certificación local de UI de cierre

## Alcance

La experiencia final vive en Supervisión, dentro del ciclo de vida del
inventario. Es un consumidor de las RPC canónicas `preview_inventory_close` y
`close_inventory_final`; no existe una segunda autoridad de readiness ni de
cierre en el cliente.

## Contrato de usuario

- **Preview:** estado, objetivo, huella, hora de actualización y cuentas de
  blockers C2/C3/findings/reviews/sellos/huérfanos/RP.
- **Bloqueos:** el código, la cuenta y la indicación de dónde resolverlo se
  muestran sin intentar resolverlo desde el diálogo.
- **Confirmación fuerte:** explica que el cierre bloquea operaciones
  incompatibles y no ajusta ERP, stock, XLSX ni RP.
- **Errores:** stale obliga a refrescar; not-ready repone blockers; cerrado y
  falta de capability eliminan la acción efectiva.
- **Accesibilidad/responsive:** diálogo con etiqueta, foco en confirmar,
  Escape para cancelar y devolución de foco; sin overflow horizontal a 1440,
  834 y 390 px.

## E2E local-real

`scripts/cut2-10c-local-browser-e2e.mjs` ejecuta C01–C10 contra Auth,
PostgREST, PostgreSQL y Vite locales. Cubre ready, findings, C2/C3, RP,
stale, auth/scope, cierre único, no-ERP/no-stock y denegaciones post-cierre.
El arnés rechaza hosts no locales y verifica ausencia de service role en
storage del navegador. La repetición requerida y el reset fresh se registran
en `CUT2_10_LOCAL_VALIDATION.md` al cierre del gate.

## Evidencia ejecutada

- Tres corridas independientes: **30/30** C01–C10, sin retry.
- Tras `supabase db reset --local --no-seed --yes`: **10/10** C01–C10.
- En las cuatro corridas: `remote requests=0`, `service role browser
  exposure=0` y cleanup del arnés completado.
- La prueba de doble click produjo una sola request `COMPLETED` y un único
  `INVENTORY_CLOSED`; el checksum de referencias de sistema no cambió.
- El stale material se ejerció entre preview y confirmación desde Chromium y
  exigió una nueva preview antes del cierre posterior.

## Límite

No hay deploy, push, Supabase remoto, ERP ni apertura de CUT2-11 en esta
certificación.
