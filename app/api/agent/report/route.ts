import { NextResponse, type NextRequest } from 'next/server';

import { recordFixOutcome, type FixReport } from '@/lib/engine/feedback';
import type { Ecosystem, MigrationStep } from '@/lib/engine/knowledge';

export const runtime = 'nodejs';

/**
 * POST /api/agent/report — gen.md section 20.
 *
 * The write-back half of the loop in section 19. An agent that applied a fix and
 * ran the repository's checks reports the outcome here; success reinforces the
 * knowledge it acted on, failure marks that knowledge contradicted.
 *
 * Reporting a failure is as useful as reporting a success, so this endpoint
 * accepts both and never treats a failed report as an error.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      package?: string;
      ecosystem?: Ecosystem;
      version?: string;
      previousVersion?: string;
      error?: string;
      stackTrace?: string;
      fix?: MigrationStep[];
      summary?: string;
      derivedFrom?: string[];
      validation?: FixReport['validation'];
      repository?: string;
    };

    if (!body.package) return NextResponse.json({ error: 'Missing `package`' }, { status: 400 });
    if (!body.summary) return NextResponse.json({ error: 'Missing `summary`' }, { status: 400 });
    if (!body.validation || Object.keys(body.validation).length === 0) {
      return NextResponse.json(
        { error: 'Missing `validation` — a fix without a validation result is not evidence' },
        { status: 400 },
      );
    }

    const result = await recordFixOutcome({
      package: body.package,
      ecosystem: body.ecosystem,
      version: body.version,
      previousVersion: body.previousVersion,
      error: body.error,
      stackTrace: body.stackTrace,
      fix: body.fix ?? [],
      summary: body.summary,
      derivedFrom: body.derivedFrom,
      validation: body.validation,
      repository: body.repository,
    });

    return NextResponse.json({
      success: true,
      validated: result.succeeded,
      message: result.message,
      knowledgeId: result.recorded?.id ?? null,
      confidence: result.recorded?.confidence ?? null,
      provenance: result.recorded?.provenance ?? null,
      validation: result.recorded?.validation ?? null,
      reinforced: result.reinforced,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record fix outcome';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
