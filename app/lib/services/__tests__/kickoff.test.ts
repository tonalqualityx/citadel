import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ops-review B6 — signing a contract or MSA auto-creates a cockpit-owned kickoff task
// (and fires the existing signature notification, extended to mention it). Both exported
// functions must never throw: the sign routes call them AFTER the signature is already
// recorded, and a failure here must never turn a successful signature into a 500.

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/services/notifications', () => ({
  notifyContractSigned: vi.fn(),
  notifyMsaSigned: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';
import { notifyContractSigned, notifyMsaSigned } from '@/lib/services/notifications';
import { createKickoffTask, runSignatureKickoffAutomation } from '../kickoff';
import type { Mock } from 'vitest';

const mockTaskFindFirst = prisma.task.findFirst as Mock;
const mockTaskCreate = prisma.task.create as Mock;
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockNotifyContractSigned = notifyContractSigned as Mock;
const mockNotifyMsaSigned = notifyMsaSigned as Mock;

const BAST_USER = { id: 'bast-user-id', email: 'bast@becomeindelible.com', is_active: true };
const MIKE_USER = { id: 'mike-user-id', email: 'mike@becomeindelible.com', is_active: true };

const contractParams = {
  signatureType: 'contract' as const,
  clientId: 'client-1',
  clientName: 'Acme Co',
  accordId: 'accord-1',
  accordName: 'Acme Website Build',
  signerName: 'Jane Doe',
  signerEmail: 'jane@acme.com',
};

const msaParams = {
  signatureType: 'msa' as const,
  clientId: 'client-2',
  clientName: 'Beta LLC',
  accordId: null,
  accordName: null,
  signerName: 'Bob Beta',
  signerEmail: 'bob@beta.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('createKickoffTask', () => {
  it('creates a kickoff task assigned to Bast for a contract signature', async () => {
    mockTaskFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValueOnce(BAST_USER);
    mockTaskCreate.mockResolvedValue({ id: 'task-1' });

    const result = await createKickoffTask(contractParams);

    expect(result).toEqual({ created: true, taskId: 'task-1' });
    expect(mockTaskFindFirst).toHaveBeenCalledWith({
      where: {
        is_deleted: false,
        title: 'Kickoff: Acme Co — contract signed',
        client_id: 'client-1',
        accord_id: 'accord-1',
      },
      select: { id: true },
    });
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { email: 'bast@becomeindelible.com', is_active: true },
    });

    const createCall = mockTaskCreate.mock.calls[0][0];
    expect(createCall.data.title).toBe('Kickoff: Acme Co — contract signed');
    expect(createCall.data.assignee_id).toBe('bast-user-id');
    expect(createCall.data.client_id).toBe('client-1');
    expect(createCall.data.accord_id).toBe('accord-1');
    expect(createCall.data.priority).toBe(2);
    expect(createCall.data.status).toBe('not_started');
    expect(createCall.data.source).toBe('internal');
    expect(createCall.data.tags).toEqual(['cockpit-owned']);
    expect(createCall.data.needs_review).toBe(false);
    expect(createCall.data.due_date).toBeInstanceOf(Date);

    // Description is stored as a serialized BlockNote block array, never a plain string.
    const parsedDescription = JSON.parse(createCall.data.description);
    expect(Array.isArray(parsedDescription)).toBe(true);
    expect(parsedDescription.length).toBeGreaterThan(0);
    expect(parsedDescription.every((block: any) => typeof block === 'object' && 'type' in block)).toBe(
      true
    );
  });

  it('produces the MSA-variant title and skips the accord reference when there is no accord', async () => {
    mockTaskFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValueOnce(BAST_USER);
    mockTaskCreate.mockResolvedValue({ id: 'task-2' });

    await createKickoffTask(msaParams);

    expect(mockTaskFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          title: 'Kickoff: Beta LLC — MSA signed',
          accord_id: null,
        }),
      })
    );
    const createCall = mockTaskCreate.mock.calls[0][0];
    expect(createCall.data.title).toBe('Kickoff: Beta LLC — MSA signed');
    expect(createCall.data.accord_id).toBeNull();

    const parsedDescription = JSON.parse(createCall.data.description);
    const serialized = JSON.stringify(parsedDescription);
    expect(serialized).toContain('Master Service Agreement');
    expect(serialized).toContain('/clients/client-2');
  });

  it('is idempotent: a second signature event for the same accord/title does not duplicate the task', async () => {
    mockTaskFindFirst.mockResolvedValueOnce(null);
    mockUserFindUnique.mockResolvedValueOnce(BAST_USER);
    mockTaskCreate.mockResolvedValue({ id: 'task-1' });

    const first = await createKickoffTask(contractParams);
    expect(first.created).toBe(true);

    mockTaskFindFirst.mockResolvedValueOnce({ id: 'task-1' });
    const second = await createKickoffTask(contractParams);

    expect(second).toEqual({ created: false, deduped: true, taskId: 'task-1' });
    expect(mockTaskCreate).toHaveBeenCalledTimes(1);
  });

  it('falls back to Mike with a logged warning when the Bast user is missing', async () => {
    mockTaskFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValueOnce(null); // Bast lookup misses
    mockUserFindUnique.mockResolvedValueOnce(MIKE_USER); // fallback lookup hits
    mockTaskCreate.mockResolvedValue({ id: 'task-3' });

    const result = await createKickoffTask(contractParams);

    expect(result).toEqual({ created: true, taskId: 'task-3' });
    expect(mockTaskCreate.mock.calls[0][0].data.assignee_id).toBe('mike-user-id');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('falling back to mike@becomeindelible.com'));
  });

  it('returns a graceful error (never throws) when neither Bast nor Mike can be resolved', async () => {
    mockTaskFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue(null); // both lookups miss

    const result = await createKickoffTask(contractParams);

    expect(result).toEqual({ created: false, error: 'no_assignee_available' });
    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('never throws when task creation fails — the signature must still succeed upstream', async () => {
    mockTaskFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValueOnce(BAST_USER);
    mockTaskCreate.mockRejectedValue(new Error('db exploded'));

    const result = await createKickoffTask(contractParams);

    expect(result.created).toBe(false);
    expect(result.error).toBe('db exploded');
    expect(console.error).toHaveBeenCalled();
  });

  it('never throws when the dedupe lookup itself fails', async () => {
    mockTaskFindFirst.mockRejectedValue(new Error('connection reset'));

    const result = await createKickoffTask(contractParams);

    expect(result.created).toBe(false);
    expect(result.error).toBe('connection reset');
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });
});

