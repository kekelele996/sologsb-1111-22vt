import type { Table } from 'dexie';
import type { LithoLog } from '../types/litho-log';
import type { SampleChain, SampleDeliverInput, SampleTakeInput } from '../types/sample-chain';
import { uid } from './id';

/** 流转同步只依赖 lithos / samples 两张表（可在 Dexie 事务或 upgrade 钩子内使用） */
export interface SampleTables {
  lithos: Table<LithoLog, string>;
  samples: Table<SampleChain, string>;
}

/** 由岩性编录生成一条待采样记录 */
function pendingFromLitho(litho: LithoLog): SampleChain {
  return {
    id: uid('sample'),
    sampleNo: litho.sampleNo.trim(),
    holeId: litho.holeId,
    lithoId: litho.id,
    fromDepth: litho.fromDepth,
    toDepth: litho.toDepth,
    status: 'pending',
  };
}

/** 样品号是否已被【其他钻孔】的岩性编录占用（同孔允许多段共用一个样品号） */
export async function findDuplicateSampleOnOtherHole(
  tables: Pick<SampleTables, 'lithos'>,
  sampleNo: string,
  holeId: string,
  ignoreLithoId?: string,
): Promise<LithoLog | undefined> {
  const trimmed = sampleNo.trim();
  if (!trimmed) return undefined;
  const matched = await tables.lithos.filter((l) => l.sampleNo?.trim() === trimmed).toArray();
  return matched.find((l) => l.holeId !== holeId && l.id !== ignoreLithoId);
}

/**
 * 按岩性编录批量补建待采样记录（v3 升级、备份恢复后调用）。
 * 同一样品号只建一条；跨孔重复的历史脏数据以最先出现的钻孔为准。
 */
export async function ensureSamplesFromLithos(tables: SampleTables, lithos: LithoLog[]): Promise<number> {
  const existing = await tables.samples.toArray();
  const byNo = new Map(existing.map((s) => [s.sampleNo, s]));
  const toPut: SampleChain[] = [];
  for (const litho of lithos) {
    const no = litho.sampleNo?.trim();
    if (!no || byNo.has(no)) continue;
    const chain = pendingFromLitho(litho);
    byNo.set(no, chain);
    toPut.push(chain);
  }
  if (toPut.length) await tables.samples.bulkPut(toPut);
  return toPut.length;
}

/**
 * 岩性编录保存后同步台账：录入样品号即自动建立待采样记录。
 * 已存在则只刷新来源岩性区间；已推进到已采样/已送检的状态与经办信息绝不回退。
 */
export async function upsertPendingSample(tables: SampleTables, litho: LithoLog): Promise<SampleChain | undefined> {
  const no = litho.sampleNo?.trim();
  if (!no) return undefined;
  const existing = await tables.samples.where('sampleNo').equals(no).first();
  if (existing) {
    const next: SampleChain = {
      ...existing,
      // 编录整体改挂到别的孔时，样品跟随其来源编录走；被别的编录引用时不动归属
      holeId: existing.lithoId && existing.lithoId !== litho.id ? existing.holeId : litho.holeId,
      lithoId: litho.id,
      fromDepth: litho.fromDepth,
      toDepth: litho.toDepth,
    };
    await tables.samples.put(next);
    return next;
  }
  const chain = pendingFromLitho(litho);
  await tables.samples.put(chain);
  return chain;
}

/**
 * 编录更新导致样品号变更/清空时的清理：
 * 旧编号仍是待采样 → 直接删除；已取样/已送检 → 仅解除与岩性区间的挂接，保留全部经办痕迹。
 */
export async function detachUnlinkedSample(tables: SampleTables, prev: LithoLog, next: LithoLog): Promise<void> {
  const prevNo = prev.sampleNo?.trim();
  const nextNo = next.sampleNo?.trim();
  if (!prevNo || prevNo === nextNo) return;
  const old = await tables.samples.where('sampleNo').equals(prevNo).first();
  if (!old || old.lithoId !== prev.id) return;
  if (old.status === 'pending') {
    await tables.samples.delete(old.id);
  } else {
    await tables.samples.put({ ...old, lithoId: undefined });
  }
}

/** 只有待采样可以办理取样 */
export function canMarkSampled(chain: SampleChain): boolean {
  return chain.status === 'pending';
}

/** 只有已采样（取样完成）才能送检，不允许跳步 */
export function canMarkDelivered(chain: SampleChain): boolean {
  return chain.status === 'sampled';
}

/** 取样登记：待采样 → 已采样，记录经办人、时间、取样凭证号 */
export function applySampling(chain: SampleChain, input: SampleTakeInput): SampleChain {
  if (!canMarkSampled(chain)) {
    throw new Error(`样品 ${chain.sampleNo} 当前不是待采样状态，不能重复取样`);
  }
  return {
    ...chain,
    status: 'sampled',
    sampledBy: input.sampledBy.trim(),
    sampledAt: input.sampledAt,
    sampleVoucherNo: input.sampleVoucherNo.trim(),
  };
}

/** 送检登记：已采样 → 已送检，记录经办人、时间、送样凭证号、重量与送检单位 */
export function applyDelivery(chain: SampleChain, input: SampleDeliverInput): SampleChain {
  if (!canMarkDelivered(chain)) {
    throw new Error(`样品 ${chain.sampleNo} 尚未完成取样，不能直接送检`);
  }
  return {
    ...chain,
    status: 'delivered',
    deliveredBy: input.deliveredBy.trim(),
    deliveredAt: input.deliveredAt,
    deliverVoucherNo: input.deliverVoucherNo.trim(),
    sampleWeight: Number(input.sampleWeight) || 0,
    labName: input.labName.trim(),
  };
}
