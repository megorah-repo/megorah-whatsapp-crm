"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 1024;
const GENERIC_AUTH_ERROR = "Unable to sign you in. Please check your email and password and try again.";
export default function LoginPage() { return <Suspense fallback={null}><LoginPageInner /></Suspense>; }
function LoginPageInner() {
  const searchParams = useSearchParams(); const inviteToken = searchParams.get("invite"); const t = useTranslations("LoginPage");
  const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [error,setError]=useState<string|null>(null); const [loading,setLoading]=useState(false);
  const handleLogin=async(e:React.FormEvent)=>{e.preventDefault();if(loading)return;setError(null);const normalizedEmail=email.trim().toLowerCase();if(!normalizedEmail||normalizedEmail.length>MAX_EMAIL_LENGTH||password.length>MAX_PASSWORD_LENGTH){setError(GENERIC_AUTH_ERROR);return;}setLoading(true);try{const response=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({email:normalizedEmail,password})});if(!response.ok){setError(response.status===429||response.status===503?"Too many requests. Please try again later.":GENERIC_AUTH_ERROR);return;}
    // The server route authenticates and sets SSR cookies. Verify that the browser
    // can also see the session before navigating; this prevents an immediate
    // dashboard -> login loop when a proxy/serverless response delays cookie sync.
    const supabase = createClient();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (!session && !sessionError) {
      const { error: clientLoginError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (clientLoginError) throw clientLoginError;
    } else if (sessionError) {
      throw sessionError;
    }
    window.location.href=inviteToken?`/join/${encodeURIComponent(inviteToken.slice(0,256))}`:"/dashboard";
  }catch{setError(GENERIC_AUTH_ERROR);}finally{setLoading(false);}};
  return <div className="flex min-h-screen items-center justify-center bg-background px-4"><Card className="w-full max-w-md border-border bg-card"><CardHeader className="items-center text-center"><div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">{inviteToken?<UsersRound className="h-6 w-6 text-primary"/>:<MessageSquare className="h-6 w-6 text-primary"/>}</div><CardTitle className="text-xl text-foreground">{inviteToken?t("titleAccept"):t("titleWelcome")}</CardTitle><CardDescription className="text-muted-foreground">{inviteToken?t("descAccept"):t("descWelcome")}</CardDescription></CardHeader><CardContent><form onSubmit={handleLogin} className="flex flex-col gap-4" noValidate>{error&&<div role="alert" aria-live="polite" className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}<div className="flex flex-col gap-2"><Label htmlFor="email" className="text-muted-foreground">{t("emailLabel")}</Label><Input id="email" type="email" inputMode="email" autoComplete="username" maxLength={MAX_EMAIL_LENGTH} placeholder={t("emailPlaceholder")} value={email} onChange={e=>setEmail(e.target.value.slice(0,MAX_EMAIL_LENGTH))} required className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"/></div><div className="flex flex-col gap-2"><div className="flex items-center justify-between"><Label htmlFor="password" className="text-muted-foreground">{t("passwordLabel")}</Label><Link href="/forgot-password" className="text-sm text-primary hover:text-primary/80">{t("forgotPassword")}</Link></div><Input id="password" type="password" autoComplete="current-password" maxLength={MAX_PASSWORD_LENGTH} placeholder={t("passwordPlaceholder")} value={password} onChange={e=>setPassword(e.target.value.slice(0,MAX_PASSWORD_LENGTH))} required className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"/></div><Button type="submit" disabled={loading} className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{loading?t("signingIn"):t("signIn")}</Button></form><p className="mt-6 text-center text-sm text-muted-foreground">{t("noAccount")} {" "}<Link href={inviteToken?`/signup?invite=${encodeURIComponent(inviteToken.slice(0,256))}`:"/signup"} className="text-primary hover:text-primary/80">{t("createAccount")}</Link></p></CardContent></Card></div>;
}
