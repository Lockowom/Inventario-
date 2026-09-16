# Scanner v1 — Fase 3

El adaptador `@capacitor-mlkit/barcode-scanning` 8.2.1 está alineado con Capacitor 8 y limita la lectura a QR y Code 128. El resultado sólo rellena `CODIGO`, `SERIE`, `PARTIDA` o `UBICACION`; nunca persiste por sí mismo ni interpreta GS1. El usuario conserva entrada manual como alternativa.

La apertura comunica rechazo o falta de soporte y permite cancelar; la UI no confirma un conteo hasta que el usuario pulsa guardar. Android comprueba e inicia la instalación del módulo Google Barcode Scanner cuando falta. La interfaz nativa del escáner aporta su control de antorcha cuando el hardware lo soporta; el adaptador también expone su disponibilidad. El flujo manual permanece disponible en todos los casos.

## Plataformas

- **Android:** `AndroidManifest.xml` declara `CAMERA`, `FLASHLIGHT` y `com.google.mlkit.vision.DEPENDENCIES=barcode_ui` dentro de `application`.
- **iOS:** `Info.plist` declara `NSCameraUsageDescription`; `ios/App/Podfile` usa CocoaPods, integra el plugin ML Kit y fija iOS 15.5. El plugin ML Kit no soporta Swift Package Manager.
- **Web:** el plugin depende de Barcode Detection API; no es una certificación equivalente a cámara nativa y el flujo manual se mantiene.

`npx cap sync` valida el enlace de plugins. Android/iOS físicos requieren permiso concedido y prueba en hardware; no se afirma una certificación de cámara desde Windows.
