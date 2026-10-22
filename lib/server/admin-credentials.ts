import "server-only";

import { prisma } from "@/lib/server/prisma";
import { verifyPasswordHash } from "@/lib/server/password-hash";

export type AuthenticatedUser = {
  id: string;
  username: string;
};

export async function verifyAdminCredentials(
  username: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const normalizedUsername = username.toLowerCase();
  const user = await prisma.usuario.findUnique({
    where: { username: normalizedUsername },
    select: {
      id: true,
      username: true,
      passwordHash: true,
      activo: true,
    },
  });

  if (!user?.activo || !(await verifyPasswordHash(password, user.passwordHash))) {
    return null;
  }

  return { id: user.id, username: user.username };
}
