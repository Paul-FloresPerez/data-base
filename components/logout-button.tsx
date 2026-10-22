"use client";

import { signOut } from "next-auth/react";
import { LOGOUT_REDIRECT_PATH } from "@/lib/auth/constants";

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: LOGOUT_REDIRECT_PATH })}
      className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]"
    >
      Cerrar sesión
    </button>
  );
}
