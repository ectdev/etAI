import { documentTypes, listDocuments } from '@etai/core/dashboard';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { DocumentList } from '@/components/dashboard/document-list';
import { requireRoleForPage } from '@/lib/session';

export const metadata = { title: 'Documents' };

/** Read every request, so a document indexed a moment ago is in the list. */
export const dynamic = 'force-dynamic';

/**
 * The indexed corpus, which is the other half of what the dashboard is for.
 *
 * Seeing what is indexed and watching ingestion happen are two different questions: a run says what happened at a moment, and this says
 * what is in the index now, including a document that was written by a run three weeks ago
 * and has since lost its embedding.
 */
export default async function DocumentsPage() {
  const session = await requireRoleForPage(['admin'], '/dashboard/documents');

  const documents = await listDocuments();

  return (
    <AppShell
      title="Dashboard, documents"
      user={{ email: session.user.email, role: session.user.role ?? 'admin' }}
      showDashboard
    >
      <div className="et-dash">
        <div className="et-dash-inner">
          <div className="et-dash-head">
            <h3>Documents</h3>
            <p className="text-muted">
              Everything in the index, with what was derived from it.{' '}
              <Link href="/dashboard">Back to the overview</Link>.
            </p>
          </div>

          {documents.length === 0 ? (
            <div className="et-dash-empty">
              <div className="et-dash-empty-title">Nothing has been indexed yet</div>
              <p className="text-muted">
                Run <code>pnpm ingest --write</code> to read the corpus. It takes about ninety
                seconds the first time and under a second afterwards.
              </p>
            </div>
          ) : (
            <DocumentList documents={documents} types={documentTypes(documents)} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
