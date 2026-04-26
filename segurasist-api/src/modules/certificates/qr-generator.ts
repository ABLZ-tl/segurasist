/**
 * Genera el QR code que se incrusta en el certificado PDF.
 *
 * Contenido: URL de verificación pública
 * `https://{baseUrl}/v1/certificates/verify/{hash}`. Sin auth, devuelve datos
 * no-PII (ver `verify` endpoint en CertificatesController).
 *
 * Salida: data URL `data:image/png;base64,...` listo para usar como `<img src>`.
 *
 * Decisiones:
 *  - errorCorrectionLevel `M` (15% redundancy) → balance entre tamaño y
 *    tolerancia a daño físico (cert impreso doblado en cartera).
 *  - margin `2` (default es 4) → ahorra ~10mm en PDF sin perjudicar la
 *    detección por cámaras móviles modernas.
 *  - scale `4` → ~125px output (suficiente nitidez en print 300dpi).
 */
import { toDataURL, type QRCodeToDataURLOptions } from 'qrcode';

export interface BuildQrInput {
  baseUrl: string;
  hash: string;
}

export interface BuildQrResult {
  /** data:image/png;base64,... */
  dataUrl: string;
  /** URL plana embebida en el QR. Persistida en `certificates.qr_payload`. */
  payload: string;
}

const DEFAULT_OPTS: QRCodeToDataURLOptions = {
  errorCorrectionLevel: 'M',
  type: 'image/png',
  margin: 2,
  scale: 4,
};

export async function buildVerificationQr(input: BuildQrInput): Promise<BuildQrResult> {
  if (!input.hash || input.hash.length === 0) {
    throw new Error('buildVerificationQr: hash vacío');
  }
  const trimmedBase = input.baseUrl.replace(/\/+$/, '');
  const payload = `${trimmedBase}/v1/certificates/verify/${input.hash}`;
  const dataUrl = await toDataURL(payload, DEFAULT_OPTS);
  return { dataUrl, payload };
}
