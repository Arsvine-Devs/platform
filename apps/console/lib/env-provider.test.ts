import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { readEnv, readEnvList } from '@arsvine/env';
import { loadProjectEnv } from '@arsvine/env/dotenv';

const temporaryDirectories: string[] = [];
const testKey = 'ARSVINE_ENV_PROVIDER_TEST';
const execFileAsync = promisify(execFile);

afterEach(async () => {
  delete process.env[testKey];
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('@arsvine/env', () => {
  it('keeps inherited values and applies dotenv files from high to low priority', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'arsvine-env-provider-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, '.env'), `${testKey}=base\n`);
    await writeFile(path.join(directory, '.env.production'), `${testKey}=mode\n`);
    await writeFile(path.join(directory, '.env.local'), `${testKey}=local\n`);
    await writeFile(path.join(directory, '.env.production.local'), `${testKey}=mode-local\n`);

    loadProjectEnv({ cwd: directory, mode: 'production' });
    expect(readEnv(testKey)).toBe('mode-local');
    expect(readEnvList(testKey)).toEqual(['mode-local']);

    process.env[testKey] = 'inherited';
    loadProjectEnv({ cwd: directory, mode: 'production' });
    expect(readEnv(testKey)).toBe('inherited');
    expect(await readFile(path.join(directory, '.env.production.local'), 'utf8')).toContain(
      testKey,
    );
  });

  it('registers a key only after validating its consumer and example file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'arsvine-env-cli-'));
    temporaryDirectories.push(directory);
    const repositoryRoot = path.resolve(process.cwd(), '..', '..');
    await mkdir(path.join(directory, 'config'), { recursive: true });
    await mkdir(path.join(directory, 'apps/api/src'), { recursive: true });
    await copyFile(
      path.join(repositoryRoot, 'config/env-contracts.json'),
      path.join(directory, 'config/env-contracts.json'),
    );
    await copyFile(
      path.join(repositoryRoot, 'apps/api/.env.example'),
      path.join(directory, 'apps/api/.env.example'),
    );
    await copyFile(
      path.join(repositoryRoot, 'apps/api/src/server.ts'),
      path.join(directory, 'apps/api/src/server.ts'),
    );

    const result = await execFileAsync(
      process.execPath,
      [
        path.join(repositoryRoot, 'packages/env/src/cli.mjs'),
        'register',
        '--key',
        'TEST_REGISTERED_URL',
        '--service',
        'api',
        '--description',
        'Test registration',
        '--format',
        'absolute HTTPS origin',
        '--scope',
        'local',
        '--requiredness',
        'optional',
        '--example',
        'https://example.invalid',
        '--example-file',
        'apps/api/.env.example',
        '--used-by',
        'apps/api/src/server.ts',
      ],
      { cwd: directory },
    );

    expect(result.stdout).toContain('registered TEST_REGISTERED_URL');
    expect(result.stdout).not.toContain('https://example.invalid');
    expect(
      JSON.parse(
        await readFile(path.join(directory, 'config/env-contracts.json'), 'utf8'),
      ).entries.at(-1).key,
    ).toBe('TEST_REGISTERED_URL');
    expect(await readFile(path.join(directory, 'apps/api/.env.example'), 'utf8')).toContain(
      'TEST_REGISTERED_URL=https://example.invalid',
    );
  });
});
