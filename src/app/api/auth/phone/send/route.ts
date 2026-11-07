import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  phone: z.string().regex(/^\+\d{9,15}$/, "Phone must be in E.164 format, e.g. +254712345678"),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEMO_CODE = "123456";

/** Mock OTP delivery. In production this would call an SMS provider. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "That phone number doesn't look valid." },
      { status: 400 }
    );
  }

  await sleep(850);
  // devCode is returned so the demo is testable end-to-end without an SMS provider
  return NextResponse.json({ ok: true, devCode: DEMO_CODE });
}
