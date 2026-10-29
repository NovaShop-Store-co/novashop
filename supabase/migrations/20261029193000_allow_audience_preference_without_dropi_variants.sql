-- Allow a customer to choose an audience/cut even before Dropi variant IDs are mapped.
-- Mapped Dropi combinations still use per-variant inventory; unmapped cuts use product-level inventory.

create or replace function private.apply_order_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  affected integer;
  available integer;
begin
  if not old.stock_committed and new.status in ('paid','preparing','shipped','delivered') then
    for item in
      select oi.product_id,
             oi.selected_audience,
             oi.selected_variant,
             oi.selected_size,
             coalesce(oi.selected_audience,'') || '|' ||
               lower(coalesce(oi.selected_variant,'')) || '|' ||
               lower(coalesce(oi.selected_size,'')) as variant_key,
             sum(oi.quantity)::integer as quantity
      from public.order_items oi
      where oi.order_id=new.id
      group by oi.product_id,oi.selected_audience,oi.selected_variant,oi.selected_size
      order by oi.product_id,variant_key
    loop
      if item.selected_audience is not null and exists (
        select 1 from public.product_variants v where v.product_id=item.product_id
      ) then
        update public.product_variants v
          set stock_quantity=v.stock_quantity-item.quantity,updated_at=now()
        where v.product_id=item.product_id
          and v.audience=item.selected_audience
          and lower(v.color)=lower(coalesce(item.selected_variant,''))
          and lower(v.size)=lower(coalesce(item.selected_size,''))
          and v.stock_quantity>=item.quantity;
        get diagnostics affected=row_count;
        if affected<>1 then
          select v.stock_quantity into available
          from public.product_variants v
          where v.product_id=item.product_id
            and v.audience=item.selected_audience
            and lower(v.color)=lower(coalesce(item.selected_variant,''))
            and lower(v.size)=lower(coalesce(item.selected_size,''));
          raise exception 'NOVASHOP_STOCK_INSUFFICIENT product=% variant=% available=%',
            item.product_id,item.variant_key,coalesce(available,0) using errcode='P0001';
        end if;
        insert into public.order_stock_adjustments(
          order_id,product_id,quantity,variant_key,selected_audience,selected_variant,selected_size
        ) values (
          new.id,item.product_id,item.quantity,item.variant_key,item.selected_audience,item.selected_variant,item.selected_size
        )
        on conflict(order_id,product_id,variant_key) do update set quantity=excluded.quantity;
      else
        update public.products p
          set stock_quantity=p.stock_quantity-item.quantity,updated_at=now()
        where p.id=item.product_id and p.stock_quantity is not null and p.stock_quantity>=item.quantity;
        get diagnostics affected=row_count;
        if affected=1 then
          -- Keep the exact combination as a unique adjustment key, but NULL audience makes
          -- cancellation restore product-level stock rather than looking for a Dropi row.
          insert into public.order_stock_adjustments(
            order_id,product_id,quantity,variant_key,selected_audience,selected_variant,selected_size
          ) values (
            new.id,item.product_id,item.quantity,item.variant_key,null,item.selected_variant,item.selected_size
          )
          on conflict(order_id,product_id,variant_key) do update set quantity=excluded.quantity;
        else
          select p.stock_quantity into available from public.products p where p.id=item.product_id;
          if available is not null then
            raise exception 'NOVASHOP_STOCK_INSUFFICIENT product=% available=%',
              item.product_id,available using errcode='P0001';
          end if;
        end if;
      end if;
    end loop;
    new.stock_committed:=true;
  elsif old.stock_committed
    and new.status in ('cancelled','payment_failed')
    and old.status not in ('shipped','delivered')
    and old.shipped_at is null then
    for item in
      select a.* from public.order_stock_adjustments a
      where a.order_id=new.id order by a.product_id,a.variant_key
    loop
      if coalesce(item.selected_audience,'')<>'' then
        update public.product_variants v
          set stock_quantity=v.stock_quantity+item.quantity,updated_at=now()
        where v.product_id=item.product_id
          and v.audience=item.selected_audience
          and lower(v.color)=lower(coalesce(item.selected_variant,''))
          and lower(v.size)=lower(coalesce(item.selected_size,''));
      else
        update public.products p set stock_quantity=p.stock_quantity+item.quantity,updated_at=now()
        where p.id=item.product_id and p.stock_quantity is not null;
      end if;
    end loop;
    delete from public.order_stock_adjustments where order_id=new.id;
    new.stock_committed:=false;
  end if;
  return new;
end;
$$;

revoke all on function private.apply_order_stock() from public,anon,authenticated;
drop trigger if exists apply_novashop_order_stock on public.orders;
create trigger apply_novashop_order_stock
before update of status on public.orders
for each row when (old.status is distinct from new.status)
execute function private.apply_order_stock();
