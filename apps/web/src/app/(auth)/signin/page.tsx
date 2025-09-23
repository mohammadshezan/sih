"use client";
import { withBase } from "@/lib/config";
import { useState } from "react";
import { useToast } from "@/components/Toast";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const { push } = useToast();

  const requestOtp = async () => {
    setError("");
    if (!email) {
      const msg = 'Enter your email first';
      setError(msg); push({ text: msg, tone: 'error' });
      return;
    }
    try {
      setSending(true);
      let url = withBase("/auth/request-otp");
      if (url.startsWith("/")) {
        url = (process.env.NODE_ENV !== 'production' ? 'http://localhost:4000' : '') + url;
      }
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(data?.error || `Failed to send OTP (${r.status})`);
      push({ text: 'OTP sent to your email. Please check your inbox.', tone: 'success' });
    } catch (e: any) {
      const msg = e?.message || 'Failed to send OTP';
      setError(msg); push({ text: msg, tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      setLoading(true);
      // Resolve API URL (fallback to local dev if not configured)
      let url = withBase("/auth/login");
      if (url.startsWith("/")) {
        url = (process.env.NODE_ENV !== 'production' ? 'http://localhost:4000' : '') + url;
      }
      const r = await fetch(url, {
        method: "POST",
        mode: 'cors',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp })
      });
      let data: any = null;
      if (r.headers.get('content-type')?.includes('application/json')) {
        data = await r.json().catch(() => null);
      } else {
        const txt = await r.text().catch(() => '');
        data = txt ? { error: txt } : null;
      }
      if (!r.ok) {
        const errMsg = (data && (data.error || data.message)) || `Login failed (${r.status})`;
        throw new Error(r.status === 401 ? 'Invalid OTP, please try again.' : errMsg);
      }
      localStorage.setItem("token", data.token);
      push({ text: 'Signed in', tone: 'success' });
      window.location.href = "/dashboard";
    } catch (e: any) {
      const msg = e?.message?.includes('Failed to fetch') ? 'Network error: unable to reach API at /auth/login' : e?.message || 'Login failed';
      setError(msg);
      push({ text: msg, tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 bg-white/5 border border-white/10 p-6 rounded-xl">
        <h2 className="text-xl font-semibold">Sign in</h2>
        <div>
          <label className="text-sm text-gray-300">Email</label>
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@sail.test" className="mt-1 w-full rounded-md bg-black/40 border border-white/10 p-2" />
        </div>
        <div>
          <label className="text-sm text-gray-300">OTP</label>
          <div className="mt-1 flex gap-2">
            <input value={otp} onChange={e=>setOtp(e.target.value)} placeholder="Enter 6-digit code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} className="flex-1 rounded-md bg-black/40 border border-white/10 p-2 tracking-widest" />
            <button type="button" onClick={requestOtp} disabled={sending} className="whitespace-nowrap rounded-md bg-white/10 hover:bg-white/20 border border-white/10 px-3">
              {sending ? 'Sending…' : 'Send OTP'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Use your role email (admin@sail.test, manager@sail.test, yard@sail.test) or customer+name@sail.test. We emailed a 6-digit code that expires in 5 minutes.</p>
        </div>
        {error && <p className="text-sm text-brand-red">{error}</p>}
        <button disabled={loading} className="w-full rounded-md bg-brand-green text-black py-2 font-medium">{loading? 'Signing in…':'Continue'}</button>
      </form>
    </main>
  );
}
