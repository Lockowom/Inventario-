# F10A — Beta Smoke Runbook

Objetivo: comprobar que el **artefacto Release QA/BETA** funciona después del empaquetado nativo. No repite la certificación exhaustiva F9.

## Precondiciones

- branch/candidato F10A;
- `environment = QA`;
- `channel = BETA`;
- `productionLocked = true`;
- usuario e inventario sintéticos QA;
- candidate evidence correspondiente a la plataforma;
- ningún dato productivo.

## Cadena verificable candidato → instalación

La evidencia debe demostrar qué artefacto candidato originó exactamente el binario instalado:

1. Registrar `candidate_evidence_ref` como la ruta relativa normalizada al JSON exacto usado para el smoke y calcular sobre ese mismo archivo `candidate_evidence_sha256`.
2. Tomar `source_candidate_artifact_sha256` del campo `artifacts[].sha256` del mismo candidate evidence.
3. Registrar el hash SHA-256 del binario que se instala como `installed_artifact_sha256`.
4. Registrar `install_method`:
   - `local_device`;
   - `managed_device_lab`.
5. Registrar `signing_provenance`:
   - Android de laboratorio generado por el pipeline: `ephemeral_lab_signing`;
   - artefacto instalado sin transformación: `candidate_as_built`;
   - IPA iOS firmado de nuevo en laboratorio: `laboratory_resign`.
6. Añadir a `evidence_refs` la referencia al candidate evidence, la salida del hash y, si aplica, el registro controlado de re-firma/instalación.

Reglas obligatorias:

- `candidate_evidence_ref` debe coincidir exactamente con la ruta relativa del candidate evidence entregado al cierre;
- `candidate_evidence_sha256` debe coincidir con el SHA-256 real de ese mismo JSON;
- `source_candidate_artifact_sha256` debe existir en `artifacts[]` del candidate evidence correspondiente;
- la fuente Android debe ser el APK instalable, nunca el AAB;
- la fuente iOS debe ser una IPA;
- con `candidate_as_built` o `ephemeral_lab_signing`, los hashes fuente e instalado deben ser iguales;
- con `laboratory_resign`, los hashes deben ser distintos;
- Android no admite `laboratory_resign`;
- iOS sólo admite `candidate_as_built` o `laboratory_resign`;
- una IPA unsigned no se instala directamente: debe re-firmarse en un laboratorio controlado y conservar la trazabilidad de la IPA candidata a la IPA re-firmada.

Ejemplos de hash:

```bash
sha256sum <artefacto>       # Linux
shasum -a 256 <artefacto>   # macOS
```

## Secuencia Android / iOS

1. Verificar la cadena candidato → instalación y completar los campos de trazabilidad, incluido el SHA-256 del candidate evidence.
2. Instalar el artefacto Release candidato o su derivado iOS re-firmado y trazable.
3. Abrir INVEN3.
4. Confirmar en diagnóstico:
   - Supabase = `CONFIGURED`;
   - Entorno = `QA`;
   - Canal = `BETA`;
   - `build` = `<candidate-sha8>.<run-number>`;
   - versión visible = exactamente `1.0.0-beta+<build>`.
5. Iniciar sesión con usuario QA sintético.
6. Confirmar que Health Check queda no bloqueante:
   - `READY`, `READY_OFFLINE` o `READY_WITH_WARNINGS`;
   - no aceptar `BLOCKED`.
7. Confirmar `CONTEO FÍSICO`.
8. Confirmar `MIS CONTEOS`.
9. Registrar exactamente un conteo sintético autorizado.
10. Confirmar `CONTEO GUARDADO`.
11. Sincronizar y confirmar que el mismo conteo llega a:
    - `Confirmado en servidor`.
12. Abrir scanner y cancelar.
13. Confirmar que cancelar scanner:
    - vuelve al formulario;
    - no guarda automáticamente otro conteo.
14. Registrar screenshots, logs, session IDs, hashes y prueba de signing/instalación en `evidence_refs`.
15. Completar la plantilla JSON de la plataforma.

## Validar evidencia

Android:

```bash
npm run release:smoke:check -- docs/f10a/ANDROID_BETA_SMOKE_EXECUTION.json
```

iOS:

```bash
npm run release:smoke:check -- docs/f10a/IOS_BETA_SMOKE_EXECUTION.json
```

Resultado requerido:

```text
[PASS] F10A_BETA_SMOKE_EVIDENCE platform=<android|ios> status=PASS
[PASS] READY_FOR_F10A_CLOSURE
```

## Paridad

Antes del smoke, ambos candidate evidence deben pasar:

```bash
npm run release:verify-parity
```

Resultado:

```text
[PASS] F10A_PLATFORM_PARITY
```

## Cierre

Con ambas evidencias PASS:

```bash
npm run release:f10a:close -- \
  --android-candidate artifacts/release/INVEN3-android-candidate-evidence.json \
  --ios-candidate artifacts/release/INVEN3-ios-candidate-evidence.json \
  --parity artifacts/release/INVEN3-f10a-platform-parity.json \
  --android-smoke docs/f10a/ANDROID_BETA_SMOKE_EXECUTION.json \
  --ios-smoke docs/f10a/IOS_BETA_SMOKE_EXECUTION.json
```

Debe generar:

`artifacts/release/INVEN3-F10A-closure.json`

con:

```text
F10A_RELEASE_ENGINEERING = PASS
nextGate = F10B_NOT_AUTHORIZED
productionLocked = true
```

El cierre conserva, por plataforma, la ruta fuente, ambos hashes, el método de instalación y la procedencia de firma.

## Criterio de rechazo

No cerrar F10A si:

- identidad no es QA/BETA;
- Supabase no está configurado;
- Health queda BLOCKED;
- el conteo no se guarda;
- el conteo no se confirma;
- scanner cancelar auto-guarda;
- candidate SHA/build no coincide;
- la versión visible no es exactamente `1.0.0-beta+<build>`;
- `candidate_evidence_ref` apunta a otro archivo;
- el SHA-256 del candidate evidence no coincide con el JSON usado en el cierre;
- el hash fuente no pertenece al candidate evidence;
- la fuente Android no es APK o la fuente iOS no es IPA;
- la relación entre hash fuente, hash instalado y procedencia de firma es inválida;
- falta evidencia de re-firma/instalación cuando corresponde;
- paridad Android/iOS falla;
- existe BLOCKER/CRITICAL abierto;
- producción deja de estar bloqueada.

## Producción

Este runbook no autoriza:

- Supabase PROD;
- migraciones PROD;
- Google Play;
- TestFlight/App Store;
- rollout real;
- F10B.
