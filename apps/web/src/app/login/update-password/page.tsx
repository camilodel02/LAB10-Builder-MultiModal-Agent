import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UpdatePasswordForm } from "./update-password-form";

export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=recovery_session");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Nueva contraseña
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Elige una contraseña nueva para tu cuenta.
          </p>
        </div>
        <UpdatePasswordForm />
        <p className="text-center text-sm text-neutral-500">
          <Link href="/login" className="text-blue-600 hover:underline">
            Ir al inicio de sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
