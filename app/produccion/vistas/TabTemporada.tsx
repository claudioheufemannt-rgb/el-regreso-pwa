'use client'

import { useState } from 'react'
import ProductImage from '@/components/ui/ProductImage'
import { CalendarPlus, Factory, ShieldAlert, TrendingUp, PackageCheck } from 'lucide-react'
import { FAMILIA_LABEL, inicioDeCiclo } from '@/lib/produccion/reglas'
import { fNum, pl } from '../compartido'
import { Seccion, Kpi, Franja, ChipEstado, Pastillas, ComoSeCalcula, fFecha } from './ui'
import SelectorEscenario, { AYUDA_ESCENARIO } from './SelectorEscenario'
import type { Produccion } from '../useProduccion'

const MES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const nombreCiclo = (mes: string) => `${MES_LARGO[Number(mes.slice(5, 7)) - 1]} ${mes.slice(2, 4)}`

type Vista = 'total' | 'cerveza' | 'kombucha'

/**
 * Temporada (17-nov-2026): la temporada alta (dic-mar) en una pantalla, para
 * decidir en una reunión cuánto producir. Responde en orden:
 *   1. ¿Cuánto vamos a vender? — año pasado, el modelo y el escenario elegido.
 *   2. ¿Cuánto está programado y cuánto falta? — balance por línea.
 *   3. ¿Da la planta? — capacidad de tanques por ciclo contra la venta.
 *   4. ¿Qué se quiebra primero? — con su fecha límite para cocinar.
 * Todo sale de useProduccion (`temporada`) y del motor de cobertura, con el
 * escenario elegido; no hay cuentas propias en esta vista.
 */
