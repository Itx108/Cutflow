import { createClient } from "@supabase/supabase-js";

let client;

export function getSupabase() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("CutFlow database configuration is missing.");
  client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

export function money(value, currency = "ZAR") {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format(Number(value || 0));
}

export function dateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function cleanPhoneForWhatsApp(phone = "") {
  let value = String(phone).replace(/[^\d+]/g, "");
  if (value.startsWith("0")) value = "27" + value.slice(1);
  if (value.startsWith("+")) value = value.slice(1);
  return value;
}
