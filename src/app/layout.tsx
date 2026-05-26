import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Shoppalyzer · Allegro Competitive Intelligence',
  description: 'Stop guessing what your competitors are doing on Allegro.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
