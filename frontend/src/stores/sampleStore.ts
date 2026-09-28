import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import type { LithoLog } from '../types/litho-log';
import type { SampleRecord, SampleStatus, SendingInput, SamplingInput } from '../types/sample-record';

export interface SampleSaveResult {
  changedSamples: SampleRecord[];
  removedSampleId?: string;
  duplicateSample?: SampleRecord;
  protectedSample?: SampleRecord;
}

interface SampleState {
  samples: SampleRecord[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  markSampled: (id: string, input: SamplingInput) => Promise<SampleRecord>;
  markSent: (id: string, input: SendingInput) => Promise<SampleRecord>;
}

function normalizeSampleNo(value: string): string {
  return value.trim();
}

function nextTime(): string {
  return new Date().toISOString();
}

function rememberSample(changes: SampleRecord[], sample: SampleRecord): SampleRecord {
  const index = changes.findIndex((item) => item.id === sample.id);
  if (index >= 0) {
    changes[index] = sample;
  } else {
    changes.push(sample);
  }
  return sample;
}

function replaceSamplesInState(changes: SampleRecord[], removedId?: string) {
  if (!changes.length && !removedId) return;
  useSampleStore.setState((state) => {
    let samples = state.samples;
    changes.forEach((sample) => {
      const exists = samples.some((item) => item.id === sample.id);
      samples = exists ? samples.map((item) => (item.id === sample.id ? sample : item)) : [...samples, sample];
    });
    if (removedId) {
      samples = samples.filter((item) => item.id !== removedId);
    }
    return { samples };
  });
}

/** 保存岩性编录时同步样品台账；样品号若已属于其他钻孔则拒绝保存。 */
export async function saveLithoWithSample(log: LithoLog, previous?: LithoLog): Promise<SampleSaveResult> {
  const sampleNo = normalizeSampleNo(log.sampleNo);
  const previousSampleNo = normalizeSampleNo(previous?.sampleNo ?? '');

  return db.transaction('rw', db.lithos, db.samples, async () => {
    if (sampleNo) {
      const duplicate = await db.samples.where('sampleNo').equals(sampleNo).first();
      if (duplicate && duplicate.holeId !== log.holeId) {
        return { changedSamples: [], duplicateSample: duplicate };
      }
    }

    await db.lithos.put(log);

    const changedSamples: SampleRecord[] = [];
    let removedSampleId: string | undefined;

    if (sampleNo) {
      const existing = await db.samples.where('sampleNo').equals(sampleNo).first();
      const now = nextTime();
      const sample: SampleRecord = existing
        ? {
            ...existing,
            holeId: log.holeId,
            lithoLogId: log.id,
            fromDepth: log.fromDepth,
            toDepth: log.toDepth,
            updatedAt: now,
          }
        : {
            id: uid('sample'),
            sampleNo,
            holeId: log.holeId,
            lithoLogId: log.id,
            fromDepth: log.fromDepth,
            toDepth: log.toDepth,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
          };
      await db.samples.put(sample);
      rememberSample(changedSamples, sample);
    }

    if (previousSampleNo && previousSampleNo !== sampleNo) {
      const oldSample = await db.samples.where('sampleNo').equals(previousSampleNo).first();
      if (oldSample) {
        const otherLog = await db.lithos
          .filter((item) => item.id !== log.id && normalizeSampleNo(item.sampleNo) === previousSampleNo)
          .first();
        if (!otherLog) {
          if (oldSample.status === 'pending') {
            await db.samples.delete(oldSample.id);
            removedSampleId = oldSample.id;
          } else if (oldSample.lithoLogId === log.id) {
            const detached: SampleRecord = { ...oldSample, lithoLogId: undefined, updatedAt: nextTime() };
            await db.samples.put(detached);
            rememberSample(changedSamples, detached);
          }
        } else if (oldSample.lithoLogId === log.id) {
          const redirected: SampleRecord = {
            ...oldSample,
            holeId: otherLog.holeId,
            lithoLogId: otherLog.id,
            fromDepth: otherLog.fromDepth,
            toDepth: otherLog.toDepth,
            updatedAt: nextTime(),
          };
          await db.samples.put(redirected);
          rememberSample(changedSamples, redirected);
        }
      }
    }

    return { changedSamples, removedSampleId };
  });
}

/** 删除岩性编录时维护样品台账；已经取样或送检的样品不允许随编录删除。 */
export async function deleteLithoWithSample(log: LithoLog): Promise<SampleSaveResult> {
  const sampleNo = normalizeSampleNo(log.sampleNo);

  return db.transaction('rw', db.lithos, db.samples, async () => {
    let sample = sampleNo ? await db.samples.where('sampleNo').equals(sampleNo).first() : undefined;
    let removedSampleId: string | undefined;
    const changedSamples: SampleRecord[] = [];

    if (sample) {
      const otherLog = await db.lithos.filter((item) => item.id !== log.id && normalizeSampleNo(item.sampleNo) === sampleNo).first();
      if (!otherLog) {
        if (sample.status !== 'pending') {
          return { changedSamples: [], protectedSample: sample };
        }
        await db.samples.delete(sample.id);
        removedSampleId = sample.id;
        sample = undefined;
      } else if (sample.lithoLogId === log.id) {
        sample = {
          ...sample,
          holeId: otherLog.holeId,
          lithoLogId: otherLog.id,
          fromDepth: otherLog.fromDepth,
          toDepth: otherLog.toDepth,
          updatedAt: nextTime(),
        };
        await db.samples.put(sample);
        changedSamples.push(sample);
      }
    }

    await db.lithos.delete(log.id);
    return { changedSamples, removedSampleId };
  });
}

/** 样品取样、送检流转台账 */
export const useSampleStore = create<SampleState>()((set) => ({
  samples: [],
  hydrated: false,

  hydrate: async () => {
    const samples = await db.samples.orderBy('sampleNo').toArray();
    set({ samples, hydrated: true });
  },

  markSampled: async (id, input) => {
    const sampledBy = input.sampledBy.trim();
    const samplingVoucherNo = input.samplingVoucherNo.trim();
    const sample = await db.transaction('rw', db.samples, async () => {
      const current = await db.samples.get(id);
      if (!current) throw new Error('样品记录不存在或已被删除');
      if (current.status === 'sampled') throw new Error('该样品已完成取样');
      if (current.status === 'submitted') throw new Error('该样品已送检，不能重复取样');

      const next: SampleRecord = {
        ...current,
        status: 'sampled',
        sampledBy,
        sampledAt: input.sampledAt,
        samplingVoucherNo,
        sentBy: undefined,
        sentAt: undefined,
        sendingVoucherNo: undefined,
        sampleWeight: undefined,
        sendingUnit: undefined,
        updatedAt: nextTime(),
      };
      await db.samples.put(next);
      return next;
    });
    set((state) => ({ samples: state.samples.map((item) => (item.id === id ? sample : item)) }));
    return sample;
  },

  markSent: async (id, input) => {
    const sentBy = input.sentBy.trim();
    const sendingVoucherNo = input.sendingVoucherNo.trim();
    const sendingUnit = input.sendingUnit.trim();
    const sampleWeight = Number(input.sampleWeight);
    if (!(sampleWeight > 0)) throw new Error('请输入大于 0 的样品重量');

    const sample = await db.transaction('rw', db.samples, async () => {
      const current = await db.samples.get(id);
      if (!current) throw new Error('样品记录不存在或已被删除');
      if (current.status === 'pending') throw new Error('取样尚未完成，不能直接送检');
      if (current.status === 'submitted') throw new Error('该样品已完成送检');

      const next: SampleRecord = {
        ...current,
        status: 'submitted' as SampleStatus,
        sentBy,
        sentAt: input.sentAt,
        sendingVoucherNo,
        sampleWeight,
        sendingUnit,
        updatedAt: nextTime(),
      };
      await db.samples.put(next);
      return next;
    });
    set((state) => ({ samples: state.samples.map((item) => (item.id === id ? sample : item)) }));
    return sample;
  },
}));

export { replaceSamplesInState };
