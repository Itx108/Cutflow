"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BusinessProvider, useBusiness } from "./business-provider";

const links = [
  ["/dashboard", "Overview"], ["/dashboard/appointments", "Appointments"], ["/dashboard/queue", "Walk-in queue"],
  ["/dashboard/pos", "POS / Checkout"], ["/dashboard/inventory", "Inventory"], ["/dashboard/customers", "Customers"],
  ["/dashboard/staff", "Staff"], ["/dashboard/services", "Services"], ["/dashboard/payments", "Payments"],
  ["/dashboard/communications", "Reminders"], ["/dashboard/reports", "Reports"], ["/dashboard/promotions", "Promotions"],
  ["/dashboard/loyalty", "Loyalty"], ["/dashboard/branches", "Branches"], ["/dashboard/billing", "Subscription"], ["/dashboard/settings", "Settings"],
];

function Inner({ children }) {
  const pathname = usePathname(); const router = useRouter();
  const { loading, business, hasAccess, error, supabase } = useBusiness();
  async function signOut() { await supabase.auth.signOut(); router.replace("/login"); }
  if (loading) return <div className="login"><div className="card">Loading CutFlow…</div></div>;
  if (error) return <div className="login"><div className="login-card"><h2>CutFlow</h2><div className="error">{error}</div><button className="btn" onClick={signOut}>Sign out</button></div></div>;
  const locked = hasAccess === false && pathname !== "/dashboard/billing";
  return <div className="shell">
    <aside className="sidebar"><a href="/dashboard" className="brand">Cut<span>Flow</span></a><div className="muted" style={{marginTop:6,fontSize:13}}>{business?.name}</div><nav className="nav">{links.map(([href,label])=><Link key={href} href={href} style={pathname===href?{background:"#1c2026",color:"#fff"}:undefined}>{label}</Link>)}</nav></aside>
    <main className="main"><header className="topbar"><div><strong>{business?.name}</strong><div className="muted" style={{fontSize:12}}>{business?.business_type||"Salon / Barbershop"}</div></div><div className="actions" style={{margin:0}}>{business?.slug&&<Link className="btn ghost hide-mobile" href={`/shop/${business.slug}`} target="_blank">View storefront</Link>}<button className="btn" onClick={signOut}>Sign out</button></div></header>
    <section className="content">{locked?<div className="login" style={{minHeight:"65vh"}}><div className="login-card stack"><div className="kicker">Subscription required</div><h2>CutFlow access is currently locked</h2><p>Your business data stays stored. Renew or resolve the subscription to continue using subscription-controlled features.</p><Link className="btn primary" href="/dashboard/billing">Open subscription</Link></div></div>:children}</section></main>
  </div>;
}

export default function DashboardShell({ children }) { return <BusinessProvider><Inner>{children}</Inner></BusinessProvider>; }
