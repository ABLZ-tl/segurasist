import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PortalBottomNav } from '../../../components/layout/bottom-nav';
import { __setPathname } from '../../../vitest.setup';

describe('<PortalBottomNav />', () => {
  it('renders the four primary tabs', () => {
    render(<PortalBottomNav />);
    const labels = ['Inicio', 'Coberturas', 'Certificado', 'Ayuda'];
    for (const label of labels) {
      // Each tab uses aria-label=label so getByRole('link') finds them.
      expect(
        screen.getByRole('link', { name: new RegExp(`^${label}$`, 'i') }),
      ).toBeInTheDocument();
    }
  });

  it('marks the link matching the current pathname as the active page', () => {
    __setPathname('/coverages');
    render(<PortalBottomNav />);
    const link = screen.getByRole('link', { name: /coberturas/i });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).toHaveAttribute('data-active', 'true');

    const otherLink = screen.getByRole('link', { name: /inicio/i });
    expect(otherLink).not.toHaveAttribute('aria-current');
  });
});
