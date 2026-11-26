-- Metas: las vistas de avance se pasaban del statement_timeout (8 s) — Claudio
-- veía "No se pudieron cargar las metas · canceling statement due to statement
-- timeout" muy seguido (2026-11-26).
--
-- Causa: cada fila del plan (120 semanas×vendedor) resolvía su venta y sus
-- clientes nuevos con un LATERAL. El de clientes nuevos re-armaba la ventana
-- lag() sobre TODO el historial de ventas en cada una de las 120 filas
-- (~25 ms × 120 = 3 s) y el de venta recorría las 61 mil filas de ventas otras
-- 120 veces (~1 s). Con el sync del ERP escribiendo, o con las 3 consultas de la
-- página en paralelo, pasaba de 8 s.
--
-- Arreglo: mismas columnas, mismas reglas y mismo resultado (verificado con
-- EXCEPT contra la versión anterior), pero las aperturas se calculan UNA vez
-- (MATERIALIZED) y la venta se cruza por vendedor con un hash join agrupado,
-- en vez de un LATERAL por fila. Sigue siendo security_invoker: la RLS de
-- ventas y plan_metas_semanales hace el scope igual que antes.

create or replace view public.plan_metas_avance with (security_invoker = true) as
with base as (
  select v.vendedor_actual, v.fecha_pedido, v.nombre_fantasia, v.pedido, v.total_sin_impuesto,
         case when v.pedido = 'Devolución' or v.litros < 0 then 0::numeric else coalesce(v.litros, 0::numeric) end as litros,
         v.envase, v.categoria_norm, v.fecha_entrega
  from ventas v
  where not coalesce(v.cliente_excluido, false) and not coalesce(v.producto_excluido, false)
), pedidos_cliente as (
  select base.nombre_fantasia as cliente, base.vendedor_actual as vendedor, base.pedido, min(base.fecha_pedido) as fecha
  from base
  where base.nombre_fantasia is not null
  group by base.nombre_fantasia, base.vendedor_actual, base.pedido
), aperturas as materialized (
  select x.cliente, x.vendedor, x.fecha
  from (
    select p.cliente, p.vendedor, p.pedido, p.fecha,
           lag(p.fecha) over (partition by p.cliente order by p.fecha, p.pedido) as fecha_anterior
    from pedidos_cliente p
  ) x
  where x.fecha >= '2026-10-01'::date and x.fecha_anterior is null
), mu as materialized (
  select m.id, m.temporada, m.territorio, m.user_id, u.nombre, m.semana, m.fecha_inicio, m.fecha_fin,
         m.meta_neto, m.meta_litros, m.meta_clientes_nuevos, m.meta_cajas_kombucha, m.meta_cajas_cerveza,
         m.meta_barriles, u.vendedores_erp
  from plan_metas_semanales m
  join users u on u.id = m.user_id
), mv as (
  select distinct mu.id, x.vendedor, mu.fecha_inicio, mu.fecha_fin
  from mu cross join lateral unnest(mu.vendedores_erp) x(vendedor)
), r as (
  select mv.id,
         sum(b.total_sin_impuesto) as neto,
         sum(b.total_sin_impuesto) filter (where b.fecha_entrega is null) as neto_por_entregar,
         round(sum(b.litros), 1) as litros,
         round(sum(b.litros) filter (where b.categoria_norm = 'Kombucha' and b.envase ~~* 'Lata%') / (24::numeric * 0.354), 1) as cajas_k,
         round(sum(b.litros) filter (where b.categoria_norm = 'Cerveza' and b.envase ~~* 'Lata%') / (24::numeric * 0.473), 1) as cajas_c,
         round(sum(b.litros) filter (where b.envase = 'Barril' and b.categoria_norm = 'Cerveza') / 30::numeric, 1) as barriles
  from mv
  join base b on b.vendedor_actual = mv.vendedor and b.fecha_pedido >= mv.fecha_inicio and b.fecha_pedido <= mv.fecha_fin
  group by mv.id
), a as (
  select mv.id, count(distinct ap.cliente) as nuevos
  from mv
  join aperturas ap on ap.vendedor = mv.vendedor and ap.fecha >= mv.fecha_inicio and ap.fecha <= mv.fecha_fin
  group by mv.id
)
select m.id, m.temporada, m.territorio, m.user_id, m.nombre as vendedor, m.semana, m.fecha_inicio, m.fecha_fin,
       m.meta_neto, m.meta_litros, m.meta_clientes_nuevos, m.meta_cajas_kombucha, m.meta_cajas_cerveza, m.meta_barriles,
       coalesce(r.neto, 0::numeric) as real_neto,
       coalesce(r.litros, 0::numeric) as real_litros,
       coalesce(r.cajas_k, 0::numeric) as real_cajas_kombucha,
       coalesce(r.cajas_c, 0::numeric) as real_cajas_cerveza,
       coalesce(r.barriles, 0::numeric) as real_barriles,
       coalesce(a.nuevos, 0::bigint) as real_clientes_nuevos,
       round(100::numeric * coalesce(r.neto, 0::numeric) / nullif(m.meta_neto, 0::numeric), 1) as pct_neto,
       round(100::numeric * coalesce(r.litros, 0::numeric) / nullif(m.meta_litros, 0::numeric), 1) as pct_litros,
       round(100::numeric * coalesce(a.nuevos, 0::bigint)::numeric / nullif(m.meta_clientes_nuevos, 0)::numeric, 1) as pct_clientes,
       case when current_date < m.fecha_inicio then 'futura'::text
            when current_date > m.fecha_fin then 'cerrada'::text
            else 'en_curso'::text end as estado_semana,
       case when current_date < m.fecha_inicio then null::text
            when coalesce(r.neto, 0::numeric) >= 0.95 * m.meta_neto then 'verde'::text
            when coalesce(r.neto, 0::numeric) >= 0.80 * m.meta_neto then 'amarillo'::text
            else 'rojo'::text end as semaforo,
       coalesce(r.neto_por_entregar, 0::numeric) as real_neto_por_entregar
