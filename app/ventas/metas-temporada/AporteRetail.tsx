'use client'

import { useState } from 'react'
import { ChevronDown, Lock, Store } from 'lucide-react'
import {
  type Acumulado, type FilaMeta, type Escala, type RetailCorte,
  clp, litros, pct, pctTxt, acumular, nivelPorPct, rangoFechas, periodoComercial, NIVEL_COLOR, NIVEL_BARRA,
} from './tipos'
import { Barra, PctNivel, PorEntregar, Titulo, ORO } from './ui'
import { ClientesDelCorte } from './DetalleClientes'

/**
 * Aporte del Retail a las metas — SÓLO gerencia (pedido de Claudio, 2026-11-04).
 *
 * Las metas del plan son de los 4 vendedores y el Retail no entra en ellas (y
 * debe seguir así). La estrategia es que el Retail sea el colchón cuando el
 * equipo no llega, así que acá se ve cuánto suma encima de la venta del equipo,
 * contra la MISMA meta. Los datos vienen de la RPC plan_metas_retail_aporte,
 * que no devuelve nada si quien pregunta no es admin; además la página sólo la
 * pide con isAdmin (apagado en "Ver como vendedor").
 */
export default function AporteRetail({
  retail, equipo, escala, elegido, nombre,
}: {
  /** Cortes del Retail en la escala elegida (semanas o meses 24→23). */
  retail: RetailCorte[]
  /** Filas de los 4 vendedores en la escala elegida. */
  equipo: FilaMeta[]
  escala: Escala
  elegido: number
  nombre: string
}) {
  const porCorte = new Map<number, FilaMeta[]>()
  for (const f of equipo) porCorte.set(f.semana, [...(porCorte.get(f.semana) ?? []), f])
  const retailPor = new Map(retail.map(r => [r.n, r]))

  const filas = [...porCorte.entries()]
    .map(([n, fs]) => ({ n, ref: fs[0], eq: acumular(fs), rt: retailPor.get(n) ?? null }))
    .sort((a, b) => a.n - b.n)
  const actual = filas.find(f => f.n === elegido) ?? null
  const mes = escala === 'periodo'

  // Tabla: en semanas sólo las del período 24→23 de la semana elegida — lo que se
  // mira es el mes en curso, no la temporada (Claudio, 2026-11-10). Desde
  // 2026-11-26 van TODAS las semanas (o meses) hasta el fin del período, también
  // las que no parten, con su meta: así se ve lo que queda por delante.
  const periodoTabla = !mes && actual ? periodoComercial(actual.ref.fechaInicio) : null
  const enTabla = filas.filter(f => !periodoTabla || periodoComercial(f.ref.fechaInicio).clave === periodoTabla.clave)
  const conVenta = enTabla.filter(f => f.ref.estado !== 'futura')

  // Acumulado sólo de lo que ya partió (las futuras inflarían la meta sin venta posible).
  // En meses, Octubre usa el 24→23 completo: igual que el resto de la pantalla.
  // La fila final va contra la meta del período COMPLETO (todas las semanas de la
  // tabla, también las que no parten): Claudio, 2026-11-26 — el 35% de la S10 no
  // es el avance del mes. La venta sí es sólo lo que ya partió.
  const metaTabla = acumular(enTabla.flatMap(f => porCorte.get(f.n) ?? []))
  const acumEq = {
    ...acumular(conVenta.flatMap(f => porCorte.get(f.n) ?? [])),
    metaNeto: metaTabla.metaNeto, metaLitros: metaTabla.metaLitros, metaClientes: metaTabla.metaClientes,
  }
  const acumRt = sumarRetail(conVenta.map(f => f.rt))
  const desdeDe = (f: (typeof filas)[number]) => f.rt?.fechaInicio || f.ref.fechaInicio
  const hastaDe = (f: (typeof filas)[number]) => f.rt?.fechaFin || f.ref.fechaFin

  // Meta del período completo (pedido de Claudio, 2026-11-10): todas sus semanas,
  // también las que no parten. Ninguna semana cruza el 23/24, así que la suma calza.
  const metaPeriodo = periodoTabla
    ? acumular(filas.filter(f => periodoComercial(f.ref.fechaInicio).clave === periodoTabla.clave)
        .flatMap(f => porCorte.get(f.n) ?? []))
    : null

  return (
    <section
      className="mb-5 rounded-[14px] border border-[var(--cc-line)] bg-[var(--cc-card-2)] p-4 md:p-5"
      aria-label="Aporte del Retail a las metas (sólo gerencia)"
    >
      <Titulo
        extra={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--cc-gold-soft)] px-3 py-1 text-[12px] font-bold text-[var(--m-oro-texto)]">
            <Lock size={12} /> Sólo gerencia · los vendedores no lo ven
          </span>
        }
      >
        <span className="inline-flex items-center gap-2">
          <Store size={18} className="text-[var(--cc-gold)]" />
          Colchón Retail
        </span>
      </Titulo>
      <p className="-mt-1 mb-4 text-[13px] font-medium text-[var(--cc-ink-2)]">
        Venta del Retail sumada encima del equipo, contra la misma meta. No entra en las metas de los vendedores.
      </p>

      {actual && actual.ref.estado !== 'futura' ? (
        <Bloque
          titulo={`${nombre}${actual.ref.estado === 'en_curso' ? ' · en curso' : ''}`}
          eq={actual.eq}
          rt={actual.rt}
        />
      ) : (
        <p className="py-2 text-[14px] font-medium text-[var(--cc-ink-2)]">
          {mes ? 'Este mes' : 'Esta semana'} todavía no parte: el aporte del Retail se ve desde su primer día.
        </p>
      )}

      {enTabla.length > 0 && (
        <div className="mt-5 border-t border-[var(--cc-line)] pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-[14px] font-bold text-[var(--cc-ink)]">
              {mes ? 'Mes a mes' : 'Semana a semana'}
              {periodoTabla && (
                <span className="font-medium text-[var(--cc-ink-2)]">
                  {' '}· {periodoTabla.nombre} ({rangoFechas(periodoTabla.inicio, periodoTabla.fin)})
                </span>
              )}
            </p>
            <Leyenda />
          </div>
          <Tabla
            filas={enTabla.map(f => ({
              clave: f.n, etiqueta: f.ref.corto, rango: rangoFechas(f.ref.fechaInicio, f.ref.fechaFin),
              eq: f.eq, rt: f.rt, marcada: f.n === elegido, futura: f.ref.estado === 'futura',
              desde: desdeDe(f), hasta: hastaDe(f), frase: mes ? f.ref.nombre : `la ${f.ref.corto}`,
            }))}
            total={conVenta.length > 0 ? {
              etiqueta: 'Total', rango: periodoTabla?.nombre ?? 'Temporada', eq: acumEq, rt: acumRt,
              desde: desdeDe(conVenta[0]), hasta: hastaDe(conVenta[conVenta.length - 1]),
              frase: periodoTabla ? `lo que va de ${periodoTabla.nombre}` : 'lo que va de la temporada',
            } : null}
          />
          {periodoTabla && metaPeriodo && (
            <MetaPeriodo
              nombre={periodoTabla.nombre}
              meta={metaPeriodo}
              ventaNeto={acumEq.realNeto + acumRt.neto}
              ventaLitros={acumEq.realLitros + acumRt.litros}
            />
          )}
        </div>
      )}
    </section>
  )
}

