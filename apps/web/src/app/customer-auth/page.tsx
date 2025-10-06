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
  const [errors, setErrors] = useState<Record<string,string>>({});
  const err = (k: string) => errors?.[k];

  const onSubmit = async (e: any) => {
    e.preventDefault(); setLoading(true); setErrors({});
    try {
      const r = await fetch(withBase('/auth/customer/signup'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await r.json();
      if (r.status === 422) { setErrors(j.errors||{}); Toast.push({ text: 'Please fix the highlighted fields.', tone: 'error' }); return; }
      if (!r.ok) throw new Error(j.error||'Signup failed');
      setOtpStage(true);
      Toast.push({ text: 'OTP sent. Check your email.', tone: 'success' });
    } catch (e:any) { Toast.push({ text: e.message||'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  const onVerify = async () => {
    setLoading(true); setErrors({});
    try {
      const r = await fetch(withBase('/auth/customer/verify-signup'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email, otp }) });
      const j = await r.json();
      if (r.status === 422) { setErrors(j.errors||{}); Toast.push({ text: 'Please check your OTP/email.', tone: 'error' }); return; }
      if (r.status === 401 || r.status === 410) { setErrors({ otp: j.error || 'Invalid or expired OTP' }); Toast.push({ text: j.error||'Invalid or expired OTP', tone: 'error' }); return; }
      if (!r.ok) throw new Error(j.error||'Verification failed');
  localStorage.setItem('token', j.token);
  Toast.push({ text: 'Welcome aboard!', tone: 'success' });
  location.href = '/customer/order-tracking';
    } catch (e:any) { Toast.push({ text: e.message||'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };
  const onResend = async () => {
    setLoading(true); setErrors({});
    try {
      const r = await fetch(withBase('/auth/customer/request-otp'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email }) });
      const j = await r.json();
      if (r.status === 422) { setErrors(j.errors||{}); Toast.push({ text: 'Please correct your email.', tone: 'error' }); return; }
      if (!r.ok) throw new Error(j.error||'Failed to resend OTP');
      Toast.push({ text: 'OTP resent. Check your email.', tone: 'success' });
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
              <input
                type={k==='password'?'password': k==='email'?'email':'text'}
                required={k!=='gstin'}
                className={`bg-black/30 border rounded px-3 py-2 ${err(k)?'border-red-500':'border-white/10'}`}
                value={(form as any)[k]}
                onChange={e=>setForm({...form, [k]: e.target.value})}
                aria-invalid={!!err(k)}
              />
              {err(k) && <p className="text-xs text-red-400">{err(k)}</p>}
            </div>
          ))}
          <button disabled={loading} className="rounded bg-brand-green text-black px-4 py-2">{loading?'Please wait…':'Sign up'}</button>
        </form>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-sm">Enter 6-digit OTP sent to {form.email}</label>
            <input className={`bg-black/30 border rounded px-3 py-2 w-40 ${err('otp')?'border-red-500':'border-white/10'}`} maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/[^0-9]/g,''))} />
            {err('otp') && <p className="text-xs text-red-400 mt-1">{err('otp')}</p>}
          </div>
          <div className="flex items-center gap-3">
            <button disabled={loading} onClick={onVerify} className="rounded bg-brand-green text-black px-4 py-2">{loading?'Verifying…':'Verify & Continue'}</button>
            <button type="button" disabled={loading} onClick={onResend} className="text-sm underline opacity-80 hover:opacity-100">Resend OTP</button>
          </div>
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
  const [errors, setErrors] = useState<Record<string,string>>({});
  const err = (k: string) => errors?.[k];

  const sendOtp = async () => {
    setLoading(true); setErrors({});
    try {
      const r = await fetch(withBase('/auth/customer/request-otp'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const j = await r.json();
      if (r.status === 422) { setErrors(j.errors||{}); Toast.push({ text: 'Fix email and try again.', tone: 'error' }); return; }
      if (!r.ok) throw new Error(j.error||'Failed to send OTP');
      Toast.push({ text: 'OTP sent. Check email.', tone: 'success' });
    } catch (e:any) { Toast.push({ text: e.message||'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  const onLogin = async (e:any) => {
    e.preventDefault(); setLoading(true); setErrors({});
    try {
      const body:any = { email }; if (otp) body.otp = otp; else if (password) body.password = password;
      const r = await fetch(withBase('/auth/customer/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (r.status === 422) { setErrors(j.errors||{}); Toast.push({ text: j.errors?.form || 'Please fix errors.', tone: 'error' }); return; }
      if (!r.ok) throw new Error(j.error||'Login failed');
  localStorage.setItem('token', j.token);
  Toast.push({ text: 'Signed in', tone: 'success' });
  location.href = '/customer/order-tracking';
    } catch (e:any) { Toast.push({ text: e.message||'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  return (
    <form onSubmit={onLogin} className="space-y-3">
      <div className="grid gap-1">
        <label className="text-sm">Email</label>
        <input type="email" className={`bg-black/30 border rounded px-3 py-2 ${err('email')?'border-red-500':'border-white/10'}`} value={email} onChange={e=>setEmail(e.target.value)} required />
        {err('email') && <p className="text-xs text-red-400">{err('email')}</p>}
      </div>
      <div className="grid gap-1">
        <label className="text-sm">Password</label>
        <input type="password" className={`bg-black/30 border rounded px-3 py-2 ${err('password')?'border-red-500':'border-white/10'}`} value={password} onChange={e=>setPassword(e.target.value)} />
        {err('password') && <p className="text-xs text-red-400">{err('password')}</p>}
      </div>
      <div className="grid gap-1">
        <label className="text-sm">Or OTP</label>
        <div className="flex items-center gap-2">
          <input maxLength={6} className={`bg-black/30 border rounded px-3 py-2 w-28 ${err('otp')?'border-red-500':'border-white/10'}`} value={otp} onChange={e=>setOtp(e.target.value.replace(/[^0-9]/g,''))} />
          <button type="button" disabled={loading||!email} onClick={sendOtp} className="rounded border border-white/20 px-3 py-2">Send OTP</button>
        </div>
        {err('otp') && <p className="text-xs text-red-400">{err('otp')}</p>}
        {err('form') && <p className="text-xs text-red-400">{err('form')}</p>}
      </div>
      <button disabled={loading} className="rounded bg-brand-green text-black px-4 py-2">{loading?'Signing in…':'Sign in'}</button>
    </form>
  );
}
