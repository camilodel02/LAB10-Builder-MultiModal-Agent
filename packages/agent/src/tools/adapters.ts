import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { DbClient } from "@agents/db";
import type { UserToolSetting, UserIntegration } from "@agents/types";
import { TOOL_CATALOG } from "@agents/types";
import { TOOL_SCHEMAS } from "./schemas";
import { withTracking } from "./withTracking";
import { executeBash } from "./bashExec";
import { executeReadFile, executeWriteFile, executeEditFile } from "./fileTools";
import { PDFParse } from "pdf-parse";

const GITHUB_API = "https://api.github.com";
const GITHUB_UA = "10x-builders-agent/1.0";

export interface ToolContext {
  db: DbClient;
  userId: string;
  sessionId: string;
  enabledTools: UserToolSetting[];
  integrations: UserIntegration[];
  githubToken?: string;
  googleAccessToken?: string;
}

function isToolAvailable(toolId: string, ctx: ToolContext): boolean {
  const setting = ctx.enabledTools.find((t) => t.tool_id === toolId);
  if (!setting?.enabled) return false;

  const def = TOOL_CATALOG.find((t) => t.id === toolId);
  if (def?.requires_integration) {
    const hasIntegration = ctx.integrations.some(
      (i) => i.provider === def.requires_integration && i.status === "active"
    );
    if (!hasIntegration) return false;
  }
  return true;
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": GITHUB_UA,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { ...ghHeaders(token), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  return res.json();
}

export async function executeGitHubTool(
  toolName: string,
  args: Record<string, unknown>,
  token: string
): Promise<Record<string, unknown>> {
  switch (toolName) {
    case "github_list_repos": {
      const perPage = (args.per_page as number) || 10;
      const repos = await ghFetch(token, `/user/repos?per_page=${perPage}&sort=updated`);
      return {
        repos: (repos as Array<Record<string, unknown>>).map((r) => ({
          full_name: r.full_name,
          description: r.description,
          html_url: r.html_url,
          private: r.private,
          language: r.language,
          updated_at: r.updated_at,
        })),
      };
    }
    case "github_list_issues": {
      const state = (args.state as string) || "open";
      const issues = await ghFetch(
        token,
        `/repos/${args.owner}/${args.repo}/issues?state=${state}`
      );
      return {
        issues: (issues as Array<Record<string, unknown>>).map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          html_url: i.html_url,
          created_at: i.created_at,
          user: (i.user as Record<string, unknown>)?.login,
        })),
      };
    }
    case "github_create_issue": {
      const issue = await ghFetch(
        token,
        `/repos/${args.owner}/${args.repo}/issues`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: args.title, body: args.body ?? "" }),
        }
      );
      return {
        message: "Issue created",
        issue_number: (issue as Record<string, unknown>).number,
        issue_url: (issue as Record<string, unknown>).html_url,
      };
    }
    case "github_create_repo": {
      const repo = await ghFetch(token, "/user/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: args.name,
          description: args.description ?? "",
          private: args.isPrivate ?? false,
        }),
      });
      return {
        message: "Repository created",
        full_name: (repo as Record<string, unknown>).full_name,
        html_url: (repo as Record<string, unknown>).html_url,
      };
    }
    default:
      throw new Error(`Unknown GitHub tool: ${toolName}`);
  }
}

async function googleDriveListFiles(
  input: {
    folderId?: string;
    mimeType?: string;
    query?: string;
    pageSize?: number;
  },
  accessToken: string
): Promise<Record<string, unknown>> {
  const conditions: string[] = ["trashed = false"];

  if (input.folderId) {
    conditions.push(`'${input.folderId.replace(/'/g, "\\'")}' in parents`);
  }
  if (input.mimeType) {
    conditions.push(`mimeType = '${input.mimeType.replace(/'/g, "\\'")}'`);
  }
  if (input.query) {
    conditions.push(`name contains '${input.query.replace(/'/g, "\\'")}'`);
  }

  const params = new URLSearchParams({
    pageSize: String(input.pageSize ?? 10),
    q: conditions.join(" and "),
    fields: "files(id,name,mimeType,createdTime,modifiedTime,webViewLink,size),nextPageToken",
    orderBy: "modifiedTime desc",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Drive API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    files?: Array<Record<string, unknown>>;
    nextPageToken?: string;
  };

  return {
    files: (data.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ?? null,
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
    })),
    nextPageToken: data.nextPageToken ?? null,
    count: (data.files ?? []).length,
  };
}

