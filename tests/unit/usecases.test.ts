/**
 * Use cases: one actor's part of a process, overlaying the process's own steps.
 */

import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION } from '../../src/constants.js';
import { parse, validate } from '../../src/index.js';

const ACTORS = `
ubml: "${SCHEMA_VERSION}"
name: "Actors"
actors:
  AC00001:
    name: "Requester"
    type: role
    kind: human
  AC00002:
    name: "Approver"
    type: role
    kind: human
  AC00003:
    name: "Purchasing system"
    type: system
    kind: system
`;

const indent = (lines: string[], by: number) => lines.map((line) => ' '.repeat(by) + line).join('\n');

const DEFAULT_LINKS = ['- { from: ST00001, to: ST00002 }', '- { from: ST00002, to: ST00003 }'];

/**
 * A purchase request process: the requester submits, the system confirms
 * receipt, the approver decides. Use cases, links and blocks are given as YAML
 * lines; `processes` adds further processes beside it.
 */
const purchasing = (parts: { usecases: string[]; links?: string[]; blocks?: string[]; processes?: string[] }) => `
ubml: "${SCHEMA_VERSION}"
name: "Purchasing"
processes:
  PR00001:
    name: "Purchase request"
    steps:
      ST00001: { name: "Submit request", kind: action, RACI: { responsible: [AC00001] } }
      ST00002: { name: "Confirm receipt", kind: action, RACI: { responsible: [AC00003] } }
      ST00003: { name: "Decide on request", kind: decision, RACI: { responsible: [AC00002] } }
      ST00004: { name: "Revise request", kind: action, RACI: { responsible: [AC00001] } }
      ST00005: { name: "Release order", kind: action, RACI: { responsible: [AC00002] } }
    links:
${indent(parts.links ?? DEFAULT_LINKS, 6)}
${parts.blocks ? `    blocks:\n${indent(parts.blocks, 6)}` : ''}
${parts.usecases.length ? `    usecases:\n${indent(parts.usecases, 6)}` : ''}
${indent(parts.processes ?? [], 2)}
`;

const check = (parts: Parameters<typeof purchasing>[0]) =>
  validate([
    parse(ACTORS, 'actors.actors.ubml.yaml').document!,
    parse(purchasing(parts), 'purchasing.process.ubml.yaml').document!,
  ]);

const SUBMIT = [
  'UC00001:',
  '  name: "Submit a purchase request"',
  '  actor: AC00001',
  '  goal: "Ask for what the team needs"',
  '  steps: [ST00001, ST00002]',
  '  result: "The request waits for a decision"',
];

const without = (field: string) => SUBMIT.filter((line) => !line.includes(`${field}:`));

describe('a use case', () => {
  it('validates when it names an actor and steps of its process', async () => {
    const result = await check({ usecases: SUBMIT });

    expect(result.errors).toEqual([]);
  });

  it.each(['actor', 'steps'])('is an error without %s', async (field) => {
    const result = await check({ usecases: without(field) });

    expect(result.errors.map((e) => e.message)).toContain(`must have required property '${field}'`);
  });

  it('is an error with no steps at all', async () => {
    const result = await check({ usecases: [...without('steps'), '  steps: []'] });

    expect(result.errors.map((e) => e.message)).toContain('must NOT have fewer than 1 items');
  });

  // The use case that follows is derived from the links leaving its steps.
  it('has no field for the next use case', async () => {
    const result = await check({ usecases: [...SUBMIT, '  next: UC00002'] });

    expect(result.errors.map((e) => e.message)).toContain('must NOT have additional properties');
  });

  it('reports an actor the workspace does not define', async () => {
    const result = await check({ usecases: SUBMIT.map((line) => line.replace('AC00001', 'AC00009')) });

    expect(result.errors.some((e) => e.code === 'ubml/undefined-reference' && e.message.includes('AC00009'))).toBe(true);
  });
});

