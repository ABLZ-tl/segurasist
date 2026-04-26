import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

// Stub: throttling efectivo se implementa con Redis bucket por tenant en Sprint posterior.
// El gateway WAF cubre el rate-limit perimetral.
@Injectable()
export class ThrottleGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
