/**
 * Priority utilities for task/quest display
 */

export function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 1:
      return 'Critical';
    case 2:
      return 'High';
    case 3:
      return 'Medium';
    case 4:
      return 'Low';
    case 5:
      return 'Backlog';
    default:
      return 'Unknown';
  }
}

export function getPriorityColor(priority: number): string {
  switch (priority) {
    case 1:
      return 'bg-red-500/10 text-red-500';
    case 2:
      return 'bg-orange-500/10 text-orange-500';
    case 3:
      return 'bg-amber-500/10 text-amber-500';
    case 4:
      return 'bg-blue-500/10 text-blue-500';
    case 5:
      return 'bg-gray-500/10 text-gray-500';
    default:
      return 'bg-gray-500/10 text-gray-500';
  }
}

export function getPriorityIconColor(priority: number): string {
  switch (priority) {
    case 1:
      return 'text-red-500';
    case 2:
      return 'text-orange-500';
    case 3:
      return 'text-amber-500';
    case 4:
      return 'text-blue-500';
    case 5:
      return 'text-gray-500';
    default:
      return 'text-gray-500';
  }
}
