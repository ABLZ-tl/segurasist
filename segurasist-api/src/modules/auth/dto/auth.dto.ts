import { z } from 'zod';

export const LoginSchema = z.union([
  z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
  }),
  z.object({
    curp: z.string().regex(/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/),
  }),
]);
export type LoginDto = z.infer<typeof LoginSchema>;

export const OtpRequestSchema = z.object({
  curp: z.string().regex(/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/),
  channel: z.enum(['email', 'sms']),
});
export type OtpRequestDto = z.infer<typeof OtpRequestSchema>;

export const OtpVerifySchema = z.object({
  session: z.string().min(8),
  code: z.string().regex(/^\d{6}$/),
});
export type OtpVerifyDto = z.infer<typeof OtpVerifySchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(20),
});
export type RefreshDto = z.infer<typeof RefreshSchema>;
