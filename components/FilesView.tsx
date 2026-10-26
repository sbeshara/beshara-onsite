"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FILES_BUCKET } from "@/lib/constants";
import { fileExt, fileSize, guessFolder, isImage, shortDate, storagePath } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { isTeamRole, type FileRow, type Role } from "@/lib/types";
import { LockIcon, PeopleIcon, UploadIcon } from "./Icons";

type Item = FileRow & { chat_id: string | null };

type Props = {
  projectId: string;
  files: Item[];
  chats: { id: string; name: string }[];
  readOnly?: boolean;
  urls: Record<string, string>;
  names: Record<string, string>;
  me: { id: string; role: Role };
};

export default function FilesView({ projectId, files: initial, chats, urls, names, me, readOnly = false }: Props) {
  const router = useRouter();
  const team = isTeamRole(me.role);
  const [files, setFiles] = useState(initial);
  // Files are grouped by the chat they were posted in; "direct" = uploaded on this tab.
  const [filter, setFilter] = useState<string>("all");
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const chatName = Object.fromEntries(chats.map((c) => [c.id, c.name]));
  const groups = [
    { id: "all", label: "All" },
    ...chats.filter((c) => files.some((f) => f.chat_id === c.id)).map((c) => ({ id: c.id, label: c.name })),
    ...(files.some((f) => !f.chat_id) ? [{ id: "direct", label: "Uploaded here" }] : []),
  ];
  const list = filter === "all" ? files : files.filter((f) => (filter === "direct" ? !f.chat_id : f.chat_id === filter));

  async function upload(chosen: File[]) {
    if (!chosen.length) return;
    const supabase = createClient();
    setError("");
    let failed = 0;
    for (const [i, file] of chosen.entries()) {
      setBusy(`Uploading ${i + 1} of ${chosen.length}…`);
      const path = storagePath(projectId, file.name);
      const up = await supabase.storage.from(FILES_BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (up.error) {
        failed++;
        continue;
      }
      const { error } = await supabase.from("files").insert({
        project_id: projectId,
        name: file.name,
        storage_path: path,
        size_bytes: file.size,
        mime_type: file.type || null,
        folder: guessFolder(file.name),
        is_internal: team ? !share : false,
        uploaded_by: me.id,
      });
      if (error) failed++;
    }
    setBusy("");
    if (failed) setError(`${failed} file${failed > 1 ? "s" : ""} didn't upload. Try again.`);
    setFilter("all");
    router.refresh();
  }

  async function toggle(f: Item) {
    const next = !f.is_internal;
    setFiles((all) => all.map((x) => (x.id === f.id ? { ...x, is_internal: next } : x)));
    const { error } = await createClient().from("files").update({ is_internal: next }).eq("id", f.id);
    if (error) {
      setFiles((all) => all.map((x) => (x.id === f.id ? { ...x, is_internal: f.is_internal } : x)));
      setError("Couldn't change who sees that file. Try again.");
    }
  }

  return (
    <div className="files">
      <div className="fbar">
        <div className="chips">
          {groups.map((g) => (
            <button key={g.id} type="button" className="chip" aria-pressed={g.id === filter} onClick={() => setFilter(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        {team && (
          <label className="share">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share uploads with client
          </label>
        )}
        {!readOnly && (
        <label className="btn" style={{ cursor: "pointer" }}>
          <UploadIcon />
          {busy || "Upload"}
          <input
            type="file"
            multiple
            hidden
            disabled={!!busy}
            onChange={(e) => {
              const chosen = [...(e.target.files ?? [])];
              e.target.value = "";
              upload(chosen);
            }}
          />
        </label>
        )}
      </div>
      {error && <p className="err" style={{ padding: "8px 16px 0" }}>{error}</p>}
      <div className="ftable-wrap">
        {list.length ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>From</th>
                <th className="col-by">Added by</th>
                <th className="col-date">Date</th>
                <th className="col-size">Size</th>
                {team && <th>Who sees it</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((f) => {
                const url = urls[f.storage_path];
                return (
                  <tr key={f.id}>
                    <td>
                      <a className="fname" href={url} target="_blank" rel="noreferrer">
                        {isImage(f.mime_type, f.name) && url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="mini" src={url} alt="" loading="lazy" />
                        ) : (
                          <span className="ext">{fileExt(f.name)}</span>
                        )}
                        <span>{f.name}</span>
                      </a>
                    </td>
                    <td>{f.chat_id ? chatName[f.chat_id] ?? "Chat" : "Files tab"}</td>
                    <td className="col-by">{(f.uploaded_by && names[f.uploaded_by]) || ""}</td>
                    <td className="num col-date">{shortDate(f.created_at)}</td>
                    <td className="num col-size">{fileSize(f.size_bytes)}</td>
                    {team && (
                      <td>
                        <button type="button" className={`vis ${f.is_internal ? "int" : "cli"}`} title="Click to change" onClick={() => toggle(f)}>
                          {f.is_internal ? <><LockIcon />Team only</> : <><PeopleIcon />Client + team</>}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty">No files yet. Attachments posted in any chat show up here automatically, or use Upload.</div>
        )}
      </div>
    </div>
  );
}
