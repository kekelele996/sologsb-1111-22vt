/** 样品流转状态：待采样 → 已采样 → 已送检（按顺序单向推进） */
export type SampleStatus = 'pending' | 'sampled' | 'delivered';

/** 样品流转台账记录（岩性编录录入样品号时自动建立） */
export interface SampleChain {
  id: string;
  /** 样品号（全库唯一，不允许在不同钻孔重复出现） */
  sampleNo: string;
  /** 所属钻孔（取首次录入该样品号的岩性编录） */
  holeId: string;
  /** 来源岩性编录 id（样品号被清空或改走时可能为空） */
  lithoId?: string;
  /** 采样深度起（m，来自岩性编录区间） */
  fromDepth: number;
  /** 采样深度止（m，来自岩性编录区间） */
  toDepth: number;
  /** 流转状态 */
  status: SampleStatus;
  /** 取样经办人 */
  sampledBy?: string;
  /** 取样时间 ISO */
  sampledAt?: string;
  /** 取样凭证号 */
  sampleVoucherNo?: string;
  /** 送检经办人 */
  deliveredBy?: string;
  /** 送检时间 ISO */
  deliveredAt?: string;
  /** 送检凭证号（送样单编号） */
  deliverVoucherNo?: string;
  /** 样品重量（kg，送检时登记） */
  sampleWeight?: number;
  /** 送检单位（化验室） */
  labName?: string;
  /** 备注 */
  remark?: string;
}

/** 取样登记输入 */
export interface SampleTakeInput {
  sampledBy: string;
  sampledAt: string;
  sampleVoucherNo: string;
}

/** 送检登记输入 */
export interface SampleDeliverInput {
  deliveredBy: string;
  deliveredAt: string;
  deliverVoucherNo: string;
  sampleWeight: number;
  labName: string;
}

export const SAMPLE_STATUS_LABEL: Record<SampleStatus, string> = {
  pending: '待采样',
  sampled: '已采样',
  delivered: '已送检',
};

export const SAMPLE_STATUS_COLOR: Record<SampleStatus, string> = {
  pending: 'default',
  sampled: 'processing',
  delivered: 'success',
};

export const SAMPLE_STATUS_ORDER: SampleStatus[] = ['pending', 'sampled', 'delivered'];

/** 常用送检单位（化验室） */
export const LAB_NAMES: string[] = ['中心化验室', '地质测试中心', '第三方检测机构'];

/** 岩性编录保存时样品号跨钻孔重复 */
export class DuplicateSampleError extends Error {
  constructor(
    public sampleNo: string,
    public holeId: string,
  ) {
    super(`样品号 ${sampleNo} 已在其他钻孔登记，不能重复使用`);
    this.name = 'DuplicateSampleError';
  }
}
