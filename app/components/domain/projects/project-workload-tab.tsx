'use client';

import * as React from 'react';
import { User, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDuration, getBatteryImpactLabel, getBatteryImpactVariant } from '@/lib/calculations/energy';
import { getTaskStatusLabel, getTaskStatusVariant } from '@/lib/calculations/status';

interface Task {
  id: string;
  title: string;
  status: string;
  priority: number;
  assignee_id: string | null;
  assignee: { id: string; name: string; email?: string } | null;
  energy_estimate: number | null;
  estimated_minutes: number | null;
  battery_impact: string;
}

interface TeamAssignment {
  id: string;
  user_id: string;
  user: { id: string; name: string; email?: string } | null;
  function: { id: string; name: string } | null;
  is_lead: boolean;
}

interface ProjectWorkloadTabProps {
  projectId: string;
  tasks: Task[];
  teamAssignments: TeamAssignment[];
}

interface MemberWorkload {
  userId: string;
  name: string;
  role: string | null;
  isLead: boolean;
  tasks: Task[];
  totalMinutes: number;
  completedMinutes: number;
  inProgressMinutes: number;
  highDrainCount: number;
}

export function ProjectWorkloadTab({ projectId, tasks, teamAssignments }: ProjectWorkloadTabProps) {
  // Calculate workload per team member
  const workloadByMember = React.useMemo(() => {
    const memberMap = new Map<string, MemberWorkload>();

    // Initialize with team assignments
    teamAssignments.forEach((assignment) => {
      if (assignment.user) {
        memberMap.set(assignment.user_id, {
          userId: assignment.user_id,
          name: assignment.user.name,
          role: assignment.function?.name || null,
          isLead: assignment.is_lead,
          tasks: [],
          totalMinutes: 0,
          completedMinutes: 0,
          inProgressMinutes: 0,
          highDrainCount: 0,
        });
      }
    });

    // Add unassigned bucket
    memberMap.set('unassigned', {
      userId: 'unassigned',
      name: 'Unassigned',
      role: null,
      isLead: false,
      tasks: [],
      totalMinutes: 0,
      completedMinutes: 0,
      inProgressMinutes: 0,
      highDrainCount: 0,
    });

    // Distribute tasks
    tasks.forEach((task) => {
      const assigneeId = task.assignee_id || 'unassigned';

      // If assignee not in team, add them
      if (!memberMap.has(assigneeId) && task.assignee) {
        memberMap.set(assigneeId, {
          userId: assigneeId,
          name: task.assignee.name,
          role: null,
          isLead: false,
          tasks: [],
          totalMinutes: 0,
          completedMinutes: 0,
          inProgressMinutes: 0,
          highDrainCount: 0,
        });
      }

      const member = memberMap.get(assigneeId);
      if (member) {
        member.tasks.push(task);
        const minutes = task.estimated_minutes || 0;
        member.totalMinutes += minutes;

        if (task.status === 'done') {
          member.completedMinutes += minutes;
        } else if (task.status === 'in_progress') {
          member.inProgressMinutes += minutes;
        }

        if (task.battery_impact === 'high_drain') {
          member.highDrainCount++;
        }
      }
    });

    // Convert to array and sort by total workload
    return Array.from(memberMap.values())
      .filter((m) => m.tasks.length > 0 || m.userId !== 'unassigned')
      .sort((a, b) => {
        // Lead first, then by workload
        if (a.isLead && !b.isLead) return -1;
        if (!a.isLead && b.isLead) return 1;
        return b.totalMinutes - a.totalMinutes;
      });
  }, [tasks, teamAssignments]);

  // Calculate max workload for progress bar scaling
  const maxWorkload = Math.max(...workloadByMember.map((m) => m.totalMinutes), 1);

  if (workloadByMember.length === 0 || (workloadByMember.length === 1 && workloadByMember[0].userId === 'unassigned' && workloadByMember[0].tasks.length === 0)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Workload</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<User className="h-10 w-10" />}
            title="No workload data"
            description="Add team members and assign tasks to see workload distribution"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workload Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {workloadByMember.map((member) => (
            <div key={member.userId} className="space-y-2">
              {/* Member Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-medium">
                    {member.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-main">{member.name}</span>
                      {member.isLead && (
                        <Badge variant="info" className="text-xs">Lead</Badge>
                      )}
                    </div>
                    {member.role && (
                      <span className="text-xs text-text-sub">{member.role}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1 text-text-sub">
                    <Clock className="h-4 w-4" />
                    <span>{formatDuration(member.totalMinutes)}</span>
                  </div>
                  <div className="text-text-sub">
                    {member.tasks.length} task{member.tasks.length !== 1 ? 's' : ''}
                  </div>
                  {member.highDrainCount > 0 && (
                    <Badge variant="warning" className="text-xs">
                      {member.highDrainCount} high drain
                    </Badge>
                  )}
                </div>
              </div>

              {/* Workload Bar */}
              <div className="h-3 bg-surface-2 rounded-full overflow-hidden">
                {member.totalMinutes > 0 && (
                  <div className="h-full flex">
                    {/* Completed */}
                    <div
                      className="bg-green-500 transition-all"
                      style={{ width: `${(member.completedMinutes / maxWorkload) * 100}%` }}
                      title={`Completed: ${formatDuration(member.completedMinutes)}`}
                    />
                    {/* In Progress */}
                    <div
                      className="bg-amber-500 transition-all"
                      style={{ width: `${(member.inProgressMinutes / maxWorkload) * 100}%` }}
                      title={`In Progress: ${formatDuration(member.inProgressMinutes)}`}
                    />
                    {/* Remaining */}
                    <div
                      className="bg-primary/30 transition-all"
                      style={{ width: `${((member.totalMinutes - member.completedMinutes - member.inProgressMinutes) / maxWorkload) * 100}%` }}
                      title={`Remaining: ${formatDuration(member.totalMinutes - member.completedMinutes - member.inProgressMinutes)}`}
                    />
                  </div>
                )}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 text-xs text-text-sub">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span>Done ({formatDuration(member.completedMinutes)})</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>In Progress ({formatDuration(member.inProgressMinutes)})</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-primary/30" />
                  <span>Not Started ({formatDuration(member.totalMinutes - member.completedMinutes - member.inProgressMinutes)})</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
