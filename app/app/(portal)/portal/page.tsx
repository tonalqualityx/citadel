'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// The client-portal landing (C1 login redirects here). Lists the logged-in client's articles that
// are ready for their review (in_review only) — projected client-safe by the API. Clicking one heads
// to the C4 full-screen review/edit screen (built separately).
interface ClientArticle {
  id: string;
  title: string;
  status: string;
  body: string | null;
  comments: Array<{ id: string; content: string; author_name: string | null; created_at: string }>;
  created_at: string;
  updated_at: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ClientArticleListPage() {
  const router = useRouter();
  const [articles, setArticles] = useState<ClientArticle[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchArticles() {
      try {
        const res = await fetch('/api/portal/articles');
        if (res.status === 401) {
          // No / expired session — back to the magic-link login.
          router.replace('/portal/login');
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || 'Failed to load your articles');
          return;
        }
        const payload: { articles: ClientArticle[] } = await res.json();
        setArticles(payload.articles);
      } catch {
        setError('Failed to load your articles');
      } finally {
        setLoading(false);
      }
    }
    fetchArticles();
  }, [router]);

  if (loading) {
    return <p className="text-sm text-text-tertiary">Loading your articles…</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <p className="text-sm text-text-main">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-text-main">Ready for your review</h2>
      <p className="mt-1 text-sm text-text-tertiary">
        Articles we&apos;ve prepared and are waiting on your review.
      </p>

      {articles && articles.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {articles.map((article) => (
            <li key={article.id}>
              <Link
                href={`/portal/articles/${article.id}`}
                className="block rounded-lg border border-border bg-surface p-4 transition-colors hover:border-text-tertiary"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-text-main">{article.title}</span>
                  <span className="shrink-0 text-xs text-text-tertiary">
                    Updated {formatDate(article.updated_at)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-sm text-text-tertiary">
            Nothing is waiting on your review right now. We&apos;ll email you when something&apos;s ready.
          </p>
        </div>
      )}
    </div>
  );
}
