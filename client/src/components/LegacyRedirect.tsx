/**
 * @file LegacyRedirect.tsx
 * @description Backward-compatible redirect for routes renamed in DualAgent Nexus v3
 * (`/kanban` to `/rooms`, `/workflows` to `/cascade-graph`, `/analytics` to `/quota-roi`).
 * Unlike a bare `<Navigate>`, it carries the query string and hash across, so deep links such as
 * `/analytics?tab=cost` or `/kanban?view=sessions` keep opening the same view, and it can pin
 * extra query parameters the new route needs.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { Navigate, useLocation } from "react-router";

/** Props for {@link LegacyRedirect}. */
interface LegacyRedirectProps {
  /** New pathname. */
  to: string;
  /** Query parameters to set on the target, overriding any carried-over value. */
  params?: Record<string, string>;
}

/**
 * Replace the current history entry with the renamed route, keeping search and hash.
 *
 * @param props - See {@link LegacyRedirectProps}.
 * @returns A `<Navigate replace>` element.
 */
export function LegacyRedirect({ to, params }: LegacyRedirectProps) {
  const { search, hash } = useLocation();
  const query = new URLSearchParams(search);
  for (const [key, value] of Object.entries(params ?? {})) query.set(key, value);
  const qs = query.toString();
  return <Navigate replace to={{ pathname: to, search: qs ? `?${qs}` : "", hash }} />;
}
