'use client';

import * as React from 'react';
import { Spinner } from '@/components/ui/spinner';
import { useBastChatShell } from '@/components/domain/bast-chat/BastChatProvider';
import { useCharterRetainerMonths, useConfirmRetainerMonth } from '@/lib/hooks/use-retainer-months';
import { RetainerMonthPanel } from './RetainerMonthPanel';

/** The top of a monthly charter's page: this month in full, past months one line each. Nothing for a charter with no month yet. */
export function CharterRetainerMonth({ charterId }: { charterId: string }) {
  const { data, isLoading } = useCharterRetainerMonths(charterId);
  const confirm = useConfirmRetainerMonth();
  const shell = useBastChatShell();
  if (isLoading) return <Spinner />;
  if (!data?.current) return null;
  return (
    <RetainerMonthPanel
      month={data.current}
      upcoming={data.upcoming}
      past={data.past}
      busy={confirm.isPending}
      onConfirm={(m) => confirm.mutate(m.id)}
      onTalk={(m) => shell.talkAbout({ key: 'retainer-months', title: `${m.client_name}: ${m.month} retainer`.slice(0, 120), tile: 'initiatives' })}
    />
  );
}
