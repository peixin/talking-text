"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { LearnerOut, SyncPersonaBody } from "@/lib/backend";

interface Props {
  initial: Pick<LearnerOut, "ai_name" | "ai_gender" | "ai_persona_prompt">;
  onSync: (body: SyncPersonaBody) => Promise<LearnerOut>;
}

const DEFAULT_PROMPT =
  "You are Tina, a warm and patient English teacher chatting with an " +
  "elementary-school child in mainland China. Always respond in English. " +
  "Use simple, age-appropriate vocabulary and short sentences (≤ 15 words). " +
  "If the child speaks Chinese, gently re-phrase their idea in English and " +
  "invite them to repeat it. Stay encouraging; never correct mistakes " +
  "harshly. Each turn, ask exactly one short follow-up question to keep " +
  "the conversation going. She uses she/her pronouns.";

export function AIPersonaSettingsClient({ initial, onSync }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.ai_name);
  const [gender, setGender] = useState(initial.ai_gender);
  const [prompt, setPrompt] = useState(initial.ai_persona_prompt ?? DEFAULT_PROMPT);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Skip sync on initial mount — only fire when user actually edits.
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const updated = await onSync({
          ai_name: name,
          ai_gender: gender,
          ai_persona_prompt: prompt,
        });
        // Reflect whatever the LLM reconciled back into the fields
        setName(updated.ai_name);
        setGender(updated.ai_gender);
        setPrompt(updated.ai_persona_prompt ?? DEFAULT_PROMPT);
      });
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [name, gender, prompt, onSync]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between py-2 font-medium hover:bg-transparent focus-visible:outline-none">
        <span>AI Settings</span>
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {isPending ? (
            "Syncing…"
          ) : open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 pt-3">
        <div className="space-y-1.5">
          <Label htmlFor="ai-name">AI name</Label>
          <Input
            id="ai-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tina"
            className="max-w-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Gender</Label>
          <RadioGroup value={gender} onValueChange={setGender} className="flex gap-4">
            {(["female", "male", "neutral"] as const).map((g) => (
              <div key={g} className="flex items-center gap-1.5">
                <RadioGroupItem value={g} id={`gender-${g}`} />
                <Label
                  htmlFor={`gender-${g}`}
                  className="cursor-pointer font-normal capitalize"
                >
                  {g}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-prompt">Persona prompt</Label>
          <Textarea
            id="ai-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            className="resize-y text-sm"
          />
          <p className="text-muted-foreground text-xs">
            Changing name or gender above will automatically update this prompt via AI.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
