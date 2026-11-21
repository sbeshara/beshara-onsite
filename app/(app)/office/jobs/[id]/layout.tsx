import Link from "next/link";
import { notFound } from "next/navigation";
import { isLead } from "@/lib/constants";
import { statusClass } from "@/lib/office";
import { createClient } from "@/lib/supabase/server";
import JobTabs from "./JobTabs";

// A job in the office tools: details, plans & takeoff, and estimates.
export default async function JobLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: job } = await (await createClient()).from("projects").select("id, name, status, job_number, town, customers(name)").eq("id", id).maybeSingle();
  if (!job) notFound();
  const customer = job.customers as unknown as { name: string } | null;
  return (
    <div className="jobshell">
      <div className="jobhead">
        <Link className="textbtn" href={`/office?view=${isLead(job.status) ? "leads" : "active"}`}>← Jobs &amp; Leads</Link>
        <h1>{job.job_number ? `${job.job_number} · ` : ""}{job.name}</h1>
        <p><span className={statusClass(job.status)}>{job.status}</span>{customer ? ` · ${customer.name}` : ""}{job.town ? ` · ${job.town}` : ""}</p>
        <JobTabs id={id} />
      </div>
      {children}
    </div>
  );
}
