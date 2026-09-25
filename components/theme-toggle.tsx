"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Сменить тему"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          />
        }
      >
        {/* Иконка выбирается через CSS, чтобы не было рассинхрона при гидрации. */}
        <SunIcon className="hidden dark:block" />
        <MoonIcon className="dark:hidden" />
      </TooltipTrigger>
      <TooltipContent>Сменить тему</TooltipContent>
    </Tooltip>
  );
}
