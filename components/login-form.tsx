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
    <main className="min-h-screen bg-[#f5f7fa] px-4 py-6 text-slate-900 sm:grid sm:place-items-center sm:p-8">
      <section className="mx-auto w-full max-w-[1024px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_60px_rgba(16,27,47,0.08)] sm:grid sm:min-h-[580px] sm:grid-cols-[minmax(300px,0.9fr)_minmax(380px,1.1fr)]">
        <div className="border-b border-[#29415f] bg-[#101b2f] px-7 py-9 text-white sm:border-b-0 sm:border-r sm:px-11 sm:py-12">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-blue-200">Data-base</p>
          <h1 className="mt-6 max-w-xs text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">Operaciones con bases, bajo control.</h1>
          <p className="mt-5 max-w-sm text-sm leading-6 text-slate-300">Acceso privado para preparar, revisar y exportar decisiones comerciales con trazabilidad.</p>
          <p className="mt-12 hidden border-t border-[#29415f] pt-5 text-xs leading-5 text-slate-400 sm:block">Las sesiones y rutas privadas están protegidas. Los estados comerciales se conservan con su procedencia.</p>
        </div>

        <div className="px-7 py-9 sm:px-12 sm:py-12">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#2457a7]">Acceso de administrador</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#101b2f]">Iniciar sesión</h2>
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
