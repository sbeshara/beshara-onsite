import AuthSide from "@/components/AuthSide";
import InstallGuide from "./InstallGuide";

// The title is the name iPhones put under the home-screen icon.
export const metadata = { title: "BB OnSite" };

// "Get the OnSite App": the page client emails link to. It works before
// signing in. Android and computers get a one-tap Install button; iPhones
// (which don't let websites install themselves) get two quick steps.
export default async function InstallPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  return (
    <div className="auth install-page">
      <AuthSide />
      <main className="auth-main">
        <InstallGuide welcome={welcome === "1"} />
      </main>
    </div>
  );
}
