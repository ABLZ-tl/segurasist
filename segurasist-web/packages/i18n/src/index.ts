import common from '../messages/es-MX/common.json' assert { type: 'json' };
import auth from '../messages/es-MX/auth.json' assert { type: 'json' };
import insureds from '../messages/es-MX/insureds.json' assert { type: 'json' };
import batches from '../messages/es-MX/batches.json' assert { type: 'json' };
import certificates from '../messages/es-MX/certificates.json' assert { type: 'json' };
import reports from '../messages/es-MX/reports.json' assert { type: 'json' };
import chat from '../messages/es-MX/chat.json' assert { type: 'json' };
import errors from '../messages/es-MX/errors.json' assert { type: 'json' };

export const DEFAULT_LOCALE = 'es-MX' as const;
export type Locale = typeof DEFAULT_LOCALE;

export const messages = {
  'es-MX': {
    common,
    auth,
    insureds,
    batches,
    certificates,
    reports,
    chat,
    errors,
  },
} as const;

export type Messages = (typeof messages)['es-MX'];
