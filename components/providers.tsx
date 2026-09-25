"use client";

import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";

// next-themes рендерит inline <script>, чтобы выставить тему до первой отрисовки. React 19 предупреждает
// о <script> в клиентских компонентах, поэтому на клиенте помечаем его как неисполняемый: он уже отработал
// в серверном HTML.
const scriptProps = typeof window === "undefined" ? undefined : ({ type: "application/json" } as const);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange scriptProps={scriptProps}>
      <TooltipProvider>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
