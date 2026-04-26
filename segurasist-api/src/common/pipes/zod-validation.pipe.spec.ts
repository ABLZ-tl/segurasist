import { z, ZodError } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    email: z.string().email(),
    age: z.number().int().min(18),
  });
  const pipe = new ZodValidationPipe(schema);

  it('devuelve el dato parseado cuando el input es válido', () => {
    const input = { email: 'a@b.com', age: 30 };
    expect(pipe.transform(input, { type: 'body' })).toEqual(input);
  });

  it('lanza ZodError cuando el input no cumple el schema', () => {
    expect(() => pipe.transform({ email: 'not-email', age: 30 }, { type: 'body' })).toThrow(ZodError);
  });

  it('el ZodError contiene issues de cada campo invalido', () => {
    try {
      pipe.transform({ email: 'bad', age: 5 }, { type: 'body' });
      fail('expected ZodError');
    } catch (err) {
      const e = err as ZodError;
      expect(e).toBeInstanceOf(ZodError);
      const paths = e.issues.map((i) => i.path.join('.'));
      expect(paths).toEqual(expect.arrayContaining(['email', 'age']));
    }
  });

  it('coerce y transforma según el schema (passthrough de defaults)', () => {
    const s = z.object({ limit: z.coerce.number().default(50) });
    const p = new ZodValidationPipe(s);
    expect(p.transform({}, { type: 'query' })).toEqual({ limit: 50 });
    expect(p.transform({ limit: '20' }, { type: 'query' })).toEqual({ limit: 20 });
  });

  it('lanza ZodError cuando el input es null/undefined contra schema requerido', () => {
    expect(() => pipe.transform(undefined, { type: 'body' })).toThrow(ZodError);
    expect(() => pipe.transform(null, { type: 'body' })).toThrow(ZodError);
  });

  it.each([
    ['array vacío', []],
    ['string vacío', ''],
    ['number como string', '42'],
  ])('rechaza %s contra object schema', (_label, value) => {
    expect(() => pipe.transform(value, { type: 'body' })).toThrow(ZodError);
  });
});
