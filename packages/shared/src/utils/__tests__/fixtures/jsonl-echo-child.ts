// Echoes every JSON line it reads from stdin back on stdout, through the shared reader.
// Used by jsonl-lines.test.ts; runs under Bun and Node.
import { readLines } from '../../jsonl-lines.ts';

readLines(process.stdin, {
  onLine: (line) => {
    if (line.trim()) process.stdout.write(`${JSON.stringify(JSON.parse(line))}\n`);
  },
});
