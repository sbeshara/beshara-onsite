import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BasecampError,
  bcAll,
  bcFetch,
  bcGet,
  convertRichText,
  documentFile,
  fileName,
  splitBody,
  type BcPerson,
  type BcProject,
  type BcRecording,
  type BcUpload,
  type Connection,
} from "./basecamp";
import { FILES_BUCKET } from "./constants";
import { guessFolder, storagePath } from "./format";
import { createAdminClient } from "./supabase/admin";

// The import runs in small steps the import screen calls one after another:
// one step per Message Board post (with its comments and attachments) and one
// per Docs & Files folder. Each step stops early when its time is up and can
// simply be run again: anything already brought over is skipped by its
// Basecamp ID, so re-running the whole import later only adds what's new.

export const MAX_FILE = 200 * 1024 * 1024;
const STEP_BUDGET_MS = 120_000;

export type Tally = { chats: number; messages: number; files: number; skipped: string[] };

type Ctx = {
  conn: Connection;
  admin: SupabaseClient;
  projectId: string;
  deadline: number;
  people: Map<string, string>;
  chatNames: Set<string> | null;
  tally: Tally;
};

async function context(conn: Connection, projectId: string): Promise<Ctx> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("id, email");
  const people = new Map((data ?? []).map((p) => [String(p.email).toLowerCase(), p.id as string]));
  return { conn, admin, projectId, deadline: Date.now() + STEP_BUDGET_MS, people, chatNames: null, tally: { chats: 0, messages: 0, files: 0, skipped: [] } };
}

const timeUp = (ctx: Ctx) => Date.now() > ctx.deadline;

// People already in OnSite (matched by email) are credited by name; anyone
// else keeps the name they had in Basecamp.
function author(ctx: Ctx, p: BcPerson | undefined) {
  const id = p?.email_address ? ctx.people.get(p.email_address.toLowerCase()) : undefined;
  return { author_id: id ?? null, imported_author: id ? null : (p?.name || "Basecamp user").slice(0, 120) };
}

// ---------------------------------------------------------------------------
// Start: pick (or create) the OnSite project and list the work to do.
// ---------------------------------------------------------------------------

export type Plan = { projectId: string; name: string; posts: { id: number; title: string }[]; vault: { id: number; path: string } | null };

export async function startProject(conn: Connection, bcProjectId: number, target: string, meId: string): Promise<Plan> {
  const p = await bcGet<BcProject>(conn, `/projects/${bcProjectId}.json`);
  const admin = createAdminClient();
  const key = String(p.id);
  const { data: mapped } = await admin.from("projects").select("id, name").eq("basecamp_project_id", key).maybeSingle();
  let projectId: string;
  if (target === "new") {
    if (mapped) projectId = mapped.id;
    else {
      const { data, error } = await admin
        .from("projects")
        .insert({ name: p.name.trim().slice(0, 120) || "Basecamp Project", town: "", created_by: meId, basecamp_project_id: key })
        .select("id")
        .single();
      if (error || !data) throw new BasecampError(`Couldn't create the OnSite project for ${p.name}: ${error?.message}`);
      projectId = data.id;
    }
  } else {
    if (mapped && mapped.id !== target) throw new BasecampError(`${p.name} was already imported into ${mapped.name}. Pick that project, or leave it as is.`);
    const { data: t } = await admin.from("projects").select("id, basecamp_project_id").eq("id", target).maybeSingle();
    if (!t) throw new BasecampError("That OnSite project no longer exists.");
    if (t.basecamp_project_id && t.basecamp_project_id !== key) throw new BasecampError("That OnSite project already holds a different Basecamp project.");
    const { error } = await admin.from("projects").update({ basecamp_project_id: key }).eq("id", target);
    if (error) throw new BasecampError(`Couldn't link ${p.name}: ${error.message}`);
    projectId = target;
  }
  const board = p.dock.find((d) => d.name === "message_board" && d.enabled);
  const vault = p.dock.find((d) => d.name === "vault" && d.enabled);
  const posts = board ? await bcAll<BcRecording>(conn, `/message_boards/${board.id}/messages.json`) : [];
  posts.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { projectId, name: p.name, posts: posts.map((m) => ({ id: m.id, title: m.title })), vault: vault ? { id: vault.id, path: "" } : null };
}

