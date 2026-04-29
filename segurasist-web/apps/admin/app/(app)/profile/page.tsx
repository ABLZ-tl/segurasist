import { Mail, ShieldCheck, Building2, Fingerprint } from 'lucide-react';
import { AlertBanner, Section } from '@segurasist/ui';
import { fetchMe } from '../../../lib/auth-server';
import { ROLE_LABEL } from '../../../lib/rbac';
import { AccessDenied } from '../../_components/access-denied';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mi perfil' };

/**
 * Admin app — Mi perfil.
 *
 * Read-only. La administración de usuarios (alta, cambio de rol, reset
 * password) la hace un `admin_mac` o `admin_segurasist` desde `/users`.
 * Esta página solo muestra al usuario logueado los datos que la API ya
 * expone vía `/v1/auth/me`. Sin password change, sin edición — esos
 * flujos viven en Cognito real (Sprint 5) o en el flujo SAML federado
 * (MAC-001).
 */
export default async function AdminProfilePage(): Promise<JSX.Element> {
  const me = await fetchMe();

  if (!me.role) {
    return <AccessDenied />;
  }

  const roleLabel = ROLE_LABEL[me.role];
  const tenantLabel = me.tenantId ?? 'Cross-tenant (superadmin)';

  return (
    <div className="space-y-6">
      <Section
        title="Mi perfil"
        description="Datos de tu cuenta en SegurAsist."
      />

      <section
        aria-label="Datos de la cuenta"
        className="space-y-4 rounded-md border border-border bg-bg-elevated p-4"
      >
        <Field
          icon={<Mail className="h-4 w-4 text-fg-muted" aria-hidden />}
          label="Correo"
          value={me.email ?? '—'}
        />
        <Field
          icon={<ShieldCheck className="h-4 w-4 text-fg-muted" aria-hidden />}
          label="Rol"
          value={roleLabel}
        />
        <Field
          icon={<Building2 className="h-4 w-4 text-fg-muted" aria-hidden />}
          label="Tenant"
          value={tenantLabel}
        />
        <Field
          icon={<Fingerprint className="h-4 w-4 text-fg-muted" aria-hidden />}
          label="ID interno"
          value={me.tenantId ? `tenant ${me.tenantId.slice(0, 8)}…` : '—'}
        />
      </section>

      <AlertBanner tone="info" title="¿Necesitas cambiar tus datos?">
        El correo, rol y tenant los gestiona el administrador del sistema.
        Para cambios de contraseña o desactivar tu cuenta, contacta a TI o
        al admin de Hospitales MAC.
      </AlertBanner>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md bg-bg">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
          {label}
        </p>
        <p className="text-sm text-fg break-words">{value}</p>
      </div>
    </div>
  );
}
