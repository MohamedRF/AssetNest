import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleAlert, Loader2, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { LogoMark } from '../components/layout/Sidebar';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, isApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

const acceptSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter your name.').max(120),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters.')
    .max(128)
    .refine((v) => v.trim().length >= 12, 'Password must not be mostly whitespace.'),
});

/** Public page for single-use invite links (?token=...). */
export function AcceptInvite() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const token = new URLSearchParams(window.location.search).get('token');

  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ displayName?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const parsed = acceptSchema.safeParse({ displayName, password });
    if (!parsed.success) {
      const next: { displayName?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'displayName' || field === 'password') next[field] ??= issue.message;
      }
      setFieldErrors(next);
      return;
    }
    if (!token) return;

    setFieldErrors({});
    setSubmitting(true);
    try {
      await api.post('/auth/invites/accept', { token, ...parsed.data });
      // Session cookie is set; refresh the in-memory auth state before entering the app.
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      if (isApiError(err)) {
        if (err.status === 400 && err.code === 'INVITE_INVALID') {
          setError('This invite link is invalid or was already used. Ask for a fresh link.');
        } else if (err.status === 400 && err.code === 'INVITE_EXPIRED') {
          setError('This invite link has expired. Ask for a fresh link.');
        } else if (err.status === 401) {
          setError('An account with this email already exists — sign in with that password instead.');
        } else if (err.status === 409) {
          setError('You are already a member of this workspace.');
        } else {
          setError(err.detail || 'Could not accept the invite. Please try again.');
        }
      } else {
        setError('Could not reach the server. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="mb-8 flex items-center gap-2.5">
        <LogoMark className="h-9 w-9 text-accent" />
        <span className="text-2xl font-semibold tracking-tight">AssetNest</span>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck aria-hidden="true" className="h-5 w-5 text-accent" />
            Accept your invite
          </CardTitle>
          <CardDescription>
            You were invited to join an AssetNest workspace. Create your password to finish.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!token ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-md border border-danger/40 bg-danger-subtle px-3 py-2.5 text-sm text-danger-subtle-foreground"
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This invite link is missing its token. Open the full link you were sent, or ask for a new one.
              </span>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              {error !== null && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-md border border-danger/40 bg-danger-subtle px-3 py-2.5 text-sm text-danger-subtle-foreground"
                >
                  <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="accept-display-name">Your name</Label>
                <Input
                  id="accept-display-name"
                  type="text"
                  autoComplete="name"
                  required
                  aria-invalid={fieldErrors.displayName !== undefined}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Ada Lovelace"
                />
                {fieldErrors.displayName !== undefined && (
                  <p className="text-sm text-danger">{fieldErrors.displayName}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="accept-password">Choose a password</Label>
                <Input
                  id="accept-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-invalid={fieldErrors.password !== undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 12 characters"
                />
                {fieldErrors.password !== undefined && (
                  <p className="text-sm text-danger">{fieldErrors.password}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                {submitting ? 'Joining…' : 'Join workspace'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
