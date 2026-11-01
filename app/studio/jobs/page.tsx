import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { jobsById, LINKABLE_STATUSES, listJobs, type JobOption } from "@/lib/jobtread";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/types";
import ImportJobs from "./ImportJobs";
import JobLinker from "./JobLinker";
import LinkCheck, { type LinkIssue } from "./LinkCheck";

export const metadata = { title: "JobTread Jobs · Beshara Reports" };

export default async function JobsPage() {
  const me = await getMe();
  if (!isAdminRole(me.role)) redirect("/studio");
  const supabase = await createClient();
  const { data: projects } = await supabase.from("projects").select("id, name, town, jobtread_job_id, jobtread_label").order("name");
  let jobs: JobOption[] = [];
  let problem = "";
  try {
    jobs = await listJobs(LINKABLE_STATUSES);
  } catch (e) {
    problem = (e as Error).message.includes("JOBTREAD_GRANT_KEY")
      ? "The JobTread key isn't set up yet. Add JOBTREAD_GRANT_KEY in Vercel, then redeploy."
      : `Couldn't reach JobTread: ${(e as Error).message}`;
  }
  // Lists show each job's Status; the saved link keeps the plain label.
  const withStatus = jobs.map((j) => ({ ...j, display: `${j.label} · ${j.status}` }));
  const linked = new Set((projects ?? []).map((p) => p.jobtread_job_id).filter(Boolean));

  // Link Check: projects linked to a job that isn't Construction, Preconstruction
  // or Approved (often the customer's separate "Internal - Invoices" job).
  const issues: LinkIssue[] = [];
  if (!problem) {
    const ok = new Set(jobs.map((j) => j.id));
    const offIds = (projects ?? []).map((p) => p.jobtread_job_id as string | null).filter((id): id is string => !!id && !ok.has(id));
    const off = await jobsById([...new Set(offIds)]).catch(() => new Map<string, JobOption>());
    for (const p of projects ?? []) {
      if (!p.jobtread_job_id || ok.has(p.jobtread_job_id)) continue;
      const j = off.get(p.jobtread_job_id);
      issues.push({
        projectId: p.id,
        project: p.name,
        problem: j
          ? `Linked to ${j.label}, which is ${j.status ? `“${j.status}”` : "missing a Status"} in JobTread, so its daily logs and reports come from the wrong job.`
          : `Linked to ${p.jobtread_label ?? "a JobTread job"} that's closed or no longer in JobTread.`,
        suggestions: j?.accountId ? withStatus.filter((x) => x.accountId === j.accountId).map((x) => ({ id: x.id, label: x.label, display: x.display })) : [],
      });
    }
  }

  // A job Link Check offers as the fix already has its project in OnSite, so it
  // isn't offered for import (that would make a duplicate project).
  const offered = new Set(issues.flatMap((i) => i.suggestions.map((s) => s.id)));
  const notInOnSite = withStatus.filter((j) => !linked.has(j.id) && !offered.has(j.id));

  return (
    <>
      <div className="st-h">
        <div>
          <h1>JobTread Jobs</h1>
          <p>
            Link each OnSite project to its JobTread job. Only jobs with Status set to Construction, Preconstruction or Approved in JobTread are listed,
            so a customer&apos;s separate invoicing job can&apos;t be picked by mistake. Daily Check-Ins and weekly drafts come from the linked job&apos;s
            daily logs.
          </p>
        </div>
      </div>
      {problem && <div className="st-banner err">{problem}</div>}
      {!problem && <LinkCheck issues={issues} />}
      {!problem && <ImportJobs jobs={notInOnSite} unlinked={(projects ?? []).filter((p) => !p.jobtread_job_id).map((p) => ({ id: p.id, name: p.name }))} />}
      <table className="st-table">
        <thead>
          <tr>
            <th>OnSite Project</th>
            <th>JobTread Job</th>
          </tr>
        </thead>
        <tbody>
          {(projects ?? []).map((p) => (
            <tr key={p.id}>
              <td>
                <b>{p.name}</b>
                <div className="upl">{p.town}</div>
              </td>
              <td>
                <JobLinker projectId={p.id} current={p.jobtread_job_id} currentLabel={p.jobtread_label} jobs={withStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
