import { parseDependencyManifest } from "@/lib/dependencyParsers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { content, fileName } = body;

    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "Missing or invalid manifest content" }, { status: 400 });
    }

    const result = parseDependencyManifest(content, fileName);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to parse manifest" }, { status: 500 });
  }
}
