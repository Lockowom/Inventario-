# iOS Native Simulator Build — Codemagic — 2026-09-28

## Resultado

`IOS_NATIVE_SIMULATOR_BUILD = PASS`

Codemagic ejecutó el workflow nativo iOS de INVEN3 sobre macOS y produjo una aplicación de iOS Simulator sin firma.

- workflow: `INVEN3 iOS Simulator F9`
- branch: `feature/fase-9-certification`
- commit: `364913b3840f8e8417d72b041ca556cab0e24dfc`
- machine: `Mac mini M2`
- build status: `finished`
- build id: `6ab9b05e12dce3b0c7bbb318`
- duración observada: `3m 29s`
- artifact principal: `App.app.zip`
- tamaño observado: `11.88 MB`
- firma: deshabilitada para Simulator
- Xcode: `26.4` según `codemagic.yaml`

## Pipeline ejecutado

1. Preparing build machine — PASS
2. Fetching app sources — PASS
3. Install JavaScript dependencies — PASS
4. Typecheck — PASS
5. Build web bundle — PASS
6. Sync Capacitor iOS — PASS
7. Install CocoaPods dependencies — PASS
8. Verify CocoaPods Debug integration — PASS
9. Build unsigned iOS simulator app — PASS
10. Publishing — PASS
11. Cleaning up — PASS

## Corrección que habilitó el PASS

El target Debug de Xcode dejó de usar un `debug.xcconfig` propio como configuración base. CocoaPods volvió a inyectar `Pods-App.debug.xcconfig`, preservando `CAPACITOR_DEBUG` como build setting normal. Esto restauró la integración de frameworks/flags de Pods para Capacitor y plugins.

## Alcance

Este PASS demuestra que el proyecto iOS nativo de Capacitor/CocoaPods/Xcode compila correctamente en macOS cloud y genera una `.app` instalable en iOS Simulator.

No reemplaza `IOS_PHYSICAL`, que requiere ejecución sobre un iPhone/iPad real o un servicio de dispositivo físico remoto.
