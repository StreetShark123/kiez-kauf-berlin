import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-slate-600">The page you requested is not available.</p>
      <Link href="/" className="rounded-lg bg-slate-900 px-4 py-2 text-white">
        Go home
      </Link>
    </main>
  );
}
