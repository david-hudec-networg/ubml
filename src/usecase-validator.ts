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

  for (const document of documents) {
    const filepath = document.meta.filename || 'unknown';

    for (const process of collectProcesses(document.content)) {
      const claimedBy = new Map<string, string>();

      for (const [usecaseId, usecase] of entriesOf(process.body.usecases)) {
        const at = `${process.at.join('.')}.usecases.${usecaseId}`;

        idsOf(usecase.steps).forEach((stepId, index) => {
          const path = `${at}.steps[${index}]`;

          if (!process.steps.has(stepId)) {
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
          }
        });
      }
    }
  }

  return { errors, warnings };
}
