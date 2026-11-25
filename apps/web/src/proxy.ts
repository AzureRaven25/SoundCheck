import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Refreshes the Supabase session cookie on every navigation and guards signed-in-only areas. */
export async function proxy(request: NextRequest) {
  // Email links (sign-up confirmation, password reset) can land on any page with ?code= when Supabase falls back
  // to the site URL: finish signing in at /auth/callback, keeping where the link was headed.
  const code = request.nextUrl.searchParams.get('code');
  if (code && request.nextUrl.pathname !== '/auth/callback' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)   /* Supabase auth codes (TV pairing codes are 6 letters) */) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    url.search = '';
    url.searchParams.set('code', code);
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );
  // getUser() validates the JWT with Supabase Auth (getSession() would trust the cookie blindly).
  const { data: { user } } = await supabase.auth.getUser();

  const protectedPaths = ['/library', '/settings', '/playlist/new'];
  if (!user && protectedPaths.some((p) => request.nextUrl.pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
