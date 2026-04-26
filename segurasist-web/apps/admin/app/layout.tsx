import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { QueryProvider } from './providers';
import { Toaster } from '@segurasist/ui';
import { CommandPalette } from './_components/command-palette';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jbMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-stack',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'SegurAsist Admin',
    template: '%s · SegurAsist Admin',
  },
  description: 'Administración de membresías de salud — SegurAsist',
  robots: { index: false, follow: false },
};

const themeBootstrap = `
(function() {
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = stored || (prefersDark ? 'dark' : 'light');
    if (resolved === 'dark') document.documentElement.classList.add('dark');
    document.documentElement.dataset.theme = resolved;
  } catch (e) {}
})();
`.trim();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX" className={`${inter.variable} ${jbMono.variable}`} suppressHydrationWarning>
      <head>
        {/*
         * SAFE: el contenido es una constante hardcoded para prevenir FOUC del theme.
         * NUNCA insertar input del usuario aquí. Cualquier modificación a este script
         * requiere review de seguridad (XSS persistente vía SSR).
         * Owner: Frontend Lead. Última revisión: 2026-04-26.
         */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">
        <a href="#main" className="skip-link">
          Saltar al contenido
        </a>
        <QueryProvider>
          {children}
          <CommandPalette />
        </QueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
