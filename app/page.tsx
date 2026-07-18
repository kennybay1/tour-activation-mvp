import Link from "next/link";

export default function Home() {
  return (
    <div className="grain flex min-h-screen flex-col bg-cream text-ink">
      <header className="border-b border-ink/20">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-4">
          <p className="font-serif text-xl italic">Tour Activation</p>
          <nav className="flex items-center gap-5">
            <Link
              href="/login"
              className="text-sm font-medium text-ink/80 underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-forest-deep px-5 py-2.5 text-sm font-semibold text-parchment transition active:scale-[0.98]"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-5 text-center">
        <div className="relative flex h-40 w-40 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-forest/25" />
          <span className="absolute inset-[18%] rounded-full border border-forest/45" />
          <span className="absolute inset-[36%] rounded-full border border-forest/70" />
          <span className="h-2 w-2 rounded-full bg-forest" />
        </div>
        <h1 className="mt-6 font-serif text-4xl">Tour Activation</h1>
        <p className="mt-2 text-xs uppercase tracking-[0.3em] text-clay">
          Be there to unlock it
        </p>
        <p className="mx-auto mt-6 max-w-md leading-relaxed text-ink/70">
          Location-unlocked rewards for your fans. Drop something at a spot —
          a voice note, a discount, a first listen — and they have to be there
          to get it.
        </p>
        <Link
          href="/signup"
          className="mt-8 rounded-full bg-forest-deep px-8 py-3.5 font-semibold text-parchment transition active:scale-[0.98]"
        >
          Get started
        </Link>
      </main>

      <footer className="border-t border-ink/20">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-4 text-sm text-ink/50">
          <p>© {new Date().getFullYear()} Tour Activation</p>
          <Link
            href="/request-access"
            className="underline underline-offset-4 hover:text-ink"
          >
            Talk to us
          </Link>
        </div>
      </footer>
    </div>
  );
}
