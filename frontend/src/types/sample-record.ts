/** 样品流转状态 */
export type SampleStatus = 'pending' | 'sampled' | 'submitted';

/** 样品流转记录 */
export interface SampleRecord {
  id: string;
  /** 样品号（全局唯一） */
  sampleNo: string;
  /** 所属钻孔 */
  holeId: string;
  /** 样品来源岩性编录 */
  lithoLogId?: string;
  /** 起始深度（m） */
  fromDepth: number;
  /** 终止深度（m） */
  toDepth: number;
  /** 待采样：编录保存后自动建立 */
  status: SampleStatus;
  /** 取样经办人 */
  sampledBy?: string;
  /** 取样时间 ISO */
  sampledAt?: string;
  /** 取样凭证号 */
  samplingVoucherNo?: string;
  /** 送检经办人 */
  sentBy?: string;
  /** 送检时间 ISO */
  sentAt?: string;
  /** 送检凭证号 */
  sendingVoucherNo?: string;
  /** 样品重量（kg） */
  sampleWeight?: number;
  /** 送检单位 */
  sendingUnit?: string;
  /** 创建时间 ISO */
  createdAt: string;
  /** 更新时间 ISO */
  updatedAt: string;
}

export const SAMPLE_STATUS_ORDER: SampleStatus[] = ['pending', 'sampled', 'submitted'];

export const SAMPLE_STATUS_LABEL: Record<SampleStatus, string> = {
  pending: '待采样',
  sampled: '已采样',
  submitted: '已送检',
};

export const SAMPLE_STATUS_COLOR: Record<SampleStatus, string> = {
  pending: 'orange',
  sampled: 'blue',
  submitted: 'green',
};

export interface SamplingInput {
  sampledBy: string;
  sampledAt: string;
  samplingVoucherNo: string;
}

export interface SendingInput {
  sentBy: string;
  sentAt: string;
  sendingVoucherNo: string;
  sampleWeight: number;
  sendingUnit: string;
}
