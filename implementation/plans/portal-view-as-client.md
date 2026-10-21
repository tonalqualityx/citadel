# Feature: Portal "View as client" (admin, read-only)

Mike, 2026-10-21: "as a logged in admin, I'd love to be able to see any client's portal from their view."

## Design (decided)
- Admin opens a client record, picks a role (owner default, member, viewer) and clicks "View portal as <client>".
- `POST /api/clients/:id/view-as` (admin only, browser session only) writes an ActivityLog row on the client
  (`view_as_started`), then mints a `portal_sessions` row (`token_type=client_session`, `action=view_as`,
  metadata `{view_as, admin_user_id, role}`), 30 minutes, set as the normal `client_session` cookie.
- `requireClientAuth` returns the pinned client, the role from the row and `viewAs`. No sliding, no switching,
  dead 30 minutes after creation whatever `expires_at` says, dead when the admin is no longer an active admin.
- Every write route (POST/PATCH/PUT/DELETE) under `app/api/portal` and `app/api/portal-chat` calls
  `refuseIfViewAs()` first: 403 + "This is a read-only view. Nothing was sent or changed." Fails closed.
- Portal shell shows a sticky banner "Viewing as <Client> (<Role>). Read-only." + Exit view on every page.
  `PortalButton writes` switches off Approve/Send/Save with the read-only line; composers are read-only; presence
  pings and chat sends are skipped.
- Exit: `POST /api/portal-view-as/exit` (outside the guarded trees on purpose) revokes the view row, clears the cookie.

## Files
- New: `lib/portal/view-as.ts`, `view-as-guard.ts`, `view-as-copy.ts`, `app/api/clients/[id]/view-as/route.ts`,
  `app/api/portal-view-as/exit/route.ts`, `components/portal/view-as-banner.tsx`, `view-as-context.tsx`,
  `components/domain/clients/view-as-portal-button.tsx`.
- Changed: `lib/services/client-auth.ts`, `components/portal/shell/portal-shell.tsx`, `client-switcher.tsx`,
  `ui/button.tsx`, write buttons across portal pages, 28 write routes, registry (clients, portal).

## Tests
- `lib/portal/__tests__/view-as-routes.test.ts`: write routes derived from the filesystem; each must call the guard
  first and answer 403 touching nothing else. Fails when a new write route lacks the guard.
- `lib/portal/__tests__/view-as.test.ts`: start/audit order, 30 minute cap, no slide, admin revalidation, start and exit routes.
- `components/portal/__tests__/view-as.test.tsx`: banner, Exit view, disabled writes.
- Existing route tests stub the guard as a pass-through; copy scan covers `view-as-copy.ts` and the new components.
- Playwright `__tests__/e2e/portal-view-as.spec.ts`.

## Review follow-ups (auth review, 2026-10-21)
- Staff-only `/api/portal-chat` routes (settings, sweep, inbound, inbound/attachments) are not guarded; an allowlist in
  `view-as-routes.test.ts` pins them and fails if one reads the portal session.
- The admin's own live portal login is set aside in `client_session_stash` (httpOnly, path /api/portal-view-as, 30 min)
  and restored on exit.
- Last five views (who, role, when) show under the button via `/api/activities?entity_type=client&action=view_as_started`.
- Token-page sign/respond buttons use `writes`; the book page shows the read-only line instead of the widget.
- The route test also scans every `app/api/**/route.ts` that reads the portal session.
