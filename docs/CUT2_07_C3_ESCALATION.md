# CUT2-07 — Escalamiento formal C2 → C3

Una misión C3 sólo nace al completarse una C2 cuya discrepancia persiste. La
restricción única `(case_id, round)` evita duplicados y `source_c2_mission_id`
deja el origen auditable. La captura es ciega: no expone sistema, C1, C2 ni el
valor esperado de serie/lote. El servidor conserva esa identidad para validar
la evidencia.

C3 exige `RECOUNT_C3` scoped; `RECOUNT_C2` no basta. El claim reutiliza la
transacción y `SKIP LOCKED` de recounts, y prohíbe que el ejecutor C2 reclame
la C3 originada en su propia misión.

Al completar C3, su resultado queda en la misión y el caso queda
`PENDIENTE_ANALISIS`. Incluso si la cantidad coincide con C1, C2 o sistema, no
se selecciona una cantidad ganadora: un dictamen posterior debe tomar esa
decisión. No se modifica evidencia previa, no se libera RP y no se ejecuta
ningún ajuste ERP.

La caché de ejecución también respeta la ceguera: una misión C3 guarda
`reference_value = null` y su outbox se almacena por actor. Así un nuevo
usuario del mismo equipo no puede heredar datos ni pendientes del anterior.

El Monitor existente, protegido por `VIEW_MONITOR`, muestra la trazabilidad de
una C3 mediante su misión C2 origen, corte, referencia sellada y resultado de
evidencia. Esa proyección es exclusivamente de supervisión: no cambia el
payload ciego del contador.
