import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { Alteration, LithoLog, Lithology, Mineralization, RangeConflict } from '../types/litho-log';
import { findConflicts } from '../utils/recovery';
import { detachUnlinkedSample, findDuplicateSampleOnOtherHole, upsertPendingSample } from '../utils/sample-chain';
import { useSampleStore } from './sampleStore';
import type { DrillHole } from '../types/drill-hole';

export interface LithoInput {
  holeId: string;
  fromDepth: number;
  toDepth: number;
  lithology: Lithology;
  color: string;
  alteration: Alteration;
  mineralization: Mineralization;
  rqd: number;
  sampleNo: string;
  logger: string;
  remark?: string;
}

/** 样品号被其他钻孔占用 */
export interface SampleDuplicate {
  sampleNo: string;
  /** 已占用该编号的钻孔 id */
  otherHoleId: string;
}

interface SaveResult {
  log?: LithoLog;
  conflicts: RangeConflict[];
  /** 样品号跨钻孔重复（保存被拦下） */
  duplicateSample?: SampleDuplicate;
}

interface LithoState {
  lithos: LithoLog[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 编录区间冲突校验：返回与已编录区间重叠的冲突项（空数组表示无冲突） */
  checkConflicts: (input: Pick<LithoInput, 'holeId' | 'fromDepth' | 'toDepth'>, ignoreId?: string) => RangeConflict[];
  /** 样品号跨孔查重：返回占用该编号的钻孔（同孔重复允许） */
  checkSampleDuplicate: (sampleNo: string, holeId: string, ignoreLithoId?: string) => Promise<DrillHole | undefined>;
  addLitho: (input: LithoInput) => Promise<SaveResult>;
  updateLitho: (id: string, patch: Partial<LithoInput>) => Promise<SaveResult>;
  removeLitho: (id: string) => Promise<void>;
}

/** 样品号录入时自动建立待采样记录，并刷新台账 store（必须在 lithos+samples 事务内调用） */
async function refreshSamplesAfterWrite(): Promise<void> {
  await useSampleStore.getState().hydrate();
}

/** 岩性区间与冲突校验 */
export const useLithoStore = create<LithoState>()((set, get) => ({
  lithos: [],
  hydrated: false,

  hydrate: async () => {
    const lithos = await db.lithos.orderBy('fromDepth').toArray();
    set({ lithos, hydrated: true });
  },

  checkConflicts: (input, ignoreId) => {
    const candidate: LithoLog = {
      id: ignoreId ?? 'candidate',
      holeId: input.holeId,
      fromDepth: Number(input.fromDepth) || 0,
      toDepth: Number(input.toDepth) || 0,
      lithology: '花岗闪长岩',
      color: '',
      alteration: '无',
      mineralization: '无',
      rqd: 0,
      sampleNo: '',
      logger: '',
    };
    return findConflicts(candidate, get().lithos);
  },

  checkSampleDuplicate: async (sampleNo, holeId, ignoreLithoId) => {
    const dup = await findDuplicateSampleOnOtherHole({ lithos: db.lithos }, sampleNo, holeId, ignoreLithoId);
    if (!dup) return undefined;
    return db.holes.get(dup.holeId);
  },

  addLitho: async (input) => {
    const conflicts = get().checkConflicts(input);
    if (conflicts.length) {
      return { conflicts };
    }
    const sampleNo = input.sampleNo.trim();
    const duplicate = await findDuplicateSampleOnOtherHole({ lithos: db.lithos }, sampleNo, input.holeId);
    if (duplicate) {
      return { conflicts: [], duplicateSample: { sampleNo, otherHoleId: duplicate.holeId } };
    }
    const log: LithoLog = {
      id: uid('litho'),
      holeId: input.holeId,
      fromDepth: Number(input.fromDepth) || 0,
      toDepth: Number(input.toDepth) || 0,
      lithology: input.lithology,
      color: input.color.trim(),
      alteration: input.alteration,
      mineralization: input.mineralization,
      rqd: Number(input.rqd) || 0,
      sampleNo,
      logger: input.logger.trim(),
      remark: input.remark?.trim() || undefined,
    };
    await db.transaction('rw', db.lithos, db.samples, async () => {
      await db.lithos.put(log);
      // 样品号录入即自动建立待采样记录
      await upsertPendingSample({ lithos: db.lithos, samples: db.samples }, log);
    });
    set({ lithos: [...get().lithos, log] });
    await refreshSamplesAfterWrite();
    return { log, conflicts: [] };
  },

  updateLitho: async (id, patch) => {
    const current = get().lithos.find((l) => l.id === id);
    if (!current) return { conflicts: [] };
    const merged = { ...current, ...patch };
    const conflicts = get().checkConflicts(merged, id);
    if (conflicts.length) {
      return { conflicts };
    }
    const next: LithoLog = {
      ...merged,
      sampleNo: merged.sampleNo?.trim() ?? '',
      color: (merged.color ?? '').trim(),
      logger: (merged.logger ?? '').trim(),
      remark: merged.remark?.trim() || undefined,
    };
    const duplicate = await findDuplicateSampleOnOtherHole({ lithos: db.lithos }, next.sampleNo, next.holeId, id);
    if (duplicate) {
      return { conflicts: [], duplicateSample: { sampleNo: next.sampleNo, otherHoleId: duplicate.holeId } };
    }
    await db.transaction('rw', db.lithos, db.samples, async () => {
      await db.lithos.put(next);
      // 样品号改走：旧待采样记录删除，已取样/已送检的仅解挂保留痕迹；新编号自动建待采样
      await detachUnlinkedSample({ lithos: db.lithos, samples: db.samples }, current, next);
      await upsertPendingSample({ lithos: db.lithos, samples: db.samples }, next);
    });
    set({ lithos: get().lithos.map((l) => (l.id === id ? next : l)) });
    await refreshSamplesAfterWrite();
    return { log: next, conflicts: [] };
  },

  removeLitho: async (id) => {
    await db.transaction('rw', db.lithos, db.samples, async () => {
      const current = await db.lithos.get(id);
      await db.lithos.delete(id);
      if (current) {
        const chain = current.sampleNo ? await db.samples.where('sampleNo').equals(current.sampleNo).first() : undefined;
        // 待采样记录随编录一并删除；已进入流转的保留痕迹
        if (chain && chain.lithoId === id && chain.status === 'pending') {
          await db.samples.delete(chain.id);
        } else if (chain && chain.lithoId === id) {
          await db.samples.put({ ...chain, lithoId: undefined });
        }
      }
    });
    set({ lithos: get().lithos.filter((l) => l.id !== id) });
    await refreshSamplesAfterWrite();
  },
}));
