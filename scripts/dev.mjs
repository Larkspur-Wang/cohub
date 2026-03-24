#!/usr/bin/env node
import { spawn } from 'node:child_process';

const processes = [
  {
    name: 'api',
    command: 'pnpm',
    args: ['--filter', '@cohub/api', 'dev'],
    color: '\x1b[36m',
  },
  {
    name: 'web',
    command: 'pnpm',
    args: ['--filter', 'web', 'dev'],
    color: '\x1b[35m',
  },
];

const reset = '\x1b[0m';
const children = [];

function prefixLines(name, color, chunk) {
  const text = chunk.toString();
  const lines = text.split(/\r?\n/);
  return lines
    .map((line, index) => {
      if (line.length === 0 && index === lines.length - 1) return '';
      return `${color}[${name}]${reset} ${line}`;
    })
    .join('\n');
}

for (const proc of processes) {
  const child = spawn(proc.command, proc.args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
    env: process.env,
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(prefixLines(proc.name, proc.color, chunk));
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(prefixLines(proc.name, proc.color, chunk));
  });

  child.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    process.stdout.write(`${proc.color}[${proc.name}]${reset} exited with ${reason}\n`);
    for (const other of children) {
      if (other !== child && !other.killed) {
        other.kill('SIGTERM');
      }
    }
    process.exit(code ?? 0);
  });

  children.push(child);
}

process.on('SIGINT', () => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(0);
});
