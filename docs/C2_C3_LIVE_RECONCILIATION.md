# C2/C3 · conciliación continua

Desde INVEN3 `0.0.00.02`, C1, C2 y C3 son capas concurrentes de control
dentro de un inventario `ABIERTO`. Un corte, `source_cut_id`, sello o
`c1_completed_at` conservan su valor histórico, de auditoría y de cierre, pero
no habilitan ni bloquean la creación, lectura o reclamo de C2/C3.

## Flujo

1. `sync_counts` acepta una evidencia C1 idempotente.
2. El trigger server-side reconcilia únicamente la identidad afectada contra
   `inventory_system_reference_items`.
3. Si hay diferencia, crea o actualiza una única `reconciliation_case` y una
   misión C2 en cola. La identidad es `inventory_id + SKU`, más lote para
   `PARTIDA` o serie para `SERIAL`.
4. Si C1 vuelve a cuadrar antes de que C2 se inicie, la misión se cancela de
   forma auditable y el caso se resuelve con `RESOLVED_BY_C1`; no se borra
   evidencia.
5. C2 registra una observación independiente. Si C1 y C2 difieren, se crea C3
   de forma automática y ciega. Si coinciden entre sí pero difieren del
   sistema, queda `FISICO_CONFIRMADO`, sin C3 automático.

Una serie física inexistente, duplicada, fuera de disponible o de identidad
inválida es concluyente y genera C2 inmediatamente. La ausencia de una serie
esperada no se convierte en faltante hasta que exista cobertura suficiente.

## Seguridad y visibilidad

- La creación/reconciliación ocurre en PostgreSQL, no en Android ni en Web.
- El reclamo conserva capacidades, scopes, separación entre originador C1 y
  C2, y separación entre ejecutor C2 y C3.
- Las cargas C2/C3 no incluyen cantidades C1, sistema ni delta.
- `recount_missions` y `reconciliation_cases` notifican por Realtime al
  módulo de misiones; el refetch es el fallback.
- No existe ajuste de ERP, Softland, stock ni disponibilidad en este flujo.

## Concurrencia

La reconciliación toma un advisory lock por identidad y el caso/misión tiene
claves únicas existentes. Dos C1 simultáneos no pueden crear dos C2 lógicas.
El harness local `npm run test:live-reconciliation:concurrency` usa dos
conexiones PostgreSQL reales y certifica una sola tarea y un solo evento de
creación.

## Validación

`supabase/tests/live_reconciliation_c2_c3_test.sql` cubre lote, legacy,
serial inesperada, actualización/autoresolución C2, C3 automático, consenso
físico y ceguera. Los cortes siguen siendo necesarios solamente para sus
procesos propios de snapshot, exportación, RP y cierre.
