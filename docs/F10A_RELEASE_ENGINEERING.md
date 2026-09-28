# F10A — Release Engineering

Fecha de inicio: 2026-09-28  
Estado: IN_PROGRESS  
Entorno permitido: INVEN3-QA  
Canal permitido: BETA  
Producción: LOCKED

## Objetivo

Preparar INVEN3 v1.0 para distribución controlada sin promover ni modificar producción.

F10A implementa el pipeline y los controles de release. No crea datos productivos, no ejecuta migraciones productivas, no despliega Edge Functions productivas y no promociona builds a usuarios finales.

## Identidad de release

Fuente autoritativa: `release-policy.json`.

- Producto: `INVEN3`
- Versión funcional: `1.0.0`
- Entorno por defecto: `qa`
- Canal por defecto: `beta`
- Android base versionCode: `10000`
- Android versionName: `1.0.0`
- iOS base build: `10000`
- iOS MARKETING_VERSION: `1.0.0`
- `productionLocked = true`

La identidad visible se forma como:

`1.0.0-beta+<build>`

Los builds históricos F9 que inyectan `VITE_APP_VERSION` conservan su etiqueta explícita.

## Guardas implementadas

`npm run release:preflight:static`

Valida:

- policy F10A presente;
- versión SemVer;
- package.json alineado;
- Android parametrizable;
- iOS alineado;
- producción bloqueada.

`npm run release:preflight`

Además valida el runtime:

- `VITE_RELEASE_ENV`;
- `VITE_RELEASE_CHANNEL`;
- `VITE_RELEASE_VERSION`;
- URL Supabase;
- anon key pública;
- ref exacto de `INVEN3-QA`.

Un build con entorno o canal `production` falla mientras `productionLocked=true`.

## Manifest de trazabilidad

Después del bundle:

`npm run release:manifest`

Genera:

`artifacts/release/INVEN3-release-manifest.json`

Incluye:

- versión;
- canal;
- entorno;
- build;
- commit;
- timestamp;
- versiones nativas;
- lista SHA-256 de archivos de `dist/`;
- SHA-256 agregado del bundle.

No incluye JWT, contraseñas, service-role, anon key ni signed URLs.

## Android QA/BETA

Existen dos rutas equivalentes de build:

- GitHub Actions: `.github/workflows/f10a-release-candidate.yml`;
- Codemagic: `android-release-candidate-f10a`.

La ruta Codemagic permite continuar mientras persista el incidente externo de GitHub Actions.

Produce:

- APK Release unsigned como evidencia técnica;
- AAB Release;
- APK de laboratorio instalable, firmado con una keystore efímera creada dentro del runner y destruida inmediatamente;
- manifest;
- SHA-256;
- evidencia de package identity;
- `INVEN3-android-candidate-evidence.json`.

La firma efímera NO es identidad productiva y no se conserva.

Ambas rutas usan exclusivamente INVEN3-QA/BETA y no distribuyen automáticamente.

## iOS QA/BETA

Workflow Codemagic:

`ios-release-candidate-f10a`

Usa el grupo ya existente:

`inven3_qa`

Produce:

- iPhoneOS Release `.app`;
- IPA unsigned para re-signing de laboratorio;
- SHA-256;
- manifest;
- verificación `CFBundleShortVersionString` / `CFBundleVersion`;
- `INVEN3-ios-candidate-evidence.json`;
- logs concisos.

No usa certificados de App Store, no publica en TestFlight y no promociona a producción.

## Diagnóstico de runtime

La pantalla técnica ahora expone:

- Plataforma;
- Storage;
- Supabase;
- Entorno;
- Canal;
- Versión.

Esto permite verificar visualmente que un dispositivo no está ejecutando accidentalmente un candidato de otro entorno.

## CI

El CI normal incluye `release:preflight:static`.

Al 2026-09-28 GitHub Actions presenta un incidente externo: los jobs recientes finalizan antes del primer step y sin logs. El código no convierte este incidente en PASS.

## Auditoría del bundle final

`npm run release:audit-bundle`

Se ejecuta sobre `dist/` ya compilado y verifica:

- presencia del host autorizado de INVEN3-QA;
- ausencia de backend localhost;
- ausencia de `sb_secret_*`;
- ausencia de `SUPABASE_SERVICE_ROLE_KEY`;
- producción todavía bloqueada.

## Evidencia del candidato

`npm run release:verify-candidate`

Valida el artefacto nativo contra el manifest y emite:

- Android: `INVEN3-android-candidate-evidence.json`;
- iOS: `INVEN3-ios-candidate-evidence.json`.

El estado válido previo al smoke es:

`READY_FOR_BETA_SMOKE`.

## Paridad Android/iOS

Después de obtener ambas evidencias:

`npm run release:verify-parity`

Requiere igualdad de:

- producto;
- gate;
- versión;
- entorno;
- canal;
- commit;
- SHA-256 agregado del bundle web.

Los build numbers nativos pueden diferir por plataforma, pero quedan registrados individualmente.

Salida:

`artifacts/release/INVEN3-f10a-platform-parity.json`

## Gate de salida F10A

F10A puede considerarse preparada cuando:

1. preflight estático pasa;
2. tests/typecheck pasan;
3. Android QA/BETA candidate se genera;
4. iOS QA/BETA candidate se genera;
5. ambos manifests/hashes/evidencias quedan disponibles;
6. `F10A_PLATFORM_PARITY = PASS`;
7. ambos candidatos quedan `READY_FOR_BETA_SMOKE`;
8. ningún pipeline tiene capacidad de promoción productiva;
9. producción sigue bloqueada.

## Fuera de alcance

Todavía NO ejecutar:

- Supabase PROD;
- migraciones PROD;
- Edge Functions PROD;
- Apple TestFlight/App Store;
- Google Play Production/Internal si apunta a backend productivo;
- rollout a inventario real;
- desbloqueo de `productionLocked`.

Eso pertenece a F10B/F10C y requiere autorización separada.
