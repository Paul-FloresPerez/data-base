import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/components/login-form";
import { getSafeCallbackPath } from "@/lib/auth/access-control";
import { getAdminSession } from "@/lib/server/require-admin";

export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  // Auth.js generates and verifies CSRF state from the current request.
  // Keep that work out of the Cache Components prerender pass.
  await connection();

  const session = await getAdminSession();

  if (session?.user) {
    redirect("/");
  }

  const { callbackUrl } = await searchParams;

  return <LoginForm callbackUrl={getSafeCallbackPath(callbackUrl)} />;
}
