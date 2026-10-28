import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SAMPLE_FIXTURES = [
  'sample-pub-quiz.json',
  'quiz-80s-night.json',
  'quiz-science-lab.json',
  'quiz-world-cinema.json',
  'quiz-sports-legends.json',
  '8f160460-a1b2-4c3d-8e9f-0a1b2c3d4e5f.json',
  '2660f74a-b2c3-4d5e-9f0a-1b2c3d4e5f6a.json',
];

/** Copy all sample quiz fixtures into data/quizzes on boot. */
export async function seedSampleQuiz(dataDir: string) {
  const destDir = path.join(dataDir, 'quizzes');
  await fs.mkdir(destDir, { recursive: true });
  const fixturesDir = path.resolve(__dirname, '../fixtures');
  for (const file of SAMPLE_FIXTURES) {
    const src = path.join(fixturesDir, file);
    const dest = path.join(destDir, file);
    try {
      await fs.copyFile(src, dest);
      console.log(`   Seeded sample quiz → ${dest}`);
    } catch (err) {
      console.warn(`   Skip seed ${file}:`, err instanceof Error ? err.message : err);
    }
  }
}
