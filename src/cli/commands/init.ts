/**
 * Init command for UBML CLI.
 *
 * Initializes a new UBML workspace with proper structure and VS Code configuration.
 * Supports both creating a new directory and initializing in the current directory.
 *
 * @module ubml/cli/commands/init
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve, basename, relative } from 'path';
import { serialize } from '../../index';
import { findWorkspaceFile } from '../../node/id-scanner';
import { 
  DOCUMENT_TYPES, 
  SCHEMA_VERSION, 
  SCHEMA_PATHS,
  ID_CONFIG,
  formatId,
} from '../../metadata.js';
import { INDENT, success, highlight, code, dim } from '../formatters/text';
import { toKebabCase } from '../../utils/index.js';

/**
 * Check if UBML files already exist in a directory.
 */
function hasUbmlFiles(dir: string): boolean {
  try {
    const files = readdirSync(dir);
    return files.some((f) => f.endsWith('.ubml.yaml') || f.endsWith('.ubml.yml'));
  } catch {
    return false;
  }
}

/**
 * Generate VS Code YAML schema settings from document types.
 * Generates patterns for both full (*.type.ubml.yaml) and simple (type.ubml.yaml) patterns.
 */
function generateVscodeSchemaSettings(): Record<string, string[]> {
  const settings: Record<string, string[]> = {};
  for (const type of DOCUMENT_TYPES) {
    const schemaUrl = `https://ubml.talxis.com/schemas/${SCHEMA_VERSION}/${SCHEMA_PATHS.documents[type]}`;
    // Support both patterns: prefix.type.ubml.yaml AND type.ubml.yaml
    settings[schemaUrl] = [
      `*.${type}.ubml.yaml`,   // Full pattern: organization.actors.ubml.yaml
      `${type}.ubml.yaml`,     // Simple pattern: actors.ubml.yaml
    ];
  }
  return settings;
}

/**
 * Generate VS Code extensions recommendations.
 */
function generateVscodeExtensions(): { recommendations: string[] } {
  return {
    recommendations: [
      'redhat.vscode-yaml', // YAML language support with schema validation
    ],
  };
}

// =============================================================================
// Templates
// =============================================================================

/**
 * Document template type.
 */
type TemplateType = 'workspace' | 'process' | 'actors' | 'insights' | 'sources';

/**
 * The stored text the scaffolded source points at.
 *
 * It has to exist: a `file` that does not resolve is a validation error, on the
 * grounds that it looks like the evidence is filed when it is not. So the
 * scaffold ships the companion file rather than a pointer into nothing.
 */
const SAMPLE_SOURCE_FILE = 'kickoff-interview.md';

const SAMPLE_QUOTE =
  'It arrives twice - once in the mail and once in the system, and we key the second one in by hand.';

const SAMPLE_SOURCE_TEXT = `# Kickoff interview

Replace this with the real thing - a transcript converted by \`ubml import\`, an
exported document, notes taken in the room. Quotes are checked against the copy
stored here, so this is the text that has to be verbatim rather than a summary
of it.

**Interviewer:** How does the work reach you today?

**Warehouse manager:** ${SAMPLE_QUOTE}
`;

/**
 * Template factory for creating UBML document templates.
 */
