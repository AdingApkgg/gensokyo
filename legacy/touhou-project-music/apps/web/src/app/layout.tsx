import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PlayerBar } from '@/components/player-bar';
import './globals.css';

export const metadata: Metadata = {
  title: '东方同人音乐站',
  description: '东方 Project 同人音乐聚合、在线试听与下载',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {children}
        <PlayerBar />
      </body>
    </html>
  );
}
