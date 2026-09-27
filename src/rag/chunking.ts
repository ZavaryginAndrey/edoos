// Чанкинг базы знаний: 1 секция «## …» = 1 чанк. Текст до первого «##» (заголовок файла «# …») не попадает
// в чанки. Секции без текста пропускаются.

export type Chunk = { file: string; heading: string; content: string };

export function chunkMarkdown(file: string, markdown: string): Chunk[] {
  const sections = markdown.replace(/\r\n/g, "\n").split(/^##[^\S\n]+/m).slice(1);
  return sections.flatMap((section) => {
    const [heading, ...body] = section.split("\n");
    const content = body.join("\n").trim();
    return heading.trim() && content ? [{ file, heading: heading.trim(), content }] : [];
  });
}

// Что уходит в embedding: заголовок несёт основной смысл секции («Индейка с киноа, без молочки»), поэтому
// он идёт вместе с телом.
export const embeddingText = ({ heading, content }: Chunk) => `${heading}\n\n${content}`;
