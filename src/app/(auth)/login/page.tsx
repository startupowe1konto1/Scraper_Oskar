'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
      router.refresh();
    }
  }

  return (
    <Card className="shadow-medium">
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl">Zaloguj się</CardTitle>
        <CardDescription>Wprowadź dane, aby uzyskać dostęp do dashboard.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="jan@firma.pl"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Hasło</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Logowanie...' : 'Zaloguj się'}
          </Button>
          <Button type="button" variant="outline" className="w-full opacity-50 cursor-not-allowed" disabled>
            Kontynuuj z Google
            <span className="ml-2 text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm">
              Wkrótce
            </span>
          </Button>
        </form>
        <p className="text-sm text-center text-muted-foreground mt-6">
          Nie masz konta?{' '}
          <Link href="/signup" className="text-primary hover:underline font-medium">
            Zarejestruj się →
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
