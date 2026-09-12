'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardSidebar from '@/components/DashboardSidebar';
import { supabase } from '@/lib/supabaseClient';
import { loadOwnerWorkspace } from '@/lib/workspace';
import { formatMoney } from '@/lib/booking';

const emptyPlan = { name: '', description: '', price: '', durationMonths: '1', discountPercent: '0' };
const emptyMember = { customerId: '', membershipId: '', startsAt: new Date().toISOString().slice(0, 10), amountPaid: '', notes: '' };
const emptyVoucher = { customerId: '', code: '', recipientName: '', recipientPhone: '', value: '', expiresAt: '', notes: '' };

function relation(value) { return Array.isArray(value) ? value[0] : value; }
function dateOnly(value) { return value ? new Date(value).toLocaleDateString('en-ZA') : '—'; }
function isMissingUpgrade(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return text.includes('memberships') || text.includes('vouchers') || text.includes('schema cache') || text.includes('does not exist');
}

export default function MembershipsPage() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState(null);
  const [plans, setPlans] = useState([]);
  const [members, setMembers] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [planForm, setPlanForm] = useState(emptyPlan);
  const [memberForm, setMemberForm] = useState(emptyMember);
  const [voucherForm, setVoucherForm] = useState(emptyVoucher);
  const [tab, setTab] = useState('memberships');
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
        const expireResult = await supabase.rpc('cutflow_expire_memberships');
        if (expireResult.error && !isMissingUpgrade(expireResult.error)) throw expireResult.error;
        await refresh(nextWorkspace.business.id);
      } catch (err) {
        if (active) setError(isMissingUpgrade(err) ? 'Memberships & Vouchers are ready, but the V12.2 database upgrade still needs to be run in Supabase.' : (err?.message || 'Could not load memberships and vouchers.'));
      } finally { if (active) setLoading(false); }
    }
    boot();
    return () => { active = false; };
  }, [router]);

  async function refresh(businessId = workspace?.business?.id) {
    if (!businessId) return;
    const [planResult, memberResult, voucherResult, customerResult] = await Promise.all([
      supabase.from('memberships').select('*').eq('business_id', businessId).order('created_at', { ascending: false }),
      supabase.from('customer_memberships').select('*, customers(full_name, phone), memberships(name, discount_percent, duration_months)').eq('business_id', businessId).order('created_at', { ascending: false }),
      supabase.from('vouchers').select('*, customers(full_name, phone)').eq('business_id', businessId).order('created_at', { ascending: false }),
      supabase.from('customers').select('id, full_name, phone').eq('business_id', businessId).order('full_name').limit(1000),
    ]);
    for (const result of [planResult, memberResult, voucherResult, customerResult]) if (result.error) throw result.error;
    setPlans(planResult.data || []); setMembers(memberResult.data || []); setVouchers(voucherResult.data || []); setCustomers(customerResult.data || []);
  }

  const activePlans = useMemo(() => plans.filter((p) => p.is_active), [plans]);
  const activeMembers = useMemo(() => members.filter((m) => m.status === 'active' && new Date(m.ends_at) > new Date()), [members]);
  const activeVouchers = useMemo(() => vouchers.filter((v) => v.status === 'active' && (!v.expires_at || new Date(v.expires_at) > new Date())), [vouchers]);
  const voucherBalance = useMemo(() => activeVouchers.reduce((sum, v) => sum + Number(v.remaining_value || 0), 0), [activeVouchers]);

  async function createPlan(event) {
    event.preventDefault(); if (!workspace?.business) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const { error: insertError } = await supabase.from('memberships').insert({
        business_id: workspace.business.id,
        name: planForm.name.trim(),
        description: planForm.description.trim() || null,
        price: Number(planForm.price || 0),
        duration_months: Number(planForm.durationMonths || 1),
        discount_percent: Number(planForm.discountPercent || 0),
      });
      if (insertError) throw insertError;
      setPlanForm(emptyPlan); setMessage('Membership plan created.'); await refresh();
    } catch (err) { setError(err?.message || 'Could not create membership plan.'); }
    finally { setSaving(false); }
  }

  async function activateMember(event) {
    event.preventDefault(); if (!workspace?.business) return;
    const plan = plans.find((p) => p.id === memberForm.membershipId);
    if (!plan) { setError('Choose a membership plan.'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      const start = new Date(`${memberForm.startsAt}T00:00:00`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + Number(plan.duration_months || 1));
      const { error: insertError } = await supabase.from('customer_memberships').insert({
        business_id: workspace.business.id,
        customer_id: memberForm.customerId,
        membership_id: memberForm.membershipId,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        amount_paid: Number(memberForm.amountPaid || plan.price || 0),
        notes: memberForm.notes.trim() || null,
      });
      if (insertError) throw insertError;
      setMemberForm(emptyMember); setMessage('Customer membership activated.'); await refresh();
    } catch (err) { setError(err?.message || 'Could not activate membership.'); }
    finally { setSaving(false); }
  }

  async function setMembershipStatus(id, status) {
    setSaving(true); setError(''); setMessage('');
    try {
      const { error: updateError } = await supabase.from('customer_memberships').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', workspace.business.id);
      if (updateError) throw updateError;
      setMessage(`Membership marked ${status}.`); await refresh();
    } catch (err) { setError(err?.message || 'Could not update membership.'); }
    finally { setSaving(false); }
  }

  async function issueVoucher(event) {
    event.preventDefault(); if (!workspace?.business) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const expiresAt = voucherForm.expiresAt ? new Date(`${voucherForm.expiresAt}T23:59:59`).toISOString() : null;
      const { data, error: issueError } = await supabase.rpc('cutflow_issue_voucher', {
        p_business_id: workspace.business.id,
        p_customer_id: voucherForm.customerId || null,
        p_code: voucherForm.code.trim() || null,
        p_recipient_name: voucherForm.recipientName.trim() || null,
        p_recipient_phone: voucherForm.recipientPhone.trim() || null,
        p_value: Number(voucherForm.value),
        p_expires_at: expiresAt,
        p_notes: voucherForm.notes.trim() || null,
      });
      if (issueError) throw issueError;
      setVoucherForm(emptyVoucher); setMessage(`Voucher ${data?.code || ''} issued successfully.`); await refresh();
    } catch (err) { setError(err?.message || 'Could not issue voucher.'); }
    finally { setSaving(false); }
  }

  async function cancelVoucher(id) {
    setSaving(true); setError(''); setMessage('');
    try {
      const voucher = vouchers.find((v) => v.id === id);
      const { error: updateError } = await supabase.from('vouchers').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).eq('business_id', workspace.business.id);
      if (updateError) throw updateError;
      await supabase.from('voucher_transactions').insert({ business_id: workspace.business.id, voucher_id: id, transaction_type: 'cancel', amount: 0, balance_after: Number(voucher?.remaining_value || 0), notes: 'Voucher cancelled', created_by: workspace.user.id });
      setMessage('Voucher cancelled.'); await refresh();
    } catch (err) { setError(err?.message || 'Could not cancel voucher.'); }
    finally { setSaving(false); }
  }

  if (loading) return <main className="loading-shell"><div className="loading-card"><div className="brand-mark">CF</div><h1>Loading memberships…</h1></div></main>;

  return (
    <main className="dashboard-shell"><DashboardSidebar /><section className="dashboard-content">
      <header className="dashboard-header"><div><p className="eyebrow">CUSTOMER RETENTION</p><h1>Memberships & Vouchers</h1><p className="muted">Create member benefits and gift vouchers without changing the existing booking or POS workflow.</p></div><div className="header-metric"><strong>{activeMembers.length}</strong><span>active members</span></div></header>
      <section className="stats-grid stats-grid-three"><article className="stat-card"><p>Membership plans</p><strong>{activePlans.length}</strong></article><article className="stat-card"><p>Active vouchers</p><strong>{activeVouchers.length}</strong></article><article className="stat-card"><p>Voucher balance</p><strong>{formatMoney(voucherBalance)}</strong></article></section>
      {error ? <p className="form-message error">{error}</p> : null}{message ? <p className="form-message success">{message}</p> : null}

      <div className="record-actions" style={{ marginBottom: 24 }}>
        <button type="button" className={`button ${tab === 'memberships' ? 'button-primary' : 'button-secondary'}`} onClick={() => setTab('memberships')}>Memberships</button>
        <button type="button" className={`button ${tab === 'vouchers' ? 'button-primary' : 'button-secondary'}`} onClick={() => setTab('vouchers')}>Vouchers</button>
      </div>

      {tab === 'memberships' ? <>
        <section className="management-grid">
          <article className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">MEMBERSHIP PLAN</p><h2>Create a plan</h2></div></div>
            <form className="form-stack" onSubmit={createPlan}>
              <label>Plan name<input value={planForm.name} onChange={(e) => setPlanForm((c) => ({ ...c, name: e.target.value }))} placeholder="Gold Member" required /></label>
              <label>Description<textarea rows="3" value={planForm.description} onChange={(e) => setPlanForm((c) => ({ ...c, description: e.target.value }))} placeholder="Optional member benefits" /></label>
              <div className="form-grid compact-grid"><label>Price (R)<input type="number" min="0" step="0.01" value={planForm.price} onChange={(e) => setPlanForm((c) => ({ ...c, price: e.target.value }))} required /></label><label>Duration (months)<input type="number" min="1" max="60" value={planForm.durationMonths} onChange={(e) => setPlanForm((c) => ({ ...c, durationMonths: e.target.value }))} required /></label></div>
              <label>Member discount %<input type="number" min="0" max="100" step="0.01" value={planForm.discountPercent} onChange={(e) => setPlanForm((c) => ({ ...c, discountPercent: e.target.value }))} /></label>
              <button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Create membership plan'}</button>
            </form>
          </article>

          <article className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">NEW MEMBER</p><h2>Activate membership</h2></div></div>
            <form className="form-stack" onSubmit={activateMember}>
              <label>Customer<select value={memberForm.customerId} onChange={(e) => setMemberForm((c) => ({ ...c, customerId: e.target.value }))} required><option value="">Choose customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.phone ? ` • ${c.phone}` : ''}</option>)}</select></label>
              <label>Membership<select value={memberForm.membershipId} onChange={(e) => { const plan = plans.find((p) => p.id === e.target.value); setMemberForm((c) => ({ ...c, membershipId: e.target.value, amountPaid: plan ? String(plan.price || 0) : c.amountPaid })); }} required><option value="">Choose plan</option>{activePlans.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.price)} — {Number(p.discount_percent || 0)}% discount</option>)}</select></label>
              <div className="form-grid compact-grid"><label>Start date<input type="date" value={memberForm.startsAt} onChange={(e) => setMemberForm((c) => ({ ...c, startsAt: e.target.value }))} required /></label><label>Amount paid (R)<input type="number" min="0" step="0.01" value={memberForm.amountPaid} onChange={(e) => setMemberForm((c) => ({ ...c, amountPaid: e.target.value }))} /></label></div>
              <label>Notes<textarea rows="2" value={memberForm.notes} onChange={(e) => setMemberForm((c) => ({ ...c, notes: e.target.value }))} /></label>
              <button className="button button-primary" disabled={saving || !activePlans.length}>{saving ? 'Saving…' : 'Activate membership'}</button>
            </form>
          </article>
        </section>

        <article className="panel" style={{ marginTop: 24 }}><div className="panel-heading"><div><p className="eyebrow">MEMBERS</p><h2>Customer memberships</h2></div></div>
          {members.length ? <div className="record-list">{members.map((item) => { const customer = relation(item.customers); const plan = relation(item.memberships); return <div className="record-card" key={item.id}><div className="record-main"><div className="record-title-row"><h3>{customer?.full_name || 'Customer'} • {plan?.name || 'Membership'}</h3><span className="status-pill">{item.status}</span></div><p>{dateOnly(item.starts_at)} → {dateOnly(item.ends_at)} • {Number(plan?.discount_percent || 0)}% member discount • Paid {formatMoney(item.amount_paid)}</p><div className="record-actions">{item.status === 'active' ? <><button className="button button-small button-secondary" onClick={() => setMembershipStatus(item.id, 'paused')} disabled={saving}>Pause</button><button className="button button-small button-secondary" onClick={() => setMembershipStatus(item.id, 'cancelled')} disabled={saving}>Cancel</button></> : item.status === 'paused' && new Date(item.ends_at) > new Date() ? <button className="button button-small button-secondary" onClick={() => setMembershipStatus(item.id, 'active')} disabled={saving}>Resume</button> : null}</div></div></div>; })}</div> : <div className="empty-state"><h3>No members yet</h3><p>Create a membership plan, then activate it for an existing customer.</p></div>}
        </article>
      </> : <>
        <section className="management-grid">
          <article className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">GIFT VOUCHER</p><h2>Issue a voucher</h2></div></div>
            <form className="form-stack" onSubmit={issueVoucher}>
              <label>Link to customer (optional)<select value={voucherForm.customerId} onChange={(e) => setVoucherForm((c) => ({ ...c, customerId: e.target.value }))}><option value="">No customer selected</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.phone ? ` • ${c.phone}` : ''}</option>)}</select></label>
              <div className="form-grid compact-grid"><label>Value (R)<input type="number" min="1" step="0.01" value={voucherForm.value} onChange={(e) => setVoucherForm((c) => ({ ...c, value: e.target.value }))} required /></label><label>Custom code (optional)<input value={voucherForm.code} onChange={(e) => setVoucherForm((c) => ({ ...c, code: e.target.value }))} placeholder="Auto-generated if blank" /></label></div>
              <div className="form-grid compact-grid"><label>Recipient name<input value={voucherForm.recipientName} onChange={(e) => setVoucherForm((c) => ({ ...c, recipientName: e.target.value }))} /></label><label>Recipient phone<input value={voucherForm.recipientPhone} onChange={(e) => setVoucherForm((c) => ({ ...c, recipientPhone: e.target.value }))} /></label></div>
              <label>Expiry date (optional)<input type="date" value={voucherForm.expiresAt} onChange={(e) => setVoucherForm((c) => ({ ...c, expiresAt: e.target.value }))} /></label>
              <label>Notes<textarea rows="2" value={voucherForm.notes} onChange={(e) => setVoucherForm((c) => ({ ...c, notes: e.target.value }))} /></label>
              <button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Issue voucher'}</button>
            </form>
          </article>

          <article className="panel"><div className="panel-heading"><div><p className="eyebrow">POS REDEMPTION</p><h2>How vouchers are used</h2></div></div><div className="form-stack"><div className="integration-note"><strong>Vouchers are connected to POS.</strong><span>At checkout choose “Voucher”, enter the voucher code, and CutFlow checks the balance and expiry before completing the sale. The remaining balance is reduced atomically with the sale.</span></div><p className="muted">A voucher must cover the full sale total in this version. Split voucher + cash/card payments are intentionally not enabled yet so checkout remains predictable.</p></div></article>
        </section>

        <article className="panel" style={{ marginTop: 24 }}><div className="panel-heading"><div><p className="eyebrow">VOUCHER REGISTER</p><h2>{vouchers.length} voucher{vouchers.length === 1 ? '' : 's'}</h2></div></div>
          {vouchers.length ? <div className="record-list">{vouchers.map((voucher) => { const customer = relation(voucher.customers); const expired = voucher.expires_at && new Date(voucher.expires_at) <= new Date(); return <div className="record-card" key={voucher.id}><div className="money-badge">V</div><div className="record-main"><div className="record-title-row"><h3>{voucher.code}</h3><strong>{formatMoney(voucher.remaining_value)} left</strong></div><p>Original {formatMoney(voucher.original_value)} • {voucher.status}{expired && voucher.status === 'active' ? ' • expired by date' : ''}</p><p>{voucher.recipient_name || customer?.full_name || 'Unassigned recipient'}{voucher.recipient_phone ? ` • ${voucher.recipient_phone}` : ''}{voucher.expires_at ? ` • Expires ${dateOnly(voucher.expires_at)}` : ''}</p><div className="record-actions">{voucher.status === 'active' ? <button className="button button-small button-secondary" disabled={saving} onClick={() => cancelVoucher(voucher.id)}>Cancel voucher</button> : null}</div></div></div>; })}</div> : <div className="empty-state"><h3>No vouchers yet</h3><p>Issue a gift voucher here and redeem it securely through POS.</p></div>}
        </article>
      </>}
    </section></main>
  );
}
