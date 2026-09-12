# CutFlow v12 safe-upgrade branch

This branch is an additive, non-AI upgrade of CutFlow.

## Goals
- Keep bookings, walk-ins, customers, staff, services and payment records reliable.
- Add an atomic POS checkout and inventory foundation.
- Use the existing deposit/reminder settings already present in the CutFlow database.
- Keep WhatsApp reminders optional; a messaging outage must never block core salon operations.
- Keep production unchanged until this branch passes build, database and security checks.

## Required environment variables
Copy `.env.example` to `.env.local` locally and supply the existing Supabase project values.

## Database
The v12 POS and inventory feature is behind the additive migration:
`supabase/migrations/20260912_cutflow_v12_pos_inventory.sql`

Do not apply the migration to production before it has been reviewed and tested. Existing v11.2 tables are not deleted or renamed.

## Safety
- No AI or LLM dependency.
- No service-role key in browser code.
- New v12 tables use RLS and authenticated business scoping.
- POS stock changes occur inside a database transaction through `create_cutflow_sale`.
- The production `main` branch is intentionally untouched during upgrade work.
