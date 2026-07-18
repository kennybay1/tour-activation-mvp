"use client";

import { useState } from "react";
import Link from "next/link";

const LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#use-cases", label: "Use cases" },
  { href: "/faq", label: "FAQ" },
  { href: "/login", label: "Sign in" },
];

export default function MarketingHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-ink/20">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-4">
        <Link href="/" className="font-serif text-xl italic">
          Moments
        </Link>

        <nav className="hidden items-center gap-6 sm:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-ink/80 underline-offset-4 hover:underline"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/signup"
            className="rounded-full bg-forest-deep px-5 py-2.5 text-sm font-semibold text-parchment transition active:scale-[0.98]"
          >
            Get started
          </Link>
        </nav>

        <button
          onClick={() => setOpen(!open)}
          aria-label="Menu"
          className="rounded-full border border-ink/30 px-4 py-2 text-sm font-medium sm:hidden"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {open && (
        <nav className="border-t border-ink/15 px-5 pb-5 sm:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block border-b border-ink/10 py-3 font-medium text-ink/80"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/signup"
            onClick={() => setOpen(false)}
            className="mt-4 block rounded-full bg-forest-deep py-3 text-center font-semibold text-parchment"
          >
            Get started
          </Link>
        </nav>
      )}
    </header>
  );
}
