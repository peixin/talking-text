import LoginFormClient from "./LoginFormClient";
import LocaleSwitcher from "@/components/LocaleSwitcher";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-6">
      <div className="absolute top-8 right-8">
        <LocaleSwitcher />
      </div>
      <LoginFormClient />
    </main>
  );
}
