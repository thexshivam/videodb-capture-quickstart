import React from 'react';

interface MainContentProps {
  title: string;
  children: React.ReactNode;
}

export function MainContent({ title, children }: MainContentProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header with drag region - h-14 matches sidebar spacing for traffic lights */}
      <header className="h-14 flex items-center px-4 border-b drag-region">
        <h1 className="text-lg font-semibold no-drag">{title}</h1>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
