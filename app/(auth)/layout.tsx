import Link from "next/link";

// Minimal centered layout for the auth pages: just the wordmark, no
// marketing chrome.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grain flex min-h-dvh flex-col bg-cream font-sans text-ink">
      <header className="px-5 pt-8 text-center">
        <Link href="/" className="font-serif text-2xl italic">
          Moments
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-5 py-10">
        {children}
      </main>
    </div>
  );
}
