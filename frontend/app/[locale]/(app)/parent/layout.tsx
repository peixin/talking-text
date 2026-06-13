export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>;
}