export default function TabTemporada({ p }: { p: Produccion }) {
  const { temporada: t, escenarios, escenarioId, programarDesdeCobertura, guardandoPlan, seguimientoLotes } = p
  const [vista, setVista] = useState<Vista>('total')
  const esc = escenarios.find(e => e.id === escenarioId)
  const nombreEscenario = `Escenario ${(esc?.label ?? '').toLowerCase()}`

  const faltante = t.balance.cerveza.faltante + t.balance.kombucha.faltante
  const primerQuiebre = t.quiebres.find(q => q.lineaFija) ?? t.quiebres[0] ?? null
  const variacion = t.totales.anterior > 0 ? t.totales.escenario / t.totales.anterior - 1 : null
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n * 100)}%`

  // Filas de la tabla según la vista elegida.
  const dato = (f: (typeof t.filas)[number], k: 'anterior' | 'modelo' | 'escenario' | 'programado') => (vista === 'total' ? f[k] : f.porCat[vista][k])
  const capacidadCiclo = vista === 'total' ? t.capacidad.cerveza.porCiclo + t.capacidad.kombucha.porCiclo : t.capacidad[vista].porCiclo
  const escala = Math.max(capacidadCiclo, ...t.filas.map(f => Math.max(dato(f, 'escenario'), dato(f, 'anterior'), dato(f, 'modelo')))) || 1

  return (
    <div className="prod-enter flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-[13px] leading-relaxed text-(--p-text-3)">
          Temporada alta: del <strong className="text-(--p-text-2)">{fFecha(inicioDeCiclo(t.meses[0]))}</strong> al <strong className="text-(--p-text-2)">{fFecha(t.finTemporada)}</strong> (ciclos de diciembre a marzo). Elige con qué venta planificar: el cambio se aplica también en Hoy y en Plan.
        </p>
        <SelectorEscenario p={p} />
      </div>

      <Franja>
        <Kpi
          icono={TrendingUp}
          etiqueta="Venta esperada dic–mar"
          valor={fNum(t.totales.escenario)}
          unidad="L"
          tono="accent"
          detalle={`${nombreEscenario}${variacion != null ? ` · ${pct(variacion)} vs. la temporada pasada (${fNum(t.totales.anterior)} L)` : ''}. El modelo dice ${fNum(t.totales.modelo)} L.`}
        />
        <Kpi
          icono={PackageCheck}
          etiqueta="Ya programado"
          valor={fNum(t.balance.cerveza.programado + t.balance.kombucha.programado)}
          unidad="L"
          detalle={`Cerveza ${fNum(t.balance.cerveza.programado)} L · kombucha ${fNum(t.balance.kombucha.programado)} L. Lotes del plan que quedan listos antes del ${fFecha(t.finTemporada)}.`}
        />
        <Kpi
          icono={Factory}
          etiqueta="Falta producir"
          valor={fNum(faltante)}
          unidad="L"
          tono={faltante > 0 ? 'bad' : 'ok'}
          detalle={faltante > 0
            ? `Cerveza ${fNum(t.balance.cerveza.faltante)} L · kombucha ${fNum(t.balance.kombucha.faltante)} L para llegar al ${fFecha(t.finTemporada)} con colchón, producto por producto.`
            : 'Lo que hay más lo programado cubre la venta esperada.'}
        />
        <Kpi
          icono={ShieldAlert}
          etiqueta="Primer quiebre"
          valor={primerQuiebre ? fFecha(primerQuiebre.fechaQuiebre) : '—'}
          tono={primerQuiebre ? (primerQuiebre.fechaLimiteCocer && primerQuiebre.fechaLimiteCocer <= seguimientoLotes.hoy ? 'bad' : 'warn') : 'ok'}
          detalle={primerQuiebre
            ? `${primerQuiebre.producto} (${FAMILIA_LABEL[primerQuiebre.familia].toLowerCase()})${primerQuiebre.lineaFija ? ', línea fija' : ''}. ${t.quiebres.length} ${pl(t.quiebres.length, 'formato se queda', 'formatos se quedan')} sin stock antes del ${fFecha(t.finTemporada)}.`
            : 'Ningún formato se queda sin stock en la temporada con este escenario.'}
        />
      </Franja>

      {/* ── Rango de la temporada: los tres escenarios del backtest lado a lado ── */}
      <Seccion
        titulo="Rango de la venta de la temporada"
        detalle={<>Los tres escenarios a la vez, dic a mar. {AYUDA_ESCENARIO[escenarioId]}</>}
      >
        <div className="grid grid-cols-1 gap-px border-t border-(--p-line-2) bg-(--p-line-2) sm:grid-cols-3">
          {(['conservador', 'base', 'optimista'] as const).map(id => {
            const r = t.rango[id]
            const activo = escenarioId === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => p.setEscenarioId(id)}
                aria-pressed={activo}
                className={`prod-press flex flex-col items-start gap-1 px-5 py-4 text-left ${activo ? 'bg-(--p-accent-soft)' : 'bg-(--p-card) hover:bg-(--p-hover)'}`}
              >
                <span className={`prod-eyebrow ${activo ? 'text-(--p-accent)!' : ''}`}>{id === 'conservador' ? 'Conservador · P10' : id === 'base' ? 'Base · más probable' : 'Optimista · P90'}</span>
                <span className="prod-cifra text-[26px] font-extrabold leading-none text-(--p-text)">{fNum(r.total)} <span className="text-sm font-bold text-(--p-text-3)">L</span></span>
                <span className="text-xs tabular-nums text-(--p-text-3)">Cerveza {fNum(r.cerveza)} L · kombucha {fNum(r.kombucha)} L</span>
                {t.totales.anterior > 0 && <span className="text-xs tabular-nums text-(--p-text-3)">{pct(r.total / t.totales.anterior - 1)} vs. la temporada pasada</span>}
              </button>
            )
          })}
        </div>
      </Seccion>

      {/* ── Venta y capacidad por ciclo ── */}
      <Seccion
        titulo="Venta, producción y capacidad por ciclo"
        detalle="Cada barra es la venta esperada del ciclo con el escenario elegido; la raya vertical es lo que puede producir la planta en un ciclo si ningún tanque queda vacío."
        accion={
          <Pastillas<Vista>
            etiqueta="Línea"
            valor={vista}
            onCambiar={setVista}
            opciones={[{ id: 'total', label: 'Total' }, { id: 'cerveza', label: 'Cerveza' }, { id: 'kombucha', label: 'Kombucha' }]}
          />
        }
      >
        <div className="flex flex-col gap-3 border-t border-(--p-line-2) px-5 py-4">
          {t.filas.map(f => {
            const venta = dato(f, 'escenario')
            const sobre = venta > capacidadCiclo
            return (
              <div key={f.mes} className="grid grid-cols-[92px_minmax(0,1fr)_88px] items-center gap-3">
                <span className="text-sm font-bold text-(--p-text)">{nombreCiclo(f.mes)}</span>
                <div className="relative h-7 rounded-md bg-(--p-chip)" aria-label={`${nombreCiclo(f.mes)}: venta esperada ${fNum(venta)} L, capacidad ${fNum(capacidadCiclo)} L`}>
                  <div className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${(venta / escala) * 100}%`, background: sobre ? 'var(--p-bad)' : 'var(--p-accent)', opacity: 0.85 }} />
                  <div className="absolute inset-y-0 left-0 rounded-md border-2 border-dashed border-(--p-text-3)" style={{ width: `${(dato(f, 'anterior') / escala) * 100}%` }} title={`Año pasado: ${fNum(dato(f, 'anterior'))} L`} />
                  <div className="absolute -inset-y-1 w-0.5 bg-(--p-text)" style={{ left: `${(capacidadCiclo / escala) * 100}%` }} title={`Capacidad por ciclo: ${fNum(capacidadCiclo)} L`} />
                </div>
                <span className={`text-right text-sm font-bold tabular-nums ${sobre ? 'text-(--p-bad)' : 'text-(--p-text)'}`}>{fNum(venta)} L</span>
              </div>
            )
          })}
          <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-[11.5px] text-(--p-text-3)">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-(--p-accent)" />Venta esperada</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border-2 border-dashed border-(--p-text-3)" />Año pasado</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-(--p-text)" />Capacidad de planta: {fNum(capacidadCiclo)} L por ciclo</span>
          </div>
        </div>

        <div className="overflow-x-auto border-t border-(--p-line-2)">
          <table className="w-full min-w-[620px] text-[13px] tabular-nums">
            <thead className="text-left text-[10.5px] uppercase tracking-wide text-(--p-text-3)">
              <tr>
                <th className="px-5 py-2">Ciclo</th>
                <th className="px-3 py-2 text-right">Año pasado</th>
                <th className="px-3 py-2 text-right">Modelo</th>
                <th className="px-3 py-2 text-right">Escenario</th>
                <th className="px-3 py-2 text-right">vs. año pasado</th>
                <th className="px-3 py-2 text-right" title="Lotes del plan que quedan listos en ese ciclo">Programado</th>
                <th className="px-5 py-2 text-right">Capacidad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--p-line-2) text-(--p-text-2)">
              {t.filas.map(f => {
                const ant = dato(f, 'anterior'), escV = dato(f, 'escenario')
                return (
                  <tr key={f.mes}>
                    <td className="px-5 py-2 font-semibold text-(--p-text)">{nombreCiclo(f.mes)}{f.cerrado ? <span className="ml-1.5 text-[11px] font-normal text-(--p-text-3)">real</span> : null}</td>
                    <td className="px-3 py-2 text-right">{fNum(ant)}</td>
                    <td className="px-3 py-2 text-right">{fNum(dato(f, 'modelo'))}</td>
                    <td className="px-3 py-2 text-right font-bold text-(--p-text)">{fNum(escV)}</td>
                    <td className="px-3 py-2 text-right">{ant > 0 ? pct(escV / ant - 1) : '—'}</td>
                    <td className={`px-3 py-2 text-right ${dato(f, 'programado') === 0 ? 'text-(--p-text-4)' : ''}`}>{fNum(dato(f, 'programado'))}</td>
                    <td className="px-5 py-2 text-right">{fNum(capacidadCiclo)}</td>
                  </tr>
                )
              })}
              <tr className="font-bold text-(--p-text)">
                <td className="px-5 py-2">Temporada</td>
                <td className="px-3 py-2 text-right">{fNum(t.filas.reduce((a, f) => a + dato(f, 'anterior'), 0))}</td>
                <td className="px-3 py-2 text-right">{fNum(t.filas.reduce((a, f) => a + dato(f, 'modelo'), 0))}</td>
                <td className="px-3 py-2 text-right">{fNum(t.filas.reduce((a, f) => a + dato(f, 'escenario'), 0))}</td>
                <td className="px-3 py-2 text-right">{(() => { const a = t.filas.reduce((s, f) => s + dato(f, 'anterior'), 0); return a > 0 ? pct(t.filas.reduce((s, f) => s + dato(f, 'escenario'), 0) / a - 1) : '—' })()}</td>
                <td className="px-3 py-2 text-right">{fNum(t.filas.reduce((a, f) => a + dato(f, 'programado'), 0))}</td>
                <td className="px-5 py-2 text-right">{fNum(capacidadCiclo * t.filas.length)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Seccion>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Balance por línea ── */}
        <Seccion titulo={`Balance de hoy al ${fFecha(t.finTemporada)}`} detalle="Venta esperada desde hoy al cierre contra lo que hay en cámaras y tanques y lo programado. Lo que falta se cuenta producto por producto (lo que sobra de uno no cubre a otro) e incluye llegar al cierre con el colchón de seguridad, así que no es la resta directa.">
          <div className="grid grid-cols-1 gap-px border-t border-(--p-line-2) bg-(--p-line-2) sm:grid-cols-2">
            {(['cerveza', 'kombucha'] as const).map(cat => {
              const b = t.balance[cat]
              const c = t.capacidad[cat]
              const ciclosPlanta = c.porCiclo > 0 ? b.faltante / c.porCiclo : null
              return (
                <div key={cat} className="flex flex-col gap-2 bg-(--p-card) px-5 py-4">
                  <p className="prod-eyebrow">{cat === 'cerveza' ? 'Cerveza' : 'Kombucha'}</p>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px] tabular-nums">
                    <dt className="text-(--p-text-3)">Venta esperada</dt><dd className="text-right font-semibold text-(--p-text)">{fNum(b.venta)} L</dd>
                    <dt className="text-(--p-text-3)">En cámaras y tanques</dt><dd className="text-right text-(--p-text-2)">− {fNum(b.stock)} L</dd>
                    <dt className="text-(--p-text-3)">Programado</dt><dd className="text-right text-(--p-text-2)">− {fNum(b.programado)} L</dd>
                    <dt className="border-t border-(--p-line-2) pt-1 font-bold text-(--p-text)">Falta producir</dt>
                    <dd className={`border-t border-(--p-line-2) pt-1 text-right text-base font-black ${b.faltante > 0 ? 'text-(--p-bad)' : 'text-(--p-ok)'}`}>{fNum(b.faltante)} L</dd>
                  </dl>
                  <p className="text-xs leading-relaxed text-(--p-text-3)">
                    {c.tanques} {pl(c.tanques, 'fermentador', 'fermentadores')} de {fNum(c.litros)} L con {c.diasFermentacion} días de fermentación: hasta {fNum(c.porCiclo)} L por ciclo.
                    {ciclosPlanta != null && b.faltante > 0 ? ` Lo que falta equivale a ${ciclosPlanta.toLocaleString('es-CL', { maximumFractionDigits: 1 })} ${ciclosPlanta >= 0.95 && ciclosPlanta < 1.05 ? 'ciclo' : 'ciclos'} de planta llena.` : ''}
                  </p>
                </div>
              )
            })}
          </div>
        </Seccion>

        {/* ── Primeros quiebres ── */}
        <Seccion
          titulo="Lo que se queda sin stock en la temporada"
          detalle="Formatos cuyo stock (con lo que está en tanque) no llega al cierre, el primero arriba. Programa la cocción antes de la fecha límite."
        >
          {t.quiebres.length === 0 ? (
            <p className="mx-5 mb-5 rounded-xl bg-(--p-ok-soft) px-4 py-3 text-sm font-semibold text-(--p-ok)">Con este escenario ningún formato se queda sin stock antes del {fFecha(t.finTemporada)}.</p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-(--p-line-2) overflow-y-auto overscroll-contain border-t border-(--p-line-2)">
              {t.quiebres.map(q => {
                const atrasado = q.fechaLimiteCocer != null && q.fechaLimiteCocer <= seguimientoLotes.hoy
                return (
                  <li key={`${q.producto}-${q.familia}`} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                    <ProductImage nombre={q.producto} categoria={q.categoria} size={28} radius={7} />
                    <div className="min-w-[150px] flex-1">
                      <p className="text-[13px] font-bold leading-tight text-(--p-text)">{q.producto} <span className="font-normal text-(--p-text-3)">· {FAMILIA_LABEL[q.familia].toLowerCase()}{q.lineaFija ? ' · línea fija' : ''}</span></p>
                      <p className="text-xs text-(--p-text-3)">
                        Sin stock el <strong className="text-(--p-text-2)">{fFecha(q.fechaQuiebre)}</strong>
                        {q.fechaLimiteCocer ? <> · {atrasado ? <span className="font-semibold text-(--p-bad)">había que cocinar antes del {fFecha(q.fechaLimiteCocer)}</span> : <>cocinar antes del {fFecha(q.fechaLimiteCocer)}</>}</> : null}
                      </p>
                    </div>
                    <ChipEstado estado={q.estado} compacto />
                    <button type="button" disabled={guardandoPlan} onClick={() => programarDesdeCobertura(q.cobertura)} className="prod-press prod-accion flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold">
                      <CalendarPlus size={13} />Programar
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Seccion>
      </div>

      <section className="prod-card p-4">
        <ComoSeCalcula>
          <p><strong>Escenarios conservador, base y optimista.</strong> Salen de un backtest (scripts/analisis/backtest_v2_produccion.py): se volvió a pronosticar 12 veces el último año, de 1 a 4 ciclos adelante, y se comparó con lo que se vendió. Base corrige el forecast por su sesgo medido, que depende de la estación (fuera de temporada se pasa ~14%, en temporada se queda corto ~14%). Conservador y optimista son el P10 y el P90 del error real por horizonte: 8 de cada 10 veces la venta cayó entre los dos.</p>
          <p><strong>Año pasado ±%</strong> fija la venta de los ciclos de la temporada que todavía no empiezan en la del año anterior más el porcentaje. <strong>Modelo sin corregir</strong> es el forecast tal cual. La venta del ciclo en curso es siempre la real.</p>
          <p><strong>Año pasado</strong> es la venta real de los mismos ciclos (24 al 23) de la temporada anterior, por producto. Los productos fuera de producción cuentan en la venta histórica y en el modelo, pero no generan quiebres ni producción.</p>
          <p><strong>Programado</strong> suma los lotes planificados desde hoy en el ciclo en que quedan listos (fecha de cocción + días de fermentación). Los lotes en curso no se suman aparte porque su líquido ya está en los tanques del informe de stock; los planificados con fecha pasada que nadie confirmó tampoco.</p>
          <p><strong>Falta producir</strong> es, por producto y formato, la venta hasta el cierre más el colchón de seguridad menos lo disponible (cámaras + tanques), descontando lo programado de ese producto. Es el mismo cálculo de &quot;A producir&quot; en Plan con &quot;Cubrir hasta&quot; en el cierre de la temporada.</p>
          <p><strong>Capacidad</strong> = litros de los fermentadores de la línea (sin bright tank ni los de laboratorio) × 30 días ÷ (días de fermentación + 2 días de limpieza y llenado). Es un techo: supone que ningún tanque queda vacío.</p>
          <p><strong>Quiebres</strong> salen del mismo motor que Hoy y Plan: el stock se descuenta día hábil a día hábil con la venta de cada ciclo, así que la subida de diciembre adelanta las fechas.</p>
        </ComoSeCalcula>
      </section>
    </div>
  )
}
