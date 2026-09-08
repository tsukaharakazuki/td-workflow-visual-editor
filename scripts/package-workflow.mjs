#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { zipSync } from 'fflate';

const CONTRACT_FORMAT = 'td-workflow-lineage-schema';
const CONTRACT_VERSION = 1;
const SCHEMA_ARCHIVE_PATH = 'schemas/workflow-inspector.schema.json';

const EXCLUDED_DIRECTORIES = new Set([
  '.aws',
  '.git',
  '.ssh',
  '.cache',
  'data',
  'keys',
  'logs',
  'node_modules',
  'secrets',
]);

const SECRET_FILE_NAMES = new Set([
  'credentials.json',
  'credentials.yml',
  'credentials.yaml',
  'secret.json',
  'secrets.json',
  'secrets.yml',
  'secrets.yaml',
  'service-account.json',
  '.npmrc',
  '.pypirc',
  '.netrc',
]);

const SECRET_EXTENSIONS = new Set([
  '.crt',
  '.der',
  '.jks',
  '.key',
  '.log',
  '.p12',
  '.pfx',
  '.pem',
]);

const ROW_DATA_EXTENSIONS = new Set([
  '.arrow',
  '.avro',
  '.csv',
  '.db',
  '.feather',
  '.jsonl',
  '.ndjson',
  '.orc',
  '.parquet',
  '.sqlite',
  '.sqlite3',
  '.tsv',
]);

function usage() {
  return `Usage: node scripts/package-workflow.mjs --input <folder> --output <file.zip> [options]\n\nOptions:\n  -i, --input <folder>   Downloaded local Workflow project folder\n  -o, --output <file>    ZIP path; must be outside the input folder\n  -s, --schema <file>    Optional canonical schema sidecar\n      --force            Replace an existing output ZIP\n  -h, --help             Show this help\n\nThis script only reads local files. It never invokes tdx or calls Treasure Data.`;
}

function parseArgs(argv) {
  const options = { force: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') {
      options.help = true;
      continue;
    }
    if (argument === '--force') {
      options.force = true;
      continue;
    }
    if (argument === '-i' || argument === '--input' || argument === '-o' || argument === '--output' || argument === '-s' || argument === '--schema') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      if (argument === '-i' || argument === '--input') options.input = value;
      if (argument === '-o' || argument === '--output') options.output = value;
      if (argument === '-s' || argument === '--schema') options.schema = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function isPathInside(candidate, parent) {
  const childRelativePath = relative(parent, candidate);
  return childRelativePath !== '' && childRelativePath !== '..' && !childRelativePath.startsWith(`..${sep}`) && !isAbsolute(childRelativePath);
}

function assertNotSymlink(filePath, label) {
  if (lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`Refusing symbolic link for ${label}: ${filePath}`);
  }
}

function portableSegments(relativePath) {
  return relativePath.split(sep).join('/').replaceAll('\\', '/').split('/').filter(Boolean);
}

function shouldExclude(relativePath, directory) {
  const segments = portableSegments(relativePath);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  if (lowerSegments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return true;

  const fileName = segments.at(-1)?.toLowerCase() ?? '';
  if (directory) return false;
  if (fileName === '.env' || fileName.startsWith('.env.')) return true;
  if (SECRET_FILE_NAMES.has(fileName)) return true;
  if (SECRET_EXTENSIONS.has(extname(fileName))) return true;
  if (ROW_DATA_EXTENSIONS.has(extname(fileName))) return true;
  if (/\.(secret|secrets|credential|credentials)$/i.test(fileName)) return true;
  if (/(^|[-_.])(password|token|secret|credential|private[-_.]?key)([-_.]|$)/i.test(fileName)) return true;
  return false;
}

function archivePath(relativePath) {
  const normalized = portableSegments(relativePath).join('/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe archive path: ${relativePath}`);
  }
  return normalized;
}

const SCANNABLE_EXTENSIONS = new Set([
  '.conf', '.config', '.dig', '.ini', '.json', '.md', '.properties', '.sql', '.text', '.toml', '.txt', '.yaml', '.yml',
]);

const SENSITIVE_CONTENT_PATTERNS = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { name: 'webhook URL', pattern: /https:\/\/(?:hooks\.slack\.com\/services|discord(?:app)?\.com\/api\/webhooks)\//i },
  { name: 'Authorization bearer token', pattern: /authorization\s*[:=]\s*["']?bearer\s+[A-Za-z0-9._~+/-]{8,}/i },
  { name: 'credential assignment', pattern: /(?:api[_-]?key|access[_-]?key|password|token|credential)\s*[:=]\s*["']?[A-Za-z0-9_/.+-]{8,}/i },
  { name: 'credential in URL', pattern: /[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/i },
];

function assertNoSensitiveContents(bytes, relativePath) {
  const extension = extname(relativePath).toLowerCase();
  if (!SCANNABLE_EXTENSIONS.has(extension)) return;
  if (bytes.includes(0)) return;
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error(`Refusing to package unscanned text file larger than 5 MB: ${relativePath}`);
  }
  const source = bytes.toString('utf8').replace(/\$\{secret:[^}]+\}/gi, '${secret:REFERENCE}');
  for (const check of SENSITIVE_CONTENT_PATTERNS) {
    if (check.pattern.test(source)) {
      throw new Error(`Possible ${check.name} found in ${relativePath}; remove or replace it with a secret reference before packaging`);
    }
  }
}

function collectFiles(inputDirectory) {
  const files = new Map();
  const excluded = [];

  function visit(directory, relativeDirectory) {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}${sep}${entry.name}` : entry.name;
      const absolutePath = resolve(directory, entry.name);

      if (shouldExclude(relativePath, entry.isDirectory())) {
        excluded.push(relativePath);
        continue;
      }
      assertNotSymlink(absolutePath, relativePath);

      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Refusing unsupported filesystem entry: ${relativePath}`);
      }
      const bytes = readFileSync(absolutePath);
      assertNoSensitiveContents(bytes, relativePath);
      files.set(archivePath(relativePath), bytes);
    }
  }

  visit(inputDirectory, '');
  return { files, excluded };
}

