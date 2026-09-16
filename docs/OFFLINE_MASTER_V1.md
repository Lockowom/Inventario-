# Distribución offline del maestro — Fase 2

El puerto `MasterSkuRepository` es el contrato de dominio. Sus adaptadores SQLite móvil y Dexie/IndexedDB web implementan las mismas operaciones semánticas: buscar código, listar por inventario, leer metadata y reemplazar un snapshot.

La descarga valida los contratos Zod recibidos desde servidor y ejecuta el reemplazo dentro de una transacción local. La versión previa se conserva si la descarga o validación falla; nunca se borra antes de disponer de un snapshot válido.

Cada snapshot guarda `master_version`, `row_count`, `fingerprint` SHA-256 determinista y `cached_at`. La comparación de versión y fingerprint permite saber si el dispositivo está actualizado sin comparar miles de filas. Una excepción incrementa esa versión: equipos offline mantienen su copia hasta que puedan refrescar explícitamente. No se implementa Realtime en esta fase.

La búsqueda local usa la clave única `(inventory_id, codigo)` tanto en SQLite como en Dexie. El objetivo operativo es responder sin red en menos de 300 ms; la certificación física en Android/iOS queda pendiente de hardware real.
