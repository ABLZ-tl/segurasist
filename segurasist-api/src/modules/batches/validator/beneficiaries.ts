import type { BeneficiaryDto } from '@modules/insureds/dto/insured.dto';

/**
 * Parser para el CSV en celda de beneficiarios.
 *
 * Formato MAC-002:
 *   `nombre|YYYY-MM-DD|relacion;nombre|YYYY-MM-DD|relacion;...`
 *
 *   - `;` separa beneficiarios.
 *   - `|` separa campos dentro de un beneficiario.
 *   - Trim por campo. Vacío total → array vacío.
 *
 * Restricciones:
 *   - máximo 10 beneficiarios → error `BENEFICIARIES_TOO_MANY`.
 *   - cada beneficiario debe tener exactamente 3 campos no vacíos.
 *   - `relacion` debe ser uno de los enum `BeneficiaryRelationship`
 *     (spouse, child, parent, sibling, other). Aceptamos sinónimos en español.
 */

const RELATIONSHIP_MAP: Record<string, BeneficiaryDto['relationship']> = {
  spouse: 'spouse',
  esposa: 'spouse',
  esposo: 'spouse',
  conyuge: 'spouse',
  pareja: 'spouse',
  child: 'child',
  hijo: 'child',
  hija: 'child',
  parent: 'parent',
  padre: 'parent',
  madre: 'parent',
  sibling: 'sibling',
  hermano: 'sibling',
  hermana: 'sibling',
  other: 'other',
  otro: 'other',
};

export interface BeneficiariesParseResult {
  ok: boolean;
  beneficiaries: BeneficiaryDto[];
  /** Si !ok, motivo legible para el `BatchError`. */
  reason?: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseBeneficiariesCell(raw: string): BeneficiariesParseResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: true, beneficiaries: [] };
  }
  const items = raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (items.length > 10) {
    return {
      ok: false,
      beneficiaries: [],
      reason: `Beneficiarios excede el máximo de 10 (recibido ${items.length})`,
    };
  }

  const out: BeneficiaryDto[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const parts = item.split('|').map((p) => p.trim());
    if (parts.length !== 3) {
      return {
        ok: false,
        beneficiaries: [],
        reason: `Beneficiario #${i + 1} mal formado: se esperaban 3 campos separados por '|', recibidos ${parts.length}`,
      };
    }
    const [name, dob, rel] = parts as [string, string, string];
    if (name.length < 3) {
      return {
        ok: false,
        beneficiaries: [],
        reason: `Beneficiario #${i + 1}: nombre demasiado corto`,
      };
    }
    if (!ISO_DATE_RE.test(dob)) {
      return {
        ok: false,
        beneficiaries: [],
        reason: `Beneficiario #${i + 1}: fecha de nacimiento debe ser YYYY-MM-DD (recibido '${dob}')`,
      };
    }
    const dobObj = new Date(`${dob}T00:00:00Z`);
    if (Number.isNaN(dobObj.getTime())) {
      return {
        ok: false,
        beneficiaries: [],
        reason: `Beneficiario #${i + 1}: fecha de nacimiento inválida`,
      };
    }
    const normalizedRel = rel.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const mapped = RELATIONSHIP_MAP[normalizedRel];
    if (!mapped) {
      return {
        ok: false,
        beneficiaries: [],
        reason: `Beneficiario #${i + 1}: relación '${rel}' no reconocida (use spouse|child|parent|sibling|other)`,
      };
    }
    out.push({ fullName: name, dob, relationship: mapped });
  }
  return { ok: true, beneficiaries: out };
}
