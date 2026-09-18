'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardSidebar from '@/components/DashboardSidebar';
import { supabase } from '@/lib/supabaseClient';
import { loadOwnerWorkspace } from '@/lib/workspace';
import {
  appointmentFitsHours,
  availableAppointmentTimes,
  combineLocalDateTime,
  formatMoney,
  formatTime,
  toDateInputValue,
} from '@/lib/booking';

const emptyForm = {
  customerId: '',
  serviceId: '',
  staffId: '',
  date: toDateInputValue(),
  startTime: '',
  notes: '',
  branchId: '',
};

function relationValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function statusLabel(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AppointmentsPage() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [branches, setBranches] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [workingHours, setWorkingHours] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [availableTimes, setAvailableTimes] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(toDateInputValue());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedService = useMemo(
    () => services.find((service) => service.id === form.serviceId) || null,
    [services, form.serviceId]
  );

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
        await loadReferenceData(nextWorkspace.business.id);
        await refreshAppointments(nextWorkspace.business.id, selectedDate);
      } catch (err) {
        if (active) setError(err?.message || 'Could not load appointments.');
      } finally {
        if (active) setLoading(false);
      }
    }
    boot();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!workspace?.business?.id) return;
    refreshAppointments(workspace.business.id, selectedDate).catch((err) => setError(err?.message || 'Could not load appointments.'));
  }, [selectedDate, workspace?.business?.id]);

  useEffect(() => {
    let active = true;
    let sequence = 0;
    async function refreshAvailableTimes() {
      if (!workspace?.business?.id || !form.staffId || !form.serviceId || !form.date) {
        setAvailableTimes([]);
        return;
      }
      const request = ++sequence;
      setSlotsLoading(true);
      const dayStart = new Date(`${form.date}T00:00:00+02:00`);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      try {
        const { data, error: slotsError } = await supabase.from('appointments')
          .select('id, starts_at, ends_at, status')
          .eq('business_id', workspace.business.id)
          .eq('staff_id', form.staffId)
          .lt('starts_at', dayEnd.toISOString())
          .gt('ends_at', dayStart.toISOString());
        if (slotsError) throw slotsError;
        if (!active || request !== sequence) return;
        const times = availableAppointmentTimes({
          dateValue: form.date,
          durationMinutes: selectedService?.duration_minutes,
          workingHours: workingHours.filter((item) => item.staff_id === form.staffId),
          appointments: data || [],
          excludeId: editingId,
        });
        setAvailableTimes(times);
        setForm((current) => current.startTime && !times.includes(current.startTime) ? { ...current, startTime: '' } : current);
      } catch (err) {
        if (active && request === sequence) {
          setAvailableTimes([]);
          setForm((current) => ({ ...current, startTime: '' }));
          setError(err?.message || 'Could not check availability.');
        }
      } finally {
        if (active && request === sequence) setSlotsLoading(false);
      }
    }
    void refreshAvailableTimes();
    const timer = window.setInterval(() => { if (!document.hidden) void refreshAvailableTimes(); }, 15000);
    const onFocus = () => { if (!document.hidden) void refreshAvailableTimes(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [workspace?.business?.id, form.staffId, form.serviceId, form.date, selectedService?.duration_minutes, workingHours, editingId]);

  async function loadReferenceData(businessId) {
    const [customerResult, serviceResult, staffResult, assignmentResult, branchResult] = await Promise.all([
      supabase.from('customers').select('id, full_name, phone').eq('business_id', businessId).order('full_name'),
      supabase.from('services').select('id, name, duration_minutes, price').eq('business_id', businessId).eq('is_active', true).order('name'),
      supabase.from('staff').select('id, full_name, job_title, is_bookable, branch_id').eq('business_id', businessId).eq('is_active', true).order('full_name'),
      supabase.from('staff_services').select('staff_id, service_id'),
      supabase.from('branches').select('id, name, is_active').eq('business_id', businessId).eq('is_active', true).order('created_at'),
    ]);

    if (customerResult.error) throw customerResult.error;
    if (serviceResult.error) throw serviceResult.error;
    if (staffResult.error) throw staffResult.error;
    if (assignmentResult.error) throw assignmentResult.error;
    if (branchResult.error) throw branchResult.error;
    setBranches(branchResult.data || []);

    const staffData = staffResult.data || [];
    let hoursData = [];
    if (staffData.length) {
      const { data, error: hoursError } = await supabase
        .from('working_hours')
        .select('staff_id, day_of_week, start_time, end_time, is_working')
        .in('staff_id', staffData.map((member) => member.id));
      if (hoursError) throw hoursError;
      hoursData = data || [];
    }

    setCustomers(customerResult.data || []);
    setServices(serviceResult.data || []);
    setStaff(staffData);
    setAssignments(assignmentResult.data || []);
    setWorkingHours(hoursData);
  }

  async function refreshAppointments(businessId = workspace?.business?.id, dateValue = selectedDate) {
    if (!businessId || !dateValue) return;
    const dayStart = new Date(`${dateValue}T00:00:00+02:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const { data, error: appointmentError } = await supabase
      .from('appointments')
      .select(`
        id, branch_id, starts_at, ends_at, status, price, payment_status, notes,
        customers(id, full_name, phone),
        staff(id, full_name),
        services(id, name, duration_minutes)
      `)
      .eq('business_id', businessId)
      .gte('starts_at', dayStart.toISOString())
      .lt('starts_at', dayEnd.toISOString())
      .order('starts_at', { ascending: true });

    if (appointmentError) throw appointmentError;
    setAppointments(data || []);
  }

  const eligibleStaff = useMemo(() => {
    const branchFiltered = staff.filter((member) => member.is_bookable && (!form.branchId || !member.branch_id || member.branch_id === form.branchId));
    if (!form.serviceId) return branchFiltered;
    const eligibleIds = new Set(assignments.filter((item) => item.service_id === form.serviceId).map((item) => item.staff_id));
    return branchFiltered.filter((member) => eligibleIds.has(member.id));
  }, [staff, assignments, form.serviceId, form.branchId]);

  function updateField(name, value) {
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (name === 'serviceId') {
        const eligibleIds = new Set(assignments.filter((item) => item.service_id === value).map((item) => item.staff_id));
        if (next.staffId && !eligibleIds.has(next.staffId)) next.staffId = '';
      }
      if (name === 'serviceId' || name === 'staffId' || name === 'date') next.startTime = '';
      return next;
    });
  }

  async function checkOverlap(staffId, startsAt, endsAt, excludeId = null) {
    const { data, error: overlapError } = await supabase
      .from('appointments')
      .select('id, starts_at, ends_at, status')
      .eq('staff_id', staffId)
      .lt('starts_at', endsAt.toISOString())
      .gt('ends_at', startsAt.toISOString())
      .not('status', 'in', '(cancelled,no_show)');
    const filtered = excludeId ? (data || []).filter((item) => item.id !== excludeId) : (data || []);
    if (overlapError) throw overlapError;
    return filtered.length > 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!workspace?.business || !selectedService) return;
    setSaving(true);
    setMessage('');
    setError('');

    try {
      const startsAt = combineLocalDateTime(form.date, form.startTime);
      const endsAt = new Date(startsAt.getTime() + Number(selectedService.duration_minutes) * 60 * 1000);
      if (Number.isNaN(startsAt.getTime())) throw new Error('Choose a valid appointment date and time.');
      if (!availableTimes.includes(form.startTime)) throw new Error('That time is no longer available. Choose another time.');

      const memberHours = workingHours.filter((item) => item.staff_id === form.staffId);
      const hoursCheck = appointmentFitsHours({
        dateValue: form.date,
        startTime: form.startTime,
        durationMinutes: selectedService.duration_minutes,
        workingHours: memberHours,
      });
      if (!hoursCheck.ok) throw new Error(hoursCheck.message);

      const hasOverlap = await checkOverlap(form.staffId, startsAt, endsAt, editingId);
      if (hasOverlap) throw new Error('That staff member already has another appointment during this time. Choose another time.');

      const payload = {
        business_id: workspace.business.id,
        branch_id: form.branchId || workspace.branch?.id || null,
        customer_id: form.customerId,
        staff_id: form.staffId,
        service_id: selectedService.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: 'confirmed',
        price: Number(selectedService.price),
        notes: form.notes.trim() || null,
      };

      if (!editingId) payload.payment_status = 'unpaid';
      const result = editingId
        ? await supabase.from('appointments').update(payload).eq('id', editingId)
        : await supabase.from('appointments').insert(payload);
      if (result.error) {
        if (result.error.code === '23P01') {
          throw new Error('This time became unavailable because another booking overlaps it. Please choose another time.');
        }
        throw result.error;
      }

      setMessage(editingId ? 'Appointment rescheduled successfully.' : 'Appointment booked successfully.');
      setSelectedDate(form.date);
      setEditingId(null);
      setForm((current) => ({ ...emptyForm, date: current.date }));
      await refreshAppointments(workspace.business.id, form.date);
    } catch (err) {
      setError(err?.message || 'Could not create this appointment.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(appointment) {
    const localStart = new Date(appointment.starts_at);
    const service = relationValue(appointment.services);
    const member = relationValue(appointment.staff);
    const customer = relationValue(appointment.customers);
    setEditingId(appointment.id);
    setForm({
      customerId: customer?.id || '',
      serviceId: service?.id || '',
      staffId: member?.id || '',
      date: toDateInputValue(localStart),
      startTime: formatTime(localStart),
      notes: appointment.notes || '',
      branchId: appointment.branch_id || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm((current) => ({ ...emptyForm, date: current.date }));
    setError('');
    setMessage('');
  }

  async function updateStatus(appointmentId, status) {
    setMessage('');
    setError('');
    const { error: updateError } = await supabase.from('appointments').update({ status }).eq('id', appointmentId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage(`Appointment marked ${statusLabel(status).toLowerCase()}.`);
    await refreshAppointments();
  }

  if (loading) return <main className="loading-shell"><div className="loading-card"><div className="brand-mark">CF</div><h1>Loading appointments…</h1></div></main>;

  return (
    <main className="dashboard-shell">
      <DashboardSidebar />
      <section className="dashboard-content">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">BOOKING CALENDAR</p>
            <h1>Appointments</h1>
            <p className="muted">Create bookings with service duration, staff availability and overlap protection.</p>
          </div>
          <label className="date-filter">View date<input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} /></label>
        </header>

        <section className="management-grid appointment-management-grid">
          <article className="panel form-panel">
            <div className="panel-heading"><div><p className="eyebrow">{editingId ? 'RESCHEDULE' : 'NEW APPOINTMENT'}</p><h2>{editingId ? 'Edit appointment' : 'Book a customer'}</h2></div>{editingId ? <button className="text-button" type="button" onClick={cancelEdit}>Cancel edit</button> : null}</div>
            <form className="form-stack" onSubmit={handleSubmit}>
              <label>Branch
                <select value={form.branchId} onChange={(e) => updateField('branchId', e.target.value)}>
                  <option value="">Main / first active branch</option>
                  {branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}
                </select>
              </label>
              <label>Customer
                <select value={form.customerId} onChange={(e) => updateField('customerId', e.target.value)} required>
                  <option value="">Choose customer</option>
                  {customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.full_name}{customer.phone ? ` • ${customer.phone}` : ''}</option>)}
                </select>
              </label>
              {!customers.length ? <p className="empty-note">No customers yet. Add one from the Customers page before creating a booking.</p> : null}

              <label>Service
                <select value={form.serviceId} onChange={(e) => updateField('serviceId', e.target.value)} required>
                  <option value="">Choose service</option>
                  {services.map((service) => <option value={service.id} key={service.id}>{service.name} • {service.duration_minutes} min • {formatMoney(service.price)}</option>)}
                </select>
              </label>

              <label>Staff member
                <select value={form.staffId} onChange={(e) => updateField('staffId', e.target.value)} required disabled={!form.serviceId}>
                  <option value="">{form.serviceId ? 'Choose staff member' : 'Choose a service first'}</option>
                  {eligibleStaff.map((member) => <option value={member.id} key={member.id}>{member.full_name}{member.job_title ? ` • ${member.job_title}` : ''}</option>)}
                </select>
              </label>
              {form.serviceId && !eligibleStaff.length ? <p className="empty-note">No active bookable staff are assigned to this service. Assign the service on the Staff page first.</p> : null}

              <div className="form-grid compact-grid">
                <label>Date<input type="date" value={form.date} onChange={(e) => updateField('date', e.target.value)} required /></label>
                <label>Available time
                  <select value={form.startTime} onChange={(e) => updateField('startTime', e.target.value)} required disabled={!form.staffId || slotsLoading}>
                    <option value="">{slotsLoading ? 'Checking availability…' : availableTimes.length ? 'Choose an open time' : 'No open times for this date'}</option>
                    {availableTimes.map((time) => <option key={time} value={time}>{time}</option>)}
                  </select>
                </label>
              </div>

              {selectedService ? (
                <div className="booking-summary">
                  <span><small>Duration</small><strong>{selectedService.duration_minutes} min</strong></span>
                  <span><small>Price</small><strong>{formatMoney(selectedService.price)}</strong></span>
                </div>
              ) : null}

              <label>Booking notes<textarea rows="3" value={form.notes} onChange={(e) => updateField('notes', e.target.value)} placeholder="Optional appointment notes" /></label>
              {error ? <p className="form-message error">{error}</p> : null}
              {message ? <p className="form-message success">{message}</p> : null}
              <button className="button button-primary" disabled={saving || slotsLoading || !form.startTime || !customers.length || !services.length}>{saving ? 'Saving…' : editingId ? 'Save Reschedule' : 'Confirm Appointment'}</button>
            </form>
          </article>

          <article className="panel list-panel">
            <div className="panel-heading"><div><p className="eyebrow">DAILY SCHEDULE</p><h2>{appointments.length} booking{appointments.length === 1 ? '' : 's'}</h2></div></div>
            {appointments.length ? (
              <div className="appointment-list detailed-appointments">
                {appointments.map((appointment) => {
                  const customer = relationValue(appointment.customers);
                  const member = relationValue(appointment.staff);
                  const service = relationValue(appointment.services);
                  return (
                    <div className="appointment-card" key={appointment.id}>
                      <div className="appointment-time-block"><strong>{formatTime(appointment.starts_at)}</strong><span>to {formatTime(appointment.ends_at)}</span></div>
                      <div className="appointment-card-main">
                        <div className="record-title-row"><h3>{customer?.full_name || 'Customer'}</h3><span className="status-pill">{statusLabel(appointment.status)}</span></div>
                        <p>{service?.name || 'Service'} • {member?.full_name || 'Staff'} • {formatMoney(appointment.price)}</p>
                        {customer?.phone ? <p>{customer.phone}</p> : null}
                        {appointment.notes ? <p className="customer-notes">{appointment.notes}</p> : null}
                        <div className="appointment-status-actions">
                          <button className="button button-small button-secondary" type="button" onClick={() => startEdit(appointment)}>Reschedule</button>
                          <select value={appointment.status} onChange={(e) => updateStatus(appointment.id, e.target.value)}>
                            <option value="pending">Pending</option>
                            <option value="confirmed">Confirmed</option>
                            <option value="arrived">Arrived</option>
                            <option value="in_service">In service</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="no_show">No-show</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <div className="empty-state"><h3>No appointments on this date</h3><p>Create a booking using the form or choose another day.</p></div>}
          </article>
        </section>
      </section>
    </main>
  );
}
