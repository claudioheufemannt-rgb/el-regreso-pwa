-- Pedido de Claudio (17-nov-2026): "si el pedido sale como pendiente igual lo
-- sumes" — en TODO: Ventas, Metas y Comisión. Un pedido suma al período 24→23
-- en que se TOMÓ (fecha_pedido), esté entregado o no; cuando se entrega no
-- se vuelve a sumar en otro período.
--
-- Reemplaza el criterio anterior (criterio_litros_por_fecha_entrega.sql,
-- comision_gerente_1pct_sobre_entregado.sql): la venta y la comisión sólo
-- contaban lo ENTREGADO, por fecha de entrega.
--
-- Metas (plan_metas_avance / plan_metas_periodo_avance) ya contaban por
-- fecha_pedido incluyendo pendientes: no cambian.
--
-- Qué cambia acá (los dashboards de /ventas pasan a usar p_por_entrega=false
-- desde la app, que ya filtra por fecha_pedido e incluye pendientes):
--   1. Comisiones (gerente y vendedores): fecha_entrega → fecha_pedido.
--   2. "Por entregar" deja de existir sólo en el período vigente
--      (p_fin >= current_date): ahora es el pendiente de los pedidos TOMADOS
--      en ese período — es un desglose informativo del total, no se suma
--      aparte.
--   3. Con p_por_entrega=false el bloque "entregado" de los detalles ya
--      incluye los pendientes: no se vuelven a sumar los pedidos pendientes
--      (doble conteo) ni se listan dos veces en el detalle de un cliente.
--
-- Se aplica por reemplazo de texto sobre la definición vigente de cada
-- función (son ~15 funciones con varias sobrecargas), y falla si alguna de
-- las esperadas no cambió.

DO $mig$
DECLARE
  r record;
  def text;
  nuevo text;
  cambiadas int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname IN (
      'ventas_entregas_periodo', 'ventas_entregas_por_vendedor',
      'ventas_clientes_por_entregar', 'ventas_pedidos_pendientes_cliente',
      'ventas_detalle_clientes', 'ventas_detalle_clientes_por_vendedor',
      'ventas_pedidos_periodo', 'ventas_pedidos_entregados_cliente',
      'comision_gerente_por_entregar', 'comision_gerente_por_cliente',
      'comision_gerente_por_producto', 'comision_gerente_cartera',
      'comision_vendedor_por_canal', 'comision_vendedor_cartera',
      'comision_vendedor_aperturas'
    )
  LOOP
    def := pg_get_functiondef(r.oid);
    nuevo := def;

    -- (2) pendiente = el de los pedidos tomados en el rango, cerrado o no
    nuevo := regexp_replace(nuevo, 'p_fin\s*>=\s*current_date\s+and\s+', '', 'gi');

    -- (3a) pedidos: no sumar dos veces los pendientes cuando "entregado" ya los trae
    IF nuevo ILIKE '%p_por_entrega%' THEN
      nuevo := replace(nuevo,
        'COALESCE(e.pedidos, 0) + COALESCE(p.pedidos_pend, 0)',
        'COALESCE(e.pedidos, 0) + CASE WHEN p_por_entrega THEN COALESCE(p.pedidos_pend, 0) ELSE 0 END');
    END IF;

    -- (3b) detalle de un cliente: "entregados" sólo entregados (los pendientes
    -- vienen de ventas_pedidos_pendientes_cliente)
    IF r.proname = 'ventas_pedidos_entregados_cliente' THEN
      nuevo := regexp_replace(nuevo, 'AND v\.entrega_informada(\s*\n)', 'AND v.entrega_informada AND v.entregado\1');
    END IF;

    -- (1) comisión por fecha de pedido
    IF r.proname LIKE 'comision\_%' THEN
      nuevo := regexp_replace(nuevo, 'v\.fecha_entrega(\s*[<>]=?\s*p_)', 'v.fecha_pedido\1', 'g');
      nuevo := replace(nuevo, 'v.fecha_entrega as fecha', 'v.fecha_pedido as fecha');
    END IF;

    IF nuevo <> def THEN
      EXECUTE nuevo;
      cambiadas := cambiadas + 1;
      RAISE NOTICE 'actualizada: %(%)', r.proname, r.args;
    ELSE
      RAISE NOTICE 'sin cambios: %(%)', r.proname, r.args;
    END IF;
  END LOOP;

  IF cambiadas < 15 THEN
    RAISE EXCEPTION 'Se esperaban al menos 15 funciones actualizadas, cambiaron %', cambiadas;
  END IF;
END
$mig$;
