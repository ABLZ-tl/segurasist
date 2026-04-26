import { PrismaClient, TenantStatus, UserRole, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed idempotente — Sprint 1 (S1-02 RBAC matrix).
 *
 * Inserta el tenant `mac` y 5 usuarios cubriendo los 5 roles del enum
 * `UserRole`. Cada usuario lleva un `cognito_sub` placeholder (`seed-*`) que
 * `scripts/cognito-local-bootstrap.sh` reescribe al sub real cuando
 * crea el espejo en cognito-local.
 *
 * M2 — Superadmin sin tenant:
 *   El superadmin (`role=admin_segurasist`) se inserta con `tenantId: null`,
 *   posibilitado por la migración `20260426_superadmin_nullable_tenant` y el
 *   CHECK constraint `users_tenant_role_check`. RLS bypass se hace al nivel
 *   de rol DB (`segurasist_admin` con BYPASSRLS) — los services superadmin
 *   inyectan `PrismaBypassRlsService` explícitamente.
 */
async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'mac' },
    update: {},
    create: {
      name: 'Hospitales MAC',
      slug: 'mac',
      status: TenantStatus.active,
    },
  });

  type SeedUser = {
    cognitoSub: string;
    email: string;
    fullName: string;
    role: UserRole;
    mfaEnrolled: boolean;
    /** null para superadmin (cross-tenant). */
    tenantId: string | null;
  };

  const seedUsers: SeedUser[] = [
    {
      cognitoSub: 'seed-admin-mac',
      email: 'admin@mac.local',
      fullName: 'Admin MAC (seed)',
      role: UserRole.admin_mac,
      mfaEnrolled: true,
      tenantId: tenant.id,
    },
    {
      cognitoSub: 'seed-superadmin',
      email: 'superadmin@segurasist.local',
      fullName: 'Super Admin SegurAsist (seed)',
      role: UserRole.admin_segurasist,
      mfaEnrolled: true,
      // M2: cross-tenant. El CHECK constraint exige NULL para admin_segurasist.
      tenantId: null,
    },
    {
      cognitoSub: 'seed-operator-mac',
      email: 'operator@mac.local',
      fullName: 'Operator MAC (seed)',
      role: UserRole.operator,
      mfaEnrolled: false,
      tenantId: tenant.id,
    },
    {
      cognitoSub: 'seed-supervisor-mac',
      email: 'supervisor@mac.local',
      fullName: 'Supervisor MAC (seed)',
      role: UserRole.supervisor,
      mfaEnrolled: false,
      tenantId: tenant.id,
    },
    {
      cognitoSub: 'seed-insured-mac',
      email: 'insured.demo@mac.local',
      fullName: 'Insured Demo MAC (seed)',
      role: UserRole.insured,
      mfaEnrolled: false,
      tenantId: tenant.id,
    },
  ];

  for (const u of seedUsers) {
    // Idempotente: busca por email+tenant (clave de negocio); si no existe lo crea.
    // El cognitoSub `seed-*` es el placeholder hasta que el bootstrap script lo
    // reescribe con el sub real de cognito-local. Importante: NO hacemos upsert
    // por cognitoSub porque ese campo cambia entre re-bootstraps.
    //
    // Para superadmin (`tenantId === null`) buscamos por email solamente: el
    // seed previo pudo haber dejado una fila con `tenantId='mac'` (workaround
    // pre-M2). Detectamos cualquier fila por email y la migramos a NULL si
    // hace falta. Para los otros roles buscamos por (tenantId, email).
    if (u.tenantId === null) {
      // Limpieza: borrar duplicados — pueden existir múltiples filas para el
      // superadmin si una corrida intermedia creó una nueva fila con
      // tenantId NULL antes de migrar la legacy. Nos quedamos con UNA sola
      // (la más antigua) y la actualizamos.
      const all = await prisma.user.findMany({
        where: { email: u.email, role: UserRole.admin_segurasist },
        orderBy: { createdAt: 'asc' },
      });
      if (all.length === 0) {
        await prisma.user.create({
          data: {
            tenantId: null,
            cognitoSub: u.cognitoSub,
            email: u.email,
            fullName: u.fullName,
            role: u.role,
            mfaEnrolled: u.mfaEnrolled,
            status: UserStatus.active,
          },
        });
      } else {
        const [keep, ...dups] = all;
        if (!keep) continue;
        // Borrar duplicados (legacy con tenantId='mac' + nuevo con NULL).
        for (const dup of dups) {
          await prisma.user.delete({ where: { id: dup.id } });
        }
        // Asegurar tenant_id=NULL en el que queda.
        if (keep.tenantId !== null) {
          await prisma.user.update({ where: { id: keep.id }, data: { tenantId: null } });
        }
      }
    } else {
      const existing = await prisma.user.findFirst({
        where: { tenantId: u.tenantId, email: u.email },
      });
      if (!existing) {
        await prisma.user.create({
          data: {
            tenantId: u.tenantId,
            cognitoSub: u.cognitoSub,
            email: u.email,
            fullName: u.fullName,
            role: u.role,
            mfaEnrolled: u.mfaEnrolled,
            status: UserStatus.active,
          },
        });
      }
    }
  }

  const total = await prisma.user.count({ where: { tenantId: tenant.id } });
  const superCount = await prisma.user.count({ where: { tenantId: null } });
  // eslint-disable-next-line no-console
  console.log(`Seed OK. Tenant ${tenant.slug} (${tenant.id}) — ${total} users, ${superCount} superadmin(s)`);
}

main()
  .catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
