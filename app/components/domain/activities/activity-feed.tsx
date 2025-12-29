'use client';

import * as React from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Activity,
  ChevronDown,
  PlusCircle,
  Edit,
  Trash2,
  ArrowRight,
  UserPlus,
  UserMinus,
  CheckCircle,
  MessageSquare,
} from 'lucide-react';
import {
  useEntityActivities,
  getActivityDescription,
  Activity as ActivityType,
} from '@/lib/hooks/use-activities';
import { Avatar } from '@/components/ui/avatar';
import { Spinner } from '@/components/ui/spinner';

interface ActivityFeedProps {
  entityType: string;
  entityId: string;
  limit?: number;
  defaultExpanded?: boolean;
}

function getActivityIcon(action: string) {
  switch (action) {
    case 'created':
      return <PlusCircle className="h-4 w-4 text-green-500" />;
    case 'updated':
      return <Edit className="h-4 w-4 text-blue-500" />;
    case 'deleted':
      return <Trash2 className="h-4 w-4 text-red-500" />;
    case 'status_changed':
      return <ArrowRight className="h-4 w-4 text-amber-500" />;
    case 'assigned':
      return <UserPlus className="h-4 w-4 text-purple-500" />;
    case 'unassigned':
      return <UserMinus className="h-4 w-4 text-gray-500" />;
    case 'completed':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'commented':
      return <MessageSquare className="h-4 w-4 text-blue-500" />;
    default:
      return <Activity className="h-4 w-4 text-gray-500" />;
  }
}

function ActivityItem({ activity }: { activity: ActivityType }) {
  return (
    <div className="flex gap-3 py-2">
      <div className="flex-shrink-0 mt-1">
        {getActivityIcon(activity.action)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Avatar
            src={activity.user?.avatar_url}
            name={activity.user?.name || 'Unknown'}
            size="xs"
          />
          <span className="text-sm text-text-main">
            {getActivityDescription(activity)}
          </span>
        </div>
        <div className="text-xs text-text-sub mt-1">
          {formatDistanceToNow(new Date(activity.created_at), {
            addSuffix: true,
          })}
        </div>
      </div>
    </div>
  );
}

export function ActivityFeed({
  entityType,
  entityId,
  limit = 10,
  defaultExpanded = false,
}: ActivityFeedProps) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);

  const { data, isLoading } = useEntityActivities(entityType, entityId, {
    limit,
    enabled: isExpanded,
  });

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 bg-surface-alt hover:bg-surface-2 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-text-sub" />
          <span className="text-sm font-medium text-text-main">
            Activity
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-text-sub transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-border">
          <div className="p-3 max-h-60 overflow-y-auto custom-scrollbar">
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Spinner size="sm" />
              </div>
            ) : data?.activities && data.activities.length > 0 ? (
              <div className="divide-y divide-border">
                {data.activities.map((activity) => (
                  <ActivityItem key={activity.id} activity={activity} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-sub text-center py-4">
                No activity yet
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
