import { SendEmailCommand } from '@aws-sdk/client-ses';
import type { Env } from '@config/env.schema';
import { SesService } from './ses.service';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AWS_REGION: 'mx-central-1',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
    SES_SENDER_DOMAIN: 'mac.local',
    SES_CONFIGURATION_SET: 'default-cs',
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
});
