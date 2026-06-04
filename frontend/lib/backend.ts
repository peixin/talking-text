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
  cefr_level: string | null;
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

// Free-form label. A few known values (textbook_book / textbook_unit /
// textbook_lesson / personal_collection / quick_practice / review_set) still
// carry localized labels and icons, but any string the parent or LLM picks is
// accepted by the backend.
export type GroupKind = string;

export type GroupOut = {
  id: string;
  name: string;
  kind: GroupKind;
  parent_id: string | null;
  archived: boolean;
  source_book_hint: string | null;
  item_count: number;
  level_title: string | null;
};

export type ItemType = "word" | "phrase" | "pattern";
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type Confidence = "high" | "medium" | "low";
export type SourceType =
  | "textbook_page"
  | "worksheet"
  | "handwritten"
  | "flashcards"
  | "screenshot"
  | "other";

export type ExtractedItem = {
  text: string;
  type: ItemType;
  anchor: string | null;
  cefr: CefrLevel | null;
  pos: string | null;
  confidence: Confidence;
  note: string | null;
};

// Extraction is not a librarian: it suggests a name + CEFR only, never hierarchy
// placement. Structuring happens later in the organize workbench.
// See docs/content-lifecycle.md §4, §8.
export type ExtractedMetadata = {
  suggested_name: string | null;
  cefr_level: CefrLevel | null;
  confidence: Confidence;
  // The parent's own words about the material (context / requests), any language.
  // Steers extraction and is preserved as the group's prompt_notes — never extracted.
  parent_note: string | null;
};

export type IngestionResult = {
  source_type: SourceType;
  source_raw_text: string | null;
  metadata: ExtractedMetadata;
  items: ExtractedItem[];
  warnings: string[];
};

export type GroupCreateBody = {
  name: string;
  kind: GroupKind;
  parent_id?: string | null;
  prompt_notes?: string | null;
  source_book_hint?: string | null;
  items: Array<{
    text: string;
    type: ItemType;
    anchor?: string | null;
    cefr_level?: string | null;
    pos?: string | null;
  }>;
  // Organize-time tree assembly from human-confirmed exact tags (root → leaf).
  tag_path?: string[] | null;
  level_titles?: string[] | null;
  source_raw_text?: string | null;
  media_urls?: string[] | null;
};

/** Corresponds to ``GroupUpdate`` Pydantic model in backend/app/api/groups.py. */
export type GroupUpdateBody = {
  name?: string;
  archived?: boolean;
  parent_id?: string | null;
  kind?: string;
  source_book_hint?: string | null;
  prompt_notes?: string | null;
  items?: Array<{
    text: string;
    type: ItemType;
    anchor?: string | null;
    cefr_level?: string | null;
    pos?: string | null;
  }> | null;
  tag_path?: string[] | null;
  level_titles?: string[] | null;
  source_raw_text?: string | null;
  media_urls?: string[] | null;
};

export type LanguageItemOut = {
  id: string;
  type: ItemType;
  text: string;
  anchor: string;
  cefr_level: string | null;
  pos: string | null;
  source_group_name?: string | null;
  source_group_id?: string | null;
};

export type GroupDetailOut = {
  id: string;
  name: string;
  kind: GroupKind;
  parent_id: string | null;
  archived: boolean;
  source_book_hint: string | null;
  prompt_notes: string | null;
  level_title: string | null;
  items: LanguageItemOut[];
};

// ── Organize workbench (docs/content-lifecycle.md §4) ────────────────────────

// A capture bag is the UNIT of organizing — the whole bag is filed at once.
export type InboxBag = {
  group_id: string;
  name: string;
  items: LanguageItemOut[];
  level_title: string | null;
  ingestion_batch_id: string | null;
  source_raw_text: string | null;
  media_urls: string[];
};

export type InboxCandidate = { text: string; count: number };

export type InboxOut = {
  learner_id: string | null;
  capture_bags: InboxBag[];
  practice_candidates: InboxCandidate[];
};

export type SuggestBagOut = {
  tag_path: string[];
  level_titles?: string[] | null;
  source: "ai" | "default";
};
export type FileBagOut = { target_group_id: string; moved: number };

