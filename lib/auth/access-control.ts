import { LOGIN_PATH } from "./constants.ts";

export type AccessDecision =
  | { type: "allow" }
  | { type: "redirect"; location: string }
  | { type: "unauthorized" };

export function getAccessDecision({
  isAuthenticated,
  pathname,
  search = "",
}: {
  isAuthenticated: boolean;
  pathname: string;
  search?: string;
}): AccessDecision {
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isLoginPage = pathname === LOGIN_PATH;

  if (isAuthRoute) {
    return { type: "allow" };
  }

  if (isLoginPage) {
    return isAuthenticated ? { type: "redirect", location: "/" } : { type: "allow" };
  }

  if (isAuthenticated) {
    return { type: "allow" };
  }

  if (pathname.startsWith("/api/")) {
    return { type: "unauthorized" };
  }

  return {
    type: "redirect",
    location: `${LOGIN_PATH}?callbackUrl=${encodeURIComponent(`${pathname}${search}`)}`,
  };
}

export function getSafeCallbackPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}
