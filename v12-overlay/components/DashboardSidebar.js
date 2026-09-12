'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

const links = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/appointments', label: 'Appointments' },
  { href: '/dashboard/queue', label: 'Walk-in Queue' },
  { href: '/dashboard/staff', label: 'Staff' },
  { href: '/dashboard/commissions', label: 'Commissions' },
  { href: '/dashboard/services', label: 'Services' },
  { href: '/dashboard/inventory', label: 'Inventory' },
  { href: '/dashboard/storefront', label: 'Storefront Website' },
  { href: '/dashboard/customers', label: 'Customers' },
  { href: '/dashboard/loyalty', label: 'Loyalty' },
  { href: '/dashboard/memberships', label: 'Memberships & Vouchers' },
  { href: '/dashboard/pos', label: 'POS' },
  { href: '/dashboard/payments', label: 'Payments' },
  { href: '/dashboard/settings/payments', label: 'Payment Settings' },
  { href: '/dashboard/reminders', label: 'Reminders' },
  { href: '/dashboard/reports', label: 'Reports' },
  { href: '/dashboard/promotions', label: 'Promotions' },
  { href: '/dashboard/billing', label: 'Plans & Billing' },
  { href: '/dashboard/settings', label: 'Settings' },
];

function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export default function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [platformAdmin, setPlatformAdmin] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    let active = true;
    async function checkPlatformAdmin() {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (!token) return;
        const response = await fetch('/api/platform/access', {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!response.ok) return;
        const result = await response.json();
        if (active) setPlatformAdmin(Boolean(result.platformOwner));
      } catch {
        if (active) setPlatformAdmin(false);
      }
    }
    checkPlatformAdmin();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  async function handleSignOut() {
    setOpen(false);
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <>
      <div className="mobile-dashboard-bar">
        <Link href="/dashboard" className="brand-row mobile-dashboard-brand" aria-label="CutFlow dashboard">
          <div className="brand-mark">CF</div>
          <span className="brand-name">CutFlow</span>
        </Link>
        <button
          type="button"
          className="mobile-menu-button"
          aria-label="Open dashboard navigation"
          aria-expanded={open}
          aria-controls="cutflow-dashboard-navigation"
          onClick={() => setOpen(true)}
        >
          <MenuIcon />
          <span>Menu</span>
        </button>
      </div>

      <button
        type="button"
        className={`sidebar-backdrop ${open ? 'visible' : ''}`}
        aria-label="Close dashboard navigation"
        onClick={() => setOpen(false)}
      />

      <aside id="cutflow-dashboard-navigation" className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="sidebar-mobile-head">
          <span>Navigation</span>
          <button type="button" className="sidebar-close" aria-label="Close navigation" onClick={() => setOpen(false)}>
            <CloseIcon />
          </button>
        </div>

        <Link href="/dashboard" className="brand-row sidebar-brand">
          <div className="brand-mark">CF</div>
          <span className="brand-name">CutFlow</span>
        </Link>

        <nav className="sidebar-nav" aria-label="Dashboard navigation">
          {links.map((item) => {
            const active = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : item.href === '/dashboard/settings'
                ? pathname === '/dashboard/settings'
                : pathname.startsWith(item.href);
            return (
              <Link
                className={active ? 'active' : ''}
                href={item.href}
                key={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
          {platformAdmin ? (
            <Link
              className={pathname.startsWith('/dashboard/billing/admin') ? 'active' : ''}
              href="/dashboard/billing/admin"
              aria-current={pathname.startsWith('/dashboard/billing/admin') ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              Platform Billing Admin
            </Link>
          ) : null}
        </nav>
        <button className="sidebar-signout" onClick={handleSignOut}>Sign out</button>
      </aside>
    </>
  );
}
