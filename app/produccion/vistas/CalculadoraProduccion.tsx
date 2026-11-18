'use client'

import { useMemo, useState } from 'react'
import ProductImage from '@/components/ui/ProductImage'
import { CalendarPlus, Factory, AlertTriangle } from 'lucide-react'
import { calcularCobertura, sumarDiasHabilesISO, diasHabilesEntre } from '@/lib/produccion/cobertura'
import { recomendarLotes } from '@/lib/produccion/calculadora'
import { FAMILIA_LABEL, familiaEnvase, finDeCiclo, estaFueraDeProduccion, type EnvaseBucket } from '@/lib/produccion/reglas'
import { fNum, hoyLocalISO, pl } from '../compartido'
import { Seccion, fFecha } from './ui'
import SelectorEscenario from './SelectorEscenario'
import type { Produccion } from '../useProduccion'

/**
 * "¿Cuánto producir?" (17-nov-2026): la pregunta de todos los días, contestada
 * en frases y no filtrando un gráfico. Se elige un producto y hasta cuándo hay
 * que llegar cubierto; responde:
 *   1. cuánto hay hoy (en cámara y en tanque),
 *   2. hasta cuándo dura, al ritmo de venta actual y con el escenario elegido,
 *   3. cuánto producir para llegar a la fecha con el colchón intacto,
 *   4. cuándo hay que empezar a cocinar y en qué fermentador(es).
 * La cantidad sale del mismo motor que Plan y Hoy (lib/produccion/cobertura.ts),
 * los tanques de lib/produccion/calculadora.ts.
 */
