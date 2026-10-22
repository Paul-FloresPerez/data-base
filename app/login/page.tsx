import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getSafeCallbackPath } from "@/lib/auth/access-control";
import { getAdminSession } from "@/lib/server/require-admin";

export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await getAdminSession();

  if (session?.user) {
    redirect("/");
  }

  const { callbackUrl } = await searchParams;

  return <LoginForm callbackUrl={getSafeCallbackPath(callbackUrl)} />;
}
