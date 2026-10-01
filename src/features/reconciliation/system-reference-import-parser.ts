import { deriveMasterControlType, normalizeMasterCode } from '../../domain/master/contracts'
import { systemReferencePreviewSchema, type SystemReferenceIssue, type SystemReferenceItem, type SystemReferencePreview } from '../../domain/reconciliation/system-reference-contracts'

type Matrix=unknown[][]
const REQUIRED_SHEETS=['STOCK TOTAL','STOCK CON P','STOCK CON S'] as const
const REQUIRED_HEADERS={
 'STOCK TOTAL':['Cod. Producto','Producto','Cod. U. Medida','Disponible','Reserva','Transitoria','Consignación','Stock Total'],
 'STOCK CON P':['Cod. Producto','Producto','Cod. U. Medida','Partida / Talla','Fecha Venc','Disponible','Reserva','Transitoria','Consignación','Stock Total'],
 'STOCK CON S':['Cod. Producto','Producto','Cod. U. Medida','Serie','Disponible','Reserva','Transitoria','Consignación','Stock Total'],
} as const
const STOCK_COLUMNS=['Disponible','Reserva','Transitoria','Consignación','Stock Total'] as const

function text(value:unknown){return value==null?'':String(value)}
function headerKey(value:unknown){return text(value).trim().toUpperCase()}
function code(value:unknown){return normalizeMasterCode(value)}
function ref(value:unknown){const normalized=text(value).trim();return normalized||null}

function parseInteger(value:unknown):number|null{
 if(typeof value==='number') return Number.isInteger(value)?value:null
 const raw=text(value).trim().replace(/\s+/g,'')
 if(!raw) return 0
 if(/^-?\d+$/.test(raw)) return Number(raw)
 return null
}

function mapHeaders(row:unknown[]){
 const map=new Map<string,number>()
 row.forEach((value,index)=>map.set(headerKey(value),index))
 return map
}

function column(map:Map<string,number>,name:string){return map.get(name.toUpperCase())}

function sha256(bytes:ArrayBuffer){
 return crypto.subtle.digest('SHA-256',bytes).then(buffer=>[...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,'0')).join(''))
}

function stockValues(rawRow:unknown[],headers:Map<string,number>){
 const values=STOCK_COLUMNS.map(name=>{
  const index=column(headers,name)
  return index===undefined?null:parseInteger(rawRow[index])
 })
 return values
}

function addIssue(issues:SystemReferenceIssue[],sheet:string,rowNumber:number,codigo:string,referenceValue:string|null,severity:'ERROR'|'WARNING',message:string){
 issues.push({sheet,rowNumber,codigo,referenceValue,severity,message})
}

function sameSet(left:Set<string>,right:Set<string>){
 return left.size===right.size&&[...left].every(value=>right.has(value))
}

