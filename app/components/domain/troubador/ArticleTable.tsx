'use client';

import * as React from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import { useUpdateArticle } from '@/lib/hooks/use-troubador';
import { ArticleStatusBadge } from './ArticleStatusBadge';
import { ArticleDetail } from './ArticleDetail';
import type { Article } from '@/lib/types/troubador';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const parts = value.split('T')[0].split('-');
  if (parts.length !== 3) return value;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ArticleTable({ articles }: { articles: Article[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const updateArticle = useUpdateArticle();

  const handleAction = (
    id: string,
    action: 'approve' | 'drop' | 'postpone'
  ) => {
    updateArticle.mutate({ id, data: { action } });
  };

  if (!articles || articles.length === 0) {
    return (
      <div className="text-center py-12 text-text-sub text-sm">
        No articles yet.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border-warm">
        <table className="w-full text-sm">
          <thead className="bg-background-light text-text-sub">
            <tr>
              <th className="text-left font-medium px-3 py-2">Title</th>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="text-left font-medium px-3 py-2">Check</th>
              <th className="text-left font-medium px-3 py-2">Scheduled</th>
              <th className="text-right font-medium px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {articles.map((article) => {
              const dropped = article.status === 'dropped';
              return (
                <tr
                  key={article.id}
                  className="border-t border-border-warm hover:bg-background-light/60"
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setOpenId(article.id)}
                      className={cn(
                        'text-left font-medium text-text-main hover:text-primary transition-colors flex items-center gap-1.5',
                        dropped && 'line-through opacity-60'
                      )}
                    >
                      {article.locked && (
                        <Lock className="h-3 w-3 text-text-sub shrink-0" />
                      )}
                      <span className="line-clamp-1">{article.title}</span>
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <ArticleStatusBadge status={article.status} />
                  </td>
                  <td className="px-3 py-2 text-text-sub">
                    {article.check_state ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-text-sub">
                    {formatDate(article.scheduled_date)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleAction(article.id, 'approve')}
                        disabled={updateArticle.isPending || article.status === 'approved'}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleAction(article.id, 'postpone')}
                        disabled={updateArticle.isPending}
                      >
                        Postpone
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleAction(article.id, 'drop')}
                        disabled={updateArticle.isPending || dropped}
                      >
                        Drop
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <ModalContent size="xl">
          <ModalHeader>
            <ModalTitle>Article</ModalTitle>
          </ModalHeader>
          <ModalBody>
            {openId && <ArticleDetail articleId={openId} />}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
}
