import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { listOpenJobs, type JobOption } from "@/lib/jobtread";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/types";
import ImportJobs from "./ImportJobs";
import JobLinker from "./JobLinker";

export const metadata = { title: "JobTread Jobs · Beshara Reports" };

export default async function JobsPage() {
  const me = await getMe();
  if (!isAdminRole(me.role)) redirect("/studio");
  const supabase = await createClient();
  const { data: projects } = await supabase.from("projects").select("id, name, town, jobtread_job_id, jobtread_label").order("name");
  let jobs: JobOption[] = [];
  let problem = "";
  try {
    jobs = await listOpenJobs();
  } catch (e) {
    problem = (e as Error).message.includes("JOBTREAD_GRANT_KEY")
      ? "The JobTread key isn't set up yet. Add JOBTREAD_GRANT_KEY in Vercel, then redeploy."
      : `Couldn't reach JobTread: ${(e as Error).message}`;
  }
  const linked = new Set((projects ?? []).map((p) => p.jobtread_job_id).filter(Boolean));
  const notInOnSite = jobs.filter((j) => !linked.has(j.id));
  return (
    <>
      <div className="st-h">
        <div>
          <h1>JobTread Jobs</h1>
          <p>Link each OnSite project to its JobTread job. Only jobs with Status set to Construction in JobTread are listed. Weekly drafts are written from that job&apos;s daily logs.</p>
        </div>
      </div>
      {problem && <div className="st-banner err">{problem}</div>}
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
                <JobLinker projectId={p.id} current={p.jobtread_job_id} currentLabel={p.jobtread_label} jobs={jobs} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
