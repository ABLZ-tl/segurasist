import {
  CoverageType,
  InsuredStatus,
  PackageStatus,
  PrismaClient,
  TenantStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';

/**
 * Sprint 5 — Seed multi-tenant para QA E2E + visual regression (MT-4).
 *
 * Provee 2 tenants demo con branding distinto + 1 insured por tenant + 1 admin
 * por tenant + 1 paquete con 4 coberturas, replicando el shape mínimo que el
 * portal y los tests cross-leak necesitan.
 *
 * **Coordinación con MT-1**: si MT-1 publica su propio seed (mismo path) este
 * archivo queda como fallback explícito de QA. Las INSERT son idempotentes
 * por (tenant.slug) y (insured.curp) → re-correr no duplica filas.
 *
 * **Idempotencia**:
 *   - Tenant: upsert por slug.
 *   - User: findFirst por (tenantId, email) + create si falta.
 *   - Package: findFirst por (tenantId, name) + create si falta.
 *   - Insured: findFirst por (tenantId, curp) + create si falta.
 *   - Coverage: skipDuplicates en createMany (UNIQUE no existe — usamos
 *     una guarda con findFirst).
 *
 * **Cognito-local users**:
 *   No se sincronizan desde aquí (cognito-local-bootstrap.sh es el dueño).
 *   El seed deja `cognito_sub` placeholder `seed-<tenant>-<role>` que el
 *   bootstrap reescribe al sub real cuando crea el espejo. Para que los
 *   tests E2E logueen, hay que correr (post-seed):
 *
 *     bash scripts/cognito-local-bootstrap.sh --multi-tenant
 *
 *   Nota MT-4 → MT-1: el script actual sólo conoce el tenant `mac`. En iter 2
 *   pediremos a MT-1 extender el bootstrap para registrar admin/insured de
 *   `demo-insurer` también. Hasta entonces los E2E corren con `it.skip`
 *   blocked-by:cognito-bootstrap.
 *
 * **Run**:
 *   pnpm --filter segurasist-api prisma:seed:multi-tenant
 *   (script en package.json — agregar en iter 2 si MT-1 no lo añade)
 *
 *   o directamente:
 *   pnpm --filter segurasist-api ts-node prisma/seed-multi-tenant.ts
 */
const prisma = new PrismaClient();

interface TenantSpec {
  slug: string;
  name: string;
  displayName: string;
  tagline: string;
  primaryHex: string;
  accentHex: string;
  logoUrl: string | null;
  adminEmail: string;
  insuredCurp: string;
  insuredFullName: string;
  insuredEmail: string;
  insuredDob: Date;
  packageName: string;
}

const TENANTS: TenantSpec[] = [
  {
    slug: 'mac',
    name: 'Hospitales MAC',
    displayName: 'Hospitales MAC',
    tagline: 'Tu salud, nuestra prioridad',
    primaryHex: '#16a34a',
    accentHex: '#7c3aed',
    logoUrl: null,
    adminEmail: 'admin@mac.local',
    insuredCurp: 'HEGM860519MJCRRN08',
    insuredFullName: 'María Hernández García',
    insuredEmail: 'insured.demo@mac.local',
    insuredDob: new Date('1986-05-19'),
    packageName: 'Premium',
  },
  {
    slug: 'demo-insurer',
    name: 'Demo Insurer',
    displayName: 'Demo Insurer',
    tagline: 'Cobertura confiable',
    primaryHex: '#dc2626',
    accentHex: '#0891b2',
    logoUrl: null,
    adminEmail: 'admin@demo-insurer.local',
    insuredCurp: 'LOPA900215HDFRRR07',
    insuredFullName: 'Andrés López Ramírez',
    insuredEmail: 'insured.demo@demo-insurer.local',
    insuredDob: new Date('1990-02-15'),
    packageName: 'Estándar',
  },
];

const COVERAGES: Array<{ name: string; type: CoverageType; limitCount: number }> = [
  { name: 'Consultas médicas', type: CoverageType.consultation, limitCount: 12 },
  { name: 'Hospitalización', type: CoverageType.hospitalization, limitCount: 1 },
  { name: 'Urgencias', type: CoverageType.emergency, limitCount: 6 },
  { name: 'Laboratorios', type: CoverageType.laboratory, limitCount: 8 },
];

async function seedTenant(spec: TenantSpec): Promise<void> {
  // 1) Tenant con branding completo (Sprint 5).
  const tenant = await prisma.tenant.upsert({
    where: { slug: spec.slug },
    update: {
      name: spec.name,
      displayName: spec.displayName,
      tagline: spec.tagline,
      brandingPrimaryHex: spec.primaryHex,
      brandingAccentHex: spec.accentHex,
      brandingLogoUrl: spec.logoUrl,
      brandingUpdatedAt: new Date(),
    },
    create: {
      name: spec.name,
      slug: spec.slug,
      status: TenantStatus.active,
      displayName: spec.displayName,
      tagline: spec.tagline,
      brandingPrimaryHex: spec.primaryHex,
      brandingAccentHex: spec.accentHex,
      brandingLogoUrl: spec.logoUrl,
      brandingUpdatedAt: new Date(),
    },
  });

  // 2) Admin del tenant (idempotente por email+tenantId).
  const adminExisting = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: spec.adminEmail },
  });
  if (!adminExisting) {
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        cognitoSub: `seed-admin-${spec.slug}`,
        email: spec.adminEmail,
        fullName: `Admin ${spec.name} (seed)`,
        role: UserRole.admin_mac,
        mfaEnrolled: false,
        status: UserStatus.active,
      },
    });
  }

  // 3) Insured user (admin pool side — algunos endpoints lo necesitan).
  const insuredUserExisting = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: spec.insuredEmail },
  });
  const insuredUser = insuredUserExisting
    ? insuredUserExisting
    : await prisma.user.create({
        data: {
          tenantId: tenant.id,
          cognitoSub: `seed-insured-${spec.slug}`,
          email: spec.insuredEmail,
          fullName: `${spec.insuredFullName} (seed)`,
          role: UserRole.insured,
          mfaEnrolled: false,
          status: UserStatus.active,
        },
      });

  // 4) Package + 4 coberturas.
  let pkg = await prisma.package.findFirst({
    where: { tenantId: tenant.id, name: spec.packageName },
  });
  if (!pkg) {
    pkg = await prisma.package.create({
      data: {
        tenantId: tenant.id,
        name: spec.packageName,
        description: `Plan demo ${spec.packageName} — seed multi-tenant Sprint 5`,
        status: PackageStatus.active,
      },
    });
  }
  for (const cov of COVERAGES) {
    const exists = await prisma.coverage.findFirst({
      where: { tenantId: tenant.id, packageId: pkg.id, name: cov.name },
    });
    if (!exists) {
      await prisma.coverage.create({
        data: {
          tenantId: tenant.id,
          packageId: pkg.id,
          name: cov.name,
          type: cov.type,
          limitCount: cov.limitCount,
        },
      });
    }
  }

  // 5) Insured (cliente final).
  const insuredExisting = await prisma.insured.findFirst({
    where: { tenantId: tenant.id, curp: spec.insuredCurp },
  });
  if (!insuredExisting) {
    await prisma.insured.create({
      data: {
        tenantId: tenant.id,
        curp: spec.insuredCurp,
        fullName: spec.insuredFullName,
        dob: spec.insuredDob,
        email: spec.insuredEmail,
        packageId: pkg.id,
        validFrom: new Date('2026-01-01'),
        validTo: new Date('2027-03-31'),
        status: InsuredStatus.active,
        cognitoSub: insuredUser.cognitoSub,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `[seed-multi-tenant] tenant=${spec.slug} ok (id=${tenant.id}, primary=${spec.primaryHex})`,
  );
}

async function main(): Promise<void> {
  for (const spec of TENANTS) {
    await seedTenant(spec);
  }

  const tenantCount = await prisma.tenant.count();
  // eslint-disable-next-line no-console
  console.log(`[seed-multi-tenant] OK — total tenants en DB: ${tenantCount}`);
}

main()
  .catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[seed-multi-tenant] FAIL', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
