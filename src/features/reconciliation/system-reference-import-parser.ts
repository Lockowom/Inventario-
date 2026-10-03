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

function expirationDate(value:unknown):string|null{
 const raw=text(value).trim()
 if(!raw) return null
 if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
 const match=raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
 if(!match) return null
 const [,day,month,year]=match
 const date=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)))
 if(date.getUTCFullYear()!==Number(year)||date.getUTCMonth()!==Number(month)-1||date.getUTCDate()!==Number(day)) return null
 return `${year}-${month!.padStart(2,'0')}-${day!.padStart(2,'0')}`
}

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

function sha256Text(value:string){return sha256(new TextEncoder().encode(value).buffer)}

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
   if(disponible+reserva+transitoria+consignacion!==total) addIssue(issues,logicalName,index+1,codigo,null,'WARNING','STOCK TOTAL NO CUADRA CON SUS ESTADOS')
   if([disponible,reserva,transitoria,consignacion].some(value=>value<0)) addIssue(issues,logicalName,index+1,codigo,null,'WARNING','EXISTE UN ESTADO DE STOCK NEGATIVO')
   if(total<0) addIssue(issues,logicalName,index+1,codigo,null,'WARNING','STOCK TOTAL NEGATIVO: se conserva como evidencia; no genera conteo físico negativo')
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
  const codeIndex=column(total.headers,'Cod. Producto'),stockIndex=column(total.headers,'Stock Total'),availableIndex=column(total.headers,'Disponible'),unitIndex=column(total.headers,'Cod. U. Medida')
  if(codeIndex!==undefined&&stockIndex!==undefined&&availableIndex!==undefined&&unitIndex!==undefined){
   for(let index=1;index<total.display.length;index+=1){
    const codigo=code(total.display[index]?.[codeIndex])
    if(!codigo||deriveMasterControlType(codigo)!=='LEGACY') continue
    const quantity=parseInteger(total.raw[index]?.[stockIndex])
    const availableQuantity=parseInteger(total.raw[index]?.[availableIndex]),unitCode=ref(total.display[index]?.[unitIndex])
    if(quantity===null||availableQuantity===null||!unitCode) continue
    if(quantity!==0||availableQuantity!==0) pushItem({codigo,referenceType:'LEGACY',referenceValue:null,quantity,availableQuantity,unitCode,expirationDate:null},'STOCK TOTAL',index+1)
   }
  }
 }

 const batches=matrices.get('STOCK CON P')
 if(batches){
  const codeIndex=column(batches.headers,'Cod. Producto'),refIndex=column(batches.headers,'Partida / Talla'),stockIndex=column(batches.headers,'Stock Total'),availableIndex=column(batches.headers,'Disponible'),unitIndex=column(batches.headers,'Cod. U. Medida'),expirationIndex=column(batches.headers,'Fecha Venc')
  if(codeIndex!==undefined&&refIndex!==undefined&&stockIndex!==undefined&&availableIndex!==undefined&&unitIndex!==undefined&&expirationIndex!==undefined){
   for(let index=1;index<batches.display.length;index+=1){
    const codigo=code(batches.display[index]?.[codeIndex])
    if(!codigo||deriveMasterControlType(codigo)!=='PARTIDA') continue
    const quantity=parseInteger(batches.raw[index]?.[stockIndex])
    const availableQuantity=parseInteger(batches.raw[index]?.[availableIndex])
    const referenceValue=ref(batches.display[index]?.[refIndex])
    const unitCode=ref(batches.display[index]?.[unitIndex])
    const rawExpiration=ref(batches.display[index]?.[expirationIndex]); const parsedExpiration=expirationDate(rawExpiration)
    if(rawExpiration&&!parsedExpiration) addIssue(issues,'STOCK CON P',index+1,codigo,referenceValue,'ERROR','FECHA VENC INVÁLIDA')
    if(quantity===null||availableQuantity===null||!unitCode||rawExpiration&&!parsedExpiration) continue
    if(quantity>0&&!referenceValue){addIssue(issues,'STOCK CON P',index+1,codigo,null,'ERROR','STOCK POSITIVO SIN PARTIDA / TALLA');continue}
    if(referenceValue&&(quantity!==0||availableQuantity!==0)) pushItem({codigo,referenceType:'PARTIDA',referenceValue,quantity,availableQuantity,unitCode,expirationDate:parsedExpiration},'STOCK CON P',index+1)
   }
  }
 }

 const serials=matrices.get('STOCK CON S')
 if(serials){
  const codeIndex=column(serials.headers,'Cod. Producto'),refIndex=column(serials.headers,'Serie'),stockIndex=column(serials.headers,'Stock Total'),availableIndex=column(serials.headers,'Disponible'),unitIndex=column(serials.headers,'Cod. U. Medida')
  if(codeIndex!==undefined&&refIndex!==undefined&&stockIndex!==undefined&&availableIndex!==undefined&&unitIndex!==undefined){
   for(let index=1;index<serials.display.length;index+=1){
    const codigo=code(serials.display[index]?.[codeIndex])
    const referenceValue=ref(serials.display[index]?.[refIndex])
    const quantity=parseInteger(serials.raw[index]?.[stockIndex])
    const availableQuantity=parseInteger(serials.raw[index]?.[availableIndex])
    const unitCode=ref(serials.display[index]?.[unitIndex])
    if(!codigo) continue
    if(referenceValue&&deriveMasterControlType(codigo)!=='SERIAL'){addIssue(issues,'STOCK CON S',index+1,codigo,referenceValue,'ERROR','SERIE ASOCIADA A SKU NO SERIAL');continue}
    if(deriveMasterControlType(codigo)!=='SERIAL'||quantity===null||availableQuantity===null||!unitCode) continue
    if(quantity>0&&!referenceValue){addIssue(issues,'STOCK CON S',index+1,codigo,null,'ERROR','STOCK SERIAL POSITIVO SIN SERIE');continue}
    if(referenceValue&&(quantity<0||availableQuantity<0)) addIssue(issues,'STOCK CON S',index+1,codigo,referenceValue,'WARNING','SERIE CON STOCK NEGATIVO: se conserva como evidencia; no genera conteo físico negativo')
    else if(referenceValue&&quantity!==1){addIssue(issues,'STOCK CON S',index+1,codigo,referenceValue,'ERROR','CADA SERIE DEBE TENER CANTIDAD 1');continue}
    if(referenceValue){
     if(globalSeries.has(referenceValue)){addIssue(issues,'STOCK CON S',index+1,codigo,referenceValue,'ERROR','SERIE DUPLICADA EN FUENTE DE SISTEMA');continue}
     globalSeries.add(referenceValue)
     pushItem({codigo,referenceType:'SERIAL',referenceValue,quantity:1,availableQuantity,unitCode,expirationDate:null},'STOCK CON S',index+1)
    }
   }
  }
 }

 const fileSha256=await sha256(contents)
 return systemReferencePreviewSchema.parse({
  fileName,fileSha256,sourceFiles:[{role:'CONSOLIDADO',fileName,sha256:fileSha256}],totalSourceRows,itemCount:items.length,
  serialItems:items.filter(item=>item.referenceType==='SERIAL').length,
  batchItems:items.filter(item=>item.referenceType==='PARTIDA').length,
  legacyItems:items.filter(item=>item.referenceType==='LEGACY').length,
  issues,items,
 })
}

