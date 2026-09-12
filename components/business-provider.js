"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "../lib/supabase";

const BusinessContext = createContext(null);

export function BusinessProvider({ children }) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabase(), []);
  const [state, setState] = useState({ loading: true, user: null, business: null, hasAccess: true, subscription: null, error: "" });

  async function load() {
    setState((s) => ({ ...s, loading: true, error: "" }));
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) { router.replace("/login"); return; }
    const user = authData.user;
    let { data: owned, error } = await supabase.from("businesses").select("*").eq("owner_id", user.id).order("created_at", { ascending: true }).limit(1);
    let business = owned?.[0] || null;
    if (!business && !error) {
      const { data: membership, error: memberError } = await supabase.from("business_members").select("business_id, businesses(*)").eq("user_id", user.id).limit(1);
      error = memberError;
      business = membership?.[0]?.businesses || null;
    }
    let hasAccess = true;
    let subscription = null;
    if (business) {
      const [accessResult, summaryResult] = await Promise.all([
        supabase.rpc("cutflow_business_has_access", { p_business_id: business.id }),
        supabase.rpc("cutflow_subscription_summary", { p_business_id: business.id }),
      ]);
      if (!accessResult.error && typeof accessResult.data === "boolean") hasAccess = accessResult.data;
      if (!summaryResult.error) subscription = summaryResult.data || null;
    }
    setState({ loading: false, user, business, hasAccess, subscription, error: error?.message || (!business ? "No CutFlow business is linked to this account." : "") });
  }

  useEffect(() => { load(); }, []);
  const value = { ...state, supabase, reloadBusiness: load };
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error("useBusiness must be used inside BusinessProvider");
  return ctx;
}
