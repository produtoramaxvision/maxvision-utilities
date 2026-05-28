import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import {
  createSoulId,
  listSoulIds,
  markUsed,
  findByCharacterName,
  recordTrainingCost,
  type SoulIdRecord,
} from '../../src/core/soul-id-cache.js';

describe('soul-id-cache', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-soulid-'));
    dbPath = join(tmpDir, 'cost.db');
    const db = openDb(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a soul id record with character name + asset paths', () => {
    createSoulId({
      dbPath,
      id: 'soul_abc123',
      provider: 'higgsfield',
      characterName: 'Aurora',
      assetPaths: ['/tmp/aurora1.png', '/tmp/aurora2.png', '/tmp/aurora3.png'],
    });
    const list = listSoulIds({ dbPath });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('soul_abc123');
    expect(list[0]!.characterName).toBe('Aurora');
    expect(list[0]!.assetPaths).toEqual(['/tmp/aurora1.png', '/tmp/aurora2.png', '/tmp/aurora3.png']);
    expect(list[0]!.trainedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('findByCharacterName returns the matching record (case-insensitive)', () => {
    createSoulId({
      dbPath,
      id: 'soul_aurora',
      provider: 'higgsfield',
      characterName: 'Aurora',
      assetPaths: ['/tmp/a.png'],
    });
    const found = findByCharacterName({ dbPath, characterName: 'aurora' });
    expect(found?.id).toBe('soul_aurora');
  });

  it('findByCharacterName returns undefined for unknown name', () => {
    expect(findByCharacterName({ dbPath, characterName: 'ghost' })).toBeUndefined();
  });

  it('markUsed updates last_used timestamp', () => {
    createSoulId({
      dbPath,
      id: 'soul_x',
      provider: 'higgsfield',
      characterName: 'X',
      assetPaths: ['/tmp/x.png'],
    });
    const before = listSoulIds({ dbPath })[0]!;
    expect(before.lastUsed).toBeNull();
    markUsed({ dbPath, id: 'soul_x' });
    const after = listSoulIds({ dbPath })[0]!;
    expect(after.lastUsed).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('recordTrainingCost stores the credit cost of training', () => {
    createSoulId({
      dbPath,
      id: 'soul_t',
      provider: 'higgsfield',
      characterName: 'T',
      assetPaths: ['/tmp/t.png'],
    });
    recordTrainingCost({ dbPath, id: 'soul_t', trainingCredits: 250, usdAtTime: 9.75 });
    const list = listSoulIds({ dbPath });
    const rec: SoulIdRecord = list[0]!;
    expect(rec.trainingCredits).toBe(250);
    expect(rec.trainingUsd).toBe(9.75);
  });

  it('listSoulIds is empty initially', () => {
    expect(listSoulIds({ dbPath })).toEqual([]);
  });

  it('createSoulId is idempotent (re-create with same id is a no-op)', () => {
    createSoulId({
      dbPath,
      id: 'soul_dup',
      provider: 'higgsfield',
      characterName: 'First',
      assetPaths: ['/tmp/a.png'],
    });
    createSoulId({
      dbPath,
      id: 'soul_dup',
      provider: 'higgsfield',
      characterName: 'Second',
      assetPaths: ['/tmp/b.png'],
    });
    const list = listSoulIds({ dbPath });
    expect(list).toHaveLength(1);
    expect(list[0]!.characterName).toBe('First'); // first write wins (INSERT OR IGNORE)
  });
});

// ---- Training-lock pattern (D-1) ----

describe('soul-id-cache training lock (D-1)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-soulid-lock-'));
    dbPath = join(tmpDir, 'cost.db');
    const db = openDb(dbPath);
    runMigrations(db);
  });
  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('computeSoulIdFingerprint is stable across array ordering + case', async () => {
    const { computeSoulIdFingerprint } = await import('../../src/core/soul-id-cache.js');
    const a = computeSoulIdFingerprint({ characterName: 'Aurora', assetPaths: ['/a.png', '/b.png'] });
    const b = computeSoulIdFingerprint({ characterName: 'aurora', assetPaths: ['/b.png', '/a.png'] });
    expect(a).toBe(b);
  });

  it('claimTrainingPending returns CLAIMED on first call', async () => {
    const { claimTrainingPending } = await import('../../src/core/soul-id-cache.js');
    const r = claimTrainingPending({
      dbPath,
      provisionalId: 'pending-1',
      provider: 'higgsfield',
      characterName: 'Maya',
      assetPaths: ['/m.png'],
    });
    expect(r.state).toBe('CLAIMED');
  });

  it('second claim for same character returns ALREADY_PENDING (without API call)', async () => {
    const { claimTrainingPending } = await import('../../src/core/soul-id-cache.js');
    claimTrainingPending({
      dbPath,
      provisionalId: 'pending-1',
      provider: 'higgsfield',
      characterName: 'Maya',
      assetPaths: ['/m.png'],
    });
    const second = claimTrainingPending({
      dbPath,
      provisionalId: 'pending-2',
      provider: 'higgsfield',
      characterName: 'Maya',
      assetPaths: ['/m.png'],
    });
    expect(second.state).toBe('ALREADY_PENDING');
  });

  it('commitTrained promotes PENDING → COMMITTED with real soul id', async () => {
    const { claimTrainingPending, commitTrained } = await import('../../src/core/soul-id-cache.js');
    claimTrainingPending({
      dbPath,
      provisionalId: 'pending-1',
      provider: 'higgsfield',
      characterName: 'Zara',
      assetPaths: ['/z.png'],
    });
    commitTrained({ dbPath, provisionalId: 'pending-1', realSoulId: 'soul_zara' });
    const list = listSoulIds({ dbPath });
    expect(list[0]!.id).toBe('soul_zara');
  });

  it('rollbackPending deletes the sentinel so the next caller can retry', async () => {
    const { claimTrainingPending, rollbackPending } = await import('../../src/core/soul-id-cache.js');
    claimTrainingPending({
      dbPath,
      provisionalId: 'pending-1',
      provider: 'higgsfield',
      characterName: 'Iris',
      assetPaths: ['/i.png'],
    });
    rollbackPending({ dbPath, provisionalId: 'pending-1' });
    const retry = claimTrainingPending({
      dbPath,
      provisionalId: 'pending-2',
      provider: 'higgsfield',
      characterName: 'Iris',
      assetPaths: ['/i.png'],
    });
    expect(retry.state).toBe('CLAIMED');
  });
});
