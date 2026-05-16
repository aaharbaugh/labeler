import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TTB Label Verifier',
  description: 'AI-powered alcohol label verification prototype for batch review.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
