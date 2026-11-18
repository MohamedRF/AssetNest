import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { CircleAlert, Loader2, ServerOff } from 'lucide-react';
import { z } from 'zod';
import { LogoMark } from '../components/layout/Sidebar';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { isApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .pipe(z.email('Enter a valid email address, for example you@example.com.')),
  password: z.string().min(1, 'Enter your password.'),
});

type LoginField = 'email' | 'password';
type FieldErrors = Partial<Record<LoginField, string>>;

export function Login() {
  const navigate = useNavigate();
  const { user, isLoading, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in → go straight to the app.
  useEffect(() => {
    if (!isLoading && user) {
      navigate('/', { replace: true });
    }
  }, [isLoading, user, navigate]);

  if (!isLoading && user) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setApiUnavailable(false);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const nextErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'email' || field === 'password') {
          nextErrors[field] ??= issue.message;
        }
      }
      setFieldErrors(nextErrors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      await login(parsed.data.email, parsed.data.password);
      navigate('/', { replace: true });
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        setFormError('Invalid email or password.');
      } else if (isApiError(error) && error.status === 0) {
        setApiUnavailable(true);
      } else if (isApiError(error)) {
        setFormError(error.detail || 'Sign-in failed. Please try again.');
      } else {
        setFormError('Sign-in failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <Link
        to="/"
        className="mb-8 flex items-center gap-2.5 rounded-md"
        aria-label="AssetNest — go to overview"
      >
        <LogoMark className="h-9 w-9 text-accent" />
        <span className="text-2xl font-semibold tracking-tight">AssetNest</span>
      </Link>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Sign in to AssetNest</CardTitle>
          <CardDescription>
            Use the email and password for your workspace. Sessions are stored in an HttpOnly cookie.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            {formError !== null && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-md border border-danger/40 bg-danger-subtle px-3 py-2.5 text-sm leading-6 text-danger-subtle-foreground"
              >
                <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
            {apiUnavailable && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2.5 text-sm leading-6 text-warning-subtle-foreground"
              >
                <ServerOff aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Could not reach the AssetNest API. Make sure the API server is running (port 3000 by
                  default) and try again.
                </span>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                aria-invalid={fieldErrors.email !== undefined}
                aria-describedby={fieldErrors.email !== undefined ? 'login-email-error' : undefined}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
              {fieldErrors.email !== undefined && (
                <p id="login-email-error" className="text-sm leading-5 text-danger">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                aria-invalid={fieldErrors.password !== undefined}
                aria-describedby={fieldErrors.password !== undefined ? 'login-password-error' : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
              {fieldErrors.password !== undefined && (
                <p id="login-password-error" className="text-sm leading-5 text-danger">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            <Button type="submit" size="md" className="mt-2 w-full" disabled={submitting}>
              {submitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 max-w-md text-center text-xs leading-5 text-muted-foreground">
        Sessions are stored in an HttpOnly cookie on your own infrastructure. Nothing is stored on this
        device.
      </p>
    </main>
  );
}
