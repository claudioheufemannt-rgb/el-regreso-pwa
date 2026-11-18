'use client'

import React from 'react'
import ProductImage from '@/components/ui/ProductImage'
import { Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceArea, ResponsiveContainer, ComposedChart, Line, Area } from 'recharts'
import { Sigma } from 'lucide-react'
import { COLORS } from '../tema'
import { factorDe } from '@/lib/produccion/cobertura'
import { CANALES } from '@/lib/produccion/canales'
import { ENVASE_LABEL, inicioDeCiclo, finDeCiclo, estaFueraDeProduccion, type EnvaseBucket } from '@/lib/produccion/reglas'
import { fNum, fPesos, fPesosCorto, etiquetaMes, fCicloCorto, ChipDesviacion, pl } from '../compartido'
import { Seccion, Pastillas } from './ui'
import SelectorEscenario from './SelectorEscenario'
import type { Produccion } from '../useProduccion'

/** Demanda: cuánto vamos a vender, por producto y formato (forecast mensual
 *  por ciclo 24→23). La calculadora de cobertura que vivía acá pasó a Plan,
 *  donde ahora hay un solo cálculo de cuánto producir. */
export default function TabDemanda({ p }: { p: Produccion }) {
  // Factor del escenario elegido por ciclo, al nivel producto × formato.
  const factor = p.factorPara('producto_envase')
  const nombreEscenario = p.escenarios.find(e => e.id === p.escenarioId)?.label ?? ''
  // Categoría de cada producto, para agrupar el selector.
  const categoriaDe = new Map(p.series.filter(x => x.nivel === 'producto' && x.producto && x.categoria).map(x => [x.producto as string, x.categoria as string]))
  // Próximos 4 ciclos con forecast (después del en curso).
  const mesesTabla = [...new Set(p.series.flatMap(x => x.puntos.filter(pt => pt.tipo === 'forecast' && pt.mes > p.avanceMes.mes).map(pt => pt.mes)))].sort().slice(0, 4)
  const esTemporada = (m: string) => ['12', '01', '02', '03'].includes(m.slice(5, 7))
  // La tabla sigue a los filtros de arriba (antes tenía los suyos propios).
  const filasTabla = p.filasTablaDetalle.filter(({ serie }) =>
    (p.filtroCategoriaForecast === 'todas' || serie.categoria === p.filtroCategoriaForecast)
    && (p.filtroEnvaseForecast === 'todos' || serie.envaseBucket === p.filtroEnvaseForecast)
    && (!p.filtroProductoForecast || serie.producto === p.filtroProductoForecast))
  const { avanceMes, verModelo, setVerModelo, filtroCategoriaForecast, filtroEnvaseForecast, setFiltroEnvaseForecast, filtroProductoForecast, setFiltroProductoForecast, productosForecastDisponibles, envasesForecastDisponibles, serieActual, cambiarCategoriaForecast, monedaForecast, setMonedaForecast, precioNeto, verNeto, kMoneda, fUnidad, valorSerie, unidadEnvaseSerieActual, chartData, hayDescomposicion, descomposicionProximo, curvaEstacional, ecuacionModelo, tramosTemporadaAlta, precisionSerie } = p
  return (
            // h-full (no min-h-full) forzaba esta columna a la altura exacta
            // del viewport: con sólo filtros+gráfico entraba justo, pero al
            // agregar la tabla de detalle abajo, flexbox la comprimía a 0px
            // en vez de dejar crecer la columna y que el contenedor de más
            // arriba (flex-1 overflow-auto) scrolleara — confirmado con el
            // computed height de la tarjeta de la tabla: 35px de alto,
            // wrapper interno en 0px pese a tener 94 filas en el DOM.
            <div className="prod-enter flex min-h-full flex-col gap-6">
              {/* Filtros en UNA barra (17-nov-2026): antes eran tres filas de
                  pastillas, con 23 productos, y el gráfico quedaba bajo el
                  pliegue. Categoría y formato siguen como pastillas (pocas
                  opciones); el producto pasa a un selector agrupado por línea.
                  Categoría acota qué productos y formatos se ofrecen; producto
                  y formato se combinan para llegar a la serie exacta. */}
              <div className="prod-card flex flex-col divide-y divide-(--p-line-2)">
              {/* Tipo de cliente (18-nov-2026): con un canal elegido el gráfico
                  muestra ese canal con todos los productos juntos, así que los
                  filtros de producto se apagan (no hay forecast por canal y
                  producto a la vez). */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <span className="text-xs font-semibold text-(--p-text-3)">Tipo de cliente</span>
                <Pastillas<string>
                  etiqueta="Tipo de cliente"
                  valor={p.filtroCanal}
                  onCambiar={v => p.setFiltroCanal(v as typeof p.filtroCanal)}
                  opciones={[{ id: 'todos', label: 'Todos' }, ...CANALES.map(c => ({ id: c.id as string, label: c.label }))]}
                />
                <div className="order-last ml-auto"><SelectorEscenario p={p} /></div>
                {p.serieCanal && (
                  <span className="text-xs text-(--p-text-3)">
                    {CANALES.find(c => c.id === p.filtroCanal)?.ayuda}.
                    {p.serieCanal.pesoProximo != null ? ` Se proyecta como el ${Math.round(p.serieCanal.pesoProximo * 100)}% de la venta del próximo ciclo.` : ''}
                  </span>
                )}
              </div>
              <div className={`flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 ${p.serieCanal ? 'pointer-events-none opacity-40' : ''}`} aria-disabled={!!p.serieCanal} inert={!!p.serieCanal}>
                <Pastillas
                  etiqueta="Categoría"
                  valor={filtroCategoriaForecast}
                  onCambiar={cambiarCategoriaForecast}
                  opciones={[{ id: 'todas', label: 'Todo' }, { id: 'cerveza', label: 'Cerveza' }, { id: 'kombucha', label: 'Kombucha' }]}
                />
                <span className="hidden h-5 w-px bg-(--p-line) md:block" />
                <Pastillas<string>
                  etiqueta="Formato"
                  valor={filtroEnvaseForecast}
                  onCambiar={v => setFiltroEnvaseForecast(v as 'todos' | EnvaseBucket)}
                  opciones={[{ id: 'todos', label: 'Todos los formatos' }, ...envasesForecastDisponibles.map(b => ({ id: b as string, label: ENVASE_LABEL[b] }))]}
                />
                <span className="hidden h-5 w-px bg-(--p-line) md:block" />
                <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-(--p-text-3)">
                  Producto
                  <select
                    id="demanda-producto"
                    value={filtroProductoForecast ?? ''}
                    onChange={e => setFiltroProductoForecast(e.target.value || null)}
                    className="min-w-0 max-w-[240px] rounded-lg border border-(--p-line) bg-(--p-card-2) px-2.5 py-1.5 text-sm font-bold text-(--p-text) focus:border-(--p-accent) focus:outline-none"
                  >
                    <option value="">Todos (consolidado)</option>
                    {(['cerveza', 'kombucha'] as const).map(cat => {
                      const lista = productosForecastDisponibles.filter(x => categoriaDe.get(x) === cat)
                      return lista.length > 0 ? (
                        <optgroup key={cat} label={cat === 'cerveza' ? 'Cerveza' : 'Kombucha'}>
                          {lista.map(x => <option key={x} value={x}>{x}</option>)}
                        </optgroup>
                      ) : null
                    })}
                    {productosForecastDisponibles.filter(x => !categoriaDe.has(x)).map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
              </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_272px]">
              {/* Gráfico */}
              <div className="flex flex-col rounded-xl border border-(--p-line) bg-(--p-card) p-4 shadow-sm lg:p-6">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[17px] font-bold tracking-[-0.01em] text-(--p-text)">
                      {serieActual?.label ?? 'Consolidado'}: venta real y proyectada
                    </h3>
                    <p className="mt-1 text-[13px] text-(--p-text-3)">
                      {verNeto ? 'Neto a precio de hoy' : 'Litros'} por ciclo · {serieActual?.mesesHistorial ?? chartData.filter(d => d.ventaReal != null).length} meses de historia · la franja sombreada es la temporada alta. {p.serieCanal ? 'Proyección del canal: el total proyectado repartido según su peso en el mismo ciclo del año pasado, ajustado por cómo cambió ese peso los últimos 3 ciclos.' : 'El gráfico muestra el modelo; el escenario elegido se aplica en la tabla de abajo.'}
                    </p>
                    {/* La conversión a unidades sólo aparece cuando la serie elegida
                        es un producto×envase concreto (no "todos los formatos" ni un
                        consolidado) — ahí sí hay un tamaño de envase único con el que
                        convertir litros a barriles/latas. Se aclara la base acá para
                        que el número de la tabla/tooltip no parezca sacado de la nada. */}
                    {monedaForecast === 'neto' && precioNeto == null && (
                      <p className="mt-0.5 text-xs font-semibold text-(--p-bad)">
                        No hay ventas recientes con las que valorizar esta serie: se muestra en litros.
                      </p>
                    )}
                    {verNeto && serieActual && (
                      <p className="mt-0.5 text-xs font-semibold text-(--p-text-3)">
                        Neto (sin IVA) a precio de hoy: <span className="text-(--p-text-2)">{fPesos(precioNeto!)} por litro</span>
                        {' '}— promedio ponderado de las ventas de los últimos 90 días
                        {serieActual.precioFuente === 'producto' ? ', del producto (este formato casi no vendió)' : serieActual.precioFuente === 'general' ? ', del consolidado (esta serie casi no vendió)' : serieActual.nivel === 'general' ? ' (incluye la mezcla de productos)' : ''}.
                        {' '}El historial usa ese mismo precio, para que se compare el volumen y no cambios de precio.
                      </p>
                    )}
                    {unidadEnvaseSerieActual && (
                      <p className="mt-0.5 text-xs font-semibold text-(--p-text-3)">
                        pasa el mouse por el gráfico para ver también la cantidad de {unidadEnvaseSerieActual.nombre} pronosticadas
                        {unidadEnvaseSerieActual.nombre === 'latas'
                          ? ` (≈${Math.round(unidadEnvaseSerieActual.litrosPorUnidad * 1000)} ml/lata, estimado del inventario físico)`
                          : ` (${unidadEnvaseSerieActual.litrosPorUnidad} L/barril)`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Litros ⇄ dinero neto: sólo cambia lo que se muestra (ver monedaForecast). */}
                    <div className="flex gap-0.5 rounded-lg border border-(--p-line) bg-(--p-card-2) p-0.5" role="group" aria-label="Unidad del pronóstico">
                      {([['litros', 'Litros'], ['neto', '$ Neto']] as const).map(([id, texto]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setMonedaForecast(id)}
                          aria-pressed={monedaForecast === id}
                          title={id === 'neto' ? 'Ver la proyección en dinero neto (sin IVA) a precio de hoy' : 'Ver la proyección en litros'}
                          className={`rounded-md px-3 py-1 text-sm font-bold transition-colors ${monedaForecast === id ? 'bg-(--p-card) text-(--p-text) shadow-sm' : 'text-(--p-text-3) hover:text-(--p-text-2)'}`}
                        >
                          {texto}
                        </button>
                      ))}
                    </div>
                    {/* Interruptor de la descomposición: por defecto apagado
                        para no sobrecargar la lectura rápida, pero a un clic
                        de mostrar de qué está hecha la proyección. */}
                    {hayDescomposicion && (
                      <button
                        onClick={() => setVerModelo(v => !v)}
                        aria-pressed={verModelo}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-bold transition-colors ${
                          verModelo ? 'border border-(--p-accent-line) bg-(--p-accent-soft) text-(--p-accent)' : 'border-(--p-line) bg-(--p-card) text-(--p-text-2) hover:bg-(--p-hover)'
                        }`}
                      >
                        <Sigma size={15} />
                        Ver el modelo
                      </button>
                    )}
                    {precisionSerie != null && (
                      <div className={`rounded-lg border px-3 py-1.5 text-sm font-bold ${
                        precisionSerie >= 85 ? 'border-(--p-ok-line) bg-(--p-ok-soft) text-(--p-ok)'
                          : precisionSerie >= 70 ? 'border-(--p-warn-line) bg-(--p-warn-soft) text-(--p-warn)'
                            : 'border-(--p-bad-line) bg-(--p-bad-soft) text-(--p-bad)'
                      }`}>
                        Precisión del modelo: {precisionSerie.toFixed(0)}%
                      </div>
                    )}
                  </div>
                </div>

                {/* Función matemática del modelo, con las constantes de ESTA
                    corrida — para que quede claro que la proyección sale de
                    una función real, no de una regla de tres, y que esa
                    función cambia sola cuando el modelo se reentrena. */}
                {verModelo && ecuacionModelo && (
                  <div className="mb-4 rounded-xl border border-(--p-line) bg-(--p-card) p-4 shadow-sm">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-(--p-text-3)">
                      Función del modelo
                    </p>
                    <p className="mt-1.5 overflow-x-auto whitespace-nowrap font-mono text-base font-bold text-(--p-text) sm:text-lg">
                      y(t) = g(t) + s(t) + ε<sub>t</sub>
                    </p>
                    <div className="mt-3 flex flex-col gap-1.5 border-t border-(--p-line-2) pt-3 font-mono text-sm text-(--p-text-2)">
                      <p className="overflow-x-auto whitespace-nowrap">
                        g(t) = {fNum(ecuacionModelo.m)} {ecuacionModelo.k >= 0 ? '+' : '−'} {Math.abs(ecuacionModelo.k).toFixed(1)}·t
                      </p>
                      <p className="overflow-x-auto whitespace-nowrap">
                        s(t) ≈ {fNum(ecuacionModelo.A)}·sin(2π·t/12 {ecuacionModelo.fase >= 0 ? '+' : '−'} {Math.abs(ecuacionModelo.fase).toFixed(2)})
                      </p>
                    </div>
                    <p className="mt-3 text-xs leading-snug text-(--p-text-3)">
                      t = meses desde {etiquetaMes(ecuacionModelo.t0mes)} (t=0). g(t) es la tendencia exacta que usa
                      el modelo para proyectar — sale del tramo lineal posterior al último <em>changepoint</em>, no de
                      un ajuste a mano. s(t) es una aproximación de un solo armónico a la estacionalidad de Fourier
                      real de Prophet, para que la fórmula sea legible. Sin componente de feriados (h(t)): este
                      modelo no los usa. Las constantes se recalculan solas en cada corrida del modelo.
                      {verNeto && ' La función está en litros: el modelo trabaja en litros y el dinero es litros × precio neto por litro.'}
                    </p>
                  </div>
                )}

                {/* Ecuación del modelo, con los números del mes proyectado.
                    Es la parte que hace evidente que la línea verde no es una
                    regla de tres: sale de dos componentes que Prophet estima
                    por separado sobre el historial y después suma. */}
                {verModelo && descomposicionProximo && (
                  <div className="mb-5 flex flex-wrap items-stretch gap-3 rounded-xl border border-(--p-line) bg-(--p-card-2)/70 p-4">
                    <div className="min-w-[190px] flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-(--p-text-3)">Tendencia</p>
                      <p className="text-xl font-black tabular-nums" style={{ color: COLORS.primarioSuave }}>
                        {fUnidad(descomposicionProximo.tendencia)}
                      </p>
                      <p className="mt-0.5 text-xs leading-snug text-(--p-text-3)">
                        Hacia dónde va el negocio, sin el efecto del mes. Se ajusta con
                        <em> changepoints</em>: quiebres de pendiente detectados en los datos.
                      </p>
                    </div>
                    <div className="flex items-center text-2xl font-light text-(--p-text-4)">+</div>
                    <div className="min-w-[190px] flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-(--p-text-3)">Estacionalidad de {etiquetaMes(descomposicionProximo.mesIso)}</p>
                      <p className="text-xl font-black tabular-nums" style={{ color: descomposicionProximo.estacionalidad >= 0 ? COLORS.contraste : COLORS.bad }}>
                        {descomposicionProximo.estacionalidad >= 0 ? '+' : '−'}{fUnidad(Math.abs(descomposicionProximo.estacionalidad))}
                      </p>
                      <p className="mt-0.5 text-xs leading-snug text-(--p-text-3)">
                        Cuánto se aparta ese mes del año respecto de la tendencia. Curva de Fourier
                        ajustada sobre {serieActual?.mesesHistorial ?? chartData.filter(d => d.ventaReal != null).length} meses.
                      </p>
                    </div>
                    <div className="flex items-center text-2xl font-light text-(--p-text-4)">=</div>
                    <div className="min-w-[150px] flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-(--p-text-3)">Proyección</p>
                      <p className="text-xl font-black tabular-nums" style={{ color: COLORS.primario }}>
                        {fUnidad(descomposicionProximo.tendencia + descomposicionProximo.estacionalidad)}
                      </p>
                      <p className="mt-0.5 text-xs leading-snug text-(--p-text-3)">
                        El rango sombreado es el intervalo de predicción al 80%: 4 de cada 5 meses
                        deberían caer dentro.
                      </p>
                    </div>
                  </div>
                )}

                {/* Altura fija en vez de heredada por flex/min-height: Recharts
                    necesita que ALGÚN ancestro tenga una altura resuelta en
                    píxeles para poder calcular su height="100%" — una cadena
                    de flex-1/min-height no se lo garantiza (se rompió al
                    cambiar el wrapper de la pestaña de h-full a min-h-full
                    para la tabla de abajo: el SVG dejó de dibujarse, 0px). */}
                <div className="relative h-[360px] w-full">
                  {chartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-(--p-text-3)">
                      Todavía no hay una corrida del modelo. Se genera automáticamente el día 24 de cada mes.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                        <defs>
                          {/* El intervalo se desvanece hacia abajo en vez de
                              ser un bloque plano: se lee como incertidumbre,
                              no como una segunda serie de datos. */}
                          <linearGradient id="gradRango" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={COLORS.primario} stopOpacity={0.22} />
                            <stop offset="100%" stopColor={COLORS.primario} stopOpacity={0.04} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={COLORS.rejilla} />
                        <XAxis
                          dataKey="month" axisLine={false} tickLine={false} minTickGap={24}
                          tick={{ fill: COLORS.eje, fontSize: 12, fontWeight: 600 }} dy={10}
                        />
                        <YAxis
                          axisLine={false} tickLine={false} tick={{ fill: COLORS.eje, fontSize: 12 }} dx={-6}
                          width={verNeto ? 72 : undefined}
                          tickFormatter={(v: number) => (verNeto ? fPesosCorto(v) : v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toLocaleString('es-CL', { maximumFractionDigits: 1 })}k` : String(Math.round(v)))}
                        />
                        {/* Tooltip a medida: en el mes ancla (el último real,
                            donde arranca la línea de proyección) "Venta Real",
                            "Venta Proyectada" y "Ritmo proyectado" quedan con
                            el MISMO número a propósito, sólo para que esas
                            tres líneas conecten visualmente ahí — mostrar los
                            tres en el tooltip como si fueran datos distintos
                            confunde (se ve como si el modelo hubiera
                            "proyectado" un mes que ya cerró). Se ocultan las
                            dos entradas redundantes en ese punto puntual. */}
                        {/* La etiqueta "Ago '26" es el mes Y AÑO (Agosto,
                            2026) — el '26 es el año abreviado, no un día del
                            mes. Como el ciclo real corre 24→23 y no calendario
                            (ver lib/produccion/reglas.ts), eso generó
                            confusión real ("¿por qué a veces aparece 25 o 26
                            del mes?", cuando en realidad eran años distintos
                            en distintos puntos del historial). Se agrega el
                            rango de fechas exacto del ciclo debajo del mes
                            para que no quede ambigüedad. */}
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload || payload.length === 0) return null
                            const fila = payload[0]?.payload as (typeof chartData)[number] | undefined
                            const esAncla = !!fila && fila.ventaReal != null && fila.ventaProyectada != null && fila.mesIso !== avanceMes.mes
                            const visibles = payload.filter(entrada => {
                              if (entrada.value == null) return false
                              if (esAncla && (entrada.dataKey === 'ventaProyectada' || entrada.dataKey === 'ritmo')) return false
                              return true
                            })
                            if (visibles.length === 0) return null
                            return (
                              <div className="rounded-lg bg-(--p-card) px-3.5 py-2.5 text-xs shadow-lg">
                                <p className="font-bold text-(--p-text-2)">{label}</p>
                                {fila && (
                                  <p className="mb-1.5 text-[11px] text-(--p-text-3)">
                                    {fCicloCorto(inicioDeCiclo(fila.mesIso))} – {fCicloCorto(finDeCiclo(fila.mesIso))}
                                  </p>
                                )}
                                {visibles.map(entrada => {
                                  const valor = entrada.value
                                  const texto = Array.isArray(valor)
                                    ? `${verNeto ? fPesos(Number(valor[0])) : fNum(Number(valor[0]))} – ${verNeto ? fPesos(Number(valor[1])) : fNum(Number(valor[1]))}${verNeto ? '' : ' L'}`
                                    : verNeto ? fPesos(Number(valor)) : `${fNum(Number(valor))} L`
                                  // Además de litros, cuántos envases son — sólo tiene sentido
                                  // para las series de demanda (no para tendencia/estacionalidad,
                                  // que son componentes del modelo, no litros vendibles) y sólo
                                  // cuando la serie elegida es un producto×envase con conversión
                                  // conocida (ver unidadEnvaseSerieActual).
                                  const mostrarUnidades = unidadEnvaseSerieActual != null &&
                                    ['ventaProyectada', 'ventaReal', 'ritmo', 'rango'].includes(String(entrada.dataKey))
                                  const unidadesTexto = mostrarUnidades
                                    ? Array.isArray(valor)
                                      ? `${fNum(Math.round(Number(valor[0]) / kMoneda / unidadEnvaseSerieActual!.litrosPorUnidad))} – ${fNum(Math.round(Number(valor[1]) / kMoneda / unidadEnvaseSerieActual!.litrosPorUnidad))} ${unidadEnvaseSerieActual!.nombre}`
                                      : `≈ ${fNum(Math.round(Number(valor) / kMoneda / unidadEnvaseSerieActual!.litrosPorUnidad))} ${unidadEnvaseSerieActual!.nombre}`
                                    : null
                                  return (
                                    <p key={String(entrada.dataKey)} style={{ color: entrada.color }} className="font-semibold">
                                      {entrada.name}: {texto}
                                      {unidadesTexto && <span className="ml-1 font-normal text-(--p-text-3)">({unidadesTexto})</span>}
                                    </p>
                                  )
                                })}
                              </div>
                            )
                          }}
                        />
                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px', fontWeight: 600, color: COLORS.eje }} />

                        {tramosTemporadaAlta.map((t, i) => (
                          <ReferenceArea key={i} x1={t.x1} x2={t.x2} fill={COLORS.temporada} fillOpacity={0.4} />
                        ))}

                        <Area
                          dataKey="rango" name="Rango estimado (80%)" stroke="none"
                          fill="url(#gradRango)" connectNulls
                        />
                        {/* Tendencia del modelo sobre TODA la serie, historial
                            incluido: ahí se ve que está ajustada a los datos
                            reales y no dibujada sólo hacia el futuro. */}
                        {verModelo && (
                          <Line
                            type="monotone" dataKey="tendencia" name="Tendencia (sin estacionalidad)"
                            stroke={COLORS.primarioSuave} strokeWidth={2} strokeDasharray="6 4"
                            dot={false} activeDot={false} connectNulls isAnimationActive={false}
                          />
                        )}
                        <Line
                          type="monotone" dataKey="ventaProyectada" name="Venta Proyectada"
                          stroke={COLORS.primario} strokeWidth={3} connectNulls
                          dot={{ r: 3, fill: COLORS.primario, strokeWidth: 0 }} activeDot={{ r: 6 }}
                        />
                        <Line
                          type="monotone" dataKey="ventaReal" name="Venta Real"
                          stroke={COLORS.contraste} strokeWidth={3} strokeDasharray="5 5" connectNulls={false}
                          dot={false} activeDot={{ r: 6 }}
                        />
                        {/* Ritmo proyectado: arranca del mismo último mes real
                            que la línea verde (no del dato crudo del mes a
                            medias, que comparado contra meses completos se
                            veía como una caída al vacío) y corre AL LADO de
                            la proyección del modelo hasta el mes en curso —
                            así se compara directo: ¿vendiendo al ritmo de
                            estos días, cerramos arriba o abajo de lo que el
                            modelo esperaba? */}
                        <Line
                          type="monotone" dataKey="ritmo" name="Ritmo proyectado a fin de mes"
                          stroke={COLORS.contraste} strokeWidth={2.5} strokeDasharray="2 3" connectNulls
                          dot={(props: { cx?: number; cy?: number; index?: number; payload?: { mesIso?: string } }) => {
                            const { cx, cy, index, payload } = props
                            // Sólo un punto visible, en el mes en curso — el
                            // ancla (último mes real) ya tiene su propio dot
                            // de "Venta Proyectada"/"Venta Real" ahí mismo.
                            if (payload?.mesIso !== avanceMes.mes || cx == null || cy == null) return <React.Fragment key={index} />
                            return <circle key={index} cx={cx} cy={cy} r={5} fill="#fff" stroke={COLORS.contraste} strokeWidth={2.5} />
                          }}
                          isAnimationActive={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

                <EsteCiclo p={p} />
              </div>

              {/* ── Curva estacional aprendida por el modelo ── */}
              {verModelo && curvaEstacional.length > 0 && (
                <div className="flex flex-col rounded-xl border border-(--p-line) bg-(--p-card) p-4 shadow-sm lg:p-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-bold text-(--p-text)">Estacionalidad aprendida por el modelo</h3>
                    <p className="mt-1 text-sm text-(--p-text-3)">
                      Litros que cada mes del año suma o resta respecto de la tendencia. No es una regla
                      escrita a mano: es la curva de Fourier que Prophet ajustó sobre el historial de esta serie.
                    </p>
                  </div>
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={curvaEstacional} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={COLORS.rejilla} />
                        <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fill: COLORS.eje, fontSize: 12, fontWeight: 600 }} dy={8} />
                        <YAxis
                          axisLine={false} tickLine={false} tick={{ fill: COLORS.eje, fontSize: 12 }} dx={-6}
                          tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))}
                        />
                        <Tooltip
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          formatter={(value) => {
                            const n = Number(value)
                            return [`${n >= 0 ? '+' : '−'}${fNum(Math.abs(n))} L`, n >= 0 ? 'Sobre la tendencia' : 'Bajo la tendencia']
                          }}
                        />
                        {/* Una barra por mes, verde arriba de la tendencia y
                            ámbar abajo — el signo se lee sin mirar el eje. */}
                        <Bar dataKey="efecto" name="Efecto del mes" radius={[3, 3, 3, 3]} isAnimationActive={false}>
                          {curvaEstacional.map(d => (
                            <Cell key={d.mes} fill={d.efecto >= 0 ? COLORS.primarioSuave : COLORS.contraste} />
                          ))}
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* ── Proyección por producto y formato ──
                  17-nov-2026: antes mostraba sólo "próximo mes". Para planificar
                  la temporada hacen falta los próximos ciclos lado a lado, con
                  el escenario elegido. Sigue los mismos filtros de arriba. */}
              <Seccion
                titulo="Proyección por producto y formato"
                detalle={<>{filasTabla.length} {pl(filasTabla.length, 'serie', 'series')} · {verNeto ? 'neto a precio de hoy' : 'litros'} por ciclo (24 al 23){p.escenarioId === 'modelo' ? ' · modelo sin corregir' : <> · escenario <strong className="text-(--p-text-2)">{nombreEscenario}</strong></>}. La primera columna es lo vendido en el ciclo en curso.</>}
              >
                <div className="max-h-[560px] overflow-auto border-t border-(--p-line-2)">
                  <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
                    <thead className="sticky top-0 z-10 bg-(--p-card-2) text-[10.5px] font-bold uppercase tracking-wide text-(--p-text-3)">
                      <tr>
                        <th className="px-5 py-2.5">Producto</th>
                        <th className="px-3 py-2.5">Formato</th>
                        <th className="px-3 py-2.5 text-right" title="Vendido en lo que va del ciclo en curso, por fecha de pedido">Este ciclo</th>
                        {mesesTabla.map(m => (
                          <th key={m} className={`px-3 py-2.5 text-right ${esTemporada(m) ? 'text-(--p-accent)' : ''}`} title={`${fCicloCorto(inicioDeCiclo(m))} – ${fCicloCorto(finDeCiclo(m))}`}>{etiquetaMes(m)}</th>
                        ))}
                        <th className="px-5 py-2.5 text-center" title="Error del backtest (MAPE): cuánto se equivocó el modelo en promedio. Más alto es peor.">Error típico</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {filasTabla.length === 0 && (
                        <tr><td colSpan={4 + mesesTabla.length} className="px-5 py-10 text-center text-(--p-text-3)">Sin series para este filtro.</td></tr>
                      )}
                      {filasTabla.map(({ serie }, i) => {
                        const repetido = i > 0 && filasTabla[i - 1].serie.producto === serie.producto
                        const fuera = estaFueraDeProduccion(serie.producto ?? '')
                        return (
                          <tr key={serie.id} className={`prod-hover-row hover:bg-(--p-hover) ${repetido ? '' : 'border-t border-(--p-line-2)'} ${fuera ? 'opacity-55' : ''}`}>
                            <td className="px-5 py-2 font-semibold text-(--p-text)">
                              {repetido ? null : (
                                <span className="inline-flex items-center gap-2.5">
                                  <ProductImage nombre={serie.producto} categoria={serie.categoria} size={26} radius={6} />
                                  <span className="max-w-[220px] leading-tight">
                                    {serie.producto}
                                    {fuera && <span className="block text-[10.5px] font-semibold text-(--p-text-3)" title="No se produce: el modelo lo sigue proyectando por su historia, pero no entra al plan ni a las alarmas.">Fuera de producción</span>}
                                  </span>
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-(--p-text-2)">
                              <span className="inline-flex items-center gap-1.5">
                                {ENVASE_LABEL[(serie.envaseBucket ?? 'otros') as EnvaseBucket] ?? serie.envaseBucket}
                                {serie.metodo === 'derivado' && (
                                  <span className="rounded-full bg-(--p-info-soft) px-1.5 text-[10px] font-bold text-(--p-info)" title="Poca historia propia: el número sale de repartir el forecast del producto según cuánto pesó este formato últimamente.">derivado</span>
                                )}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-(--p-text-2)">{serie.litrosMesEnCurso > 0 ? valorSerie(serie, serie.litrosMesEnCurso) : <span className="text-(--p-text-4)">—</span>}</td>
                            {mesesTabla.map(m => {
                              const l = serie.puntos.find(pt => pt.mes === m && pt.tipo === 'forecast')?.litros
                              return (
                                <td key={m} className={`px-3 py-2 text-right ${esTemporada(m) ? 'font-bold text-(--p-text)' : 'text-(--p-text-2)'}`}>
                                  {l != null ? valorSerie(serie, l * factorDe(factor, m)) : <span className="text-(--p-text-4)">—</span>}
                                </td>
                              )
                            })}
                            <td className="px-5 py-2 text-center"><ChipDesviacion mape={serie.mape} derivado={serie.metodo === 'derivado'} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Seccion>
            </div>
  )
}

/**
 * El ciclo en curso al lado del gráfico (17-nov-2026; antes estaba al fondo
 * de la pestaña): lo vendido, a qué cierra al ritmo de los días hábiles y
 * contra qué proyectó el modelo. En días HÁBILES, igual que Hoy: la pestaña
 * decía "día 25 de 31" y Hoy "día hábil 17 de 21" para lo mismo.
 */
function EsteCiclo({ p }: { p: Produccion }) {
  const { avanceMes, mtdLitros, ritmoProyectado, chartData, kMoneda, fUnidad } = p
  const objetivo = chartData.find(f => f.mesIso === avanceMes.mes)?.ventaProyectada ?? null
  const cierre = ritmoProyectado * kMoneda
  const pct = objetivo != null && objetivo > 0 ? (cierre / objetivo) * 100 : null
  const avance = avanceMes.diasHabilesEnCiclo > 0 ? avanceMes.diasHabilesTranscurridos / avanceMes.diasHabilesEnCiclo : 0
  const escala = Math.max(cierre, objetivo ?? 0, 1)
  const fila = (etiqueta: string, valor: number | null, color: string, nota: string) => (
    <div className="flex flex-col gap-1.5 px-4 py-3.5">
      <span className="prod-eyebrow">{etiqueta}</span>
      <span className="prod-cifra text-[26px] font-extrabold leading-none" style={{ color }}>{valor != null ? fUnidad(valor) : '—'}</span>
      {valor != null && (
        <span className="h-1.5 overflow-hidden rounded-full bg-(--p-chip)">
          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (valor / escala) * 100)}%`, background: color }} />
        </span>
      )}
      <span className="text-[11.5px] leading-snug text-(--p-text-3)">{nota}</span>
    </div>
  )
  return (
    <aside className="prod-card flex flex-col divide-y divide-(--p-line-2) self-start" aria-label="Ciclo en curso">
      <div className="px-4 pb-3 pt-3.5">
        <p className="text-[15px] font-bold text-(--p-text)">Este ciclo</p>
        <p className="text-xs text-(--p-text-3)">{fCicloCorto(inicioDeCiclo(avanceMes.mes))} – {fCicloCorto(finDeCiclo(avanceMes.mes))} · día hábil {avanceMes.diasHabilesTranscurridos} de {avanceMes.diasHabilesEnCiclo}</p>
        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-(--p-chip)">
          <span className="block h-full rounded-full bg-(--p-text-3)" style={{ width: `${avance * 100}%` }} />
        </span>
      </div>
      {fila('Vendido', mtdLitros > 0 ? mtdLitros * kMoneda : null, 'var(--p-text)', 'Por fecha de pedido, no de entrega: Producción necesita la señal apenas entra el pedido.')}
      {fila('Cierra en', mtdLitros > 0 ? cierre : null, COLORS.contraste, 'Si se sigue vendiendo al ritmo de los días hábiles que van.')}
      {fila('El modelo proyectó', objetivo, COLORS.primario, pct != null
        ? `Vas al ${Math.round(pct)}% de lo proyectado${pct >= 110 ? ': el modelo se está quedando corto.' : pct < 95 ? ': por debajo del modelo.' : '.'}`
        : 'Sin proyección para el ciclo en curso.')}
    </aside>
  )
}
