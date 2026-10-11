/**
 * Shared Version Utilities
 *
 * Common utilities for version handling across UBML scripts.
 * Consolidates duplicated code from update-schema-versions.ts and verify-versions.ts.
 *
 * @module scripts/shared/version-utils
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Path Constants
// =============================================================================

export const ROOT_DIR = join(__dirname, '..', '..');
export const SCHEMAS_ROOT = join(ROOT_DIR, 'schemas');
export const SRC_DIR = join(ROOT_DIR, 'src');
export const EXAMPLE_DIR = join(ROOT_DIR, 'example');

// =============================================================================
// Types
// =============================================================================

export interface VersionInfo {
  full: string;   // e.g., "1.2.3"
  schema: string; // e.g., "1.2"
}

// =============================================================================
// Version Validation
// =============================================================================

/**
 * Validate semver version format.
 * Throws if format is invalid.
 */
export function validateSemver(version: string): void {
  const semverRegex = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  if (!semverRegex.test(version)) {
    throw new Error(`Invalid semver format: "${version}". Expected format: X.Y.Z or X.Y.Z-prerelease (e.g., "1.1.0")`);
  }
}

/**
 * Read and validate package version from package.json.
 * Throws if version is missing or malformed.
 */
export function getPackageVersion(): VersionInfo {
  const packageJsonPath = join(ROOT_DIR, 'package.json');

  let packageJson: { version?: string };
  try {
    const content = readFileSync(packageJsonPath, 'utf8');
    packageJson = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to read package.json: ${error}`);
  }

  if (!packageJson.version) {
    throw new Error('Version missing in package.json');
  }

  const fullVersion = packageJson.version;
  validateSemver(fullVersion);

  // Schema version is major.minor (without patch)
  const schemaVersion = fullVersion.split('.').slice(0, 2).join('.');

  return { full: fullVersion, schema: schemaVersion };
}

// =============================================================================
// File Scanning
// =============================================================================

/**
 * Get all YAML files in a directory recursively.
 */
export function getAllYamlFiles(dir: string): string[] {
  const files: string[] = [];

  function scan(currentDir: string): void {
    const entries = readdirSync(currentDir);

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        scan(fullPath);
      } else if (extname(entry) === '.yaml') {
        files.push(fullPath);
      }
    }
  }

  scan(dir);
  return files;
}

// =============================================================================
// Version Patterns
// =============================================================================

/**
 * Common regex patterns for version references in schema files.
 * These patterns are used by both update and verify scripts.
 */
export const VERSION_PATTERNS = {
  /** $id URLs: https://ubml.talxis.com/schemas/X.Y/... */
  schemaId: /(https:\/\/ubml\.talxis\.com\/schemas\/)(\d+\.\d+)(\/[^"]+)/g,

  /** const: "X.Y" for ubml property */
  constValue: /const:\s*"(\d+\.\d+)"/g,

  /** Version in description headers: "Version X.Y" */
  versionHeader: /(Version\s+)(\d+\.\d+)/g,

  /** Must be version text: 'Must be "X.Y" for this schema version' */
  mustBe: /(Must be\s*")(\d+\.\d+)("\s*for this schema version)/g,
} as const;

/**
 * Extract all version numbers from a file content using all patterns.
 * Returns an array of unique version strings found.
 */
export function extractVersionsFromContent(content: string): string[] {
  const versions = new Set<string>();

  // Extract from $id URLs
  const idMatches = content.matchAll(VERSION_PATTERNS.schemaId);
  for (const match of idMatches) {
    versions.add(match[2]);
  }

  // Extract from const values
  const constMatches = content.matchAll(VERSION_PATTERNS.constValue);
  for (const match of constMatches) {
    versions.add(match[1]);
  }

  // Extract from version headers
  const headerMatches = content.matchAll(VERSION_PATTERNS.versionHeader);
  for (const match of headerMatches) {
    versions.add(match[2]);
  }

  // Extract from "must be" text
  const mustBeMatches = content.matchAll(VERSION_PATTERNS.mustBe);
  for (const match of mustBeMatches) {
    versions.add(match[2]);
  }

  return Array.from(versions);
}
