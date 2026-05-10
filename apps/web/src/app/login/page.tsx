import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/");

  const q = await searchParams;
  const recoverySessionError = q.error === "recovery_session";

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Ingresa a tu cuenta para acceder al agente.
          </p>
        </div>
        <LoginForm recoverySessionError={recoverySessionError} />
        <p className="text-center text-sm text-neutral-500">
          ¿No tienes cuenta?{" "}
          <a href="/signup" className="text-blue-600 hover:underline">
            Crear cuenta
          </a>
        </p>
        <p className="text-center text-sm">
          <a
            href="/login/forgot-password"
            className="text-blue-600 hover:underline"
          >
            Restablecer contraseña
          </a>
        </p>
      </div>
    </main>
  );
}
