"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import Link from "next/link";

// Losing a half-built multi-location campaign to a stray click is the
// failure this module prevents. The campaign form reports its dirty state
// here; every navigation affordance that can leave the builder (header
// links, "← Campaigns", breadcrumbs, Cancel, sign-out) asks before going.
//
// A ref, not state: dirtiness changes on every keystroke and must never
// re-render the header. Only the moment of navigation reads it.

type UnsavedChangesApi = {
  setDirty: (dirty: boolean) => void;
  // True = safe to navigate (either clean, or the user confirmed).
  confirmIfDirty: () => boolean;
};

const UnsavedChangesContext = createContext<UnsavedChangesApi | null>(null);

const PROMPT =
  "You have unsaved changes to this campaign. Leave without saving?";

export function UnsavedChangesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const dirtyRef = useRef(false);

  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const confirmIfDirty = useCallback(() => {
    if (!dirtyRef.current) return true;
    const leave = window.confirm(PROMPT);
    if (leave) dirtyRef.current = false;
    return leave;
  }, []);

  // Hard navigations (refresh, tab close, external links) go through the
  // browser's own dialog.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const api = useMemo(
    () => ({ setDirty, confirmIfDirty }),
    [setDirty, confirmIfDirty]
  );

  return (
    <UnsavedChangesContext.Provider value={api}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

// Null outside the provider — the header also renders on marketing pages,
// where there is nothing to guard and links must behave as plain links.
export function useUnsavedChanges(): UnsavedChangesApi | null {
  return useContext(UnsavedChangesContext);
}

// A Link that checks for unsaved changes before client-side navigation.
// Degrades to an ordinary Link wherever no provider is mounted.
export function GuardedLink({
  href,
  className,
  onNavigate,
  children,
}: {
  href: string;
  className?: string;
  onNavigate?: () => void;
  children: React.ReactNode;
}) {
  const guard = useUnsavedChanges();
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        if (guard && !guard.confirmIfDirty()) {
          e.preventDefault();
          return;
        }
        onNavigate?.();
      }}
    >
      {children}
    </Link>
  );
}
