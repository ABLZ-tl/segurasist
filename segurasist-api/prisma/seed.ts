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
 * Nota sobre `admin_segurasist`:
 *   El spec dice que ese rol es cross-tenant (`tenant_id = NULL`). Sin embargo
 *   el schema (`prisma/schema.prisma`) declara `User.tenantId` como `String`
 *   (NOT NULL). Para no romper la migración / RLS, el superadmin se asocia al
 *   tenant `mac` igual; el aislamiento de "ver todo" se debe hacer en el
 *   guard / RLS bypass, no a nivel de FK. Si en el futuro el schema acepta
 *   nulos en `tenant_id`, mover este seed a `tenantId: null`.
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
  };

  const seedUsers: SeedUser[] = [
    {
      cognitoSub: 'seed-admin-mac',
      email: 'admin@mac.local',
      fullName: 'Admin MAC (seed)',
      role: UserRole.admin_mac,
      mfaEnrolled: true,
    },
    {
      cognitoSub: 'seed-superadmin',
      email: 'superadmin@segurasist.local',
      fullName: 'Super Admin SegurAsist (seed)',
      role: UserRole.admin_segurasist,
      mfaEnrolled: true,
    },
    {
      cognitoSub: 'seed-operator-mac',
      email: 'operator@mac.local',
      fullName: 'Operator MAC (seed)',
      role: UserRole.operator,
      mfaEnrolled: false,
    },
    {
      cognitoSub: 'seed-supervisor-mac',
      email: 'supervisor@mac.local',
      fullName: 'Supervisor MAC (seed)',
      role: UserRole.supervisor,
      mfaEnrolled: false,
    },
    {
      cognitoSub: 'seed-insured-mac',
      email: 'insured.demo@mac.local',
      fullName: 'Insured Demo MAC (seed)',
      role: UserRole.insured,
      mfaEnrolled: false,
    },
  ];

  for (const u of seedUsers) {
    // Idempotente: busca por email+tenant (clave de negocio); si no existe lo crea.
    // El cognitoSub `seed-*` es el placeholder hasta que el bootstrap script lo
    // reescribe con el sub real de cognito-local. Importante: NO hacemos upsert
    // por cognitoSub porque ese campo cambia entre re-bootstraps.
    const existing = await prisma.user.findFirst({
      where: { tenantId: tenant.id, email: u.email },
    });
    if (!existing) {
      await prisma.user.create({
        data: {
          tenantId: tenant.id,
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

  const total = await prisma.user.count({ where: { tenantId: tenant.id } });
  // eslint-disable-next-line no-console
  console.log(`Seed OK. Tenant ${tenant.slug} (${tenant.id}) — ${total} users`);
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
