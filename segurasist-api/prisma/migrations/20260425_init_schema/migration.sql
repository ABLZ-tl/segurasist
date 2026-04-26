-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'invited', 'disabled');

-- CreateEnum
CREATE TYPE "package_status" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "coverage_type" AS ENUM ('consultation', 'emergency', 'hospitalization', 'laboratory', 'imaging', 'pharmacy', 'other');

-- CreateEnum
CREATE TYPE "insured_status" AS ENUM ('active', 'suspended', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "beneficiary_relationship" AS ENUM ('spouse', 'child', 'parent', 'sibling', 'other');

-- CreateEnum
CREATE TYPE "certificate_status" AS ENUM ('issued', 'reissued', 'revoked');

-- CreateEnum
CREATE TYPE "claim_status" AS ENUM ('reported', 'in_review', 'approved', 'rejected', 'paid');

-- CreateEnum
CREATE TYPE "claim_type" AS ENUM ('consultation', 'emergency', 'hospitalization', 'laboratory', 'imaging', 'pharmacy', 'other');

-- CreateEnum
CREATE TYPE "batch_status" AS ENUM ('validating', 'preview_ready', 'processing', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "email_event_type" AS ENUM ('queued', 'sent', 'delivered', 'bounced', 'complained', 'opened', 'clicked', 'rejected');

-- CreateEnum
CREATE TYPE "chat_direction" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "chat_kb_status" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('create', 'update', 'delete', 'read', 'login', 'logout', 'export', 'reissue');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'active',
    "brand_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cognito_sub" VARCHAR(64) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "role" "user_role" NOT NULL,
    "mfa_enrolled" BOOLEAN NOT NULL DEFAULT false,
    "status" "user_status" NOT NULL DEFAULT 'invited',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "status" "package_status" NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coverages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "coverage_type" NOT NULL,
    "limit_count" INTEGER,
    "limit_amount" DECIMAL(12,2),
    "copayment" DECIMAL(12,2),
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "coverages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insureds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "curp" VARCHAR(18) NOT NULL,
    "rfc" VARCHAR(13),
    "full_name" VARCHAR(160) NOT NULL,
    "dob" DATE NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "package_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE NOT NULL,
    "status" "insured_status" NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "insureds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "insured_id" UUID NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "relationship" "beneficiary_relationship" NOT NULL,
    "dob" DATE NOT NULL,
    "curp" VARCHAR(18),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "insured_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "s3_key" VARCHAR(512) NOT NULL,
    "hash" VARCHAR(128) NOT NULL,
    "qr_payload" VARCHAR(512) NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" DATE NOT NULL,
    "status" "certificate_status" NOT NULL DEFAULT 'issued',
    "reissue_of" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "insured_id" UUID NOT NULL,
    "type" "claim_type" NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "status" "claim_status" NOT NULL DEFAULT 'reported',
    "amount_estimated" DECIMAL(12,2),
    "amount_approved" DECIMAL(12,2),
    "resolved_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coverage_usage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "insured_id" UUID NOT NULL,
    "coverage_id" UUID NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(12,2),
    "source" VARCHAR(40) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coverage_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "file_s3_key" VARCHAR(512) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "status" "batch_status" NOT NULL DEFAULT 'validating',
    "rows_total" INTEGER NOT NULL DEFAULT 0,
    "rows_ok" INTEGER NOT NULL DEFAULT 0,
    "rows_error" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_errors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "column" VARCHAR(80),
    "error_code" VARCHAR(64) NOT NULL,
    "error_message" TEXT NOT NULL,
    "raw_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "certificate_id" UUID,
    "event_type" "email_event_type" NOT NULL,
    "recipient" VARCHAR(254) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" JSONB,
    "message_id" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "insured_id" UUID,
    "direction" "chat_direction" NOT NULL,
    "content" TEXT NOT NULL,
    "intent" VARCHAR(80),
    "confidence" DOUBLE PRECISION,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_kb" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "chat_kb_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chat_kb_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" "audit_action" NOT NULL,
    "resource_type" VARCHAR(80) NOT NULL,
    "resource_id" VARCHAR(80),
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "payload_diff" JSONB,
    "trace_id" VARCHAR(64),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "users_tenant_id_role_idx" ON "users"("tenant_id", "role");

-- CreateIndex
CREATE INDEX "users_tenant_id_status_idx" ON "users"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_cognito_sub_key" ON "users"("cognito_sub");

-- CreateIndex
CREATE INDEX "packages_tenant_id_status_idx" ON "packages"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "packages_tenant_id_name_key" ON "packages"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "coverages_tenant_id_package_id_idx" ON "coverages"("tenant_id", "package_id");

-- CreateIndex
CREATE INDEX "coverages_tenant_id_type_idx" ON "coverages"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "insureds_tenant_id_status_idx" ON "insureds"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "insureds_tenant_id_package_id_idx" ON "insureds"("tenant_id", "package_id");

-- CreateIndex
CREATE INDEX "insureds_tenant_id_valid_to_idx" ON "insureds"("tenant_id", "valid_to");

-- CreateIndex
CREATE UNIQUE INDEX "insureds_tenant_id_curp_key" ON "insureds"("tenant_id", "curp");

-- CreateIndex
CREATE INDEX "beneficiaries_tenant_id_insured_id_idx" ON "beneficiaries"("tenant_id", "insured_id");

-- CreateIndex
CREATE INDEX "certificates_tenant_id_insured_id_idx" ON "certificates"("tenant_id", "insured_id");

-- CreateIndex
CREATE INDEX "certificates_tenant_id_status_idx" ON "certificates"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_tenant_id_insured_id_version_key" ON "certificates"("tenant_id", "insured_id", "version");

-- CreateIndex
CREATE INDEX "claims_tenant_id_insured_id_idx" ON "claims"("tenant_id", "insured_id");

-- CreateIndex
CREATE INDEX "claims_tenant_id_status_idx" ON "claims"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "claims_tenant_id_reported_at_idx" ON "claims"("tenant_id", "reported_at" DESC);

-- CreateIndex
CREATE INDEX "coverage_usage_tenant_id_insured_id_idx" ON "coverage_usage"("tenant_id", "insured_id");

-- CreateIndex
CREATE INDEX "coverage_usage_tenant_id_coverage_id_idx" ON "coverage_usage"("tenant_id", "coverage_id");

-- CreateIndex
CREATE INDEX "coverage_usage_tenant_id_used_at_idx" ON "coverage_usage"("tenant_id", "used_at" DESC);

-- CreateIndex
CREATE INDEX "batches_tenant_id_status_idx" ON "batches"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "batches_tenant_id_created_at_idx" ON "batches"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "batch_errors_tenant_id_batch_id_idx" ON "batch_errors"("tenant_id", "batch_id");

-- CreateIndex
CREATE INDEX "email_events_tenant_id_certificate_id_idx" ON "email_events"("tenant_id", "certificate_id");

-- CreateIndex
CREATE INDEX "email_events_tenant_id_event_type_idx" ON "email_events"("tenant_id", "event_type");

-- CreateIndex
CREATE INDEX "email_events_tenant_id_occurred_at_idx" ON "email_events"("tenant_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "chat_messages_tenant_id_insured_id_idx" ON "chat_messages"("tenant_id", "insured_id");

-- CreateIndex
CREATE INDEX "chat_messages_tenant_id_created_at_idx" ON "chat_messages"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "chat_kb_tenant_id_category_idx" ON "chat_kb"("tenant_id", "category");

-- CreateIndex
CREATE INDEX "chat_kb_tenant_id_status_idx" ON "chat_kb"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_occurred_at_idx" ON "audit_log"("tenant_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_resource_type_resource_id_idx" ON "audit_log"("tenant_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_actor_id_idx" ON "audit_log"("tenant_id", "actor_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insureds" ADD CONSTRAINT "insureds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insureds" ADD CONSTRAINT "insureds_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_insured_id_fkey" FOREIGN KEY ("insured_id") REFERENCES "insureds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_insured_id_fkey" FOREIGN KEY ("insured_id") REFERENCES "insureds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_insured_id_fkey" FOREIGN KEY ("insured_id") REFERENCES "insureds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage_usage" ADD CONSTRAINT "coverage_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage_usage" ADD CONSTRAINT "coverage_usage_insured_id_fkey" FOREIGN KEY ("insured_id") REFERENCES "insureds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coverage_usage" ADD CONSTRAINT "coverage_usage_coverage_id_fkey" FOREIGN KEY ("coverage_id") REFERENCES "coverages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_errors" ADD CONSTRAINT "batch_errors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_errors" ADD CONSTRAINT "batch_errors_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_kb" ADD CONSTRAINT "chat_kb_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

