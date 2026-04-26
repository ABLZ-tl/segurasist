import nodemailer from 'nodemailer';
import type { Env } from '../../../../src/config/env.schema';
import { resolveTransport, SesService } from '../../../../src/infra/aws/ses.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'development',
    AWS_REGION: 'us-east-1',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
    SES_SENDER_DOMAIN: 'mac.local',
    SES_CONFIGURATION_SET: 'cs',
    SMTP_HOST: 'localhost',
    SMTP_PORT: 1025,
    ...overrides,
  } as Env;
}

describe('SesService adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolveTransport: dev/test → smtp; staging/prod → aws; override gana', () => {
    expect(resolveTransport({ NODE_ENV: 'development' })).toBe('smtp');
    expect(resolveTransport({ NODE_ENV: 'test' })).toBe('smtp');
    expect(resolveTransport({ NODE_ENV: 'staging' })).toBe('aws');
    expect(resolveTransport({ NODE_ENV: 'production' })).toBe('aws');
    expect(resolveTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'smtp' })).toBe('smtp');
    expect(resolveTransport({ NODE_ENV: 'development', EMAIL_TRANSPORT: 'aws' })).toBe('aws');
  });

  it('en dev mode usa nodemailer/Mailpit (host+port desde env)', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<abc@local>' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

    const svc = new SesService(makeEnv({ NODE_ENV: 'development', SMTP_HOST: 'mailpit', SMTP_PORT: 1025 }));
    const out = await svc.send({
      to: 'a@b.com',
      from: 'cert@x.com',
      subject: 'S',
      html: '<p>hi</p>',
      headers: { 'X-Trace-Id': 'tid' },
      tags: { cert: 'C1' },
    });

    expect(out.transport).toBe('smtp');
    expect(out.messageId).toBe('<abc@local>');
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'mailpit', port: 1025, secure: false }),
    );
    const sentArgs = sendMail.mock.calls[0][0];
    expect(sentArgs.to).toBe('a@b.com');
    expect(sentArgs.headers['X-Trace-Id']).toBe('tid');
    expect(sentArgs.headers['X-Tag-cert']).toBe('C1');
  });

  it('en prod usa AWS SDK SES (envía SendEmailCommand)', async () => {
    const svc = new SesService(makeEnv({ NODE_ENV: 'production' }));
    const sendMock = jest.fn().mockResolvedValue({ MessageId: 'aws-1' });
    (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;

    const out = await svc.send({
      to: 'a@b.com',
      from: 'cert@x.com',
      subject: 'S',
      html: '<p>hi</p>',
      configurationSet: 'segurasist-production',
    });
    expect(out.transport).toBe('aws');
    expect(out.messageId).toBe('aws-1');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('header X-Trace-Id se inyecta vacío si el caller no lo pasa', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'm' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const svc = new SesService(makeEnv({ NODE_ENV: 'development' }));
    await svc.send({ to: 't@t.com', from: 'f@f.com', subject: 's', html: 'h' });
    const args = sendMail.mock.calls[0][0];
    expect(args.headers).toHaveProperty('X-Trace-Id');
  });
});
