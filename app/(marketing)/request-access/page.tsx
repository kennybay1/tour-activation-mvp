import type { Metadata } from "next";
import RequestAccessForm from "./request-form";

export const metadata: Metadata = {
  title: "Talk to us",
  description:
    "Tell us about your artist, release or tour and we'll help you scope a Moments campaign.",
};

export default function RequestAccessPage() {
  return <RequestAccessForm />;
}
