import { describe, it, expect } from 'vitest';
import {
  milestoneKeys,
  type Milestone,
  type MilestonesResponse,
  type CreateMilestoneInput,
  type UpdateMilestoneInput,
} from '../use-milestones';

describe('milestoneKeys', () => {
  it('should generate correct base query key', () => {
    expect(milestoneKeys.all).toEqual(['milestones']);
  });

  it('should generate correct project-specific query key', () => {
    const projectId = 'project-123';
    expect(milestoneKeys.project(projectId)).toEqual(['milestones', 'project-123']);
  });

  it('should generate correct detail query key', () => {
    const milestoneId = 'milestone-456';
    expect(milestoneKeys.detail(milestoneId)).toEqual(['milestone', 'milestone-456']);
  });

  it('should handle different project IDs correctly', () => {
    expect(milestoneKeys.project('abc')).toEqual(['milestones', 'abc']);
    expect(milestoneKeys.project('xyz-789')).toEqual(['milestones', 'xyz-789']);
    expect(milestoneKeys.project('')).toEqual(['milestones', '']);
  });

  it('should handle different milestone IDs correctly', () => {
    expect(milestoneKeys.detail('id-1')).toEqual(['milestone', 'id-1']);
    expect(milestoneKeys.detail('uuid-format-id')).toEqual(['milestone', 'uuid-format-id']);
  });
});

describe('Milestone type interfaces', () => {
  it('should accept valid Milestone objects', () => {
    const milestone: Milestone = {
      id: 'test-id',
      name: 'Test Milestone',
      project_id: 'project-123',
      phase_id: null,
      target_date: '2025-03-15',
      completed_at: null,
      notes: 'Some notes',
      sort_order: 1,
      billing_amount: 1500,
      billing_status: 'pending',
      triggered_at: null,
      triggered_by_id: null,
      invoiced_at: null,
      invoiced_by_id: null,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };

    expect(milestone.id).toBe('test-id');
    expect(milestone.name).toBe('Test Milestone');
    expect(milestone.project_id).toBe('project-123');
    expect(milestone.target_date).toBe('2025-03-15');
    expect(milestone.completed_at).toBeNull();
    expect(milestone.notes).toBe('Some notes');
    expect(milestone.sort_order).toBe(1);
    expect(milestone.billing_amount).toBe(1500);
    expect(milestone.billing_status).toBe('pending');
  });

  it('should accept Milestone with null optional fields', () => {
    const milestone: Milestone = {
      id: 'test-id',
      name: 'Minimal Milestone',
      project_id: 'project-456',
      phase_id: null,
      target_date: null,
      completed_at: null,
      notes: null,
      sort_order: 0,
      billing_amount: null,
      billing_status: 'pending',
      triggered_at: null,
      triggered_by_id: null,
      invoiced_at: null,
      invoiced_by_id: null,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };

    expect(milestone.target_date).toBeNull();
    expect(milestone.completed_at).toBeNull();
    expect(milestone.notes).toBeNull();
    expect(milestone.billing_amount).toBeNull();
  });

  it('should accept valid MilestonesResponse', () => {
    const response: MilestonesResponse = {
      milestones: [
        {
          id: 'ms-1',
          name: 'Milestone 1',
          project_id: 'proj-1',
          phase_id: null,
          target_date: null,
          completed_at: null,
          notes: null,
          sort_order: 0,
          billing_amount: null,
          billing_status: 'pending',
          triggered_at: null,
          triggered_by_id: null,
          invoiced_at: null,
          invoiced_by_id: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 'ms-2',
          name: 'Milestone 2',
          project_id: 'proj-1',
          phase_id: 'phase-1',
          target_date: '2025-06-01',
          completed_at: '2025-05-15T12:00:00Z',
          notes: 'Completed early!',
          sort_order: 1,
          billing_amount: 2500,
          billing_status: 'invoiced',
          triggered_at: '2025-05-10T10:00:00Z',
          triggered_by_id: 'user-1',
          invoiced_at: '2025-05-15T12:00:00Z',
          invoiced_by_id: 'user-1',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-05-15T12:00:00Z',
        },
      ],
      count: 2,
    };

    expect(response.milestones).toHaveLength(2);
    expect(response.count).toBe(2);
  });

  it('should accept valid CreateMilestoneInput', () => {
    const fullInput: CreateMilestoneInput = {
      name: 'New Milestone',
      target_date: '2025-04-01',
      notes: 'Initial notes',
    };

    expect(fullInput.name).toBe('New Milestone');
    expect(fullInput.target_date).toBe('2025-04-01');
    expect(fullInput.notes).toBe('Initial notes');

    // Minimal input (only required fields)
    const minimalInput: CreateMilestoneInput = {
      name: 'Minimal Milestone',
    };

    expect(minimalInput.name).toBe('Minimal Milestone');
    expect(minimalInput.target_date).toBeUndefined();
    expect(minimalInput.notes).toBeUndefined();
  });

  it('should accept valid UpdateMilestoneInput', () => {
    const fullUpdate: UpdateMilestoneInput = {
      name: 'Updated Name',
      target_date: '2025-05-01',
      notes: 'Updated notes',
      completed_at: '2025-04-30T18:00:00Z',
      sort_order: 5,
    };

    expect(fullUpdate.name).toBe('Updated Name');
    expect(fullUpdate.sort_order).toBe(5);

    // Partial update (all fields optional)
    const partialUpdate: UpdateMilestoneInput = {
      completed_at: null,
    };

    expect(partialUpdate.completed_at).toBeNull();
    expect(partialUpdate.name).toBeUndefined();
  });
});
