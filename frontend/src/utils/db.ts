import Dexie, { type Table } from 'dexie';
import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import type { LithoLog } from '../types/litho-log';
import type { SampleRecord } from '../types/sample-record';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbdrillcore-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class DrillCoreDB extends Dexie {
  holes!: Table<DrillHole, string>;
  runs!: Table<DrillRun, string>;
  boxes!: Table<CoreBox, string>;
  lithos!: Table<LithoLog, string>;
  samples!: Table<SampleRecord, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      holes: 'id, holeNo, rigNo, shift, startDate',
      runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
      boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
      lithos: 'id, holeId, fromDepth, toDepth, lithology',
      meta: 'key',
    });

    // v2：岩性表增加 (holeId+fromDepth) 复合索引，按深度区间查询更快；并回填历史 rqd 缺省值。
    // 升级前请在顶栏「导出备份」导出 JSON。
    this.version(2)
      .stores({
        holes: 'id, holeNo, rigNo, shift, startDate',
        runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
        boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
        lithos: 'id, holeId, fromDepth, toDepth, [holeId+fromDepth], lithology',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('lithos')
          .toCollection()
          .modify((row: LithoLog) => {
            if (typeof row.rqd !== 'number') {
              row.rqd = 0;
            }
          });
      });

    // v3：新增样品流转台账，样品号全局唯一；老数据中的样品号回填为“待采样”记录。
    this.version(3)
      .stores({
        holes: 'id, holeNo, rigNo, shift, startDate',
        runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
        boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
        lithos: 'id, holeId, fromDepth, toDepth, [holeId+fromDepth], lithology',
        samples: 'id, &sampleNo, holeId, status, lithoLogId, [holeId+status]',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const lithos = await tx.table<LithoLog, string>('lithos').toArray();
        const bySampleNo = new Map<string, LithoLog>();
        lithos.forEach((log) => {
          const sampleNo = log.sampleNo?.trim();
          if (sampleNo && !bySampleNo.has(sampleNo)) {
            bySampleNo.set(sampleNo, log);
          }
        });
        const now = new Date().toISOString();
        const samples: SampleRecord[] = Array.from(bySampleNo.entries()).map(([sampleNo, log]) => ({
          id: `sample-${log.id}`,
          sampleNo,
          holeId: log.holeId,
          lithoLogId: log.id,
          fromDepth: log.fromDepth,
          toDepth: log.toDepth,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        }));
        if (samples.length) {
          await tx.table<SampleRecord, string>('samples').bulkPut(samples);
        }
      });
  }
}

export const db = new DrillCoreDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
