'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardSidebar from '@/components/DashboardSidebar';
import { supabase } from '@/lib/supabaseClient';
import { loadOwnerWorkspace } from '@/lib/workspace';
import { formatMoney } from '@/lib/booking';

function relationValue(value) { return Array.isArray(value) ? value[0] : value; }
function isMissingUpgrade(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return text.includes('inventory_items') || text.includes('sales') || text.includes('cutflow_create_pos_sale') || text.includes('memberships') || text.includes('vouchers') || text.includes('schema cache') || text.includes('does not exist');
}

export default function PosPage() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState(null);
  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [sales, setSales] = useState([]);
  const [cart, setCart] = useState([]);
  const [itemForm, setItemForm] = useState({ type: 'service', id: '', quantity: '1' });
  const [checkout, setCheckout] = useState({ customerId: '', staffId: '', paymentMethod: 'cash', discount: '0', voucherCode: '', notes: '' });
  const [activeMembership, setActiveMembership] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const nextWorkspace = await loadOwnerWorkspace();
        if (!nextWorkspace.user) { router.replace('/login'); return; }
        if (!nextWorkspace.business) throw new Error('No CutFlow business is attached to this account.');
        if (!active) return;
        setWorkspace(nextWorkspace);
        await refresh(nextWorkspace.business.id);
      } catch (err) {
        if (active) setError(isMissingUpgrade(err) ? 'POS is ready in this CutFlow update, but the V12 POS & Inventory database upgrade still needs to be run in Supabase.' : (err?.message || 'Could not load POS.'));
      } finally { if (active) setLoading(false); }
    }
    boot();
    return () => { active = false; };
  }, [router]);

  async function refresh(businessId = workspace?.business?.id) {
    if (!businessId) return;
    const [serviceResult, productResult, customerResult, staffResult, salesResult] = await Promise.all([
      supabase.from('services').select('id, name, price, category').eq('business_id', businessId).eq('is_active', true).order('name'),
      supabase.from('inventory_items').select('id, name, selling_price, quantity_on_hand, reorder_level, sku').eq('business_id', businessId).eq('is_active', true).order('name'),
      supabase.from('customers').select('id, full_name, phone').eq('business_id', businessId).order('full_name').limit(500),
      supabase.from('staff').select('id, full_name, job_title').eq('business_id', businessId).eq('is_active', true).order('full_name'),
      supabase.from('sales').select('id, total, payment_method, created_at, customers(full_name), staff(full_name)').eq('business_id', businessId).order('created_at', { ascending: false }).limit(50),
    ]);
    for (const result of [serviceResult, productResult, customerResult, staffResult, salesResult]) if (result.error) throw result.error;
    setServices(serviceResult.data || []); setProducts(productResult.data || []); setCustomers(customerResult.data || []); setStaff(staffResult.data || []); setSales(salesResult.data || []);
  }


  useEffect(() => {
    let active = true;
    async function loadMembership() {
      setActiveMembership(null);
      if (!checkout.customerId || !workspace?.business?.id) return;
      const { data, error: membershipError } = await supabase
        .from('customer_memberships')
        .select('id, ends_at, status, memberships(name, discount_percent)')
        .eq('business_id', workspace.business.id)
        .eq('customer_id', checkout.customerId)
        .eq('status', 'active')
        .gt('ends_at', new Date().toISOString())
        .order('ends_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (!membershipError) setActiveMembership(data || null);
    }
    loadMembership();
    return () => { active = false; };
  }, [checkout.customerId, workspace?.business?.id]);

  const options = itemForm.type === 'service' ? services : products;
  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.quantity || 0), 0), [cart]);
  const discount = Math.min(subtotal, Math.max(0, Number(checkout.discount || 0)));
  const total = Math.max(0, subtotal - discount);
  const todaySales = useMemo(() => { const today = new Date().toDateString(); return sales.filter((sale) => new Date(sale.created_at).toDateString() === today); }, [sales]);
  const todayRevenue = useMemo(() => todaySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0), [todaySales]);
  const lowStock = useMemo(() => products.filter((product) => Number(product.quantity_on_hand || 0) <= Number(product.reorder_level || 0)).length, [products]);

  function addItem(event) {
    event.preventDefault(); setError(''); setMessage('');
    const source = options.find((item) => item.id === itemForm.id);
    if (!source) { setError('Choose an item to add.'); return; }
    const quantity = Number(itemForm.quantity || 0);
    if (!(quantity > 0)) { setError('Quantity must be greater than zero.'); return; }
    const key = `${itemForm.type}:${source.id}`;
    const existingQuantity = cart.find((item) => item.key === key)?.quantity || 0;
    if (itemForm.type === 'product' && (existingQuantity + quantity) > Number(source.quantity_on_hand || 0)) { setError(`Only ${source.quantity_on_hand} of ${source.name} is in stock.`); return; }
    const unitPrice = Number(itemForm.type === 'service' ? source.price : source.selling_price);
    setCart((current) => {
      const existing = current.find((item) => item.key === key);
      if (existing) return current.map((item) => item.key === key ? { ...item, quantity: item.quantity + quantity } : item);
      return [...current, { key, type: itemForm.type, id: source.id, name: source.name, quantity, unitPrice }];
    });
    setItemForm((current) => ({ ...current, id: '', quantity: '1' }));
  }

  function removeItem(key) { setCart((current) => current.filter((item) => item.key !== key)); }

  async function checkoutSale() {
    if (!workspace?.business || !cart.length) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const payloadItems = cart.map((item) => ({ item_type: item.type, item_id: item.id, quantity: item.quantity }));
      const { data, error: rpcError } = await supabase.rpc('cutflow_create_pos_sale_v2', {
        p_business_id: workspace.business.id,
        p_branch_id: workspace.branch?.id || null,
        p_customer_id: checkout.customerId || null,
        p_staff_id: checkout.staffId || null,
        p_payment_method: checkout.paymentMethod,
        p_discount_amount: Number(checkout.discount || 0),
        p_items: payloadItems,
        p_notes: checkout.notes.trim() || null,
        p_voucher_code: checkout.paymentMethod === 'voucher' ? (checkout.voucherCode.trim() || null) : null,
      });
      if (rpcError) throw rpcError;
      setCart([]);
      setCheckout({ customerId: '', staffId: '', paymentMethod: 'cash', discount: '0', voucherCode: '', notes: '' });
      setActiveMembership(null);
      setMessage(`Sale completed${data?.receipt_number ? ` • Receipt ${data.receipt_number}` : ''} • ${formatMoney(data?.total ?? total)}.`);
      await refresh();
    } catch (err) {
      setError(isMissingUpgrade(err) ? 'Run the V12 POS/Inventory and V12.2 Memberships/Vouchers upgrades before using this POS.' : (err?.message || 'Could not complete this sale.'));
    } finally { setSaving(false); }
  }

  if (loading) return <main className="loading-shell"><div className="loading-card"><div className="brand-mark">CF</div><h1>Loading POS…</h1></div></main>;

  return (
    <main className="dashboard-shell"><DashboardSidebar /><section className="dashboard-content">
      <header className="dashboard-header"><div><p className="eyebrow">CHECKOUT</p><h1>POS</h1><p className="muted">Sell services and retail products without changing your existing booking workflow.</p></div><div className="header-metric"><strong>{formatMoney(todayRevenue)}</strong><span>POS revenue today</span></div></header>
      <section className="stats-grid stats-grid-three"><article className="stat-card"><p>Sales today</p><strong>{todaySales.length}</strong></article><article className="stat-card"><p>Cart total</p><strong>{formatMoney(total)}</strong></article><article className="stat-card"><p>Out of stock</p><strong>{lowStock}</strong></article></section>

      <section className="management-grid">
        <article className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">NEW SALE</p><h2>Add to sale</h2></div></div>
          <form className="form-stack" onSubmit={addItem}>
            <div className="form-grid compact-grid"><label>Item type<select value={itemForm.type} onChange={(e) => setItemForm({ type: e.target.value, id: '', quantity: '1' })}><option value="service">Service</option><option value="product">Product</option></select></label><label>Quantity<input type="number" min="0.01" step="0.01" value={itemForm.quantity} onChange={(e) => setItemForm((current) => ({ ...current, quantity: e.target.value }))} required /></label></div>
            <label>{itemForm.type === 'service' ? 'Service' : 'Product'}<select value={itemForm.id} onChange={(e) => setItemForm((current) => ({ ...current, id: e.target.value }))} required><option value="">Choose {itemForm.type}</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name} — {formatMoney(itemForm.type === 'service' ? item.price : item.selling_price)}{itemForm.type === 'product' ? ` • ${item.quantity_on_hand} in stock` : ''}</option>)}</select></label>
            <button className="button button-secondary">Add to cart</button>
          </form>

          <div className="panel-heading" style={{ marginTop: 28 }}><div><p className="eyebrow">CHECKOUT DETAILS</p><h2>Complete sale</h2></div></div>
          <div className="form-stack">
            <label>Customer<select value={checkout.customerId} onChange={(e) => setCheckout((current) => ({ ...current, customerId: e.target.value }))}><option value="">Walk-in / no customer selected</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}{customer.phone ? ` • ${customer.phone}` : ''}</option>)}</select></label>
            <label>Staff member<select value={checkout.staffId} onChange={(e) => setCheckout((current) => ({ ...current, staffId: e.target.value }))}><option value="">No staff selected</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.full_name}{member.job_title ? ` • ${member.job_title}` : ''}</option>)}</select></label>
            <div className="form-grid compact-grid"><label>Payment method<select value={checkout.paymentMethod} onChange={(e) => setCheckout((current) => ({ ...current, paymentMethod: e.target.value, voucherCode: e.target.value === 'voucher' ? current.voucherCode : '' }))}><option value="cash">Cash</option><option value="card">Card</option><option value="eft">EFT</option><option value="yoco">Yoco</option><option value="payfast">PayFast</option><option value="ozow">Ozow</option><option value="voucher">Voucher</option><option value="other">Other</option></select></label><label>Discount (R)<input type="number" min="0" step="0.01" value={checkout.discount} onChange={(e) => setCheckout((current) => ({ ...current, discount: e.target.value }))} /></label></div>
            {checkout.paymentMethod === 'voucher' ? <label>Voucher code<input value={checkout.voucherCode} onChange={(e) => setCheckout((current) => ({ ...current, voucherCode: e.target.value.toUpperCase() }))} placeholder="Enter active voucher code" required /></label> : null}
            {activeMembership ? (() => { const plan = relationValue(activeMembership.memberships); const rate = Number(plan?.discount_percent || 0); const memberDiscount = Math.round(subtotal * rate) / 100; return <div className="integration-note"><strong>{plan?.name || 'Active membership'} • {rate}% discount</strong><span>Valid until {new Date(activeMembership.ends_at).toLocaleDateString('en-ZA')}.</span>{rate > 0 ? <button type="button" className="button button-small button-secondary" onClick={() => setCheckout((current) => ({ ...current, discount: String(memberDiscount.toFixed(2)) }))}>Apply member discount ({formatMoney(memberDiscount)})</button> : null}</div>; })() : null}
            <label>Notes<textarea rows="3" value={checkout.notes} onChange={(e) => setCheckout((current) => ({ ...current, notes: e.target.value }))} /></label>
            <div className="inline-summary"><span>Subtotal</span><strong>{formatMoney(subtotal)}</strong><span>Discount</span><strong>−{formatMoney(discount)}</strong><span>Total</span><strong>{formatMoney(total)}</strong></div>
            {error ? <p className="form-message error">{error}</p> : null}{message ? <p className="form-message success">{message}</p> : null}
            <button type="button" className="button button-primary" disabled={saving || !cart.length} onClick={checkoutSale}>{saving ? 'Completing sale…' : 'Complete sale'}</button>
          </div>
        </article>

        <article className="panel list-panel"><div className="panel-heading"><div><p className="eyebrow">CURRENT SALE</p><h2>{cart.length} item{cart.length === 1 ? '' : 's'} in cart</h2></div>{cart.length ? <button className="text-button" onClick={() => setCart([])}>Clear cart</button> : null}</div>
          {cart.length ? <div className="record-list">{cart.map((item) => <div className="record-card" key={item.key}><div className="record-main"><div className="record-title-row"><h3>{item.name}</h3><strong>{formatMoney(item.unitPrice * item.quantity)}</strong></div><p>{item.type === 'service' ? 'Service' : 'Product'} • Qty {item.quantity} • {formatMoney(item.unitPrice)} each</p><div className="record-actions"><button className="button button-small button-secondary" onClick={() => removeItem(item.key)}>Remove</button></div></div></div>)}</div> : <div className="empty-state"><h3>Cart is empty</h3><p>Add an existing service or inventory product to begin a sale.</p></div>}

          <div className="panel-heading" style={{ marginTop: 32 }}><div><p className="eyebrow">RECENT POS SALES</p><h2>Latest transactions</h2></div></div>
          {sales.length ? <div className="record-list">{sales.slice(0, 20).map((sale) => { const customer = relationValue(sale.customers); const member = relationValue(sale.staff); return <div className="record-card payment-record" key={sale.id}><div className="money-badge">+</div><div className="record-main"><div className="record-title-row"><h3>{sale.payment_method.toUpperCase()} sale</h3><strong>{formatMoney(sale.total)}</strong></div><p>{new Date(sale.created_at).toLocaleString('en-ZA')} • {customer?.full_name || 'Walk-in customer'}</p><p>{member?.full_name ? `Served by ${member.full_name}` : 'No staff member selected'}</p></div></div>; })}</div> : <div className="empty-state"><h3>No POS sales yet</h3><p>Your completed POS transactions will appear here.</p></div>}
        </article>
      </section>
    </section></main>
  );
}
