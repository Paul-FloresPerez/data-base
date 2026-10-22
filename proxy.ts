import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getAccessDecision } from "@/lib/auth/access-control";
import { getAuthSecret } from "@/lib/auth/auth-secret";
import { sessionTokenCookieName } from "@/lib/auth/constants";

export async function proxy(request: NextRequest) {
  const authSecret = getAuthSecret();
  let token = null;

  if (authSecret) {
    try {
      token = await getToken({
        req: request,
        secret: authSecret,
        cookieName: sessionTokenCookieName,
      });
    } catch {
      // A malformed cookie or incomplete deployment configuration must never
      // allow access to a protected page or API route.
      token = null;
    }
  }

  const decision = getAccessDecision({
    isAuthenticated: Boolean(token?.sub),
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
  });

  if (decision.type === "allow") {
    return NextResponse.next();
  }

  if (decision.type === "unauthorized") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  return NextResponse.redirect(new URL(decision.location, request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
