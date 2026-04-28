/**
 * S4-06 — Seed inicial de la KB del chatbot (idempotente).
 *
 * Crea ~25 entries en español MX para el tenant demo `mac` cubriendo 5
 * categorías: coverages, claims, certificates, billing, general.
 *
 * Las entries usan los placeholders soportados por
 * `PersonalizationService.fillPlaceholders` (S6) — `{{validTo}}`,
 * `{{coveragesList}}`, `{{firstName}}`, `{{packageName}}`, etc.
 *
 * Idempotencia: por (tenantId, category, question) — si ya existe la
 * dejamos sin tocar (preserve admin edits). NO eliminamos entries
 * preexistentes que no estén en la lista.
 *
 * Run:
 *   npx ts-node seed/chatbot-kb-seed.ts
 *
 * O acoplar al `prisma seed`/CI vía `package.json` script (Sprint 5+ unifica
 * todos los seeds bajo un script `pnpm seed`).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedEntry {
  category: 'coverages' | 'claims' | 'certificates' | 'billing' | 'general';
  question: string;
  answer: string;
  keywords: string[];
  synonyms?: Record<string, string[]>;
  priority?: number;
}

/**
 * Listado curado en es-MX. Orden por categoría; priority>0 marca entries
 * "preferidas" cuando hay solapamiento de keywords (e.g. "vencimiento" puede
 * matchear `general:cuándo-vence` y `certificates:fecha-de-validez`; el
 * primero gana por priority).
 */