export type FileItemBody = {
  target_group_id: string;
  // Move an existing captured item:
  item_id?: string | null;
  source_group_id?: string | null;
  // Or file a practice candidate (lazily created):
  new_item?: {
    text: string;
    type: ItemType;
    anchor?: string | null;
    cefr_level?: string | null;
    pos?: string | null;
  } | null;
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
    logout: (headers?: HeadersInit) => request<void>("/auth/logout", { method: "POST", headers }),
    me: (headers?: HeadersInit) => request<AccountOut>("/auth/me", { headers }),
  },
  learners: {
    list: (headers?: HeadersInit) => request<LearnerOut[]>("/learners", { headers }),
    create: (name: string, cefrLevel?: string | null, headers?: HeadersInit) =>
      request<LearnerOut>("/learners", {
        method: "POST",
        body: { name, cefr_level: cefrLevel ?? null },
        headers,
      }),
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
  groups: {
    list: (includeArchived?: boolean, headers?: HeadersInit) =>
      request<GroupOut[]>(`/groups${includeArchived ? "?include_archived=true" : ""}`, { headers }),
    get: (id: string, recursive?: boolean, headers?: HeadersInit) =>
      request<GroupDetailOut>(`/groups/${id}${recursive ? "?recursive=true" : ""}`, { headers }),
    create: (body: GroupCreateBody, headers?: HeadersInit) =>
      request<GroupOut>("/groups", {
        method: "POST",
        body: body as unknown as Record<string, unknown>,
        headers,
      }),
    update: (id: string, body: GroupUpdateBody, headers?: HeadersInit) =>
      request<GroupOut>(`/groups/${id}`, {
        method: "PATCH",
        body: body as Record<string, unknown>,
        headers,
      }),
    delete: (id: string, headers?: HeadersInit) =>
      request<void>(`/groups/${id}`, { method: "DELETE", headers }),
    listLearners: (groupId: string, headers?: HeadersInit) =>
      request<{ learner_id: string; assigned_at: string }[]>(`/groups/${groupId}/learners`, {
        headers,
      }),
    assignLearner: (groupId: string, learnerId: string, headers?: HeadersInit) =>
      request<void>(`/groups/${groupId}/learners`, {
        method: "POST",
        body: { learner_id: learnerId },
        headers,
      }),
    unassignLearner: (groupId: string, learnerId: string, headers?: HeadersInit) =>
      request<void>(`/groups/${groupId}/learners/${learnerId}`, {
        method: "DELETE",
        headers,
      }),
  },
  ingest: {
    extract: (formData: FormData, headers?: HeadersInit) =>
      request<IngestionResult>("/ingest/extract", {
        method: "POST",
        body: formData,
        headers,
      }),
    transcribe: (formData: FormData, headers?: HeadersInit) =>
      request<{ text: string }>("/ingest/transcribe", {
        method: "POST",
        body: formData,
        headers,
      }),
  },
  organize: {
    inbox: (headers?: HeadersInit) => request<InboxOut>("/organize/inbox", { headers }),
    file: (body: FileItemBody, headers?: HeadersInit) =>
      request<LanguageItemOut>("/organize/file", {
        method: "POST",
        body: body as unknown as Record<string, unknown>,
        headers,
      }),
    dismiss: (groupId: string, itemId: string, headers?: HeadersInit) =>
      request<void>("/organize/dismiss", {
        method: "POST",
        body: { group_id: groupId, item_id: itemId },
        headers,
      }),
    suggestBag: (groupId: string, headers?: HeadersInit) =>
      request<SuggestBagOut>("/organize/suggest-bag", {
        method: "POST",
        body: { group_id: groupId },
        headers,
      }),
    fileBag: (
      sourceGroupId: string,
      tagPath: string[],
      levelTitles?: string[] | null,
      sourceRawText?: string | null,
      headers?: HeadersInit,
    ) =>
      request<FileBagOut>("/organize/file-bag", {
        method: "POST",
        body: {
          source_group_id: sourceGroupId,
          tag_path: tagPath,
          level_titles: levelTitles ?? null,
          source_raw_text: sourceRawText ?? null,
        },
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
