import type { HomeTriageGroup, HomeTriageTask } from '@/lib/home/types';
import type { OpenCardInput } from '@/components/domain/bast-chat/card-context';
import { talkAboutLine } from '@/lib/tasks/triage-copy';

/** The card the chat is told about when he taps "Talk about this" on a group or on one idea. Kind and id only leave the browser. */
export function triageTalkCard(group: HomeTriageGroup, task?: HomeTriageTask): OpenCardInput {
  if (task) return { key: `task:${task.task_id}`, title: task.title, type: 'task', task_id: task.task_id, tile: 'triage' };
  // A project group is the project card; a pass group or the no-project group spans several, so only its title travels (kind none).
  return { key: group.project_id ?? `triage:${group.key}`, title: talkAboutLine(group.label, group.count), tile: 'triage' };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Talk about this" (operating model S4, one chat per card). One idea (a task id) gets its own conversation: the dock
 * opens it, reopening the earlier one if there is one, so the card carries its discussion. A group row spans several
 * cards, so it keeps using the general chat with the group in its About line.
 */
export function openTriageConversation(card: OpenCardInput, openChat: (card: OpenCardInput) => void): void {
  const own = typeof card.task_id === 'string' && UUID_RE.test(card.task_id);
  openChat(own ? { ...card, own_conversation: true } : card);
}
