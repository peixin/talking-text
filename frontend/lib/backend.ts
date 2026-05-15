import "server-only";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8010";

type FetchOptions = Omit<RequestInit, "body"> & {
  body?: Record<string, unknown> | BodyInit;
};

export class BackendError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`Backend ${status}: ${detail}`);
  }
}

async function requestRaw(
  path: string,
  options: Pick<RequestInit, "headers" | "method"> = {},
): Promise<{ data: ArrayBuffer; contentType: string }> {
  const res = await fetch(`${BACKEND_URL}${path}`, options);
  if (!res.ok) {
    let detail = await res.text();
    try {
      detail = JSON.parse(detail)?.detail ?? detail;
    } catch {
      // keep raw text
    }
    throw new BackendError(res.status, detail);
  }
  return { data: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "" };
}

async function request<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;

  // For FormData, let fetch pick the multipart boundary itself; setting
  // Content-Type explicitly here would corrupt the upload.
  const isFormData = body instanceof FormData;

  const init: RequestInit = {
    ...rest,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
  };

  if (body !== undefined) {
    init.body =
      body instanceof FormData || typeof body === "string" || body instanceof URLSearchParams
        ? (body as BodyInit)
        : JSON.stringify(body);
  }

  const res = await fetch(`${BACKEND_URL}${path}`, init);
  if (!res.ok) {
    let detail = await res.text();
    try {
      detail = JSON.parse(detail)?.detail ?? detail;
    } catch {
      // keep raw text
    }
    throw new BackendError(res.status, detail);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export type AccountOut = {
  id: string;
  name: string;
  last_active_learner_id?: string;
  session_token?: string;
};
export type LearnerOut = {
  id: string;
  name: string;
  ai_name: string;
  ai_gender: string;
  ai_persona_prompt: string | null;
};

export type UpdatePersonaBody = {
  ai_name?: string;
  ai_gender?: string;
  ai_persona_prompt?: string | null;
};

export type SyncPersonaBody = {
  ai_name: string;
  ai_gender: string;
  ai_persona_prompt: string;
};
export type TurnResponse = {
  turn_id: string;
  text_user: string;
  text_ai: string;
  audio_b64: string | null; // null in text mode
  audio_format: string | null; // null in text mode
  session_title: string | null;
  session_status: string; // "active" | "soft_limit"
};
export type SessionOut = {
  id: string;
  learner_id: string;
  group_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
};
export type TurnOut = {
  id: string;
  text_user: string;
  text_ai: string;
  created_at: string;
};

export const backend = {
  health: () => request<{ status: string }>("/health"),
  auth: {
    register: (name: string, email: string, password: string, headers?: HeadersInit) =>
      request<AccountOut>("/auth/register", {
        method: "POST",
        body: { name, email, password },
        headers,
      }),
    login: (email: string, password: string, headers?: HeadersInit) =>
      request<AccountOut>("/auth/login", {
        method: "POST",
        body: { email, password },
        headers,
      }),
    logout: (headers?: HeadersInit) =>
      request<void>("/auth/logout", { method: "POST", headers }),
    me: (headers?: HeadersInit) => request<AccountOut>("/auth/me", { headers }),
  },
  learners: {
    list: (headers?: HeadersInit) => request<LearnerOut[]>("/learners", { headers }),
    create: (name: string, headers?: HeadersInit) =>
      request<LearnerOut>("/learners", { method: "POST", body: { name }, headers }),
    update: (id: string, name: string, headers?: HeadersInit) =>
      request<LearnerOut>(`/learners/${id}`, { method: "PUT", body: { name }, headers }),
    delete: (id: string, headers?: HeadersInit) =>
      request<void>(`/learners/${id}`, { method: "DELETE", headers }),
    setActive: (id: string, headers?: HeadersInit) =>
      request<LearnerOut>(`/learners/${id}/active`, { method: "PUT", headers }),
    updatePersona: (id: string, body: UpdatePersonaBody, headers?: HeadersInit) =>
      request<LearnerOut>(`/learners/${id}/persona`, {
        method: "PATCH",
        body: body as Record<string, unknown>,
        headers,
      }),
    syncPersona: (id: string, body: SyncPersonaBody, headers?: HeadersInit) =>
      request<LearnerOut>(`/learners/${id}/persona/sync`, {
        method: "POST",
        body: body as Record<string, unknown>,
        headers,
      }),
  },
  sessions: {
    list: (learnerId: string, headers?: HeadersInit) =>
      request<SessionOut[]>(`/sessions?learner_id=${learnerId}`, { headers }),
    create: (learnerId: string, groupId?: string | null, headers?: HeadersInit) =>
      request<SessionOut>("/sessions", {
        method: "POST",
        body: { learner_id: learnerId, group_id: groupId ?? null },
        headers,
      }),
    rename: (id: string, title: string, headers?: HeadersInit) =>
      request<SessionOut>(`/sessions/${id}`, {
        method: "PATCH",
        body: { title },
        headers,
      }),
    setGroup: (sessionId: string, groupId: string | null, headers?: HeadersInit) =>
      request<SessionOut>(`/sessions/${sessionId}`, {
        method: "PATCH",
        body: { group_id: groupId },
        headers,
      }),
    delete: (id: string, headers?: HeadersInit) =>
      request<void>(`/sessions/${id}`, { method: "DELETE", headers }),
    turns: (id: string, headers?: HeadersInit) =>
      request<TurnOut[]>(`/sessions/${id}/turns`, { headers }),
    getTurnAudio: (sessionId: string, turnId: string, dir: "in" | "out", headers?: HeadersInit) =>
      requestRaw(`/sessions/${sessionId}/turns/${turnId}/audio?dir=${dir}`, { headers }),
    sendTurn: (sessionId: string, formData: FormData, headers?: HeadersInit) =>
      request<TurnResponse>(`/sessions/${sessionId}/turns`, {
        method: "POST",
        body: formData,
        headers,
      }),
  },
};
