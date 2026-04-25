import RegisterFormClient from "./RegisterFormClient";
import LocaleSwitcher from "@/components/LocaleSwitcher";

export default function RegisterPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-6">
      <div className="absolute top-8 right-8">
        <LocaleSwitcher />
      </div>
      <RegisterFormClient />
    </main>
  );
}
