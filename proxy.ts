import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getAccessDecision } from "@/lib/auth/access-control";
import { sessionTokenCookieName } from "@/lib/auth/constants";

export async function proxy(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: sessionTokenCookieName,
  });
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
