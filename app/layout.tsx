import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "开饭 · Harness Demo Lite",
  description: "一个可观察、可审批、可恢复的 30 分钟烹饪 Agent Demo。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
