import AuthSide from "@/components/AuthSide";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in · Beshara OnSite" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="auth">
      <AuthSide />
      <main className="auth-main">
        <LoginForm linkError={error === "link"} />
      </main>
    </div>
  );
}
