"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabase } from "../../lib/supabase";

export default function LoginPage() {
  const router = useRouter(); const [form,setForm]=useState({email:"",password:""}); const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
  async function submit(e){e.preventDefault();setBusy(true);setMessage("");try{const supabase=getSupabase();const{error}=await supabase.auth.signInWithPassword(form);if(error)throw error;router.replace("/dashboard");}catch(e){setMessage(e.message||"Login failed.");}finally{setBusy(false)}}
  return <main className="login"><form className="login-card form" onSubmit={submit}><Link href="/" className="brand">Cut<span>Flow</span></Link><div><h2>Business login</h2><p>Use your CutFlow account to manage your business.</p></div>{message&&<div className="error">{message}</div>}<div className="field"><label>Email</label><input className="input" type="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></div><div className="field"><label>Password</label><input className="input" type="password" required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></div><button className="btn primary" disabled={busy}>{busy?"Signing in…":"Sign in"}</button></form></main>;
}
