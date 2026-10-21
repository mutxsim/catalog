import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-muted">This page or product isn&apos;t available.</p>
      <Link href="/" className="mt-6 inline-block text-sm underline underline-offset-4">Back to catalog</Link>
    </main>
  );
}
