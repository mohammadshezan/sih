"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { withBase } from "@/lib/config";

export default function CustomerAuth() {
  const [tab, setTab] = useState<'signup'|'login'>('signup');
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Customer Portal</h1>
      <div className="flex gap-2 mb-6">
        <button className={`px-3 py-2 rounded border ${tab==='signup'?'bg-white/10 border-white/20':'border-white/10'}`} onClick={()=>setTab('signup')}>Signup</button>
        <button className={`px-3 py-2 rounded border ${tab==='login'?'bg-white/10 border-white/20':'border-white/10'}`} onClick={()=>setTab('login')}>Login</button>
      </div>
      {tab==='signup' ? <SignupForm /> : <LoginForm />}
    </div>
  );
}

function SignupForm() {
  const Toast = useToast();
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", gstin: "", password: "" });
  const [otpStage, setOtpStage] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: any) => {
    e.preventDefault(); setLoading(true);
    try {
      const r = await fetch(withBase('/auth/customer/signup'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error||'Signup failed');
      setOtpStage(true);
      Toast.push({ text: 'OTP sent. Check your email.', tone: 'success' });
    } catch (e:any) { Toast.push({ text: e.message||'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  const onVerify = async () => {
    setLoading(true);
    try {
      const r = await fetch(withBase('/auth/customer/verify-signup'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email, otp }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error||'Verification failed');
      localStorage.setItem('token', j.token);
      Toast.push({ text: 'Welcome aboard!', tone: 'success' });
      location.href = '/customer-dashboard';
    } catch (e:any) { Toast.push({ text: e.message||'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  return (
    <div>
      {!otpStage ? (
        <form onSubmit={onSubmit} className="space-y-3">
          {['name','company','email','phone','gstin','password'].map((k)=> (
            <div key={k} className="grid gap-1">
              <label className="text-sm capitalize">{k}</label>
              <input type={k==='password'?'password': k==='email'?'email':'text'} required={k!=='gstin'} className="bg-black/30 border border-white/10 rounded px-3 py-2" value={(form as any)[k]} onChange={e=>setForm({...form, [k]: e.target.value})} />
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
          <button disabled={loading} onClick={onVerify} className="rounded bg-brand-green text-black px-4 py-2">{loading?'Verifying…':'Verify & Continue'}</button>
        </div>
      )}
    </div>
  );
}

function LoginForm() {
  const Toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  const sendOtp = async () => {
    setLoading(true);
    try {
      const r = await fetch(withBase('/auth/customer/request-otp'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error||'Failed to send OTP');
      Toast.push({ text: 'OTP sent. Check email.', tone: 'success' });
    } catch (e:any) { Toast.push({ text: e.message||'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  const onLogin = async (e:any) => {
    e.preventDefault(); setLoading(true);
    try {
      const body:any = { email }; if (otp) body.otp = otp; else if (password) body.password = password;
      const r = await fetch(withBase('/auth/customer/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error||'Login failed');
      localStorage.setItem('token', j.token);
      Toast.push({ text: 'Signed in', tone: 'success' });
      location.href = '/customer-dashboard';
    } catch (e:any) { Toast.push({ text: e.message||'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  return (
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
          <button type="button" disabled={loading||!email} onClick={sendOtp} className="rounded border border-white/20 px-3 py-2">Send OTP</button>
        </div>
      </div>
      <button disabled={loading} className="rounded bg-brand-green text-black px-4 py-2">{loading?'Signing in…':'Sign in'}</button>
    </form>
  );
}
