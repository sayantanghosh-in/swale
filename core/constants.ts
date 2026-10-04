export const SWALE_GITHUB_ISSES_LINK = "https://github.com/sayantanghosh-in/swale/issues";
export const LEETCODE_PROFILE_URL = "https://leetcode.com/u/";
export const LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql";
export const COLORS = {
  ORANGE: "#F97D09",
};

/** Contribution calendar: how many weeks fit, and the ramp for each heat level. */
export const CALENDAR_WEEKS = 26;
export const CALENDAR_CELL = "■";
export const CALENDAR_EMPTY = "·";

/*
 * Index 0 is "nothing happened", 1-4 are increasing intensity.
 *
 * Brighter than GitHub's own dark-mode ramp on purpose. Theirs bottoms out at
 * #0E4429, which on a dark terminal is close enough to the background that a
 * quiet month reads as a rendering fault rather than a quiet month.
 */
export const CALENDAR_RAMP_GREEN = ["#4A525C", "#1F7A3C", "#2EA043", "#43D16A", "#7EE787"];
export const CALENDAR_RAMP_ORANGE = ["#4A525C", "#8A4A08", "#C2690A", "#F97D09", "#FFAE5C"];

export const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Backup archives. The manifest is what tells restore this zip is ours. */
export const BACKUP_DIR_NAME = "backups";
export const BACKUP_MANIFEST_NAME = "manifest.json";
export const BACKUP_DB_NAME = "data.db";
export const BACKUP_FORMAT_VERSION = 1;

/** How many LLM round trips the agent may take before it has to answer. */
export const AGENT_MAX_STEPS = 10;

/* --------------------------------------------------------------------------
 * Attachments
 * ----------------------------------------------------------------------- */

/**
 * What swale will accept when a file is pasted in.
 *
 * Nothing reads these yet — the extension decides the label and the icon, and
 * the bytes are left on disk. The point is that the plumbing exists, so adding
 * a parser later is one function, not a feature.
 */
export const ATTACHMENT_KINDS: Record<string, { kind: string; icon: string }> = {
  // images — attachable now, so the clipboard paste has somewhere to land
  ".png": { kind: "image", icon: "🖼" },
  ".jpg": { kind: "image", icon: "🖼" },
  ".jpeg": { kind: "image", icon: "🖼" },
  ".gif": { kind: "image", icon: "🖼" },
  ".webp": { kind: "image", icon: "🖼" },
  ".tiff": { kind: "image", icon: "🖼" },
  ".bmp": { kind: "image", icon: "🖼" },
  ".svg": { kind: "image", icon: "🖼" },
  // documents
  ".pdf": { kind: "pdf", icon: "📕" },
  ".doc": { kind: "document", icon: "📄" },
  ".docx": { kind: "document", icon: "📄" },
  ".rtf": { kind: "document", icon: "📄" },
  ".odt": { kind: "document", icon: "📄" },
  // spreadsheets and data
  ".csv": { kind: "spreadsheet", icon: "📊" },
  ".tsv": { kind: "spreadsheet", icon: "📊" },
  ".xls": { kind: "spreadsheet", icon: "📊" },
  ".xlsx": { kind: "spreadsheet", icon: "📊" },
  ".ods": { kind: "spreadsheet", icon: "📊" },
  ".json": { kind: "data", icon: "🗂" },
  ".yaml": { kind: "data", icon: "🗂" },
  ".yml": { kind: "data", icon: "🗂" },
  ".toml": { kind: "data", icon: "🗂" },
  ".xml": { kind: "data", icon: "🗂" },
  ".sql": { kind: "data", icon: "🗂" },
  // prose
  ".txt": { kind: "text", icon: "📝" },
  ".md": { kind: "markdown", icon: "📝" },
  ".mdx": { kind: "markdown", icon: "📝" },
  ".log": { kind: "text", icon: "📝" },
  // web
  ".html": { kind: "code", icon: "🧩" },
  ".htm": { kind: "code", icon: "🧩" },
  ".css": { kind: "code", icon: "🧩" },
  ".scss": { kind: "code", icon: "🧩" },
  // code
  ".js": { kind: "code", icon: "🧩" },
  ".jsx": { kind: "code", icon: "🧩" },
  ".ts": { kind: "code", icon: "🧩" },
  ".tsx": { kind: "code", icon: "🧩" },
  ".py": { kind: "code", icon: "🧩" },
  ".rb": { kind: "code", icon: "🧩" },
  ".go": { kind: "code", icon: "🧩" },
  ".rs": { kind: "code", icon: "🧩" },
  ".java": { kind: "code", icon: "🧩" },
  ".kt": { kind: "code", icon: "🧩" },
  ".c": { kind: "code", icon: "🧩" },
  ".h": { kind: "code", icon: "🧩" },
  ".cpp": { kind: "code", icon: "🧩" },
  ".cs": { kind: "code", icon: "🧩" },
  ".php": { kind: "code", icon: "🧩" },
  ".swift": { kind: "code", icon: "🧩" },
  ".sh": { kind: "code", icon: "🧩" },
  ".zsh": { kind: "code", icon: "🧩" },
};

/** Clipboard flavours that mean "there is a picture here", by platform marker. */
export const CLIPBOARD_IMAGE_TYPES: Record<string, string> = {
  "class PNGf": "png",
  "JPEG picture": "jpeg",
  "TIFF picture": "tiff",
  "GIF picture": "gif",
};

/** How often to ask the OS whether an image appeared on the clipboard. */
export const CLIPBOARD_POLL_MS = 2500;

/** Beyond this a paste is text the person meant to type, not a file path. */
export const MAX_PASTED_PATH_LENGTH = 4096;

/** Refuse to attach something that would never fit in a prompt anyway. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/* --------------------------------------------------------------------------
 * Slash commands
 * ----------------------------------------------------------------------- */

export const SLASH_COMMANDS: { name: string; args?: string; description: string }[] = [
  { name: "/model", args: "[name]", description: "Show or switch the model swale talks to" },
  { name: "/clear", description: "Forget the conversation so far" },
  { name: "/help", description: "List these commands" },
  { name: "/quit", description: "Leave swale" },
];