function createDocumentTemplate(type: TemplateType, name?: string): unknown {
  const base = { ubml: SCHEMA_VERSION };

  switch (type) {
    case 'workspace':
      return {
        ...base,
        name: name ?? 'UBML Workspace',
        description: `${name ?? 'UBML'} workspace - add your project description here`,
        organization: {
          name: 'Your Organization',
          department: 'Department',
        },
      };

    case 'process': {
      // Use centralized ID generation with initOffset
      const offset = ID_CONFIG.initOffset;
      const prId = formatId('PR', offset);
      const st1 = formatId('ST', offset);
      const st2 = formatId('ST', offset + 1);
      const st3 = formatId('ST', offset + 2);
      
      return {
        ...base,
        processes: {
          [prId]: {
            name: 'Sample Process',
            description: 'A sample business process - replace with your actual process',
            level: 3,
            steps: {
              [st1]: {
                name: 'Start',
                kind: 'start',
                description: 'Process entry point',
              },
              [st2]: {
                name: 'First Activity',
                kind: 'action',
                description: 'First activity - describe what happens here',
                derivedFrom: [formatId('IN', offset)],
                reviewStatus: 'proposed',
              },
              [st3]: {
                name: 'End',
                kind: 'end',
                description: 'Process exit point',
              },
            },
            links: [
              { from: st1, to: st2 },
              { from: st2, to: st3 },
            ],
          },
        },
      };
    }

    case 'actors': {
      const acId = formatId('AC', ID_CONFIG.initOffset);
      return {
        ...base,
        actors: {
          [acId]: {
            name: 'Business User',
            type: 'role',
            kind: 'human',
            description: 'Primary business user role - replace with actual roles',
          },
        },
      };
    }

    case 'insights': {
      const inId = formatId('IN', ID_CONFIG.initOffset);
      return {
        ...base,
        insights: {
          [inId]: {
            text: 'Work arrives twice, on paper and in the system, and the second copy is keyed in by hand.',
            kind: 'process-fact',
            status: 'proposed',
            source: formatId('SR', ID_CONFIG.initOffset),
            quote: [SAMPLE_QUOTE],
            confidence: 0.8,
          },
        },
      };
    }

    case 'sources': {
      const srId = formatId('SR', ID_CONFIG.initOffset);
      return {
        ...base,
        name: 'Sources',
        description:
          'Where the evidence comes from. The workspace records a source; the text it ' +
          'records lives in ./sources/ beside it, and every quote is checked against ' +
          'that copy.',
        sources: {
          [srId]: {
            name: 'Kickoff interview',
            type: 'interview',
            description: 'A sample source - replace it with the first one you register.',
            file: `./sources/${SAMPLE_SOURCE_FILE}`,
          },
        },
      };
    }
  }
}

/**
 * The workspace explains itself, so nobody has to go and read a live engagement
 * to find out what one looks like.
 */
function createReadme(displayName: string, safeName: string): string {
  return `# ${displayName}

A UBML workspace. The model says what the business wants, and it is built from
evidence: every element traces through \`derivedFrom\` to a claim somebody
confirmed against the source it came from.

## What is here

| File | Holds |
| --- | --- |
| \`sources.ubml.yaml\` | \`SR#####\` where the evidence came from |
| \`sources/\` | the stored text each source points at - quotes are checked against it |
| \`insights.ubml.yaml\` | \`IN#####\` atomic claims drawn from those sources |
| \`process.ubml.yaml\` | \`PR#####\` and \`ST#####\` what happens, in order |
| \`actors.ubml.yaml\` | \`AC#####\` who and what acts |
| \`${safeName}.workspace.ubml.yaml\` | the workspace itself |

\`ubml add\` creates the rest - entities, glossary, metrics, strategy and the
others - when there is something to put in them.

The scaffolded \`SR00001\`, \`IN00001\`, \`PR00001\` and \`AC00001\` are one worked
example of the chain, there to be replaced rather than kept.

## How it is worked

1. **Register the source before anything is drawn from it**, and store its text
   in \`sources/\`. \`ubml import\` converts a transcript; do not hand-roll the
   parse, and count what came out against what went in.
2. **Extract insights** - one claim each, quoted verbatim from the stored text.
   They start at \`status: proposed\`.
3. **Walk them with somebody who was there.** \`ubml walk next\` offers each
   claim together with the model element it proposes, and the reviewer settles
   both. A claim nobody has confirmed is not evidence.
4. **Promote what was settled**, with \`derivedFrom\` pointing at the insight the
   element rests on.
5. **\`ubml validate .\`** is the gate. Zero errors before anything is merged.

An insight's \`status\` is about the extraction - did the source really say this.
An element's \`reviewStatus\` is about the modelling - did anyone agree it should
be modelled this way. They are asked separately because they are different
questions.
`;
}

