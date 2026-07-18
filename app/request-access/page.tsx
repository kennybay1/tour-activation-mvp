import Link from "next/link";

export default function RequestAccessPage() {
  return (
    <div className="grain flex min-h-dvh items-center justify-center bg-cream px-5 font-sans text-ink">
      <div className="fade-up w-full max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
          Tour Activation
        </p>
        <h1 className="mt-3 font-serif text-4xl">Talk to us</h1>
        <p className="mt-4 leading-relaxed text-ink/70">
          Planning a tour, a release, or something stranger? Tell us what
          you&apos;re thinking and we&apos;ll help you set it up.
        </p>
        <a
          href="mailto:kennybay@hotmail.co.uk?subject=Tour%20Activation"
          className="mt-8 inline-block rounded-full bg-forest-deep px-8 py-3.5 font-semibold text-parchment transition active:scale-[0.98]"
        >
          Email us
        </a>
        <p className="mt-6 text-sm text-ink/60">
          Ready to try it yourself?{" "}
          <Link
            href="/signup"
            className="font-medium text-clay underline underline-offset-4"
          >
            Get started
          </Link>
        </p>
      </div>
    </div>
  );
}
