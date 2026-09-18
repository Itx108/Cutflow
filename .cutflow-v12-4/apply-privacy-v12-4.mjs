import fs from 'node:fs';

function patchFile(path, replacements) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [from, to] of replacements) {
    if (!text.includes(from)) {
      throw new Error(`CutFlow v0.12.4 patch could not find expected text in ${path}: ${from.slice(0, 120)}`);
    }
    text = text.replace(from, to);
  }
  fs.writeFileSync(path, text);
}

patchFile('app/dashboard/appointments/page.js', [
  [
    "supabase.from('customers').select('id, full_name, phone').eq('business_id', businessId).order('full_name')",
    "supabase.from('customers').select('id, full_name, phone').eq('business_id', businessId).eq('is_anonymized', false).order('full_name')"
  ],
  [
    `  async function updateStatus(appointmentId, status) {
    setMessage('');
    setError('');

    const { error: updateError } = await supabase.from('appointments').update({ status }).eq('id', appointmentId);`,
    `  async function updateStatus(appointmentId, status) {
    setMessage('');
    setError('');

    if (status === 'completed') {
      const { data, error: completionError } = await supabase.rpc('complete_cutflow_appointment_and_forget', { p_appointment_id: appointmentId });
      if (completionError) {
        setError(completionError.message);
        return;
      }
      const result = Array.isArray(data) ? data[0] : data;
      setMessage(result?.customer_retained_for_active_booking
        ? 'Appointment completed. This customer still has another active booking, so their details will be removed after the final active service.'
        : 'Appointment completed. Customer identity and appointment notes were removed.');
      await Promise.all([refreshAppointments(), loadReferenceData(workspace.business.id)]);
      return;
    }

    const { error: updateError } = await supabase.from('appointments').update({ status }).eq('id', appointmentId);`
  ],
  [
    'Create bookings with service duration, staff availability and overlap protection.',
    'Create bookings with overlap protection. Customer identity is automatically removed after the final active service is completed.'
  ],
  [
    `<button className="button button-small button-secondary" type="button" onClick={() => startEdit(appointment)}>Reschedule</button>
                          <select value={appointment.status} onChange={(e) => updateStatus(appointment.id, e.target.value)}>`,
    `{appointment.status !== 'completed' ? <button className="button button-small button-secondary" type="button" onClick={() => startEdit(appointment)}>Reschedule</button> : null}
                          <select value={appointment.status} onChange={(e) => updateStatus(appointment.id, e.target.value)} disabled={appointment.status === 'completed'}>`
  ],
]);

patchFile('app/dashboard/customers/page.js', [
  [
    "import { formatDate, formatMoney } from '@/lib/booking';",
    "import { formatDate } from '@/lib/booking';"
  ],
  [
    `.eq('business_id', businessId)
      .order('created_at', { ascending: false });`,
    `.eq('business_id', businessId)
      .eq('is_anonymized', false)
      .order('created_at', { ascending: false });`
  ],
  ['<p className="eyebrow">CUSTOMER CRM</p>', '<p className="eyebrow">TEMPORARY CUSTOMER RECORDS</p>'],
  [
    `<p className="muted">{workspace?.business?.name} • {customers.length} customer{customers.length === 1 ? '' : 's'}</p>`,
    `<p className="muted">{workspace?.business?.name} • {customers.length} active customer{customers.length === 1 ? '' : 's'} • Identifying details are removed after the final active service is completed.</p>`
  ],
  [
    `                  const completed = (customer.appointments || []).filter((appointment) => appointment.status === 'completed');
                  const totalSpent = completed.reduce((sum, appointment) => sum + Number(appointment.price || 0), 0);
                  const lastVisit = [...completed].sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))[0];`,
    `                  const activeBookings = (customer.appointments || []).filter((appointment) => !['completed', 'cancelled', 'no_show'].includes(appointment.status));
                  const nextBooking = [...activeBookings].filter((appointment) => new Date(appointment.starts_at) >= new Date()).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];`
  ],
  [
    `<div className="record-title-row"><h3>{customer.full_name}</h3><span className="status-pill">{completed.length} visit{completed.length === 1 ? '' : 's'}</span></div>`,
    `<div className="record-title-row"><h3>{customer.full_name}</h3><span className="status-pill">{activeBookings.length} active booking{activeBookings.length === 1 ? '' : 's'}</span></div>`
  ],
  [
    `<span><strong>{formatMoney(totalSpent)}</strong><small>Completed spend</small></span>
                          <span><strong>{lastVisit ? formatDate(lastVisit.starts_at) : 'No visits yet'}</strong><small>Last visit</small></span>`,
    `<span><strong>{nextBooking ? formatDate(nextBooking.starts_at) : 'No upcoming booking'}</strong><small>Next booking</small></span>
                          <span><strong>Temporary</strong><small>Identity removed after final service</small></span>`
  ],
]);

