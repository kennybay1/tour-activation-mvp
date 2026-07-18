import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Talk to us" };

export default function RequestAccessPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-16 text-center">
      <h1 className="font-serif text-4xl">Talk to us</h1>
      <p className="mx-auto mt-4 max-w-md leading-relaxed text-ink/70">
        Planning a tour, a release, or something stranger? Tell us what
        you&apos;re thinking and we&apos;ll help you set it up.
      </p>
      <a
        href="mailto:kennybay@hotmail.co.uk?subject=Moments"
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
  );
}
