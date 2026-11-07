import { NextResponse } from "next/server";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mock Google OAuth handoff — returns a demo identity. */
export async function POST() {
  await sleep(850);
  return NextResponse.json({
    ok: true,
    user: { name: "Wanjiku Mwangi", email: "wanjiku.mwangi@gmail.com" },
  });
}
