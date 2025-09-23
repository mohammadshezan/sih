"use client";
import { useState } from "react";
import { withBase } from "@/lib/config";
import { useToast } from "@/components/Toast";

export default function CustomerSignup() {
  const Toast = useToast();
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", gstin: "", password: "" });
  const [otpStage, setOtpStage] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: any) => {
    e.preventDefault(); setLoading(true);
    try {
      const r = await fetch(withBase('/auth/customer/signup'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Signup failed');
      setOtpStage(true);
      Toast.push({ text: 'OTP sent to email. Check inbox.', tone: 'success' });
    } catch (e: any) { Toast.push({ text: e.message || 'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  const onVerify = async () => {
    setLoading(true);
    try {
      const r = await fetch(withBase('/auth/customer/verify-signup'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email, otp }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Verification failed');
      localStorage.setItem('token', j.token);
      Toast.push({ text: 'Account created', tone: 'success' });
      location.href = '/customer/dashboard';
    } catch (e: any) { Toast.push({ text: e.message || 'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Customer Signup</h1>
      {!otpStage ? (
        <form onSubmit={onSubmit} className="space-y-3">
          {['name','company','email','phone','gstin','password'].map((k) => (
            <div key={k} className="grid gap-1">
              <label className="text-sm capitalize">{k}</label>
              <input type={k==='password'?'password': k==='email'?'email':'text'} className="bg-black/30 border border-white/10 rounded px-3 py-2" value={(form as any)[k]} onChange={e=>setForm({...form, [k]: e.target.value})} required />
            </div>
          ))}
          <button disabled={loading} className="rounded bg-brand-green text-black px-4 py-2">{loading?'Please wait…':'Sign up'}</button>
        </form>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-sm">Enter 6-digit OTP sent to {form.email}</label>
            <input className="bg-black/30 border border-white/10 rounded px-3 py-2 w-40" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/[^0-9]/g,''))} />
          </div>
          <button disabled={loading} onClick={onVerify} className="rounded bg-brand-green text-black px-4 py-2">{loading?'Verifying…':'Verify & Create Account'}</button>
        </div>
      )}
    </div>
  );
}
