import { NextResponse } from "next/server";

// Lets the fan page correct for a wrong client clock when computing
// countdowns — client clocks are frequently skewed by minutes or hours.
export async function GET() {
  return NextResponse.json(
    { now: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
