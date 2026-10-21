import { redirect } from 'next/navigation';

// /portal is no longer a page of its own. Everyone lands on Home, where "Needs from you" holds the
// pending items (articles included). Old links and bookmarks to /portal keep working.
export default function PortalIndexPage() {
  redirect('/portal/home');
}
