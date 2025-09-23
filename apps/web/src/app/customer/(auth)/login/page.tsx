"use client";
import { useState } from "react";
import { withBase } from "@/lib/config";
import { useToast } from "@/components/Toast";

export default function CustomerLogin() {
  const Toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  const sendOtp = async () => {
    setLoading(true);
    try {
      const r = await fetch(withBase('/auth/customer/request-otp'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to send OTP');
      Toast.push({ text: 'OTP sent. Check email.', tone: 'success' });
    } catch (e: any) { Toast.push({ text: e.message || 'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  const onLogin = async (e: any) => {
    e.preventDefault(); setLoading(true);
    try {
      const body: any = { email };
      if (otp) body.otp = otp; else if (password) body.password = password;
      const r = await fetch(withBase('/auth/customer/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Login failed');
      localStorage.setItem('token', j.token);
      Toast.push({ text: 'Signed in', tone: 'success' });
      location.href = '/customer/dashboard';
    } catch (e: any) { Toast.push({ text: e.message || 'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Customer Login</h1>
      <form onSubmit={onLogin} className="space-y-3">
        <div className="grid gap-1">
          <label className="text-sm">Email</label>
          <input type="email" className="bg-black/30 border border-white/10 rounded px-3 py-2" value={email} onChange={e=>setEmail(e.target.value)} required />
        </div>
        <div className="grid gap-1">
          <label className="text-sm">Password</label>
          <input type="password" className="bg-black/30 border border-white/10 rounded px-3 py-2" value={password} onChange={e=>setPassword(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <label className="text-sm">Or OTP</label>
          <div className="flex items-center gap-2">
            <input maxLength={6} className="bg-black/30 border border-white/10 rounded px-3 py-2 w-28" value={otp} onChange={e=>setOtp(e.target.value.replace(/[^0-9]/g,''))} />
            <button type="button" disabled={loading || !email} onClick={sendOtp} className="rounded border border-white/20 px-3 py-2">Send OTP</button>
          </div>
        </div>
        <button disabled={loading} className="rounded bg-brand-green text-black px-4 py-2">{loading?'Signing in…':'Sign in'}</button>
      </form>
      <div className="text-sm mt-4 text-gray-400">New customer? <a className="underline" href="/customer/(auth)/signup">Create an account</a></div>
    </div>
  );
}
