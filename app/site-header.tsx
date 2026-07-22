"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { GuardedLink, useUnsavedChanges } from "./unsaved-changes";

// One header for the whole product — the marketing chrome persists across
// signed-in organiser pages so the dashboard and the site feel like one
// thing, not two. (This supersedes the earlier decision that /dashboard
// got its own minimal header.)
//
// Session awareness works two ways:
// - The dashboard layout knows the user server-side and passes `session`
//   (org name + admin flag) directly.
// - Marketing pages pass nothing, staying statically prerendered; the
//   header then checks the browser's own Supabase session after mount and
//   swaps the actions if one exists. Signed-out visitors see the exact
//   pre-existing header either way.

type SessionInfo = { orgName: string; isAdmin: boolean };

const MARKETING_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#use-cases", label: "Use cases" },
  { href: "/faq", label: "FAQ" },
];

export default function SiteHeader({
  session,
}: {
  // undefined = unknown, detect client-side; null = known signed-out;
  // object = known signed-in.
  session?: SessionInfo | null;
}) {
  const [open, setOpen] = useState(false);
  const [detected, setDetected] = useState<SessionInfo | null>(null);
  const guard = useUnsavedChanges();
  const router = useRouter();

  useEffect(() => {
    if (session !== undefined) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled || !data.session) return;
      const u = data.session.user;
      setDetected({
        orgName:
          (u.user_metadata?.org_name as string | undefined) || u.email || "Account",
        // Admin status is only knowable server-side (ADMIN_EMAIL) — the
        // Admin link appears on dashboard pages, where the server vouches.
        isAdmin: false,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const current = session !== undefined ? session : detected;

  const signOut = async () => {
    if (guard && !guard.confirmIfDirty()) return;
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const navLink =
    "text-sm font-medium text-ink/80 underline-offset-4 hover:underline";

  return (
    // Positioned above z-0 content: the dashboard's full-bleed backdrop is
    // a fixed image, and without a stacking order the header would paint
    // underneath it. The translucent cream + blur keeps the ink-coloured
    // links readable over any photo; on plain cream pages it's invisible.
    <header className="relative z-30 border-b border-ink/20 bg-cream/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-4">
        <GuardedLink href="/" className="font-serif text-xl italic">
          Moments
        </GuardedLink>

        {current ? (
          <nav className="hidden items-center gap-6 sm:flex">
            <GuardedLink href="/dashboard" className={navLink}>
              Campaigns
            </GuardedLink>
            {current.isAdmin && (
              <GuardedLink href="/admin" className={navLink}>
                Admin
              </GuardedLink>
            )}
            <span className="max-w-[14rem] truncate text-xs uppercase tracking-[0.2em] text-ink/50">
              {current.orgName}
            </span>
            <button
              onClick={signOut}
              className="rounded-full border border-ink/30 px-4 py-2 text-sm font-medium text-ink/80 transition hover:border-ink/60 active:scale-[0.98]"
            >
              Sign out
            </button>
          </nav>
        ) : (
          <nav className="hidden items-center gap-6 sm:flex">
            {MARKETING_LINKS.map((l) => (
              <GuardedLink key={l.href} href={l.href} className={navLink}>
                {l.label}
              </GuardedLink>
            ))}
            <GuardedLink href="/login" className={navLink}>
              Sign in
            </GuardedLink>
            <GuardedLink
              href="/signup"
              className="rounded-full bg-forest-deep px-5 py-2.5 text-sm font-semibold text-parchment transition active:scale-[0.98]"
            >
              Get started
            </GuardedLink>
          </nav>
        )}

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
          {current ? (
            <>
              <GuardedLink
                href="/dashboard"
                onNavigate={() => setOpen(false)}
                className="block border-b border-ink/10 py-3 font-medium text-ink/80"
              >
                Campaigns
              </GuardedLink>
              {current.isAdmin && (
                <GuardedLink
                  href="/admin"
                  onNavigate={() => setOpen(false)}
                  className="block border-b border-ink/10 py-3 font-medium text-ink/80"
                >
                  Admin
                </GuardedLink>
              )}
              <p className="mt-4 text-xs uppercase tracking-[0.2em] text-ink/50">
                {current.orgName}
              </p>
              <button
                onClick={() => {
                  setOpen(false);
                  signOut();
                }}
                className="mt-3 block w-full rounded-full border border-ink/30 py-3 text-center font-medium text-ink/80"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              {MARKETING_LINKS.map((l) => (
                <GuardedLink
                  key={l.href}
                  href={l.href}
                  onNavigate={() => setOpen(false)}
                  className="block border-b border-ink/10 py-3 font-medium text-ink/80"
                >
                  {l.label}
                </GuardedLink>
              ))}
              <GuardedLink
                href="/login"
                onNavigate={() => setOpen(false)}
                className="block border-b border-ink/10 py-3 font-medium text-ink/80"
              >
                Sign in
              </GuardedLink>
              <GuardedLink
                href="/signup"
                onNavigate={() => setOpen(false)}
                className="mt-4 block rounded-full bg-forest-deep py-3 text-center font-semibold text-parchment"
              >
                Get started
              </GuardedLink>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
