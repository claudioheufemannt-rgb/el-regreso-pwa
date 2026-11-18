import { describe, expect, it } from 'vitest'
import { libreDesde, recomendarLotes, type TanqueCalc, type OcupacionCalc } from '../calculadora'

const tanques: TanqueCalc[] = [
  { nombre: 'Fermentador K-1', categoria: 'kombucha', capacidadLitros: 2000 },
  { nombre: 'Fermentador K-3', categoria: 'kombucha', capacidadLitros: 1200 },
  { nombre: 'Fermentador T5', categoria: 'cerveza', capacidadLitros: 3000 },
  { nombre: 'Bright tank T4', categoria: 'cerveza', capacidadLitros: 3000 },
]
const ocupacion: OcupacionCalc[] = [
  { fermentador: 'Fermentador K-1', inicioISO: '2026-11-10', dias: 14, tipo: 'en_tanque' },
  { fermentador: 'Fermentador K-3', inicioISO: '2026-11-25', dias: 12, tipo: 'sugerido' },
]

describe('libreDesde', () => {
  it('un tanque ocupado se libera al terminar su lote; las sugerencias no ocupan', () => {
    expect(libreDesde('Fermentador K-1', ocupacion, '2026-11-17')).toBe('2026-11-24')
    expect(libreDesde('Fermentador K-3', ocupacion, '2026-11-17')).toBe('2026-11-17')
  })
})

describe('recomendarLotes', () => {
  it('si un tanque libre alcanza, es un lote en el más justo de los que se liberan antes', () => {
    const r = recomendarLotes(1000, 'kombucha', tanques, ocupacion, '2026-11-17', 12, '2026-12-20')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ tanque: 'Fermentador K-3', inicioISO: '2026-11-17', listoISO: '2026-11-29', tarde: false })
  })

  it('si no cabe en uno, se parte en varios lotes', () => {
    const r = recomendarLotes(3000, 'kombucha', tanques, ocupacion, '2026-11-17', 12, null)
    expect(r.map(l => l.tanque)).toEqual(['Fermentador K-3', 'Fermentador K-1'])
    expect(r.reduce((s, l) => s + l.litros, 0)).toBe(3000)
  })

  it('marca tarde un lote que queda listo después del quiebre, y no usa el bright tank', () => {
    const r = recomendarLotes(2500, 'cerveza', tanques, ocupacion, '2026-11-17', 24, '2026-12-01')
    expect(r[0].tanque).toBe('Fermentador T5')
    expect(r[0].tarde).toBe(true)
  })
})
