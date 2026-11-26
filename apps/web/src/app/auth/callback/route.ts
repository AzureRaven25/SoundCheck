import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/** Email confirmation / magic-link / OAuth landing: exchange the PKCE code for a session cookie. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  if (code) {
    const sb = await supabaseServer();
    const { data, error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) {
      // a password-reset link signs you in with method "recovery": go choose the new password
      if (isRecovery(data.session?.access_token)) return NextResponse.redirect(new URL('/reset-password', url.origin));
      return NextResponse.redirect(new URL(safeNext, url.origin));
    }
  }
  // No code (an older-format link carries the session after '#', which only the browser can read), or the code
  // was expired/used: finish in the browser. Redirects keep the '#…' part, so /auth/confirm still receives it.
  const confirm = new URL('/auth/confirm', url.origin);
  confirm.searchParams.set('next', safeNext);
  if (code) confirm.searchParams.set('error', 'expired');
  const err = url.searchParams.get('error_description');
  if (err) confirm.searchParams.set('error', err.slice(0, 200));
  return NextResponse.redirect(confirm);
}

/** True when the session came from a password-recovery link (the JWT's `amr` lists method "recovery"). */
function isRecovery(token: string | undefined): boolean {
  try {
    const payload = JSON.parse(Buffer.from((token ?? '').split('.')[1] ?? '', 'base64url').toString()) as { amr?: { method?: string }[] };
    return !!payload.amr?.some((a) => a.method === 'recovery');
  } catch { return false; }
}
