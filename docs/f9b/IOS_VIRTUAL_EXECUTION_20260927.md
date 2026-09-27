# Ejecución iOS virtual multi-dispositivo — 2026-09-27

## Resultado

`IOS_VIRTUAL_DEVICE_MATRIX = PASS`

Ejecución local sobre Playwright WebKit con perfiles iPhone lógicos desde iPhone 11 hasta iPhone 18 Pro Max.

- perfiles ejecutados: **23**
- perfiles PASS: **23**
- perfiles FAIL: **0**
- evidencia generada localmente: `artifacts/ios-matrix/IOS-MATRIX-CERTIFICATION.json`
- runner: `npm run certify:f9b:ios-matrix`
- esquema de evidencia: `inven3.f9b.ios-matrix-certification.v2`
- touch probe: `playwright_locator_tap`

## Cobertura

Cada perfil validó:

- Health Check visible por heading accesible;
- Conteo Físico visible por heading accesible;
- viewport lógico individual;
- user-agent iPhone;
- gesto táctil `tap()` operativo;
- cero overflow horizontal en Health Check;
- cero overflow horizontal en Conteo;
- captura visual por perfil.

## Perfiles

| Familia | Perfiles |
|---|---|
| iPhone 11 | 11, 11 Pro, 11 Pro Max |
| iPhone 12 | 12, 12 Pro, 12 Pro Max |
| iPhone 13 | 13, 13 Pro, 13 Pro Max |
| iPhone 14 | 14, 14 Pro, 14 Pro Max |
| iPhone 15 | 15, 15 Pro, 15 Pro Max |
| iPhone 16 | 16, 16 Pro, 16 Pro Max |
| iPhone 17 | 17, 17 Pro, 17 Pro Max |
| iPhone 18 | 18 Pro, 18 Pro Max |

## Alcance del PASS

Este gate certifica la capa virtual/responsive WebKit y no reemplaza `IOS_PHYSICAL`.

El siguiente gate técnico es `IOS_NATIVE_SIMULATOR_BUILD`: compilación real de Capacitor/CocoaPods/Xcode en macOS cloud, sin firma, para producir una `.app` de iOS Simulator.

`IOS_PHYSICAL` permanece abierto hasta ejecutar el candidato sobre hardware iPhone/iPad real o un proveedor de dispositivo real remoto.
