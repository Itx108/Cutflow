-- CutFlow v12: reliable POS + inventory foundation.
-- Additive only: no existing v11.2 tables are deleted or renamed.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid null references public.branches(id) on delete set null,
  sku text null,
  name text not null,
  category text null,
  description text null,
  sale_price numeric(12,2) not null default 0 check (sale_price >= 0),
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  stock_quantity numeric(12,3) not null default 0,
  reorder_level numeric(12,3) not null default 0 check (reorder_level >= 0),
  track_stock boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists products_business_sku_uidx on public.products (business_id, sku) where sku is not null;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number text not null,
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid null references public.branches(id) on delete set null,
  customer_id uuid null references public.customers(id) on delete set null,
  appointment_id uuid null references public.appointments(id) on delete set null,
  staff_id uuid null references public.staff(id) on delete set null,
  subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partial','paid','refunded')),
  status text not null default 'completed' check (status in ('draft','completed','voided','refunded')),
  notes text null,
  created_by uuid null,
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (business_id, sale_number)
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_type text not null check (item_type in ('service','product')),
  service_id uuid null references public.services(id) on delete set null,
  product_id uuid null references public.products(id) on delete set null,
  staff_id uuid null references public.staff(id) on delete set null,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  commission_percent numeric(7,3) null,
  commission_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  check ((item_type='service' and service_id is not null and product_id is null) or (item_type='product' and product_id is not null and service_id is null))
);

create table if not exists public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  method text not null,
  amount numeric(12,2) not null check (amount > 0),
  reference text null,
  status text not null default 'paid' check (status in ('pending','paid','failed','refunded')),
  paid_at timestamptz null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid null references public.branches(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  movement_type text not null check (movement_type in ('opening','purchase','sale','adjustment','return','waste')),
  quantity_delta numeric(12,3) not null check (quantity_delta <> 0),
  unit_cost numeric(12,2) null,
  reference_type text null,
  reference_id uuid null,
  notes text null,
  created_by uuid null,
  created_at timestamptz not null default now()
);
create index if not exists products_business_idx on public.products(business_id);
create index if not exists sales_business_sold_idx on public.sales(business_id, sold_at desc);
create index if not exists sale_items_sale_idx on public.sale_items(sale_id);
create index if not exists sale_payments_sale_idx on public.sale_payments(sale_id);
create index if not exists stock_movements_product_idx on public.stock_movements(product_id, created_at desc);

alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;
alter table public.stock_movements enable row level security;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.sales to authenticated;
grant select, insert, update, delete on public.sale_items to authenticated;
grant select, insert, update, delete on public.sale_payments to authenticated;
grant select, insert, update, delete on public.stock_movements to authenticated;

create or replace function public.cutflow_v12_can_access_business(p_business_id uuid)
returns boolean language sql stable security invoker set search_path=public as $$
  select exists(select 1 from public.businesses b where b.id=p_business_id and b.owner_id=(select auth.uid()))
  or exists(select 1 from public.business_members bm where bm.business_id=p_business_id and bm.user_id=(select auth.uid()));
$$;
revoke all on function public.cutflow_v12_can_access_business(uuid) from public, anon;
grant execute on function public.cutflow_v12_can_access_business(uuid) to authenticated;

drop policy if exists cutflow_business_access on public.products;
create policy cutflow_business_access on public.products for all to authenticated
using (public.cutflow_v12_can_access_business(products.business_id))
with check (public.cutflow_v12_can_access_business(products.business_id));

drop policy if exists cutflow_business_access on public.sales;
create policy cutflow_business_access on public.sales for all to authenticated
using (public.cutflow_v12_can_access_business(sales.business_id))
with check (public.cutflow_v12_can_access_business(sales.business_id));

drop policy if exists cutflow_business_access on public.sale_items;
create policy cutflow_business_access on public.sale_items for all to authenticated
using (public.cutflow_v12_can_access_business(sale_items.business_id) and exists(select 1 from public.sales s where s.id=sale_items.sale_id and s.business_id=sale_items.business_id))
with check (public.cutflow_v12_can_access_business(sale_items.business_id) and exists(select 1 from public.sales s where s.id=sale_items.sale_id and s.business_id=sale_items.business_id) and (sale_items.product_id is null or exists(select 1 from public.products p where p.id=sale_items.product_id and p.business_id=sale_items.business_id)) and (sale_items.service_id is null or exists(select 1 from public.services sv where sv.id=sale_items.service_id and sv.business_id=sale_items.business_id)));

drop policy if exists cutflow_business_access on public.sale_payments;
create policy cutflow_business_access on public.sale_payments for all to authenticated
using (public.cutflow_v12_can_access_business(sale_payments.business_id) and exists(select 1 from public.sales s where s.id=sale_payments.sale_id and s.business_id=sale_payments.business_id))
with check (public.cutflow_v12_can_access_business(sale_payments.business_id) and exists(select 1 from public.sales s where s.id=sale_payments.sale_id and s.business_id=sale_payments.business_id));

drop policy if exists cutflow_business_access on public.stock_movements;
create policy cutflow_business_access on public.stock_movements for all to authenticated
using (public.cutflow_v12_can_access_business(stock_movements.business_id) and exists(select 1 from public.products p where p.id=stock_movements.product_id and p.business_id=stock_movements.business_id))
with check (public.cutflow_v12_can_access_business(stock_movements.business_id) and exists(select 1 from public.products p where p.id=stock_movements.product_id and p.business_id=stock_movements.business_id));

