import { desc } from 'drizzle-orm';
import { db, submission } from '@thm/db';
import { SubmissionActions } from '@/components/admin/submission-actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const STATUS_LABEL = {
  pending: { text: '待审核', cls: 'bg-amber-100 text-amber-700' },
  approved: { text: '已通过', cls: 'bg-green-100 text-green-700' },
  rejected: { text: '已拒绝', cls: 'bg-red-100 text-red-700' },
} as const;

export default async function SubmissionsPage() {
  const rows = await db
    .select()
    .from(submission)
    .orderBy(desc(submission.createdAt))
    .limit(50);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">投稿审核</h1>
        <span className="text-muted-foreground text-sm">最近 50 条</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无投稿。</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => {
            const label = STATUS_LABEL[row.status];
            return (
              <Card key={row.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                  <div>
                    <CardTitle className="text-base">{row.kind}</CardTitle>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {new Date(row.createdAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-xs ${label.cls}`}>{label.text}</span>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <pre className="bg-muted max-h-60 overflow-auto rounded-md p-3 text-xs">
                    {JSON.stringify(row.payload, null, 2)}
                  </pre>
                  {row.reviewNote ? (
                    <div className="text-muted-foreground text-xs">
                      审核备注：{row.reviewNote}
                    </div>
                  ) : null}
                  {row.status === 'pending' ? <SubmissionActions id={row.id} /> : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
