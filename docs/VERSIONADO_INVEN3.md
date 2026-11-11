# Versionado unificado de INVEN3

## Fuente canónica

`version.json`, versionado en Git, es la única autoridad de identidad de una
release funcional:

```json
{ "version": "0.0.00.01", "versionCode": 1 }
```

`package.json` mantiene su SemVer técnico y no es autoridad de la versión
funcional. El environment y canal son atributos de distribución, no cambian
la identidad de la release.

## Regla correlativa

Formato: `M.m.rr.nn`, donde `rr` y `nn` siempre tienen dos dígitos.

`0.0.00.01` -> `0.0.00.02` -> … -> `0.0.00.99` -> `0.0.01.00`.
Cada bump incrementa también `versionCode` en uno. Nunca se reutiliza un
número. El build nunca hace un bump automático.

```bash
npm run version:show
npm run version:validate
npm run version:bump
```

`version:bump` modifica solamente `version.json` de manera atómica; no
compila, despliega, publica ni instala artefactos.

## Consumidores

- Web: `release-metadata.ts` importa `version.json`; QA muestra
  `INVEN3 · v<versión> · QA` en Login.
- Android: Gradle lee `version.json`; propiedades `INVEN3_VERSION_*` sólo se
  aceptan si coinciden exactamente con la fuente canónica.
- Carga QA: `npm run build:qa` inyecta la versión canónica en Vite y verifica
  que Gradle tenga el contrato de lectura canónica.
- APK: `npm run android:qa:debug` copia un candidato identificable a
  `artifacts/INVEN3-QA-v<versión>.apk` y genera su manifest con SHA-256,
  tamaño, commit y timestamp.
- Manifiesto de release: `scripts/release-manifest.mjs` incorpora
  `appVersion` y `versionCode` desde `version.json`.
- Dispositivos: el registro existente informa `app_version` canónico y lleva
  el version code en el label de dispositivo. No se introduce una autoridad
  distinta en SQLite ni en OTA.

## QA, producción y OTA

La misma versión puede circular en `QA / qa-beta` y posteriormente en
producción. El canal se mantiene separado. OTA compara versiones instaladas
con versiones disponibles, pero no publica ni incrementa versiones por sí
solo. Producción continúa bloqueada por `release-policy.json`.

## Rollback

Un rollback usa un artefacto previamente certificado con su mismo
`version.json`, SHA-256 y manifest. No se disminuye `versionCode` ni se
reescribe la historia de versiones.
