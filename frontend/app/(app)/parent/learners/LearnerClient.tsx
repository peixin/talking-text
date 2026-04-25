"use client";

import { useState } from "react";
import { LearnerOut } from "@/lib/backend";
import { createLearner, deleteLearner, updateLearner } from "./actions";

export function LearnerClient({ learners }: { learners: LearnerOut[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await createLearner(new FormData(e.currentTarget));
    if (res.error) {
      setError(res.error);
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
      setError(res.error);
    } else {
      setEditingId(null);
    }
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("确定要删除吗？")) return;
    setLoading(true);
    const res = await deleteLearner(id);
    if (res.error) {
      setError(res.error);
    }
    setLoading(false);
  }

  return (
    <div>
      {error && <div className="mb-4 text-red-500 text-sm">{error}</div>}
      
      <form onSubmit={handleCreate} className="mb-8 flex gap-2">
        <input 
          type="text" 
          name="name" 
          placeholder="输入孩子名字..." 
          className="border-border bg-background rounded border px-3 py-2 text-sm focus:outline-none"
          required
        />
        <button 
          type="submit" 
          disabled={loading}
          className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          添加孩子
        </button>
      </form>

      {learners.length === 0 ? (
        <div className="text-muted-foreground text-sm">暂无孩子，请先添加。</div>
      ) : (
        <div className="space-y-4">
          {learners.map((l) => (
            <div key={l.id} className="border-border flex items-center justify-between rounded border p-4">
              {editingId === l.id ? (
                <form onSubmit={(e) => handleUpdate(e, l.id)} className="flex flex-1 items-center gap-2">
                  <input 
                    type="text" 
                    name="name" 
                    defaultValue={l.name} 
                    className="border-border bg-background flex-1 rounded border px-3 py-1 text-sm focus:outline-none"
                    required
                  />
                  <button type="submit" disabled={loading} className="text-sm text-green-600 hover:underline">保存</button>
                  <button type="button" onClick={() => setEditingId(null)} className="text-muted-foreground text-sm hover:underline">取消</button>
                </form>
              ) : (
                <>
                  <span className="font-medium">{l.name}</span>
                  <div className="flex gap-3 text-sm">
                    <button onClick={() => setEditingId(l.id)} className="text-blue-500 hover:underline">编辑</button>
                    <button onClick={() => handleDelete(l.id)} disabled={loading} className="text-red-500 hover:underline disabled:opacity-50">删除</button>
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
