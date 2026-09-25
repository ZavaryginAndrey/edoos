import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Минимальный рендер Markdown для плана коуча: заголовки, списки, таблицы, абзацы, **жирный**, *курсив*, `код`.
// Без dangerouslySetInnerHTML — ответ модели выводится только как текст. Типографика — shadcn/typeset (app/typeset.css).

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "paragraph"; text: string };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Extract<Block, { type: "list" }> | null = null;
  let table: Extract<Block, { type: "table" }> | null = null;

  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    if (list) blocks.push(list);
    if (table) blocks.push(table);
    paragraph = [];
    list = null;
    table = null;
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);

    if (!line) {
      flush();
    } else if (line.startsWith("|")) {
      if (!table) flush();
      // Строку-разделитель |---|:--:| пропускаем: первая строка таблицы всегда считается заголовком.
      if (/^\|[\s:|-]+\|?$/.test(line)) continue;
      table ??= { type: "table", rows: [] };
      table.rows.push(line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
    } else if (heading) {
      flush();
      blocks.push({ type: "heading", level: Math.min(heading[1].length, 3) as 1 | 2 | 3, text: heading[2] });
    } else if (bullet || numbered) {
      if (table) flush();
      const ordered = Boolean(numbered);
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      list ??= { type: "list", ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line}`;
    } else {
      if (list || table) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

type MarkdownProps = {
  source: string;
  /** Не выводить ведущий заголовок первого уровня — когда заголовок уже есть снаружи (например, в CardTitle). */
  hideTitle?: boolean;
  className?: string;
};

export function Markdown({ source, hideTitle, className }: MarkdownProps) {
  let blocks = parse(source);
  if (hideTitle && blocks[0]?.type === "heading" && blocks[0].level === 1) blocks = blocks.slice(1);

  return (
    <div className={cn("typeset", className)}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Tag = `h${block.level}` as const;
          return <Tag key={index}>{inline(block.text)}</Tag>;
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return <Tag key={index}>{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</Tag>;
        }
        if (block.type === "table") {
          const [head, ...body] = block.rows;
          return (
            <div key={index} className="typeset-scroll">
              <table className="min-w-full">
                <thead>
                  <tr>{head.map((cell, i) => <th key={i}>{inline(cell)}</th>)}</tr>
                </thead>
                <tbody>
                  {body.map((row, r) => (
                    <tr key={r}>{row.map((cell, i) => <td key={i}>{inline(cell)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={index}>{inline(block.text)}</p>;
      })}
    </div>
  );
}
