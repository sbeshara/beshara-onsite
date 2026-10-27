import AuthSide from "@/components/AuthSide";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import WelcomeForm from "./WelcomeForm";

export const metadata = { title: "Set Up Your Account · Beshara OnSite" };

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  const me = await getMe();
  const supabase = await createClient();
  const { data: projects } = await supabase.from("projects").select("name").order("created_at").limit(1);
  return (
    <div className="auth">
      <AuthSide />
      <main className="auth-main">
        <WelcomeForm name={me.full_name} email={me.email} projectName={projects?.[0]?.name ?? null} reset={reset === "1"} />
      </main>
    </div>
  );
}
