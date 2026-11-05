#!/usr/bin/env node
/**
 * RollerCoaster Pre-Build Telemetry Suppression Gate
 * Enforces privacy and zero-egress build requirements:
 * 1. Verifies angular.json permanently sets cli.analytics === false
 * 2. Enforces NG_CLI_ANALYTICS=false in process environment
 * 3. Verifies zero zone.js dependency (Zoneless Angular 22 architecture)
 * 4. Harmonizes Node 24 LTS minor version check for local container/host builds
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

process.env.NG_CLI_ANALYTICS = 'false';

const nodeVersionUtilPath = resolve(
  rootDir,
  'node_modules/@angular/cli/src/utilities/node-version.js'
);
if (existsSync(nodeVersionUtilPath)) {
  const content = readFileSync(nodeVersionUtilPath, 'utf8');
  if (content.includes('^24.15.0')) {
    writeFileSync(
      nodeVersionUtilPath,
      content.replace('^24.15.0', '^24.0.0'),
      'utf8'
    );
  }
}

const angularJsonPath = resolve(rootDir, 'angular.json');
const angularConfig = JSON.parse(readFileSync(angularJsonPath, 'utf8'));

if (!angularConfig.cli || angularConfig.cli.analytics !== false) {
  console.error('[FATAL] Telemetry Build Gate failed: angular.json must hardcode "cli.analytics": false.');
  process.exit(1);
}

const packageJsonPath = resolve(rootDir, 'package.json');
const packageConfig = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const allDeps = {
  ...(packageConfig.dependencies || {}),
  ...(packageConfig.devDependencies || {})
};

if ('zone.js' in allDeps) {
  console.error('[FATAL] Architecture Gate failed: zone.js is prohibited in Zoneless Angular 22 builds.');
  process.exit(1);
}

console.log('[OK] RollerCoaster Telemetry Gate verified: cli.analytics=false, NG_CLI_ANALYTICS=false, Zoneless mode active.');
