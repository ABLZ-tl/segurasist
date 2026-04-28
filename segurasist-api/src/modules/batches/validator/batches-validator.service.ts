import type { BeneficiaryDto, CreateInsuredDto } from '@modules/insureds/dto/insured.dto';
import { Injectable } from '@nestjs/common';
import type { ParsedRow } from '../parser/types';
import { parseBeneficiariesCell } from './beneficiaries';
import { isCurpChecksumValid } from './curp-checksum';
import { levenshtein, topKByLevenshtein } from './levenshtein';
import type { FieldError, RowResult, ValidationContext } from './types';

const CURP_RE = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;
const RFC_RE = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+\d{10,15}$/;
const NAME_MIN = 3;
const NAME_MAX = 120;
const PACKAGE_FUZZY_THRESHOLD = 2;
const AGE_MIN = 0;
const AGE_MAX = 120;

/**
 * Valida cada fila contra las reglas oficiales del layout v1 (MAC-002).
 *
 * Diseño de salida: `RowResult` (union discriminado). El caller persiste cada
 * error en `batch_errors` y, para filas válidas, las encola en
 * `insureds-creation-queue` cuando se confirma el batch.
 *
 * Las reglas que requieren contexto de tenant (paquetes, duplicados) las
 * resuelve `ValidationContext`. Esto permite testear sin BD: pasar el
 * contexto manualmente.
 */