// ── Lo elegido: tres números ─────────────────────────────────────────────────

function Bloque({ titulo, eq, rt }: { titulo: string; eq: Acumulado; rt: RetailCorte | null }) {
  const rNeto = rt?.neto ?? 0
  const rLitros = rt?.litros ?? 0
  const pEq = pct(eq.realNeto, eq.metaNeto)
  const pTotal = pct(eq.realNeto + rNeto, eq.metaNeto)
  const pTotalL = pct(eq.realLitros + rLitros, eq.metaLitros)
  const falta = eq.metaNeto - eq.realNeto - rNeto
  const participacion = pct(rNeto, eq.realNeto + rNeto)
  const fuerte = 'font-bold text-[var(--cc-ink)]'

  return (
    <div>
      <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.04em] text-[var(--cc-ink-3)]">{titulo}</p>
      <div className="grid grid-cols-1 divide-y divide-[var(--cc-line)] md:grid-cols-3 md:divide-x md:divide-y-0">
        <Celda etiqueta="Venta Retail">
          <p className="text-[26px] font-bold leading-tight tracking-[-0.02em] tabular-nums text-[var(--cc-ink)]">{clp(rNeto)}</p>
          <p className="text-[14px] font-medium tabular-nums text-[var(--cc-ink-2)]">
            <strong className={fuerte}>{litros(rLitros)} L</strong> · {pctTxt(participacion)} de la venta total
          </p>
          <PorEntregar monto={rt?.netoPorEntregar ?? 0} className="mt-1" />
        </Celda>

        <Celda etiqueta="Aporte a la meta">
          <p className="text-[26px] font-bold leading-tight tracking-[-0.02em] tabular-nums text-[var(--m-oro-texto)]">
            +{pctTxt(pct(rNeto, eq.metaNeto))}
          </p>
          <p className="text-[14px] font-medium tabular-nums text-[var(--cc-ink-2)]">
            en $ · <strong className={fuerte}>+{pctTxt(pct(rLitros, eq.metaLitros))}</strong> en litros
          </p>
          <div className="mt-2"><Barra valor={pct(rNeto, eq.metaNeto)} alto={7} color={ORO} /></div>
        </Celda>

        <Celda etiqueta="Equipo + Retail">
          <p className="flex items-baseline gap-2 tabular-nums">
            <PctNivel valor={pTotal} className="text-[26px] leading-tight tracking-[-0.02em]" />
            <span className="text-[14px] font-medium text-[var(--cc-ink-2)]">
              equipo solo <span className="font-bold" style={{ color: NIVEL_COLOR[nivelPorPct(pEq)] }}>{pctTxt(pEq)}</span>
            </span>
          </p>
          <p className="text-[14px] font-medium tabular-nums text-[var(--cc-ink-2)]">
            {clp(eq.realNeto + rNeto)} / {clp(eq.metaNeto)} · {pctTxt(pTotalL)} en litros
          </p>
          <div className="mt-2"><BarraDoble equipo={pEq} total={pTotal} /></div>
          <p className="mt-1.5 text-[13px] font-medium tabular-nums text-[var(--cc-ink-2)]">
            {falta > 0
              ? <>Aun con Retail faltan <strong className={fuerte}>{clp(falta)}</strong></>
              : <>Con Retail se cubre la meta{falta < 0 && <> y sobran <strong className={fuerte}>{clp(-falta)}</strong></>}</>}
          </p>
        </Celda>
      </div>
    </div>
  )
}

