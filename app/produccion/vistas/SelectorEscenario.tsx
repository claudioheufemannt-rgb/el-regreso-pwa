'use client'

import type { Produccion, EscenarioId } from '../useProduccion'

/**
 * Con qué venta se planifica (17-nov-2026). Cambia a la vez la cobertura, las
 * alarmas, "a producir" y la pestaña Temporada. Va en Plan y en Temporada:
 * es la misma elección, no una por pestaña.
 */
export default function SelectorEscenario({ p }: { p: Produccion }) {
  const { escenarios, escenarioId, setEscenarioId } = p
  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-(--p-text-3)" title="Venta con la que se calculan cobertura, alarmas y lo que hay que producir. Los porcentajes son contra la temporada anterior (dic-mar).">
      Venta
      <select
        id="produccion-escenario"
        value={escenarioId}
        onChange={e => setEscenarioId(e.target.value as EscenarioId)}
        className={`rounded-lg border px-2.5 py-1.5 text-sm font-bold focus:border-(--p-accent) focus:outline-none ${
          escenarioId === 'modelo' ? 'border-(--p-line) bg-(--p-card-2) text-(--p-text)' : 'border-(--p-accent-line) bg-(--p-accent-soft) text-(--p-accent)'
        }`}
      >
        {escenarios.map(e => (
          <option key={e.id} value={e.id}>
            {e.crecimiento == null ? 'Según el modelo' : e.crecimiento === 0 ? 'Igual al año pasado' : `Año pasado ${e.label}`}
          </option>
        ))}
      </select>
    </label>
  )
}
