/**
 * Seed FAQ chunks into Supabase with Gemini embeddings.
 *
 * Reads markdown files from scripts/faq/, splits each into chunks by H2 sections,
 * generates embeddings via Gemini gemini-embedding-001, inserts into faq_chunks.
 *
 * Run: node scripts/seed-faq.js
 * Idempotent: deletes existing rows for each source file before inserting.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const FAQ_DIR = path.join(__dirname, 'faq');
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 1536;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

/**
 * Splits a markdown file into chunks by H2 (##) headings.
 * Each chunk carries the H1 title for context.
 */
function chunkMarkdown(content, filename) {
  const lines = content.split('\n');
  let h1 = '';
  let current = { title: '', body: [] };
  const chunks = [];

  for (const line of lines) {
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      h1 = line.replace(/^# /, '').trim();
    } else if (line.startsWith('## ')) {
      if (current.body.length > 0) {
        chunks.push({
          source: filename,
          title: current.title || h1,
          content: current.body.join('\n').trim(),
        });
      }
      current = { title: line.replace(/^## /, '').trim(), body: [] };
    } else if (current.body.length > 0 || line.trim() !== '') {
      current.body.push(line);
    }
  }
  if (current.body.length > 0) {
    chunks.push({
      source: filename,
      title: current.title || h1,
      content: current.body.join('\n').trim(),
    });
  }
  return chunks;
}

/**
 * Calls Gemini's embedContent endpoint. Returns a 768-dim vector.
 */
async function embedText(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${process.env.GEMINI_API_KEY}`;
  const body = {
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
    outputDimensionality: EMBEDDING_DIMENSIONS,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText}`);
  }

  const json = await res.json();
  if (!json.embedding || !json.embedding.values) {
    throw new Error(`Unexpected Gemini response: ${JSON.stringify(json)}`);
  }
  return json.embedding.values;
}

async function main() {
  console.log('Reading FAQ markdown files...');
  const files = fs.readdirSync(FAQ_DIR).filter((f) => f.endsWith('.md'));
  console.log(`Found ${files.length} files.`);

  for (const filename of files) {
    const raw = fs.readFileSync(path.join(FAQ_DIR, filename), 'utf8');
    // Strip the disclaimer line from the embedded content (not useful for retrieval)
    const content = raw
      .split('\n')
      .filter((line) => !line.startsWith('Fictional content for portfolio'))
      .join('\n');

    const chunks = chunkMarkdown(content, filename);
    console.log(`\n${filename}: ${chunks.length} chunks`);

    // Idempotency: clear existing chunks for this source
    const { error: deleteError } = await supabase
      .from('faq_chunks')
      .delete()
      .eq('source', filename);
    if (deleteError) throw deleteError;

    for (const chunk of chunks) {
      const embedding = await embedText(chunk.content);
      const { error: insertError } = await supabase.from('faq_chunks').insert({
        source: chunk.source,
        title: chunk.title,
        content: chunk.content,
        embedding,
      });
      if (insertError) throw insertError;
      console.log(`  ✓ ${chunk.title}`);
    }
  }

  console.log('\nDone. Verifying total count...');
  const { count } = await supabase
    .from('faq_chunks')
    .select('*', { count: 'exact', head: true });
  console.log(`Total faq_chunks rows: ${count}`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
