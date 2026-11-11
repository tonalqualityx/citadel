/** Home Slice 9a: the dedupe key of each kind of change (one piece of work is proposed once). Pure. */
import { createHash } from 'node:crypto';

export const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16);

export const noteKey = (taskId: string, messageKey: string): string => `note:${taskId}:${sha1(messageKey)}`;
export const doneKey = (taskId: string): string => `done:${taskId}`;
export const waitingKey = (taskId: string): string => `waiting:${taskId}`;
export const sessionKeyOf = (sessionKey: string, askText: string): string => `session:${sessionKey}:${sha1(askText)}`;
export const waitKey = (threadRoot: string, email: string): string => `wait:${sha1(threadRoot)}:${sha1(email.toLowerCase())}`;
export const workKey = (clientOrDomain: string, threadRoot: string): string => `work:${clientOrDomain.slice(0, 80)}:${sha1(threadRoot)}`;

/** The hold key of a task or session target. */
export const taskTarget = (taskId: string): string => `task:${taskId}`;
export const sessionTarget = (externalId: string): string => `session:${externalId}`;
