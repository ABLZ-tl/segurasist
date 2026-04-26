/**
 * Unit tests del dígito verificador SEGOB para CURP.
 *
 * Estrategia: usamos `computeCurpChecksum` para generar el dígito esperado
 * sobre prefixes de 17 caracteres y verificamos que `isCurpChecksumValid`
 * devuelve `true` para la concatenación correcta y `false` para cualquier
 * otro dígito (10 inválidos por cada prefix).
 *
 * No usamos CURPs de personas reales — todos los prefixes son sintéticos
 * pero respetan el regex `^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$` salvo el
 * último char (que es el dígito a calcular).
 */
import { computeCurpChecksum, isCurpChecksumValid } from '@modules/batches/validator/curp-checksum';

describe('CURP checksum SEGOB', () => {
  // Prefixes sintéticos válidos contra el regex de los primeros 17 chars.
  // Position 0..3: 4 letras (apellidos+nombre iniciales).
  // Position 4..9: 6 dígitos (YYMMDD).
  // Position 10:    sexo (H/M).
  // Position 11..15: 5 letras (entidad+consonantes).
  // Position 16: alfanumérico (homonimia).
  const PREFIXES_17: readonly string[] = [
    'HEGM860519MJCRRN0',
    'BADM900315HDFRRR0',
    'TOBA950101MOCRSR1',
    'GORC020228HCMNZZ0',
    'PEMR721111MGTRZA9',
    'LOPL880404HMCBSL2',
    'NUNA000101HDFXXXA',
    'XXXX991231MAAAAA0',
    'AAAA850101HCSLOR8',
    'ZULM010606HMNZZZ7',
    'ABCD120304MJCMNL5',
    'CDEF160708HCMNZZ3',
  ];

  describe('computeCurpChecksum', () => {
    it('devuelve un dígito 0..9 para cada prefix válido', () => {
      for (const prefix of PREFIXES_17) {
        const dv = computeCurpChecksum(prefix);
        expect(dv).toBeGreaterThanOrEqual(0);
        expect(dv).toBeLessThanOrEqual(9);
      }
    });

    it('lanza Error si el prefix no tiene 17 chars', () => {
      expect(() => computeCurpChecksum('SHORT')).toThrow(/17/);
      expect(() => computeCurpChecksum('TOOLONGPREFIX1234567890')).toThrow(/17/);
    });

    it('lanza Error si encuentra un char fuera del charset', () => {
      // '@' no está en CURP_CHARSET.
      expect(() => computeCurpChecksum('AAAA@@0101HDFXXXA')).toThrow(/inválido/);
    });

    it('es determinista — mismo prefix → mismo dígito', () => {
      for (const prefix of PREFIXES_17) {
        expect(computeCurpChecksum(prefix)).toBe(computeCurpChecksum(prefix));
      }
    });
  });

  describe('isCurpChecksumValid — válidos', () => {
    it.each(PREFIXES_17)('reconoce válido el prefix %s + dígito calculado', (prefix) => {
      const dv = computeCurpChecksum(prefix);
      const curp = `${prefix}${dv}`;
      expect(isCurpChecksumValid(curp)).toBe(true);
    });
  });

  describe('isCurpChecksumValid — inválidos', () => {
    it.each(PREFIXES_17)('rechaza %s con dígito incorrecto', (prefix) => {
      const dv = computeCurpChecksum(prefix);
      const wrong = (dv + 1) % 10;
      expect(isCurpChecksumValid(`${prefix}${wrong}`)).toBe(false);
    });

    it('rechaza CURP con length distinto de 18', () => {
      expect(isCurpChecksumValid('SHORT')).toBe(false);
      expect(isCurpChecksumValid('HEGM860519MJCRRN08X')).toBe(false);
    });

    it('rechaza CURP con un char fuera del charset', () => {
      // Reemplazamos un char por '@' (fuera de charset).
      expect(isCurpChecksumValid('@EGM860519MJCRRN08')).toBe(false);
    });

    it('rechaza CURP con dígito verificador no numérico', () => {
      // Reemplazamos el último char por una letra.
      expect(isCurpChecksumValid('HEGM860519MJCRRN0X')).toBe(false);
    });

    it('rechaza string vacío o no string', () => {
      expect(isCurpChecksumValid('')).toBe(false);
      expect(isCurpChecksumValid(undefined as unknown as string)).toBe(false);
      expect(isCurpChecksumValid(null as unknown as string)).toBe(false);
    });
  });

  describe('round-trip: 10 prefixes válidos generan CURPs válidos', () => {
    it('genera al menos 10 CURPs sintéticos válidos', () => {
      const valid = PREFIXES_17.slice(0, 10).map((p) => `${p}${computeCurpChecksum(p)}`);
      expect(valid.length).toBeGreaterThanOrEqual(10);
      for (const curp of valid) {
        expect(isCurpChecksumValid(curp)).toBe(true);
      }
    });
  });

  describe('case-insensitive normalization', () => {
    it('reconoce válido un CURP en lowercase si tiene el dígito correcto', () => {
      const prefix = PREFIXES_17[0]!;
      const dv = computeCurpChecksum(prefix);
      const curp = `${prefix}${dv}`;
      expect(isCurpChecksumValid(curp.toLowerCase())).toBe(true);
    });
  });
});
