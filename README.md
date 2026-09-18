# CutFlow v0.12.4

CutFlow is the salon and barber management system deployed from this repository.

The complete base Next.js source is stored in `.cutflow-current/part*.b64`. During a Vercel build, `bootstrap.sh` reconstructs the source and applies the v0.12.4 customer-privacy updater before installing pinned dependencies and building the app.

## v0.12.4 customer privacy

- Walk-ins do not create permanent CRM customer profiles.
- Walk-in name, phone and notes are removed when service is completed.
- Completed appointments detach the customer identity and clear appointment notes.
- A customer profile is de-identified after the final active booking/queue relationship is completed.
- Anonymous operational information such as service, staff, time, price and payment status remains available for reporting.
- Active customer selectors exclude anonymized records.
- The reports dashboard no longer depends on completed customer identity.

The connected CutFlow Supabase project has received the v0.12.4 privacy migration.

## Existing features retained

The one-month free trial, booked-slot protection, automatic staff availability refresh, PWA/offline shell, POS, inventory, memberships, vouchers, commissions and other current CutFlow features remain part of the application.

The production Vercel environment requires `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and its existing server-only secrets. Never commit a service-role key or billing secret.
