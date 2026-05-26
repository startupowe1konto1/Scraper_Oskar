'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { BarChart2, User, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { QuotaBar } from './QuotaBar';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Analizy', icon: BarChart2 },
  { href: '/dashboard/account', label: 'Konto', icon: User },
];

export function DashboardShell({ children, userEmail }: { children: React.ReactNode; userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Topbar */}
      <header className="h-14 border-b border-border bg-white/80 backdrop-blur-sm sticky top-0 z-10 flex items-center justify-between px-6">
        <span className="font-bold text-brand-navy tracking-tight">shoppalyzer</span>
        <span className="text-sm text-muted-foreground">{userEmail}</span>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-[220px] border-r border-border bg-white/60 flex flex-col py-4 px-3 shrink-0">
          <nav className="space-y-0.5 flex-1">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  pathname === href || (href === '/dashboard' && pathname.startsWith('/dashboard/queries'))
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-muted',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto space-y-2 pt-4 border-t border-border">
            <QuotaBar />
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-3 py-2 w-full rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Wyloguj się
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-6 min-w-0 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
