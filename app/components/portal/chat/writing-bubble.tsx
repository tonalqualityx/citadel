import { ASSISTANT_NAME } from '@/lib/portal/chat/copy';

// The assistant is writing. The words come from the server (Writing, Still writing, Checking your
// numbers); the dots are decoration and stand still under reduced motion.
export function WritingBubble({ label }: { label: string }) {
  return (
    <div className="msg us writing" data-testid="chat-writing">
      <span className="av" aria-hidden="true">
        I
      </span>
      <span className="who">{ASSISTANT_NAME}</span>
      <div className="bub">
        <span>{label}</span>
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
