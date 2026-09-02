import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * Inter through next/font rather than the design system's Google Fonts import.
 *
 * Same typeface at the same weights. The difference is that this one is served from the
 * application, so a fresh clone renders correctly with no network beyond the database and
 * the model provider, and there is no third party watching page loads.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

/**
 * Without this a phone lays the page out at about 980 CSS pixels and scales the result
 * down, so every breakpoint below that never fires and the interface renders as a
 * shrunken desktop. The three widths the brief asks for are only three widths if the
 * browser is told to use the device's own.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'etAI',
  description: 'Search a document collection by meaning and get answers that cite their sources.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
