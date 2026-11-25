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
  return NextResponse.redirect(new URL('/login?error=auth', url.origin));
}

/** True when the session came from a password-recovery link (the JWT's `amr` lists method "recovery"). */
function isRecovery(token: string | undefined): boolean {
  try {
    const payload = JSON.parse(Buffer.from((token ?? '').split('.')[1] ?? '', 'base64url').toString()) as { amr?: { method?: string }[] };
    return !!payload.amr?.some((a) => a.method === 'recovery');
  } catch { return false; }
}
