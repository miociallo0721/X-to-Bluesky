import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function isWorkspaceRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'package.json')) &&
    fs.existsSync(path.join(dir, 'client')) &&
    fs.existsSync(path.join(dir, 'server'))
  );
}

function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;

  while (true) {
    if (isWorkspaceRoot(dir)) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Cannot locate workspace root from ${startDir}`);
    }

    dir = parent;
  }
}

const workspaceRoot = findWorkspaceRoot(currentDir);

export function getWorkspaceRoot(): string {
  return workspaceRoot;
}

export function getServerRoot(): string {
  return path.join(workspaceRoot, 'server');
}

export function getClientDistPath(): string {
  return path.join(workspaceRoot, 'client', 'dist');
}

export function getServerEnvPath(): string {
  return path.join(getServerRoot(), '.env');
}

export function getDefaultDbPath(): string {
  return path.join(getServerRoot(), 'data', 'sync.db');
}
