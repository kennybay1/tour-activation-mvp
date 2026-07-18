import type { Metadata } from "next";

// Everything under /admin (including the login page) is kept out of
// search engines.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
