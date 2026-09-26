import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { devEnabled } from "@/src/dev/devOnly";
import { describeExpect, listEvalCases } from "@/src/dev/evals";
import { listTraces } from "@/src/dev/replay";
import { DevConsole } from "./dev-console";

export const metadata: Metadata = { title: "Dev — Health Coach" };
// Списки читаются с диска на каждый запрос: после запуска router.refresh() подтягивает новый трейс.
export const dynamic = "force-dynamic";

export default async function DevPage() {
  if (!devEnabled()) notFound();
  const [traces, cases] = await Promise.all([listTraces(), listEvalCases()]);
  // src/dev/* читает файлы и в клиентский бандл не идет, поэтому подпись ожидания считаем здесь.
  return <DevConsole traces={traces} cases={cases.map((testCase) => ({ ...testCase, expected: describeExpect(testCase.expect) }))} />;
}
