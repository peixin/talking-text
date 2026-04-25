"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { type RegisterState, register } from "./actions";

export default function RegisterFormClient() {
  const [state, action, isPending] = useActionState<RegisterState, FormData>(register, null);

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="mb-2 text-2xl font-semibold">注册</h1>

      {state?.error && (
        <p className="text-destructive rounded-md bg-destructive/10 px-3 py-2 text-sm">
          {state.error}
        </p>
      )}

      <input
        name="name"
        type="text"
        placeholder="你的名字"
        required
        className="border-input bg-background focus:ring-ring rounded-lg border px-3 py-2 text-sm transition outline-none focus:ring-2"
      />
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
        placeholder="密码（至少 8 位）"
        required
        minLength={8}
        className="border-input bg-background focus:ring-ring rounded-lg border px-3 py-2 text-sm transition outline-none focus:ring-2"
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? "注册中..." : "注册"}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        已有账号？{" "}
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          登录
        </Link>
      </p>
    </form>
  );
}
