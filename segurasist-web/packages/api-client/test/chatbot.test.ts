/**
 * S4-05 / S4-08 — Tests para hooks del chatbot del portal asegurado.
 *
 * Mocks `fetch` y verifica:
 *  - `useSendChatMessage()` → POST `/v1/chatbot/message` con body JSON.
 *  - `useEscalateConversation()` → POST `/v1/chatbot/escalate` con
 *    `{ conversationId, reason }` y propaga `traceId` (vía wrapper api()).
 *  - error handling: backend 500 → mutation rechaza con ProblemDetailsError.
 *
 * Por qué TDD aquí: el shape exacto del backend (S5/S6) puede evolucionar,
 * pero el contrato del cliente —path/verbo/body envelope— queda fijo a
 * partir de Sprint 4 iter 1. Cualquier cambio a estos paths romperá los
 * tests y forzará coordinación con S5+S6 antes de entrar a producción.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useSendChatMessage,
  useEscalateConversation,
} from '../src/hooks/chatbot';
import {
  fetchCalls,
  jsonResponse,
  makeWrapper,
  restoreFetch,
  setupFetchMock,
  problemResponse,
} from './helpers';

afterEach(() => restoreFetch());

describe('chatbot hooks (S4-05 / S4-08)', () => {
  it('useSendChatMessage → POST /v1/chatbot/message con body { message, conversationId? }', async () => {
    const reply = {
      conversationId: 'conv-1',
      messageId: 'm-2',
      reply: '¡Hola! Tu póliza está vigente hasta 2027-01-01.',
      author: 'bot',
      ts: '2026-04-27T10:00:00.000Z',
    };
    setupFetchMock(() => jsonResponse(reply));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSendChatMessage(), { wrapper: Wrapper });

    await act(async () => {
      const r = await result.current.mutateAsync({
        message: '¿hasta cuándo es mi póliza?',
        conversationId: 'conv-1',
      });
      expect(r).toEqual(reply);
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.method).toBe('POST');
    expect(fetchCalls[0]!.url).toBe('/api/proxy/v1/chatbot/message');
    expect(JSON.parse(fetchCalls[0]!.body ?? '{}')).toEqual({
      message: '¿hasta cuándo es mi póliza?',
      conversationId: 'conv-1',
    });
    expect(fetchCalls[0]!.headers['x-trace-id']).toBeDefined();
    expect(fetchCalls[0]!.headers['content-type']).toBe('application/json');
  });

  it('useSendChatMessage sin conversationId → solo envía message', async () => {
    setupFetchMock(() =>
      jsonResponse({
        conversationId: 'conv-new',
        messageId: 'm-1',
        reply: 'ok',
        author: 'bot',
        ts: '2026-04-27T10:00:01.000Z',
      }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSendChatMessage(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ message: 'hola' });
    });

    expect(JSON.parse(fetchCalls[0]!.body ?? '{}')).toEqual({ message: 'hola' });
  });

  it('useSendChatMessage → backend 500 → mutation falla con ProblemDetailsError', async () => {
    setupFetchMock(() => problemResponse(500, 'kb-down'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSendChatMessage(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ message: 'x' }),
      ).rejects.toThrow();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('useEscalateConversation → POST /v1/chatbot/escalate con { conversationId, reason }', async () => {
    const dto = { conversationId: 'conv-1', reason: 'no entiende mi pregunta' };
    const expected = {
      ticketId: 'tk-99',
      status: 'created' as const,
      ackEmailQueued: true,
    };
    setupFetchMock(() => jsonResponse(expected));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useEscalateConversation(), { wrapper: Wrapper });

    await act(async () => {
      const r = await result.current.mutateAsync(dto);
      expect(r).toEqual(expected);
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.method).toBe('POST');
    expect(fetchCalls[0]!.url).toBe('/api/proxy/v1/chatbot/escalate');
    expect(JSON.parse(fetchCalls[0]!.body ?? '{}')).toEqual(dto);
  });

  it('useEscalateConversation sin reason → solo envía conversationId', async () => {
    setupFetchMock(() =>
      jsonResponse({ ticketId: 'tk-1', status: 'created', ackEmailQueued: true }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useEscalateConversation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: 'conv-1' });
    });

    expect(JSON.parse(fetchCalls[0]!.body ?? '{}')).toEqual({
      conversationId: 'conv-1',
    });
  });

  it('useEscalateConversation → backend 429 (throttle) → mutation rechaza', async () => {
    setupFetchMock(() => problemResponse(429, 'demasiados escalamientos'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useEscalateConversation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ conversationId: 'conv-1' }),
      ).rejects.toThrow();
    });
  });
});
