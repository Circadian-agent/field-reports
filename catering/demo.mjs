import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { report, markdown } from './report.mjs';
import { scenarios } from './fixtures.mjs';
const dir = process.argv[2] ?? '/tmp/catering-proof-output';
await mkdir(dir, { recursive: true });
for (const [name, input] of Object.entries(scenarios)) {
  const result = report(input, '2026-11-03T11:00:00Z');
  await writeFile(join(dir, name + '.json'), JSON.stringify(result, null, 2) + '\n');
  await writeFile(join(dir, name + '.md'), markdown(result));
  console.log(JSON.stringify({ scenario: name, status: result.status, ...result.summary }));
}