describe('the steps of a use case', () => {
  const DECIDE = ['UC00002:', '  name: "Decide on a purchase request"', '  actor: AC00002', '  steps: [ST00003]'];

  it('belong to one use case only', async () => {
    const result = await check({ usecases: [...SUBMIT, ...DECIDE.map((line) => line.replace('[ST00003]', '[ST00002, ST00003]'))] });
    const found = result.errors.filter((e) => e.code === 'ubml/usecase-shared-step');

    expect(found).toHaveLength(1);
    // Both claimants are named, and the error points at the second claim.
    expect(found[0].message).toContain('"UC00001" and "UC00002"');
    expect(found[0].path).toBe('processes.PR00001.usecases.UC00002.steps[0]');
  });

  it('come from the use case own process', async () => {
    const result = await check({
      usecases: SUBMIT.map((line) => line.replace('[ST00001, ST00002]', '[ST00001, ST00091]')),
      processes: ['PR00009:', '  name: "Supplier onboarding"', '  steps:', '    ST00091: { name: "Register supplier", kind: action }'],
    });

    expect(result.errors.filter((e) => e.code === 'ubml/usecase-foreign-step').map((e) => e.message)).toEqual([
      'Use case "UC00001" lists step "ST00091", which is not a step of its process "PR00001" - a use case covers steps of its own process',
    ]);
  });

  it('may be steps nested inline in a step of the process', async () => {
    const result = await check({
      usecases: [],
      processes: [
        'PR00009:',
        '  name: "Supplier onboarding"',
        '  steps:',
        '    ST00091:',
        '      name: "Onboard supplier"',
        '      kind: subprocess',
        '      steps:',
        '        ST00092: { name: "Check references", kind: action }',
        '  usecases:',
        '    UC00009: { name: "Check a new supplier", actor: AC00002, steps: [ST00092] }',
      ],
    });

    expect(result.errors).toEqual([]);
  });

  it('do not include the steps of a child process', async () => {
    const result = await check({
      usecases: [],
      processes: [
        'PR00009:',
        '  name: "Supplier onboarding"',
        '  steps:',
        '    ST00091: { name: "Register supplier", kind: action }',
        '  usecases:',
        '    UC00009: { name: "Register a supplier", actor: AC00002, steps: [ST00092] }',
        '  subprocesses:',
        '    PR00010:',
        '      name: "Reference check"',
        '      steps:',
        '        ST00092: { name: "Check references", kind: action }',
      ],
    });

    expect(result.errors.map((e) => e.code)).toEqual(['ubml/usecase-foreign-step']);
  });

  // An id defined nowhere is reported once, as an undefined reference.
  it('report a step the workspace does not define only as undefined', async () => {
    const result = await check({ usecases: SUBMIT.map((line) => line.replace('ST00002]', 'ST00099]')) });

    expect(result.errors.map((e) => e.code)).toEqual(['ubml/undefined-reference']);
  });
});

describe('use case warnings', () => {
  const codes = async (parts: Parameters<typeof purchasing>[0]) =>
    (await check(parts)).warnings.map((w) => w.code).filter((code) => code?.startsWith('ubml/usecase-'));

  const DECIDE = [
    'UC00002:',
    '  name: "Decide on a purchase request"',
    '  actor: AC00002',
    '  goal: "Settle the request in one sitting"',
    '  steps: [ST00003, ST00005]',
    '  result: "The request is approved or sent back"',
  ];
  const BOTH_WAYS = [
    ...DEFAULT_LINKS,
    '- { from: ST00003, to: ST00005, condition: approved }',
    '- { from: ST00003, to: ST00004, condition: rejected }',
  ];

  // The system's step belongs to the requester's sitting: no warning for it.
  it('are none for a complete use case of one actor and the system', async () => {
    expect(await codes({ usecases: SUBMIT })).toEqual([]);
  });

  it.each(['goal', 'result'])('ask for a missing %s', async (field) => {
    expect(await codes({ usecases: without(field) })).toEqual([`ubml/usecase-missing-${field}`]);
  });

  it('point at a step another actor is responsible for', async () => {
    const result = await check({ usecases: SUBMIT.map((line) => line.replace('ST00002]', 'ST00005]')) });
    const found = result.warnings.filter((w) => w.code === 'ubml/usecase-actor-not-responsible');

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('"ST00005"');
    expect(found[0].message).toContain('done by AC00002, not by its actor AC00001');
    expect(found[0].line).toBeGreaterThan(0);
  });

  it.each([
    ['no way out', DEFAULT_LINKS],
    ['one way out', [...DEFAULT_LINKS, '- { from: ST00003, to: ST00005, condition: approved }']],
  ])('flag a decision with %s', async (wording, links) => {
    const result = await check({ usecases: DECIDE, links });
    const found = result.warnings.filter((w) => w.code === 'ubml/usecase-decision-one-way');

    expect(found.map((w) => w.message)).toEqual([
      `Decision "ST00003" in use case "UC00002" has ${wording} - draw each outcome as a link with a condition`,
    ]);
  });

  it('are none for a decision with a link per outcome', async () => {
    expect(await codes({ usecases: DECIDE, links: BOTH_WAYS })).toEqual([]);
  });

  // An alt block can hold the branches instead of the links.
  it('are none for a decision whose branches sit in an alt block', async () => {
    expect(
      await codes({
        usecases: DECIDE,
        links: [...DEFAULT_LINKS, '- { from: ST00003, to: ST00005 }'],
        blocks: [
          'BK00001:',
          '  name: "Approve?"',
          '  operator: alt',
          '  operands:',
          '    BK00002: { name: Approved, guard: approved, steps: [ST00005] }',
          '    BK00003: { name: Rejected, guard: rejected, steps: [ST00004] }',
        ],
      }),
    ).toEqual([]);
  });
});
