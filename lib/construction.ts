import "server-only";
import { jobsById, listOpenJobs } from "./jobtread";

export const CONSTRUCTION_PHASE = 2;

type P = { phase: number; jobtread_job_id: string | null };

export type ConstructionCheck = {
  // False when JobTread couldn't be reached (callers then don't filter).
  ok: boolean;
  // The JobTread jobs whose daily logs count for a project.
  jobsFor: (p: P) => string[];
  inConstruction: (p: P) => boolean;
};

// Which projects are in construction: a project linked to JobTread while its
// job's Status there is Construction, an unlinked one while its OnSite phase is
// Construction. Some customers have more than one JobTread job (e.g. the build
// and a separate invoicing job); if a project is linked to one that isn't in
// construction, the same customer's job that is stands in.
export async function constructionCheck(projects: P[]): Promise<ConstructionCheck> {
  const open = await listOpenJobs().catch(() => null);
  const live = open ? new Set(open.map((j) => j.id)) : null;
  const byAccount = new Map<string, string[]>();
  for (const j of open ?? []) if (j.accountId) byAccount.set(j.accountId, [...(byAccount.get(j.accountId) ?? []), j.id]);
  const elsewhere = [...new Set(projects.map((p) => p.jobtread_job_id).filter((id): id is string => !!id && !!live && !live.has(id)))];
  const accountOf = new Map(
    [...(await jobsById(elsewhere).catch(() => new Map()))].filter(([, j]) => j.accountId).map(([id, j]) => [id as string, j.accountId as string]),
  );
  const jobsFor = (p: P) => {
    const id = p.jobtread_job_id;
    if (!id) return [];
    if (!live || live.has(id)) return [id];
    const account = accountOf.get(id);
    return account ? (byAccount.get(account) ?? []) : [];
  };
  return {
    ok: !!open,
    jobsFor,
    inConstruction: (p) => (p.jobtread_job_id && live ? jobsFor(p).length > 0 : p.phase === CONSTRUCTION_PHASE),
  };
}
