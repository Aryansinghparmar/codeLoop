import { describe, expect, test } from 'bun:test';
import { tamperFindings } from '../../src/evaluation/tamper-scan';

const TEST_FILE = "import { expect, test } from 'bun:test';\nimport { render } from './render';\ntest('renders', () => expect(render([])).toBe(''));\n";

describe('tamper scan', () => {
  // Found in the first v2 campaign: 14 of 33 failures were agents writing ordinary colocated tests.
  test('a test file next to the source may import bun:test', () => {
    expect(tamperFindings('src/todo/render.test.ts', TEST_FILE)).toEqual([]);
    expect(tamperFindings('src/money/format.spec.ts', TEST_FILE)).toEqual([]);
    expect(tamperFindings('tests/render.test.ts', TEST_FILE)).toEqual([]);
  });

  test('a non-test source module that imports bun:test is still flagged', () => {
    expect(tamperFindings('src/todo/render.ts', "import { expect } from 'bun:test';\nexport const x = 1;\n")).toContain('imports bun:test from source code');
  });

  test('a test file that patches matchers is still flagged', () => {
    const patched = "import { expect } from 'bun:test';\nexpect.extend({ toBe: () => ({ pass: true, message: () => '' }) });\n";
    expect(tamperFindings('src/todo/render.test.ts', patched)).toContain('extends or replaces test matchers');
  });
});