for (const path of [
  'app/dashboard/loyalty/page.js',
  'app/dashboard/memberships/page.js',
  'app/dashboard/pos/page.js'
]) {
  patchFile(path, [[
    ".eq('business_id', businessId).order('full_name')",
    ".eq('business_id', businessId).eq('is_anonymized', false).order('full_name')"
  ]]);
}

patchFile('app/dashboard/page.js', [
  [
    "supabase.from('customers').select('*', { count: 'exact', head: true }).eq('business_id', workspace.business.id)",
    "supabase.from('customers').select('*', { count: 'exact', head: true }).eq('business_id', workspace.business.id).eq('is_anonymized', false)"
  ],
  ['<p>Customers</p>', '<p>Active customer records</p>'],
]);

patchFile('app/dashboard/queue/page.js', [
  [
    `      let customerId = null;
      if (form.phone.trim()) {
        const { data: existing, error: customerFindError } = await supabase.from('customers').select('id').eq('business_id', workspace.business.id).eq('phone', form.phone.trim()).limit(1).maybeSingle();
        if (customerFindError) throw customerFindError;
        if (existing) customerId = existing.id;
      }
      if (!customerId) {
        const { data: created, error: createCustomerError } = await supabase.from('customers').insert({
          business_id: workspace.business.id, full_name: form.customerName.trim(), phone: form.phone.trim() || null,
        }).select('id').single();
        if (createCustomerError) throw createCustomerError;
        customerId = created.id;
      }
      const selectedService = services.find((s) => s.id === form.serviceId);`,
    `      const selectedService = services.find((s) => s.id === form.serviceId);`
  ],
  ['customer_id: customerId,', 'customer_id: null,'],
  [
    `  async function updateStatus(id, status) {
    setError(''); setMessage('');
    const patch = { status };`,
    `  async function updateStatus(id, status) {
    setError(''); setMessage('');

    if (status === 'completed') {
      const { error: completionError } = await supabase.rpc('complete_cutflow_walk_in_and_forget', { p_walk_in_id: id });
      if (completionError) { setError(completionError.message); return; }
      setMessage('Walk-in completed. Customer name, phone and notes were removed.');
      await refreshQueue();
      return;
    }

    const patch = { status };`
  ],
  ["    if (status === 'completed') patch.completed_at = new Date().toISOString();\n", ''],
  [
    'Manage waiting customers from arrival to completed service.',
    "Walk-in details are temporary. Completing service automatically removes the customer's name, phone and notes."
  ],
]);

patchFile('app/dashboard/reports/page.js', [
  ["  const [customers, setCustomers] = useState([]);\n", ''],
  [
    `      const [appointmentResult, paymentResult, customerResult] = await Promise.all([
        supabase.from('appointments').select('id, customer_id, starts_at, ends_at, status, price, payment_status, staff(id, full_name, commission_percent), services(id, name)').eq('business_id', businessId).gte('starts_at', start).lte('starts_at', end).order('starts_at'),
        supabase.from('payment_records').select('id, amount, record_type, recorded_at').eq('business_id', businessId).gte('recorded_at', start).lte('recorded_at', end),
        supabase.from('customers').select('id, created_at').eq('business_id', businessId),
      ]);`,
    `      const [appointmentResult, paymentResult] = await Promise.all([
        supabase.from('appointments').select('id, starts_at, ends_at, status, price, payment_status, staff(id, full_name, commission_percent), services(id, name)').eq('business_id', businessId).gte('starts_at', start).lte('starts_at', end).order('starts_at'),
        supabase.from('payment_records').select('id, amount, record_type, recorded_at').eq('business_id', businessId).gte('recorded_at', start).lte('recorded_at', end),
      ]);`
  ],
  ["      if (customerResult.error) throw customerResult.error;\n", ''],
  ["      setCustomers(customerResult.data || []);\n", ''],
  [
    `    const byCustomer = new Map();
    completed.forEach((a) => byCustomer.set(a.customer_id, (byCustomer.get(a.customer_id) || 0) + 1));
    const repeatCustomers = [...byCustomer.values()].filter((count) => count >= 2).length;
    const uniqueCompletedCustomers = byCustomer.size;`,
    `    const paidBookings = appointments.filter((a) => a.payment_status === 'paid').length;`
  ],
  ['noShowRate, repeatCustomers, uniqueCompletedCustomers,', 'noShowRate, paidBookings,'],
  [
    'Measure bookings, revenue, no-shows, retention, services and staff performance.',
    'Measure bookings, revenue, no-shows, services and staff performance without retaining completed customer identity.'
  ],
  [
    `<article className="stat-card"><p>Repeat customers</p><strong>{metrics.repeatCustomers}</strong><span>2+ completed visits in range</span></article>`,
    `<article className="stat-card"><p>Paid bookings</p><strong>{metrics.paidBookings}</strong><span>Customer identity is not required for this metric</span></article>`
  ],
]);

console.log('CutFlow v0.12.4 privacy source updates applied.');
