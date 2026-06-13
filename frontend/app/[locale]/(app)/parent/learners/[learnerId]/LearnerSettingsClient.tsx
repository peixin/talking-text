"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AIPersonaSettingsClient } from "@/components/AIPersonaSettingsClient";
import { Link } from "@/i18n/routing";
import type { CorrectionLevel, SyncPersonaBody } from "@/lib/backend";
import { setCorrectionLevel, syncPersona } from "./actions";

const CORRECTION_LEVELS: CorrectionLevel[] = ["gentle", "strict", "native"];

interface Props {
  learnerId: string;
  learnerName: string;
  aiName: string;
  aiGender: string;
  aiPersonaPrompt: string | null;
  correctionLevel: CorrectionLevel;
}

export function LearnerSettingsClient({
  learnerId,
  learnerName,
  aiName,
  aiGender,
  aiPersonaPrompt,
  correctionLevel,
}: Props) {
  const router = useRouter();
  const t = useTranslations("Learners");
  const [level, setLevel] = useState<CorrectionLevel>(correctionLevel);
  const [savingLevel, setSavingLevel] = useState(false);

  const handleStartPractice = () => {
    router.push("/chat");
  };

  const handleSyncPersona = useCallback(
    (body: SyncPersonaBody) => syncPersona(learnerId, body),
    [learnerId],
  );

  async function handleSelectLevel(next: CorrectionLevel) {
    if (next === level || savingLevel) return;
    const previous = level;
    setLevel(next);
    setSavingLevel(true);
    try {
      await setCorrectionLevel(learnerId, next);
    } catch {
      setLevel(previous);
    } finally {
      setSavingLevel(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 px-4 py-8">
      <div className="mb-2 flex items-center gap-4">
        <Link
          href="/parent"
          className="text-muted-foreground hover:text-primary text-sm transition"
        >
          ← {t("back_to_parent")}
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{learnerName}</h1>
        <Button onClick={handleStartPractice}>Start Practice →</Button>
      </div>

      <Separator />

      <div className="space-y-3">
        <div>
          <h2 className="font-medium">{t("correction_title")}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("correction_desc")}</p>
        </div>
        <div className="grid gap-2">
          {CORRECTION_LEVELS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => handleSelectLevel(option)}
              disabled={savingLevel}
              aria-pressed={level === option}
              className={
                "rounded-xl border p-3 text-left transition disabled:opacity-60 " +
                (level === option
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50")
              }
            >
              <div className="text-sm font-medium">{t(`correction_${option}`)}</div>
              <div className="text-muted-foreground mt-0.5 text-xs">
                {t(`correction_${option}_desc`)}
              </div>
            </button>
          ))}
        </div>
      </div>

      <Separator />

      <AIPersonaSettingsClient
        initial={{ ai_name: aiName, ai_gender: aiGender, ai_persona_prompt: aiPersonaPrompt }}
        onSync={handleSyncPersona}
      />
    </div>
  );
}
