import { describe, expect, it } from 'vitest'
import { detectInventoryAnomalies } from '../../src/domain/reconciliation/detect-inventory-anomalies'

describe('detectInventoryAnomalies', () => {
  it('detecta la serie física no registrada sin bloquear el hallazgo', () => {
    expect(detectInventoryAnomalies([], [{ codigo: '0AD46650095S', controlType: 'SERIAL', reference: '0000-00000-012334', quantity: 1 }]))
      .toContainEqual(expect.objectContaining({ type: 'SERIE_FISICA_NO_EN_SISTEMA', physicalQuantity: 1, systemQuantity: 0 }))
  })

  it('detecta simultáneamente serie faltante y serie física desconocida', () => {
    const result = detectInventoryAnomalies(
      [
        { codigo: 'SKU-S', controlType: 'SERIAL', reference: '000001', quantity: 1 },
        { codigo: 'SKU-S', controlType: 'SERIAL', reference: '000002', quantity: 1 },
        { codigo: 'SKU-S', controlType: 'SERIAL', reference: '000003', quantity: 1 },
      ],
      [
        { codigo: 'SKU-S', controlType: 'SERIAL', reference: '000001', quantity: 1 },
        { codigo: 'SKU-S', controlType: 'SERIAL', reference: '000002', quantity: 1 },
        { codigo: 'SKU-S', controlType: 'SERIAL', reference: '000004', quantity: 1 },
      ],
    )
    expect(result.map((x) => [x.type, x.reference])).toEqual([
      ['SERIE_SISTEMA_NO_CONTADA', '000003'],
      ['SERIE_FISICA_NO_EN_SISTEMA', '000004'],
    ])
  })

  it('detecta diferencia de cantidad por partida preservando referencia con cero inicial', () => {
    expect(detectInventoryAnomalies(
      [{ codigo: '0FL35250540P', controlType: 'PARTIDA', reference: '01304-501', quantity: 20 }],
      [{ codigo: '0FL35250540P', controlType: 'PARTIDA', reference: '01304-501', quantity: 21 }],
    )).toEqual([{ type: 'DIFERENCIA_CANTIDAD_PARTIDA', codigo: '0FL35250540P', reference: '01304-501', systemQuantity: 20, physicalQuantity: 21, difference: 1 }])
  })

  it('detecta stock de PARTIDA en sistema sin referencia sin inventar un lote', () => {
    expect(detectInventoryAnomalies(
      [{ codigo: 'SKU-P', controlType: 'PARTIDA', reference: null, quantity: 4 }],
      [],
    )).toEqual([{
      type: 'PARTIDA_SISTEMA_SIN_REFERENCIA',
      codigo: 'SKU-P',
      reference: null,
      systemQuantity: 4,
      physicalQuantity: 0,
      difference: -4,
    }])
  })

  it('detecta partida física no registrada y partida de sistema no contada', () => {
    const result = detectInventoryAnomalies(
      [{ codigo: 'SKU-P', controlType: 'PARTIDA', reference: '000045', quantity: 3 }],
      [{ codigo: 'SKU-P', controlType: 'PARTIDA', reference: '000046', quantity: 3 }],
    )
    expect(result.map((x) => x.type).sort()).toEqual(['PARTIDA_FISICA_NO_EN_SISTEMA', 'PARTIDA_SISTEMA_NO_CONTADA'])
  })

  it('detecta diferencia agregada para LEGACY', () => {
    expect(detectInventoryAnomalies(
      [{ codigo: '0045689789', controlType: 'LEGACY', quantity: 1 }],
      [{ codigo: '0045689789', controlType: 'LEGACY', quantity: 2 }],
    )[0]).toMatchObject({ type: 'DIFERENCIA_CANTIDAD_SKU', difference: 1 })
  })

  it('marca una serie contada más de una vez', () => {
    expect(detectInventoryAnomalies(
      [{ codigo: 'SKU-S', controlType: 'SERIAL', reference: 'ABC', quantity: 1 }],
      [
        { codigo: 'SKU-S', controlType: 'SERIAL', reference: 'ABC', quantity: 1 },
        { codigo: 'SKU-S', controlType: 'SERIAL', reference: 'ABC', quantity: 1 },
      ],
    ).map((x) => x.type)).toContain('DUPLICADO_SERIE')
  })

  it('no genera anomalías cuando físico y sistema cuadran', () => {
    expect(detectInventoryAnomalies(
      [{ codigo: 'SKU-P', controlType: 'PARTIDA', reference: '000045', quantity: 30 }],
      [{ codigo: 'SKU-P', controlType: 'PARTIDA', reference: '000045', quantity: 30 }],
    )).toEqual([])
  })
})
