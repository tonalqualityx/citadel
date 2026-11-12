import type { HomeTriageGroup, HomeTriageTask } from '@/lib/home/types';
import type { OpenCardInput } from '@/components/domain/bast-chat/card-context';
import { talkAboutLine } from '@/lib/tasks/triage-copy';

/** The card the chat is told about when he taps "Talk about this" on a group or on one idea. Kind and id only leave the browser. */
export function triageTalkCard(group: HomeTriageGroup, task?: HomeTriageTask): OpenCardInput {
  if (task) return { key: `task:${task.task_id}`, title: task.title, type: 'task', task_id: task.task_id, tile: 'triage' };
  // A project group is the project card; a pass group or the no-project group spans several, so only its title travels (kind none).
  return { key: group.project_id ?? `triage:${group.key}`, title: talkAboutLine(group.label, group.count), tile: 'triage' };
}

/**
 * SEAM (operating model slice S4, one chat per card). Today "Talk about this" opens the existing Bast chat with the card referenced
 * in its About line. When S4 lands the per-card conversation API (a nullable task_id on the conversation, reopen instead of start
 * fresh), replace the body of this function so it reopens or starts that card's own conversation, and keep the call sites as they are.
 */
export function openTriageConversation(card: OpenCardInput, openExistingChat: (card: OpenCardInput) => void): void {
  openExistingChat(card);
}
