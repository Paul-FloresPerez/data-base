export const LOGIN_PATH = "/login";
export const LOGOUT_REDIRECT_PATH = LOGIN_PATH;

export const sessionTokenCookieName =
  process.env.NODE_ENV === "production"
    ? "__Secure-gestor-bases.session-token"
    : "gestor-bases.session-token";

export const sessionTokenCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};
