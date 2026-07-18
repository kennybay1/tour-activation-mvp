import Link from "next/link";
import MarketingHeader from "./marketing-header";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grain flex min-h-dvh flex-col bg-cream font-sans text-ink">
      <MarketingHeader />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-ink/20">
        <div className="mx-auto w-full max-w-4xl px-5 py-8">
          <p className="font-serif text-lg italic">Moments</p>
          <p className="mt-1 text-sm text-ink/60">
            Geo-fenced fan engagement for artist teams
          </p>
          <nav className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/faq" className="text-ink/70 underline-offset-4 hover:underline">
              FAQ
            </Link>
            <Link href="/request-access" className="text-ink/70 underline-offset-4 hover:underline">
              Talk to us
            </Link>
            <Link href="/privacy" className="text-ink/70 underline-offset-4 hover:underline">
              Privacy
            </Link>
            <Link href="/terms" className="text-ink/70 underline-offset-4 hover:underline">
              Terms
            </Link>
            <Link href="/login" className="text-ink/70 underline-offset-4 hover:underline">
              Sign in
            </Link>
          </nav>
          <p className="mt-6 text-xs text-ink/40">© Moments 2026</p>
        </div>
      </footer>
    </div>
  );
}