async function googleDriveGetFile(
  input: { fileId: string },
  accessToken: string
): Promise<Record<string, unknown>> {
  const metadataRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!metadataRes.ok) {
    const body = await metadataRes.text().catch(() => "");
    throw new Error(`Google Drive metadata ${metadataRes.status}: ${body}`);
  }

  const meta = (await metadataRes.json()) as Record<string, unknown>;
  const mimeType = String(meta.mimeType ?? "");

  // For docs files, export as plain text. For plain text-like files, download directly.
  let textContent: string | null = null;
  let contentSource: string | null = null;

  if (mimeType.startsWith("application/vnd.google-apps.")) {
    const exportRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/export?mimeType=text/plain`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (exportRes.ok) {
      textContent = await exportRes.text();
      contentSource = "google_export_text_plain";
    }
  } else if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  ) {
    const mediaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?alt=media`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (mediaRes.ok) {
      textContent = await mediaRes.text();
      contentSource = "drive_alt_media";
    }
  } else if (mimeType === "application/pdf") {
    const mediaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?alt=media`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (mediaRes.ok) {
      const bytes = await mediaRes.arrayBuffer();
      const parser = new PDFParse({ data: Buffer.from(bytes) });
      try {
        const parsed = await parser.getText();
        textContent = parsed.text?.trim() || null;
        contentSource = "pdf_parse";
      } finally {
        await parser.destroy();
      }
    }
  } else if (mimeType.startsWith("image/")) {
    const mediaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?alt=media`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (mediaRes.ok) {
      const apiKey = process.env.GOOGLE_VISION_API_KEY;
      if (!apiKey) {
        return {
          file: meta,
          textContent: null,
          contentSource: null,
          textLength: 0,
          note:
            "Image detected. Set GOOGLE_VISION_API_KEY to enable OCR for image invoices.",
        };
      }
      const bytes = Buffer.from(await mediaRes.arrayBuffer());
      const visionRes = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [
              {
                image: { content: bytes.toString("base64") },
                features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
              },
            ],
          }),
        }
      );
      if (visionRes.ok) {
        const visionData = (await visionRes.json()) as {
          responses?: Array<{ fullTextAnnotation?: { text?: string } }>;
        };
        textContent =
          visionData.responses?.[0]?.fullTextAnnotation?.text?.trim() ?? null;
        contentSource = "google_vision_document_text_detection";
      }
    }
  }

  return {
    file: meta,
    textContent,
    contentSource,
    textLength: textContent ? textContent.length : 0,
    note:
      textContent === null
        ? "No text content extracted for this file type yet (e.g. PDF/image binary)."
        : null,
  };
}

function firstMatch(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match?.[1]?.trim() ?? null;
}