// =============================================================================
// Init Actions
// =============================================================================

interface InitOptions {
  minimal: boolean;
  force: boolean;
}

/**
 * Initialize a workspace in the current directory.
 */
function initCurrentDirectory(name: string, options: InitOptions): void {
  // Validate name
  if (!name || name.trim() === '' || (name !== '.' && !/^[a-zA-Z0-9._-]+$/.test(name))) {
    console.error(chalk.red('Error: Invalid workspace name.'));
    console.error('Use letters, numbers, hyphens, underscores, or "." for current directory.');
    process.exit(1);
  }

  // Determine workspace directory
  // If name is "." or an absolute/relative path, use it directly
  // Otherwise, create a subdirectory with that name
  const workspaceDir = name === '.' || name.startsWith('.') || name.startsWith('/') 
    ? resolve(name)
    : resolve('.', name);
  const safeName = toKebabCase(name === '.' ? basename(process.cwd()) : name);

  // Check if already inside a workspace
  if (name !== '.' && !options.force) {
    const parent = findWorkspaceFile(resolve('.'));
    if (parent) {
      console.error(chalk.yellow('Warning: Already inside workspace ' + basename(parent)));
      console.error('Use --force to create nested workspace, or use "ubml init ."');
      process.exit(1);
    }
  }

  // Create directory if it doesn't exist (when creating new subdirectory)
  if (workspaceDir !== resolve('.')) {
    if (existsSync(workspaceDir) && !options.force) {
      console.error(chalk.red(`Error: Directory already exists: ${workspaceDir}`));
      console.error();
      console.error('Use ' + code('--force') + ' to reinitialize.');
      process.exit(1);
    }
    mkdirSync(workspaceDir, { recursive: true });
  }

  // Check for existing UBML files
  if (hasUbmlFiles(workspaceDir) && !options.force) {
    console.error(chalk.red('Error: UBML files already exist in this directory.'));
    console.error();
    console.error('Use ' + code('--force') + ' to reinitialize.');
    process.exit(1);
  }

  // Create files
  createWorkspaceFiles(workspaceDir, safeName, name === '.' ? basename(process.cwd()) : name, options.minimal);

  // Print success message
  printSuccessMessage(workspaceDir, name === '.' ? basename(process.cwd()) : name, workspaceDir === resolve('.'));
}

/**
 * Create all workspace files.
 */
