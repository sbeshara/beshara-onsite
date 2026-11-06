"use client";

import { useState, useTransition } from "react";
import { deleteProject } from "@/app/actions";

// Admins only: deletes a project for good, after typing its name to confirm.
export default function DeleteProject({ projectId, name }: { projectId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase();
  return (
    <section className="danger">
      <h2>Delete Project</h2>
      {!open ? (
        <>
          <p className="fine">Removes this project from OnSite for everyone, with all its chats, messages, files and progress reports. This can&apos;t be undone.</p>
          <button type="button" className="btn ghost danger-btn" onClick={() => setOpen(true)}>
            Delete This Project…
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!matches) return;
            setError("");
            start(async () => {
              const r = await deleteProject(projectId, typed);
              if (r?.error) setError(r.error);
            });
          }}
        >
          <p>
            This permanently deletes <b>{name}</b>: every chat and message, every file, and its progress reports. Clients keep their login for any other
            projects. JobTread isn&apos;t touched.
          </p>
          <label>
            <span className="fine">Type the project name to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} autoFocus disabled={pending} />
          </label>
          {error && <p className="err">{error}</p>}
          <div className="danger-actions">
            <button type="submit" className="btn danger-btn solid" disabled={!matches || pending}>
              {pending ? "Deleting…" : "Delete Forever"}
            </button>
            <button type="button" className="linkbtn" onClick={() => (setOpen(false), setTyped(""), setError(""))} disabled={pending}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
