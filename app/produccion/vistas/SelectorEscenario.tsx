'use client'

import type { Produccion, EscenarioId } from '../useProduccion'

const GRUPOS = [
  { id: 'estadistico', label: 'Según el backtest' },
  { id: 'anio', label: 'Contra la temporada pasada' },
  { id: 'modelo', label: 'Referencia' },
] as const

/** Qué significa cada escenario, en una línea (va en el title y debajo del selector en Temporada). */
export const AYUDA_ESCENARIO: Record<EscenarioId, string> = {
  conservador: 'Venta baja pero posible: 9 de cada 10 veces se vendió más que esto (P10 del error medido).',
  base: 'Lo más probable: el forecast corregido por su sesgo de temporada (en el backtest erró menos que sin corregir).',
  optimista: 'Venta alta pero posible: 9 de cada 10 veces se vendió menos que esto (P90 del error medido).',
  igual: 'La temporada dic-mar igual a la del año pasado.',
  '+10': 'La temporada dic-mar 10% sobre la del año pasado.',
  '+20': 'La temporada dic-mar 20% sobre la del año pasado.',
  '+30': 'La temporada dic-mar 30% sobre la del año pasado.',
  modelo: 'El forecast tal cual sale del modelo, sin corregir. Se proyecta bajo en temporada alta.',
}

/**
 * Con qué venta se planifica (17-nov-2026). Cambia a la vez la cobertura, las
 * alarmas, "a producir", la tabla de Demanda y la pestaña Temporada: es una
 * sola elección para todo el módulo.
 */
export default function SelectorEscenario({ p }: { p: Produccion }) {
  const { escenarios, escenarioId, setEscenarioId } = p
  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-(--p-text-3)" title={AYUDA_ESCENARIO[escenarioId]}>
      Escenario
      <select
        id="produccion-escenario"
        value={escenarioId}
        onChange={e => setEscenarioId(e.target.value as EscenarioId)}
        className={`rounded-lg border px-2.5 py-1.5 text-sm font-bold focus:border-(--p-accent) focus:outline-none ${
          escenarioId === 'base' ? 'border-(--p-line) bg-(--p-card-2) text-(--p-text)' : 'border-(--p-accent-line) bg-(--p-accent-soft) text-(--p-accent)'
        }`}
      >
        {GRUPOS.map(g => (
          <optgroup key={g.id} label={g.label}>
            {escenarios.filter(e => e.grupo === g.id).map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  )
}
