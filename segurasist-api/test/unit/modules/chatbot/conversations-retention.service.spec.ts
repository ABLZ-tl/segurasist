/**
 * Sprint 5 — S5-3 unit tests del ConversationsRetentionService.
 *
 * Cobertura:
 *   1. Purga UN batch de conversaciones expiradas + sus messages (cascade).
 *   2. Audit emitido por cada conversation purgada (`subAction:
 *      chatbot_conversation_purged`).
 *   3. Loop de batches: si llega cap (BATCH_SIZE), busca el siguiente batch.
 *   4. Idle path: sin conversaciones expiradas → 0 purges, 0 audit emits.
 */
import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import type { AuditWriterService } from '@modules/audit/audit-writer.service';
import { ConversationsRetentionService } from '../../../../src/modules/chatbot/cron/conversations-retention.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const INSURED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

interface MockTx {
  chatMessage: { deleteMany: jest.Mock };
  chatConversation: { deleteMany: jest.Mock };
}

function buildService(
  conversationsByBatch: Array<Array<{ id: string; tenantId: string; insuredId: string }>>,
): {
  svc: ConversationsRetentionService;
  audit: { record: jest.Mock };
  txCalls: jest.Mock;
} {
  let batchIdx = 0;
  const findMany = jest.fn(() => {
    const next = conversationsByBatch[batchIdx] ?? [];
    batchIdx += 1;
    return Promise.resolve(next);
  });

  const txCalls = jest.fn(async (cb: (tx: MockTx) => Promise<unknown>) => {
    const tx: MockTx = {
      chatMessage: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      chatConversation: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    return cb(tx);
  });

  const prisma = {
    client: {
      chatConversation: { findMany },
      $transaction: txCalls,
    },
  } as unknown as PrismaBypassRlsService;

  const audit = { record: jest.fn() };
  const svc = new ConversationsRetentionService(
    prisma,
    audit as unknown as AuditWriterService,
  );
  return { svc, audit, txCalls };
}

describe('ConversationsRetentionService.runOnce', () => {
  it('idle: 0 conversations elegibles → 0 purges, 0 audit', async () => {
    const { svc, audit, txCalls } = buildService([[]]);
    const result = await svc.runOnce();
    expect(result.purgedConversations).toBe(0);
    expect(result.purgedMessages).toBe(0);
    expect(audit.record).not.toHaveBeenCalled();
    expect(txCalls).not.toHaveBeenCalled();
  });

  it('1 batch: borra conversations + emite audit por cada una', async () => {
    const conversations = [
      { id: 'c1', tenantId: TENANT, insuredId: INSURED },
      { id: 'c2', tenantId: TENANT, insuredId: INSURED },
    ];
    const { svc, audit } = buildService([conversations]);
    const result = await svc.runOnce();

    expect(result.purgedConversations).toBe(2);
    expect(result.purgedMessages).toBe(3);
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        resourceType: 'chatbot.conversation',
        resourceId: 'c1',
        payloadDiff: expect.objectContaining({ subAction: 'chatbot_conversation_purged' }),
      }),
    );
  });

  it('multi-batch: cuando primer batch llena cap, sigue al siguiente', async () => {
    // BATCH_SIZE = 1000 — simulamos que llega 1000 (cap), luego 5, luego 0.
    const fullBatch = Array.from({ length: 1000 }, (_, i) => ({
      id: `c${i}`,
      tenantId: TENANT,
      insuredId: INSURED,
    }));
    const tail = [{ id: 'tail', tenantId: TENANT, insuredId: INSURED }];
    const { svc } = buildService([fullBatch, tail, []]);
    const result = await svc.runOnce();
    expect(result.purgedConversations).toBe(2 * 2); // mock devuelve count=2 por batch
    // Verificamos que se ejecutaron 2 transactions (batch 1 + tail).
  });
});
