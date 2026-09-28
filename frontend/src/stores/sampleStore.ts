import { create } from 'zustand';
import { db } from '../utils/db';
import { applyDelivery, applySampling } from '../utils/sample-chain';
import type { SampleChain, SampleDeliverInput, SampleStatus, SampleTakeInput } from '../types/sample-chain';

interface SampleState {
  samples: SampleChain[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 取全部样品号（岩性编录录入时用于同步查重提示） */
  sampleNos: () => string[];
  /** 取样登记：待采样 → 已采样 */
  markSampled: (id: string, input: SampleTakeInput) => Promise<SampleChain>;
  /** 送检登记：已采样 → 已送检（前一步未完成会抛错拦截） */
  markDelivered: (id: string, input: SampleDeliverInput) => Promise<SampleChain>;
}

function sortSamples(list: SampleChain[]): SampleChain[] {
  const rank: Record<SampleStatus, number> = { pending: 0, sampled: 1, delivered: 2 };
  return [...list].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return b.sampleNo.localeCompare(a.sampleNo);
  });
}

/** 样品流转台账：取样、送检依次推进 */
export const useSampleStore = create<SampleState>()((set, get) => ({
  samples: [],
  hydrated: false,

  hydrate: async () => {
    const samples = await db.samples.toArray();
    set({ samples: sortSamples(samples), hydrated: true });
  },

  sampleNos: () => get().samples.map((s) => s.sampleNo),

  markSampled: async (id, input) => {
    const current = get().samples.find((s) => s.id === id);
    if (!current) throw new Error('样品记录不存在');
    const next = applySampling(current, input);
    await db.samples.put(next);
    set({ samples: sortSamples(get().samples.map((s) => (s.id === id ? next : s))) });
    return next;
  },

  markDelivered: async (id, input) => {
    const current = get().samples.find((s) => s.id === id);
    if (!current) throw new Error('样品记录不存在');
    const next = applyDelivery(current, input);
    await db.samples.put(next);
    set({ samples: sortSamples(get().samples.map((s) => (s.id === id ? next : s))) });
    return next;
  },
}));
