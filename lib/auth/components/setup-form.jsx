'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { setupAdmin } from '../actions.js';
import { useBranding } from 'thepopebot/branding/provider';

export function SetupForm() {
  const router = useRouter();
  const { setupTagline } = useBranding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(false);
  const [signingUp, setSigningUp] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await setupAdmin(email, password);

      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }

      setCreated(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    setSigningUp(true);
    try {
      await fetch('https://app.convertkit.com/forms/9126548/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'email_address=' + encodeURIComponent(email),
        redirect: 'manual',
      });
    } catch {
      // Never block the user
    }
    router.push('/login?created=1');
  }

  if (created) {
    return (
      <div className="w-full max-w-sm space-y-3">
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
          <p className="text-sm font-medium text-green-500">
            Account created. Sign in with your new credentials.
          </p>
        </div>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Get urgent updates and features</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSignup}
                disabled={signingUp}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
              >
                {signingUp ? 'Signing up...' : 'Sign Up'}
              </button>
              <button
                onClick={() => router.push('/login?created=1')}
                disabled={signingUp}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                Not Now
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create Admin Account</CardTitle>
        <CardDescription>{setupTagline}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Min 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating...' : 'Create Account'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