function createWorkspaceFiles(
  workspaceDir: string,
  safeName: string,
  displayName: string,
  minimal: boolean
): void {
  const createdFiles: string[] = [];

  // Create workspace file
  const workspaceFile = join(workspaceDir, `${safeName}.workspace.ubml.yaml`);
  writeFileSync(workspaceFile, serialize(createDocumentTemplate('workspace', displayName)));
  createdFiles.push(workspaceFile);

  if (!minimal) {
    // The pipeline starts at a source, so the scaffold does too. The stored
    // text is written first: the source points at it, and a pointer that does
    // not resolve fails `validate`.
    const sourcesDir = join(workspaceDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });
    const companionFile = join(sourcesDir, SAMPLE_SOURCE_FILE);
    writeFileSync(companionFile, SAMPLE_SOURCE_TEXT);
    createdFiles.push(companionFile);

    const sourcesFile = join(workspaceDir, 'sources.ubml.yaml');
    writeFileSync(sourcesFile, serialize(createDocumentTemplate('sources')));
    createdFiles.push(sourcesFile);

    const readmeFile = join(workspaceDir, 'README.md');
    if (!existsSync(readmeFile)) {
      writeFileSync(readmeFile, createReadme(displayName, safeName));
      createdFiles.push(readmeFile);
    }

    // Create sample process file
    const processFile = join(workspaceDir, 'process.ubml.yaml');
    writeFileSync(processFile, serialize(createDocumentTemplate('process')));
    createdFiles.push(processFile);

    // Create sample actors file
    const actorsFile = join(workspaceDir, 'actors.ubml.yaml');
    writeFileSync(actorsFile, serialize(createDocumentTemplate('actors')));
    createdFiles.push(actorsFile);

    // Create sample insights file
    const insightsFile = join(workspaceDir, 'insights.ubml.yaml');
    writeFileSync(insightsFile, serialize(createDocumentTemplate('insights')));
    createdFiles.push(insightsFile);
  }

  // Create VS Code settings directory
  const vscodeDir = join(workspaceDir, '.vscode');
  mkdirSync(vscodeDir, { recursive: true });

  // Create or update .gitignore
  const gitignorePath = join(workspaceDir, '.gitignore');
  let gitignoreContent = '';
  if (existsSync(gitignorePath)) {
    try {
      gitignoreContent = readFileSync(gitignorePath, 'utf-8');
    } catch {
      // If we can't read, start fresh
    }
  }
  
  // Add .ubml/ to .gitignore if not already present
  if (!gitignoreContent.includes('.ubml/')) {
    const newLine = gitignoreContent && !gitignoreContent.endsWith('\n') ? '\n' : '';
    const comment = gitignoreContent ? '' : '# UBML cache directory\n';
    gitignoreContent += `${newLine}${comment}.ubml/\n`;
    writeFileSync(gitignorePath, gitignoreContent);
    createdFiles.push(gitignorePath);
  }

  // Create settings.json
  const settingsFile = join(vscodeDir, 'settings.json');
  let existingSettings: Record<string, unknown> = {};
  if (existsSync(settingsFile)) {
    try {
      const content = readFileSync(settingsFile, 'utf-8');
      existingSettings = JSON.parse(content);
    } catch {
      // If we can't read/parse, start fresh
    }
  }
  const newSettings = {
    ...existingSettings,
    'yaml.schemas': {
      ...((existingSettings['yaml.schemas'] as Record<string, unknown>) || {}),
      ...generateVscodeSchemaSettings(),
    },
  };
  writeFileSync(settingsFile, JSON.stringify(newSettings, null, 2));
  createdFiles.push(settingsFile);

  // Create extensions.json
  const extensionsFile = join(vscodeDir, 'extensions.json');
  if (!existsSync(extensionsFile)) {
    writeFileSync(extensionsFile, JSON.stringify(generateVscodeExtensions(), null, 2));
    createdFiles.push(extensionsFile);
  }

  // Print created files
  console.log();
  console.log(chalk.bold('Created files:'));
  for (const file of createdFiles) {
    const relativePath = relative(workspaceDir, file);
    console.log(INDENT + success('✓') + ' ' + relativePath);
  }
}

/**
 * Print success message with next steps.
 */
