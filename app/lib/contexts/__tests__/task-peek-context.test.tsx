import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { TaskPeekProvider, useTaskPeek } from '../task-peek-context';

// Clarity Phase 4b — TaskPeekProvider owns the single shared TaskPeekDrawer instance and
// exposes openTaskPeek() to descendants. Stub the (heavy, DB/auth-dependent) real drawer so
// this test stays a pure plumbing test: does openTaskPeek route the right taskId/open state
// into the drawer's props?
vi.mock('@/components/domain/tasks/task-peek-drawer', () => ({
  TaskPeekDrawer: ({ taskId, open, onOpenChange }: { taskId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) => (
    <div data-testid="stub-drawer" data-task-id={taskId ?? ''} data-open={open ? 'true' : 'false'}>
      <button type="button" onClick={() => onOpenChange(false)}>
        close-stub
      </button>
    </div>
  ),
}));

function Consumer({ taskId }: { taskId: string }) {
  const { openTaskPeek } = useTaskPeek();
  return (
    <button type="button" onClick={() => openTaskPeek(taskId)}>
      open {taskId}
    </button>
  );
}

describe('TaskPeekProvider / useTaskPeek', () => {
  it('starts closed with no task id', () => {
    render(
      <TaskPeekProvider>
        <Consumer taskId="task-1" />
      </TaskPeekProvider>
    );

    const drawer = screen.getByTestId('stub-drawer');
    expect(drawer).toHaveAttribute('data-open', 'false');
    expect(drawer).toHaveAttribute('data-task-id', '');
  });

  it('openTaskPeek(taskId) opens the drawer with that task id', () => {
    render(
      <TaskPeekProvider>
        <Consumer taskId="task-42" />
      </TaskPeekProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'open task-42' }));

    const drawer = screen.getByTestId('stub-drawer');
    expect(drawer).toHaveAttribute('data-open', 'true');
    expect(drawer).toHaveAttribute('data-task-id', 'task-42');
  });

  it('onOpenChange(false) from the drawer closes it', () => {
    render(
      <TaskPeekProvider>
        <Consumer taskId="task-42" />
      </TaskPeekProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'open task-42' }));
    expect(screen.getByTestId('stub-drawer')).toHaveAttribute('data-open', 'true');

    fireEvent.click(screen.getByText('close-stub'));
    expect(screen.getByTestId('stub-drawer')).toHaveAttribute('data-open', 'false');
  });

  it('useTaskPeek() outside a provider is a safe no-op, never throws', () => {
    function Standalone() {
      const { openTaskPeek } = useTaskPeek();
      return (
        <button type="button" onClick={() => openTaskPeek('whatever')}>
          standalone
        </button>
      );
    }

    expect(() => render(<Standalone />)).not.toThrow();
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'standalone' }))).not.toThrow();
  });
});
