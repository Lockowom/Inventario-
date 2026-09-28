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

## 2. Android candidate

Ruta preferida mientras GitHub Actions siga afectado:

Codemagic → workflow `INVEN3 Android Release Candidate F10A`.

Ruta alternativa:

GitHub → Actions → `F10A Release Candidate` → Run workflow.

Ambas deben usar INVEN3-QA.

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

## 3. iOS candidate

Codemagic → workflow `INVEN3 iOS Release Candidate F10A`.

Debe utilizar el grupo `inven3_qa`.

Artefactos esperados:

- `INVEN3-1.0.0-beta-<build>-unsigned.ipa`;
- SHA-256;
- manifest;
- `INVEN3-ios-candidate-evidence.json`;
- build log;
- `.app`.

El IPA unsigned sólo se usa para re-signing/laboratorio.

## 4. Paridad de candidatos

Reunir los dos archivos:

- `INVEN3-android-candidate-evidence.json`;
- `INVEN3-ios-candidate-evidence.json`.

Ejecutar:

`npm run release:verify-parity`

Resultado esperado:

`[PASS] F10A_PLATFORM_PARITY`

No hacer smoke si los candidatos no representan el mismo commit/bundle.

## 5. Verificación en dispositivo

Antes de cualquier prueba:

- `Entorno = QA`;
- `Canal = BETA`;
- `Supabase = CONFIGURED`;
- versión inicia por `1.0.0-beta` o conserva etiqueta F9 certificada si corresponde.

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
