import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LordIcon } from './lord-icon';
import { LORD_ICON_CATALOG, listUnresolvedIcons, resolveLordIconUrl } from './catalog';

// `lord-icon-element` registers a real custom element on import. In jsdom we
// stub the module so the registration is a no-op but observable.
vi.mock('lord-icon-element', () => ({
  defineElement: vi.fn(),
}));
vi.mock('lottie-web', () => ({
  default: { _stub: true },
}));

describe('LordIcon catalog', () => {
  it('exposes every requested icon name', () => {
    const required = [
      'cloud-upload',
      'palette',
      'checkmark-success',
      'trash-bin',
      'edit-pencil',
      'shield-check',
      'chat-bubble',
      'user',
      'settings-cog',
      'file-document',
      'calendar',
      'bell-alert',
      'search',
      'warning-triangle',
    ];
    for (const name of required) {
      expect(LORD_ICON_CATALOG).toHaveProperty(name);
    }
  });

  it('every entry points to cdn.lordicon.com', () => {
    for (const url of Object.values(LORD_ICON_CATALOG)) {
      expect(url.startsWith('https://cdn.lordicon.com/')).toBe(true);
    }
  });

  it('resolveLordIconUrl returns the catalog url for known names', () => {
    expect(resolveLordIconUrl('palette')).toBe(LORD_ICON_CATALOG['palette']);
  });

  it('listUnresolvedIcons surfaces pending TODO IDs for iter 2', () => {
    const unresolved = listUnresolvedIcons();
    // We expect the list to be non-empty in iter 1 (some IDs are still TODOs)
    // but every returned name must be a valid catalog key.
    for (const name of unresolved) {
      expect(LORD_ICON_CATALOG[name]).toContain('<TODO_ID_');
    }
  });
});

describe('<LordIcon> SSR-safe behaviour', () => {
  beforeEach(() => {
    // Make sure no leaked custom element registration from a prior test
    // skews the assertion. jsdom does not actually register `lord-icon`
    // since we mock the module, but be defensive.
    if (typeof window !== 'undefined' && window.customElements?.get('lord-icon')) {
      // jsdom does not allow undefining a custom element; we can only check.
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a sized fallback span before hydration', () => {
    const { container } = render(<LordIcon name="palette" size={48} />);
    const fallback = container.querySelector('[data-lord-icon-fallback="true"]');
    expect(fallback).toBeTruthy();
    // Fallback is decorative when no aria-label is provided.
    expect(fallback?.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes ariaLabel as a role=img when provided', () => {
    render(<LordIcon name="palette" size={32} ariaLabel="Cambiar paleta" />);
    expect(screen.getByRole('img', { name: 'Cambiar paleta' })).toBeTruthy();
  });

  it('renders the custom element after the registration effect runs', async () => {
    const { container } = render(
      <LordIcon name="cloud-upload" size={64} colors={{ primary: '#16a34a', secondary: '#7c3aed' }} />,
    );
    await waitFor(() => {
      const el = container.querySelector('lord-icon');
      expect(el).toBeTruthy();
    });
    const el = container.querySelector('lord-icon')!;
    expect(el.getAttribute('src')).toBe(LORD_ICON_CATALOG['cloud-upload']);
    expect(el.getAttribute('colors')).toBe('primary:#16a34a,secondary:#7c3aed');
    expect(el.getAttribute('trigger')).toBe('hover');
  });

  it('passes loop and delay through verbatim', async () => {
    const { container } = render(
      <LordIcon name="palette" loop delay={120} size={24} />,
    );
    await waitFor(() => {
      expect(container.querySelector('lord-icon')).toBeTruthy();
    });
    const el = container.querySelector('lord-icon')!;
    expect(el.getAttribute('loop')).toBe('true');
    expect(el.getAttribute('delay')).toBe('120');
  });

  it('renders custom fallback when provided and not registered yet', () => {
    const Fallback = () => <span data-testid="lucide-fallback">F</span>;
    render(
      <LordIcon
        name="palette"
        size={20}
        fallback={<Fallback />}
      />,
    );
    expect(screen.getByTestId('lucide-fallback')).toBeTruthy();
  });
});