// ---------------------------------------------------------------------------
// One Message Board post: its own chat, the post, then each comment.
// ---------------------------------------------------------------------------

async function freeChatName(ctx: Ctx, title: string) {
  if (!ctx.chatNames) {
    const { data } = await ctx.admin.from("chats").select("name").eq("project_id", ctx.projectId);
    ctx.chatNames = new Set((data ?? []).map((c) => String(c.name).toLowerCase()));
  }
  const base = title.replace(/\s+/g, " ").trim() || "Untitled Post";
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` (${n})`;
    const name = base.slice(0, 60 - suffix.length).trimEnd() + suffix;
    if (!ctx.chatNames.has(name.toLowerCase())) {
      ctx.chatNames.add(name.toLowerCase());
      return name;
    }
  }
}

export async function importPost(conn: Connection, projectId: string, messageId: number) {
  const ctx = await context(conn, projectId);
  const m = await bcGet<BcRecording>(conn, `/messages/${messageId}.json`);
  const sourceId = `basecamp:message:${m.id}`;
  let { data: chat } = await ctx.admin.from("chats").select("id, is_internal").eq("source_id", sourceId).maybeSingle();
  if (!chat) {
    const name = await freeChatName(ctx, m.title);
    const { data, error } = await ctx.admin
      .from("chats")
      .insert({ project_id: projectId, name, is_internal: !m.visible_to_clients, position: 500, created_by: author(ctx, m.creator).author_id, created_at: m.created_at, source_id: sourceId })
      .select("id, is_internal")
      .single();
    if (error || !data) throw new BasecampError(`Couldn't add the chat "${name}": ${error?.message}`);
    chat = data;
    ctx.tally.chats++;
  }
  const finish = (done: boolean) => ({ done, ...ctx.tally });
  if (!(await addMessage(ctx, chat, sourceId, m))) return finish(false);
  const comments = await bcAll<BcRecording>(conn, `/recordings/${m.id}/comments.json`);
  for (const c of comments) {
    if (timeUp(ctx) || !(await addMessage(ctx, chat, `basecamp:comment:${c.id}`, c))) return finish(false);
  }
  return finish(true);
}

