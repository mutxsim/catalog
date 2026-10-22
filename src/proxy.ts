import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const CUSTOMER_COOKIE = "catalog_session";

/**
 * Optimistic checks only. Every customer page/API validates the session in the
 * database, and every admin page/action verifies the admin role on the server.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Customer catalog: no session cookie at all → straight to the login screen.
  if (!path.startsWith("/admin")) {
    if (!request.cookies.get(CUSTOMER_COOKIE)?.value) {
      const login = request.nextUrl.clone();
      login.pathname = "/login";
      login.search = "";
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  // Admin: refresh the Supabase session cookie.
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && path !== "/admin/login") {
    const login = request.nextUrl.clone();
    login.pathname = "/admin/login";
    login.search = "";
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: [
    "/admin/:path*",
    // Customer pages (APIs, login, invoices and static files are excluded and checked separately).
    "/((?!login|api|_next|favicon.ico|robots.txt|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