function Celda({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 py-3 first:pt-0 last:pb-0 md:px-5 md:py-0 md:first:pl-0 md:last:pr-0">
      <p className="mb-1 text-[14px] font-medium text-[var(--cc-ink-2)]">{etiqueta}</p>
      {children}
    </div>
  )
}

/** Barra apilada: tramo del equipo en color de nivel + tramo del Retail en dorado encima. */
function BarraDoble({ equipo, total, alto = 9 }: { equipo: number; total: number; alto?: number }) {
  const wEq = Math.max(0, Math.min(100, equipo))
  const wRt = Math.max(0, Math.min(100, total) - wEq)
  return (
    <div
      className="flex w-full overflow-hidden rounded-full bg-[var(--cc-neutral-soft)]"
      style={{ height: alto }}
      role="img"
      aria-label={`Equipo ${pctTxt(equipo)} más Retail ${pctTxt(Math.max(0, total - equipo))}`}
    >
      <div className="h-full transition-[width] duration-500" style={{ width: `${wEq}%`, background: NIVEL_BARRA[nivelPorPct(equipo)] }} />
      {/* Separador fino para que el tramo dorado se lea aparte aunque el equipo esté en verde/naranjo. */}
      <div
        className="h-full transition-[width] duration-500"
        style={{ width: `${wRt}%`, background: ORO, boxShadow: wEq > 0 && wRt > 0 ? 'inset 2px 0 0 var(--cc-card-2)' : undefined }}
      />
    </div>
  )
}

function Leyenda() {
  const punto = 'inline-block h-2 w-2 rounded-full'
  return (
    <span className="flex items-center gap-3 text-[12px] font-medium text-[var(--cc-ink-2)]">
      <span className="inline-flex items-center gap-1.5">
        {/* El tramo del equipo cambia de color según su avance (rojo/naranjo/verde). */}
        <span
          className="inline-block h-2 w-4 rounded-full"
          style={{ background: `linear-gradient(90deg, ${NIVEL_BARRA.rojo}, ${NIVEL_BARRA.naranjo}, ${NIVEL_BARRA.verde})` }}
        /> Equipo
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={punto} style={{ background: ORO }} /> Retail
      </span>
    </span>
  )
}