@Injectable()
export class BatchesValidatorService {
  /**
   * Valida una fila individual. NO realiza queries — todo el contexto del
   * tenant viene en `ctx`.
   *
   * Para detectar duplicados intra-archivo el caller debe llamar antes a
   * `findIntraFileDuplicates(rows)` y pasar el set resultante en
   * `ctx.intraFileDuplicates` (preferimos pasarlo por `validateAll`).
   */
  validateRow(row: ParsedRow, ctx: ValidationContext): RowResult {
    const errors: FieldError[] = [];
    const raw = row.raw;
    const curpRaw = (raw.curp ?? '').toUpperCase();

    // 1) CURP
    if (!curpRaw) {
      errors.push({
        column: 'curp',
        code: 'CURP_REQUIRED',
        message: 'CURP es obligatorio',
      });
    } else if (!CURP_RE.test(curpRaw)) {
      errors.push({
        column: 'curp',
        code: 'CURP_INVALID',
        message: 'CURP no cumple el formato (18 chars, regex SEGOB)',
        rawValue: curpRaw,
      });
    } else if (!isCurpChecksumValid(curpRaw)) {
      errors.push({
        column: 'curp',
        code: 'CURP_CHECKSUM_INVALID',
        message: 'CURP con dígito verificador inválido',
        rawValue: curpRaw,
      });
    }

    // 2) RFC (opcional)
    const rfc = raw.rfc?.toUpperCase();
    if (rfc && rfc.length > 0 && !RFC_RE.test(rfc)) {
      errors.push({
        column: 'rfc',
        code: 'RFC_INVALID',
        message: 'RFC no cumple el formato (12-13 chars)',
        rawValue: rfc,
      });
    }

    // 3) Nombre
    const name = raw.nombre_completo?.normalize('NFC') ?? '';
    if (!name) {
      errors.push({
        column: 'nombre_completo',
        code: 'NAME_REQUIRED',
        message: 'Nombre completo es obligatorio',
      });
    } else if (name.length < NAME_MIN || name.length > NAME_MAX) {
      errors.push({
        column: 'nombre_completo',
        code: 'NAME_INVALID',
        message: `Nombre debe tener entre ${NAME_MIN} y ${NAME_MAX} caracteres`,
        rawValue: name,
      });
    }

    // 4) Fecha nacimiento
    const dobRaw = raw.fecha_nacimiento;
    if (!dobRaw || !ISO_DATE_RE.test(dobRaw)) {
      errors.push({
        column: 'fecha_nacimiento',
        code: 'DOB_INVALID',
        message: 'Fecha de nacimiento debe ser YYYY-MM-DD',
        rawValue: dobRaw,
      });
    } else {
      const dob = new Date(`${dobRaw}T00:00:00Z`);
      if (Number.isNaN(dob.getTime())) {
        errors.push({
          column: 'fecha_nacimiento',
          code: 'DOB_INVALID',
          message: 'Fecha de nacimiento no parseable',
          rawValue: dobRaw,
        });
      } else {
        const ageYears = (Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
        if (ageYears < AGE_MIN || ageYears > AGE_MAX) {
          errors.push({
            column: 'fecha_nacimiento',
            code: 'DOB_OUT_OF_RANGE',
            message: `Edad fuera de rango (${AGE_MIN}–${AGE_MAX} años)`,
            rawValue: dobRaw,
          });
        }
      }
    }

    // 5) Email (opcional)
    const email = raw.email;
    if (email && !EMAIL_RE.test(email)) {
      errors.push({
        column: 'email',
        code: 'EMAIL_INVALID',
        message: 'Email no cumple formato RFC 5322',
        rawValue: email,
      });
    }

    // 6) Teléfono (opcional, E.164)
    const phone = raw.telefono;
    if (phone && !PHONE_RE.test(phone)) {
      errors.push({
        column: 'telefono',
        code: 'PHONE_INVALID',
        message: 'Teléfono debe ser E.164 (`+` seguido de 10–15 dígitos)',
        rawValue: phone,
      });
    }

    // 7) Paquete (match case-insensitive contra catálogo del tenant)
    const paqueteRaw = raw.paquete;
    let packageId: string | null = null;
    if (!paqueteRaw) {
      errors.push({
        column: 'paquete',
        code: 'PACKAGE_REQUIRED',
        message: 'Paquete es obligatorio',
      });
    } else {
      const normalizePackageName = (s: string): string =>
        s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      const target = normalizePackageName(paqueteRaw);
      const exact = ctx.packages.find((p) => normalizePackageName(p.name) === target);
      if (exact) {
        packageId = exact.id;
      } else {
        const suggestions = topKByLevenshtein(
          paqueteRaw,
          ctx.packages.map((p) => p.name),
        );
        // Filtramos sólo los que tengan distancia ≤ THRESHOLD para no sugerir basura.
        // (Si todas las distancias > THRESHOLD, dejamos suggestions vacías y mostramos
        // el catálogo completo en la UI a través de reportPackageCatalog.)
        errors.push({
          column: 'paquete',
          code: 'PACKAGE_NOT_FOUND',
          message: `Paquete '${paqueteRaw}' no existe en el catálogo del tenant`,
          rawValue: paqueteRaw,
          suggestions:
            suggestions.length > 0 &&
            suggestions.every(() => true) &&
            this.fuzzyDistanceOk(paqueteRaw, suggestions[0]!)
              ? suggestions
              : [],
        });
      }
    }

    // 8/9) Vigencia
    const vigInicio = raw.vigencia_inicio;
    const vigFin = raw.vigencia_fin;
    let vigenciaOk = true;
    if (!vigInicio || !ISO_DATE_RE.test(vigInicio)) {
      errors.push({
        column: 'vigencia_inicio',
        code: 'VALIDITY_INVALID',
        message: 'vigencia_inicio debe ser YYYY-MM-DD',
        rawValue: vigInicio,
      });
      vigenciaOk = false;
    }
    if (!vigFin || !ISO_DATE_RE.test(vigFin)) {
      errors.push({
        column: 'vigencia_fin',
        code: 'VALIDITY_INVALID',
        message: 'vigencia_fin debe ser YYYY-MM-DD',
        rawValue: vigFin,
      });
      vigenciaOk = false;
    }
    if (vigenciaOk) {
      const a = new Date(`${vigInicio}T00:00:00Z`);
      const b = new Date(`${vigFin}T00:00:00Z`);
      if (!(b.getTime() > a.getTime())) {
        errors.push({
          column: 'vigencia_fin',
          code: 'VALIDITY_END_BEFORE_START',
          message: 'vigencia_fin debe ser posterior a vigencia_inicio',
          rawValue: `${vigInicio}..${vigFin}`,
        });
        vigenciaOk = false;
      }
    }

    // 12) Beneficiarios
    const benefRaw = raw.beneficiarios ?? '';
    const benefResult = parseBeneficiariesCell(benefRaw);
    let beneficiaries: BeneficiaryDto[] = [];
    if (!benefResult.ok) {
      errors.push({
        column: 'beneficiarios',
        code: benefResult.reason?.includes('máximo') ? 'BENEFICIARIES_TOO_MANY' : 'BENEFICIARIES_MALFORMED',
        message: benefResult.reason ?? 'Beneficiarios mal formados',
        rawValue: benefRaw,
      });
    } else {
      beneficiaries = benefResult.beneficiaries;
    }

    // Duplicados contra BD del tenant
    if (curpRaw && CURP_RE.test(curpRaw)) {
      if (ctx.existingActiveCurps.has(curpRaw)) {
        errors.push({
          column: 'curp',
          code: 'DUPLICATED_IN_TENANT',
          message: `CURP ${curpRaw} ya existe activo en el tenant`,
          rawValue: curpRaw,
        });
      }
      // Renovación solapada: si existe activo con validTo > nueva.vigencia_inicio.
      const existing = ctx.activeInsuredsByCurp.get(curpRaw);
      if (existing && vigenciaOk && vigInicio) {
        const newStart = new Date(`${vigInicio}T00:00:00Z`);
        if (existing.validTo.getTime() > newStart.getTime()) {
          errors.push({
            column: 'vigencia_inicio',
            code: 'INSURED_OVERLAPPING_VALIDITY',
            message: `CURP ${curpRaw} ya tiene póliza activa con vigencia hasta ${existing.validTo.toISOString().slice(0, 10)}; la nueva vigencia inicia ${vigInicio} (solapada)`,
            rawValue: vigInicio,
          });
        }
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        rowNumber: row.rowNumber,
        errors,
        rawCurp: curpRaw && CURP_RE.test(curpRaw) ? curpRaw : null,
      };
    }

    // Construir DTO si todo válido. `dobValid` y `vigenciaOk` aseguran que los
    // strings van a Zod sanos.
    const dto: CreateInsuredDto = {
      curp: curpRaw,
      ...(rfc && rfc.length > 0 ? { rfc } : {}),
      fullName: name,
      dob: dobRaw!,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      packageId: packageId!,
      validFrom: vigInicio!,
      validTo: vigFin!,
      ...(beneficiaries.length > 0 ? { beneficiaries } : {}),
    };

    return { valid: true, rowNumber: row.rowNumber, dto };
  }

  /**
   * Recorre `rows` y devuelve un Set de CURPs duplicados (los que aparecen
   * 2+ veces). El caller puede usarlo para marcar `DUPLICATED_IN_FILE` en
   * todas excepto la primera ocurrencia.
   *
   * Devolvemos también el map curp → rowNumber de la primera ocurrencia,
   * útil para el mensaje del error.
   */
  findIntraFileDuplicates(rows: readonly ParsedRow[]): {
    duplicates: Set<string>;
    firstSeen: Map<string, number>;
  } {
    const counts = new Map<string, number>();
    const firstSeen = new Map<string, number>();
    for (const r of rows) {
      const c = (r.raw.curp ?? '').toUpperCase();
      if (!c || !CURP_RE.test(c)) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
      if (!firstSeen.has(c)) firstSeen.set(c, r.rowNumber);
    }
    const dups = new Set<string>();
    for (const [c, n] of counts.entries()) {
      if (n > 1) dups.add(c);
    }
    return { duplicates: dups, firstSeen };
  }

  /**
   * Valida todas las filas. Aplica deduplicación intra-archivo
   * automáticamente: las ocurrencias 2+ obtienen un error
   * `DUPLICATED_IN_FILE` (la primera ocurrencia mantiene su validación normal).
   *
   * Si `precomputed` se pasa, NO se vuelve a calcular `findIntraFileDuplicates`
   * — la usa un caller chunked (LayoutWorker) que necesita detectar duplicados
   * entre chunks (C-05): si computásemos por chunk, dups separados por >500
   * filas no se marcarían. El caller debe haber corrido
   * `findIntraFileDuplicates` sobre TODO el set de filas antes del loop.
   */
  validateAll(
    rows: readonly ParsedRow[],
    ctx: ValidationContext,
    precomputed?: { duplicates: ReadonlySet<string>; firstSeen: ReadonlyMap<string, number> },
  ): RowResult[] {
    const { duplicates, firstSeen } = precomputed ?? this.findIntraFileDuplicates(rows);
    const out: RowResult[] = [];
    const seenInThisLoop = new Set<string>();
    for (const r of rows) {
      const curp = (r.raw.curp ?? '').toUpperCase();
      const isDup = duplicates.has(curp) && firstSeen.get(curp) !== r.rowNumber;
      if (isDup && !seenInThisLoop.has(`${r.rowNumber}:${curp}`)) {
        seenInThisLoop.add(`${r.rowNumber}:${curp}`);
        out.push({
          valid: false,
          rowNumber: r.rowNumber,
          errors: [
            {
              column: 'curp',
              code: 'DUPLICATED_IN_FILE',
              message: `CURP ${curp} duplicada en el archivo (primera ocurrencia: fila ${firstSeen.get(curp)})`,
              rawValue: curp,
            },
          ],
          rawCurp: curp,
        });
        continue;
      }
      out.push(this.validateRow(r, ctx));
    }
    return out;
  }

  private fuzzyDistanceOk(needle: string, candidate: string): boolean {
    // Usado internamente para decidir si las sugerencias se incluyen en
    // PACKAGE_NOT_FOUND. Sólo si la mejor sugerencia tiene distancia ≤ threshold.
    const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    return levenshtein(norm(candidate), norm(needle)) <= PACKAGE_FUZZY_THRESHOLD;
  }
}
