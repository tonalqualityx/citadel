import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    meeting: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock formatters
vi.mock('@/lib/api/formatters', () => ({
  formatMeetingResponse: vi.fn((meeting) => meeting),
}));

// Mock activity logging
vi.mock('@/lib/services/activity', () => ({
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from '../route';
import { GET as GET_BY_ID, PATCH, DELETE } from '../[id]/route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);

// Type-safe mock accessors
const mockMeetingFindMany = prisma.meeting.findMany as Mock;
const mockMeetingCount = prisma.meeting.count as Mock;
const mockMeetingFindUnique = prisma.meeting.findUnique as Mock;
const mockMeetingCreate = prisma.meeting.create as Mock;
const mockMeetingUpdate = prisma.meeting.update as Mock;
const mockClientFindUnique = prisma.client.findUnique as Mock;

// Valid UUIDs for Zod validation
const MEETING_ID = '550e8400-e29b-41d4-a716-446655440001';
const CLIENT_ID = '550e8400-e29b-41d4-a716-446655440002';
const USER_ID = '550e8400-e29b-41d4-a716-446655440003';
const USER_ID_2 = '550e8400-e29b-41d4-a716-446655440004';
const USER_ID_3 = '550e8400-e29b-41d4-a716-446655440005';
const ACCORD_ID = '550e8400-e29b-41d4-a716-446655440006';
const NONEXISTENT_CLIENT_ID = '550e8400-e29b-41d4-a716-446655440099';

function createGetRequest(queryParams: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/meetings');
  Object.entries(queryParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return new NextRequest(url.toString(), { method: 'GET' });
}

function createPostRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/meetings', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createPatchRequest(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/meetings/${MEETING_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/meetings/${MEETING_ID}`, {
    method: 'DELETE',
  });
}

const mockMeeting = {
  id: MEETING_ID,
  title: 'Project Kickoff',
  client_id: CLIENT_ID,
  client: { id: CLIENT_ID, name: 'Acme Corp', status: 'active' },
  meeting_date: new Date('2026-03-15'),
  summary: null,
  notes: null,
  transcript_url: null,
  recording_url: null,
  client_attendees: null,
  transcript_not_available: false,
  recording_not_available: false,
  created_by_id: USER_ID,
  created_by: { id: USER_ID, name: 'Admin', email: 'admin@test.com', avatar_url: null },
  attendees: [],
  meeting_accords: [],
  meeting_projects: [],
  meeting_charters: [],
  _count: { tasks: 0 },
  is_deleted: false,
  created_at: new Date(),
  updated_at: new Date(),
};

// ----- GET /api/meetings -----

describe('GET /api/meetings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: USER_ID,
      role: 'admin',
      email: 'admin@test.com',
    });
  });

  it('returns paginated meetings list', async () => {
    mockMeetingFindMany.mockResolvedValue([mockMeeting]);
    mockMeetingCount.mockResolvedValue(1);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meetings).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(1);
  });

  it('filters by client_id', async () => {
    mockMeetingFindMany.mockResolvedValue([]);
    mockMeetingCount.mockResolvedValue(0);

    const request = createGetRequest({ client_id: CLIENT_ID });
    await GET(request);

    expect(mockMeetingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          client_id: CLIENT_ID,
          is_deleted: false,
        }),
      })
    );
  });

  it('filters by search term', async () => {
    mockMeetingFindMany.mockResolvedValue([]);
    mockMeetingCount.mockResolvedValue(0);

    const request = createGetRequest({ search: 'kickoff' });
    await GET(request);

    expect(mockMeetingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_deleted: false,
          title: { contains: 'kickoff', mode: 'insensitive' },
        }),
      })
    );
  });

  it('returns empty when no meetings', async () => {
    mockMeetingFindMany.mockResolvedValue([]);
    mockMeetingCount.mockResolvedValue(0);

    const request = createGetRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meetings).toHaveLength(0);
    expect(body.total).toBe(0);
    expect(body.totalPages).toBe(0);
  });
});

// ----- POST /api/meetings -----

