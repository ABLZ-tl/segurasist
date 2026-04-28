import { SendEmailCommand } from '@aws-sdk/client-ses';
import type { Env } from '@config/env.schema';
import { mapToSesTags, SesService } from './ses.service';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AWS_REGION: 'mx-central-1',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
    SES_SENDER_DOMAIN: 'mac.local',
    SES_CONFIGURATION_SET: 'default-cs',
    NODE_ENV: 'production',
    EMAIL_TRANSPORT: 'aws',
    ...overrides,
  } as Env;
}

describe('SesService', () => {
  it('sendEmail construye SendEmailCommand con HTML y from default no-reply@<domain>', async () => {
    const svc = new SesService(makeEnv());
    const sendMock = jest.fn().mockResolvedValue({ MessageId: 'mid-1' });
    (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;

    const id = await svc.sendEmail({
      to: ['x@y.com', 'z@y.com'],
      subject: 'Hola',
      html: '<p>hola</p>',
    });
    expect(id).toBe('mid-1');
    const cmd = sendMock.mock.calls[0]?.[0] as SendEmailCommand;
    expect(cmd).toBeInstanceOf(SendEmailCommand);
    expect(cmd.input.Source).toBe('no-reply@mac.local');
    expect(cmd.input.Destination?.ToAddresses).toEqual(['x@y.com', 'z@y.com']);
    expect(cmd.input.Message?.Subject?.Data).toBe('Hola');
    expect(cmd.input.Message?.Body?.Html?.Data).toBe('<p>hola</p>');
    expect(cmd.input.Message?.Body?.Text).toBeUndefined();
    expect(cmd.input.ConfigurationSetName).toBe('default-cs');
  });

  it('respeta input.from cuando se proporciona', async () => {
    const svc = new SesService(makeEnv());
    const sendMock = jest.fn().mockResolvedValue({ MessageId: 'm' });
    (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;

    await svc.sendEmail({ to: ['a@b.c'], subject: 's', html: 'h', from: 'custom@mac.local' });
    const cmd = sendMock.mock.calls[0]?.[0] as SendEmailCommand;
    expect(cmd.input.Source).toBe('custom@mac.local');
  });

  it('incluye Text body cuando se pasa input.text', async () => {
    const svc = new SesService(makeEnv());
    const sendMock = jest.fn().mockResolvedValue({ MessageId: 'm' });
    (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;

    await svc.sendEmail({ to: ['a@b.c'], subject: 's', html: '<p>h</p>', text: 'hola plain' });
    const cmd = sendMock.mock.calls[0]?.[0] as SendEmailCommand;
    expect(cmd.input.Message?.Body?.Text?.Data).toBe('hola plain');
  });

  // H-11 — Tags propagation a SES SendEmailCommand.
  describe('send() vía AWS SES — tags propagation (H-11)', () => {
    it('pasa tags como Tags:[{Name,Value}] a SendEmailCommand', async () => {
      const svc = new SesService(makeEnv());
      const sendMock = jest.fn().mockResolvedValue({ MessageId: 'mid-aws' });
      (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;

      const result = await svc.send({
        to: 'x@y.com',
        from: 'cert@mac.local',
        subject: 'Subject',
        html: '<p>h</p>',
        tags: { tenant_id: 'abc-123', email_type: 'certificate-issued', cert: 'cert-1' },
      });

      expect(result.transport).toBe('aws');
      expect(result.messageId).toBe('mid-aws');
      const cmd = sendMock.mock.calls[0]?.[0] as SendEmailCommand;
      expect(cmd).toBeInstanceOf(SendEmailCommand);
      const tags = cmd.input.Tags ?? [];
      expect(tags).toHaveLength(3);
      expect(tags).toEqual(
        expect.arrayContaining([
          { Name: 'tenant_id', Value: 'abc-123' },
          { Name: 'email_type', Value: 'certificate-issued' },
          { Name: 'cert', Value: 'cert-1' },
        ]),
      );
    });

    it('omite Tags cuando no se pasan (no envía Tags:[])', async () => {
      const svc = new SesService(makeEnv());
      const sendMock = jest.fn().mockResolvedValue({ MessageId: 'mid' });
      (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;

      await svc.send({
        to: 'x@y.com',
        from: 'cert@mac.local',
        subject: 'Subject',
        html: '<p>h</p>',
      });

      const cmd = sendMock.mock.calls[0]?.[0] as SendEmailCommand;
      expect(cmd.input.Tags).toBeUndefined();
    });

    it('sanitiza chars no permitidos por SES (regex [A-Za-z0-9_-])', async () => {
      const svc = new SesService(makeEnv());
      const sendMock = jest.fn().mockResolvedValue({ MessageId: 'mid' });
      (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;

      await svc.send({
        to: 'x@y.com',
        from: 'cert@mac.local',
        subject: 'Subject',
        html: '<p>h</p>',
        // `:` y `@` no son permitidos por SES; deben sanitizarse a `_`.
        tags: { 'with:colon': 'foo@bar', 'spaced name': 'val ue' },
      });

      const cmd = sendMock.mock.calls[0]?.[0] as SendEmailCommand;
      const tags = cmd.input.Tags ?? [];
      // Names sanitizados.
      expect(tags.map((t) => t.Name)).toEqual(expect.arrayContaining(['with_colon', 'spaced_name']));
      // Values sanitizados.
      const tagValues = tags.map((t) => t.Value);
      expect(tagValues).toEqual(expect.arrayContaining(['foo_bar', 'val_ue']));
      // Ningún tag retiene chars inválidos.
      for (const t of tags) {
        expect(t.Name).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(t.Value).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    });
  });

  describe('mapToSesTags()', () => {
    it('input undefined → []', () => {
      expect(mapToSesTags(undefined)).toEqual([]);
    });

    it('reemplaza chars no permitidos por _', () => {
      const out = mapToSesTags({ 'foo:bar': 'a@b' });
      expect(out).toEqual([{ Name: 'foo_bar', Value: 'a_b' }]);
    });

    it('respeta el cap de 50 tags por mensaje (SES limit)', () => {
      const big: Record<string, string> = {};
      for (let i = 0; i < 60; i++) big[`k${i}`] = `v${i}`;
      const out = mapToSesTags(big);
      expect(out).toHaveLength(50);
    });

    it('descarta entries con name o value vacío post-sanitize', () => {
      // Si todos los chars son inválidos, sanitizeTagToken devuelve un string
      // SOLO de underscores (que es válido). Caso edge: input vacío.
      const out = mapToSesTags({ '': 'value', name: '' });
      expect(out).toEqual([]);
    });

    it('trunca tokens >256 chars', () => {
      const longName = 'a'.repeat(300);
      const out = mapToSesTags({ [longName]: 'v' });
      expect(out[0]?.Name.length).toBe(256);
    });
  });
});
