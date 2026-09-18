# CutFlow v0.12.2

The complete Next.js source is stored in `.cutflow-current/part*.b64`. Run `bash bootstrap.sh` from the repository root to reconstruct it, install pinned dependencies and build the app. Vercel uses this same build command.

This release changes the free trial to one calendar month, removes occupied staff times from the customer and staff booking selectors, and refreshes availability while a page remains open. The database also rejects overlapping active bookings for the same stylist or barber. The connected Supabase project has already received the trial and booked-slot migrations; the SQL files in `supabase/` are for other installations.

The installable web app can open its offline screen after the first visit. Booking decisions and business records still require a connection, so a cached schedule cannot be used to promise an appointment.

The production Vercel environment needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and its existing server-only secrets. See `.env.example` in the source archive. Never commit a service-role key or billing secret.
