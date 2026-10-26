import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page">
      <div className="page-h">
        <h1>We can&apos;t find that page</h1>
        <p>It may have been removed, or you may not have access to it.</p>
      </div>
      <div><Link className="btn" href="/">Back to the dashboard</Link></div>
    </div>
  );
}
