# F10A — Runbook de candidato QA/BETA

## 1. Preflight local

Configurar sólo INVEN3-QA:

```text
VITE_SUPABASE_URL=https://uazunvlxlszdyweddxtb.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable/anon QA>
VITE_RELEASE_ENV=qa
VITE_RELEASE_CHANNEL=beta
VITE_RELEASE_VERSION=1.0.0
VITE_APP_BUILD=<sha/build>
```

Ejecutar:

```bash
npm ci
npm run release:preflight
npm run typecheck
npm run test
npm run release:qa
```

## 2. Candidato dual sin Codemagic

GitHub → Actions → `F10A GitHub Dual Platform Candidate` → Run workflow.

Este workflow:

- construye y audita una sola vez el bundle web QA/BETA;
- reutiliza exactamente ese bundle en Android e iOS;
- genera APK, AAB e IPA unsigned;
- valida las evidencias de candidato;
- ejecuta la paridad Android/iOS;
- mantiene producción bloqueada.

Requiere el secret `INVEN3_QA_ANON_KEY` y un runner macOS de GitHub disponible. El workflow Codemagic queda como contingencia.

Artefactos esperados:

- `app-release-unsigned.apk`;
- `app-release.aab`;
- `INVEN3-1.0.0-beta-<build>-lab.apk` instalable sólo para laboratorio;
- `INVEN3-release-manifest.json`;
- `INVEN3-android-candidate-evidence.json`;
- `android-package-badging.txt`;
- `android-sha256.txt`.

La key usada para el APK de laboratorio es efímera y se elimina dentro del runner. No es firma productiva.

No instalar en operación real sin gate posterior.

## 3. Artefactos iOS

La etapa iOS del workflow dual usa el runner `macos-15` y compila contra el mismo bundle generado por `prepare-web`.

Artefactos esperados:

- `INVEN3-1.0.0-beta-<build>-unsigned.ipa`;
- SHA-256;
- manifest;
- `INVEN3-ios-candidate-evidence.json`;
- build log;
- `.app`.

El IPA unsigned sólo se usa para re-signing/laboratorio. No se considera instalable ni constituye por sí solo evidencia de smoke.

Para probar en dispositivo:

1. conservar el SHA-256 de la IPA unsigned registrado en el candidate evidence como `source_candidate_artifact_sha256`;
2. re-firmar la IPA en un laboratorio controlado, sin modificar el bundle web;
3. calcular el SHA-256 de la IPA re-firmada como `installed_artifact_sha256`;
4. registrar `signing_provenance = laboratory_resign`;
5. registrar `install_method` y referencias a la re-firma/instalación;
6. verificar que ambos hashes sean distintos y que el hash fuente pertenezca al candidate evidence.

Sin esta cadena de trazabilidad, el smoke iOS y el cierre F10A deben rechazarse.

## 4. Paridad de candidatos

La etapa `parity` descarga las evidencias Android/iOS y ejecuta automáticamente:

`npm run release:verify-parity`

Resultado esperado:

`[PASS] F10A_PLATFORM_PARITY`

No hacer smoke si los candidatos no representan el mismo commit/bundle.

## 5. Verificación en dispositivo

Antes de cualquier prueba:

- `Entorno = QA`;
- `Canal = BETA`;
- `Supabase = CONFIGURED`;
- versión inicia por `1.0.0-beta` o conserva etiqueta F9 certificada si corresponde;
- el hash del artefacto fuente pertenece al candidate evidence;
- el binario instalado conserva una procedencia de firma verificable.

Si aparece `PRODUCTION`, detener la prueba.

## 6. Regla de rollback

F10A no sustituye builds de operación. Si un candidato falla:

- conservar evidencia;
- no promover;
- corregir en feature branch;
- emitir un nuevo build;
- nunca reutilizar un build number publicado.

## 7. Gate productivo

Para entrar a promoción real deberán definirse por separado:

- proyecto/ref Supabase PROD;
- estrategia de migraciones PROD;
- credenciales de signing Android;
- Apple signing/App Store Connect;
- canal de distribución;
- ventana de rollout;
- rollback;
- monitoreo;
- aprobación humana.

Mientras `productionLocked=true`, la automatización debe rechazar esos intentos.
