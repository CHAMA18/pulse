import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  email: z.string().email().max(254),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mock password-reset request — always succeeds (never leaks account existence). */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Enter a valid email address." }, { status: 400 });
  }

  await sleep(800);
  return NextResponse.json({ ok: true });
}
