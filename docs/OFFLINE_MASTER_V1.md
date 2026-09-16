# Distribución offline del maestro — Fase 2

El puerto `MasterSkuRepository` es el contrato de dominio. Sus adaptadores SQLite móvil y Dexie/IndexedDB web implementan las mismas operaciones semánticas: buscar código, listar por inventario, leer metadata y reemplazar un snapshot.

La descarga obtiene metadata inicial, descarga y valida filas Zod, comprueba cantidad y SHA-256 determinista, vuelve a leer metadata y solo entonces ejecuta el reemplazo dentro de una transacción local. Si el contenido no corresponde al fingerprint o cambian versión, cantidad o fingerprint durante la descarga, falla explícitamente y conserva la versión previa; nunca se borra antes de disponer de un snapshot válido. SQLite y Dexie repiten la comprobación de fingerprint inmediatamente antes de persistir.

Cada snapshot guarda `master_version`, `row_count`, `fingerprint` SHA-256 determinista y `cached_at`. La comparación de versión y fingerprint permite saber si el dispositivo está actualizado sin comparar miles de filas. Una excepción incrementa esa versión: equipos offline mantienen su copia hasta que puedan refrescar explícitamente. No se implementa Realtime en esta fase.

La búsqueda local usa la clave única `(inventory_id, codigo)` tanto en SQLite como en Dexie. El objetivo operativo es responder sin red en menos de 300 ms; la certificación física en Android/iOS queda pendiente de hardware real.

SQLite usa un runner explícito de migraciones ordenadas. Lee `PRAGMA user_version`, aplica solo versiones faltantes dentro de transacciones y actualiza la versión únicamente al terminar cada migración. Una base con una versión futura falla de forma controlada; nunca se reduce ni se fuerza la versión.
