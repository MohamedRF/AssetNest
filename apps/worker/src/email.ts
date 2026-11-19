import type { AppConfig } from '@assetnest/config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransport {
  readonly kind: string;
  send(message: MailMessage): Promise<void>;
}

/**
 * Dev/self-hosted default: never sends mail. Logs the envelope (never the body)
 * as a single JSON line so operators see delivery attempts in the journal.
 */
export class LogEmailTransport implements EmailTransport {
  readonly kind = 'log';
  send(message: MailMessage): Promise<void> {
    console.warn(
      JSON.stringify({
        time: new Date().toISOString(),
        level: 'info',
        msg: 'mail.sent',
        transport: 'log',
        to: message.to,
        subject: message.subject,
      }),
    );
    return Promise.resolve();
  }
}

/** Real SMTP delivery via nodemailer (createTransport is cheap but not per-message in prod hot path it's fine for low volume). */
export class SmtpEmailTransport implements EmailTransport {
  readonly kind = 'smtp';
  private readonly transporterPromise: Promise<import('nodemailer').Transporter>;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.transporterPromise = import('nodemailer').then((mailer) =>
      mailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT ?? 587,
        secure: (config.SMTP_PORT ?? 587) === 465,
        ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } } : {}),
      }),
    );
  }

  async send(message: MailMessage): Promise<void> {
    const transporter = await this.transporterPromise;
    await transporter.sendMail({
      from: this.config.SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  }
}

export function createEmailTransport(config: AppConfig): EmailTransport {
  switch (config.MAIL_TRANSPORT) {
    case 'log':
      return new LogEmailTransport();
    case 'smtp':
      return new SmtpEmailTransport(config);
    default: {
      // Fail loudly rather than silently drop mail.
      const exhaustive: never = config.MAIL_TRANSPORT;
      throw new Error(`Unsupported MAIL_TRANSPORT: ${String(exhaustive)}`);
    }
  }
}
