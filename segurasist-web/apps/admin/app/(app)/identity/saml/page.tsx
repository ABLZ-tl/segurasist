/**
 * Admin SAML configuration page — S5-1 Sprint 5 iter 1.
 *
 * Lets `admin_segurasist` and `admin_mac` configure the tenant's IdP:
 *   - IdP entityID, SSO URL, SLO URL.
 *   - X.509 cert (paste PEM) OR IdP metadata URL (auto-fetch).
 *   - Attribute mapping override (optional).
 *
 * Actions:
 *   - "Probar conexión" → POST /api/admin/tenants/:id/saml/test (proxy
 *     to backend's `/v1/admin/tenants/:id/saml/test` — ownership of the
 *     admin proxy route lives in iter 2).
 *   - SP metadata download link (`/v1/auth/saml/metadata`).
 *
 * UI: shadcn primitives + DS-1 Lordicons stub. The Lordicon imports are
 * gated against undefined exports so this file compiles even before
 * DS-1 lands the real `<LordIcon>` wrapper.
 */
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Section,
} from '@segurasist/ui';
import { AccessDenied } from '../../../_components/access-denied';
import { fetchMe } from '../../../../lib/auth-server';

export const dynamic = 'force-dynamic';

export default async function SamlConfigPage() {
  const me = await fetchMe();
  // Solo superadmin y tenant_admin (admin_mac) — mismo tier que /settings.
  if (me.role !== 'admin_segurasist' && me.role !== 'admin_mac') {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-4">
      <Section
        title="Identidad — SAML SSO"
        description="Configura el IdP empresarial (Okta, AzureAD, OneLogin) para el login de administradores."
      />

      <Card>
        <CardHeader>
          <CardTitle>
            {/* DS-1 wrapper landing iter 1; we keep the markup stable. */}
            <span aria-hidden className="mr-2">🔑</span>
            Conexión IdP
          </CardTitle>
          <CardDescription>
            Pega el certificado X.509 público de tu IdP (o la URL de metadatos)
            y guarda. Después usa "Probar conexión" para validar firma + claims.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" action="/api/admin/saml/save" method="post">
            <label className="grid gap-1">
              <span className="text-sm font-medium">IdP Entity ID</span>
              <input
                name="idpEntityId"
                required
                placeholder="https://idp.example.com/saml/metadata"
                className="rounded-md border px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">SSO URL (HTTP-POST)</span>
              <input
                name="idpSsoUrl"
                required
                placeholder="https://idp.example.com/sso/saml"
                className="rounded-md border px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">SLO URL (opcional)</span>
              <input
                name="idpSloUrl"
                placeholder="https://idp.example.com/slo/saml"
                className="rounded-md border px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">IdP Metadata URL (opcional)</span>
              <input
                name="idpMetadataUrl"
                placeholder="https://idp.example.com/metadata.xml"
                className="rounded-md border px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">Certificado X.509 (PEM)</span>
              <textarea
                name="idpX509Cert"
                rows={6}
                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                className="rounded-md border px-3 py-2 font-mono text-xs"
              />
            </label>
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-fg-muted">
                <span aria-hidden className="mr-1">🛡</span>
                La firma del assertion se valida contra este certificado;
                rechazamos NotOnOrAfter expirado, issuer mismatch y tenant
                claim mismatch antes de emitir cookie de sesión.
              </p>
              <div className="flex gap-2">
                <Button type="submit">Guardar</Button>
                <Button type="submit" formAction="/api/admin/saml/test" variant="secondary">
                  Probar conexión
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SP Metadata</CardTitle>
          <CardDescription>
            Descarga el XML que tu IdP necesita para registrarnos como
            Service Provider. El entityID y la URL de ACS son globales del
            stack SegurAsist; la disambiguación de tenant ocurre vía
            RelayState al iniciar el login.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/api/v1/auth/saml/metadata" download="segurasist-sp-metadata.xml">
              Descargar SP metadata.xml
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