describe('runSignatureKickoffAutomation', () => {
  it('creates the kickoff task then notifies via notifyContractSigned for a contract signature', async () => {
    mockTaskFindFirst.mockResolvedValue(null);
    mockUserFindUnique
      .mockResolvedValueOnce(BAST_USER) // assignee lookup inside createKickoffTask
      .mockResolvedValueOnce(MIKE_USER); // notification recipient lookup
    mockTaskCreate.mockResolvedValue({ id: 'task-1' });

    await runSignatureKickoffAutomation(contractParams);

    expect(mockNotifyContractSigned).toHaveBeenCalledWith(
      'accord-1',
      'Acme Website Build',
      'mike-user-id',
      true
    );
    expect(mockNotifyMsaSigned).not.toHaveBeenCalled();
  });

  it('creates the kickoff task then notifies via notifyMsaSigned for an MSA signature', async () => {
    mockTaskFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValueOnce(BAST_USER).mockResolvedValueOnce(MIKE_USER);
    mockTaskCreate.mockResolvedValue({ id: 'task-2' });

    await runSignatureKickoffAutomation(msaParams);

    expect(mockNotifyMsaSigned).toHaveBeenCalledWith('client-2', 'Beta LLC', 'mike-user-id', true);
    expect(mockNotifyContractSigned).not.toHaveBeenCalled();
  });

  it('still reports kickoffTaskReady=true when the task was deduped rather than newly created', async () => {
    mockTaskFindFirst.mockResolvedValue({ id: 'existing-task' });
    mockUserFindUnique.mockResolvedValueOnce(MIKE_USER); // notification recipient lookup only

    await runSignatureKickoffAutomation(contractParams);

    expect(mockNotifyContractSigned).toHaveBeenCalledWith(
      'accord-1',
      'Acme Website Build',
      'mike-user-id',
      true
    );
  });

  it('skips notification gracefully (no throw) when the notify recipient cannot be resolved', async () => {
    mockTaskFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValueOnce(BAST_USER).mockResolvedValueOnce(null);
    mockTaskCreate.mockResolvedValue({ id: 'task-1' });

    await expect(runSignatureKickoffAutomation(contractParams)).resolves.toBeUndefined();
    expect(mockNotifyContractSigned).not.toHaveBeenCalled();
  });

  it('never throws even if the notification dispatcher itself rejects', async () => {
    mockTaskFindFirst.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValueOnce(BAST_USER).mockResolvedValueOnce(MIKE_USER);
    mockTaskCreate.mockResolvedValue({ id: 'task-1' });
    mockNotifyContractSigned.mockRejectedValueOnce(new Error('slack is down'));

    await expect(runSignatureKickoffAutomation(contractParams)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('never throws even if task creation itself fails outright', async () => {
    mockTaskFindFirst.mockRejectedValue(new Error('db exploded'));
    mockUserFindUnique.mockResolvedValueOnce(MIKE_USER);

    await expect(runSignatureKickoffAutomation(contractParams)).resolves.toBeUndefined();
  });
});
