// Scope Computer V1 caps a turn's vocab at this many items (mastery-prioritized when
// exceeded). The picker/banner warn past it so parents know a big scope gets sampled.
export const SCOPE_SOFT_CAP = 100;

// Input-size guards — UX-side mirrors of backend config.toml [limits], which is
// authoritative (the backend rejects oversized input regardless). Keep in sync.
export const CHAT_TEXT_MAX_CHARS = 500;
export const CHAT_RECORDING_MAX_SECONDS = 60;
export const INGEST_TEXT_MAX_CHARS = 10000;
export const INGEST_MAX_IMAGES = 5;
export const INGEST_IMAGE_MAX_MB = 10;
export const INGEST_RECORDING_MAX_SECONDS = 120;

export const LEVEL_PRESETS = [
  // Textbook defaults & hierarchy presets
  "教材",
  "单元",
  "课次",
  "小节",
  "知识点",
  "册次",
  "级别",
  "分类",
  // Standardized exam presets
  "考试",
  "科目",
  "模块",
  "题型",
  "专项",
  "任务",
  "分级",
];
