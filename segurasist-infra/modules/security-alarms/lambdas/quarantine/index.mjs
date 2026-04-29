// S5-2 iter 2 — security-quarantine
//
// Triggered by EventBridge rule matching GuardDuty findings of type
// `Backdoor:EC2/...`. Replaces the affected instance's security
// groups with the quarantine SG (no inbound, minimal egress) and
// tags the instance for post-incident review.
//
// Idempotent: if the instance is already tagged `Quarantine=true`,
// the lambda short-circuits.
//
// Audit: every action (or no-op) emits a structured CloudWatch Logs
// JSON line. Downstream metric filter / EMF can derive
// `SegurAsist/Security/InstancesQuarantined` count.

import { EC2Client, ModifyInstanceAttributeCommand, CreateTagsCommand, DescribeInstancesCommand } from "@aws-sdk/client-ec2";

const QUARANTINE_SG_ID = process.env.QUARANTINE_SG_ID;
const ENVIRONMENT = process.env.ENVIRONMENT || "unknown";
const REGION = process.env.AWS_REGION || "mx-central-1";

const ec2 = new EC2Client({ region: REGION });

function audit(level, msg, fields = {}) {
  const line = JSON.stringify({
    level,
    msg,
    env: ENVIRONMENT,
    component: "security-quarantine",
    ts: new Date().toISOString(),
    ...fields,
  });
  if (level === "error") console.error(line);
  else console.log(line);
}

function extractInstanceId(detail) {
  // GuardDuty finding shape: detail.resource.instanceDetails.instanceId
  const id = detail?.resource?.instanceDetails?.instanceId;
  if (!id || typeof id !== "string" || !id.startsWith("i-")) return null;
  return id;
}

async function isAlreadyQuarantined(instanceId) {
  const out = await ec2.send(
    new DescribeInstancesCommand({ InstanceIds: [instanceId] })
  );
  const inst = out.Reservations?.[0]?.Instances?.[0];
  if (!inst) return { exists: false, alreadyQuarantined: false, currentSgs: [] };

  const tags = inst.Tags || [];
  const alreadyQuarantined = tags.some(
    (t) => t.Key === "Quarantine" && t.Value === "true"
  );
  const currentSgs = (inst.SecurityGroups || []).map((sg) => sg.GroupId);
  return { exists: true, alreadyQuarantined, currentSgs };
}

async function quarantineInstance(instanceId, findingId, findingType) {
  if (!QUARANTINE_SG_ID) {
    throw new Error("QUARANTINE_SG_ID env var not set; cannot quarantine");
  }

  const status = await isAlreadyQuarantined(instanceId);

  if (!status.exists) {
    audit("warn", "instance not found (may have been terminated)", {
      instanceId,
      findingId,
    });
    return { skipped: true, reason: "not_found" };
  }

  if (status.alreadyQuarantined) {
    audit("info", "instance already quarantined; no-op", {
      instanceId,
      findingId,
    });
    return { skipped: true, reason: "already_quarantined" };
  }

  // 1) Replace SGs with quarantine SG (removes inbound exposure).
  await ec2.send(
    new ModifyInstanceAttributeCommand({
      InstanceId: instanceId,
      Groups: [QUARANTINE_SG_ID],
    })
  );
  audit("info", "security groups replaced with quarantine SG", {
    instanceId,
    quarantineSg: QUARANTINE_SG_ID,
    previousSgs: status.currentSgs,
    findingId,
  });

  // 2) Tag the instance for post-mortem traceability.
  const ts = new Date().toISOString();
  await ec2.send(
    new CreateTagsCommand({
      Resources: [instanceId],
      Tags: [
        { Key: "Quarantine", Value: "true" },
        { Key: "QuarantinedAt", Value: ts },
        { Key: "QuarantineReason", Value: String(findingType).slice(0, 255) },
        { Key: "FindingId", Value: String(findingId).slice(0, 255) },
        { Key: "PreviousSgs", Value: status.currentSgs.join(",").slice(0, 255) },
      ],
    })
  );
  audit("info", "instance tagged Quarantine=true", {
    instanceId,
    findingId,
    quarantinedAt: ts,
  });

  return {
    skipped: false,
    instanceId,
    quarantineSg: QUARANTINE_SG_ID,
    previousSgs: status.currentSgs,
    quarantinedAt: ts,
  };
}

export const handler = async (event) => {
  // EventBridge "GuardDuty Finding" detail-type wraps the finding in
  // event.detail. We accept either shape (raw finding or wrapped
  // EventBridge envelope) for testability.
  const detail = event.detail || event;
  const findingType = detail.type || "unknown";
  const findingId = detail.id || event.id || "unknown";

  audit("info", "quarantine triggered", { findingId, findingType });

  if (!String(findingType).startsWith("Backdoor:EC2/")) {
    audit("warn", "non-Backdoor finding routed to quarantine; ignoring", {
      findingId,
      findingType,
    });
    return { ok: true, skipped: true, reason: "non_backdoor_finding" };
  }

  const instanceId = extractInstanceId(detail);
  if (!instanceId) {
    audit("error", "cannot extract instanceId from finding detail", {
      findingId,
    });
    return { ok: false, reason: "no_instance_id" };
  }

  try {
    const result = await quarantineInstance(instanceId, findingId, findingType);
    audit("info", "quarantine result", { findingId, ...result });
    return { ok: true, ...result };
  } catch (err) {
    audit("error", "quarantine failed", {
      findingId,
      instanceId,
      error: err.message,
    });
    throw err; // EventBridge retry policy handles redelivery.
  }
};