const ENTRIES: SeedEntry[] = [
  // -------------------------------------------------------------------------
  // GENERAL
  // -------------------------------------------------------------------------
  {
    category: 'general',
    question: '¿Hasta cuándo es mi póliza?',
    answer:
      'Hola {{firstName}}, tu póliza está vigente hasta el {{validTo}}. ' +
      'Si necesitas renovarla, contáctate con tu asesor.',
    keywords: ['poliza', 'vencimiento', 'fecha', 'vigencia'],
    synonyms: {
      poliza: ['seguro', 'cobertura'],
      vencimiento: ['vence', 'caduca', 'expira', 'termina'],
      fecha: ['cuando', 'cuándo'],
    },
    priority: 10,
  },
  {
    category: 'general',
    question: '¿Cuál es mi paquete?',
    answer: 'Tu paquete actual es {{packageName}} con {{coveragesCount}} coberturas activas.',
    keywords: ['paquete', 'plan'],
    synonyms: { paquete: ['plan', 'membresia', 'membresía'] },
  },
  {
    category: 'general',
    question: '¿Cómo contacto a un asesor?',
    answer:
      'Puedes contactar a un asesor escribiendo "agente" o "humano" en este chat. ' +
      'Tu solicitud se canalizará al equipo de atención.',
    keywords: ['asesor', 'agente', 'humano', 'soporte'],
    synonyms: { asesor: ['representante', 'persona', 'ejecutivo'], soporte: ['ayuda', 'atencion', 'atención'] },
  },
  {
    category: 'general',
    question: '¿Cómo funciona el chatbot?',
    answer:
      'Soy el asistente virtual de SegurAsist. Puedo ayudarte con consultas sobre tus coberturas, ' +
      'siniestros, certificados y facturación. Si no tengo la respuesta, te conecto con un humano.',
    keywords: ['chatbot', 'asistente', 'bot'],
    synonyms: { chatbot: ['robot', 'asistente'] },
  },
  {
    category: 'general',
    question: '¿Qué es SegurAsist?',
    answer:
      'SegurAsist es la plataforma que administra tu seguro médico privado. ' +
      'Aquí puedes consultar coberturas, descargar certificados y reportar siniestros.',
    keywords: ['segurasist', 'plataforma', 'aplicacion'],
    synonyms: { aplicacion: ['app', 'portal', 'sistema'] },
  },

  // -------------------------------------------------------------------------
  // COVERAGES
  // -------------------------------------------------------------------------
  {
    category: 'coverages',
    question: '¿Qué coberturas tengo?',
    answer:
      'Tu paquete {{packageName}} incluye: {{coveragesList}}. ' +
      'Para detalles de cada cobertura entra a la sección "Mis coberturas" en el portal.',
    keywords: ['coberturas', 'cobertura', 'incluye'],
    synonyms: {
      coberturas: ['servicios', 'beneficios', 'protecciones'],
      incluye: ['cubre', 'tiene', 'ofrece'],
    },
    priority: 10,
  },
  {
    category: 'coverages',
    question: '¿Tengo cobertura de hospitalización?',
    answer:
      'Para verificar si tu plan incluye hospitalización, revisa "{{coveragesList}}". ' +
      'Si está listada, tienes la cobertura activa.',
    keywords: ['hospitalizacion', 'internamiento', 'hospital'],
    synonyms: {
      hospitalizacion: ['internado', 'internacion', 'estadia', 'estancia'],
      hospital: ['clinica', 'sanatorio'],
    },
  },
  {
    category: 'coverages',
    question: '¿Cubre consultas médicas?',
    answer:
      'Las consultas médicas suelen estar cubiertas según tu paquete. Tu plan actual tiene: {{coveragesList}}. ' +
      'Si "consultation" aparece, sí tienes este beneficio.',
    keywords: ['consultas', 'consulta', 'medico'],
    synonyms: {
      consultas: ['cita', 'visita'],
      medico: ['doctor', 'especialista'],
    },
  },
  {
    category: 'coverages',
    question: '¿Cuántas consultas tengo al año?',
    answer:
      'El número de consultas anuales depende del paquete. En la sección "Mis coberturas" del portal ' +
      'verás el límite por servicio. También puedes pedir hablar con un asesor.',
    keywords: ['consultas', 'limite', 'anual', 'cuantas'],
    synonyms: {
      limite: ['tope', 'maximo', 'máximo'],
      anual: ['año', 'ano', 'yearly'],
    },
  },
  {
    category: 'coverages',
    question: '¿Tengo cobertura de medicamentos?',
    answer:
      'Si tu paquete incluye "pharmacy" en {{coveragesList}}, sí tienes cobertura de medicamentos. ' +
      'Pregunta a tu asesor por el listado de farmacias autorizadas.',
    keywords: ['medicamentos', 'farmacia', 'medicinas'],
    synonyms: {
      medicamentos: ['medicinas', 'pastillas', 'tratamiento'],
      farmacia: ['drogueria', 'droguería', 'botica'],
    },
  },
  {
    category: 'coverages',
    question: '¿Tengo cobertura para emergencias?',
    answer:
      'Si "emergency" aparece en {{coveragesList}} tu plan cubre emergencias médicas. ' +
      'Llama al número de atención inmediata si requieres uso urgente.',
    keywords: ['emergencia', 'urgencia', 'emergencias'],
    synonyms: {
      emergencia: ['emergencias', 'urgencia', 'urgente'],
    },
  },

  // -------------------------------------------------------------------------
  // CLAIMS
  // -------------------------------------------------------------------------
  {
    category: 'claims',
    question: '¿Cómo reporto un siniestro?',
    answer:
      'Para reportar un siniestro entra a la sección "Siniestros" del portal y haz clic en "Nuevo reporte". ' +
      'Adjunta la documentación médica y un asesor lo revisará en 48 hrs.',
    keywords: ['siniestro', 'reportar', 'reporte'],
    synonyms: {
      siniestro: ['reclamo', 'caso', 'evento'],
      reportar: ['avisar', 'declarar', 'levantar'],
    },
    priority: 10,
  },
  {
    category: 'claims',
    question: '¿Cuántos siniestros tengo abiertos?',
    answer: 'Tienes {{claimsCount}} siniestro(s) abierto(s). Puedes verlos en la sección "Mis siniestros".',
    keywords: ['siniestros', 'abiertos', 'cuantos', 'pendientes'],
    synonyms: {
      abiertos: ['activos', 'vigentes', 'pendientes'],
    },
  },
  {
    category: 'claims',
    question: '¿En cuánto tiempo me responden un siniestro?',
    answer:
      'El tiempo promedio de respuesta es de 5 a 10 días hábiles desde que entregas la documentación completa. ' +
      'Si el caso es urgente, comunícalo al asesor.',
    keywords: ['siniestro', 'tiempo', 'respuesta', 'demora'],
    synonyms: {
      tiempo: ['cuanto', 'duracion'],
      respuesta: ['contestan', 'avisan', 'resolucion', 'resolución'],
    },
  },
  {
    category: 'claims',
    question: '¿Qué documentos necesito para un siniestro?',
    answer:
      'Necesitas: 1) Identificación oficial vigente, 2) Receta o diagnóstico médico, ' +
      '3) Facturas con desglose, 4) Estudios o expedientes médicos relacionados.',
    keywords: ['documentos', 'requisitos', 'siniestro', 'necesito'],
    synonyms: {
      documentos: ['papeles', 'archivos'],
      requisitos: ['necesito', 'piden'],
    },
  },
  {
    category: 'claims',
    question: '¿Cómo verifico el estatus de mi siniestro?',
    answer:
      'En "Mis siniestros" del portal puedes ver el estatus en tiempo real: reportado, en revisión, ' +
      'aprobado, rechazado o pagado. Tu ID de asegurado es {{insuredId}}.',
    keywords: ['estatus', 'estado', 'siniestro', 'verificar'],
    synonyms: {
      estatus: ['estado', 'situacion', 'status'],
      verificar: ['consultar', 'revisar', 'checar'],
    },
  },

  // -------------------------------------------------------------------------
  // CERTIFICATES
  // -------------------------------------------------------------------------
  {
    category: 'certificates',
    question: '¿Dónde descargo mi certificado?',
    answer:
      'En la sección "Certificados" del portal puedes descargar tu certificado vigente. ' +
      'El documento incluye un código QR de verificación.',
    keywords: ['certificado', 'descargar', 'descarga'],
    synonyms: {
      certificado: ['constancia', 'documento', 'comprobante'],
      descargar: ['bajar', 'obtener', 'sacar'],
    },
    priority: 10,
  },
  {
    category: 'certificates',
    question: '¿Cuándo se vence mi certificado?',
    answer:
      'Tu certificado tiene la misma vigencia que tu póliza: hasta el {{validTo}}. ' +
      'Después de esa fecha se emitirá uno nuevo si renuevas.',
    keywords: ['certificado', 'vence', 'vigencia', 'caducidad'],
    synonyms: {
      vence: ['vencimiento', 'caduca', 'expira'],
      vigencia: ['validez', 'duracion'],
    },
  },
  {
    category: 'certificates',
    question: '¿Cómo verifico mi certificado?',
    answer:
      'Cada certificado tiene un código QR que apunta a una página pública con su hash criptográfico. ' +
      'Escanéalo con cualquier lector y verás la validez en tiempo real.',
    keywords: ['verificar', 'certificado', 'validez', 'autentico'],
    synonyms: {
      verificar: ['validar', 'comprobar', 'autenticar'],
      autentico: ['autentico', 'auténtico', 'real'],
    },
  },
  {
    category: 'certificates',
    question: '¿Mi certificado tiene validez legal?',
    answer:
      'Sí. El certificado lleva folio único, fecha de emisión, hash SHA-256 del PDF y QR de verificación. ' +
      'Cualquier hospital de la red lo acepta como comprobante de afiliación.',
    keywords: ['certificado', 'legal', 'valido', 'oficial'],
    synonyms: {
      legal: ['oficial', 'valido', 'válido', 'aceptado'],
    },
  },
  {
    category: 'certificates',
    question: '¿Puedo descargar certificados anteriores?',
    answer:
      'Sí. En "Certificados → Histórico" puedes descargar versiones anteriores de tu certificado. ' +
      'Cada reemisión queda registrada con fecha y razón.',
    keywords: ['certificados', 'historico', 'anteriores', 'previos'],
    synonyms: {
      historico: ['historial', 'pasados', 'anteriores'],
    },
  },

  // -------------------------------------------------------------------------
  // BILLING
  // -------------------------------------------------------------------------
  {
    category: 'billing',
    question: '¿Cómo pago mi póliza?',
    answer:
      'Tu póliza puede pagarse vía transferencia bancaria, tarjeta de crédito o domiciliación. ' +
      'En "Pagos" del portal verás el método actual y la siguiente fecha de cobro.',
    keywords: ['pago', 'pagar', 'metodo', 'cobro'],
    synonyms: {
      pago: ['pagos', 'cuota', 'mensualidad'],
      pagar: ['liquidar', 'abonar'],
      metodo: ['forma', 'medio'],
    },
    priority: 10,
  },
  {
    category: 'billing',
    question: '¿Cuándo es mi próximo cobro?',
    answer:
      'La fecha del próximo cobro depende del periodo contratado. Revisa "Pagos → Próximo cobro" ' +
      'en tu portal o pídele al asesor el calendario de pagos.',
    keywords: ['cobro', 'siguiente', 'proximo', 'fecha'],
    synonyms: {
      proximo: ['proximo', 'próximo', 'siguiente'],
      cobro: ['cargo', 'cobranza'],
    },
  },
  {
    category: 'billing',
    question: '¿Puedo solicitar factura?',
    answer:
      'Sí. En "Pagos → Facturas" puedes generar tu CFDI con tus datos fiscales. ' +
      'Si necesitas modificar tu RFC o razón social, contacta al asesor.',
    keywords: ['factura', 'cfdi', 'fiscal'],
    synonyms: {
      factura: ['comprobante', 'recibo'],
      fiscal: ['rfc', 'razon', 'razón'],
    },
  },
  {
    category: 'billing',
    question: '¿Qué pasa si no pago a tiempo?',
    answer:
      'Si no recibimos tu pago en la fecha límite, tu cobertura se suspende temporalmente hasta regularizar. ' +
      'Tienes 30 días de gracia antes de la cancelación definitiva.',
    keywords: ['pago', 'atraso', 'suspension', 'no pago'],
    synonyms: {
      atraso: ['retraso', 'mora', 'tarde'],
      suspension: ['suspension', 'suspensión', 'cancelacion'],
    },
  },
  {
    category: 'billing',
    question: '¿Puedo cambiar mi método de pago?',
    answer:
      'Sí. En "Pagos → Método de pago" puedes actualizar la cuenta o tarjeta. ' +
      'El cambio aplica al siguiente ciclo de cobro.',
    keywords: ['cambiar', 'metodo', 'pago', 'tarjeta'],
    synonyms: {
      cambiar: ['actualizar', 'modificar', 'reemplazar'],
      tarjeta: ['credito', 'débito', 'debito'],
    },
  },
];

async function main(): Promise<void> {
  // Tenant demo `mac` (mismo que el seed principal). Si no existe, fail loud
  // — el seed principal debe correr primero.
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'mac' } });
  if (!tenant) {
    throw new Error('Tenant `mac` no encontrado. Ejecuta `pnpm prisma:seed` primero.');
  }

  let created = 0;
  let skipped = 0;
  for (const e of ENTRIES) {
    const existing = await prisma.chatKb.findFirst({
      where: { tenantId: tenant.id, category: e.category, question: e.question, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.chatKb.create({
      data: {
        tenantId: tenant.id,
        category: e.category,
        question: e.question,
        answer: e.answer,
        keywords: e.keywords,
        synonyms: e.synonyms ?? {},
        priority: e.priority ?? 0,
        enabled: true,
        status: 'published',
      },
    });
    created++;
  }
  // eslint-disable-next-line no-console
  console.log(
    `[chatbot-kb-seed] tenant=${tenant.slug} entries created=${created} skipped=${skipped} (total expected=${ENTRIES.length})`,
  );
}

main()
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
