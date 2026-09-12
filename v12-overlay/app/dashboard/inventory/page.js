'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardSidebar from '@/components/DashboardSidebar';
import { supabase } from '@/lib/supabaseClient';
import { loadOwnerWorkspace } from '@/lib/workspace';
import { formatMoney } from '@/lib/booking';

const emptyForm = {
  name: '',
  sku: '',
  category: '',
  branchId: '',
  costPrice: '',
  sellingPrice: '',
  reorderLevel: '0',
  openingQuantity: '0',
};

const emptyAdjustment = { direction: 'add', quantity: '1', reason: 'purchase', reference: '', notes: '' };

function isMissingUpgrade(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return text.includes('inventory_items') || text.includes('schema cache') || text.includes('does not exist');
}

export default function InventoryPage() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState(null);
  const [items, setItems] = useState([]);
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [adjustingItem, setAdjustingItem] = useState(null);
  const [adjustment, setAdjustment] = useState(emptyAdjustment);
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
        const branchResult = await supabase.from('branches').select('id, name').eq('business_id', nextWorkspace.business.id).eq('is_active', true).order('created_at');
        if (branchResult.error) throw branchResult.error;
        setBranches(branchResult.data || []);
        setForm((current) => ({ ...current, branchId: nextWorkspace.branch?.id || branchResult.data?.[0]?.id || '' }));
        await refresh(nextWorkspace.business.id);
      } catch (err) {
        if (active) setError(isMissingUpgrade(err) ? 'Inventory is ready in this CutFlow update, but the V12 POS & Inventory database upgrade still needs to be run in Supabase.' : (err?.message || 'Could not load inventory.'));
      } finally {
        if (active) setLoading(false);
      }
    }
    boot();
    return () => { active = false; };
  }, [router]);

  async function refresh(businessId = workspace?.business?.id) {
    if (!businessId) return;
    const { data, error: inventoryError } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('business_id', businessId)
      .order('name', { ascending: true });
    if (inventoryError) throw inventoryError;
    setItems(data || []);
  }

  const activeItems = useMemo(() => items.filter((item) => item.is_active), [items]);
  const lowStock = useMemo(() => activeItems.filter((item) => Number(item.quantity_on_hand || 0) <= Number(item.reorder_level || 0)), [activeItems]);
  const stockUnits = useMemo(() => activeItems.reduce((sum, item) => sum + Number(item.quantity_on_hand || 0), 0), [activeItems]);
  const stockValue = useMemo(() => activeItems.reduce((sum, item) => sum + (Number(item.quantity_on_hand || 0) * Number(item.cost_price || 0)), 0), [activeItems]);

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function startEdit(item) {
    setAdjustingItem(null);
    setEditingId(item.id);
    setForm({
      name: item.name || '',
      sku: item.sku || '',
      category: item.category || '',
      branchId: item.branch_id || '',
      costPrice: String(item.cost_price ?? ''),
      sellingPrice: String(item.selling_price ?? ''),
      reorderLevel: String(item.reorder_level ?? 0),
      openingQuantity: '0',
    });
    setMessage(''); setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startAdjustment(item) {
    setEditingId(null);
    setAdjustingItem(item);
    setAdjustment(emptyAdjustment);
    setMessage(''); setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setEditingId(null);
    setAdjustingItem(null);
    setForm({ ...emptyForm, branchId: workspace?.branch?.id || branches[0]?.id || '' });
    setAdjustment(emptyAdjustment);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!workspace?.business) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const payload = {
        business_id: workspace.business.id,
        branch_id: form.branchId || null,
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        category: form.category.trim() || null,
        cost_price: Number(form.costPrice || 0),
        selling_price: Number(form.sellingPrice || 0),
        reorder_level: Number(form.reorderLevel || 0),
      };

      if (editingId) {
        const { error: updateError } = await supabase.from('inventory_items').update(payload).eq('id', editingId);
        if (updateError) throw updateError;
        setMessage('Inventory item updated.');
      } else {
        const { data, error: insertError } = await supabase.from('inventory_items').insert({ ...payload, quantity_on_hand: 0 }).select('id').single();
        if (insertError) throw insertError;
        const openingQuantity = Number(form.openingQuantity || 0);
        if (openingQuantity > 0) {
          const { error: stockError } = await supabase.rpc('cutflow_adjust_inventory_stock', {
            p_item_id: data.id,
            p_quantity_change: openingQuantity,
            p_movement_type: 'opening',
            p_reference: null,
            p_notes: 'Opening stock',
          });
          if (stockError) throw stockError;
        }
        setMessage('Inventory item added.');
      }
      await refresh();
      resetForm();
    } catch (err) {
      setError(isMissingUpgrade(err) ? 'Run supabase/UPGRADE_V12_POS_INVENTORY.sql before using Inventory.' : (err?.message || 'Could not save this inventory item.'));
    } finally { setSaving(false); }
  }

  async function handleAdjustment(event) {
    event.preventDefault();
    if (!adjustingItem) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const quantity = Number(adjustment.quantity || 0);
      if (!(quantity > 0)) throw new Error('Enter a quantity greater than zero.');
      const signedQuantity = adjustment.direction === 'remove' ? -quantity : quantity;
      const movementType = adjustment.direction === 'remove' && adjustment.reason === 'purchase' ? 'adjustment' : adjustment.reason;
      const { error: rpcError } = await supabase.rpc('cutflow_adjust_inventory_stock', {
        p_item_id: adjustingItem.id,
        p_quantity_change: signedQuantity,
        p_movement_type: movementType,
        p_reference: adjustment.reference.trim() || null,
        p_notes: adjustment.notes.trim() || null,
      });
      if (rpcError) throw rpcError;
      setMessage(`Stock updated for ${adjustingItem.name}.`);
      await refresh();
      resetForm();
    } catch (err) {
      setError(err?.message || 'Could not adjust stock.');
    } finally { setSaving(false); }
  }

  async function toggleActive(item) {
    setError(''); setMessage('');
    const { error: updateError } = await supabase.from('inventory_items').update({ is_active: !item.is_active }).eq('id', item.id);
    if (updateError) { setError(updateError.message); return; }
    setMessage(item.is_active ? `${item.name} deactivated.` : `${item.name} reactivated.`);
    await refresh();
  }

  if (loading) return <main className="loading-shell"><div className="loading-card"><div className="brand-mark">CF</div><h1>Loading inventory…</h1></div></main>;

  return (
    <main className="dashboard-shell"><DashboardSidebar /><section className="dashboard-content">
      <header className="dashboard-header"><div><p className="eyebrow">STOCK CONTROL</p><h1>Inventory</h1><p className="muted">Track retail products, professional stock and low-stock levels.</p></div><div className="header-metric"><strong>{formatMoney(stockValue)}</strong><span>stock cost value</span></div></header>
      <section className="stats-grid stats-grid-three"><article className="stat-card"><p>Active items</p><strong>{activeItems.length}</strong></article><article className="stat-card"><p>Units on hand</p><strong>{stockUnits}</strong></article><article className="stat-card"><p>Low stock</p><strong>{lowStock.length}</strong></article></section>

      <section className="management-grid">
        <article className="panel form-panel">
          {adjustingItem ? (
            <><div className="panel-heading"><div><p className="eyebrow">STOCK MOVEMENT</p><h2>Adjust {adjustingItem.name}</h2></div><button className="text-button" onClick={resetForm}>Cancel</button></div>
            <div className="inline-summary"><span>Current stock</span><strong>{Number(adjustingItem.quantity_on_hand || 0)}</strong><span>Reorder level</span><strong>{Number(adjustingItem.reorder_level || 0)}</strong></div>
            <form className="form-stack" onSubmit={handleAdjustment}>
              <div className="form-grid compact-grid"><label>Action<select value={adjustment.direction} onChange={(e) => setAdjustment((current) => ({ ...current, direction: e.target.value }))}><option value="add">Add stock</option><option value="remove">Remove stock</option></select></label><label>Quantity<input type="number" min="0.01" step="0.01" value={adjustment.quantity} onChange={(e) => setAdjustment((current) => ({ ...current, quantity: e.target.value }))} required /></label></div>
              <label>Reason<select value={adjustment.reason} onChange={(e) => setAdjustment((current) => ({ ...current, reason: e.target.value }))}><option value="purchase">Stock purchase / delivery</option><option value="adjustment">Manual adjustment</option><option value="return">Return</option><option value="write_off">Damaged / write-off</option></select></label>
              <label>Reference<input value={adjustment.reference} onChange={(e) => setAdjustment((current) => ({ ...current, reference: e.target.value }))} placeholder="Invoice, supplier or stocktake reference" /></label>
              <label>Notes<textarea rows="3" value={adjustment.notes} onChange={(e) => setAdjustment((current) => ({ ...current, notes: e.target.value }))} /></label>
              {error ? <p className="form-message error">{error}</p> : null}{message ? <p className="form-message success">{message}</p> : null}
              <button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Update stock'}</button>
            </form></>
          ) : (
            <><div className="panel-heading"><div><p className="eyebrow">{editingId ? 'EDIT ITEM' : 'ADD ITEM'}</p><h2>{editingId ? 'Update inventory item' : 'Add inventory item'}</h2></div>{editingId ? <button className="text-button" onClick={resetForm}>Cancel edit</button> : null}</div>
            <form className="form-stack" onSubmit={handleSubmit}>
              <label>Product name<input value={form.name} onChange={(e) => updateField('name', e.target.value)} placeholder="e.g. Styling Gel 250ml" required /></label>
              <div className="form-grid compact-grid"><label>SKU / code<input value={form.sku} onChange={(e) => updateField('sku', e.target.value)} placeholder="Optional" /></label><label>Category<input value={form.category} onChange={(e) => updateField('category', e.target.value)} placeholder="Retail, Shampoo, Colour…" /></label></div>
              <label>Branch<select value={form.branchId} onChange={(e) => updateField('branchId', e.target.value)}><option value="">All / unassigned</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
              <div className="form-grid compact-grid"><label>Cost price (R)<input type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => updateField('costPrice', e.target.value)} required /></label><label>Selling price (R)<input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => updateField('sellingPrice', e.target.value)} required /></label></div>
              <div className="form-grid compact-grid"><label>Reorder level<input type="number" min="0" step="0.01" value={form.reorderLevel} onChange={(e) => updateField('reorderLevel', e.target.value)} required /></label>{!editingId ? <label>Opening quantity<input type="number" min="0" step="0.01" value={form.openingQuantity} onChange={(e) => updateField('openingQuantity', e.target.value)} required /></label> : <div />}</div>
              {error ? <p className="form-message error">{error}</p> : null}{message ? <p className="form-message success">{message}</p> : null}
              <button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add inventory item'}</button>
            </form></>
          )}
        </article>

        <article className="panel list-panel"><div className="panel-heading"><div><p className="eyebrow">YOUR STOCK</p><h2>{items.length} inventory item{items.length === 1 ? '' : 's'}</h2></div></div>
          {items.length ? <div className="service-list">{items.map((item) => {
            const quantity = Number(item.quantity_on_hand || 0); const reorder = Number(item.reorder_level || 0); const isLow = item.is_active && quantity <= reorder;
            const branch = branches.find((entry) => entry.id === item.branch_id);
            return <div className={`service-card ${item.is_active ? '' : 'record-inactive'}`} key={item.id}><div className="service-card-top"><div><h3>{item.name}</h3><p>{item.sku ? `SKU ${item.sku}` : 'No SKU'}{branch ? ` • ${branch.name}` : ''}</p></div><strong>{formatMoney(item.selling_price)}</strong></div><div className="service-meta">{item.category ? <span>{item.category}</span> : null}<span>{quantity} in stock</span><span>Reorder at {reorder}</span><span>{isLow ? 'Low stock' : item.is_active ? 'In stock' : 'Inactive'}</span></div><div className="record-actions"><button className="button button-small button-secondary" onClick={() => startAdjustment(item)}>Adjust stock</button><button className="button button-small button-secondary" onClick={() => startEdit(item)}>Edit</button><button className="button button-small button-secondary" onClick={() => toggleActive(item)}>{item.is_active ? 'Deactivate' : 'Reactivate'}</button></div></div>;
          })}</div> : <div className="empty-state"><h3>No inventory items yet</h3><p>Add retail products or professional stock without changing your existing service catalogue.</p></div>}
        </article>
      </section>
    </section></main>
  );
}
