import NotificationSettings from "@/components/NotificationSettings";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/constants";
import AccountForm from "./AccountForm";

export const metadata = { title: "Your Account · Beshara OnSite" };

export default async function AccountPage() {
  const me = await getMe();
  const supabase = await createClient();
  const { data: prefs } = await supabase.from("profiles").select("*").eq("id", me.id).single();
  return (
    <div className="page">
      <div className="page-h">
        <h1>Your Account</h1>
        <p>Your name and photo show beside your messages and wherever the team or clients see you.</p>
      </div>
      <AccountForm id={me.id} name={me.full_name} email={me.email} photo={(prefs?.avatar_url as string | null) ?? null} role={me.role === "client" ? me.title || "Client" : ROLE_LABEL[me.role]} />
      <NotificationSettings userId={me.id} email={prefs?.email_notifications ?? true} push={prefs?.push_notifications ?? true} />
    </div>
  );
}
