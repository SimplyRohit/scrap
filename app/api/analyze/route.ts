import { analyzeBlastRadius } from "@/lib/blastRadiusEngine";
import { runBrightDataCollector } from "@/lib/brightdataScraper";
import { Dependency } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dependencies, scrapedMap } = body as { dependencies: Dependency[]; scrapedMap?: Record<string, any> };

    if (!dependencies || !Array.isArray(dependencies)) {
      return NextResponse.json({ error: "Missing dependencies array" }, { status: 400 });
    }

    let finalScrapedMap = scrapedMap;
    if (!finalScrapedMap) {
      finalScrapedMap = {};
      for (const dep of dependencies) {
        const { collector, releaseItem } = await runBrightDataCollector(dep);
        finalScrapedMap[dep.name] = {
          collectorId: collector.collectorId,
          wasSelfHealed: collector.status === 'healed',
          releaseItem,
          collector
        };
      }
    }

    const analysis = analyzeBlastRadius(dependencies, finalScrapedMap);
    return NextResponse.json({ success: true, analysis });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Analysis failed" }, { status: 500 });
  }
}