export async function parseSystemReferenceXlsx(contents:ArrayBuffer,fileName='RP.xlsx'):Promise<SystemReferencePreview>{
 const XLSX=await import('@e965/xlsx')
 const workbook=XLSX.read(contents,{type:'array',cellText:true,cellNF:true})
 const sheetMap=new Map(workbook.SheetNames.map(name=>[name.trim().toUpperCase(),name]))
 const issues:SystemReferenceIssue[]=[]
 const matrices=new Map<string,{display:Matrix;raw:Matrix;headers:Map<string,number>}>()

 for(const logicalName of REQUIRED_SHEETS){
  const actualName=sheetMap.get(logicalName)
  const sheet=actualName?workbook.Sheets[actualName]:undefined
  if(!sheet){
   addIssue(issues,logicalName,0,'',null,'ERROR',`HOJA REQUERIDA AUSENTE: ${logicalName}`)
   continue
  }
  const display=XLSX.utils.sheet_to_json<Matrix[number]>(sheet,{header:1,raw:false,defval:''}) as Matrix
  const raw=XLSX.utils.sheet_to_json<Matrix[number]>(sheet,{header:1,raw:true,defval:''}) as Matrix
  const headers=mapHeaders(display[0]??[])
  for(const required of REQUIRED_HEADERS[logicalName]){
   if(column(headers,required)===undefined) addIssue(issues,logicalName,1,'',null,'ERROR',`COLUMNA REQUERIDA AUSENTE: ${required}`)
  }
  matrices.set(logicalName,{display,raw,headers})
 }

 const universes=new Map<string,Set<string>>()
 const aggregates=new Map<string,Map<string,number>>()
 let totalSourceRows=0

 for(const logicalName of REQUIRED_SHEETS){
  const matrix=matrices.get(logicalName)
  if(!matrix) continue
  const codes=new Set<string>()
  const agg=new Map<string,number>()
  const codeIndex=column(matrix.headers,'Cod. Producto')
  if(codeIndex===undefined) continue
  const rows=Math.max(matrix.display.length,matrix.raw.length)
  totalSourceRows+=Math.max(0,rows-1)
  for(let index=1;index<rows;index+=1){
   const displayRow=matrix.display[index]??[]
   const rawRow=matrix.raw[index]??[]
   const codigo=code(displayRow[codeIndex])
   if(!codigo) continue
   codes.add(codigo)
   const values=stockValues(rawRow,matrix.headers)
   if(values.some(value=>value===null)){
    addIssue(issues,logicalName,index+1,codigo,null,'ERROR','STOCK NO ENTERO O NO NUMÉRICO')
    continue
   }
   const [disponible,reserva,transitoria,consignacion,total]=values as [number,number,number,number,number]
   if(disponible+reserva+transitoria+consignacion!==total) addIssue(issues,logicalName,index+1,codigo,null,'ERROR','STOCK TOTAL NO CUADRA CON SUS ESTADOS')
   if([disponible,reserva,transitoria,consignacion].some(value=>value<0)) addIssue(issues,logicalName,index+1,codigo,null,'WARNING','EXISTE UN ESTADO DE STOCK NEGATIVO')
   if(total<0) addIssue(issues,logicalName,index+1,codigo,null,'ERROR','STOCK TOTAL NEGATIVO')
   agg.set(codigo,(agg.get(codigo)??0)+total)
  }
  universes.set(logicalName,codes)
  aggregates.set(logicalName,agg)
 }

 const baseUniverse=universes.get('STOCK TOTAL')
 const baseAggregate=aggregates.get('STOCK TOTAL')
 for(const logicalName of ['STOCK CON P','STOCK CON S'] as const){
  const universe=universes.get(logicalName)
  if(baseUniverse&&universe&&!sameSet(baseUniverse,universe)) addIssue(issues,logicalName,0,'',null,'ERROR','EL UNIVERSO SKU NO COINCIDE CON STOCK TOTAL')
  const aggregate=aggregates.get(logicalName)
  if(baseAggregate&&aggregate){
   const mismatches=[...baseAggregate.entries()].filter(([codigo,qty])=>aggregate.get(codigo)!==qty)
   if(mismatches.length) addIssue(issues,logicalName,0,'',null,'ERROR',`STOCK CONSOLIDADO NO CUADRA CON STOCK TOTAL EN ${mismatches.length} SKU`)
  }
 }

 const items:SystemReferenceItem[]=[]
 const naturalKeys=new Set<string>()
 const globalSeries=new Set<string>()

 const pushItem=(item:SystemReferenceItem,sheet:string,rowNumber:number)=>{
  const key=`${item.codigo}\u001f${item.referenceType}\u001f${item.referenceValue??''}`
  if(naturalKeys.has(key)){addIssue(issues,sheet,rowNumber,item.codigo,item.referenceValue,'ERROR','REFERENCIA DUPLICADA');return}
  naturalKeys.add(key);items.push(item)
 }

 const total=matrices.get('STOCK TOTAL')
 if(total){
  const codeIndex=column(total.headers,'Cod. Producto'),stockIndex=column(total.headers,'Stock Total')
  if(codeIndex!==undefined&&stockIndex!==undefined){
   for(let index=1;index<total.display.length;index+=1){
    const codigo=code(total.display[index]?.[codeIndex])
    if(!codigo||deriveMasterControlType(codigo)!=='LEGACY') continue
    const quantity=parseInteger(total.raw[index]?.[stockIndex])
    if(quantity===null||quantity<0) continue
    if(quantity>0) pushItem({codigo,referenceType:'LEGACY',referenceValue:null,quantity},'STOCK TOTAL',index+1)
   }
  }
 }

 const batches=matrices.get('STOCK CON P')
 if(batches){
  const codeIndex=column(batches.headers,'Cod. Producto'),refIndex=column(batches.headers,'Partida / Talla'),stockIndex=column(batches.headers,'Stock Total')
  if(codeIndex!==undefined&&refIndex!==undefined&&stockIndex!==undefined){
   for(let index=1;index<batches.display.length;index+=1){
    const codigo=code(batches.display[index]?.[codeIndex])
    if(!codigo||deriveMasterControlType(codigo)!=='PARTIDA') continue
    const quantity=parseInteger(batches.raw[index]?.[stockIndex])
    const referenceValue=ref(batches.display[index]?.[refIndex])
    if(quantity===null||quantity<0) continue
    if(quantity>0&&!referenceValue){addIssue(issues,'STOCK CON P',index+1,codigo,null,'ERROR','STOCK POSITIVO SIN PARTIDA / TALLA');continue}
    if(quantity>0&&referenceValue) pushItem({codigo,referenceType:'PARTIDA',referenceValue,quantity},'STOCK CON P',index+1)
   }
  }
 }

 const serials=matrices.get('STOCK CON S')
 if(serials){
  const codeIndex=column(serials.headers,'Cod. Producto'),refIndex=column(serials.headers,'Serie'),stockIndex=column(serials.headers,'Stock Total')
  if(codeIndex!==undefined&&refIndex!==undefined&&stockIndex!==undefined){
   for(let index=1;index<serials.display.length;index+=1){
    const codigo=code(serials.display[index]?.[codeIndex])
    const referenceValue=ref(serials.display[index]?.[refIndex])
    const quantity=parseInteger(serials.raw[index]?.[stockIndex])
    if(!codigo) continue
    if(referenceValue&&deriveMasterControlType(codigo)!=='SERIAL'){addIssue(issues,'STOCK CON S',index+1,codigo,referenceValue,'ERROR','SERIE ASOCIADA A SKU NO SERIAL');continue}
    if(deriveMasterControlType(codigo)!=='SERIAL'||quantity===null||quantity<0) continue
    if(quantity>0&&!referenceValue){addIssue(issues,'STOCK CON S',index+1,codigo,null,'ERROR','STOCK SERIAL POSITIVO SIN SERIE');continue}
    if(referenceValue&&quantity!==1){addIssue(issues,'STOCK CON S',index+1,codigo,referenceValue,'ERROR','CADA SERIE DEBE TENER CANTIDAD 1');continue}
    if(referenceValue){
     if(globalSeries.has(referenceValue)){addIssue(issues,'STOCK CON S',index+1,codigo,referenceValue,'ERROR','SERIE DUPLICADA EN FUENTE DE SISTEMA');continue}
     globalSeries.add(referenceValue)
     pushItem({codigo,referenceType:'SERIAL',referenceValue,quantity:1},'STOCK CON S',index+1)
    }
   }
  }
 }

 const fileSha256=await sha256(contents)
 return systemReferencePreviewSchema.parse({
  fileName,fileSha256,totalSourceRows,itemCount:items.length,
  serialItems:items.filter(item=>item.referenceType==='SERIAL').length,
  batchItems:items.filter(item=>item.referenceType==='PARTIDA').length,
  legacyItems:items.filter(item=>item.referenceType==='LEGACY').length,
  issues,items,
 })
}

export async function parseSystemReferenceFile(file:File){
 const extension=file.name.split('.').pop()?.toLowerCase()
 if(extension!=='xlsx') throw new Error('La referencia de sistema requiere el libro RP completo en formato XLSX.')
 return parseSystemReferenceXlsx(await file.arrayBuffer(),file.name)
}
