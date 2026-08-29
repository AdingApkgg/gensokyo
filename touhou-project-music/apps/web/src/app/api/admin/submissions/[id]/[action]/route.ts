import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, submission } from '@thm/db';

const bodySchema = z.object({ note: z.string().max(500).optional() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  }
  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  const note = body.success ? body.data.note : undefined;

  const [row] = await db
    .update(submission)
    .set({
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewNote: note ?? null,
      reviewedAt: new Date(),
    })
    .where(eq(submission.id, id))
    .returning();

  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, row });
}
