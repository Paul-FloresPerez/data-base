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
    <main className="min-h-screen bg-[#f7f8fa] px-4 py-6 text-slate-900 sm:grid sm:place-items-center sm:p-8">
      <section className="mx-auto w-full max-w-[980px] overflow-hidden border border-slate-200 bg-white sm:grid sm:min-h-[560px] sm:grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.1fr)]">
        <div className="border-b border-slate-200 bg-[#10234a] px-7 py-8 text-white sm:border-b-0 sm:border-r sm:border-slate-800 sm:px-10 sm:py-11">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-200">Data-base</p>
          <h1 className="mt-5 max-w-xs text-2xl font-semibold tracking-tight sm:text-3xl">Gestión de bases comerciales.</h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-slate-300">Acceso privado para preparar, revisar y exportar bases de trabajo con trazabilidad.</p>
          <p className="mt-10 hidden border-t border-slate-700 pt-4 text-xs leading-5 text-slate-400 sm:block">Las sesiones están protegidas. Los datos se procesan bajo tu cuenta de administrador.</p>
        </div>

        <div className="px-7 py-8 sm:px-10 sm:py-11">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#174ea6]">Acceso de administrador</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#10234a]">Iniciar sesión</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Introduce tus credenciales para continuar.</p>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
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

          {error ? <p className="border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800" role="alert">{error}</p> : null}

          <button
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[#174ea6] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#123f87] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6] disabled:cursor-wait disabled:opacity-70"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Verificando…" : "Ingresar"}
          </button>
        </form>
        <p className="mt-7 text-xs leading-5 text-slate-500">Acceso restringido a usuarios autorizados.</p>
        </div>
      </section>
    </main>
  );
}
