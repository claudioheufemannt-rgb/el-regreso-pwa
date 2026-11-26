-- Colchón Retail: a quién le vendió el Retail en una semana/mes (Claudio, 2026-11-26).
-- Mismo detalle que plan_metas_detalle_clientes (lo que se ve al tocar una
-- región en Metas), pero para la cartera ERP 'Claudio Heufemann', que no es de
-- ningún vendedor del plan. SECURITY DEFINER y sólo responde a admins, igual que
-- plan_metas_retail_aporte: los vendedores no deben ver el Retail. Mismos
-- criterios, así la suma cuadra con la "Venta Retail" de la tarjeta.

create or replace function public.plan_metas_retail_detalle_clientes(p_desde date, p_hasta date)
returns table(
  cliente text, neto numeric, neto_por_entregar numeric, litros numeric, pedidos bigint,
  ultima_fecha date, ultima_hora text, ultimo_pedido text, es_nuevo boolean, fecha_apertura date,
  cajas_kombucha numeric, cajas_cerveza numeric, barriles numeric, productos jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with u as (
    -- Sin fila (=> sin resultados) si quien pregunta no es admin.
    select array['Claudio Heufemann']::text[] as vendedores_erp
    where exists (
      select 1 from users x
      where x.is_admin
        and (x.id = auth.uid() or lower(x.email) = lower(auth.jwt() ->> 'email'))
    )
  ), base as (
    select v.vendedor_actual, v.fecha_pedido, v.nombre_fantasia, v.pedido, v.producto, v.envase, v.categoria_norm,
           v.total_sin_impuesto,
           case when v.pedido = 'Devolución' or v.litros < 0 then 0::numeric else coalesce(v.litros, 0::numeric) end as litros,
           v.fecha_entrega
    from ventas v
    where not coalesce(v.cliente_excluido, false) and not coalesce(v.producto_excluido, false)
  ), pedidos_cliente as (
    select b.nombre_fantasia as cliente, b.vendedor_actual as vendedor, b.pedido, min(b.fecha_pedido) as fecha
    from base b
    where b.nombre_fantasia is not null
    group by b.nombre_fantasia, b.vendedor_actual, b.pedido
  ), aperturas as (
    select x.cliente, min(x.fecha) as fecha
    from (
      select p.cliente, p.vendedor, p.fecha,
             lag(p.fecha) over (partition by p.cliente order by p.fecha, p.pedido) as fecha_anterior
      from pedidos_cliente p
    ) x, u
    where x.fecha >= p_desde and x.fecha <= p_hasta
      and x.fecha_anterior is null
      and x.vendedor = any (u.vendedores_erp)
    group by x.cliente
  ), periodo as (
    select coalesce(b.nombre_fantasia, 'Sin nombre') as cliente, b.*
    from base b, u
    where b.vendedor_actual = any (u.vendedores_erp) and b.fecha_pedido >= p_desde and b.fecha_pedido <= p_hasta
      and b.pedido is distinct from 'Devolución'
  ), venta as (
    select p.cliente,
           sum(p.total_sin_impuesto) as neto,
           coalesce(sum(p.total_sin_impuesto) filter (where p.fecha_entrega is null), 0) as neto_por_entregar,
           round(sum(p.litros), 1) as litros,
           count(distinct p.pedido) as pedidos,
           max(p.fecha_pedido) as ultima_fecha,
           coalesce(round(sum(p.litros) filter (where p.categoria_norm = 'Kombucha' and p.envase ilike 'Lata%') / (24 * 0.354), 1), 0) as cajas_kombucha,
           coalesce(round(sum(p.litros) filter (where p.categoria_norm = 'Cerveza' and p.envase ilike 'Lata%') / (24 * 0.473), 1), 0) as cajas_cerveza,
           coalesce(round(sum(p.litros) filter (where p.envase = 'Barril' and p.categoria_norm = 'Cerveza') / 30, 1), 0) as barriles
    from periodo p
    group by 1
  ), ultimo as (
    select distinct on (p.cliente) p.cliente, p.pedido, p.fecha_pedido
    from periodo p
    where p.pedido ~ '^[0-9]+$'
    order by p.cliente, p.fecha_pedido desc, p.pedido::bigint desc
  ), por_producto as (
    select p.cliente, coalesce(p.producto, 'Sin producto') as producto, p.envase, p.categoria_norm as categoria,
           round(sum(p.litros), 1) as litros, sum(p.total_sin_impuesto) as neto
    from periodo p
    group by 1, 2, 3, 4
    having round(sum(p.litros), 1) <> 0 or coalesce(sum(p.total_sin_impuesto), 0) <> 0
  ), productos as (
    select pp.cliente,
           jsonb_agg(jsonb_build_object(
             'producto', pp.producto, 'envase', pp.envase, 'categoria', pp.categoria,
             'litros', pp.litros, 'neto', pp.neto
           ) order by pp.neto desc nulls last, pp.litros desc) as productos
    from por_producto pp
    group by 1
  )
  select v.cliente, v.neto, v.neto_por_entregar, v.litros, v.pedidos, v.ultima_fecha,
         case when (i.ingreso_en at time zone 'America/Santiago')::date = ult.fecha_pedido
              then to_char(i.ingreso_en at time zone 'America/Santiago', 'HH24:MI') end as ultima_hora,
         ult.pedido as ultimo_pedido,
         a.cliente is not null as es_nuevo, a.fecha as fecha_apertura,
         v.cajas_kombucha, v.cajas_cerveza, v.barriles,
         coalesce(pr.productos, '[]'::jsonb) as productos
  from venta v
  left join aperturas a on a.cliente = v.cliente
  left join productos pr on pr.cliente = v.cliente
  left join ultimo ult on ult.cliente = v.cliente
  left join ventas_pedido_ingreso i on i.pedido = ult.pedido
  order by v.ultima_fecha desc nulls last, ult.pedido::bigint desc nulls last, v.neto desc;
$$;

revoke all on function public.plan_metas_retail_detalle_clientes(date, date) from public, anon;
grant execute on function public.plan_metas_retail_detalle_clientes(date, date) to authenticated;
