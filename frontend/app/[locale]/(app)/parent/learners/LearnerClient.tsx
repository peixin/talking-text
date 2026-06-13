"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { LearnerOut } from "@/lib/backend";
import { createLearner, deleteLearner, updateLearner, setActiveLearner } from "./actions";

export function LearnerClient({
  learners,
  activeLearnerId,
}: {
  learners: LearnerOut[];
  activeLearnerId: string | null;
}) {
  const t = useTranslations("Learners");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentActiveId, setCurrentActiveId] = useState<string | null>(activeLearnerId);

  function translateError(code: string): string {
    const key = `errors.${code}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : code;
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await createLearner(new FormData(e.currentTarget));
    if (res.error) {
      setError(translateError(res.error));
    } else {
      (e.target as HTMLFormElement).reset();
    }
    setLoading(false);
  }

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await updateLearner(id, new FormData(e.currentTarget));
    if (res.error) {
      setError(translateError(res.error));
    } else {
      setEditingId(null);
    }
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm(t("confirm_delete"))) return;
    setLoading(true);
    const res = await deleteLearner(id);
    if (res.error) {
      setError(translateError(res.error));
    }
    setLoading(false);
  }

  async function handleSetActive(id: string) {
    setLoading(true);
    setError("");
    const res = await setActiveLearner(id);
    if (res.error) {
      setError(translateError(res.error));
    } else {
      setCurrentActiveId(id);
    }
    setLoading(false);
  }

  return (
    <div>
      {error && <div className="text-destructive mb-4 text-sm">{error}</div>}

      <form onSubmit={handleCreate} className="mb-8 flex gap-2">
        <input
          type="text"
          name="name"
          placeholder={t("name_placeholder")}
          className="border-border bg-background rounded border px-3 py-2 text-sm focus:outline-none"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {t("add_child")}
        </button>
      </form>

      {learners.length === 0 ? (
        <div className="text-muted-foreground text-sm">{t("no_children_hint")}</div>
      ) : (
        <div className="space-y-4">
          {learners.map((l) => (
            <div
              key={l.id}
              className={`border-border flex items-center justify-between rounded border p-4 transition ${
                l.id === currentActiveId ? "bg-primary/5 border-primary/30" : ""
              }`}
            >
              {editingId === l.id ? (
                <form
                  onSubmit={(e) => handleUpdate(e, l.id)}
                  className="flex flex-1 items-center gap-2"
                >
                  <input
                    type="text"
                    name="name"
                    defaultValue={l.name}
                    className="border-border bg-background flex-1 rounded border px-3 py-1 text-sm focus:outline-none"
                    required
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="text-success text-sm hover:underline"
                  >
                    {t("save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-muted-foreground text-sm hover:underline"
                  >
                    {t("cancel")}
                  </button>
                </form>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{l.name}</span>
                    {l.id === currentActiveId && (
                      <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-xs font-medium">
                        {t("current_badge")}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 text-sm">
                    {l.id !== currentActiveId && (
                      <button
                        onClick={() => handleSetActive(l.id)}
                        disabled={loading}
                        className="text-primary hover:underline disabled:opacity-50"
                      >
                        {t("switch_current")}
                      </button>
                    )}
                    <Link
                      href={`/parent/learners/${l.id}`}
                      className="text-primary hover:underline"
                    >
                      {t("persona_settings")}
                    </Link>
                    <button
                      onClick={() => setEditingId(l.id)}
                      className="text-primary hover:underline"
                    >
                      {t("edit")}
                    </button>
                    <button
                      onClick={() => handleDelete(l.id)}
                      disabled={loading}
                      className="text-destructive hover:underline disabled:opacity-50"
                    >
                      {t("delete")}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
