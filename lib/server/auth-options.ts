import "server-only";

import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getAuthSecret } from "@/lib/auth/auth-secret";
import { sessionTokenCookieName, sessionTokenCookieOptions } from "@/lib/auth/constants";
import { verifyAdminCredentials } from "@/lib/server/admin-credentials";
import {
  clearLoginAttempts,
  isLoginAllowed,
  recordFailedLogin,
} from "@/lib/server/login-rate-limit";

function getLoginAttemptKey(username: string) {
  return username.toLowerCase();
}

export const authOptions: AuthOptions = {
  secret: getAuthSecret(),
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
  cookies: {
    sessionToken: {
      name: sessionTokenCookieName,
      options: sessionTokenCookieOptions,
    },
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }

      return session;
    },
    redirect({ url, baseUrl }) {
      if (url.startsWith(baseUrl)) {
        return url;
      }

      if (url.startsWith("/") && !url.startsWith("//")) {
        return `${baseUrl}${url}`;
      }

      return baseUrl;
    },
  },
  providers: [
    CredentialsProvider({
      name: "Administrador",
      credentials: {
        username: { label: "Usuario", type: "text" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        const username = credentials?.username?.trim();
        const password = credentials?.password;

        if (!username || !password || username.length > 128 || password.length > 1_024) {
          return null;
        }

        const attemptKey = getLoginAttemptKey(username);

        if (!isLoginAllowed(attemptKey)) {
          return null;
        }

        const user = await verifyAdminCredentials(username, password);

        if (!user) {
          recordFailedLogin(attemptKey);
          return null;
        }

        clearLoginAttempts(attemptKey);

        return {
          id: user.id,
          name: user.username,
        };
      },
    }),
  ],
};
