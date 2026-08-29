export const metadata = { title: "离线" };

export default function Offline() {
  return (
    <div className="container mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold">网络连接不稳定</h1>
      <p className="mt-2 text-muted-foreground">
        你当前处于离线模式。上次浏览过的页面仍可访问，其他内容将在联网后恢复。
      </p>
    </div>
  );
}
