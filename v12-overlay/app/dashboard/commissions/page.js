'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardSidebar from '@/components/DashboardSidebar';
import { supabase } from '@/lib/supabaseClient';
import { loadOwnerWorkspace } from '@/lib/workspace';
import { formatMoney } from '@/lib/booking';

function localDateInput(date) {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return copy.toISOString().slice(0, 10);
}

function monthStart() {
  const date = new Date();
  date.setDate(1);
  return localDateInput(date);
}

function today() {
  return localDateInput(new Date());
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isMissingUpgrade(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('commission_entries') || text.includes('42p01') || text.includes('schema cache');
}

export default function CommissionsPage() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState(null);
  const [range, setRange] = useState({ start: monthStart(), end: today() });
  const [entries, setEntries] = useState([]);
  const [staff, setStaff] = useState([]);
  const [staffFilter, setStaffFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingStaffId, setSavingStaffId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const nextWorkspace = await loadOwnerWorkspace();
        if (!nextWorkspace.user) {
          router.replace('/login');
          return;
        }
        if (!nextWorkspace.business) throw new Error('No CutFlow business is attached to this account.');
        if (!active) return;
        setWorkspace(nextWorkspace);
        await loadCommissions(nextWorkspace.business.id, range);
      } catch (err) {
        if (active) setError(err?.message || 'Could not load staff commissions.');
      } finally {
        if (active) setLoading(false);
      }
    }

    boot();
    return () => { active = false; };
  }, [router]);

  async function loadCommissions(businessId = workspace?.business?.id, nextRange = range) {
    if (!businessId) return;
    setLoading(true);
    setError('');

    try {
      const start = new Date(`${nextRange.start}T00:00:00`).toISOString();
      const end = new Date(`${nextRange.end}T23:59:59.999`).toISOString();

      const [entryResult, staffResult] = await Promise.all([
        supabase
          .from('commission_entries')
          .select('id, staff_id, appointment_id, sale_id, source_type, gross_amount, commission_percent, commission_amount, status, earned_at, paid_at, notes')
          .eq('business_id', businessId)
          .gte('earned_at', start)
          .lte('earned_at', end)
          .order('earned_at', { ascending: false }),
        supabase
          .from('staff')
          .select('id, full_name, job_title, commission_percent, is_active')
          .eq('business_id', businessId)
          .order('full_name'),
      ]);

      if (entryResult.error) throw entryResult.error;
      if (staffResult.error) throw staffResult.error;

      setEntries(entryResult.data || []);
      setStaff(staffResult.data || []);
    } catch (err) {
      if (isMissingUpgrade(err)) {
        setError('Run supabase/UPGRADE_V12_1_COMMISSIONS.sql before using Staff Commissions.');
      } else {
        setError(err?.message || 'Could not load staff commissions.');
      }
    } finally {
      setLoading(false);
    }
  }

  const staffMap = useMemo(() => new Map(staff.map((member) => [member.id, member])), [staff]);

  const visibleEntries = useMemo(
    () => entries.filter((entry) => !staffFilter || entry.staff_id === staffFilter),
    [entries, staffFilter]
  );

  const metrics = useMemo(() => {
    const activeEntries = visibleEntries.filter((entry) => entry.status !== 'void');
    const earned = activeEntries.filter((entry) => entry.status === 'earned');
    const paid = activeEntries.filter((entry) => entry.status === 'paid');
    const gross = activeEntries.reduce((sum, entry) => sum + Number(entry.gross_amount || 0), 0);
    const due = earned.reduce((sum, entry) => sum + Number(entry.commission_amount || 0), 0);
    const paidAmount = paid.reduce((sum, entry) => sum + Number(entry.commission_amount || 0), 0);
    return { gross, due, paidAmount, totalCommission: due + paidAmount, earnedCount: earned.length, paidCount: paid.length };
  }, [visibleEntries]);

  const staffSummaries = useMemo(() => {
    const map = new Map();

    staff.forEach((member) => {
      map.set(member.id, {
        id: member.id,
        name: member.full_name,
        jobTitle: member.job_title,
        configuredRate: Number(member.commission_percent || 0),
        gross: 0,
        due: 0,
        paid: 0,
        entryCount: 0,
      });
    });

    entries.forEach((entry) => {
      if (entry.status === 'void') return;
      const member = staffMap.get(entry.staff_id);
      const current = map.get(entry.staff_id) || {
        id: entry.staff_id,
        name: member?.full_name || 'Staff member',
        jobTitle: member?.job_title || '',
        configuredRate: Number(member?.commission_percent || entry.commission_percent || 0),
        gross: 0,
        due: 0,
        paid: 0,
        entryCount: 0,
      };
      current.gross += Number(entry.gross_amount || 0);
      current.entryCount += 1;
      if (entry.status === 'earned') current.due += Number(entry.commission_amount || 0);
      if (entry.status === 'paid') current.paid += Number(entry.commission_amount || 0);
      map.set(entry.staff_id, current);
    });

    return [...map.values()]
      .filter((item) => item.entryCount > 0 || item.configuredRate > 0)
      .sort((a, b) => (b.due + b.paid) - (a.due + a.paid));
  }, [entries, staff, staffMap]);

  function changeRange(name, value) {
    setRange((current) => ({ ...current, [name]: value }));
  }

  function runReport(event) {
    event.preventDefault();
    loadCommissions(workspace?.business?.id, range);
  }

  async function markStaffPaid(staffId) {
    const ids = entries
      .filter((entry) => entry.staff_id === staffId && entry.status === 'earned')
      .map((entry) => entry.id);

    if (!ids.length) return;

    setSavingStaffId(staffId);
    setError('');
    setMessage('');

    try {
      const paidAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('commission_entries')
        .update({ status: 'paid', paid_at: paidAt, updated_at: paidAt })
        .eq('business_id', workspace.business.id)
        .in('id', ids);
      if (updateError) throw updateError;

      const member = staffMap.get(staffId);
      setMessage(`${member?.full_name || 'Staff'} commission marked as paid.`);
      await loadCommissions(workspace.business.id, range);
    } catch (err) {
      setError(err?.message || 'Could not mark commission as paid.');
    } finally {
      setSavingStaffId('');
    }
  }

  if (loading && !workspace) {
    return <main className="loading-shell"><div className="loading-card"><div className="brand-mark">CF</div><h1>Loading commissions…</h1></div></main>;
  }

  return (
    <main className="dashboard-shell">
      <DashboardSidebar />
      <section className="dashboard-content">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">STAFF PAYOUTS</p>
            <h1>Commissions</h1>
            <p className="muted">Track earned and paid staff commission from completed appointments and service lines in assigned POS sales.</p>
          </div>
          <form className="report-range" onSubmit={runReport}>
            <label>From<input type="date" value={range.start} onChange={(e) => changeRange('start', e.target.value)} /></label>
            <label>To<input type="date" value={range.end} onChange={(e) => changeRange('end', e.target.value)} /></label>
            <button className="button button-primary">Run report</button>
          </form>
        </header>

        {error ? <p className="form-message error">{error}</p> : null}
        {message ? <p className="form-message success">{message}</p> : null}

        <section className="stats-grid report-stats">
          <article className="stat-card"><p>Commission due</p><strong>{formatMoney(metrics.due)}</strong><span>{metrics.earnedCount} unpaid entr{metrics.earnedCount === 1 ? 'y' : 'ies'}</span></article>
          <article className="stat-card"><p>Commission paid</p><strong>{formatMoney(metrics.paidAmount)}</strong><span>{metrics.paidCount} paid entr{metrics.paidCount === 1 ? 'y' : 'ies'}</span></article>
          <article className="stat-card"><p>Total commission</p><strong>{formatMoney(metrics.totalCommission)}</strong><span>Selected period</span></article>
          <article className="stat-card"><p>Commissionable value</p><strong>{formatMoney(metrics.gross)}</strong><span>Completed service value</span></article>
        </section>

        <section className="dashboard-grid report-grid">
          <article className="panel">
            <div className="panel-heading"><div><p className="eyebrow">TEAM SUMMARY</p><h2>Commission by staff</h2></div></div>
            {staffSummaries.length ? (
              <div className="ranking-list">
                {staffSummaries.map((item, index) => (
                  <div key={item.id}>
                    <span className="rank">{index + 1}</span>
                    <div>
                      <strong>{item.name}</strong>
                      <small>{item.jobTitle || 'Team member'} • {item.configuredRate}% configured rate • {item.entryCount} entr{item.entryCount === 1 ? 'y' : 'ies'}</small>
                    </div>
                    <div>
                      <b>{formatMoney(item.due)} due</b>
                      <small className="commission-note">Paid: {formatMoney(item.paid)} • Value: {formatMoney(item.gross)}</small>
                    </div>
                    {item.due > 0 ? (
                      <button
                        type="button"
                        className="button button-small button-secondary"
                        disabled={savingStaffId === item.id}
                        onClick={() => markStaffPaid(item.id)}
                      >
                        {savingStaffId === item.id ? 'Saving…' : 'Mark due as paid'}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : <div className="empty-state"><h3>No commission activity</h3><p>Set a Commission % on Staff, then complete an appointment or assign a POS sale to that staff member.</p></div>}
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div><p className="eyebrow">FILTER</p><h2>View one staff member</h2></div>
            </div>
            <div className="form-stack">
              <label>Staff member
                <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
                  <option value="">All staff</option>
                  {staff.map((member) => <option key={member.id} value={member.id}>{member.full_name} — {Number(member.commission_percent || 0)}%</option>)}
                </select>
              </label>
              <div className="inline-summary">
                <span>Due</span><strong>{formatMoney(metrics.due)}</strong>
                <span>Paid</span><strong>{formatMoney(metrics.paidAmount)}</strong>
                <span>Gross value</span><strong>{formatMoney(metrics.gross)}</strong>
              </div>
              <p className="muted">Commission percentages are configured on the existing Staff page. Each commission entry keeps the rate that applied when it was earned.</p>
            </div>
          </article>
        </section>

        <article className="panel" style={{ marginTop: 24 }}>
          <div className="panel-heading"><div><p className="eyebrow">COMMISSION LEDGER</p><h2>{visibleEntries.length} entr{visibleEntries.length === 1 ? 'y' : 'ies'}</h2></div></div>
          {visibleEntries.length ? (
            <div className="record-list">
              {visibleEntries.map((entry) => {
                const member = staffMap.get(entry.staff_id);
                return (
                  <div className={`record-card ${entry.status === 'void' ? 'record-inactive' : ''}`} key={entry.id}>
                    <div className="money-badge">{entry.status === 'void' ? '×' : '%'}</div>
                    <div className="record-main">
                      <div className="record-title-row">
                        <h3>{member?.full_name || 'Staff member'}</h3>
                        <strong>{formatMoney(entry.commission_amount)}</strong>
                      </div>
                      <p>{entry.source_type === 'appointment' ? 'Completed appointment' : 'POS service sale'} • {formatMoney(entry.gross_amount)} × {Number(entry.commission_percent || 0)}%</p>
                      <p>{formatDateTime(entry.earned_at)} • <span className="status-pill">{entry.status === 'earned' ? 'Due' : entry.status === 'paid' ? 'Paid' : 'Void'}</span></p>
                      {entry.paid_at ? <p>Paid {formatDateTime(entry.paid_at)}</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <div className="empty-state"><h3>No commission entries in this period</h3><p>Complete an appointment or an assigned POS sale to create commission automatically.</p></div>}
        </article>
      </section>
    </main>
  );
}
