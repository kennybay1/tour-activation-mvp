import type { Metadata } from "next";
import RequestAccessForm from "./request-form";

export const metadata: Metadata = { title: "Talk to us" };

export default function RequestAccessPage() {
  return <RequestAccessForm />;
}
