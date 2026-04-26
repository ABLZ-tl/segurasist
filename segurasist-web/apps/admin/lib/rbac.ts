/**
 * Frontend RBAC matrix — UX-only mirror of the backend.
 *
 * IMPORTANT: This module governs presentation only (sidebar visibility, page
 * gating, role chips). The authoritative authorization is enforced in the
 * NestJS API via `@Roles()` guards on every endpoint. Do not rely on this
 * matrix for security. Roles must be kept in sync with the backend
 * `UserRole` enum.
 */

export type Role =
  | 'admin_segurasist'
  | 'admin_mac'
  | 'operator'
  | 'supervisor'
  | 'insured';

export type NavSection = 'general' | 'admin';

export interface NavItem {
  /** Route path (typed via Next.js `Route` at the consumption site). */
  href: string;
  label: string;
  /** Lucide icon key — string here to keep this module icon-agnostic. */
  iconKey: string;
  /** Roles allowed to see this entry. */
  roles: readonly Role[];
  /** Sidebar group: General vs Administración. */
  section: NavSection;
}

/**
 * Sidebar matrix. `section` is part of the data so the renderer doesn't have
 * to guess which group an item belongs to.
 *
 * Notes:
 *  - `/packages` write is admin_segurasist only; admin_mac reads.
 *    Backend enforces the write split via `@Roles()`.
 *  - `insured` never appears here on purpose — the middleware redirects them
 *    to the portal app before they reach the admin shell.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/dashboard',
    label: 'Resumen',
    iconKey: 'LayoutDashboard',
    roles: ['admin_segurasist', 'admin_mac', 'operator', 'supervisor'],
    section: 'general',
  },
  {
    href: '/insureds',
    label: 'Asegurados',
    iconKey: 'Users',
    roles: ['admin_segurasist', 'admin_mac', 'operator', 'supervisor'],
    section: 'general',
  },
  {
    href: '/batches',
    label: 'Lotes',
    iconKey: 'Layers',
    roles: ['admin_segurasist', 'admin_mac', 'operator'],
    section: 'general',
  },
  {
    href: '/packages',
    label: 'Paquetes',
    iconKey: 'Package',
    roles: ['admin_segurasist', 'admin_mac'],
    section: 'general',
  },
  {
    href: '/reports',
    label: 'Reportes',
    iconKey: 'BarChart3',
    roles: ['admin_segurasist', 'admin_mac', 'supervisor'],
    section: 'general',
  },
  {
    href: '/users',
    label: 'Usuarios',
    iconKey: 'UserCog',
    roles: ['admin_segurasist', 'admin_mac'],
    section: 'admin',
  },
  {
    href: '/settings',
    label: 'Ajustes',
    iconKey: 'Settings',
    roles: ['admin_segurasist', 'admin_mac'],
    section: 'admin',
  },
];

/** Items the given role is allowed to see in the navigation. */
export function visibleNavFor(role: Role): readonly NavItem[] {
  return NAV_ITEMS.filter((i) => i.roles.includes(role));
}

/**
 * Whether `role` may view `path`. Routes not present in `NAV_ITEMS` are
 * considered free (auth screens, internal `_components`, dynamic detail
 * routes covered by their parent segment, etc.). Matching uses exact equality
 * or a `${href}/` prefix to avoid `/users` greedy-matching `/users-extra`.
 */
export function canAccess(path: string, role: Role): boolean {
  // Pick the most specific matching nav item (longest href). Necessary if
  // future entries become nested.
  const matches = NAV_ITEMS.filter(
    (i) => path === i.href || path.startsWith(`${i.href}/`),
  );
  if (matches.length === 0) return true;
  const item = matches.reduce((a, b) => (b.href.length > a.href.length ? b : a));
  return item.roles.includes(role);
}

/** Spanish display label for the role chip. */
export const ROLE_LABEL: Record<Role, string> = {
  admin_segurasist: 'Superadmin',
  admin_mac: 'Admin MAC',
  operator: 'Operador',
  supervisor: 'Supervisor',
  insured: 'Asegurado',
};

/** Type guard for narrowing arbitrary strings (e.g. JWT claims) to `Role`. */
export function isRole(value: unknown): value is Role {
  return (
    value === 'admin_segurasist' ||
    value === 'admin_mac' ||
    value === 'operator' ||
    value === 'supervisor' ||
    value === 'insured'
  );
}