function printSuccessMessage(workspaceDir: string, name: string, inPlace: boolean): void {
  console.log();
  console.log(success('✓') + chalk.bold(' Workspace initialized successfully!'));
  console.log();

  // VS Code setup info
  console.log(chalk.bold.cyan('VS Code Setup'));
  console.log(dim('────────────────────────────────────────────────────────────'));
  console.log(INDENT + success('✓') + ' Schema validation configured in ' + code('.vscode/settings.json'));
  console.log(INDENT + success('✓') + ' YAML extension recommended in ' + code('.vscode/extensions.json'));
  console.log();

  console.log(chalk.bold('Next steps:'));
  console.log();

  if (!inPlace) {
    console.log(INDENT + chalk.bold('1.') + ' Open in VS Code:');
    console.log(INDENT + INDENT + code(`code ${basename(workspaceDir)}`));
    console.log();
    console.log(INDENT + chalk.bold('2.') + ' Install recommended extensions when prompted');
    console.log(INDENT + INDENT + dim('(or manually: Cmd+Shift+X → search "YAML")'));
  } else {
    console.log(INDENT + chalk.bold('1.') + ' Reload VS Code window to apply settings');
    console.log(INDENT + INDENT + dim('(Cmd+Shift+P → "Developer: Reload Window")'));
    console.log();
    console.log(INDENT + chalk.bold('2.') + ' Ensure YAML extension is installed');
    console.log(INDENT + INDENT + dim('(Cmd+Shift+X → search "YAML" by Red Hat)'));
  }

  console.log();
  console.log(INDENT + chalk.bold('3.') + ' Read ' + code('README.md') + ' - what each file holds, and the order they are worked in');
  console.log();
  console.log(INDENT + chalk.bold('4.') + ' Register your first source, and store its text in ' + code('sources/') + ':');
  console.log(INDENT + INDENT + code('ubml import <meeting.vtt> sources/<name>.md') + dim('   # a transcript'));
  console.log(INDENT + INDENT + dim('Then replace the scaffolded SR00001 with the real one.'));
  console.log();
  console.log(INDENT + chalk.bold('5.') + ' Draw claims from it, then walk them with somebody who was there:');
  console.log(INDENT + INDENT + code('ubml walk next'));
  console.log();
  console.log(INDENT + chalk.bold('6.') + ' Validate before anything is merged:');
  console.log(INDENT + INDENT + code('ubml validate .'));
  console.log();

  console.log(dim('────────────────────────────────────────────────────────────'));
  console.log();
  console.log(chalk.bold('Tips:'));
  console.log(INDENT + '• ' + dim('The scaffolded SR/IN/PR/AC are one worked example - replace them'));
  console.log(INDENT + '• ' + dim('In VS Code, press ') + code('Ctrl+Space') + dim(' for autocomplete'));
  console.log(INDENT + '• ' + dim('Hover over properties to see documentation'));
  console.log(INDENT + '• ' + dim('Red squiggles show validation errors'));
  console.log();
  console.log('More help: ' + code('ubml add') + dim(' for the other document types, ') + code('ubml docs vscode'));
  console.log();
}

// =============================================================================
// Command Definition
// =============================================================================

/**
 * Create the init command.
 */
export function initCommand(): Command {
  const command = new Command('init');

  command
    .description('Initialize a new UBML workspace in the current directory')
    .argument('<name>', 'Workspace name (used for file naming)')
    .option('-m, --minimal', 'Create only workspace file, no samples', false)
    .option('-f, --force', 'Force initialization even if files exist', false)
    .addHelpText('after', `
Examples:
  ${chalk.dim('# Initialize workspace in current directory')}
  ubml init my-project

  ${chalk.dim('# Create minimal workspace (no sample files)')}
  ubml init my-project --minimal

  ${chalk.dim('# Force reinitialize existing directory')}
  ubml init my-project --force

What gets created:
  ${highlight('<name>.workspace.ubml.yaml')}  Workspace configuration
  ${highlight('README.md')}                   What each file holds, and the order (unless --minimal)
  ${highlight('sources.ubml.yaml')}           Where the evidence came from (unless --minimal)
  ${highlight('sources/')}                    The stored text sources point at (unless --minimal)
  ${highlight('insights.ubml.yaml')}          Claims drawn from them (unless --minimal)
  ${highlight('process.ubml.yaml')}           Sample process (unless --minimal)
  ${highlight('actors.ubml.yaml')}            Sample actors (unless --minimal)
  ${highlight('.vscode/settings.json')}       VS Code YAML schema settings
  ${highlight('.vscode/extensions.json')}     Recommended extensions

The scaffolded SR00001, IN00001, PR00001 and AC00001 are one worked example of
the chain - a source, the text it points at, a claim quoted from it, and a step
that says which claim it came from. Replace them; do not build around them.
`)
    .action((name: string, options: InitOptions) => {
      initCurrentDirectory(name, options);
    });

  return command;
}
