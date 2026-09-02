import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * Manrope through next/font rather than a stylesheet @import.
 *
 * Serving it from the application means a fresh clone renders correctly with no network
 * beyond the database and the model provider, and no third party sees a request on every
 * page load. The weights are the four the interface actually sets; asking for the whole
 * variable range would ship weights nothing uses.
 */
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-manrope',
  display: 'swap',
});

/**
 * Without this a phone lays the page out at about 980 CSS pixels and scales the result
 * down, so every breakpoint below that never fires and the interface renders as a
 * shrunken desktop. The three widths this interface is drawn at are only three widths
 * if the browser is told to use the device's own.
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
    <html lang="en" className={manrope.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
