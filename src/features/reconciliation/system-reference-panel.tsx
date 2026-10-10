import type { ReconciliationSummary } from '../../services/supabase-reconciliation-repository'

export function SystemReferencePanel({
 inventoryStatus,
 summary,
}:{
 inventoryStatus:string
 summary:ReconciliationSummary|null
}){
 const source=summary?.source_reference??null
 return <section className="master-status" aria-labelledby="system-reference-title">
  <h2 id="system-reference-title">Referencia RP activa</h2>
  <p>Este panel es sólo de estado. La carga o reemplazo de archivos se realiza exclusivamente en <strong>Carga de datos</strong>.</p>

  {source?<dl>
   <div><dt>Versión</dt><dd>{source.reference_version}</dd></div>
   <div><dt>Referencias</dt><dd>{source.row_count}</dd></div>
   <div><dt>Fingerprint</dt><dd>{source.fingerprint}</dd></div>
   <div><dt>Origen</dt><dd>{source.source}</dd></div>
  </dl>:<p className="form-warning">No existe una referencia RP confirmada para este inventario.</p>}

  {(inventoryStatus==='BORRADOR'||inventoryStatus==='PREPARADO')&&<p className="reconciliation-note">Completa Maestro + RP desde el módulo Carga de datos antes de abrir el inventario.</p>}
  {inventoryStatus==='ABIERTO'&&<p className="reconciliation-note">Los casos C2/C3 definitivos se generan al finalizar C1 desde Supervisión. Mientras C1 esté abierto, esta referencia se usa sólo para comparación en vivo.</p>}
  {inventoryStatus==='CERRADO'&&<p className="reconciliation-note">Inventario cerrado: esta referencia queda vinculada al snapshot final conciliado.</p>}
 </section>
}
