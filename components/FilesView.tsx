"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FILES_BUCKET, FOLDERS } from "@/lib/constants";
import { fileExt, fileSize, guessFolder, isImage, shortDate, storagePath } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { isTeamRole, type FileRow, type Role } from "@/lib/types";
import { LockIcon, PeopleIcon, UploadIcon } from "./Icons";

type Props = {
  projectId: string;
  files: FileRow[];
  urls: Record<string, string>;
  names: Record<string, string>;
  me: { id: string; role: Role };
};

export default function FilesView({ projectId, files: initial, urls, names, me }: Props) {
  const router = useRouter();
  const team = isTeamRole(me.role);
  const [files, setFiles] = useState(initial);
  const [folder, setFolder] = useState<string>("All");
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const folders = ["All", ...FOLDERS.filter((f) => files.some((x) => x.folder === f))];
  const list = folder === "All" ? files : files.filter((f) => f.folder === folder);

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
    setFolder("All");
    router.refresh();
  }

  async function toggle(f: FileRow) {
    const next = !f.is_internal;
    setFiles((all) => all.map((x) => (x.id === f.id ? { ...x, is_internal: next } : x)));
    const { error } = await createClient().from("files").update({ is_internal: next }).eq("id", f.id);
    if (error) {
      setFiles((all) => all.map((x) => (x.id === f.id ? { ...x, is_internal: f.is_internal } : x)));
      setError("Couldn't change who sees that file. Try again.");
    }
  }

  async function move(f: FileRow, to: string) {
    setFiles((all) => all.map((x) => (x.id === f.id ? { ...x, folder: to } : x)));
    await createClient().from("files").update({ folder: to }).eq("id", f.id);
  }

  return (
    <div className="files">
      <div className="fbar">
        <div className="chips">
          {folders.map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={f === folder} onClick={() => setFolder(f)}>
              {f}
            </button>
          ))}
        </div>
        {team && (
          <label className="share">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share uploads with client
          </label>
        )}
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
      </div>
      {error && <p className="err" style={{ padding: "8px 16px 0" }}>{error}</p>}
      <div className="ftable-wrap">
        {list.length ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="col-folder">Folder</th>
                <th className="col-by">Added by</th>
                <th>Date</th>
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
                    <td className="col-folder">
                      {team ? (
                        <select aria-label="Folder" value={f.folder} onChange={(e) => move(f, e.target.value)} style={{ border: 0, background: "none", color: "inherit", font: "inherit" }}>
                          {FOLDERS.map((x) => <option key={x}>{x}</option>)}
                        </select>
                      ) : (
                        f.folder
                      )}
                    </td>
                    <td className="col-by">{(f.uploaded_by && names[f.uploaded_by]) || ""}</td>
                    <td className="num">{shortDate(f.created_at)}</td>
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
          <div className="empty">No files {folder === "All" ? "yet" : "in this folder yet"}. Use Upload to add drawings, photos or submittals.</div>
        )}
      </div>
    </div>
  );
}
