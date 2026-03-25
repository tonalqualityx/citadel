import '@/app/globals.css';

export const metadata = {
  title: 'Indelible Portal',
  description: 'View and respond to proposals',
};

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface-secondary">
      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-lg font-semibold text-text-main">Indelible</h1>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-8">
        {children}
      </main>
      <footer className="border-t border-border bg-surface px-6 py-4 mt-auto">
        <div className="max-w-4xl mx-auto text-center text-sm text-text-tertiary">
          Powered by Indelible
        </div>
      </footer>
    </div>
  );
}
