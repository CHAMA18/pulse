import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  phone: z.string().regex(/^\+\d{9,15}$/),
  code: z.string().regex(/^\d{6}$/),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEMO_CODE = "123456";

/** Mock OTP verification. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Enter the 6-digit code." }, { status: 400 });
  }

  await sleep(750);

  if (parsed.data.code !== DEMO_CODE) {
    return NextResponse.json(
      { ok: false, message: "That code isn't right. Please try again." },
      { status: 401 }
    );
  }

  return NextResponse.json({ ok: true, user: { phone: parsed.data.phone } });
}
