import { Button } from "@/components/ui/button";

import { login } from "./actions";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form action={login} className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="mb-2 text-2xl font-semibold">登录</h1>
        <input
          name="email"
          type="email"
          placeholder="邮箱"
          required
          className="border-input bg-background focus:ring-ring rounded-lg border px-3 py-2 text-sm transition outline-none focus:ring-2"
        />
        <input
          name="password"
          type="password"
          placeholder="密码"
          required
          className="border-input bg-background focus:ring-ring rounded-lg border px-3 py-2 text-sm transition outline-none focus:ring-2"
        />
        <Button type="submit">登录</Button>
      </form>
    </main>
  );
}
