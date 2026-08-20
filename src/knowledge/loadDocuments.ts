import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// pdf-parse is CommonJS; Node's ESM/CJS interop exposes its module.exports as the default.
import pdfParse from 'pdf-parse';

export interface KnowledgeChunk {
  id: string;
  text: string;
  source: string;
}

const DOCUMENTS_DIR = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  'Documents',
);

const MIN_CHUNK_LENGTH = 40;
const MAX_CHUNK_LENGTH = 800;

/** Splits extracted PDF text into paragraph-sized chunks, merged up to ~800 chars. */
function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length >= MIN_CHUNK_LENGTH);

  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 1 > MAX_CHUNK_LENGTH) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current} ${paragraph}` : paragraph;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

async function loadPdfText(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const { text } = await pdfParse(buffer);
  return text;
}

async function loadAllDocuments(): Promise<KnowledgeChunk[]> {
  let filenames: string[];
  try {
    const entries = await readdir(DOCUMENTS_DIR);
    filenames = entries.filter((entry) => entry.toLowerCase().endsWith('.pdf'));
  } catch (error) {
    console.error(`[knowledge] could not read documents directory ${DOCUMENTS_DIR}:`, error);
    return [];
  }

  const chunks: KnowledgeChunk[] = [];
  for (const filename of filenames) {
    const filePath = path.join(DOCUMENTS_DIR, filename);
    try {
      const text = await loadPdfText(filePath);
      const pieces = chunkText(text);
      pieces.forEach((piece, index) => {
        chunks.push({ id: `${filename}#${index}`, text: piece, source: filename });
      });
      console.log(`[knowledge] loaded ${filename}: ${pieces.length} chunks`);
    } catch (error) {
      console.error(`[knowledge] failed to parse ${filename}:`, error);
    }
  }
  console.log(
    `[knowledge] indexed ${chunks.length} chunks from ${filenames.length} document(s) in ${DOCUMENTS_DIR}`,
  );
  return chunks;
}

let cachedChunks: Promise<KnowledgeChunk[]> | undefined;

/** Lazily extracts and caches all PDF chunks for the lifetime of the process. */
export function getKnowledgeChunks(): Promise<KnowledgeChunk[]> {
  if (!cachedChunks) {
    cachedChunks = loadAllDocuments();
  }
  return cachedChunks;
}
