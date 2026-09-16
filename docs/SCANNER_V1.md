# Scanner v1 — Fase 3

El adaptador `@capacitor-mlkit/barcode-scanning` 8.2.1 está alineado con Capacitor 8 y limita la lectura a QR y Code 128. El resultado sólo rellena `CODIGO`, `SERIE`, `PARTIDA` o `UBICACION`; nunca persiste por sí mismo ni interpreta GS1. Al escanear `CODIGO`, se ejecuta el mismo `resolveCountSku` local que usa la digitación: normaliza, busca el maestro, muestra descripción y aplica el tipo de control, sin guardar. El usuario conserva entrada manual como alternativa.

La apertura comunica rechazo o falta de soporte y permite cancelar; la UI no confirma un conteo hasta que el usuario pulsa guardar. Android comprueba e inicia la instalación del módulo Google Barcode Scanner cuando falta. La UI ready-to-use se ejecuta fuera del WebView: INVEN3 no expone un control JS de antorcha en este flujo y no mantiene código muerto que prometa hacerlo. El comportamiento del flash corresponde a la interfaz nativa/hardware y queda pendiente de prueba física. El flujo manual permanece disponible en todos los casos.

## Plataformas

- **Android Google Scanner:** el método ready-to-use `scan()` usa el módulo de Google Play Services y no requiere que INVEN3 solicite `CAMERA`; por ello el manifiesto conserva sólo la metadata `com.google.mlkit.vision.DEPENDENCIES=barcode_ui`, sin permisos CAMERA/FLASHLIGHT innecesarios. Antes de abrirlo se comprueba/solicita su módulo.
- **iOS ML Kit scanner:** se conserva manejo de permiso de cámara, `Info.plist` declara `NSCameraUsageDescription`, `ios/App/Podfile` usa CocoaPods y el target es iOS 15.5. El plugin ML Kit no soporta Swift Package Manager.
- **Web:** el plugin depende de Barcode Detection API; no es una certificación equivalente a cámara nativa y el flujo manual se mantiene.

Android puede destruir el proceso mientras la interfaz ready-to-use está abierta. Antes de abrirla se guarda sólo el campo de destino localmente; `@capacitor/app` procesa `appRestoredResult`, recupera el valor o error, lo devuelve al formulario y nunca guarda automáticamente. Si se pierde el campo de destino, se preserva el resultado para informar al usuario y se solicita entrada manual. `npx cap sync` valida el enlace de plugins. Android/iOS físicos requieren prueba en hardware; no se afirma una certificación de cámara desde Windows.
