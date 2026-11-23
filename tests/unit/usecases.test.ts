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
