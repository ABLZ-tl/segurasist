import { redirect } from 'next/navigation';

/**
 * Cognito redirects back to /api/auth/callback (route handler) which sets
 * the cookies and 302s here. We just bounce to the dashboard or to `next`.
 */
export default function CallbackPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  redirect(searchParams.next ?? '/dashboard');
}
