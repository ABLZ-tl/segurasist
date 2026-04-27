/* eslint-disable @typescript-eslint/require-await -- los stubs Sprint 0 (otpRequest/Verify) se mantienen async hasta su implementación. */
import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InvalidPasswordException,
  NotAuthorizedException as CognitoNotAuthorizedException,
  RevokeTokenCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { Inject, Injectable, Logger, NotImplementedException, UnauthorizedException } from '@nestjs/common';

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn: number;
}

@Injectable()
export class CognitoService {
  private readonly log = new Logger(CognitoService.name);
  private readonly client: CognitoIdentityProviderClient;

  constructor(@Inject(ENV_TOKEN) private readonly env: Env) {
    // En dev local: COGNITO_ENDPOINT=http://localhost:9229 apunta a cognito-local.
    // Tomamos COGNITO_ENDPOINT con prioridad sobre AWS_ENDPOINT_URL (LocalStack)
    // porque cognito-local corre en su propio puerto.
    const endpoint = env.COGNITO_ENDPOINT ?? env.AWS_ENDPOINT_URL;
    this.client = new CognitoIdentityProviderClient({
      region: env.COGNITO_REGION,
      ...(endpoint ? { endpoint } : {}),
    });
  }

  /**
   * Login admin (USER_PASSWORD flow contra el pool admin). En cognito-local
   * `admin-initiate-auth` con ADMIN_USER_PASSWORD_AUTH es lo más estable;
   * en producción funciona igual con un client app que tenga ese flow habilitado.
   */
  async loginAdmin(email: string, password: string): Promise<AuthTokens> {
    try {
      const out = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.env.COGNITO_USER_POOL_ID_ADMIN,
          ClientId: this.env.COGNITO_CLIENT_ID_ADMIN,
          AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
          AuthParameters: { USERNAME: email, PASSWORD: password },
        }),
      );
      const r = out.AuthenticationResult;
      if (!r?.AccessToken) {
        throw new UnauthorizedException('Cognito: no AuthenticationResult');
      }
      return {
        accessToken: r.AccessToken,
        refreshToken: r.RefreshToken,
        idToken: r.IdToken,
        expiresIn: r.ExpiresIn ?? 3600,
      };
    } catch (err) {
      if (
        err instanceof CognitoNotAuthorizedException ||
        err instanceof UserNotFoundException ||
        err instanceof InvalidPasswordException
      ) {
        // Mismo mensaje para email inválido y password incorrecto: no filtra info.
        throw new UnauthorizedException('Credenciales inválidas');
      }
      this.log.error({ err }, 'loginAdmin upstream error');
      throw err;
    }
  }

  /**
   * S3-01 — los stubs originales de Sprint 0 quedan delegando al `AuthService`
   * que orquesta la persistencia del OTP en Redis + envío del email + lockout.
   * El intento de invocarlos desde otra capa lanza para evitar fugas de
   * responsabilidad: el flujo OTP NO debe bypassear las protecciones del
   * AuthService (rate-limit por CURP, audit log, anti-enumeration).
   */
  async startInsuredOtp(_curp: string, _channel: 'email' | 'sms'): Promise<{ session: string }> {
    throw new NotImplementedException(
      'CognitoService.startInsuredOtp — usar AuthService.otpRequest (orquesta Redis + SES)',
    );
  }

  async verifyInsuredOtp(_session: string, _code: string): Promise<AuthTokens> {
    throw new NotImplementedException(
      'CognitoService.verifyInsuredOtp — usar AuthService.otpVerify (orquesta Redis + Cognito)',
    );
  }

  /**
   * S3-01 — Tras verificar el OTP en Redis, el `AuthService` necesita un id
   * token Cognito para que `JwtAuthGuard` lo acepte como `pool=insured`. En
   * cognito-local (dev/test) y en el MVP la cuenta del insured tiene una
   * password de sistema fija (`INSURED_DEFAULT_PASSWORD`); pedimos los tokens
   * con `ADMIN_USER_PASSWORD_AUTH` contra el pool insured.
   *
   * En producción (post-MVP) este método se reemplaza por:
   *   - CUSTOM_AUTH flow con un Cognito Lambda trigger que valida el OTP, o
   *   - AdminInitiateAuth + Lambda pre-token-generation que enriquece custom:*.
   * Mientras tanto, esta solución mantiene la garantía de seguridad porque el
   * OTP es nuestro factor real de autenticación: la password de sistema NUNCA
   * sale del backend.
   */
  async loginInsuredWithSystemPassword(email: string, password: string): Promise<AuthTokens> {
    try {
      const out = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.env.COGNITO_USER_POOL_ID_INSURED,
          ClientId: this.env.COGNITO_CLIENT_ID_INSURED,
          AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
          AuthParameters: { USERNAME: email, PASSWORD: password },
        }),
      );
      const r = out.AuthenticationResult;
      if (!r?.AccessToken) {
        throw new UnauthorizedException('Cognito (insured): no AuthenticationResult');
      }
      return {
        accessToken: r.AccessToken,
        refreshToken: r.RefreshToken,
        idToken: r.IdToken,
        expiresIn: r.ExpiresIn ?? 3600,
      };
    } catch (err) {
      if (
        err instanceof CognitoNotAuthorizedException ||
        err instanceof UserNotFoundException ||
        err instanceof InvalidPasswordException
      ) {
        // No filtramos: el caller (AuthService.otpVerify) ya validó el OTP,
        // un fallo aquí es config drift, NO credencial inválida del usuario.
        this.log.error({ err: err.name }, 'loginInsuredWithSystemPassword falló pese a OTP válido');
        throw new UnauthorizedException('No se pudo emitir el token. Contacta a soporte.');
      }
      this.log.error({ err }, 'loginInsuredWithSystemPassword upstream error');
      throw err;
    }
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    try {
      const out = await this.client.send(
        new InitiateAuthCommand({
          ClientId: this.env.COGNITO_CLIENT_ID_ADMIN,
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          AuthParameters: { REFRESH_TOKEN: refreshToken },
        }),
      );
      const r = out.AuthenticationResult;
      if (!r?.AccessToken) throw new UnauthorizedException('Cognito: refresh falló');
      return {
        accessToken: r.AccessToken,
        refreshToken: r.RefreshToken ?? refreshToken,
        idToken: r.IdToken,
        expiresIn: r.ExpiresIn ?? 3600,
      };
    } catch (err) {
      if (err instanceof CognitoNotAuthorizedException) {
        throw new UnauthorizedException('Refresh token inválido');
      }
      throw err;
    }
  }

  async revoke(refreshToken: string): Promise<void> {
    try {
      await this.client.send(
        new RevokeTokenCommand({
          ClientId: this.env.COGNITO_CLIENT_ID_ADMIN,
          Token: refreshToken,
        }),
      );
    } catch (err) {
      // Cognito-local puede no implementar revoke; lo logueamos y seguimos.
      // En producción Cognito devuelve 200 incluso si el token ya estaba revocado.
      this.log.warn({ err: err instanceof Error ? err.message : err }, 'revoke: upstream warn (continuando)');
    }
  }
}
