"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, CheckCircle, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const MAX_EMAIL_LENGTH = 320;
const MAX_NAME_LENGTH = 120;
const MAX_PASSWORD_LENGTH = 1024;
const GENERIC_SIGNUP_ERROR = "Unable to create the account. Please check your details and try again.";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = fullName.trim();

    if (
      !normalizedName ||
      normalizedName.length > MAX_NAME_LENGTH ||
      !normalizedEmail ||
      normalizedEmail.length > MAX_EMAIL_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH ||
      confirmPassword.length > MAX_PASSWORD_LENGTH
    ) {
      setError(GENERIC_SIGNUP_ERROR);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error: signupError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: { full_name: normalizedName },
        },
      });

      if (signupError) throw signupError;

      if (data.session) {
        window.location.href = inviteToken
          ? `/join/${encodeURIComponent(inviteToken.slice(0, 256))}`
          : "/dashboard";
        return;
      }

      setSuccess(true);
    } catch (signupError) {
      console.error("[auth/signup] signup failed", signupError instanceof Error ? signupError.message : signupError);
      setError(GENERIC_SIGNUP_ERROR);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <CheckCircle className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">Check your email</CardTitle>
            <CardDescription className="text-muted-foreground">
              We&apos;ve sent a confirmation link to <span className="text-foreground">{email}</span>.
              Please check your inbox and click the link to verify your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : "/login"}>
              <Button
                variant="outline"
                className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Back to sign in
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            {inviteToken ? (
              <UsersRound className="h-6 w-6 text-primary" />
            ) : (
              <MessageSquare className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle className="text-xl text-foreground">
            {inviteToken ? "Create account & join" : "Create account"}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {inviteToken
              ? "Verify your email, then accept the invitation to join your team."
              : "Create your Megorah workspace account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="flex flex-col gap-4" noValidate>
            {error && (
              <div
                role="alert"
                aria-live="polite"
                className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
              >
                {error}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName" className="text-muted-foreground">Full name</Label>
              <Input
                id="fullName"
                type="text"
                autoComplete="name"
                maxLength={MAX_NAME_LENGTH}
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value.slice(0, MAX_NAME_LENGTH))}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-muted-foreground">Email</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                maxLength={MAX_EMAIL_LENGTH}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value.slice(0, MAX_EMAIL_LENGTH))}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-muted-foreground">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                maxLength={MAX_PASSWORD_LENGTH}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value.slice(0, MAX_PASSWORD_LENGTH))}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword" className="text-muted-foreground">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                maxLength={MAX_PASSWORD_LENGTH}
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value.slice(0, MAX_PASSWORD_LENGTH))}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Creating account..." : "Create account"}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account? {" "}
            <Link
              href={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : "/login"}
              className="text-primary hover:text-primary/80"
            >
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