async function addMessage(ctx: Ctx, chat: { id: string; is_internal: boolean }, sourceId: string, rec: BcRecording) {
  const who = author(ctx, rec.creator);
  const { data: existing } = await ctx.admin.from("messages").select("id").eq("source_id", sourceId).maybeSingle();
  let messageId: string | undefined = existing?.id;
  if (!messageId) {
    const body = convertRichText(rec.content);
    const parts = body ? splitBody(body) : [""];
    const t0 = new Date(rec.created_at).getTime();
    const rows = parts.map((b, i) => ({
      chat_id: chat.id,
      body: b,
      created_at: new Date(t0 + i).toISOString(),
      source_id: i ? `${sourceId}:${i + 1}` : sourceId,
      ...who,
    }));
    const { data, error } = await ctx.admin.from("messages").insert(rows).select("id, source_id");
    if (error || !data) throw new BasecampError(`Couldn't add a message from ${rec.creator?.name ?? "Basecamp"}: ${error?.message}`);
    messageId = data.find((r) => r.source_id === sourceId)!.id as string;
    ctx.tally.messages += rows.length;
  }
  for (const a of rec.content_attachments ?? []) {
    if (timeUp(ctx)) return false;
    await addFile(ctx, {
      sourceId: `basecamp:attachment:${a.id}`,
      name: fileName(a.filename, a.content_type),
      type: a.content_type,
      size: a.byte_size,
      url: a.download_url,
      messageId,
      isInternal: chat.is_internal,
      uploadedBy: who.author_id,
      createdAt: rec.created_at,
      folder: null,
    });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

type NewFile = {
  sourceId: string;
  name: string;
  type: string;
  size: number;
  messageId: string | null;
  isInternal: boolean;
  uploadedBy: string | null;
  createdAt: string;
  folder: string | null;
} & ({ url: string } | { content: string });

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;

async function addFile(ctx: Ctx, f: NewFile) {
  const { data: has } = await ctx.admin.from("files").select("id").eq("source_id", f.sourceId).maybeSingle();
  if (has) return;
  if (f.size > MAX_FILE) {
    ctx.tally.skipped.push(`${f.name} (${mb(f.size)}) is too big to copy. Download it from Basecamp and upload it to the Files tab.`);
    return;
  }
  let data: ArrayBuffer | Buffer;
  if ("content" in f) data = Buffer.from(f.content, "utf8");
  else {
    try {
      data = await (await bcFetch(ctx.conn, f.url)).arrayBuffer();
    } catch (e) {
      if (e instanceof BasecampError && e.fatal) throw e;
      ctx.tally.skipped.push(`${f.name} couldn't be downloaded from Basecamp (${(e as Error).message}). Run the import again to retry.`);
      return;
    }
  }
  const path = storagePath(ctx.projectId, f.name);
  const up = await ctx.admin.storage.from(FILES_BUCKET).upload(path, data, { contentType: f.type || "application/octet-stream" });
  if (up.error) {
    ctx.tally.skipped.push(`${f.name} couldn't be saved (${up.error.message}). Run the import again to retry.`);
    return;
  }
  const { error } = await ctx.admin.from("files").insert({
    project_id: ctx.projectId,
    message_id: f.messageId,
    name: f.name.slice(0, 250),
    storage_path: path,
    size_bytes: data.byteLength,
    mime_type: f.type || null,
    folder: guessFolder(f.name),
    is_internal: f.isInternal,
    uploaded_by: f.uploadedBy,
    created_at: f.createdAt,
    source_id: f.sourceId,
    source_folder: f.folder?.slice(0, 300) ?? null,
  });
  if (error) {
    await ctx.admin.storage.from(FILES_BUCKET).remove([path]);
    if (error.code !== "23505") ctx.tally.skipped.push(`${f.name} couldn't be saved (${error.message}). Run the import again to retry.`);
    return;
  }
  ctx.tally.files++;
}

// ---------------------------------------------------------------------------
// One Docs & Files folder: its uploads and docs; subfolders come back as
// more steps.
// ---------------------------------------------------------------------------

export async function importFolder(conn: Connection, projectId: string, vaultId: number, path: string) {
  const ctx = await context(conn, projectId);
  const label = path || "Docs & Files";
  const finish = (done: boolean, subfolders: { id: number; path: string }[] = []) => ({ done, subfolders, ...ctx.tally });
  const uploads = await bcAll<BcUpload>(conn, `/vaults/${vaultId}/uploads.json`);
  for (const u of uploads) {
    if (timeUp(ctx)) return finish(false);
    await addFile(ctx, {
      sourceId: `basecamp:upload:${u.id}`,
      name: fileName(u.filename || u.title, u.content_type),
      type: u.content_type,
      size: u.byte_size,
      url: u.download_url,
      messageId: null,
      isInternal: !u.visible_to_clients,
      uploadedBy: author(ctx, u.creator).author_id,
      createdAt: u.created_at,
      folder: label,
    });
  }
  const docs = await bcAll<BcRecording>(conn, `/vaults/${vaultId}/documents.json`);
  for (const d of docs) {
    if (timeUp(ctx)) return finish(false);
    const who = author(ctx, d.creator);
    const title = d.title.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 150) || "Untitled Doc";
    const html = documentFile(d.title, d.creator?.name ?? "Basecamp", d.created_at, d.content);
    await addFile(ctx, {
      sourceId: `basecamp:document:${d.id}`,
      name: `${title}.html`,
      type: "text/html",
      size: html.length,
      content: html,
      messageId: null,
      isInternal: !d.visible_to_clients,
      uploadedBy: who.author_id,
      createdAt: d.created_at,
      folder: label,
    });
    for (const a of d.content_attachments ?? []) {
      if (timeUp(ctx)) return finish(false);
      await addFile(ctx, {
        sourceId: `basecamp:attachment:${a.id}`,
        name: fileName(a.filename, a.content_type),
        type: a.content_type,
        size: a.byte_size,
        url: a.download_url,
        messageId: null,
        isInternal: !d.visible_to_clients,
        uploadedBy: who.author_id,
        createdAt: d.created_at,
        folder: `${label} / ${title}`,
      });
    }
  }
  const subs = await bcAll<BcRecording>(conn, `/vaults/${vaultId}/vaults.json`);
  return finish(true, subs.map((v) => ({ id: v.id, path: path ? `${path} / ${v.title}` : v.title })));
}
