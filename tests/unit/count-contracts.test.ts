import { describe, expect, it } from 'vitest'
import { BATCH_REQUIRED_ERROR, LOCATION_ERROR, QUANTITY_ERROR, SERIAL_LENGTH_ERROR, SERIAL_REQUIRED_ERROR, pendingCapacity, validatePhysicalCountDraft, type PhysicalCountDraft } from '../../src/domain/count/contracts'
import { resetForControlType } from '../../src/features/counting/form-state'
import type { MasterSku } from '../../src/domain/master/contracts'

const inventoryId = '11111111-1111-4111-8111-111111111111'
const base: PhysicalCountDraft = { ubicacion: 'f-32-03', codigo: ' 00001 ', cantidadContada: '3' }
function master(controlType: MasterSku['controlType']): MasterSku { return { inventoryId, codigo: '00001', descripcion: '  Producto certificado  ', controlType, cachedAt: '2026-09-16T00:00:00.000Z' } }

describe('contrato de conteo físico', () => {
  it('normaliza ubicación y completa la descripción exclusivamente desde el maestro', () => {
    const actual = validatePhysicalCountDraft({ ...base, fechaVencimiento: '2026-12-31', piezaProducto: ' pieza ' }, master('LEGACY'))
    expect(actual).toMatchObject({ ubicacion: 'F-32-03', codigo: '00001', descripcion: 'Producto certificado', cantidadContada: 3, fechaVencimiento: '2026-12-31', piezaProducto: 'pieza' })
  })

  it.each(['C2-32-03', 'A-00-00', 'I-99-99'])('acepta ubicación %s', (ubicacion) => expect(validatePhysicalCountDraft({ ...base, ubicacion }, master('LEGACY')).ubicacion).toBe(ubicacion))
  it.each(['E-32-03', 'C2-2-03', 'F-32-003', 'F-32-3'])('rechaza ubicación %s con el mensaje aprobado', (ubicacion) => expect(() => validatePhysicalCountDraft({ ...base, ubicacion }, master('LEGACY'))).toThrow(LOCATION_ERROR))

  it('aplica las reglas SERIAL: serie obligatoria, máximo 19, partida ignorada y cantidad 1', () => {
    expect(() => validatePhysicalCountDraft(base, master('SERIAL'))).toThrow(SERIAL_REQUIRED_ERROR)
    expect(() => validatePhysicalCountDraft({ ...base, serie: '12345678901234567890' }, master('SERIAL'))).toThrow(SERIAL_LENGTH_ERROR)
    expect(validatePhysicalCountDraft({ ...base, serie: 'ABC-1', partida: 'IGNORADA', cantidadContada: '99' }, master('SERIAL'))).toMatchObject({ serie: 'ABC-1', partida: null, cantidadContada: 1 })
  })

  it('aplica las reglas PARTIDA y conserva ceros iniciales', () => {
    expect(() => validatePhysicalCountDraft(base, master('PARTIDA'))).toThrow(BATCH_REQUIRED_ERROR)
    expect(validatePhysicalCountDraft({ ...base, partida: '000045', serie: 'IGNORADA' }, master('PARTIDA'))).toMatchObject({ partida: '000045', serie: null })
  })

  it('admite ambos campos opcionales en LEGACY y rechaza cantidades no enteras positivas', () => {
    expect(validatePhysicalCountDraft({ ...base, serie: 'S', partida: '0002' }, master('LEGACY'))).toMatchObject({ serie: 'S', partida: '0002' })
    for (const cantidadContada of ['0', '-1', '1.5', 'abc']) expect(() => validatePhysicalCountDraft({ ...base, cantidadContada }, master('LEGACY'))).toThrow(QUANTITY_ERROR)
  })

  it('rechaza un SKU no disponible localmente y fechas de calendario imposibles', () => {
    expect(() => validatePhysicalCountDraft(base, null)).toThrow('Código mal ingresado')
    expect(() => validatePhysicalCountDraft({ ...base, fechaVencimiento: '2026-02-30' }, master('LEGACY'))).toThrow('La fecha de vencimiento debe ser una fecha válida.')
  })

  it('resetea campos incompatibles al cambiar el tipo de control', () => {
    expect(resetForControlType({ ...base, serie: 'S', partida: '0001' }, 'PARTIDA')).toMatchObject({ serie: '', partida: '', cantidadContada: '' })
    expect(resetForControlType({ ...base, serie: 'S', partida: '0001' }, 'SERIAL')).toMatchObject({ serie: '', partida: '', cantidadContada: '1' })
  })

  it.each([[0, 'NORMAL'], [39, 'NORMAL'], [40, 'WARNING'], [44, 'WARNING'], [45, 'CRITICAL'], [49, 'CRITICAL'], [50, 'BLOCKED']])('clasifica capacidad pendiente %i como %s', (total, expected) => expect(pendingCapacity(total)).toBe(expected))
})
