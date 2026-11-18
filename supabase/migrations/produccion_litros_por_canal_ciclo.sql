-- Litros vendidos por tipo de cliente y ciclo (24→23), para proyectar la
-- demanda de Producción por canal (pestaña Demanda, 18-nov-2026).
-- Mismo criterio que el forecast: por fecha de PEDIDO, sin clientes internos
-- (los que se guardan en ventas y Producción excluye: 'cliente metas base camp').
-- Canal: BaseCamp y PDV por nombre; el resto por ventas.categoria_negocio
-- (rubro del local; en combinaciones "Cafetería, Minimarket" manda el primero).
-- Ya aplicada en producción el 18-nov-2026.
create or replace function public.produccion_litros_por_canal_ciclo(p_desde date)
returns table(ciclo date, canal text, litros numeric)
language sql stable security invoker set search_path = public as $$
  with v as (
    select
      case when extract(day from fecha_pedido) >= 24
           then (date_trunc('month', fecha_pedido) + interval '1 month')::date
           else date_trunc('month', fecha_pedido)::date end as ciclo,
      lower(coalesce(nombre_fantasia, '')) as cli,
      lower(trim(split_part(coalesce(categoria_negocio, ''), ',', 1))) as rubro,
      litros
    from ventas
    where fecha_pedido >= p_desde and litros is not null
      and lower(coalesce(nombre_fantasia, '')) not like '%cliente metas base camp%'
  )
  select ciclo,
    case
      when cli like '%basecamp%' or cli like '%base camp%' then 'basecamp'
      when cli like '%cliente pdv%' or cli like '%cliente feria%' or cli like '%evento%'
        or rubro like 'cliente directo%' then 'pdv'
      when rubro in ('bar', 'restaurante', 'cafetería', 'cafeteria', 'actividades turísticas', 'actividades turisticas') then 'horeca'
      when rubro in ('supermercado', 'minimarket', 'almacén', 'almacen', 'botillería', 'botilleria') then 'retail'
      when rubro = 'distribuidor' then 'distribuidor'
      else 'otros'
    end as canal,
    sum(litros) as litros
  from v
  group by 1, 2
$$;

comment on function public.produccion_litros_por_canal_ciclo(date) is
  'Litros por tipo de cliente (basecamp, pdv, horeca, retail, distribuidor, otros) y ciclo 24→23, por fecha de pedido. Pestaña Demanda de Producción.';