export default function CalculadoraProduccion({ p }: { p: Produccion }) {
  const { colchonesCobertura, seriesProductoEnvase, avanceMes, escenario, escenarios, escenarioId, bloquesGantt, fermentadoresGantt, configGantt, programarDesdeCobertura, guardandoPlan, temporada } = p
  const hoy = hoyLocalISO()

  // Productos que se pueden calcular: los que tienen colchón, línea fija primero.
  const productos = useMemo(() => {
    const m = new Map<string, 'cerveza' | 'kombucha'>()
    for (const c of colchonesCobertura) if (!estaFueraDeProduccion(c.producto)) m.set(c.producto, c.categoria)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [colchonesCobertura])
  const [producto, setProducto] = useState('')
  const elegido = producto || p.coberturaProductos[0]?.producto || productos[0]?.[0] || ''

  // Atajos de fecha: fin de este ciclo y de los ciclos de la temporada.
  const atajos = useMemo(() => {
    const meses = [avanceMes.mes, ...temporada.meses.filter(m => m > avanceMes.mes)]
    return meses.map(m => ({ fecha: finDeCiclo(m), label: m === avanceMes.mes ? 'Este ciclo' : fFecha(finDeCiclo(m)) }))
  }, [avanceMes.mes, temporada.meses])
  const [hasta, setHasta] = useState('')
  const hastaActivo = hasta || atajos[Math.min(3, atajos.length - 1)]?.fecha || finDeCiclo(avanceMes.mes)

  const r = useMemo(() => {
    if (!elegido) return null
    const series = seriesProductoEnvase.filter(s => s.producto === elegido)
    const colchones = colchonesCobertura.filter(c => c.producto === elegido)
    const cob = calcularCobertura(series, colchones, avanceMes, { hoyISO: hoy, hastaISO: hastaActivo, factorDemanda: escenario })[0]
    if (!cob) return null
    const habilesHasta = Math.max(1, diasHabilesEntre(sumarDiasHabilesISO(hoy, 1), hastaActivo))

    // Al ritmo actual: lo que va del ciclo en días hábiles, sin forecast.
    const familias = cob.familias.map(f => {
      const ritmoActual = series
        .filter(s => familiaEnvase(s.envaseBucket as EnvaseBucket) === f.familia)
        .reduce((a, s) => a + (avanceMes.diasHabilesTranscurridos > 0 ? s.litrosMesEnCurso / avanceMes.diasHabilesTranscurridos : 0), 0)
      const dias = f.disponibleLitros != null && ritmoActual > 0 ? f.disponibleLitros / ritmoActual : null
      const aProducirRitmo = f.disponibleLitros != null ? Math.max(0, Math.round(ritmoActual * habilesHasta + f.stockSeguridadLitros - f.disponibleLitros)) : null
      return { ...f, ritmoActual, duraRitmo: dias != null ? sumarDiasHabilesISO(hoy, dias) : null, aProducirRitmo }
    })
    const disponible = familias.reduce((a, f) => a + (f.disponibleLitros ?? 0), 0)
    const enTanque = familias.reduce((a, f) => a + f.enProduccionLitros, 0)
    const aProducirRitmo = familias.reduce((a, f) => a + (f.aProducirRitmo ?? 0), 0)
    const quiebre = familias.map(f => f.fechaQuiebre).filter((x): x is string => x != null).sort()[0] ?? null

    const conf = configGantt.find(c => c.producto === elegido)
    const diasFerm = conf?.diasFermentacion ?? (cob.categoria === 'kombucha' ? 12 : 24)
    const lotes = recomendarLotes(
      cob.aProducirLitros, cob.categoria,
      fermentadoresGantt.map(f => ({ nombre: f.nombre, categoria: f.categoria, capacidadLitros: f.capacidadLitros })),
      bloquesGantt.map(b => ({ fermentador: b.fermentador, inicioISO: b.inicioISO, dias: b.dias, tipo: b.tipo })),
      hoy, diasFerm, quiebre ?? hastaActivo,
    )
    return { cob, familias, disponible, enTanque, aProducirRitmo, quiebre, lotes, diasFerm }
  }, [elegido, seriesProductoEnvase, colchonesCobertura, avanceMes, hoy, hastaActivo, escenario, configGantt, fermentadoresGantt, bloquesGantt])

  const nombreEsc = (escenarios.find(e => e.id === escenarioId)?.label ?? '').toLowerCase()
  const atrasado = r?.cob.fechaLimiteCocer != null && r.cob.fechaLimiteCocer <= hoy

  return (
    <Seccion
      titulo="¿Cuánto producir?"
      detalle="Elige un producto y hasta cuándo quieres llegar cubierto: te digo cuánto hay, cuánto dura, cuánto cocinar, cuándo y dónde."
      accion={<SelectorEscenario p={p} />}
    >
      <div className="flex flex-col gap-4 border-t border-(--p-line-2) px-5 py-4">
        {/* Pregunta */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-(--p-text-2)">
          <span>¿Cuánto</span>
          <select
            id="calc-producto"
            value={elegido}
            onChange={e => setProducto(e.target.value)}
            className="max-w-[260px] rounded-lg border border-(--p-line) bg-(--p-card-2) px-2.5 py-1.5 text-sm font-bold text-(--p-text) focus:border-(--p-accent) focus:outline-none"
          >
            {(['cerveza', 'kombucha'] as const).map(cat => (
              <optgroup key={cat} label={cat === 'cerveza' ? 'Cerveza' : 'Kombucha'}>
                {productos.filter(([, c]) => c === cat).map(([nombre]) => <option key={nombre} value={nombre}>{nombre}</option>)}
              </optgroup>
            ))}
          </select>
          <span>tengo que hacer para llegar al</span>
          <div role="group" aria-label="Cubrir hasta" className="flex flex-wrap gap-1.5">
            {atajos.map(a => (
              <button
                key={a.fecha}
                type="button"
                aria-pressed={hastaActivo === a.fecha}
                onClick={() => setHasta(a.fecha)}
                className={`prod-press rounded-full border px-3 py-1.5 text-xs font-bold ${hastaActivo === a.fecha ? 'border-(--p-accent-line) bg-(--p-accent-soft) text-(--p-accent)' : 'border-(--p-line) text-(--p-text-3) hover:text-(--p-text)'}`}
              >
                {a.label}
              </button>
            ))}
            <input
              id="calc-hasta"
              type="date"
              value={hastaActivo}
              min={hoy}
              onChange={e => e.target.value && setHasta(e.target.value)}
              aria-label="Otra fecha"
              className="rounded-full border border-(--p-line) bg-(--p-card-2) px-3 py-1 text-xs font-bold text-(--p-text-2) focus:border-(--p-accent) focus:outline-none"
            />
          </div>
          <span>?</span>
        </div>

        {!r ? (
          <p className="rounded-xl bg-(--p-chip) px-4 py-3 text-sm text-(--p-text-3)">No hay stock ni forecast para este producto.</p>
        ) : (
          // key: al cambiar de producto o fecha la respuesta se reemplaza con un fundido corto.
          <div key={`${elegido}|${hastaActivo}|${escenarioId}`} className="prod-enter grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            {/* Respuesta en frases */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <ProductImage nombre={elegido} categoria={r.cob.categoria} size={40} radius={9} />
                <p className="text-[15px] leading-snug text-(--p-text-2)">
                  Hoy hay <strong className="text-(--p-text)">{fNum(r.disponible)} L</strong> de {elegido}
                  {r.enTanque > 0 ? <> ({fNum(r.disponible - r.enTanque)} L en cámara y {fNum(r.enTanque)} L todavía en tanque)</> : null}.
                </p>
              </div>

              <ul className="flex flex-col gap-2">
                {r.familias.map(f => (
                  <li key={f.familia} className="rounded-xl border border-(--p-line-2) bg-(--p-card-2) px-4 py-3 text-[13.5px] leading-relaxed text-(--p-text-2)">
                    <p className="prod-eyebrow mb-1">{FAMILIA_LABEL[f.familia]} · {fNum(f.disponibleLitros ?? 0)} L</p>
                    {f.ritmoActual > 0 ? (
                      <p>
                        Al ritmo de venta actual ({fNum(f.ritmoActual)} L por día hábil) dura hasta el <strong className="text-(--p-text)">{fFecha(f.duraRitmo)}</strong>.
                      </p>
                    ) : <p>Sin ventas en lo que va del ciclo.</p>}
                    <p>
                      Con el escenario {nombreEsc} {f.fechaQuiebre
                        ? <>dura hasta el <strong className="text-(--p-text)">{fFecha(f.fechaQuiebre)}</strong>.</>
                        : <>alcanza más allá del último mes proyectado.</>}
                    </p>
                    <p className="mt-1 text-(--p-text-3)">
                      Para llegar al {fFecha(hastaActivo)} con su colchón de {fNum(f.stockSeguridadLitros)} L: producir{' '}
                      <strong className={f.aProducirLitros > 0 ? 'text-(--p-text)' : 'text-(--p-ok)'}>{fNum(f.aProducirLitros)} L</strong>
                      {f.aProducirRitmo != null && f.aProducirRitmo !== f.aProducirLitros && <> (al ritmo actual serían {fNum(f.aProducirRitmo)} L)</>}.
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            {/* Decisión: cuánto, cuándo y dónde */}
            <div className="flex flex-col gap-3 rounded-xl border border-(--p-accent-line) bg-(--p-accent-soft) px-4 py-4">
              <p className="prod-eyebrow text-(--p-accent)!">Hay que producir</p>
              <p className="prod-cifra text-[34px] font-extrabold leading-none text-(--p-text)">
                {fNum(r.cob.aProducirLitros)} <span className="text-base font-bold text-(--p-text-3)">L</span>
              </p>
              <p className="text-xs leading-snug text-(--p-text-3)">
                Escenario {nombreEsc}, hasta el {fFecha(hastaActivo)}.{r.aProducirRitmo !== r.cob.aProducirLitros ? ` Al ritmo actual: ${fNum(r.aProducirRitmo)} L.` : ''}
              </p>

              {r.cob.aProducirLitros > 0 && (
                <>
                  <p className={`flex items-start gap-1.5 text-[13.5px] font-semibold ${atrasado ? 'text-(--p-bad)' : 'text-(--p-text-2)'}`}>
                    {atrasado && <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
                    {r.cob.fechaLimiteCocer
                      ? atrasado
                        ? `Había que empezar a cocinar antes del ${fFecha(r.cob.fechaLimiteCocer)}: cocinar ya.`
                        : `Empezar a cocinar antes del ${fFecha(r.cob.fechaLimiteCocer)}${r.cob.fechaLimiteInsumos ? ` (insumos pedidos antes del ${fFecha(r.cob.fechaLimiteInsumos)})` : ''}.`
                      : 'El stock alcanza más allá del forecast: no hay fecha límite.'}
                  </p>

                  {r.lotes.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <p className="prod-eyebrow">{r.lotes.length === 1 ? 'Fermentador recomendado' : `En ${r.lotes.length} lotes`}</p>
                      {r.lotes.map(l => (
                        <div key={l.tanque} className="flex items-center gap-2.5 rounded-lg bg-(--p-card) px-3 py-2 text-[13px]">
                          <Factory size={15} className="shrink-0 text-(--p-accent)" />
                          <span className="min-w-0 flex-1 leading-snug text-(--p-text-2)">
                            <strong className="text-(--p-text)">{l.tanque.replace(/^Fermentador /, '')}</strong> ({fNum(l.capacidadLitros)} L): {fNum(l.litros)} L
                            {l.inicioISO > hoy ? `, libre desde el ${fFecha(l.inicioISO)}` : ', libre hoy'} · listo el{' '}
                            <span className={l.tarde ? 'font-bold text-(--p-bad)' : ''}>{fFecha(l.listoISO)}</span>
                            {l.tarde && ' (llega después del quiebre)'}
                          </span>
                        </div>
                      ))}
                      <p className="text-[11.5px] text-(--p-text-3)">
                        {r.diasFerm} días de fermentación. Elige el que se libera antes y, a igual fecha, el que menos capacidad desperdicia{r.lotes.length > 1 ? `; ningún tanque solo alcanza para ${fNum(r.cob.aProducirLitros)} L` : ''}.
                      </p>
                      {(() => {
                        const resto = r.cob.aProducirLitros - r.lotes.reduce((a, l) => a + l.litros, 0)
                        return resto > 0 ? (
                          <p className="text-[12px] font-semibold text-(--p-warn)">
                            Faltan {fNum(resto)} L más: no caben en los próximos {r.lotes.length} lotes. Habrá que agendar otra tanda cuando se libere un tanque.
                          </p>
                        ) : null
                      })()}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={guardandoPlan}
                    onClick={() => programarDesdeCobertura(r.cob)}
                    className="prod-press prod-primario mt-1 flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-extrabold"
                  >
                    <CalendarPlus size={16} />
                    Programar {pl(r.lotes.length || 1, 'cocción', 'cocciones')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Seccion>
  )
}
