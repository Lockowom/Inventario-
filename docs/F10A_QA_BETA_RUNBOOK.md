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

GitHub → Actions → `F10A Release Candidate` → Run workflow.

Prerequisito:

- secret `INVEN3_QA_ANON_KEY`.

Artefactos esperados:

- `app-release-unsigned.apk`;
- `app-release.aab`;
- `INVEN3-release-manifest.json`;
- `android-sha256.txt`.

No instalar en operación real sin gate posterior.

## 3. iOS candidate

Codemagic → workflow `INVEN3 iOS Release Candidate F10A`.

Debe utilizar el grupo `inven3_qa`.

Artefactos esperados:

- `INVEN3-1.0.0-beta-<build>-unsigned.ipa`;
- SHA-256;
- manifest;
- build log;
- `.app`.

El IPA unsigned sólo se usa para re-signing/laboratorio.

## 4. Verificación en dispositivo

Antes de cualquier prueba:

- `Entorno = QA`;
- `Canal = BETA`;
- `Supabase = CONFIGURED`;
- versión inicia por `1.0.0-beta` o conserva etiqueta F9 certificada si corresponde.

Si aparece `PRODUCTION`, detener la prueba.

## 5. Regla de rollback

F10A no sustituye builds de operación. Si un candidato falla:

- conservar evidencia;
- no promover;
- corregir en feature branch;
- emitir un nuevo build;
- nunca reutilizar un build number publicado.

## 6. Gate productivo

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
