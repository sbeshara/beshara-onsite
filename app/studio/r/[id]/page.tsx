import Link from "next/link";
import { notFound } from "next/navigation";
import { getMe } from "@/lib/auth";
import { fileUrls } from "@/lib/jobtread";
import { reportFileName } from "@/lib/report-pdf";
import { shortDate, weekLabel, type WeeklyReport } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/types";
import ReportEditor from "./ReportEditor";

export const maxDuration = 300;

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  const supabase = await createClient();
  const { data } = await supabase.from("weekly_reports").select("*, projects(name, town, jobtread_label)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const report = data as WeeklyReport & { projects: { name: string; town: string; jobtread_label: string | null } };
  const { data: people } = await supabase.from("profiles").select("id, full_name").in("id", [report.updated_by, report.approved_by].filter(Boolean) as string[]);
  const name = (uid: string | null) => people?.find((p) => p.id === uid)?.full_name ?? "";
  const thumbs = await fileUrls(report.photos.map((p) => p.id), 400).catch(() => ({}) as Record<string, string>);

  return (
    <>
      <div className="st-h">
        <div>
          <p style={{ margin: 0 }}><Link href={`/studio?week=${report.week_start}`} className="textbtn">← All reports for this week</Link></p>
          <h1>{report.projects.name}</h1>
          <p>
            Week of {weekLabel(report.week_start)}
            {report.projects.jobtread_label ? ` · JobTread ${report.projects.jobtread_label}` : ""}
            {report.updated_by ? ` · last edited by ${name(report.updated_by)}` : ""}
            {report.approved_at ? ` · posted by ${name(report.approved_by)} on ${new Date(report.approved_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
          </p>
        </div>
        <a className="btn ghost" href={`/studio/r/${id}/pdf`} target="_blank" rel="noreferrer">Preview PDF</a>
      </div>
      <ReportEditor report={report} thumbs={thumbs} canApprove={isAdminRole(me.role)} draftName={reportFileName(report.projects.name, shortDate(report.week_start), true)} />
    </>
  );
}
