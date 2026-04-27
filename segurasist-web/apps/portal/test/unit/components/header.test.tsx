import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PortalHeader } from '../../../components/layout/header';

describe('<PortalHeader />', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
    window.localStorage.removeItem('segurasist-portal-theme');
  });

  it('renders "Hola, {firstName}" when a name is provided', () => {
    render(<PortalHeader firstName="María" />);
    expect(screen.getByText('Hola, María')).toBeInTheDocument();
  });

  it('falls back to the brand title when no firstName is provided', () => {
    render(<PortalHeader firstName={null} />);
    expect(screen.getByText('Mi Membresía')).toBeInTheDocument();
    expect(screen.queryByText(/^Hola,/)).not.toBeInTheDocument();
  });

  it('toggles the dark class on the html root when the theme button is clicked', async () => {
    const user = userEvent.setup();
    render(<PortalHeader firstName="María" />);

    const button = await screen.findByRole('button', {
      name: /cambiar a modo oscuro/i,
    });
    await user.click(button);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem('segurasist-portal-theme')).toBe('dark');
  });
});
