import { useEffect, useMemo, useState } from 'react'
import type { MasterMetadata } from '../../domain/master/contracts'
import { refreshMasterSnapshot } from '../../domain/master/offline-master'
import { SupabaseMasterSkuRepository } from '../../services/supabase-master-sku-repository'
import { SupabaseSupervisionRepository } from '../../services/supabase-supervision-repository'
import { getMasterSkuRepository } from '../counting/counting-runtime'

type Inventory={id:string;name:string;status:string}

const masters=new SupabaseMasterSkuRepository()
const supervision=new SupabaseSupervisionRepository()

export function MasterSkuScreen() {
  const [inventories,setInventories]=useState<Inventory[]>([])
  const [inventoryId,setInventoryId]=useState('')
  const [metadata,setMetadata]=useState<MasterMetadata|null>(null)
  const [exceptionCode,setExceptionCode]=useState('')
  const [exceptionDescription,setExceptionDescription]=useState('')
  const [exceptionReason,setExceptionReason]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('Consulta el Maestro activo y gestiona excepciones durante el conteo.')
  const selectedInventory=useMemo(()=>inventories.find(item=>item.id===inventoryId)??null,[inventories,inventoryId])

  useEffect(()=>{
    let active=true
    void supervision.inventories().then(rows=>{
      if(!active)return
      const next=rows as Inventory[]
      setInventories(next)
      setInventoryId(current=>current||next[0]?.id||'')
    }).catch((error:unknown)=>{if(active)setMessage(describeError(error,'No fue posible cargar inventarios.'))})
    return()=>{active=false}
  },[])

  useEffect(()=>{
    if(!inventoryId)return
    let active=true
    setBusy(true)
    void masters.getMetadata(inventoryId).then(next=>{
      if(!active)return
      setMetadata(next)
      setMessage(next?'Maestro activo v'+next.masterVersion+' · '+next.rowCount+' SKU.':'Este inventario todavía no tiene Maestro confirmado. Usa Carga de datos.')
    }).catch((error:unknown)=>{if(active)setMessage(describeError(error,'No fue posible consultar el Maestro.'))})
      .finally(()=>{if(active)setBusy(false)})
    return()=>{active=false}
  },[inventoryId])

  async function handleAddException(){
    const codigo=exceptionCode.trim(),descripcion=exceptionDescription.trim(),reason=exceptionReason.trim()
    if(!inventoryId||!codigo||!descripcion||!reason){setMessage('Código, descripción y motivo son obligatorios.');return}
    try{
      setBusy(true)
      const next=await masters.addException(inventoryId,codigo,descripcion,reason)
      await refreshMasterSnapshot(inventoryId,masters,getMasterSkuRepository())
      setMetadata(next)
      setExceptionCode('');setExceptionDescription('');setExceptionReason('')
      setMessage('Excepción registrada y cache offline actualizada: Maestro v'+next.masterVersion+', '+next.rowCount+' SKU.')
    }catch(error:unknown){
      setMessage(describeError(error,'La excepción de Maestro fue rechazada.'))
    }finally{setBusy(false)}
  }

  return <section className="master-screen" aria-labelledby="master-title">
    <header>
      <p className="eyebrow">Catálogo operativo</p>
      <h1 id="master-title">Maestro SKU</h1>
      <p className="master-screen__description">Este módulo ya no recibe archivos. La carga y reemplazo del Maestro se realizan exclusivamente en <strong>Carga de datos</strong>.</p>
    </header>

    <label className="field"><span>Inventario</span><select value={inventoryId} disabled={busy} onChange={event=>setInventoryId(event.target.value)}>{inventories.map(item=><option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label>

    {metadata&&<section className="master-status" aria-label="Estado del Maestro">
      <h2>Estado actual</h2>
      <dl>
        <div><dt>Versión</dt><dd>{metadata.masterVersion}</dd></div>
        <div><dt>SKU</dt><dd>{metadata.rowCount}</dd></div>
        <div><dt>Fingerprint</dt><dd>{metadata.fingerprint}</dd></div>
        <div><dt>Cache remoto</dt><dd>{new Date(metadata.cachedAt).toLocaleString()}</dd></div>
      </dl>
    </section>}

    <section className="master-status" aria-labelledby="master-exception-title">
      <h2 id="master-exception-title">Excepción de Maestro</h2>
      <p>Se usa sólo durante inventario ABIERTO para habilitar un SKU omitido del snapshot original. PostgreSQL exige trazabilidad y autorización.</p>
      {selectedInventory?.status!=='ABIERTO'&&<p className="form-warning">Las excepciones de Maestro sólo se habilitan cuando el inventario está ABIERTO.</p>}
      <label className="field"><span>Código SKU</span><input value={exceptionCode} disabled={busy||selectedInventory?.status!=='ABIERTO'} onChange={event=>setExceptionCode(event.target.value)} placeholder="Código faltante" autoCapitalize="characters"/></label>
      <label className="field"><span>Descripción</span><input value={exceptionDescription} disabled={busy||selectedInventory?.status!=='ABIERTO'} onChange={event=>setExceptionDescription(event.target.value)} placeholder="Descripción del producto"/></label>
      <label className="field"><span>Motivo obligatorio</span><textarea value={exceptionReason} disabled={busy||selectedInventory?.status!=='ABIERTO'} onChange={event=>setExceptionReason(event.target.value)} placeholder="Justifica por qué el SKU no estaba incluido en el Maestro confirmado."/></label>
      <button className="button-primary" type="button" disabled={busy||selectedInventory?.status!=='ABIERTO'||!exceptionCode.trim()||!exceptionDescription.trim()||!exceptionReason.trim()} onClick={()=>void handleAddException()}>{busy?'REGISTRANDO…':'AGREGAR EXCEPCIÓN TRAZABLE'}</button>
    </section>

    <p className="master-message" role="status">{message}</p>
  </section>
}

function describeError(error:unknown,fallback:string){
 if(error instanceof Error&&error.message)return error.message
 return fallback
}
