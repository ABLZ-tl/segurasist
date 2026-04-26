import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccessDenied } from '../../../app/_components/access-denied';

describe('<AccessDenied />', () => {
  it('renders the default Spanish title and description', () => {
    render(<AccessDenied />);
    expect(
      screen.getByRole('heading', { name: /acceso restringido/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no tienes acceso a esta sección/i),
    ).toBeInTheDocument();
  });

  it('overrides the description when one is provided', () => {
    render(<AccessDenied description="Custom message about admin perms." />);
    expect(
      screen.getByText('Custom message about admin perms.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/no tienes acceso a esta sección/i),
    ).not.toBeInTheDocument();
  });

  it('renders a CTA link back to /dashboard', () => {
    render(<AccessDenied />);
    const cta = screen.getByRole('link', { name: /volver al resumen/i });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', '/dashboard');
  });

  it('exposes a status role for assistive tech', () => {
    render(<AccessDenied />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
