import type { ParsedRow } from '@modules/batches/parser/types';
import { BatchesValidatorService } from '@modules/batches/validator/batches-validator.service';
import { computeCurpChecksum } from '@modules/batches/validator/curp-checksum';
import type { ValidationContext } from '@modules/batches/validator/types';

describe('BatchesValidatorService', () => {
  const svc = new BatchesValidatorService();

  // Generamos CURPs sintéticos válidos para evitar usar PII real.
  const validCurp = (prefix: string): string => {
    if (prefix.length !== 17) throw new Error('prefix must be 17 chars');
    return `${prefix}${computeCurpChecksum(prefix)}`;
  };

  const CURP_A = validCurp('HEGM860519MJCRRN0');
  const CURP_B = validCurp('BADM900315HDFRRR0');

  const baseCtx: ValidationContext = {
    tenantId: '11111111-1111-1111-1111-111111111111',
    packages: [
      { id: 'p-basic', name: 'Básico' },
      { id: 'p-prem', name: 'Premium' },
      { id: 'p-plat', name: 'Platinum' },
    ],
    existingActiveCurps: new Set(),
    activeInsuredsByCurp: new Map(),
  };

  function makeRow(rowNumber: number, raw: Partial<Record<string, string>>): ParsedRow {
    const fullRaw: Record<string, string> = {
      curp: CURP_A,
      nombre_completo: 'María Hernández',
      fecha_nacimiento: '1986-05-19',
      paquete: 'Premium',
      vigencia_inicio: '2026-01-01',
      vigencia_fin: '2026-12-31',
      ...raw,
    } as Record<string, string>;
    return { rowNumber, raw: fullRaw };
  }

  // -------------------------------------------------------------------------
  // CURP
  // -------------------------------------------------------------------------
  describe('CURP', () => {
    it('valida una fila correcta', () => {
      const r = svc.validateRow(makeRow(2, {}), baseCtx);
      expect(r.valid).toBe(true);
    });

    it('falla con CURP_REQUIRED si está vacía', () => {
      const r = svc.validateRow(makeRow(2, { curp: '' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) {
        expect(r.errors.map((e) => e.code)).toContain('CURP_REQUIRED');
      }
    });

    it('falla con CURP_INVALID si no matchea regex', () => {
      const r = svc.validateRow(makeRow(2, { curp: 'NOPE' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) {
        expect(r.errors.map((e) => e.code)).toContain('CURP_INVALID');
      }
    });

    it('falla con CURP_CHECKSUM_INVALID si dígito está mal', () => {
      const prefix = 'HEGM860519MJCRRN0';
      const dv = computeCurpChecksum(prefix);
      const wrong = `${prefix}${(dv + 1) % 10}`;
      const r = svc.validateRow(makeRow(2, { curp: wrong }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) {
        expect(r.errors.map((e) => e.code)).toContain('CURP_CHECKSUM_INVALID');
      }
    });

    it('uppercases la CURP cuando viene en lowercase', () => {
      const r = svc.validateRow(makeRow(2, { curp: CURP_A.toLowerCase() }), baseCtx);
      expect(r.valid).toBe(true);
      if (r.valid) expect(r.dto.curp).toBe(CURP_A);
    });
  });

  // -------------------------------------------------------------------------
  // RFC
  // -------------------------------------------------------------------------
  describe('RFC', () => {
    it('acepta RFC válido', () => {
      const r = svc.validateRow(makeRow(2, { rfc: 'HEGM860519XYZ' }), baseCtx);
      expect(r.valid).toBe(true);
    });

    it('rechaza RFC inválido', () => {
      const r = svc.validateRow(makeRow(2, { rfc: 'BAD-RFC' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('RFC_INVALID');
    });

    it('omitir RFC es válido (es opcional)', () => {
      const r = svc.validateRow(makeRow(2, { rfc: '' }), baseCtx);
      expect(r.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Nombre
  // -------------------------------------------------------------------------
  describe('Nombre', () => {
    it('rechaza nombre vacío', () => {
      const r = svc.validateRow(makeRow(2, { nombre_completo: '' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('NAME_REQUIRED');
    });

    it('rechaza nombre demasiado corto', () => {
      const r = svc.validateRow(makeRow(2, { nombre_completo: 'Jo' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('NAME_INVALID');
    });

    it('rechaza nombre demasiado largo', () => {
      const r = svc.validateRow(makeRow(2, { nombre_completo: 'A'.repeat(121) }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('NAME_INVALID');
    });

    it('normaliza nombre con NFC', () => {
      // 'á' como NFD (a + combining acute, U+0301) debe normalizarse.
      const decomposed = 'María';
      const r = svc.validateRow(makeRow(2, { nombre_completo: decomposed }), baseCtx);
      expect(r.valid).toBe(true);
      if (r.valid) {
        // Después de NFC, 'í' compuesto.
        expect(r.dto.fullName).toBe('María');
      }
    });
  });

  // -------------------------------------------------------------------------
  // DOB
  // -------------------------------------------------------------------------
  describe('Fecha de nacimiento', () => {
    it('rechaza formato distinto de YYYY-MM-DD', () => {
      const r = svc.validateRow(makeRow(2, { fecha_nacimiento: '19/05/1986' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('DOB_INVALID');
    });

    it('rechaza edad fuera de rango (>120 años)', () => {
      const r = svc.validateRow(makeRow(2, { fecha_nacimiento: '1800-01-01' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('DOB_OUT_OF_RANGE');
    });
  });

  // -------------------------------------------------------------------------
  // Email / Teléfono
  // -------------------------------------------------------------------------
  describe('Email/Teléfono opcionales', () => {
    it('acepta email válido', () => {
      const r = svc.validateRow(makeRow(2, { email: 'test@example.com' }), baseCtx);
      expect(r.valid).toBe(true);
    });

    it('rechaza email inválido', () => {
      const r = svc.validateRow(makeRow(2, { email: 'no-arroba' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('EMAIL_INVALID');
    });

    it('acepta teléfono E.164', () => {
      const r = svc.validateRow(makeRow(2, { telefono: '+525512345678' }), baseCtx);
      expect(r.valid).toBe(true);
    });

    it('rechaza teléfono sin prefijo +', () => {
      const r = svc.validateRow(makeRow(2, { telefono: '5512345678' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('PHONE_INVALID');
    });
  });

  // -------------------------------------------------------------------------
  // Paquete fuzzy match
  // -------------------------------------------------------------------------
  describe('Paquete fuzzy match', () => {
    it('hace match exact case-insensitive', () => {
      const r = svc.validateRow(makeRow(2, { paquete: 'premium' }), baseCtx);
      expect(r.valid).toBe(true);
      if (r.valid) expect(r.dto.packageId).toBe('p-prem');
    });

    it('detecta typo "Premiun" y sugiere top-3', () => {
      const r = svc.validateRow(makeRow(2, { paquete: 'Premiun' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) {
        const err = r.errors.find((e) => e.code === 'PACKAGE_NOT_FOUND');
        expect(err).toBeDefined();
        expect(err!.suggestions).toBeDefined();
        expect(err!.suggestions![0]).toBe('Premium');
      }
    });

    it('detecta typo "Basico" sin acento como Básico', () => {
      const r = svc.validateRow(makeRow(2, { paquete: 'Basico' }), baseCtx);
      expect(r.valid).toBe(true);
      if (r.valid) expect(r.dto.packageId).toBe('p-basic');
    });

    it('paquete totalmente diferente → suggestions vacías', () => {
      const r = svc.validateRow(makeRow(2, { paquete: 'XYZWWWW' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) {
        const err = r.errors.find((e) => e.code === 'PACKAGE_NOT_FOUND');
        expect(err).toBeDefined();
        expect(err!.suggestions).toEqual([]);
      }
    });

    it('paquete vacío → PACKAGE_REQUIRED', () => {
      const r = svc.validateRow(makeRow(2, { paquete: '' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('PACKAGE_REQUIRED');
    });
  });

  // -------------------------------------------------------------------------
  // Vigencia
  // -------------------------------------------------------------------------
  describe('Vigencia', () => {
    it('rechaza vigencia_fin <= vigencia_inicio', () => {
      const r = svc.validateRow(
        makeRow(2, { vigencia_inicio: '2026-12-01', vigencia_fin: '2026-01-01' }),
        baseCtx,
      );
      expect(r.valid).toBe(false);
      if (!r.valid) {
        expect(r.errors.map((e) => e.code)).toContain('VALIDITY_END_BEFORE_START');
      }
    });

    it('rechaza vigencia_inicio mal formateada', () => {
      const r = svc.validateRow(
        makeRow(2, { vigencia_inicio: '01/01/2026', vigencia_fin: '2026-12-31' }),
        baseCtx,
      );
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('VALIDITY_INVALID');
    });
  });

  // -------------------------------------------------------------------------
  // Beneficiarios
  // -------------------------------------------------------------------------
  describe('Beneficiarios', () => {
    it('parsea 2 beneficiarios CSV en celda', () => {
      const r = svc.validateRow(
        makeRow(2, {
          beneficiarios: 'Juan Hijo|2010-05-15|child;Ana Hija|2012-08-20|child',
        }),
        baseCtx,
      );
      expect(r.valid).toBe(true);
      if (r.valid) {
        expect(r.dto.beneficiaries).toHaveLength(2);
        expect(r.dto.beneficiaries![0]!.relationship).toBe('child');
      }
    });

    it('rechaza más de 10 beneficiarios', () => {
      const items = Array.from({ length: 11 }, (_, i) => `Benef${i}|2010-05-15|child`).join(';');
      const r = svc.validateRow(makeRow(2, { beneficiarios: items }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('BENEFICIARIES_TOO_MANY');
    });

    it('rechaza beneficiario con sintaxis incorrecta', () => {
      const r = svc.validateRow(makeRow(2, { beneficiarios: 'sin-pipes' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('BENEFICIARIES_MALFORMED');
    });

    it('rechaza beneficiario con relación desconocida', () => {
      const r = svc.validateRow(makeRow(2, { beneficiarios: 'Foo|2010-05-15|primo' }), baseCtx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('BENEFICIARIES_MALFORMED');
    });
  });

  // -------------------------------------------------------------------------
  // Duplicados intra-archivo
  // -------------------------------------------------------------------------
  describe('Duplicados intra-archivo', () => {
    it('marca DUPLICATED_IN_FILE en la 2ª ocurrencia', () => {
      const rows: ParsedRow[] = [
        makeRow(2, { curp: CURP_A }),
        makeRow(3, { curp: CURP_A }),
        makeRow(4, { curp: CURP_B }),
      ];
      const results = svc.validateAll(rows, baseCtx);
      expect(results).toHaveLength(3);
      expect(results[0]!.valid).toBe(true); // primera ocurrencia válida
      expect(results[1]!.valid).toBe(false);
      if (!results[1]!.valid) {
        expect(results[1]!.errors[0]!.code).toBe('DUPLICATED_IN_FILE');
      }
      expect(results[2]!.valid).toBe(true); // CURP_B único
    });

    it('findIntraFileDuplicates devuelve set vacío si todo es único', () => {
      const rows: ParsedRow[] = [makeRow(2, { curp: CURP_A }), makeRow(3, { curp: CURP_B })];
      const { duplicates } = svc.findIntraFileDuplicates(rows);
      expect(duplicates.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Duplicado contra BD del tenant
  // -------------------------------------------------------------------------
  describe('Duplicado contra BD del tenant', () => {
    it('marca DUPLICATED_IN_TENANT cuando CURP ya existe activo', () => {
      const ctx: ValidationContext = {
        ...baseCtx,
        existingActiveCurps: new Set([CURP_A]),
      };
      const r = svc.validateRow(makeRow(2, {}), ctx);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.map((e) => e.code)).toContain('DUPLICATED_IN_TENANT');
    });
  });

  // -------------------------------------------------------------------------
  // Renovación solapada
  // -------------------------------------------------------------------------
  describe('Renovación solapada', () => {
    it('marca INSURED_OVERLAPPING_VALIDITY cuando vigencia_inicio < existing.validTo', () => {
      const ctx: ValidationContext = {
        ...baseCtx,
        existingActiveCurps: new Set([CURP_A]),
        activeInsuredsByCurp: new Map([
          [CURP_A, { insuredId: 'i1', validTo: new Date('2027-06-30T00:00:00Z') }],
        ]),
      };
      const r = svc.validateRow(
        makeRow(2, { vigencia_inicio: '2026-01-01', vigencia_fin: '2026-12-31' }),
        ctx,
      );
      expect(r.valid).toBe(false);
      if (!r.valid) {
        expect(r.errors.map((e) => e.code)).toContain('INSURED_OVERLAPPING_VALIDITY');
      }
    });

    it('NO marca solapada si la nueva vigencia inicia después de existing.validTo', () => {
      const ctx: ValidationContext = {
        ...baseCtx,
        // existingActiveCurps NO incluye el CURP — el insured anterior fue dado de baja,
        // por lo que sólo aplica el chequeo de overlapping (no DUPLICATED_IN_TENANT).
        existingActiveCurps: new Set(),
        activeInsuredsByCurp: new Map([
          [CURP_A, { insuredId: 'i1', validTo: new Date('2025-12-31T00:00:00Z') }],
        ]),
      };
      const r = svc.validateRow(
        makeRow(2, { vigencia_inicio: '2026-01-01', vigencia_fin: '2026-12-31' }),
        ctx,
      );
      expect(r.valid).toBe(true);
    });
  });
});
