'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Shirt, Store, Tent, Users, AlertTriangle } from 'lucide-react'
import { useUser } from '@/lib/userContext'
import SettingsPanel from '@/components/ui/SettingsPanel'
import NotificationsBell from '@/components/ui/NotificationsBell'
import {
  type MerchResumen, type MerchPeriodo, type OrigenMerch,
  ORIGENES, fmtMonto, variacion, fmtFechaCorta, diasDesde,
} from '@/lib/merch'

// Misma paleta clara que el resto de las sub-secciones de Ventas
// (Rentabilidad, Clientes, Barriles).
const C = {
  bg: '#F1F5F9', card: '#FFFFFF', hero: '#0F172A',
  text: '#0F172A', muted: '#64748B', faint: '#94A3B8', line: '#E2E8F0',
  blue: '#2563EB', blueSoft: '#EFF6FF',
  green: '#059669', greenSoft: '#ECFDF5',
  amber: '#D97706', amberSoft: '#FFFBEB',
  red: '#DC2626', redSoft: '#FEF2F2',
  gold: '#B8860B',
}

const ORIGEN_INFO: Record<OrigenMerch, { label: string; icon: typeof Store; color: string }> = {
  PDV:      { label: 'Tienda (PDV)', icon: Store, color: C.blue },
  Ferias:   { label: 'Ferias',       icon: Tent,  color: C.amber },
  Clientes: { label: 'Clientes',     icon: Users, color: C.green },
}

const DIAS_SIN_VENTA = 60

function DeltaChip({ pct }: { pct: number | null }) {
  if (pct === null) return null
  const sube = pct >= 0
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', borderRadius: 100, padding: '2px 8px',
      fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap',
      background: sube ? C.greenSoft : C.redSoft, color: sube ? C.green : C.red,
    }}>
      {sube ? '+' : ''}{Math.round(pct)}%
    </span>
  )
}

