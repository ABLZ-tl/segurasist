'use client';

/**
 * S3-06 — Tab "Datos" de la vista 360.
 *
 * Render read-only en MVP — la edición inline llega en Sprint 4. Dos
 * columnas: Personal (CURP, RFC, nombre, DOB, email, teléfono) +
 * Póliza (paquete, vigencias, entidad, número empleado, beneficiarios).
 *
 * El bloque de beneficiarios calcula la edad a partir del DOB para evitar
 * un round-trip al backend (DOB ya viene en el payload 360).
 */

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@segurasist/ui';
import type { Insured360 } from '../../../../lib/hooks/use-insured-360';

interface Props {
  insured: Insured360['insured'];
}

function readOnlyField(label: string, value: string | null | undefined): React.ReactElement {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-fg-muted">{label}</p>
      <p className="text-sm text-fg">{value && value.length > 0 ? value : '—'}</p>
    </div>
  );
}

function ageOf(dobIso: string): number {
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export function InsuredDatosTab({ insured }: Props): React.ReactElement {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Datos personales</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {readOnlyField('CURP', insured.curp)}
          {readOnlyField('RFC', insured.rfc)}
          {readOnlyField('Nombre completo', insured.fullName)}
          {readOnlyField('Fecha de nacimiento', insured.dob)}
          {readOnlyField('Email', insured.email)}
          {readOnlyField('Teléfono', insured.phone)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Póliza</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {readOnlyField('Paquete', insured.packageName)}
          {readOnlyField('Estatus', insured.status)}
          {readOnlyField('Vigente desde', insured.validFrom)}
          {readOnlyField('Vigente hasta', insured.validTo)}
          {readOnlyField('Entidad', insured.entidad)}
          {readOnlyField('Núm. empleado', insured.numeroEmpleadoExterno)}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Beneficiarios</CardTitle>
        </CardHeader>
        <CardContent>
          {insured.beneficiaries.length === 0 ? (
            <p className="text-sm text-fg-muted">Sin beneficiarios registrados.</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="beneficiaries-list">
              {insured.beneficiaries.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium">{b.fullName}</span>
                  <span className="text-fg-muted">
                    {b.relationship} · {ageOf(b.dob)} años
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
