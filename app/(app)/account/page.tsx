import { getMe } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/constants";
import AccountForm from "./AccountForm";

export const metadata = { title: "Your account · Beshara OnSite" };

export default async function AccountPage() {
  const me = await getMe();
  return (
    <div className="page">
      <div className="page-h">
        <h1>Your account</h1>
        <p>Your name shows on your messages and on the little circle with your initials.</p>
      </div>
      <AccountForm id={me.id} name={me.full_name} email={me.email} role={me.role === "client" ? me.title || "Client" : ROLE_LABEL[me.role]} />
    </div>
  );
}