function toNumberSafe(raw: string | null): number | null {
  if (!raw) return null;
  const normalized = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

async function invoiceExtractFields(input: { text: string }): Promise<Record<string, unknown>> {
  const text = input.text;

  const nit = firstMatch(
    text,
    /(?:NIT|Nit|nit)\s*[:\-]?\s*([0-9][0-9.\-]{5,})/
  );
  const invoiceNumber = firstMatch(
    text,
    /(?:Factura|FACTURA|N[úu]mero de factura|No\.?\s*Factura)\s*[:#\-]?\s*([A-Z0-9\-]+)/i
  );
  const date = firstMatch(
    text,
    /(?:Fecha|FECHA)\s*[:\-]?\s*([0-3]?\d[\/\-][0-1]?\d[\/\-](?:\d{2}|\d{4}))/i
  );
  const razonSocial =
    firstMatch(text, /(?:Raz[oó]n social|RAZ[OÓ]N SOCIAL)\s*[:\-]?\s*(.+)/i) ??
    firstMatch(text, /(?:Proveedor|Emisor)\s*[:\-]?\s*(.+)/i);

  const subtotal = toNumberSafe(
    firstMatch(text, /(?:Subtotal|SUBTOTAL)\s*[:\-]?\s*\$?\s*([\d.,]+)/i)
  );
  const iva = toNumberSafe(
    firstMatch(text, /(?:IVA|I\.V\.A\.)\s*[:\-]?\s*\$?\s*([\d.,]+)/i)
  );
  const total = toNumberSafe(
    firstMatch(text, /(?:Total(?:\s+a\s+pagar)?|TOTAL)\s*[:\-]?\s*\$?\s*([\d.,]+)/i)
  );

  const confidenceFields = [nit, razonSocial, invoiceNumber, date, total].filter(Boolean).length;
  const confidence = Math.min(1, confidenceFields / 5);

  return {
    nit_emisor: nit,
    razon_social_emisor: razonSocial,
    numero_factura: invoiceNumber,
    fecha_emision: date,
    subtotal,
    iva,
    total,
    confidence,
  };
}

async function googleSheetsAppendRow(
  input: {
    spreadsheetId: string;
    sheetName: string;
    values: Array<string | number | boolean>;
  },
  accessToken: string
): Promise<Record<string, unknown>> {
  const range = encodeURIComponent(`${input.sheetName}!A1`);
  const params = new URLSearchParams({
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    includeValuesInResponse: "true",
  });

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${range}:append?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        values: [input.values],
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Sheets API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    updates?: {
      spreadsheetId?: string;
      updatedRange?: string;
      updatedRows?: number;
      updatedColumns?: number;
      updatedCells?: number;
    };
  };

  return {
    ok: true,
    spreadsheetId: data.updates?.spreadsheetId ?? input.spreadsheetId,
    updatedRange: data.updates?.updatedRange ?? null,
    updatedRows: data.updates?.updatedRows ?? 0,
    updatedColumns: data.updates?.updatedColumns ?? 0,
    updatedCells: data.updates?.updatedCells ?? 0,
  };
}

type ToolHandlers = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in string]: (input: any, ctx: ToolContext) => Promise<Record<string, unknown>>;
};