function validateSchema(schemaPath) {
  assertNotSymlink(schemaPath, 'schema');
  const contents = readFileSync(schemaPath, 'utf8');
  let document;
  try {
    document = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Schema is not valid JSON (${schemaPath}): ${error.message}`);
  }

  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Canonical schema must be a JSON object');
  }
  if (document.format !== CONTRACT_FORMAT || document.version !== CONTRACT_VERSION) {
    throw new Error(`Canonical schema must use format ${CONTRACT_FORMAT} and version ${CONTRACT_VERSION}`);
  }
  if (!Array.isArray(document.databases)) {
    throw new Error('Canonical schema must contain a databases array');
  }

  const forbiddenKey = /(row|sample|query.?result|secret|token|password|credential|webhook|private.?key)/i;
  function inspect(value, path) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKey.test(key)) {
        throw new Error(`Canonical schema contains prohibited field ${path}.${key}`);
      }
      inspect(child, `${path}.${key}`);
    }
  }
  inspect(document, '$');

  for (const [databaseIndex, database] of document.databases.entries()) {
    if (!database || typeof database !== 'object' || typeof database.name !== 'string' || !Array.isArray(database.tables)) {
      throw new Error(`Invalid database at databases[${databaseIndex}]`);
    }
    for (const [tableIndex, table] of database.tables.entries()) {
      if (!table || typeof table !== 'object' || typeof table.name !== 'string' || !Array.isArray(table.columns)) {
        throw new Error(`Invalid table at databases[${databaseIndex}].tables[${tableIndex}]`);
      }
      for (const [columnIndex, column] of table.columns.entries()) {
        if (!column || typeof column !== 'object' || typeof column.name !== 'string' || typeof column.type !== 'string') {
          throw new Error(`Invalid column at databases[${databaseIndex}].tables[${tableIndex}].columns[${columnIndex}]`);
        }
      }
    }
  }

  return readFileSync(schemaPath);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.input || !options.output) {
    throw new Error(`Both --input and --output are required.\n\n${usage()}`);
  }

  const inputDirectory = resolve(options.input);
  const outputPath = resolve(options.output);
  if (!existsSync(inputDirectory)) throw new Error(`Input folder does not exist: ${inputDirectory}`);
  assertNotSymlink(inputDirectory, 'input folder');
  if (!lstatSync(inputDirectory).isDirectory()) throw new Error(`Input is not a directory: ${inputDirectory}`);
  if (isPathInside(outputPath, inputDirectory) || outputPath === inputDirectory) {
    throw new Error('Output ZIP must be outside the input folder');
  }
  if (extname(outputPath).toLowerCase() !== '.zip') throw new Error('Output path must end in .zip');

  if (existsSync(outputPath)) {
    assertNotSymlink(outputPath, 'output');
    if (!options.force) throw new Error(`Output already exists; use --force to replace it: ${outputPath}`);
  }

  let schemaBytes;
  if (options.schema) {
    const schemaPath = resolve(options.schema);
    if (!existsSync(schemaPath)) throw new Error(`Schema file does not exist: ${schemaPath}`);
    if (!lstatSync(schemaPath).isFile()) throw new Error(`Schema is not a regular file: ${schemaPath}`);
    schemaBytes = validateSchema(schemaPath);
  }

  const { files, excluded } = collectFiles(inputDirectory);
  if (schemaBytes) files.set(SCHEMA_ARCHIVE_PATH, schemaBytes);
  if (files.size === 0) throw new Error('No safe files were found to package');

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, zipSync(Object.fromEntries(files), { level: 6 }));

  console.log(`Created ${outputPath}`);
  console.log(`Packaged ${files.size} file(s) from ${basename(inputDirectory)}`);
  if (schemaBytes) console.log(`Included canonical schema at ${SCHEMA_ARCHIVE_PATH}`);
  if (excluded.length > 0) {
    console.log(`Excluded ${excluded.length} unsafe/data path(s):`);
    for (const path of excluded) console.log(`  - ${path}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