function Card({ children, titulo, nota }: { children: React.ReactNode; titulo?: string; nota?: string }) {
  return (
    <section style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 14px', marginBottom: 12 }}>
      {titulo && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{titulo}</h2>
          {nota && <span style={{ fontSize: 11, color: C.faint, textAlign: 'right' }}>{nota}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

export default function MerchClient({ resumen }: { resumen: MerchResumen }) {
  const router = useRouter()
  const { user: ctxUser } = useUser()
  const [showSettings, setShowSettings] = useState(false)
  const [anio, setAnio] = useState<number>(resumen.periodos[0]?.anio ?? 0)
  const [verTodosProductos, setVerTodosProductos] = useState(false)

  const anioActual = Number(resumen.hoy.slice(0, 4))
  const periodo = resumen.periodos.find(p => p.anio === anio) ?? resumen.periodos[0]
  const anterior: MerchPeriodo | undefined = anio === 0 ? undefined : resumen.periodos.find(p => p.anio === anio - 1)
  // Año en curso: se compara contra el año anterior al MISMO día (1-ene → hoy).
  // Años cerrados: año completo contra año completo.
  const esEnCurso = anio === anioActual
  const comparable = (v: { neto: number; netoCorte: number }) => (esEnCurso ? v.netoCorte : v.neto)
  const corteTexto = esEnCurso ? ` al ${fmtFechaCorta(resumen.hoy)}` : ''

  const prodPrevio = useMemo(
    () => new Map((anterior?.productos ?? []).map(p => [p.producto, p])),
    [anterior],
  )

  if (!periodo) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, padding: 24, textAlign: 'center', color: C.muted }}>
        No hay ventas de merch registradas.
      </div>
    )
  }

  const netoGrandes = periodo.grandes.reduce((s, g) => s + g.neto, 0)
  const deltaTotal = anterior ? variacion(comparable(periodo), comparable(anterior)) : null
  const deltaSinGrandes = anterior && netoGrandes > 0
    ? variacion(comparable(periodo) - netoGrandes, comparable(anterior))
    : null
  const maxSerie = Math.max(1, ...periodo.serie.map(s => s.neto), ...(anterior?.serie.map(s => s.neto) ?? []))
  const productos = verTodosProductos ? periodo.productos : periodo.productos.slice(0, 12)

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 'max(140px, calc(env(safe-area-inset-bottom, 0px) + 120px))' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 0' }}>
        <button
          onClick={() => router.push('/ventas')}
          aria-label="Volver"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: C.card, border: `1px solid ${C.line}`,
            borderRadius: 100, padding: '7px 14px 7px 10px', marginBottom: 14,
            color: C.blue, fontSize: 13, fontWeight: 700, cursor: 'pointer', minHeight: 36,
          }}
        >
          <ChevronLeft size={17} strokeWidth={2.5} color={C.blue} />
          Volver
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, letterSpacing: '0.04em' }}>VENTAS</p>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: '-0.5px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shirt size={22} color={C.gold} />
              Merch
            </h1>
            <p style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
              Tienda, ferias y clientes · neto sin IVA
              {resumen.ultimaVenta ? ` · última venta ${fmtFechaCorta(resumen.ultimaVenta)}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginTop: 2 }}>
            <NotificationsBell inline variant="light" />
            <button
              onClick={() => setShowSettings(true)}
              aria-label="Cuenta"
              style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', border: `1px solid ${C.line}`, background: C.hero, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0, padding: 0 }}
            >
              {ctxUser?.avatarUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={ctxUser.avatarUrl} alt={ctxUser.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (ctxUser?.iniciales || '··')}
            </button>
          </div>
        </div>

        {/* Selector de año */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 4, marginBottom: 12 }}>
          {resumen.periodos.map(p => (
            <button
              key={p.anio}
              onClick={() => { setAnio(p.anio); setVerTodosProductos(false) }}
              style={{
                flex: '1 1 0', minWidth: 56, minHeight: 36, borderRadius: 9, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 800,
                background: anio === p.anio ? C.hero : 'transparent', color: anio === p.anio ? '#fff' : C.muted,
              }}
            >
              {p.anio === 0 ? 'Todo' : p.anio}
            </button>
          ))}
        </div>

        {/* KPI principal */}
        <section style={{ background: C.hero, borderRadius: 16, padding: '16px 16px 14px', marginBottom: 12, color: '#fff' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.06em' }}>
            {anio === 0 ? 'TOTAL HISTÓRICO' : `VENTA ${anio}${corteTexto.toUpperCase()}`}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: '-1px' }}>{fmtMonto(periodo.neto)}</span>
            <DeltaChip pct={deltaTotal} />
          </div>
          {anterior && (
            <p style={{ fontSize: 12, color: '#CBD5E1', marginTop: 2 }}>
              {anio - 1}{corteTexto}: {fmtMonto(comparable(anterior))}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
            <div>
              <p style={{ fontSize: 11, color: '#94A3B8' }}>Pedidos</p>
              <p style={{ fontSize: 17, fontWeight: 800 }}>{periodo.pedidos.toLocaleString('es-CL')}</p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: '#94A3B8' }}>Ticket promedio</p>
              <p style={{ fontSize: 17, fontWeight: 800 }}>{fmtMonto(periodo.pedidos ? periodo.neto / periodo.pedidos : 0)}</p>
            </div>
          </div>
        </section>

        {/* Ventas puntuales que distorsionan la comparación */}
        {periodo.grandes.length > 0 && (
          <div style={{ display: 'flex', gap: 10, background: C.amberSoft, border: `1px solid #FDE68A`, borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
            <AlertTriangle size={18} color={C.amber} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: '#92400E', lineHeight: 1.45 }}>
              <strong>Incluye {periodo.grandes.length === 1 ? 'una venta puntual grande' : `${periodo.grandes.length} ventas puntuales grandes`}:</strong>{' '}
              {periodo.grandes.map(g => `${g.producto} ${fmtMonto(g.neto)} (${fmtFechaCorta(g.fecha)}, ${g.cliente})`).join(' · ')}.
              {' '}Sin {periodo.grandes.length === 1 ? 'ella' : 'ellas'}: <strong>{fmtMonto(periodo.neto - netoGrandes)}</strong>
              {deltaSinGrandes !== null && <> ({deltaSinGrandes >= 0 ? '+' : ''}{Math.round(deltaSinGrandes)}% vs {anio - 1})</>}.
            </div>
          </div>
        )}

        {/* Evolución */}
        <Card
          titulo={anio === 0 ? 'Por año' : 'Por mes'}
          nota={anterior ? `barra gris = ${anio - 1}` : undefined}
        >
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${periodo.serie.length}, minmax(0, 1fr))`, gap: 4, alignItems: 'end', height: 130 }}>
            {periodo.serie.map((s, i) => {
              const prev = anterior?.serie[i]?.neto ?? 0
              return (
                <div key={s.etiqueta} title={`${s.etiqueta}: ${fmtMonto(s.neto)}${anterior ? ` · ${anio - 1}: ${fmtMonto(prev)}` : ''}`}
                  style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height: '100%' }}>
                  {anterior && (
                    <div style={{ width: '38%', height: `${(prev / maxSerie) * 100}%`, minHeight: prev > 0 ? 2 : 0, background: '#CBD5E1', borderRadius: '3px 3px 0 0' }} />
                  )}
                  <div style={{ width: anterior ? '48%' : '70%', height: `${(Math.max(0, s.neto) / maxSerie) * 100}%`, minHeight: s.neto > 0 ? 2 : 0, background: C.gold, borderRadius: '3px 3px 0 0' }} />
                </div>
              )
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${periodo.serie.length}, minmax(0, 1fr))`, gap: 4, marginTop: 6 }}>
            {periodo.serie.map(s => (
              <div key={s.etiqueta} style={{ textAlign: 'center', minWidth: 0 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: C.muted }}>{s.etiqueta}</p>
                <p style={{ fontSize: 9, color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.neto ? fmtMonto(s.neto).replace('$', '').replace(' mil', 'k').replace(' M', 'M') : ''}
                </p>
              </div>
            ))}
          </div>
        </Card>

        {/* Por origen */}
        <Card titulo="Dónde se vende" nota={anterior ? `vs ${anio - 1}${corteTexto}` : undefined}>
          {ORIGENES.map(o => {
            const info = ORIGEN_INFO[o]
            const Icon = info.icon
            const v = periodo.origen[o]
            const pct = periodo.neto ? (v.neto / periodo.neto) * 100 : 0
            const d = anterior ? variacion(comparable(v), comparable(anterior.origen[o])) : null
            return (
              <div key={o} style={{ padding: '8px 0', borderTop: o === 'PDV' ? 'none' : `1px solid ${C.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon size={16} color={info.color} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.text }}>{info.label}</span>
                  <DeltaChip pct={d} />
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text, minWidth: 72, textAlign: 'right' }}>{fmtMonto(v.neto)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, paddingLeft: 24 }}>
                  <div style={{ flex: 1, height: 6, background: C.bg, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: info.color }} />
                  </div>
                  <span style={{ fontSize: 11, color: C.muted, minWidth: 32, textAlign: 'right' }}>{Math.round(pct)}%</span>
                </div>
              </div>
            )
          })}
        </Card>

        {/* Productos */}
        <Card titulo="Productos" nota={anterior ? `variación vs ${anio - 1}${corteTexto}` : `${periodo.productos.length} productos`}>
          {productos.map((p, i) => {
            const prev = prodPrevio.get(p.producto)
            const d = prev ? variacion(comparable(p), comparable(prev)) : null
            const nuevo = anterior && !prev
            const sinVenta = diasDesde(p.ultimaGlobal, resumen.hoy)
            const pct = periodo.neto ? (p.neto / periodo.neto) * 100 : 0
            return (
              <div key={p.producto} style={{ padding: '9px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.line}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: C.text, overflowWrap: 'anywhere' }}>{p.producto}</span>
                  {nuevo
                    ? <span style={{ fontSize: 10.5, fontWeight: 800, color: C.blue, background: C.blueSoft, borderRadius: 100, padding: '2px 8px' }}>NUEVO</span>
                    : <DeltaChip pct={d} />}
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text, minWidth: 72, textAlign: 'right' }}>{fmtMonto(p.neto)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: C.muted }}>
                    {p.pedidos.toLocaleString('es-CL')} {p.pedidos === 1 ? 'pedido' : 'pedidos'} · {pct.toLocaleString('es-CL', { maximumFractionDigits: 1 })}% · última {fmtFechaCorta(p.ultimaGlobal)}
                  </span>
                  {sinVenta > DIAS_SIN_VENTA && (
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: C.red, background: C.redSoft, borderRadius: 100, padding: '1px 7px' }}>
                      Sin ventas hace {sinVenta} días
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          {periodo.productos.length > 12 && (
            <button
              onClick={() => setVerTodosProductos(v => !v)}
              style={{ width: '100%', minHeight: 40, marginTop: 6, borderRadius: 10, border: `1px solid ${C.line}`, background: C.bg, color: C.blue, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
            >
              {verTodosProductos ? 'Ver menos' : `Ver los ${periodo.productos.length} productos`}
            </button>
          )}
        </Card>

        {/* Clientes */}
        <Card titulo="Principales clientes" nota={`top ${periodo.clientes.length}`}>
          {periodo.clientes.map((c, i) => {
            const info = ORIGEN_INFO[c.origen]
            return (
              <div key={c.nombre} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.line}` }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: info.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: C.text, overflowWrap: 'anywhere' }}>{c.nombre}</p>
                  <p style={{ fontSize: 11, color: C.muted }}>
                    {c.pedidos.toLocaleString('es-CL')} {c.pedidos === 1 ? 'pedido' : 'pedidos'} · última {fmtFechaCorta(c.ultima)}
                  </p>
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{fmtMonto(c.neto)}</span>
              </div>
            )
          })}
        </Card>

        <p style={{ fontSize: 11, color: C.faint, textAlign: 'center', padding: '4px 8px 16px', lineHeight: 1.5 }}>
          Incluye Tienda (PDV) y Ferias, que no cuentan en los KPIs comerciales de Ventas.
        </p>
      </div>

      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          userName={ctxUser?.nombre ?? ''}
          userEmail={ctxUser?.email ?? ''}
          avatarUrl={ctxUser?.avatarUrl ?? undefined}
        />
      )}
    </div>
  )
}
