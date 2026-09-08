/**
 * `ubml import` — a transcript the rest of the workspace can trust.
 *
 * The case that matters is the one that nearly shipped: Teams writes a long
 * utterance as a run of cues and closes the speaker tag only on the last, so a
 * parser matching open-close pairs keeps the final fragment and drops the rest
 * without saying so.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

let dir: string;
const ubmlBin = resolve(process.cwd(), 'dist', 'cli.js');

// One utterance split across three cues, the tag opening on the first and
// closing on the third - which is what Teams writes and what a pair-matching
// parser loses two thirds of.
const RUN = `WEBVTT

1
00:00:04.316 --> 00:00:06.756
<v David Hudec>So we don't put in items,

2
00:00:06.756 --> 00:00:09.120
we don't have to check availability,

3
00:00:09.120 --> 00:00:12.058
it's just the code.</v>

4
00:00:13.000 --> 00:00:15.400
<v Jan Zmeskal>Yes, exactly.</v>
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ubml-import-'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string): string {
  try {
    return execSync(`node ${ubmlBin} import ${args}`, {
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0' },
    });
  } catch (error: unknown) {
    const failed = error as { stdout?: string; stderr?: string };
    // `||`, not `??`: a command that exits non-zero has an empty stdout, and
    // what it said is on stderr.
    return failed.stdout || failed.stderr || '';
  }
}

describe('ubml import', () => {
  it('keeps the cues that carry no speaker tag of their own', () => {
    const vtt = join(dir, 'meeting.vtt');
    const out = join(dir, 'meeting.md');
    writeFileSync(vtt, RUN, 'utf8');

    run(`"${vtt}" -o "${out}"`);
    const text = readFileSync(out, 'utf8');

    // All three fragments, not only the one that closed the tag.
    expect(text).toContain("So we don't put in items");
    expect(text).toContain('we don\'t have to check availability');
    expect(text).toContain("it's just the code.");
  });

  it('gives a run of cues one turn, attributed to whoever opened it', () => {
    const vtt = join(dir, 'meeting.vtt');
    const out = join(dir, 'meeting.md');
    writeFileSync(vtt, RUN, 'utf8');

    run(`"${vtt}" -o "${out}"`);
    const turns = readFileSync(out, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('['));

    expect(turns).toHaveLength(2);
    expect(turns[0]).toContain('David Hudec');
    expect(turns[0]).toContain('[00:00:04]');
    expect(turns[1]).toContain('Jan Zmeskal');
  });

  it('refuses a file whose tags it cannot read at all', () => {
    const vtt = join(dir, 'odd.vtt');
    writeFileSync(vtt, 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n\n', 'utf8');

    expect(run(`"${vtt}" -o "${join(dir, 'odd.md')}"`)).toContain('none carried words');
  });

  it('reads only what it can read verbatim', () => {
    const docx = join(dir, 'meeting.docx');
    writeFileSync(docx, 'not really a docx', 'utf8');

    expect(run(`"${docx}"`)).toContain('Only .vtt');
  });
});
