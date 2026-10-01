# F10A — Release Engineering

Fecha de inicio: 2026-09-28  
Última actualización: 2026-10-01
Estado: CANDIDATE_READY / PHYSICAL_SMOKE_PENDING
Entorno permitido: INVEN3-QA  
Canal permitido: BETA  
Producción: LOCKED

La ruta canónica ya fue verificada en el run
[`36754978267`](https://github.com/Lockowom/Inventario-/actions/runs/36754978267)
para `6935ebc692ed6f129653b9d0f21d0bf66cd574d0`: validación estática,
bundle QA/BETA, Android, iOS y paridad finalizaron `PASS`. El paso pendiente
no es una reconstrucción: es la re-firma/instalación iOS y los smokes físicos
trazables de ambos artefactos de ese run.

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
- publishable/anon key pública;
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
- commit exacto del candidato;
- timestamp;
- versiones nativas;
- lista SHA-256 de archivos de `dist/`;
- SHA-256 agregado del bundle.

No incluye JWT, contraseñas, service-role, anon key ni signed URLs.

## Pipeline dual principal

La ruta principal sin Codemagic es:

`.github/workflows/f10a-github-dual-platform.yml`

Construye una sola vez el bundle web QA/BETA y lo reutiliza sin reconstrucción para ambas plataformas.

Android produce:

- APK Release unsigned como evidencia técnica;
- AAB Release;
- APK de laboratorio instalable, firmado con una keystore efímera creada dentro del runner y destruida inmediatamente;
- manifest;
- evidencia de firma e identidad;
- `INVEN3-android-candidate-evidence.json`.

iOS produce:

- iPhoneOS Release `.app`;
- IPA unsigned para re-firma controlada de laboratorio;
- SHA-256;
- manifest;
- verificación `CFBundleShortVersionString` / `CFBundleVersion`;
- `INVEN3-ios-candidate-evidence.json`;
- build log.

Después de cada `cap sync`, `npm run release:verify-native-web` comprueba archivo por archivo que el bundle certificado por el manifest quedó copiado sin cambios dentro de `android/app/src/main/assets/public` e `ios/App/App/public`. Un archivo ausente, modificado o una ruta insegura bloquea el candidato.

El job de paridad descarga las evidencias de ambas plataformas, compara byte a byte los manifests y exige además `F10A_NATIVE_WEB_PARITY = PASS` en Android e iOS. Los workflows separados de GitHub y Codemagic quedan como contingencia manual; no son necesarios para la ruta dual.

La firma efímera Android no es identidad productiva. La IPA unsigned iOS no se considera instalable ni smoke aprobado.

## Diagnóstico de runtime

La pantalla técnica expone:

- Plataforma;
- Storage;
- Supabase;
- Entorno;
- Canal;
- Versión.

Esto permite verificar visualmente que un dispositivo no está ejecutando accidentalmente un candidato de otro entorno.

## Auditoría del bundle final

`npm run release:audit-bundle`

Se ejecuta sobre `dist/` ya compilado y verifica:

- presencia del host autorizado de INVEN3-QA;
- ausencia de backend localhost;
- ausencia de `sb_secret_*`;
- ausencia de `SUPABASE_SERVICE_ROLE_KEY`;
- ausencia de JWT con rol `service_role`;
- ausencia de hosts Supabase distintos de INVEN3-QA;
- producción todavía bloqueada.

El preflight estático también valida la configuración nativa mínima: cámara Android/iOS, backup Android deshabilitado, tráfico HTTP bloqueado, iOS 15.5 y capacidad arm64.

## Evidencia del candidato y paridad

`npm run release:verify-candidate`

Valida cada artefacto nativo contra el manifest y emite:

- Android: `INVEN3-android-candidate-evidence.json`, con APK, AAB y evidencia del bundle dentro del proyecto Android;
- iOS: `INVEN3-ios-candidate-evidence.json`, con IPA y evidencia del bundle dentro del proyecto iOS.

El estado válido previo al smoke es:

`READY_FOR_BETA_SMOKE`.

`npm run release:verify-parity`

Requiere igualdad de:

- producto;
- gate;
- versión;
- entorno;
- canal;
- commit;
- SHA-256 agregado del bundle web.

También conserva y compara build, native build y artefactos de cada plataforma. Los build numbers nativos pueden diferir por plataforma, pero quedan registrados individualmente.

Salida:

`artifacts/release/INVEN3-f10a-platform-parity.json`

## Trazabilidad del smoke

El smoke debe vincular el candidato al binario instalado:

- Android: el hash fuente debe resolver a un APK del candidate evidence, nunca al AAB;
- iOS: el hash fuente debe resolver a la IPA del candidate evidence;
- re-firma iOS de laboratorio: hash fuente e instalado distintos;
- artefacto sin transformación: hashes iguales;
- método de instalación y procedencia de firma registrados;
- referencias de hash, instalación y firma conservadas en la evidencia.

`npm run release:f10a:close` revalida ambas evidencias smoke y conserva en el closure la ruta fuente, ambos hashes, el método de instalación y la procedencia de firma.

## Gate de salida F10A

F10A sólo puede declararse PASS cuando:

1. preflight, typecheck, lint, tests y audit pasan en ejecución real;
2. Android QA/BETA candidate se genera;
3. iOS QA/BETA candidate se genera;
4. ambos manifests, hashes y candidate evidence quedan disponibles;
5. `F10A_NATIVE_WEB_PARITY = PASS` en Android e iOS;
6. `F10A_PLATFORM_PARITY = PASS`;
7. ambos candidatos quedan `READY_FOR_BETA_SMOKE`;
8. Beta Smoke Android = `PASS`;
9. Beta Smoke iOS = `PASS`;
10. `INVEN3-F10A-closure.json` queda en `PASS`;
11. producción sigue bloqueada y `F10B_NOT_AUTHORIZED`.

## Bloqueos de ejecución actuales

GitHub acepta el workflow, pero los jobs finalizan antes del primer step por la configuración de facturación/límite de uso de Actions. No se modificaron pagos ni presupuestos.

Además, `INVEN3_QA_ANON_KEY` no está configurado como secret autorizado. Aun con runners disponibles, el preflight debe fallar mientras falte esa variable.

Estos bloqueos no se convierten en PASS y no alteran el candidato congelado.

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

## Gate estático previo al build QA

El workflow GitHub separa la validación de código del build que requiere credenciales QA:

1. `static-validation` ejecuta `npm ci`, preflight estático, typecheck, lint, unit tests y `npm audit --omit=dev` sin depender de secretos.
2. `prepare-web` sólo se habilita después de ese gate y ejecuta el preflight runtime con `INVEN3_QA_ANON_KEY`, build, auditoría del bundle y manifest.
3. Android, iOS y paridad siguen dependiendo de `prepare-web`, por lo que ningún runner nativo se consume si el código o la configuración QA no han pasado sus gates previos.

Esto permite distinguir un fallo de ingeniería de un bloqueo por configuración/secretos y evita trabajo nativo innecesario.

## Cadena criptográfica de platform parity

`F10A_PLATFORM_PARITY` conserva para Android e iOS la ruta relativa y el SHA-256 exacto de cada archivo de candidate evidence utilizado. El cierre vuelve a calcular ambos hashes y rechaza cualquier paridad que apunte a otro archivo o a otra versión del JSON, incluso si los campos funcionales aparentan coincidir.

Cadena resultante: manifest → native web evidence → candidate evidence → platform parity → smoke evidence → closure.

## Política de consumo de GitHub Actions

Para evitar ejecutar la misma validación dos veces por cada actualización de una PR:

- branches de trabajo `feature/**` y `fix/**` se validan por evento `pull_request`;
- los eventos `push` de CI/iOS quedan reservados para `main` y `release/**`;
- cada workflow usa `concurrency` con `cancel-in-progress: true` para cancelar ejecuciones obsoletas de la misma referencia/PR;
- F10A mantiene su pipeline específico ligado a la PR contra `release/f10a-candidate`.

Esto conserva cobertura del candidato y reduce consumo duplicado de runners, especialmente macOS.

## Ruta canónica única F10A

El workflow legado de candidato Android independiente fue retirado. La única ruta autorizada para generar candidatos F10A es:

`.github/workflows/f10a-github-dual-platform.yml`

Esto evita candidatos parciales fuera de la paridad Android/iOS y garantiza que manifest, native web evidence, candidate evidence y platform parity se generen dentro de la misma cadena de release.

## Identidad visible ligada al candidato

El smoke F10A registra `build` y exige que:

- `build = <candidate-sha8>.<run-number>`;
- `app_display_version = 1.0.0-beta+<build>`;
- el cierre compare ese `build` con candidate evidence antes de aceptar PASS.

Así, una evidencia correspondiente a un binario anterior no puede cerrar accidentalmente el candidato actual aunque versión, plataforma y backend coincidan.