create or replace function public.adjust_cutflow_stock(p_product_id uuid,p_quantity_delta numeric,p_reason text default 'Stock adjustment')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_product public.products%rowtype;
begin
  if p_quantity_delta=0 then raise exception 'Quantity change cannot be zero'; end if;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if not public.cutflow_v12_can_access_business(v_product.business_id) then raise exception 'Not authorised for this business'; end if;
  if v_product.track_stock and v_product.stock_quantity+p_quantity_delta<0 then raise exception 'Insufficient stock'; end if;
  update public.products set stock_quantity=stock_quantity+p_quantity_delta,updated_at=now() where id=p_product_id;
  insert into public.stock_movements(business_id,branch_id,product_id,movement_type,quantity_delta,notes,created_by) values(v_product.business_id,v_product.branch_id,p_product_id,'adjustment',p_quantity_delta,nullif(trim(p_reason),''),(select auth.uid()));
  return jsonb_build_object('product_id',p_product_id,'stock_quantity',v_product.stock_quantity+p_quantity_delta);
end $$;
revoke all on function public.adjust_cutflow_stock(uuid,numeric,text) from public, anon;
grant execute on function public.adjust_cutflow_stock(uuid,numeric,text) to authenticated;

create or replace function public.create_cutflow_sale(p_business_id uuid,p_branch_id uuid,p_customer_id uuid,p_staff_id uuid,p_items jsonb,p_payments jsonb default '[]'::jsonb,p_notes text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_sale_id uuid;v_sale_number text;v_subtotal numeric(12,2):=0;v_discount numeric(12,2):=0;v_total numeric(12,2):=0;v_paid numeric(12,2):=0;v_item jsonb;v_payment jsonb;v_product public.products%rowtype;v_line numeric(12,2);v_qty numeric(12,3);v_price numeric(12,2);v_item_discount numeric(12,2);v_staff uuid;v_commission_pct numeric(7,3);v_commission numeric(12,2);
begin
  if not public.cutflow_v12_can_access_business(p_business_id) then raise exception 'Not authorised for this business'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Sale needs at least one item'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=greatest(0.001,coalesce((v_item->>'quantity')::numeric,1));v_price:=greatest(0,coalesce((v_item->>'unit_price')::numeric,0));v_item_discount:=greatest(0,coalesce((v_item->>'discount_amount')::numeric,0));v_line:=greatest(0,round((v_qty*v_price-v_item_discount)::numeric,2));v_subtotal:=v_subtotal+round((v_qty*v_price)::numeric,2);v_discount:=v_discount+v_item_discount;v_total:=v_total+v_line;
  end loop;
  v_sale_number:='CF-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
  insert into public.sales(sale_number,business_id,branch_id,customer_id,staff_id,subtotal,discount_amount,total_amount,notes,created_by) values(v_sale_number,p_business_id,p_branch_id,p_customer_id,p_staff_id,v_subtotal,v_discount,v_total,p_notes,(select auth.uid())) returning id into v_sale_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=greatest(0.001,coalesce((v_item->>'quantity')::numeric,1));v_price:=greatest(0,coalesce((v_item->>'unit_price')::numeric,0));v_item_discount:=greatest(0,coalesce((v_item->>'discount_amount')::numeric,0));v_line:=greatest(0,round((v_qty*v_price-v_item_discount)::numeric,2));v_staff:=coalesce(nullif(v_item->>'staff_id','')::uuid,p_staff_id);select commission_percent into v_commission_pct from public.staff where id=v_staff and business_id=p_business_id;v_commission:=round(v_line*coalesce(v_commission_pct,0)/100,2);
    if v_item->>'item_type'='product' then select * into v_product from public.products where id=(v_item->>'product_id')::uuid and business_id=p_business_id for update;if not found then raise exception 'Product not found';end if;if v_product.track_stock and v_product.stock_quantity<v_qty then raise exception 'Insufficient stock for %',v_product.name;end if;if v_product.track_stock then update public.products set stock_quantity=stock_quantity-v_qty,updated_at=now() where id=v_product.id;insert into public.stock_movements(business_id,branch_id,product_id,movement_type,quantity_delta,reference_type,reference_id,created_by) values(p_business_id,coalesce(p_branch_id,v_product.branch_id),v_product.id,'sale',-v_qty,'sale',v_sale_id,(select auth.uid()));end if;end if;
    insert into public.sale_items(sale_id,business_id,item_type,service_id,product_id,staff_id,description,quantity,unit_price,discount_amount,line_total,commission_percent,commission_amount) values(v_sale_id,p_business_id,v_item->>'item_type',nullif(v_item->>'service_id','')::uuid,nullif(v_item->>'product_id','')::uuid,v_staff,coalesce(nullif(v_item->>'description',''),'Item'),v_qty,v_price,v_item_discount,v_line,v_commission_pct,v_commission);
  end loop;
  if p_payments is not null and jsonb_typeof(p_payments)='array' then for v_payment in select * from jsonb_array_elements(p_payments) loop if coalesce((v_payment->>'amount')::numeric,0)>0 then insert into public.sale_payments(sale_id,business_id,method,amount,reference,status) values(v_sale_id,p_business_id,coalesce(nullif(v_payment->>'method',''),'cash'),(v_payment->>'amount')::numeric,nullif(v_payment->>'reference',''),'paid');v_paid:=v_paid+(v_payment->>'amount')::numeric;end if;end loop;end if;
  update public.sales set payment_status=case when v_paid>=v_total then 'paid' when v_paid>0 then 'partial' else 'unpaid' end where id=v_sale_id;
  return jsonb_build_object('sale_id',v_sale_id,'sale_number',v_sale_number,'total',v_total,'paid',v_paid);
end $$;
revoke all on function public.create_cutflow_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,text) from public, anon;
grant execute on function public.create_cutflow_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,text) to authenticated;
