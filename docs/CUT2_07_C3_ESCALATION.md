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
`PENDIENTE_ANALISIS`. No se modifica evidencia previa, no se libera RP y no se
ejecuta ningún ajuste ERP.