type SplitSheet={fileName:string;sha256:string;label:string;display:Matrix;raw:Matrix;headers:Map<string,number>}

async function readSplitSheet(file:File,expectedSheet:'STOCK CON P'|'STOCK CON S',label:string,issues:SystemReferenceIssue[]):Promise<SplitSheet|null>{
 const contents=await file.arrayBuffer()
 const XLSX=await import('@e965/xlsx')
 const workbook=XLSX.read(contents,{type:'array',cellText:true,cellNF:true})
 const sheetName=workbook.SheetNames.find(name=>name.trim().toUpperCase()===expectedSheet)??(workbook.SheetNames.length===1?workbook.SheetNames[0]:undefined)
 if(!sheetName){addIssue(issues,label,0,'',null,'ERROR',`HOJA REQUERIDA AUSENTE: ${expectedSheet}`);return null}
 const sheet=workbook.Sheets[sheetName]
 if(!sheet){addIssue(issues,label,0,'',null,'ERROR',`HOJA REQUERIDA AUSENTE: ${expectedSheet}`);return null}
 const display=XLSX.utils.sheet_to_json<Matrix[number]>(sheet,{header:1,raw:false,defval:''}) as Matrix
 const raw=XLSX.utils.sheet_to_json<Matrix[number]>(sheet,{header:1,raw:true,defval:''}) as Matrix
 const headers=mapHeaders(display[0]??[])
 for(const required of REQUIRED_HEADERS[expectedSheet]) if(column(headers,required)===undefined) addIssue(issues,label,1,'',null,'ERROR',`COLUMNA REQUERIDA AUSENTE: ${required}`)
 return {fileName:file.name,sha256:await sha256(contents),label,display,raw,headers}
}