export const TOOL_HANDLERS: ToolHandlers = {
  get_user_preferences: async (_input, ctx) => {
    const { getProfile } = await import("@agents/db");
    const profile = await getProfile(ctx.db, ctx.userId);
    return {
      name: profile.name,
      timezone: profile.timezone,
      language: profile.language,
      agent_name: profile.agent_name,
    };
  },

  list_enabled_tools: async (_input, ctx) => {
    const enabled = ctx.enabledTools.filter((t) => t.enabled).map((t) => t.tool_id);
    return { enabled };
  },

  github_list_repos: async (input, ctx) =>
    executeGitHubTool("github_list_repos", input, ctx.githubToken!),

  github_list_issues: async (input, ctx) =>
    executeGitHubTool("github_list_issues", input, ctx.githubToken!),

  github_create_issue: async (input, ctx) =>
    executeGitHubTool("github_create_issue", input, ctx.githubToken!),

  github_create_repo: async (input, ctx) =>
    executeGitHubTool("github_create_repo", input, ctx.githubToken!),

  google_drive_list_files: async (
    input: { folderId?: string; mimeType?: string; query?: string; pageSize?: number },
    ctx
  ) => {
    if (!ctx.googleAccessToken) {
      throw new Error("Google integration token not available");
    }
    return googleDriveListFiles(input, ctx.googleAccessToken);
  },
  google_drive_get_file: async (input: { fileId: string }, ctx) => {
    if (!ctx.googleAccessToken) {
      throw new Error("Google integration token not available");
    }
    return googleDriveGetFile(input, ctx.googleAccessToken);
  },

  google_sheets_append_row: async (
    input: {
      spreadsheetId: string;
      sheetName: string;
      values: Array<string | number | boolean>;
    },
    ctx
  ) => {
    if (!ctx.googleAccessToken) {
      throw new Error("Google integration token not available");
    }
    return googleSheetsAppendRow(input, ctx.googleAccessToken);
  },

  invoice_extract_fields: async (input: { text: string }) =>
    invoiceExtractFields(input),

  read_file: async (input: { path: string; offset?: number; limit?: number }) => {
    const result = await executeReadFile(input);
    return result as unknown as Record<string, unknown>;
  },

  write_file: async (input: { path: string; content: string }) => {
    const result = await executeWriteFile(input);
    return result as unknown as Record<string, unknown>;
  },

  edit_file: async (input: { path: string; old_string: string; new_string: string }) => {
    const result = await executeEditFile(input);
    return result as unknown as Record<string, unknown>;
  },

  bash: async (input: { terminal: string; prompt: string }) => {
    const result = await executeBash(input.terminal, input.prompt);
    return result as unknown as Record<string, unknown>;
  },

  schedule_task: async (
    input: {
      prompt: string;
      schedule_type: "one_time" | "recurring";
      run_at?: string;
      cron_expr?: string;
      timezone?: string;
    },
    ctx: ToolContext
  ) => {
    const { Cron } = await import("croner");
    const { createScheduledTask } = await import("@agents/db");
    const { getProfile } = await import("@agents/db");

    const profile = await getProfile(ctx.db, ctx.userId);
    const tz = input.timezone ?? profile.timezone ?? "UTC";

    let nextRunAt: string;

    if (input.schedule_type === "one_time") {
      if (!input.run_at) throw new Error("run_at is required for one_time tasks");
      nextRunAt = new Date(input.run_at).toISOString();
    } else {
      if (!input.cron_expr) throw new Error("cron_expr is required for recurring tasks");
      const job = new Cron(input.cron_expr, { timezone: tz });
      const next = job.nextRun();
      if (!next) throw new Error("Could not compute next run from cron expression");
      nextRunAt = next.toISOString();
    }

    const task = await createScheduledTask(ctx.db, {
      userId: ctx.userId,
      prompt: input.prompt,
      scheduleType: input.schedule_type,
      runAt: input.run_at,
      cronExpr: input.cron_expr,
      timezone: tz,
      nextRunAt,
    });

    const readableTime = new Date(nextRunAt).toLocaleString("es", {
      timeZone: tz,
      dateStyle: "full",
      timeStyle: "short",
    });

    return {
      ok: true,
      task_id: task.id,
      schedule_type: task.schedule_type,
      next_run_at: nextRunAt,
      message:
        input.schedule_type === "one_time"
          ? `Tarea programada para el ${readableTime} (${tz}). Recibirás el resultado por Telegram.`
          : `Tarea recurrente creada con expresión "${input.cron_expr}". Próxima ejecución: ${readableTime} (${tz}).`,
    };
  },
};

export function buildLangChainTools(ctx: ToolContext) {
  const tools = [];

  for (const def of TOOL_CATALOG) {
    if (!isToolAvailable(def.id, ctx)) continue;

    const schema = TOOL_SCHEMAS[def.id as keyof typeof TOOL_SCHEMAS];
    const handler = TOOL_HANDLERS[def.id];
    if (!schema || !handler) continue;

    const trackedHandler = withTracking(def.id, handler, ctx);

    tools.push(
      tool(trackedHandler, {
        name: def.name,
        description: def.description,
        schema: schema as z.ZodTypeAny,
      })
    );
  }

  return tools;
}