describe('POST /api/meetings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: USER_ID,
      role: 'pm',
      email: 'pm@test.com',
    });
    mockClientFindUnique.mockResolvedValue({ id: CLIENT_ID, name: 'Acme Corp' });
    mockMeetingCreate.mockResolvedValue(mockMeeting);
  });

  it('creates meeting with required fields', async () => {
    const request = createPostRequest({
      title: 'Project Kickoff',
      client_id: CLIENT_ID,
      meeting_date: '2026-03-15T10:00:00.000Z',
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockMeetingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Project Kickoff',
          client_id: CLIENT_ID,
          created_by_id: USER_ID,
        }),
      })
    );
  });

  it('creates meeting with attendees and accord associations', async () => {
    const request = createPostRequest({
      title: 'Sprint Review',
      client_id: CLIENT_ID,
      meeting_date: '2026-03-15T10:00:00.000Z',
      attendee_ids: [USER_ID_2, USER_ID_3],
      accord_ids: [ACCORD_ID],
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockMeetingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Sprint Review',
          attendees: {
            create: [
              { user_id: USER_ID_2 },
              { user_id: USER_ID_3 },
            ],
          },
          meeting_accords: {
            create: [
              { accord_id: ACCORD_ID },
            ],
          },
        }),
      })
    );
  });

  it('returns 400 for missing required fields (Zod validation)', async () => {
    const request = createPostRequest({
      title: 'No Client or Date',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('requires pm/admin role', async () => {
    const request = createPostRequest({
      title: 'Meeting',
      client_id: CLIENT_ID,
      meeting_date: '2026-03-15T10:00:00.000Z',
    });
    await POST(request);

    expect(mockRequireRole).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, role: 'pm' }),
      ['pm', 'admin']
    );
  });

  it('returns 404 when client does not exist', async () => {
    mockClientFindUnique.mockResolvedValue(null);

    const request = createPostRequest({
      title: 'Meeting',
      client_id: NONEXISTENT_CLIENT_ID,
      meeting_date: '2026-03-15T10:00:00.000Z',
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Client not found');
  });

  it('creates meeting with optional summary and notes', async () => {
    const request = createPostRequest({
      title: 'Discovery Call',
      client_id: CLIENT_ID,
      meeting_date: '2026-03-15T10:00:00.000Z',
      summary: 'Discussed project requirements',
      notes: 'Follow up on timeline next week',
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockMeetingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          summary: 'Discussed project requirements',
          notes: 'Follow up on timeline next week',
        }),
      })
    );
  });
});

// ----- GET /api/meetings/:id -----

describe('GET /api/meetings/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: USER_ID,
      role: 'admin',
      email: 'admin@test.com',
    });
  });

  it('returns meeting with all relations', async () => {
    const fullMeeting = {
      ...mockMeeting,
      tasks: [],
    };
    mockMeetingFindUnique.mockResolvedValue(fullMeeting);

    const request = new NextRequest(`http://localhost:3000/api/meetings/${MEETING_ID}`, {
      method: 'GET',
    });
    const response = await GET_BY_ID(request, {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe(MEETING_ID);
    expect(mockMeetingFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MEETING_ID, is_deleted: false },
      })
    );
  });

  it('returns 404 for non-existent meeting', async () => {
    mockMeetingFindUnique.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/meetings/nonexistent', {
      method: 'GET',
    });
    const response = await GET_BY_ID(request, {
      params: Promise.resolve({ id: 'nonexistent' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Meeting not found');
  });
});

// ----- PATCH /api/meetings/:id -----

describe('PATCH /api/meetings/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: USER_ID,
      role: 'pm',
      email: 'pm@test.com',
    });
    mockMeetingUpdate.mockResolvedValue(mockMeeting);
  });

  it('updates meeting title', async () => {
    const request = createPatchRequest({ title: 'Updated Title' });
    const response = await PATCH(request, {
      params: Promise.resolve({ id: MEETING_ID }),
    });

    expect(response.status).toBe(200);
    expect(mockMeetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MEETING_ID },
        data: expect.objectContaining({
          title: 'Updated Title',
        }),
      })
    );
  });

  it('updates transcript and recording URLs', async () => {
    const request = createPatchRequest({
      transcript_url: 'https://example.com/transcript.txt',
      recording_url: 'https://example.com/recording.mp4',
    });
    const response = await PATCH(request, {
      params: Promise.resolve({ id: MEETING_ID }),
    });

    expect(response.status).toBe(200);
    expect(mockMeetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transcript_url: 'https://example.com/transcript.txt',
          recording_url: 'https://example.com/recording.mp4',
        }),
      })
    );
  });

  it('updates transcript_not_available flag', async () => {
    const request = createPatchRequest({
      transcript_not_available: true,
    });
    const response = await PATCH(request, {
      params: Promise.resolve({ id: MEETING_ID }),
    });

    expect(response.status).toBe(200);
    expect(mockMeetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transcript_not_available: true,
        }),
      })
    );
  });
});

// ----- DELETE /api/meetings/:id -----

describe('DELETE /api/meetings/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      userId: USER_ID,
      role: 'admin',
      email: 'admin@test.com',
    });
  });

  it('soft deletes meeting (sets is_deleted = true)', async () => {
    mockMeetingUpdate.mockResolvedValue({ ...mockMeeting, is_deleted: true });

    const request = createDeleteRequest();
    const response = await DELETE(request, {
      params: Promise.resolve({ id: MEETING_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockMeetingUpdate).toHaveBeenCalledWith({
      where: { id: MEETING_ID },
      data: { is_deleted: true },
    });
  });
});
