# QA físico de dispositivos — Fase 9

Estado inicial de todos los ítems: `MANUAL_REQUIRED`. CI sólo certifica build, configuración y sincronización Capacitor; no certifica hardware físico.

## ANDROID

- [ ] Instalación e inicio de build candidato.
- [ ] Login con usuario de prueba y maestro offline disponible.
- [ ] SQLite: guardar conteo offline, cerrar/reabrir e inspeccionar pendiente.
- [ ] Reconectar y confirmar sync sin cambiar UUID.
- [ ] Permiso de cámara: aceptar y rechazar de forma controlada.
- [ ] Abrir scanner, QR, Code128, linterna cuando exista, cancelar y volver al formulario.
- [ ] Teclado no oculta guardar; safe area/barra gestual correctas.
- [ ] Rotación soportada y viewport angosto/estándar/grande verificadas.

## IOS

- [ ] Instalación e inicio desde Xcode/App Store Connect de prueba.
- [ ] Login con usuario de prueba y maestro offline disponible.
- [ ] SQLite: guardar conteo offline, cerrar/reabrir e inspeccionar pendiente.
- [ ] Reconectar y confirmar sync sin cambiar UUID.
- [ ] Permiso de cámara: aceptar y rechazar de forma controlada.
- [ ] Abrir scanner, QR, Code128, linterna cuando exista, cancelar y volver al formulario.
- [ ] Teclado, notch/Dynamic Island, safe area y barra gestual no ocultan controles.
- [ ] Rotación soportada y iPhone compacto/estándar/grande/iPad verificados.

Registrar para cada ejecución: modelo, versión SO, build/SHA, fecha, responsable, resultado y evidencia. Usar sólo usuarios e inventarios de prueba.