// ── Tabla semana a semana ────────────────────────────────────────────────────

// Móvil: la meta va bajo la venta del equipo ("de $X") para no pasar de 4 columnas en 390px.
// 1ª columna: "S1" + su rango de fechas debajo (puede partir en dos líneas: "27 oct –" / "2 nov").
// Escritorio: Meta y al lado Equipo + Retail (pedido de Claudio, 2026-11-10). En móvil
// esa suma va bajo el % de la última columna.
const COLS = 'grid-cols-[58px_minmax(0,1fr)_minmax(0,1fr)_78px] md:grid-cols-[92px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_76px_72px_minmax(0,1.2fr)_20px]'

interface FilaTabla {
  clave: number
  etiqueta: string
  rango?: string
  eq: Acumulado
  rt: RetailCorte | null
  marcada: boolean
  /** Todavía no parte: se muestra sólo su meta y no se despliega. */
  futura?: boolean
  /** Fechas con que se piden los clientes del Retail al desplegar. */
  desde: string
  hasta: string
  /** Cómo se nombra dentro de una frase: "la S10", "Noviembre". */
  frase: string
}
type TotalTabla = Omit<FilaTabla, 'clave' | 'marcada'>

const CLAVE_TOTAL = -1

/**
 * Al tocar una semana (o el Acum.) se despliegan los clientes del Retail en ese
 * corte y, al tocar un cliente, lo que compró — igual que al tocar una región en
 * "Ranking por vendedor" (pedido de Claudio, 2026-11-26).
 */