function validateSplitSheet(matrix:SplitSheet,issues:SystemReferenceIssue[]){
 const codes=new Set<string>()
 const aggregate=new Map<string,number>()
 const codeIndex=column(matrix.headers,'Cod. Producto')
 const rows=Math.max(matrix.display.length,matrix.raw.length)
 if(codeIndex===undefined) return {codes,aggregate,totalRows:Math.max(0,rows-1)}
 for(let index=1;index<rows;index+=1){
  const displayRow=matrix.display[index]??[]
  const rawRow=matrix.raw[index]??[]
  const codigo=code(displayRow[codeIndex])
  if(!codigo) continue
  codes.add(codigo)
  const values=stockValues(rawRow,matrix.headers)
  if(values.some(value=>value===null)){addIssue(issues,matrix.label,index+1,codigo,null,'ERROR','STOCK NO ENTERO O NO NUMÉRICO');continue}
  const [disponible,reserva,transitoria,consignacion,total]=values as [number,number,number,number,number]
  if(disponible+reserva+transitoria+consignacion!==total) addIssue(issues,matrix.label,index+1,codigo,null,'WARNING','STOCK TOTAL NO CUADRA CON SUS ESTADOS')
  if([disponible,reserva,transitoria,consignacion].some(value=>value<0)) addIssue(issues,matrix.label,index+1,codigo,null,'WARNING','EXISTE UN ESTADO DE STOCK NEGATIVO')
  if(total<0) addIssue(issues,matrix.label,index+1,codigo,null,'WARNING','STOCK TOTAL NEGATIVO: se conserva como evidencia; no genera conteo físico negativo')
  aggregate.set(codigo,(aggregate.get(codigo)??0)+total)
 }
 return {codes,aggregate,totalRows:Math.max(0,rows-1)}
}

export const unidentifiedBatchReference=(codigo:string)=>`EXC-SIN-PARTIDA:${normalizeMasterCode(codigo)}`

