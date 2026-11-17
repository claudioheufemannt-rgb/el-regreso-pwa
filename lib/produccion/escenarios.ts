/**
 * Escenarios de venta medidos con backtest (17-nov-2026).
 *
 * De dónde salen: scripts/analisis/backtest_v2_produccion.py — rolling origin
 * de 12 cortes (nov-2025 a oct-2026), 1 a 4 ciclos adelante, 22 productos y 49
 * producto×formato. Se midió el forecast que de verdad corre en producción
 * (Prophet con su corrección de sesgo `b`) contra lo que se vendió.
 *
 * Lo que encontró:
 *  1. El forecast tiene un sesgo que depende de la ESTACIÓN: fuera de temporada
 *     se pasa (+14% en producto, +17% en producto×formato) y en temporada alta
 *     se queda corto (−14% y −13%). La corrección `b` del pipeline es una sola
 *     para todo el año, así que en verano baja aún más lo que ya venía bajo.
 *     Corregir aparte temporada y fuera de temporada baja el error (WAPE) de
 *     28,9% a 25,6% por producto y de 39,2% a 35,4% por producto×formato, y
 *     deja el sesgo en ~0 en las dos estaciones. Medido dejando fuera el
 *     producto evaluado al estimar el factor, para no hacer trampa.
 *  2. Las bandas que guarda el forecast (litros_min/max) son las de Prophet sin
 *     calibrar: el error real es 1,7-2,4 veces más ancho. Los escenarios usan en
 *     cambio los cuantiles empíricos del error del backtest (la idea de la
 *     predicción conformal): P10 y P90 de real ÷ pronóstico, ponderados por
 *     volumen. Cubren 77-79% de los litros reales (lo esperado: 80%).
 *
 * Recalibrar cada pocos meses corriendo el backtest y copiando los números de
 * su salida. La ventana tiene UNA sola temporada alta: con la próxima conviene
 * volver a medir.
 */

export type NivelEscenario = 'producto' | 'producto_envase'
export type EscenarioEstadistico = 'conservador' | 'base' | 'optimista'

/** real ÷ pronóstico en el backtest, por nivel y estación. */
const SESGO: Record<NivelEscenario, { temporada: number; fuera: number }> = {
  producto: { temporada: 1.16, fuera: 0.875 },
  producto_envase: { temporada: 1.148, fuera: 0.853 },
}

/** Cuantiles de real ÷ pronóstico ya corregido, por nivel y horizonte (1-4 ciclos). */
const CUANTILES: Record<NivelEscenario, { p10: number; p90: number }[]> = {
  producto: [
    { p10: 0.71, p90: 1.329 }, { p10: 0.701, p90: 1.315 }, { p10: 0.67, p90: 1.312 }, { p10: 0.687, p90: 1.29 },
  ],
  producto_envase: [
    { p10: 0.537, p90: 1.432 }, { p10: 0.513, p90: 1.488 }, { p10: 0.487, p90: 1.424 }, { p10: 0.473, p90: 1.407 },
  ],
}

export const MESES_TEMPORADA_ALTA = new Set(['12', '01', '02', '03'])
const esTemporada = (mes: string) => MESES_TEMPORADA_ALTA.has(mes.slice(5, 7))

/** Ciclos entre el ciclo en curso y `mes` (1 = el siguiente), acotado a 1-4. */
function horizonte(mes: string, mesEnCurso: string): number {
  const [ya, ma] = mesEnCurso.split('-').map(Number)
  const [yb, mb] = mes.split('-').map(Number)
  return Math.min(4, Math.max(1, (yb - ya) * 12 + (mb - ma)))
}

/** Factor a aplicar al forecast guardado para un ciclo futuro. */
export function factorEstadistico(escenario: EscenarioEstadistico, nivel: NivelEscenario, mes: string, mesEnCurso: string): number {
  const sesgo = esTemporada(mes) ? SESGO[nivel].temporada : SESGO[nivel].fuera
  if (escenario === 'base') return sesgo
  const q = CUANTILES[nivel][horizonte(mes, mesEnCurso) - 1]
  return sesgo * (escenario === 'conservador' ? q.p10 : q.p90)
}
