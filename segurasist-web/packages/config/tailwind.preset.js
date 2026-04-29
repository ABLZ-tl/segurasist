/**
 * Tailwind preset for SegurAsist. Maps Tailwind utility tokens to the CSS
 * variables defined in packages/ui/src/tokens.css. Apps and packages should
 * extend this preset rather than redefining tokens locally.
 *
 * Two color systems coexist:
 *   - hsl(var(--bg)) etc. — semantic, dark-mode aware.
 *   - rgb(var(--color-*-rgb)) — legacy aliases preserved so older components
 *     keep compiling. Both resolve to the same physical colors.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  darkMode: ['class'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // Semantic, dark-mode aware
        bg: {
          DEFAULT: 'hsl(var(--bg) / <alpha-value>)',
          elevated: 'hsl(var(--bg-elevated) / <alpha-value>)',
          overlay: 'hsl(var(--bg-overlay) / <alpha-value>)',
        },
        fg: {
          DEFAULT: 'hsl(var(--fg) / <alpha-value>)',
          muted: 'hsl(var(--fg-muted) / <alpha-value>)',
          subtle: 'hsl(var(--fg-subtle) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'hsl(var(--border) / <alpha-value>)',
          strong: 'hsl(var(--border-strong) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          fg: 'hsl(var(--accent-fg) / <alpha-value>)',
          hover: 'hsl(var(--accent-hover) / <alpha-value>)',
        },
        ring: 'hsl(var(--ring) / <alpha-value>)',
        success: 'hsl(var(--success) / <alpha-value>)',
        warning: 'hsl(var(--warning) / <alpha-value>)',
        danger: 'hsl(var(--danger) / <alpha-value>)',

        // Legacy aliases — kept so existing components compile unchanged
        primary: {
          DEFAULT: 'rgb(var(--color-primary-rgb) / <alpha-value>)',
          fg: 'rgb(var(--color-primary-fg-rgb) / <alpha-value>)',
        },
        surface: 'hsl(var(--bg-elevated) / <alpha-value>)',
        // shadcn aliases
        background: 'hsl(var(--bg) / <alpha-value>)',
        foreground: 'hsl(var(--fg) / <alpha-value>)',
        muted: {
          DEFAULT: 'hsl(var(--bg-elevated) / <alpha-value>)',
          foreground: 'hsl(var(--fg-muted) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--danger) / <alpha-value>)',
          foreground: 'hsl(var(--accent-fg) / <alpha-value>)',
        },
        input: 'hsl(var(--border) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--bg) / <alpha-value>)',
          foreground: 'hsl(var(--fg) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--bg-overlay) / <alpha-value>)',
          foreground: 'hsl(var(--fg) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--bg-elevated) / <alpha-value>)',
          foreground: 'hsl(var(--fg) / <alpha-value>)',
        },

        // Tenant brandable tokens (Sprint 5 — DS-1).
        // These map to plain hex CSS vars set at runtime by
        // applyBrandableTheme. We deliberately do NOT use <alpha-value>
        // because the source vars are full hex (not space-separated triplets).
        tenant: {
          primary: 'var(--tenant-primary)',
          'primary-fg': 'var(--tenant-primary-fg)',
          accent: 'var(--tenant-accent)',
          'accent-fg': 'var(--tenant-accent-fg)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      spacing: {
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        5: 'var(--space-5)',
        6: 'var(--space-6)',
        7: 'var(--space-7)',
        8: 'var(--space-8)',
        10: 'var(--space-10)',
        12: 'var(--space-12)',
        16: 'var(--space-16)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui'],
        mono: ['var(--font-mono)', 'ui-monospace'],
      },
      fontSize: {
        // Tighten body / display tracking implicitly via classes; sizes left default
      },
      letterSpacing: {
        tightest: '-0.02em',
        tighter: '-0.014em',
        body: '-0.011em',
      },
      boxShadow: {
        // Restrained elevation — Linear/Vercel/Stripe scale
        xs: '0 1px 1px 0 rgb(0 0 0 / 0.04)',
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.06), 0 1px 1px 0 rgb(0 0 0 / 0.04)',
        md: '0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
        lg: '0 12px 24px -8px rgb(0 0 0 / 0.10), 0 4px 8px -4px rgb(0 0 0 / 0.06)',
        focus: '0 0 0 2px hsl(var(--ring))',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '180ms',
        slow: '260ms',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-up': 'fade-up 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 120ms ease-out',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
