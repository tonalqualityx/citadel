'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// The client-portal landing (C1 login redirects here). Lists the logged-in client's articles that
// are ready for their review (in_review only) — projected client-safe by the API. Clicking one heads
// to the C4 full-screen review/edit screen (built separately).
//
// Below that, three read-only status sections show where feedback/pieces already sent onward have
// gone — "what happened to my feedback?" — so a client isn't left wondering after they've acted.
// These are deliberately not clickable into the C4 editor: only in_review/needs_revision are
// actionable (see lib/articles/portal-actions.ts), so there is nothing to edit here.
interface ClientArticle {
  id: string;
  title: string;
  status: string;
  body: string | null;
  comments: Array<{ id: string; content: string; author_name: string | null; created_at: string }>;
  created_at: string;
  updated_at: string;
}

interface ClientArticleSummary {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  published_url?: string | null;
}

interface ArticlesResponse {
  articles: ClientArticle[];
  in_revision: ClientArticleSummary[];
  approved: ClientArticleSummary[];
  published: ClientArticleSummary[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// A single read-only row shared by the three status sections below.
function SummaryRow({ item }: { item: ClientArticleSummary }) {
  return (
    <li className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4">
      <span className="font-medium text-text-main">{item.title}</span>
      {item.published_url ? (
        <a
          href={item.published_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs text-brand-primary hover:underline"
        >
          View published →
        </a>
      ) : (
        <span className="shrink-0 text-xs text-text-tertiary">Updated {formatDate(item.updated_at)}</span>
      )}
    </li>
  );
}

function StatusSection({
  heading,
  description,
  items,
}: {
  heading: string;
  description: string;
  items: ClientArticleSummary[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold text-text-main">{heading}</h2>
      <p className="mt-1 text-sm text-text-tertiary">{description}</p>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <SummaryRow key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

export default function ClientArticleListPage() {
  const router = useRouter();
  const [data, setData] = useState<ArticlesResponse | null>(null);
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
        const payload: ArticlesResponse = await res.json();
        setData(payload);
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

  const articles = data?.articles ?? [];

  return (
    <div>
      <h2 className="text-xl font-semibold text-text-main">Ready for your review</h2>
      <p className="mt-1 text-sm text-text-tertiary">
        Articles we&apos;ve prepared and are waiting on your review.
      </p>

      {articles.length > 0 ? (
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

      <StatusSection
        heading="Being revised"
        description="We're revising this now."
        items={data?.in_revision ?? []}
      />
      <StatusSection
        heading="Approved"
        description="Approved — publishing soon."
        items={data?.approved ?? []}
      />
      <StatusSection
        heading="Published"
        description="Live on your site."
        items={data?.published ?? []}
      />
    </div>
  );
}
