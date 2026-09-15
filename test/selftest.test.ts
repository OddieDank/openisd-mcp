import { expect, it } from 'vitest';
import { runSelfTest } from '../src/selftest.js';

it('self-test passes against the vendored bundle', () => {
  const st = runSelfTest();
  expect(st.failures).toEqual([]);
  expect(st.ok).toBe(true);
});
