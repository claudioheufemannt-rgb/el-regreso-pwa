import { describe, expect, it } from 'vitest'
import { pesosCanal, serieDeCanal, type LitrosCanalCiclo } from '../canales'

// Dos años de historia: el BaseCamp pesa el doble en diciembre (verano) y en
// los últimos meses su peso subió un 50% respecto del año anterior.
const filas: LitrosCanalCiclo[] = []
for (const anio of [2024, 2025]) {
  for (let m = 1; m <= 12; m++) {
    const ciclo = `${anio}-${String(m).padStart(2, '0')}-01`
    const verano = m === 12 || m <= 2
    const crece = anio === 2025 && m >= 8 ? 1.5 : 1
    filas.push({ ciclo, canal: 'basecamp', litros: (verano ? 200 : 100) * crece })
    filas.push({ ciclo, canal: 'retail', litros: 900 })
  }
}
filas.push({ ciclo: '2026-01-01', canal: 'basecamp', litros: 40 })

describe('pesosCanal', () => {
  const porCiclo = new Map<string, Map<string, number>>()
  for (const f of filas) {
    const m = porCiclo.get(f.ciclo) ?? new Map()
    m.set(f.canal, (m.get(f.canal) ?? 0) + f.litros)
    porCiclo.set(f.ciclo, m)
  }
  const cerrados = [...porCiclo.keys()].filter(c => c < '2026-01-01').sort()

  it('los pesos suman 1', () => {
    const w = pesosCanal('2026-02-01', porCiclo, cerrados)
    expect([...w.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
  })

  it('trae la estacionalidad del canal y el cambio reciente de su peso', () => {
    const verano = pesosCanal('2026-02-01', porCiclo, cerrados).get('basecamp')!
    const invierno = pesosCanal('2026-07-01', porCiclo, cerrados).get('basecamp')!
    expect(verano).toBeGreaterThan(invierno) // pesa más en verano
    expect(invierno).toBeGreaterThan(100 / 1000) // y más que hace un año (subió)
  })
})

describe('serieDeCanal', () => {
  const general = [
    { mes: '2026-01-01', tipo: 'forecast' as const, litros: 1000, litrosMin: 800, litrosMax: 1200 },
    { mes: '2026-02-01', tipo: 'forecast' as const, litros: 1200, litrosMin: 1000, litrosMax: 1400 },
  ]
  it('historia real del canal, ciclo en curso aparte y proyección como parte del total', () => {
    const s = serieDeCanal('basecamp', filas, general, '2026-01-01')
    expect(s.litrosMesEnCurso).toBe(40)
    expect(s.puntos.filter(p => p.tipo === 'historico')).toHaveLength(24)
    const feb = s.puntos.find(p => p.mes === '2026-02-01')!
    expect(feb.litros).toBeGreaterThan(0)
    expect(feb.litros).toBeLessThan(1200)
    expect(feb.litrosMin!).toBeLessThan(feb.litrosMax!)
  })
})
