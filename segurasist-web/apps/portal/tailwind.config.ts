import type { Config } from 'tailwindcss';
import preset from '@segurasist/config/tailwind';

/**
 * Portal Tailwind config.
 *
 * Extiende el preset compartido (`@segurasist/config/tailwind`) sin
 * redefinir tokens — solo añade el grupo `tenant.*` (Sprint 5/MT-3) que
 * el `<TenantProvider>` mantiene actualizado vía CSS vars.
 *
 * Uso:
 *   <span className="bg-tenant-primary text-white" />
 *   <a className="text-tenant-accent hover:underline" />
 *   <div className="border border-tenant-primary/40" />
 */
const config: Config = {
  presets: [preset],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        tenant: {
          primary: 'rgb(var(--tenant-primary-rgb) / <alpha-value>)',
          accent: 'rgb(var(--tenant-accent-rgb) / <alpha-value>)',
        },
      },
      backgroundImage: {
        'tenant-bg': 'var(--tenant-bg-image)',
        'tenant-logo': 'var(--tenant-logo-url)',
      },
    },
  },
};

export default config;
