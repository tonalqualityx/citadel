import type { OpenCardInput } from '@/components/domain/bast-chat/card-context';

/** The card the chat is told about when he taps "Talk about this" on a Triage card. Kind and id only leave the browser. */
export function cardTalk(card: { task_id: string; title: string }): OpenCardInput {
  return { key: `task:${card.task_id}`, title: card.title, type: 'task', task_id: card.task_id, tile: 'triage' };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Talk about this" (operating model S4, one chat per card). One idea (a task id) gets its own conversation: the dock
 * opens it, reopening the earlier one if there is one, so the card carries its discussion.
 */
export function openTriageConversation(card: OpenCardInput, openChat: (card: OpenCardInput) => void): void {
  const own = typeof card.task_id === 'string' && UUID_RE.test(card.task_id);
  openChat(own ? { ...card, own_conversation: true } : card);
}
