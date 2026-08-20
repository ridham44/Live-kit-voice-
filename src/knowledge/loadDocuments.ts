import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// pdf-parse is CommonJS; Node's ESM/CJS interop exposes its module.exports as the default.
import pdfParse from 'pdf-parse';

export interface KnowledgeChunk {
  id: string;
  text: string;
  source: string;
}

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const DOCUMENTS_DIR = path.join(REPO_ROOT, 'Documents');
// PDF parsing (especially the larger brochures) is the slowest part of startup — cache the
// extracted chunks on disk so only the very first run (or a change to the source PDFs) pays
// that cost. Invalidated automatically via a signature of each PDF's size + mtime.
const CACHE_FILE = path.join(REPO_ROOT, '.cache', 'knowledge-chunks.json');

interface KnowledgeCache {
  signature: string;
  chunks: KnowledgeChunk[];
}

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

/** Cheap fingerprint (no parsing) used to detect whether the cached chunks are stale. */
async function computeSignature(filenames: string[]): Promise<string> {
  const parts = await Promise.all(
    filenames.map(async (filename) => {
      const info = await stat(path.join(DOCUMENTS_DIR, filename));
      return `${filename}:${info.size}:${info.mtimeMs}`;
    }),
  );
  return parts.sort().join('|');
}

async function readCache(signature: string): Promise<KnowledgeChunk[] | undefined> {
  try {
    const raw = JSON.parse(await readFile(CACHE_FILE, 'utf-8')) as KnowledgeCache;
    if (raw.signature === signature) {
      return raw.chunks;
    }
  } catch {
    // No cache yet, or it's corrupt/stale — fall through to a fresh parse.
  }
  return undefined;
}

async function writeCache(signature: string, chunks: KnowledgeChunk[]): Promise<void> {
  try {
    await mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify({ signature, chunks } satisfies KnowledgeCache));
  } catch (error) {
    console.error(`[knowledge] failed to write cache at ${CACHE_FILE}:`, error);
  }
}

async function loadAllDocuments(): Promise<KnowledgeChunk[]> {
  let filenames: string[];
  try {
    const entries = await readdir(DOCUMENTS_DIR);
    filenames = entries.filter((entry) => entry.toLowerCase().endsWith('.pdf')).sort();
  } catch (error) {
    console.error(`[knowledge] could not read documents directory ${DOCUMENTS_DIR}:`, error);
    return [];
  }

  const signature = await computeSignature(filenames);
  const cached = await readCache(signature);
  if (cached) {
    console.log(`[knowledge] loaded ${cached.length} chunks from cache (${CACHE_FILE})`);
    return cached;
  }

  const startedAt = Date.now();
  const chunks: KnowledgeChunk[] = [];
  for (const filename of filenames) {
    const filePath = path.join(DOCUMENTS_DIR, filename);
    const fileStartedAt = Date.now();
    try {
      const text = await loadPdfText(filePath);
      const pieces = chunkText(text);
      pieces.forEach((piece, index) => {
        chunks.push({ id: `${filename}#${index}`, text: piece, source: filename });
      });
      console.log(
        `[knowledge] parsed ${filename}: ${pieces.length} chunks in ${Date.now() - fileStartedAt}ms`,
      );
    } catch (error) {
      console.error(`[knowledge] failed to parse ${filename}:`, error);
    }
  }
  console.log(
    `[knowledge] indexed ${chunks.length} chunks from ${filenames.length} document(s) in ${Date.now() - startedAt}ms`,
  );

  await writeCache(signature, chunks);
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
