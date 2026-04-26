import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarNav } from '../../../app/_components/sidebar-nav';
import { visibleNavFor, type Role } from '../../../lib/rbac';

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>(
    'next/navigation',
  );
  return {
    ...actual,
    usePathname: (): string => '/dashboard',
  };
});

describe('<SidebarNav />', () => {
  it('renders nothing role-specific when role is null', () => {
    render(<SidebarNav role={null} />);
    expect(screen.queryByText('General')).not.toBeInTheDocument();
    expect(screen.queryByText('Administración')).not.toBeInTheDocument();
    // Footer is always present.
    expect(screen.getByText(/v0\.1\.0/i)).toBeInTheDocument();
  });

  it.each<[Role, string[], string[]]>([
    [
      'admin_segurasist',
      ['Resumen', 'Asegurados', 'Lotes', 'Paquetes', 'Reportes', 'Usuarios', 'Ajustes'],
      [],
    ],
    [
      'operator',
      ['Resumen', 'Asegurados', 'Lotes'],
      ['Usuarios', 'Ajustes', 'Paquetes', 'Reportes'],
    ],
    [
      'supervisor',
      ['Resumen', 'Asegurados', 'Reportes'],
      ['Lotes', 'Paquetes', 'Usuarios', 'Ajustes'],
    ],
  ])('renders the correct items for role=%s', (role, expectVisible, expectHidden) => {
    render(<SidebarNav role={role} />);
    for (const label of expectVisible) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    for (const label of expectHidden) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
  });

  it('marks the active link with aria-current=page', () => {
    render(<SidebarNav role="admin_segurasist" />);
    const active = screen.getByRole('link', { name: 'Resumen' });
    expect(active).toHaveAttribute('aria-current', 'page');
  });

  it('shows Administración group only when admin items exist', () => {
    render(<SidebarNav role="operator" />);
    expect(screen.queryByText('Administración')).not.toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('matches visibleNavFor exactly for admin_mac', () => {
    render(<SidebarNav role="admin_mac" />);
    const expected = visibleNavFor('admin_mac').map((i) => i.label);
    for (const label of expected) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });
});
