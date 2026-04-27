-- S3-A1 — agregar columna `cognito_sub` a `insureds` para mapping insured pool ↔ insured row.
--
-- Nullable hasta que el flow OTP del Sprint 3 popule el campo en el primer
-- login verify (CognitoService.verifyInsuredOtp). UNIQUE para evitar que dos
-- insureds compartan identidad federada (defense in depth contra fixación
-- de session a otro insured).

ALTER TABLE "insureds" ADD COLUMN "cognito_sub" VARCHAR(64);

CREATE UNIQUE INDEX "insureds_cognito_sub_key" ON "insureds" ("cognito_sub")
  WHERE "cognito_sub" IS NOT NULL;
