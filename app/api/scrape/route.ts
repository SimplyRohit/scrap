import { runBrightDataCollector } from "@/lib/brightdataScraper";
import { Dependency } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dependencies } = body as { dependencies: Dependency[] };

    if (!dependencies || !Array.isArray(dependencies)) {
      return NextResponse.json({ error: "Missing dependencies array" }, { status: 400 });
    }

    const scrapedResults: Record<string, any> = {};

    for (const dep of dependencies) {
      const { collector, releaseItem } = await runBrightDataCollector(dep);
      scrapedResults[dep.name] = {
        collectorId: collector.collectorId,
        wasSelfHealed: collector.status === 'healed',
        releaseItem,
        collector
      };
    }

    return NextResponse.json({
      success: true,
      scrapedResults
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Scraping failed" }, { status: 500 });
  }
}
