/**
 * SES adapter — patrón estrategia para mantener un solo punto de entrada
 * (`SesService.send(...)`) que enruta a:
 *   - **nodemailer + Mailpit** en `NODE_ENV=development`/`test` (Mailpit
 *     captura emails que cualquier cliente SMTP envía a `:1025`).
 *   - **AWS SDK v3 SES** en `staging`/`production` (Sprint 5 cablea las creds).
 *
 * Override explícito vía `EMAIL_TRANSPORT=smtp|aws` cuando se quiera forzar
 * el adapter (e.g. testing contra SES real desde dev). Sin override, gana
 * NODE_ENV.
 *
 * Header obligatorio `X-Trace-Id` propagado para correlación con logs/audit.
 */
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

export interface SendEmailOpts {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
  configurationSet?: string;
  headers?: Record<string, string>;
  /** Tags se mapean a headers SES `X-Mailer-Tag` y a `tag:` en Mailpit search. */
  tags?: Record<string, string>;
}

export interface SendEmailResult {
  messageId: string;
  /** Adapter activo en el envío — útil para tests y observabilidad. */
  transport: 'smtp' | 'aws';
}

/**
 * Backward-compat interface (usada por specs Sprint 0 del SesService viejo).
 * El método `sendEmail` queda como wrapper sobre `send(...)`.
 */
export interface SendEmailInput {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

const SMTP_DEFAULT_HOST = 'localhost';
const SMTP_DEFAULT_PORT = 1025;

@Injectable()
export class SesService {
  private readonly log = new Logger(SesService.name);
  private readonly defaultFrom: string;
  private readonly configurationSet: string;
  private readonly transport: 'smtp' | 'aws';

  /**
   * SES client (`client`) instanciado eagerly por backward-compat con specs
   * Sprint 0 (`(svc as { client }).client.send = jest.fn()`). En modo SMTP
   * el `client` queda creado pero NO se usa (`send()` enruta a smtp transporter).
   */
  protected readonly client: SESClient;
  private smtpTransporter: Transporter | null = null;
  private readonly env: Env;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.env = env;
    this.defaultFrom = `no-reply@${env.SES_SENDER_DOMAIN}`;
    this.configurationSet = env.SES_CONFIGURATION_SET;
    this.transport = resolveTransport(env);
    this.client = new SESClient({
      region: env.AWS_REGION,
      ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
    });
    this.log.log(`SesService inicializado con transport=${this.transport}`);
  }

  /**
   * API moderna usada por el email worker. Devuelve `{ messageId, transport }`.
   * El `messageId` lo asigna SES (real o Mailpit). En modo SMTP, nodemailer
   * sintetiza un Message-ID estándar; lo persistimos en `email_events.message_id`
   * para luego correlacionar con la API de Mailpit.
   */
  async send(opts: SendEmailOpts): Promise<SendEmailResult> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    // X-Trace-Id obligatorio (propagación end-to-end). El worker email lo
    // setea desde el evento; si por alguna razón llegara vacío, lo dejamos
    // como string vacío en lugar de borrarlo — facilita búsqueda en Mailpit.
    if (!('X-Trace-Id' in headers)) {
      headers['X-Trace-Id'] = '';
    }

    // Tags → headers `X-Tag-<name>: <value>` (Mailpit busca por header substring).
    if (opts.tags) {
      for (const [k, v] of Object.entries(opts.tags)) {
        headers[`X-Tag-${k}`] = v;
      }
    }

    if (this.transport === 'smtp') {
      return this.sendViaSmtp(opts, headers);
    }
    return this.sendViaSes(opts, headers);
  }

  /**
   * @deprecated Wrapper backward-compat. Mantiene la firma del SesService
   * stub Sprint 0 (devuelve `string | undefined` con `MessageId`). Internamente
   * usa el adapter moderno; en modo SMTP la respuesta también es válida.
   */
  async sendEmail(input: SendEmailInput): Promise<string | undefined> {
    if (input.to.length === 0) return undefined;
    // Mantenemos el comportamiento legacy: usa SES SDK siempre (los tests
    // unitarios stubean `client.send` directo y validan `SendEmailCommand`).
    const out = await this.client.send(
      new SendEmailCommand({
        Source: input.from ?? this.defaultFrom,
        Destination: { ToAddresses: input.to },
        Message: {
          Subject: { Data: input.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: input.html, Charset: 'UTF-8' },
            ...(input.text ? { Text: { Data: input.text, Charset: 'UTF-8' } } : {}),
          },
        },
        ConfigurationSetName: this.configurationSet,
      }),
    );
    return out.MessageId;
  }

  private async sendViaSmtp(opts: SendEmailOpts, headers: Record<string, string>): Promise<SendEmailResult> {
    const transporter = this.getSmtpTransporter();
    const info = (await transporter.sendMail({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
      headers,
    })) as { messageId?: string };
    const messageId = info.messageId ?? `<smtp-${Date.now()}@local>`;
    return { messageId, transport: 'smtp' };
  }

  private async sendViaSes(opts: SendEmailOpts, headers: Record<string, string>): Promise<SendEmailResult> {
    // SDK v3 SendEmailCommand NO soporta headers custom directamente; la API
    // moderna de SES (SendRawEmailCommand) sí, pero requiere construir MIME.
    // Para MVP enviamos por SendEmailCommand y dejamos los headers para el
    // upgrade Sprint 5 (cuando integremos SendRawEmailCommand + DKIM por tenant).
    const _headersUnused = headers;
    void _headersUnused;
    const out = await this.client.send(
      new SendEmailCommand({
        Source: opts.from,
        Destination: { ToAddresses: [opts.to] },
        Message: {
          Subject: { Data: opts.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: opts.html, Charset: 'UTF-8' },
            ...(opts.text ? { Text: { Data: opts.text, Charset: 'UTF-8' } } : {}),
          },
        },
        ConfigurationSetName: opts.configurationSet ?? this.configurationSet,
      }),
    );
    return { messageId: out.MessageId ?? '', transport: 'aws' };
  }

  private getSmtpTransporter(): Transporter {
    if (!this.smtpTransporter) {
      this.smtpTransporter = nodemailer.createTransport({
        host: this.env.SMTP_HOST ?? SMTP_DEFAULT_HOST,
        port: this.env.SMTP_PORT ?? SMTP_DEFAULT_PORT,
        secure: false,
        // Mailpit acepta auth dummy o sin auth.
        ignoreTLS: true,
      });
    }
    return this.smtpTransporter;
  }
}

/**
 * Resuelve el adapter activo. Override explícito gana siempre; sin override,
 * dev/test usan SMTP (Mailpit) y staging/production usan AWS SDK.
 */
export function resolveTransport(env: Partial<Pick<Env, 'NODE_ENV' | 'EMAIL_TRANSPORT'>>): 'smtp' | 'aws' {
  if (env.EMAIL_TRANSPORT) return env.EMAIL_TRANSPORT;
  return env.NODE_ENV === 'production' || env.NODE_ENV === 'staging' ? 'aws' : 'smtp';
}
