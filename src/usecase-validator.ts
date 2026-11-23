/**
 * Use case checks (browser-safe).
 *
 * A use case overlays steps its own process already holds, and a step belongs
 * to at most one use case: the cut is by who works through the step, so two
 * use cases claiming one step means one of them has the wrong steps.
 */

import type { UBMLDocument } from './parser.js';
import type { ReferenceError, ReferenceWarning } from './semantic-validator.js';

type Body = Record<string, unknown>;

const isBody = (value: unknown): value is Body =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const entriesOf = (value: unknown): [string, Body][] =>
  isBody(value)
    ? Object.entries(value).filter((entry): entry is [string, Body] => isBody(entry[1]))
    : [];

const idsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** A process wherever it is written, with the steps it owns. */
interface ProcessInView {
  id: string;
  /** Path segments from the document root to the process. */
  at: string[];
  body: Body;
  /** Steps defined in this process: inline nested steps included, subprocesses excluded. */
  steps: Map<string, Body>;
}

function collectSteps(steps: unknown, into: Map<string, Body>): void {
  for (const [id, step] of entriesOf(steps)) {
    into.set(id, step);
    collectSteps(step.steps, into);
  }
}

function collectProcesses(content: unknown): ProcessInView[] {
  const found: ProcessInView[] = [];
  const visit = (processes: unknown, at: string[]): void => {
    for (const [id, body] of entriesOf(processes)) {
      const here = [...at, id];
      const steps = new Map<string, Body>();
      collectSteps(body.steps, steps);
      found.push({ id, at: here, body, steps });
      visit(body.subprocesses, [...here, 'subprocesses']);
    }
  };
  if (isBody(content)) visit(content.processes, ['processes']);
  return found;
}

/** Actor id to its `type`, across the workspace. */
function collectActorTypes(documents: UBMLDocument[]): Map<string, unknown> {
  const types = new Map<string, unknown>();
  for (const document of documents) {
    if (!isBody(document.content)) continue;
    for (const [id, actor] of entriesOf(document.content.actors)) types.set(id, actor.type);
  }
  return types;
}

const CHOICE_OPERATORS = new Set(['alt', 'opt']);

/** Steps inside alt and opt blocks, where a decision's branches can live instead of in its links. */
function stepsInChoiceBlocks(blocks: unknown): Set<string> {
  const found = new Set<string>();
  const collect = (block: Body, inChoice: boolean): void => {
    const choice = inChoice || (typeof block.operator === 'string' && CHOICE_OPERATORS.has(block.operator));
    if (choice) idsOf(block.steps).forEach((id) => found.add(id));
    for (const [, operand] of entriesOf(block.operands)) collect(operand, choice);
  };
  for (const [, block] of entriesOf(blocks)) collect(block, false);
  return found;
}

/**
 * Actors responsible for a step when neither the use case's actor nor a system
 * is among them; empty when the step is the actor's or nothing says who does it.
 * A system step is the system's half of the actor's sitting, so it belongs.
 */
function othersResponsible(step: Body, actor: unknown, actorTypes: Map<string, unknown>): string[] {
  const responsible = idsOf(isBody(step.RACI) ? step.RACI.responsible : undefined);
  if (typeof actor !== 'string' || responsible.length === 0 || responsible.includes(actor)) return [];
  if (responsible.some((id) => actorTypes.get(id) === 'system')) return [];
  return responsible;
}

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

const MISSING = {
  goal: 'has no goal - what does its actor want to achieve?',
  result: 'has no result - what does its actor hold at the end?',
} as const;

export interface UseCaseFindings {
  errors: ReferenceError[];
  warnings: ReferenceWarning[];
}

/**
 * Check every use case in the workspace against its own process.
 *
 * @param isDefined - Whether an id is defined anywhere in the workspace; an id
 *   defined nowhere is already reported as an undefined reference.
 */
export function validateUseCases(
  documents: UBMLDocument[],
  isDefined: (id: string) => boolean,
): UseCaseFindings {
  const errors: ReferenceError[] = [];
  const warnings: ReferenceWarning[] = [];
  const actorTypes = collectActorTypes(documents);

  for (const document of documents) {
    const filepath = document.meta.filename || 'unknown';

    for (const process of collectProcesses(document.content)) {
      const claimedBy = new Map<string, string>();
      const links = Array.isArray(process.body.links) ? process.body.links.filter(isBody) : [];
      const choiceSteps = stepsInChoiceBlocks(process.body.blocks);

      for (const [usecaseId, usecase] of entriesOf(process.body.usecases)) {
        const segments = [...process.at, 'usecases', usecaseId];
        const at = segments.join('.');
        const warn = (code: string, message: string, path: string, pointer: string[]): void => {
          const location = document.getSourceLocation(`/${pointer.join('/')}`);
          warnings.push({ message, filepath, path, code, ...(location && { line: location.line, column: location.column }) });
        };

        for (const field of ['goal', 'result'] as const) {
          if (!hasText(usecase[field])) {
            warn(`ubml/usecase-missing-${field}`, `Use case "${usecaseId}" ${MISSING[field]}`, at, segments);
          }
        }

        idsOf(usecase.steps).forEach((stepId, index) => {
          const path = `${at}.steps[${index}]`;
          const pointer = [...segments, 'steps', String(index)];
          const step = process.steps.get(stepId);

          if (step === undefined) {
            if (!isDefined(stepId)) return;
            errors.push({
              message:
                `Use case "${usecaseId}" lists step "${stepId}", which is not a step of its ` +
                `process "${process.id}" - a use case covers steps of its own process`,
              filepath,
              path,
              code: 'ubml/usecase-foreign-step',
            });
            return;
          }

          const owner = claimedBy.get(stepId);
          if (owner === undefined) {
            claimedBy.set(stepId, usecaseId);
          } else if (owner !== usecaseId) {
            errors.push({
              message:
                `Step "${stepId}" is in use cases "${owner}" and "${usecaseId}" - a step ` +
                `belongs to one use case, the one whose actor works through it`,
              filepath,
              path,
              code: 'ubml/usecase-shared-step',
            });
            return;
          }

          const others = othersResponsible(step, usecase.actor, actorTypes);
          if (others.length > 0) {
            warn(
              'ubml/usecase-actor-not-responsible',
              `Step "${stepId}" in use case "${usecaseId}" is done by ${others.join(', ')}, not by its ` +
                `actor ${String(usecase.actor)} - is this a second actor's use case?`,
              path,
              pointer,
            );
          }

          // A decision drawn with one way out leaves its other outcomes out of the
          // model, so no way through the use case covers them.
          const targets = links.filter((link) => link.from === stepId).map((link) => link.to);
          const inBlock = choiceSteps.has(stepId) || targets.some((target) => typeof target === 'string' && choiceSteps.has(target));
          if (step.kind === 'decision' && targets.length < 2 && !inBlock) {
            warn(
              'ubml/usecase-decision-one-way',
              `Decision "${stepId}" in use case "${usecaseId}" has ${targets.length === 0 ? 'no way' : 'one way'} ` +
                `out - draw each outcome as a link with a condition`,
              path,
              pointer,
            );
          }
        });
      }
    }
  }

  return { errors, warnings };
}
