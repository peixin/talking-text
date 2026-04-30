"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import { Message } from "./actions";

interface Props {
  messages: Message[];
}

export function MessageListClient({ messages }: Props) {
  const t = useTranslations("Chat");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-center text-sm">{t("no_chat")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      {messages.map((m, i) => (
        <div
          key={i}
          className={
            m.role === "user"
              ? "self-end max-w-[75%] rounded-2xl bg-primary px-4 py-2 text-primary-foreground"
              : "self-start max-w-[75%] rounded-2xl bg-muted px-4 py-2"
          }
        >
          {m.text}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
