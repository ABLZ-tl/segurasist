// S5-2 iter 2 — security-slack-forwarder
//
// Receives SNS events fan-in from `${env}-security-alerts` (GuardDuty
// findings >= severity threshold + SecurityHub failed-compliance
// alarm). Posts a formatted message to a Slack incoming webhook.
//
// Webhook URL is stored in SecretsManager (ARN provided via env
// `SECRET_ARN`). The lambda fetches it once per cold-start and caches
// in module scope (Lambda freezes globals between invocations on the
// same container).
//
// Idempotency: dedupe by SNS MessageId via in-memory TTL cache. NOT
// perfect across multi-instance Lambda concurrency, but covers retry
// storms within a single warm container. Stronger guarantees would
// require DynamoDB; deferred to S6 if dupes become observable.
//
// Retry: 3x exponential backoff (1s, 2s, 4s) on transient HTTP errors.
// Slack 429s honour `Retry-After` header.

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { CloudWatchLogsClient, PutLogEventsCommand, CreateLogStreamCommand } from "@aws-sdk/client-cloudwatch-logs";

const SECRET_ARN = process.env.SECRET_ARN;
const ENVIRONMENT = process.env.ENVIRONMENT || "unknown";
const REGION = process.env.AWS_REGION || "mx-central-1";

const DEDUPE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;

const secretsClient = new SecretsManagerClient({ region: REGION });

// Module-scope cache (survives across warm invocations in the same
// container). Maps SNS MessageId -> expiry timestamp (ms).
const dedupeCache = new Map();
let cachedWebhookUrl = null;

function nowMs() {
  return Date.now();
}

function pruneDedupeCache() {
  const t = nowMs();
  for (const [id, expiry] of dedupeCache.entries()) {
    if (expiry < t) dedupeCache.delete(id);
  }
}

function isDuplicate(messageId) {
  pruneDedupeCache();
  if (dedupeCache.has(messageId)) return true;
  dedupeCache.set(messageId, nowMs() + DEDUPE_TTL_MS);
  return false;
}

async function getWebhookUrl() {
  if (cachedWebhookUrl) return cachedWebhookUrl;
  if (!SECRET_ARN) throw new Error("SECRET_ARN env var not set");

  const out = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: SECRET_ARN })
  );
  const raw = out.SecretString;
  if (!raw) throw new Error("Secret has no SecretString payload");

  // Accept either a bare URL or a JSON `{"url":"..."}` payload.
  let url = raw.trim();
  if (url.startsWith("{")) {
    try {
      const parsed = JSON.parse(url);
      url = parsed.url || parsed.webhook || parsed.webhookUrl;
    } catch {
      // fall through with raw
    }
  }
  if (!url || !url.startsWith("https://hooks.slack.com/")) {
    throw new Error("Webhook URL invalid (must be https://hooks.slack.com/...)");
  }
  cachedWebhookUrl = url;
  return url;
}

function severityEmoji(sev) {
  if (sev === undefined || sev === null) return ":grey_question:";
  if (sev >= 9.0) return ":rotating_light:"; // CRITICAL
  if (sev >= 7.0) return ":warning:";        // HIGH
  if (sev >= 4.0) return ":large_yellow_circle:"; // MEDIUM
  return ":information_source:";
}

function buildSlackMessage(snsRecord) {
  const subject = snsRecord.Sns.Subject || "Security alert";
  let payload;
  try {
    payload = JSON.parse(snsRecord.Sns.Message);
  } catch {
    payload = { raw: snsRecord.Sns.Message };
  }

  const detail = payload.detail || {};
  const sev = detail.severity ?? payload.severity;
  const findingType = detail.type || payload.type || "unknown";
  const findingId = detail.id || payload.id || snsRecord.Sns.MessageId;
  const region = detail.region || payload.region || REGION;
  const accountId = detail.accountId || payload.accountId || "n/a";
  const resource = detail.resource?.resourceType || "n/a";

  const emoji = severityEmoji(sev);

  return {
    text: `${emoji} [${ENVIRONMENT.toUpperCase()}] ${subject}`,
    attachments: [
      {
        color: sev >= 7.0 ? "#d00000" : sev >= 4.0 ? "#f0a000" : "#777777",
        fields: [
          { title: "Type", value: String(findingType), short: false },
          { title: "Severity", value: String(sev ?? "n/a"), short: true },
          { title: "Region", value: region, short: true },
          { title: "Account", value: accountId, short: true },
          { title: "Resource", value: resource, short: true },
          { title: "FindingId", value: String(findingId), short: false },
        ],
        footer: `SegurAsist security-slack-forwarder | env=${ENVIRONMENT}`,
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };
}

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function postToSlack(url, body) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (resp.ok) return;
      // 429 / 5xx → retry; 4xx other → fail fast.
      if (resp.status === 429 || resp.status >= 500) {
        const retryAfter = parseInt(resp.headers.get("retry-after") || "0", 10);
        const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 1000;
        lastErr = new Error(`Slack HTTP ${resp.status}`);
        await sleep(backoff);
        continue;
      }
      const text = await resp.text();
      throw new Error(`Slack rejected: ${resp.status} ${text}`);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }
  throw lastErr || new Error("Slack post failed after retries");
}

export const handler = async (event) => {
  if (!event.Records || event.Records.length === 0) {
    console.log(JSON.stringify({ level: "warn", msg: "no SNS records in event" }));
    return { ok: true, skipped: 0, processed: 0 };
  }

  const url = await getWebhookUrl();
  let processed = 0;
  let skipped = 0;
  const errors = [];

  for (const record of event.Records) {
    const messageId = record.Sns?.MessageId;
    if (!messageId) {
      skipped++;
      continue;
    }
    if (isDuplicate(messageId)) {
      console.log(JSON.stringify({ level: "info", msg: "dedupe skip", messageId }));
      skipped++;
      continue;
    }
    try {
      const body = buildSlackMessage(record);
      await postToSlack(url, body);
      processed++;
      console.log(
        JSON.stringify({ level: "info", msg: "forwarded", messageId, env: ENVIRONMENT })
      );
    } catch (err) {
      errors.push({ messageId, error: err.message });
      console.error(
        JSON.stringify({ level: "error", msg: "forward failed", messageId, error: err.message })
      );
    }
  }

  if (errors.length > 0) {
    // Fail invocation so SNS retries (within the topic's retry policy).
    throw new Error(`slack forward errors: ${JSON.stringify(errors)}`);
  }

  return { ok: true, processed, skipped };
};
