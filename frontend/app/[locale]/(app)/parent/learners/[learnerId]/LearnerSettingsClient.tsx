"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AIPersonaSettingsClient } from "@/components/AIPersonaSettingsClient";
import { Link } from "@/i18n/routing";
import type { SyncPersonaBody } from "@/lib/backend";
import { syncPersona } from "./actions";

interface Props {
  learnerId: string;
  learnerName: string;
  aiName: string;
  aiGender: string;
  aiPersonaPrompt: string | null;
}

export function LearnerSettingsClient({
  learnerId,
  learnerName,
  aiName,
  aiGender,
  aiPersonaPrompt,
}: Props) {
  const router = useRouter();

  const handleStartPractice = () => {
    router.push("/chat");
  };

  const handleSyncPersona = useCallback(
    (body: SyncPersonaBody) => syncPersona(learnerId, body),
    [learnerId],
  );

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 px-4 py-8">
      <div className="mb-2 flex items-center gap-4">
        <Link
          href="/parent"
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          ← 家长中心
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{learnerName}</h1>
        <Button onClick={handleStartPractice}>Start Practice →</Button>
      </div>

      <Separator />

      <div className="space-y-3">
        <h2 className="font-medium">Materials</h2>
        <p className="text-muted-foreground text-sm">
          Material ingestion is coming soon. For now, chats run in free-practice mode.
        </p>
      </div>

      <Separator />

      <AIPersonaSettingsClient
        initial={{ ai_name: aiName, ai_gender: aiGender, ai_persona_prompt: aiPersonaPrompt }}
        onSync={handleSyncPersona}
      />
    </div>
  );
}
