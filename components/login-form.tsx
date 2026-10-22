"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const result = await signIn("credentials", {
      username: formData.get("username"),
      password: formData.get("password"),
      callbackUrl,
      redirect: false,
    });

    if (!result?.ok || !result.url) {
      setError("No se pudo iniciar sesión. Revisa tus credenciales e inténtalo de nuevo.");
      setIsSubmitting(false);
      return;
    }

    window.location.assign(result.url);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f8fafc] px-4 py-8 text-slate-900">
      <section className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-7 shadow-[0_18px_50px_-30px_rgba(15,39,79,0.36)] sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#174ea6] text-sm font-bold tracking-tight text-white">GB</span>
          <div>
            <p className="text-base font-semibold tracking-tight text-[#0f274f]">Gestor de Bases</p>
            <p className="text-xs text-slate-500">Acceso de administrador</p>
          </div>
        </div>

        <div className="mt-8">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Iniciar sesión</h1>
          <p className="mt-1 text-sm leading-6 text-slate-500">Introduce tus credenciales para continuar.</p>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="username">Usuario</label>
            <input
              autoComplete="username"
              className="mt-1.5 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#174ea6] focus:ring-2 focus:ring-blue-100"
              disabled={isSubmitting}
              id="username"
              maxLength={128}
              name="username"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="password">Contraseña</label>
            <input
              autoComplete="current-password"
              className="mt-1.5 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#174ea6] focus:ring-2 focus:ring-blue-100"
              disabled={isSubmitting}
              id="password"
              maxLength={1024}
              name="password"
              required
              type="password"
            />
          </div>

          {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}

          <button
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#174ea6] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#123f87] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6] disabled:cursor-wait disabled:opacity-70"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Verificando…" : "Ingresar"}
          </button>
        </form>
      </section>
    </main>
  );
}
