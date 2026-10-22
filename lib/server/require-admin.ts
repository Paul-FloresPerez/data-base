import "server-only";

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getAuthSecret } from "@/lib/auth/auth-secret";
import { LOGIN_PATH } from "@/lib/auth/constants";
import { authOptions } from "@/lib/server/auth-options";
import { prisma } from "@/lib/server/prisma";

export async function getAdminSession() {
  // Auth.js throws a configuration page when no signing secret is present.
  // Treat that state as anonymous so private routes remain closed and /login
  // can render until the deployment environment is corrected.
  if (!getAuthSecret()) {
    return null;
  }

  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return null;
  }

  const user = await prisma.usuario.findUnique({
    where: { id: session.user.id },
    select: { activo: true },
  });

  return user?.activo ? session : null;
}

export async function requireAdminPage() {
  const session = await getAdminSession();

  if (!session?.user) {
    redirect(LOGIN_PATH);
  }

  return session;
}

export async function requireAdminApi() {
  const session = await getAdminSession();

  return session?.user ? session : null;
}
