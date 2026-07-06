import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Tagshield Dashboard',
  description: 'Manage your Consent Mode v2 banner, installs, and consent vault.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
