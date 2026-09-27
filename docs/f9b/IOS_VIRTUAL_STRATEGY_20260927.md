# Estrategia iOS sin dispositivo físico — F9

Fecha: 2026-09-27.

INVEN3 mantiene el mismo proyecto React + Vite + Capacitor 8 para Android e iOS. No se crea una versión iOS reducida.

## Nivel 1 — iPhone virtual de diseño en Windows

Implementado con Playwright WebKit y el perfil `iPhone 15`.

Comandos:

```powershell
git pull --ff-only origin feature/fase-9-certification
npm run setup:ios:virtual
npm run preview:ios
```

Fixtures disponibles para inspección visual:

```powershell
npm run preview:ios -- health-ready
npm run preview:ios -- counting-health-offline
npm run preview:ios -- cuts-ready
npm run preview:ios -- layout
```

Este nivel valida viewport iPhone, touch, user-agent iOS/WebKit, overflow y apariencia general. No es un simulador nativo de Xcode.

## Nivel 2 — certificación iOS WebKit automática

Runner:

`npm run test:ios:virtual`

Proyecto Playwright:

`ios-webkit`

Artefactos:

`artifacts/ios-virtual/*.png`

GitHub workflow:

`.github/workflows/ios-virtual-certification.yml`

Estado de infraestructura actual: GitHub no asignó runner al workflow (`runner_id=0`), por lo que el bloqueo es de Actions/infraestructura y no de INVEN3.

## Nivel 3 — build nativo iOS sin firma

GitHub workflow:

`.github/workflows/ios-certification.yml`

Fallback cloud:

`codemagic.yaml`

El workflow Codemagic construye una `.app` unsigned para iOS Simulator en un Mac cloud, ejecutando npm, Capacitor, CocoaPods y Xcode. No requiere cuenta Apple para este build de simulador.

## Nivel 4 — hardware iOS real/remoto

El cierre `IOS_PHYSICAL` requiere finalmente un iPhone/iPad físico o un servicio de real-device cloud. La prueba física valida dependencias de hardware que la emulación/simulador no puede certificar.

Opciones estudiadas:

- BrowserStack App Automate: dispositivos iOS físicos en cloud.
- Codemagic: build macOS/iOS cloud; puede evolucionar después a firma/TestFlight.
- GitHub-hosted macOS: válido cuando la organización disponga de runners/minutos.

## Regla de gate

- `IOS_VIRTUAL_WEBKIT`: puede cerrarse sin iPhone.
- `IOS_NATIVE_SIMULATOR_BUILD`: puede cerrarse sin iPhone mediante Mac cloud.
- `IOS_PHYSICAL`: permanece manual hasta ejecutar sobre hardware real/remoto.