from mu m
left join r on r.id = m.id
left join a on a.id = m.id;


create or replace view public.plan_metas_periodo_avance with (security_invoker = true) as
with base as (
  select v.vendedor_actual, v.fecha_pedido, v.nombre_fantasia, v.pedido, v.total_sin_impuesto,
         case when v.pedido = 'Devolución' or v.litros < 0 then 0::numeric else coalesce(v.litros, 0::numeric) end as litros,
         v.envase, v.categoria_norm, v.fecha_entrega
  from ventas v
  where not coalesce(v.cliente_excluido, false) and not coalesce(v.producto_excluido, false)
), pedidos_cliente as (
  select base.nombre_fantasia as cliente, base.vendedor_actual as vendedor, base.pedido, min(base.fecha_pedido) as fecha
  from base
  where base.nombre_fantasia is not null
  group by base.nombre_fantasia, base.vendedor_actual, base.pedido
), aperturas as materialized (
  select x.cliente, x.vendedor, x.fecha
  from (
    select p_1.cliente, p_1.vendedor, p_1.pedido, p_1.fecha,
           lag(p_1.fecha) over (partition by p_1.cliente order by p_1.fecha, p_1.pedido) as fecha_anterior
    from pedidos_cliente p_1
  ) x
  where x.fecha >= '2026-09-24'::date and x.fecha_anterior is null
), dias as (
  select m.temporada, m.territorio, m.user_id, d.dia::date as dia,
         (m.fecha_fin - m.fecha_inicio + 1)::numeric as n,
         m.meta_neto, m.meta_litros, m.meta_clientes_nuevos, m.meta_cajas_kombucha, m.meta_cajas_cerveza, m.meta_barriles,
         (case when extract(day from d.dia) >= 24::numeric then date_trunc('month', d.dia) + '1 mon'::interval
               else date_trunc('month', d.dia) end)::date as mes
  from plan_metas_semanales m
  cross join lateral generate_series(m.fecha_inicio::timestamp, m.fecha_fin::timestamp, '1 day'::interval) d(dia)
), per as materialized (
  select row_number() over () as k,
         dias.temporada, dias.territorio, dias.user_id, dias.mes,
         (dias.mes - '1 mon'::interval + '23 days'::interval)::date as fecha_inicio,
         (dias.mes + '22 days'::interval)::date as fecha_fin,
         round(sum(dias.meta_neto / dias.n)) as meta_neto,
         round(sum(dias.meta_litros / dias.n), 1) as meta_litros,
         round(sum(dias.meta_clientes_nuevos::numeric / dias.n), 1) as meta_clientes_nuevos,
         round(sum(dias.meta_cajas_kombucha::numeric / dias.n), 1) as meta_cajas_kombucha,
         round(sum(dias.meta_cajas_cerveza::numeric / dias.n), 1) as meta_cajas_cerveza,
         round(sum(dias.meta_barriles::numeric / dias.n), 1) as meta_barriles
  from dias
  group by dias.temporada, dias.territorio, dias.user_id, dias.mes
), pu as materialized (
  select p.*, u.nombre, u.vendedores_erp
  from per p
  join users u on u.id = p.user_id
), pv as (
  select distinct pu.k, x.vendedor, pu.fecha_inicio, pu.fecha_fin
  from pu cross join lateral unnest(pu.vendedores_erp) x(vendedor)
), r as (
  select pv.k,
         sum(b.total_sin_impuesto) as neto,
         sum(b.total_sin_impuesto) filter (where b.fecha_entrega is null) as neto_por_entregar,
         round(sum(b.litros), 1) as litros,
         round(sum(b.litros) filter (where b.categoria_norm = 'Kombucha' and b.envase ~~* 'Lata%') / (24::numeric * 0.354), 1) as cajas_k,
         round(sum(b.litros) filter (where b.categoria_norm = 'Cerveza' and b.envase ~~* 'Lata%') / (24::numeric * 0.473), 1) as cajas_c,
         round(sum(b.litros) filter (where b.envase = 'Barril' and b.categoria_norm = 'Cerveza') / 30::numeric, 1) as barriles
  from pv
  join base b on b.vendedor_actual = pv.vendedor and b.fecha_pedido >= pv.fecha_inicio and b.fecha_pedido <= pv.fecha_fin
  group by pv.k
), a as (
  select pv.k, count(distinct ap.cliente) as nuevos
  from pv
  join aperturas ap on ap.vendedor = pv.vendedor and ap.fecha >= pv.fecha_inicio and ap.fecha <= pv.fecha_fin
  group by pv.k
)
select row_number() over (order by p.temporada, p.territorio, p.mes) as id,
       p.temporada, p.territorio, p.user_id, p.nombre as vendedor,
       (dense_rank() over (partition by p.temporada order by p.mes))::integer as periodo,
       p.mes,
       (p.mes - '1 mon'::interval + '23 days'::interval)::date as periodo_inicio,
       (p.mes + '22 days'::interval)::date as periodo_fin,
       p.fecha_inicio, p.fecha_fin,
       p.meta_neto, p.meta_litros, p.meta_clientes_nuevos, p.meta_cajas_kombucha, p.meta_cajas_cerveza, p.meta_barriles,
       coalesce(r.neto, 0::numeric) as real_neto,
       coalesce(r.litros, 0::numeric) as real_litros,
       coalesce(r.cajas_k, 0::numeric) as real_cajas_kombucha,
       coalesce(r.cajas_c, 0::numeric) as real_cajas_cerveza,
       coalesce(r.barriles, 0::numeric) as real_barriles,
       coalesce(a.nuevos, 0::bigint) as real_clientes_nuevos,
       round(100::numeric * coalesce(r.neto, 0::numeric) / nullif(p.meta_neto, 0::numeric), 1) as pct_neto,
       round(100::numeric * coalesce(r.litros, 0::numeric) / nullif(p.meta_litros, 0::numeric), 1) as pct_litros,
       round(100::numeric * coalesce(a.nuevos, 0::bigint)::numeric / nullif(p.meta_clientes_nuevos, 0::numeric), 1) as pct_clientes,
       case when current_date < p.fecha_inicio then 'futura'::text
            when current_date > p.fecha_fin then 'cerrada'::text
            else 'en_curso'::text end as estado_semana,
       case when current_date < p.fecha_inicio then null::text
            when coalesce(r.neto, 0::numeric) >= 0.95 * p.meta_neto then 'verde'::text
            when coalesce(r.neto, 0::numeric) >= 0.80 * p.meta_neto then 'amarillo'::text
            else 'rojo'::text end as semaforo,
       coalesce(r.neto_por_entregar, 0::numeric) as real_neto_por_entregar
from pu p
left join r on r.k = p.k
left join a on a.k = p.k;
