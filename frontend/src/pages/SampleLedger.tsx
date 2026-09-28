import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useHoleStore } from '../stores/holeStore';
import { useSampleStore } from '../stores/sampleStore';
import {
  SAMPLE_STATUS_COLOR,
  SAMPLE_STATUS_LABEL,
  SAMPLE_STATUS_ORDER,
  type SampleRecord,
  type SampleStatus,
} from '../types/sample-record';

const { Title, Paragraph, Text } = Typography;

interface ActionFormValues {
  sampledBy?: string;
  sampledAt?: Dayjs;
  samplingVoucherNo?: string;
  sentBy?: string;
  sentAt?: Dayjs;
  sendingVoucherNo?: string;
  sampleWeight?: number;
  sendingUnit?: string;
}

function formatTime(value?: string): string {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
}

/** 样品流转台账：待采样 → 已采样 → 已送检，状态必须依次推进 */
export default function SampleLedger() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const samples = useSampleStore((s) => s.samples);
  const markSampled = useSampleStore((s) => s.markSampled);
  const markSent = useSampleStore((s) => s.markSent);

  const [holeFilter, setHoleFilter] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<SampleStatus>();
  const [actionSample, setActionSample] = useState<SampleRecord | null>(null);
  const [actionStatus, setActionStatus] = useState<SampleStatus>('sampled');
  const [form] = Form.useForm<ActionFormValues>();

  const holeNameById = useMemo(() => new Map(holes.map((hole) => [hole.id, hole.holeNo])), [holes]);
  const holeOptions = holes.map((hole) => ({ label: `${hole.holeNo} · 设计 ${hole.designDepth}m`, value: hole.id }));
  const statusOptions = SAMPLE_STATUS_ORDER.map((status) => ({ label: SAMPLE_STATUS_LABEL[status], value: status }));

  const filteredSamples = useMemo(() => {
    return samples
      .filter((sample) => !holeFilter || sample.holeId === holeFilter)
      .filter((sample) => !statusFilter || sample.status === statusFilter)
      .sort((a, b) => a.sampleNo.localeCompare(b.sampleNo, 'zh-CN'));
  }, [samples, holeFilter, statusFilter]);

  const statusCounts = useMemo(() => {
    return SAMPLE_STATUS_ORDER.reduce<Record<SampleStatus, number>>(
      (counts, status) => {
        counts[status] = samples.filter((sample) => (!holeFilter || sample.holeId === holeFilter) && sample.status === status).length;
        return counts;
      },
      { pending: 0, sampled: 0, submitted: 0 },
    );
  }, [samples, holeFilter]);

  const openAction = (record: SampleRecord, nextStatus: SampleStatus) => {
    setActionSample(record);
    setActionStatus(nextStatus);
    form.resetFields();
    if (nextStatus === 'sampled') {
      form.setFieldsValue({
        sampledBy: '高振华',
        sampledAt: dayjs(),
        samplingVoucherNo: `QZ-${record.sampleNo}`,
      });
    } else {
      form.setFieldsValue({
        sentBy: '陈立',
        sentAt: dayjs(),
        sendingVoucherNo: `SJ-${record.sampleNo}`,
        sampleWeight: undefined,
        sendingUnit: '矿区中心实验室',
      });
    }
  };

  const closeAction = () => {
    setActionSample(null);
  };

  const submitAction = async () => {
    if (!actionSample) return;
    const values = await form.validateFields();
    try {
      if (actionStatus === 'sampled') {
        await markSampled(actionSample.id, {
          sampledBy: values.sampledBy ?? '',
          sampledAt: values.sampledAt?.toISOString() ?? new Date().toISOString(),
          samplingVoucherNo: values.samplingVoucherNo ?? '',
        });
        message.success(`样品 ${actionSample.sampleNo} 已登记取样`);
      } else {
        await markSent(actionSample.id, {
          sentBy: values.sentBy ?? '',
          sentAt: values.sentAt?.toISOString() ?? new Date().toISOString(),
          sendingVoucherNo: values.sendingVoucherNo ?? '',
          sampleWeight: values.sampleWeight ?? 0,
          sendingUnit: values.sendingUnit ?? '',
        });
        message.success(`样品 ${actionSample.sampleNo} 已登记送检`);
      }
      closeAction();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const columns: TableColumnsType<SampleRecord> = [
    {
      title: '样品号',
      dataIndex: 'sampleNo',
      width: 140,
      fixed: 'left',
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '钻孔',
      dataIndex: 'holeId',
      width: 110,
      render: (holeId: string) => holeNameById.get(holeId) ?? <Tag color="red">钻孔已删除</Tag>,
    },
    { title: '取样深度(m)', width: 125, render: (_, row) => `${row.fromDepth}~${row.toDepth}` },
    { title: '状态', dataIndex: 'status', width: 90, render: (status: SampleStatus) => <Tag color={SAMPLE_STATUS_COLOR[status]}>{SAMPLE_STATUS_LABEL[status]}</Tag> },
    { title: '取样经办人', dataIndex: 'sampledBy', width: 100, render: (value?: string) => value ?? '-' },
    { title: '取样时间', dataIndex: 'sampledAt', width: 145, render: formatTime },
    { title: '取样凭证号', dataIndex: 'samplingVoucherNo', width: 135, render: (value?: string) => value ?? '-' },
    { title: '送检经办人', dataIndex: 'sentBy', width: 100, render: (value?: string) => value ?? '-' },
    { title: '送检时间', dataIndex: 'sentAt', width: 145, render: formatTime },
    { title: '送检凭证号', dataIndex: 'sendingVoucherNo', width: 135, render: (value?: string) => value ?? '-' },
    {
      title: '样品重量(kg)',
      dataIndex: 'sampleWeight',
      width: 120,
      align: 'right',
      render: (value?: number) => (typeof value === 'number' ? value.toFixed(2) : '-'),
    },
    { title: '送检单位', dataIndex: 'sendingUnit', width: 170, render: (value?: string) => value ?? '-' },
    {
      title: '操作',
      width: 100,
      fixed: 'right',
      render: (_, record) => {
        if (record.status === 'pending') {
          return (
            <Button size="small" type="link" onClick={() => openAction(record, 'sampled')}>
              取样
            </Button>
          );
        }
        if (record.status === 'sampled') {
          return (
            <Button size="small" type="link" onClick={() => openAction(record, 'submitted')}>
              送检
            </Button>
          );
        }
        return <Text type="secondary">流转完成</Text>;
      },
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        样品流转台账
      </Title>
      <Paragraph type="secondary">
        岩性编录保存样品号后自动建立“待采样”记录；同一编号不得出现在其他钻孔。取样完成后才能送检，各环节分别留存经办人、时间、凭证号，送检时登记样品重量与送检单位。
      </Paragraph>

      <Alert
        style={{ marginBottom: 12 }}
        type="info"
        showIcon
        message="流转顺序：待采样 → 已采样 → 已送检。前一步未完成时，系统不会开放并保存下一步操作。"
      />

      <Card size="small">
        <Space style={{ marginBottom: 12 }} wrap>
          <span style={{ color: '#6b7a86' }}>钻孔</span>
          <Select
            allowClear
            showSearch
            style={{ width: 240 }}
            placeholder="全部钻孔"
            value={holeFilter}
            options={holeOptions}
            onChange={(value?: string) => setHoleFilter(value)}
            optionFilterProp="label"
          />
          <span style={{ color: '#6b7a86' }}>状态</span>
          <Select
            allowClear
            style={{ width: 140 }}
            placeholder="全部状态"
            value={statusFilter}
            options={statusOptions}
            onChange={(value?: SampleStatus) => setStatusFilter(value)}
          />
          <Tag color="orange">待采样 {statusCounts.pending}</Tag>
          <Tag color="blue">已采样 {statusCounts.sampled}</Tag>
          <Tag color="green">已送检 {statusCounts.submitted}</Tag>
          <Tag>显示 {filteredSamples.length} / {samples.length}</Tag>
        </Space>

        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={filteredSamples}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1720 }}
        />
      </Card>

      <Modal
        open={!!actionSample}
        title={actionStatus === 'sampled' ? `确认取样 · ${actionSample?.sampleNo ?? ''}` : `确认送检 · ${actionSample?.sampleNo ?? ''}`}
        onCancel={closeAction}
        onOk={submitAction}
        okText={actionStatus === 'sampled' ? '保存取样' : '保存送检'}
        cancelText="取消"
      >
        {actionSample ? (
          <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
            <Alert
              style={{ marginBottom: 16 }}
              type={actionStatus === 'sampled' ? 'warning' : 'info'}
              showIcon
              message={
                actionStatus === 'sampled'
                  ? `${holeNameById.get(actionSample.holeId) ?? '未知钻孔'} · ${actionSample.fromDepth}~${actionSample.toDepth}m，登记后进入“已采样”`
                  : `取样信息：${actionSample.sampledBy ?? '-'} · ${formatTime(actionSample.sampledAt)} · 凭证 ${actionSample.samplingVoucherNo ?? '-'}`
              }
            />

            {actionStatus === 'sampled' ? (
              <>
                <Space size={12} style={{ display: 'flex' }} align="start">
                  <Form.Item name="sampledBy" label="取样经办人" rules={[{ required: true, message: '请输入取样经办人' }]}>
                    <Input style={{ width: 180 }} maxLength={16} placeholder="取样经办人" />
                  </Form.Item>
                  <Form.Item name="sampledAt" label="取样时间" rules={[{ required: true, message: '请选择取样时间' }]}>
                    <DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" style={{ width: 200 }} />
                  </Form.Item>
                </Space>
                <Form.Item name="samplingVoucherNo" label="取样凭证号" rules={[{ required: true, message: '请输入取样凭证号' }]}>
                  <Input maxLength={32} placeholder="如：QZ-YP-2401-01" />
                </Form.Item>
              </>
            ) : (
              <>
                <Space size={12} style={{ display: 'flex' }} align="start">
                  <Form.Item name="sentBy" label="送检经办人" rules={[{ required: true, message: '请输入送检经办人' }]}>
                    <Input style={{ width: 180 }} maxLength={16} placeholder="送检经办人" />
                  </Form.Item>
                  <Form.Item name="sentAt" label="送检时间" rules={[{ required: true, message: '请选择送检时间' }]}>
                    <DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" style={{ width: 200 }} />
                  </Form.Item>
                </Space>
                <Space size={12} style={{ display: 'flex' }} align="start">
                  <Form.Item name="sendingVoucherNo" label="送检凭证号" rules={[{ required: true, message: '请输入送检凭证号' }]}>
                    <Input style={{ width: 210 }} maxLength={32} placeholder="如：SJ-YP-2401-01" />
                  </Form.Item>
                  <Form.Item name="sampleWeight" label="样品重量(kg)" rules={[{ required: true, message: '请输入样品重量' }]}>
                    <InputNumber min={0.01} precision={2} style={{ width: 160 }} placeholder="重量" />
                  </Form.Item>
                </Space>
                <Form.Item name="sendingUnit" label="送检单位" rules={[{ required: true, message: '请输入送检单位' }]}>
                  <Input maxLength={40} placeholder="如：矿区中心实验室" />
                </Form.Item>
              </>
            )}
          </Form>
        ) : null}
      </Modal>
    </div>
  );
}
