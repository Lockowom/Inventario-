# Versionado unificado de INVEN3

Relacionado con GitHub Issue #25.

## Fuente canónica

`version.json`, versionado en Git, es la única fuente de identidad de una
release. Mantiene separadas la aplicación efectiva y el shell Android:

```json
{
  "appVersion": "0.0.00.03",
  "nativeVersion": "0.0.00.02",
  "versionCode": 2
}
```

`package.json` conserva únicamente su SemVer técnico. El ambiente y el canal
son atributos de distribución, no cambian la identidad funcional.

## Dos identidades, una release funcional

- `appVersion`: versión Web/React y del bundle OTA activo. Es la que muestra
  la UI y debe coincidir entre Web y Android efectivo.
- `nativeVersion` y `versionCode`: identidad inmutable del APK instalado. Sólo
  cambian si hay una modificación nativa (plugin Capacitor, permisos, Gradle,
  SQLite nativo, scanner o código Android incompatible).

Un teléfono con APK `0.0.00.02`/build `2` puede ejecutar la app efectiva
`0.0.00.03` mediante `qa-beta`, sin reinstalarse.

## Correlativo y comandos

El formato es `M.m.rr.nn`; `rr` y `nn` siempre tienen dos dígitos:

`0.0.00.01` → `0.0.00.02` → … → `0.0.00.99` → `0.0.01.00`.

```bash
npm run version:show
npm run version:validate
npm run version:bump          # sólo appVersion: OTA/Web compatible
npm run version:bump:native   # appVersion + nativeVersion + versionCode
```

Los comandos son atómicos y no compilan, despliegan, publican ni instalan.
Un build nunca incrementa la versión por sí mismo.

## OTA QA

Capgo es el runtime nativo ya incluido en Android. El cliente no puede elegir
canal: el Edge Function autenticado asigna sólo `qa-beta`. La app comprueba y
descarga automáticamente una actualización; aplica sólo en un punto seguro:
sin pantalla C1/C2/C3 activa y sin evidencia pendiente de sincronizar.

Cada bundle inmutable lleva un manifiesto con `appVersion`, canal,
`minimumNativeVersion`, `minimumVersionCode`, SHA-256, tamaño, fecha, commit y
`index.html`. El hash se verifica antes de activar el bundle. Capgo conserva el
bundle bueno anterior y usa `notifyAppReady()` para recuperar un arranque roto.
La falta temporal de red o de sesión nunca activa rollback.

Si el teléfono no cumple el mínimo nativo, no descarga el bundle y la UI indica
que requiere APK. QA y producción permanecen separados: un dispositivo QA no
recibe un bundle production.

Para crear localmente un candidato QA verificable, sin publicar nada:

```bash
npm run ota:qa:bundle
```

El workflow de QA publica el ZIP y su manifiesto inmutables sólo desde la rama
`qa`. Producción continúa bloqueada por `release-policy.json`.

## Metadatos y dispositivos

El manifiesto de release conserva `appVersion`, `nativeVersion`, `versionCode`,
ambiente, canal, commit, timestamp, SHA-256 y tamaño. El monitor existente de
dispositivos muestra App efectiva, APK base, build nativo, bundle OTA, canal,
estado y última conexión; no existe un segundo registro de dispositivos.

## Rollback

Un rollback usa el bundle previo validado. No reduce `versionCode`, no reescribe
historia y no se dispara por falta de red, logout ni indisponibilidad temporal
de Supabase.