function Tabla({ filas, total }: { filas: FilaTabla[]; total: TotalTabla | null }) {
  const [abierto, setAbierto] = useState<number | null>(null)
  const alternar = (clave: number) => setAbierto(abierto === clave ? null : clave)
  const todas: (FilaTabla & { total?: boolean })[] = [
    ...filas,
    ...(total ? [{ ...total, clave: CLAVE_TOTAL, marcada: false, total: true }] : []),
  ]
  return (
    <div>
      <div className={`hidden ${COLS} gap-x-3 border-b border-[var(--cc-line)] pb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--cc-ink-3)] md:grid`}>
        <span />
        <span>Meta</span>
        <span>Equipo + Retail</span>
        <span>Equipo</span>
        <span>Retail</span>
        <span>% Equipo</span>
        <span>Aporte</span>
        <span>Con Retail</span>
        <span />
      </div>
      {todas.map(f => {
        const abierta = abierto === f.clave
        return (
          <div key={f.clave} className={f.total ? 'mt-1 border-t-2 border-[var(--cc-line)] md:mt-0 md:border-t' : ''}>
            {f.futura ? (
              <FilaFutura {...f} />
            ) : (
              <button
                type="button"
                onClick={() => alternar(f.clave)}
                aria-expanded={abierta}
                aria-label={`${abierta ? 'Ocultar' : 'Ver'} ventas del Retail en ${f.frase}`}
                className={`block w-full text-left transition-colors hover:bg-[var(--cc-card)] ${
                  f.marcada || abierta ? 'bg-[var(--cc-gold-soft)] hover:bg-[var(--cc-gold-soft)]' : ''
                }`}
              >
                <TarjetaSemana {...f} abierta={abierta} />
                <Linea {...f} abierta={abierta} />
              </button>
            )}
            {abierta && (
              <div className="border-b border-[var(--cc-line-soft)] px-1 pb-3 pt-2 md:px-3">
                <ClientesDelCorte retail userId="" desde={f.desde} hasta={f.hasta} nombre={f.frase} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Semana que todavía no parte: sólo su meta, apagada. */
function FilaFutura({ etiqueta, rango, eq }: FilaTabla) {
  return (
    <>
      {/* Móvil */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--cc-line-soft)] py-2.5 tabular-nums md:hidden">
        <p className="min-w-0 text-[var(--cc-ink-2)]">
          <span className="text-[15px] font-bold">{etiqueta}</span>
          {rango && <span className="block text-[12px] font-medium text-[var(--cc-ink-3)]">{rango}</span>}
        </p>
        <p className="flex shrink-0 flex-col items-end leading-tight">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--cc-ink-3)]">Meta · por venir</span>
          <span className="text-[15px] font-semibold text-[var(--cc-ink-2)]">{clp(eq.metaNeto)}</span>
          <span className="text-[12px] font-medium text-[var(--cc-ink-3)]">{litros(eq.metaLitros)} L</span>
        </p>
      </div>
      {/* Escritorio */}
      <div className={`hidden ${COLS} min-h-[44px] items-center gap-x-3 border-b border-[var(--cc-line-soft)] py-1.5 text-[13px] tabular-nums md:grid`}>
        <span className="flex min-w-0 flex-col pl-1">
          <span className="font-bold text-[var(--cc-ink-2)]">{etiqueta}</span>
          {rango && <span className="text-[11px] font-medium leading-tight text-[var(--cc-ink-3)]">{rango}</span>}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-[var(--cc-ink-2)]">{clp(eq.metaNeto)}</span>
          <span className="truncate text-[12px] font-medium text-[var(--cc-ink-3)]">{litros(eq.metaLitros)} L</span>
        </span>
        <span className="col-span-6 text-[12px] font-medium italic text-[var(--cc-ink-3)]">Por venir</span>
        <span />
      </div>
    </>
  )
}

/**
 *  S6  2–8 nov                          107%  ⌄
 *                                  con Retail
 *  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
 *  EQUIPO              RETAIL
 *  $5.793.639  55%     $5.560.659  +53%
 *  1.234,5 L           1.619,8 L
 *  META                EQUIPO + RETAIL
 *  $10.530.000         $11.354.298 · 2.854,3 L
 */
function TarjetaSemana({ etiqueta, rango, eq, rt, total = false, abierta }: FilaTabla & { total?: boolean; abierta: boolean }) {
  const rNeto = rt?.neto ?? 0
  const rLitros = rt?.litros ?? 0
  const pEq = pct(eq.realNeto, eq.metaNeto)
  const pTotal = pct(eq.realNeto + rNeto, eq.metaNeto)
  const rotulo = 'text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--cc-ink-3)]'
  const monto = 'text-[15px] font-bold text-[var(--cc-ink)]'
  const sub = 'text-[12px] font-medium text-[var(--cc-ink-2)]'
  return (
    <div className={`flex flex-col gap-2 px-2 py-3 tabular-nums md:hidden ${total ? '' : 'border-b border-[var(--cc-line-soft)]'}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[var(--cc-ink)]">
          <span className="text-[16px] font-bold">{total ? 'Total' : etiqueta}</span>
          {rango && <span className="block text-[12px] font-medium text-[var(--cc-ink-2)]">{rango}</span>}
        </p>
        <span className="flex shrink-0 items-start gap-2">
          <span className="flex flex-col items-end leading-tight">
            <PctNivel valor={pTotal} className="text-[20px]" />
            <span className={sub}>con Retail</span>
          </span>
          <ChevronDown size={18} className={`mt-1 text-[var(--cc-ink-2)] transition-transform duration-200 ${abierta ? 'rotate-180' : ''}`} />
        </span>
      </div>
      <BarraDoble equipo={pEq} total={pTotal} alto={6} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <div className="min-w-0">
          <p className={rotulo}>Equipo</p>
          <p className={monto}>{clp(eq.realNeto)}</p>
          <p className={sub}>{litros(eq.realLitros)} L · <PctNivel valor={pEq} /></p>
        </div>
        <div className="min-w-0">
          <p className={rotulo}>Retail</p>
          <p className={monto}>{clp(rNeto)}</p>
          <p className={sub}>
            {litros(rLitros)} L · <span className="font-bold text-[var(--m-oro-texto)]">+{pctTxt(pct(rNeto, eq.metaNeto))}</span>
          </p>
        </div>
        <div className="min-w-0">
          <p className={rotulo}>Meta</p>
          <p className="text-[15px] font-semibold text-[var(--cc-ink-2)]">{clp(eq.metaNeto)}</p>
          <p className={sub}>{litros(eq.metaLitros)} L</p>
        </div>
        <div className="min-w-0">
          <p className={rotulo}>Equipo + Retail</p>
          <p className={monto}>{clp(eq.realNeto + rNeto)}</p>
          <p className={sub}>{litros(eq.realLitros + rLitros)} L</p>
        </div>
      </div>
    </div>
  )
}

function Linea({ etiqueta, rango, eq, rt, marcada, total = false, abierta }: FilaTabla & { total?: boolean; abierta: boolean }) {
  const rNeto = rt?.neto ?? 0
  const pEq = pct(eq.realNeto, eq.metaNeto)
  const pTotal = pct(eq.realNeto + rNeto, eq.metaNeto)
  return (
    <div
      className={`hidden ${COLS} min-h-[44px] items-center gap-x-3 border-b border-[var(--cc-line-soft)] py-1.5 text-[13px] tabular-nums md:grid ${
        total ? 'font-bold' : ''
      }`}
    >
      <span className="flex min-w-0 flex-col pl-1">
        <span className={`font-bold ${marcada || total || abierta ? 'text-[var(--cc-ink)]' : 'text-[var(--cc-ink-2)]'}`}>{etiqueta}</span>
        {rango && <span className="text-[11px] font-medium leading-tight text-[var(--cc-ink-3)]">{rango}</span>}
      </span>
      <span className="truncate font-medium text-[var(--cc-ink-2)]">{clp(eq.metaNeto)}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-bold text-[var(--cc-ink)]">{clp(eq.realNeto + rNeto)}</span>
        <span className="truncate text-[12px] font-medium text-[var(--cc-ink-2)]">{litros(eq.realLitros + (rt?.litros ?? 0))} L</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-bold text-[var(--cc-ink)]">{clp(eq.realNeto)}</span>
        <span className="truncate text-[12px] font-medium text-[var(--cc-ink-2)]">{litros(eq.realLitros)} L</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-bold text-[var(--cc-ink)]">{clp(rNeto)}</span>
        <span className="truncate text-[12px] font-medium text-[var(--cc-ink-2)]">{litros(rt?.litros ?? 0)} L</span>
      </span>
      <span><PctNivel valor={pEq} /></span>
      <span className="font-bold text-[var(--m-oro-texto)]">+{pctTxt(pct(rNeto, eq.metaNeto))}</span>
      <span className="flex items-center gap-3">
        <span className="flex-1"><BarraDoble equipo={pEq} total={pTotal} alto={7} /></span>
        <PctNivel valor={pTotal} />
      </span>
      <ChevronDown size={16} className={`justify-self-end text-[var(--cc-ink-2)] transition-transform duration-200 ${abierta ? 'rotate-180' : ''}`} />
    </div>
  )
}

/** Pie de la tabla: meta del período 24→23 completo contra lo que llevan Equipo + Retail. */
function MetaPeriodo({ nombre, meta, ventaNeto, ventaLitros }: { nombre: string; meta: Acumulado; ventaNeto: number; ventaLitros: number }) {
  const p = pct(ventaNeto, meta.metaNeto)
  const falta = meta.metaNeto - ventaNeto
  const fuerte = 'font-bold text-[var(--cc-ink)]'
  return (
    <div className="mt-3 flex flex-col gap-1 rounded-[10px] bg-[var(--cc-neutral-soft)] px-3 py-2.5 text-[13px] font-medium tabular-nums text-[var(--cc-ink-2)] md:flex-row md:items-center md:justify-between md:gap-4">
      <p>
        Meta {nombre}: <strong className={`text-[15px] ${fuerte}`}>{clp(meta.metaNeto)}</strong>
        <span> · {litros(meta.metaLitros)} L</span>
      </p>
      <p>
        Equipo + Retail <strong className={fuerte}>{clp(ventaNeto)}</strong> ({litros(ventaLitros)} L) ·{' '}
        <PctNivel valor={p} />
        {' · '}
        {falta > 0
          ? <>faltan <strong className={fuerte}>{clp(falta)}</strong></>
          : <>meta cubierta{falta < 0 && <>, sobran <strong className={fuerte}>{clp(-falta)}</strong></>}</>}
      </p>
    </div>
  )
}

function sumarRetail(cortes: (RetailCorte | null)[]): RetailCorte {
  return cortes.reduce<RetailCorte>(
    (a, r) => (r ? { ...a, neto: a.neto + r.neto, netoPorEntregar: a.netoPorEntregar + r.netoPorEntregar, litros: a.litros + r.litros } : a),
    { tipo: 'semana', n: 0, fechaInicio: '', fechaFin: '', neto: 0, netoPorEntregar: 0, litros: 0 },
  )
}
