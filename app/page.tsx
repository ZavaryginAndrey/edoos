"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUpIcon, CircleAlertIcon, FlaskConicalIcon, LeafIcon, TerminalIcon } from "lucide-react";
import type { HealthChatMessage } from "@/src/chat/messages";
import { MAX_ROUNDS } from "@/components/agent-result";
import { ChatMessage } from "@/components/chat/message";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Тестовый режим из URL (только dev): ?coach=test-revise&reviewer=test-revise&minRounds=2
type TestOptions = { minRounds?: number; prompts?: { coach?: string; reviewer?: string } };

function readTestOptions(search: string): TestOptions | null {
  const params = new URLSearchParams(search);
  const coach = params.get("coach") ?? undefined;
  const reviewer = params.get("reviewer") ?? undefined;
  const minRounds = params.has("minRounds") ? Number(params.get("minRounds")) : undefined;
  if (!coach && !reviewer && minRounds === undefined) return null;
  return { minRounds, prompts: coach || reviewer ? { coach, reviewer } : undefined };
}

const SUGGESTIONS = [
  "План питания на завтра с учётом моего лога",
  "Составь список покупок к плану",
  "План на неделю с учётом boulder-тренировок",
  "Как выровнять сон за 7 дней",
];

// Агенту уходит только текст последнего сообщения: каждый запуск независим, историю видит только UI.
const transport = new DefaultChatTransport<HealthChatMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages, body }) => {
    const task = (messages.at(-1)?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
    return { body: { ...body, task } };
  },
});

// Ошибка 400/500 от route приходит текстом тела ответа: {"error": "..."} — показываем только сообщение.
function errorText(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : error.message;
  } catch {
    return error.message;
  }
}

// Прокрутка «прилипает» к низу, пока пользователь сам не отлистал вверх дальше этого порога.
const NEAR_BOTTOM_PX = 120;

export default function Home() {
  const [input, setInput] = useState("");
  const [testOptions, setTestOptions] = useState<TestOptions | null>(null);
  useEffect(() => setTestOptions(readTestOptions(window.location.search)), []);
  const { messages, sendMessage, status, error } = useChat<HealthChatMessage>({ transport });
  const running = status === "submitted" || status === "streaming";
  const canSend = !running && Boolean(input.trim());

  // Состояние «у низа» обновляют только прокрутки: рост контента его не сбрасывает.
  const stickToBottom = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      const distance = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      stickToBottom.current = distance <= NEAR_BOTTOM_PX;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (stickToBottom.current) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [messages, status, error]);

  function send() {
    if (!canSend) return;
    stickToBottom.current = true;
    sendMessage({ text: input.trim() }, { body: testOptions ?? {} });
    setInput("");
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-2xl flex-col px-4">
      <header className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-2.5 text-sm font-medium">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LeafIcon className="size-4" />
          </span>
          Health Coach
        </div>
        <div className="flex items-center gap-1">
          {/* Replay и evals — только в dev, как и тестовый режим. */}
          {process.env.NODE_ENV !== "production" && (
            <Link href="/dev" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground")}>
              <TerminalIcon />
              Dev
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>

      {testOptions && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <FlaskConicalIcon className="size-3.5" />
            Тестовый режим
          </span>
          {testOptions.prompts?.coach && <span>coach <span className="font-mono">{testOptions.prompts.coach}</span></span>}
          {testOptions.prompts?.reviewer && <span>reviewer <span className="font-mono">{testOptions.prompts.reviewer}</span></span>}
          {testOptions.minRounds !== undefined && <span>minRounds <span className="font-mono">{testOptions.minRounds}</span></span>}
        </div>
      )}

      <main className="flex-1 pb-6">
        {messages.length === 0 ? (
          <section className="pt-12 sm:pt-20">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Персональный план без лишней воды</h1>
            <p className="mt-3 max-w-xl text-pretty text-muted-foreground">
              Коуч составляет план по вашему профилю и дневнику, Safety Reviewer проверяет его на безопасность —
              до {MAX_ROUNDS} раундов правок. Каждый шаг виден по ходу работы.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  className="rounded-full font-normal text-muted-foreground"
                  onClick={() => setInput(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </section>
        ) : (
          <div className="space-y-8 pt-6">
            {messages.map((message, index) => (
              <ChatMessage key={message.id} message={message} running={running && index === messages.length - 1} />
            ))}
            {status === "submitted" && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Spinner aria-label="Загрузка" />
                Запускаю агента…
              </p>
            )}
            {error && (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Не удалось получить план</AlertTitle>
                <AlertDescription>{errorText(error)}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </main>

      <form
        className="sticky bottom-0 bg-background pt-2 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {/* has-disabled:* у InputGroup срабатывает и на заблокированную кнопку — поле при этом гаснуть не должно. */}
        <InputGroup className="bg-background shadow-xs has-disabled:bg-background has-disabled:opacity-100 dark:bg-input/30 dark:has-disabled:bg-input/30">
          <InputGroupTextarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            disabled={running}
            placeholder={running ? "Агент работает…" : "Например: составь план питания на завтра"}
            aria-label="Задача для коуча"
            className="max-h-48 min-h-12 px-3.5 pt-3 text-base md:text-base"
          />
          <InputGroupAddon align="block-end" className="gap-3 px-3 pb-3">
            <span className="hidden items-center gap-1.5 text-xs font-normal sm:flex">
              <Kbd>Enter</Kbd> отправить, <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> перенос
            </span>
            <InputGroupButton type="submit" variant="default" size="sm" className="ml-auto" disabled={!canSend}>
              {running ? <Spinner aria-label="Загрузка" /> : <ArrowUpIcon />}
              {running ? "Работает…" : "Отправить"}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