export async function parseSystemReferenceFiles(batchFile:File,serialFile:File,authorizedCodes:ReadonlySet<string>=new Set(),masterCodes?:ReadonlySet<string>):Promise<SystemReferencePreview>{
 const issues:SystemReferenceIssue[]=[]
 const batches=await readSplitSheet(batchFile,'STOCK CON P','ARCHIVO PARTIDAS',issues)
 const serials=await readSplitSheet(serialFile,'STOCK CON S','ARCHIVO SERIES',issues)
 if(!batches||!serials){
  const sourceFiles=[...(batches?[{role:'PARTIDAS' as const,fileName:batches.fileName,sha256:batches.sha256}]:[]),...(serials?[{role:'SERIES' as const,fileName:serials.fileName,sha256:serials.sha256}]:[])]
  const fileName=[batchFile.name,serialFile.name].join(' + ')
  return systemReferencePreviewSchema.parse({fileName,fileSha256:await sha256Text(`${batchFile.name}\u001f${serialFile.name}`),sourceFiles,totalSourceRows:0,itemCount:0,serialItems:0,batchItems:0,legacyItems:0,unidentifiedBatchCodes:[],issues,items:[]})
 }

 const batchSummary=validateSplitSheet(batches,issues)
 const serialSummary=validateSplitSheet(serials,issues)
 const sharedCodes=[...batchSummary.codes].filter(codigo=>serialSummary.codes.has(codigo))
 const aggregateMismatches=sharedCodes.filter(codigo=>batchSummary.aggregate.get(codigo)!==serialSummary.aggregate.get(codigo))
 if(aggregateMismatches.length) addIssue(issues,'ARCHIVOS COMBINADOS',0,'',null,'WARNING',`STOCK CONSOLIDADO NO CUADRA ENTRE PARTIDAS Y SERIES EN ${aggregateMismatches.length} SKU COMPARTIDOS`)

 const items:SystemReferenceItem[]=[]
 const naturalKeys=new Set<string>()
 const globalSeries=new Set<string>()
 const legacyCodes=new Set<string>()
 const unidentifiedBatchCodes=new Set<string>()
 const unknownMasterCodes=new Set<string>()
 const unidentifiedBatchTotals=new Map<string,{quantity:number;availableQuantity:number;unitCode:string}>()
 const pushItem=(item:SystemReferenceItem,sheet:string,rowNumber:number)=>{
  const key=`${item.codigo}\u001f${item.referenceType}\u001f${item.referenceValue??''}`
  if(naturalKeys.has(key)){addIssue(issues,sheet,rowNumber,item.codigo,item.referenceValue,'ERROR','REFERENCIA DUPLICADA');return}
  naturalKeys.add(key);items.push(item)
 }
 const belongsToMaster=(codigo:string,sheet:string,rowNumber:number)=>{
  if(!masterCodes||masterCodes.has(codigo))return true
  if(!unknownMasterCodes.has(codigo)){
   unknownMasterCodes.add(codigo)
   addIssue(issues,sheet,rowNumber,codigo,null,'WARNING','SKU NO ESTÁ EN EL MAESTRO: se conserva como observación, pero no queda habilitado para conteo.')
  }
  return false
 }
 const readLegacy=(matrix:SplitSheet,onlyMissing:boolean)=>{
  const codeIndex=column(matrix.headers,'Cod. Producto'),stockIndex=column(matrix.headers,'Stock Total'),availableIndex=column(matrix.headers,'Disponible'),unitIndex=column(matrix.headers,'Cod. U. Medida')
  if(codeIndex===undefined||stockIndex===undefined||availableIndex===undefined||unitIndex===undefined)return
  for(let index=1;index<matrix.display.length;index+=1){
   const codigo=code(matrix.display[index]?.[codeIndex])
   if(!codigo||!belongsToMaster(codigo,matrix.label,index+1)||deriveMasterControlType(codigo)!=='LEGACY'||onlyMissing&&legacyCodes.has(codigo))continue
   const quantity=parseInteger(matrix.raw[index]?.[stockIndex]),availableQuantity=parseInteger(matrix.raw[index]?.[availableIndex]),unitCode=ref(matrix.display[index]?.[unitIndex])
   if(quantity===null||availableQuantity===null||!unitCode||(quantity===0&&availableQuantity===0))continue
   pushItem({codigo,referenceType:'LEGACY',referenceValue:null,quantity,availableQuantity,unitCode,expirationDate:null},matrix.label,index+1)
   legacyCodes.add(codigo)
  }
 }
 readLegacy(batches,false)
 readLegacy(serials,true)

 const batchCodeIndex=column(batches.headers,'Cod. Producto'),batchRefIndex=column(batches.headers,'Partida / Talla'),batchStockIndex=column(batches.headers,'Stock Total'),batchAvailableIndex=column(batches.headers,'Disponible'),batchUnitIndex=column(batches.headers,'Cod. U. Medida'),batchExpirationIndex=column(batches.headers,'Fecha Venc')
 if(batchCodeIndex!==undefined&&batchRefIndex!==undefined&&batchStockIndex!==undefined&&batchAvailableIndex!==undefined&&batchUnitIndex!==undefined&&batchExpirationIndex!==undefined) for(let index=1;index<batches.display.length;index+=1){
  const codigo=code(batches.display[index]?.[batchCodeIndex])
  if(!codigo||!belongsToMaster(codigo,batches.label,index+1)||deriveMasterControlType(codigo)!=='PARTIDA')continue
  const quantity=parseInteger(batches.raw[index]?.[batchStockIndex]),availableQuantity=parseInteger(batches.raw[index]?.[batchAvailableIndex]),referenceValue=ref(batches.display[index]?.[batchRefIndex]),unitCode=ref(batches.display[index]?.[batchUnitIndex])
  const rawExpiration=ref(batches.display[index]?.[batchExpirationIndex]),parsedExpiration=expirationDate(rawExpiration)
  if(rawExpiration&&!parsedExpiration)addIssue(issues,batches.label,index+1,codigo,referenceValue,'ERROR','FECHA VENC INVÁLIDA')
  if(quantity===null||availableQuantity===null||!unitCode||rawExpiration&&!parsedExpiration)continue
  if(quantity>0&&!referenceValue){
   unidentifiedBatchCodes.add(codigo)
   if(!authorizedCodes.has(codigo)){addIssue(issues,batches.label,index+1,codigo,null,'ERROR','STOCK POSITIVO SIN PARTIDA / TALLA');continue}
   const current=unidentifiedBatchTotals.get(codigo)
   unidentifiedBatchTotals.set(codigo,{quantity:(current?.quantity??0)+quantity,availableQuantity:(current?.availableQuantity??0)+availableQuantity,unitCode})
   continue
  }
  if(referenceValue&&(quantity!==0||availableQuantity!==0))pushItem({codigo,referenceType:'PARTIDA',referenceValue,quantity,availableQuantity,unitCode,expirationDate:parsedExpiration},batches.label,index+1)
 }
 for(const [codigo,total] of unidentifiedBatchTotals){
  pushItem({codigo,referenceType:'PARTIDA',referenceValue:unidentifiedBatchReference(codigo),quantity:total.quantity,availableQuantity:total.availableQuantity,unitCode:total.unitCode,expirationDate:null},batches.label,0)
  addIssue(issues,'EXCEPCIÓN CONTROLADA',0,codigo,unidentifiedBatchReference(codigo),'WARNING','PARTIDA AUSENTE EN SOFTLAND: referencia de excepción; no es una partida real ni autoriza ajustes.')
 }

 const serialCodeIndex=column(serials.headers,'Cod. Producto'),serialRefIndex=column(serials.headers,'Serie'),serialStockIndex=column(serials.headers,'Stock Total'),serialAvailableIndex=column(serials.headers,'Disponible'),serialUnitIndex=column(serials.headers,'Cod. U. Medida')
 if(serialCodeIndex!==undefined&&serialRefIndex!==undefined&&serialStockIndex!==undefined&&serialAvailableIndex!==undefined&&serialUnitIndex!==undefined) for(let index=1;index<serials.display.length;index+=1){
  const codigo=code(serials.display[index]?.[serialCodeIndex]),referenceValue=ref(serials.display[index]?.[serialRefIndex]),quantity=parseInteger(serials.raw[index]?.[serialStockIndex]),availableQuantity=parseInteger(serials.raw[index]?.[serialAvailableIndex]),unitCode=ref(serials.display[index]?.[serialUnitIndex])
  if(!codigo||!belongsToMaster(codigo,serials.label,index+1))continue
  if(referenceValue&&deriveMasterControlType(codigo)!=='SERIAL'){addIssue(issues,serials.label,index+1,codigo,referenceValue,'ERROR','SERIE ASOCIADA A SKU NO SERIAL');continue}
  if(deriveMasterControlType(codigo)!=='SERIAL'||quantity===null||availableQuantity===null||!unitCode)continue
  if(quantity>0&&!referenceValue){addIssue(issues,serials.label,index+1,codigo,null,'ERROR','STOCK SERIAL POSITIVO SIN SERIE');continue}
  if(referenceValue&&(quantity<0||availableQuantity<0))addIssue(issues,serials.label,index+1,codigo,referenceValue,'WARNING','SERIE CON STOCK NEGATIVO: se conserva como evidencia; no genera conteo físico negativo')
  else if(referenceValue&&quantity!==1){addIssue(issues,serials.label,index+1,codigo,referenceValue,'ERROR','CADA SERIE DEBE TENER CANTIDAD 1');continue}
  if(referenceValue){if(globalSeries.has(referenceValue)){addIssue(issues,serials.label,index+1,codigo,referenceValue,'ERROR','SERIE DUPLICADA EN FUENTE DE SISTEMA');continue};globalSeries.add(referenceValue);pushItem({codigo,referenceType:'SERIAL',referenceValue,quantity:1,availableQuantity,unitCode,expirationDate:null},serials.label,index+1)}
 }

 const sourceFiles=[{role:'PARTIDAS' as const,fileName:batches.fileName,sha256:batches.sha256},{role:'SERIES' as const,fileName:serials.fileName,sha256:serials.sha256}]
 const fileName=`${batches.fileName} + ${serials.fileName}`
 const fileSha256=await sha256Text(`${batches.sha256}\u001f${serials.sha256}`)
 return systemReferencePreviewSchema.parse({fileName,fileSha256,sourceFiles,totalSourceRows:batchSummary.totalRows+serialSummary.totalRows,itemCount:items.length,serialItems:items.filter(item=>item.referenceType==='SERIAL').length,batchItems:items.filter(item=>item.referenceType==='PARTIDA').length,legacyItems:items.filter(item=>item.referenceType==='LEGACY').length,unidentifiedBatchCodes:[...unidentifiedBatchCodes].sort(),issues,items})
}

export async function parseSystemReferenceFile(file:File){
 const extension=file.name.split('.').pop()?.toLowerCase()
 if(extension!=='xlsx') throw new Error('La referencia de sistema requiere el libro RP completo en formato XLSX.')
 return parseSystemReferenceXlsx(await file.arrayBuffer(),file.name)
}
