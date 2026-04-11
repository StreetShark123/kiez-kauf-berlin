import Link from "next/link";

export default function LocaleNotFoundPage() {
  return (
    <main className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <h2 className="text-2xl font-bold">Not found</h2>
      <p className="mt-2 text-slate-600">Store or page not available.</p>
      <Link href="/" className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-white">
        Back
      </Link>
    </main>
  );
}
