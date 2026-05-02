export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-y-auto px-6 py-8">{children}</div>;
}
