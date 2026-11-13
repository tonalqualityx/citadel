/**
 * Drawer opened from a button OUTSIDE it, by touch (the home screen's "Open the project", the meeting drawer's project link).
 * The content stays mounted while closed, so Radix's outside-press listener is live; on touch it fires on the click that ends
 * the tap, which is the same click that opened the drawer. The drawer must stay open, and an outside tap must still close it.
 */
import * as React from 'react';
import { flushSync } from 'react-dom';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Drawer, DrawerContent, DrawerTitle } from '../drawer';

function Harness() {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button type="button" onClick={() => flushSync(() => setOpen(true))}>open it</button>
      <button type="button">elsewhere</button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerTitle>Project</DrawerTitle>
          <button type="button">inside</button>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const state = () => document.querySelector('[role="dialog"]')?.getAttribute('data-state');

/**
 * (The opening button flushes its state synchronously, as a browser does at the end of a click, so Radix sees the drawer as
 * open when its click listener runs. Without that, jsdom hides the bug.)
 *
 * A touch tap as Chrome sends it: pointerdown (touch), then the click when the finger lifts. The click is dispatched outside
 * act() on purpose: a browser flushes React's state update at the end of React's own click handler, BEFORE the document-level
 * click listener Radix adds for touch runs. act() would defer the flush until after that listener and hide the bug.
 */
function touchTap(el: Element) {
  const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  Object.defineProperty(down, 'pointerType', { value: 'touch' });
  act(() => { el.dispatchEvent(down); });
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const prev = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prev;
  }
}

describe('Drawer opened by a tap on a button outside it', () => {
  it('stays open after a touch tap on the opening button', async () => {
    render(<Harness />);
    await settle();
    expect(state()).toBe('closed');
    touchTap(screen.getByText('open it'));
    await settle();
    expect(state()).toBe('open');
  });

  it('stays open after a mouse click on the opening button', async () => {
    render(<Harness />);
    await settle();
    fireEvent.pointerDown(screen.getByText('open it'));
    fireEvent.click(screen.getByText('open it'));
    await settle();
    expect(state()).toBe('open');
  });

  it('still closes on a touch tap outside once it is open', async () => {
    render(<Harness />);
    await settle();
    touchTap(screen.getByText('open it'));
    await settle();
    expect(state()).toBe('open');
    touchTap(screen.getByText('elsewhere'));
    await settle();
    expect(state()).toBe('closed');
  });
});
