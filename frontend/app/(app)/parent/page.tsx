import Link from "next/link";
import { cookies } from "next/headers";
import { backend } from "@/lib/backend";

export default async function ParentDashboard() {
  const jar = await cookies();
  const session = jar.get("session")?.value;
  const headers = session ? { Cookie: `session=${session}` } : undefined;

  const [account, learners] = await Promise.all([
    backend.auth.me(headers),
    backend.learners.list(headers),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 border-b pb-6">
        <h1 className="mb-2 text-2xl font-medium">欢迎，{account.name} 家长</h1>
        <p className="text-muted-foreground text-sm">在这里管理孩子信息、教材和学习进度。</p>
      </div>

      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">我的孩子</h2>
          <Link href="/parent/learners" className="text-sm text-blue-500 hover:underline">
            管理 / 添加
          </Link>
        </div>
        
        {learners.length === 0 ? (
          <div className="border-border rounded-lg border border-dashed p-6 text-center">
            <p className="text-muted-foreground mb-4 text-sm">还没有添加任何孩子信息</p>
            <Link 
              href="/parent/learners"
              className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm transition"
            >
              去添加
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {learners.map((learner) => (
              <div key={learner.id} className="border-border flex items-center justify-between rounded-lg border p-4">
                <span className="font-medium">{learner.name}</span>
                {account.last_active_learner_id === learner.id && (
                  <span className="bg-primary/10 text-primary rounded px-2 py-1 text-xs font-medium">
                    上次使用
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-8">
        <h2 className="mb-4 text-lg font-medium">功能中心</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link 
            href="/parent/learners"
            className="border-border hover:border-primary flex flex-col items-start rounded-lg border p-5 transition"
          >
            <span className="font-medium">孩子管理</span>
            <span className="text-muted-foreground mt-1 text-sm">增加、修改或删除孩子信息</span>
          </Link>
          
          <div className="border-border flex flex-col items-start rounded-lg border p-5 opacity-50">
            <span className="font-medium">教材管理</span>
            <span className="text-muted-foreground mt-1 text-sm">规划和导入学习材料 (即将上线)</span>
          </div>
          
          <div className="border-border flex flex-col items-start rounded-lg border p-5 opacity-50">
            <span className="font-medium">学习进度</span>
            <span className="text-muted-foreground mt-1 text-sm">查看孩子的掌握情况 (即将上线)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
