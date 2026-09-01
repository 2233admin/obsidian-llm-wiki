#!/usr/bin/env node

import { access, copyFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTests(path));
    else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(path);
  }
  return files;
}

async function stageTestResources(source, destination) {
  await mkdir(destination, { recursive: true });
  const staged = [];
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, entry.name);
    const destinationPath = resolve(destination, entry.name);
    if (entry.isDirectory()) {
      staged.push(...await stageTestResources(sourcePath, destinationPath));
    } else if (entry.isFile() && !entry.name.endsWith('.test.ts')) {
      try {
        await access(destinationPath);
      } catch {
        await copyFile(sourcePath, destinationPath);
        staged.push(destinationPath);
      }
    }
  }
  return staged;
}

const stagedResources = await stageTestResources(resolve('src'), resolve('dist'));
const files = (await collectTests(resolve('dist'))).sort();
if (files.length === 0) throw new Error('no compiled source tests found under dist');

const tests = run({ files, concurrency: false });
tests.on('test:fail', () => {
  process.exitCode = 1;
});
tests.on('end', async () => {
  await Promise.all(stagedResources.map((path) => unlink(path)));
});
tests.compose(spec).pipe(process.stdout);
