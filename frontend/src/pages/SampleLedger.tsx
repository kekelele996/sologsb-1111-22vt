import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CarOutlined, ExperimentOutlined, FileSearchOutlined } from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import StatBadge from '../components/common/StatBadge';
import { useHoleStore } from '../stores/holeStore';
import { useSampleStore } from '../stores/sampleStore';
import {
  LAB_NAMES,
  SAMPLE_STATUS_COLOR,
  SAMPLE_STATUS_LABEL,
  SAMPLE_STATUS_ORDER,
  type SampleChain,
  type SampleStatus,
} from '../types/sample-chain';

const { Title, Paragraph, Text } = Typography;

type ActionKind = 'sample' | 'deliver';

interface ActionFormValues {
  operator: string;
  actedAt: Dayjs;
  voucherNo: string;
  /** 送检专用 */
  sampleWeight?: number;
  labName?: string;
}

function formatTime(iso?: string): string {
  return iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '—';
}

/** 样品流转台账：录入样品号自动建待采样，取样 → 送检依次推进 */
export default function SampleLedger() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const samples = useSampleStore((s) => s.samples);
  const markSampled = useSampleStore((s) => s.markSampled);
  const markDelivered = useSampleStore((s) => s.markDelivered);

  const [holeFilter, setHoleFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<SampleStatus | undefined>();
  const [keyword, setKeyword] = useState('');

  const [form] = Form.useForm<ActionFormValues>();
  const [action, setAction] = useState<ActionKind | null>(null);
  const [acting, setActing] = useState<SampleChain | null>(null);
  const [detail, setDetail] = useState<SampleChain | null>(null);

  const holeMap = useMemo(() => new Map(holes.map((h) => [h.id, h])), [holes]);
  const holeNoOf = (holeId: string) => holeMap.get(holeId)?.holeNo ?? '（钻孔已删除）';
  const holeOptions = holes.map((hole) => ({ label: `${hole.holeNo} · ${hole.rigNo}`, value: hole.id }));

  const filtered = useMemo(() => {
    const kw = keyword.trim().toUpperCase();
    return samples.filter((s) => {
      if (holeFilter && s.holeId !== holeFilter) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (kw) {
        const haystack = [s.sampleNo, s.sampleVoucherNo, s.deliverVoucherNo, s.labName, s.sampledBy, s.deliveredBy]
          .filter(Boolean)
          .join(' ')
          .toUpperCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
  }, [samples, holeFilter, statusFilter, keyword]);

  const counts = useMemo(
    () => ({
      pending: samples.filter((s) => s.status === 'pending').length,
      sampled: samples.filter((s) => s.status === 'sampled').length,
      delivered: samples.filter((s) => s.status === 'delivered').length,
    }),
    [samples],
  );

  const openAction = (kind: ActionKind, record: SampleChain) => {
    setAction(kind);
    setActing(record);
    form.resetFields();
    form.setFieldsValue({
      operator: kind === 'sample' ? '高振华' : '周明',
      actedAt: dayjs(),
      voucherNo: '',
      sampleWeight: 1.2,
      labName: LAB_NAMES[0],
    } as unknown as ActionFormValues);
  };

  const closeAction = () => {
    setAction(null);
    setActing(null);
  };

  const submitAction = async () => {
    if (!acting || !action) return;
    const values = await form.validateFields();
    try {
      if (action === 'sample') {
        await markSampled(acting.id, {
          sampledBy: values.operator,
          sampledAt: values.actedAt.toISOString(),
          sampleVoucherNo: values.voucherNo,
        });
        message.success(`样品 ${acting.sampleNo} 已登记取样`);
      } else {
        await markDelivered(acting.id, {
          deliveredBy: values.operator,
          deliveredAt: values.actedAt.toISOString(),
          deliverVoucherNo: values.voucherNo,
          sampleWeight: Number(values.sampleWeight) || 0,
          labName: values.labName ?? LAB_NAMES[0],
        });
        message.success(`样品 ${acting.sampleNo} 已登记送检至 ${values.labName}`);
      }
      closeAction();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const columns: TableColumnsType<SampleChain> = [
    {
      title: '样品号',
      dataIndex: 'sampleNo',
      width: 150,
      fixed: 'left',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    { title: '钻孔', width: 110, render: (_, row) => holeNoOf(row.holeId) },
    { title: '采样深度(m)', width: 120, render: (_, row) => `${row.fromDepth}~${row.toDepth}` },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: SampleStatus) => <Tag color={SAMPLE_STATUS_COLOR[status]}>{SAMPLE_STATUS_LABEL[status]}</Tag>,
    },
    { title: '取样经办人', dataIndex: 'sampledBy', width: 100, render: (v?: string) => v ?? '-' },
    { title: '取样时间', dataIndex: 'sampledAt', width: 150, render: (v?: string) => formatTime(v) },
    { title: '取样凭证号', dataIndex: 'sampleVoucherNo', width: 130, render: (v?: string) => v ?? '-' },
    { title: '送检经办人', dataIndex: 'deliveredBy', width: 100, render: (v?: string) => v ?? '-' },
    { title: '送检时间', dataIndex: 'deliveredAt', width: 150, render: (v?: string) => formatTime(v) },
    { title: '送样凭证号', dataIndex: 'deliverVoucherNo', width: 130, render: (v?: string) => v ?? '-' },
    {
      title: '样品重量(kg)',
      dataIndex: 'sampleWeight',
      width: 120,
      align: 'right',
      render: (v?: number) => (typeof v === 'number' ? v.toFixed(2) : '-'),
    },
    { title: '送检单位', dataIndex: 'labName', width: 130, render: (v?: string) => v ?? '-' },
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space size={2}>
          <Button
            size="small"
            type="link"
            icon={<ExperimentOutlined />}
            disabled={record.status !== 'pending'}
            onClick={() => openAction('sample', record)}
          >
            取样
          </Button>
          <Button
            size="small"
            type="link"
            icon={<CarOutlined />}
            disabled={record.status !== 'sampled'}
            onClick={() => openAction('deliver', record)}
          >
            送检
          </Button>
          <Button size="small" type="link" icon={<FileSearchOutlined />} onClick={() => setDetail(record)}>
            明细
          </Button>
        </Space>
      ),
    },
  ];

  const stepIndex = (s: SampleStatus) => SAMPLE_STATUS_ORDER.indexOf(s);

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        样品流转台账
      </Title>
      <Paragraph type="secondary">
        岩性编录录入样品号即自动建立「待采样」记录；同一样品号在其他钻孔再次出现时编录保存会被拦下。取样、送检在台账依次推进，未取样不能送检，每步留存经办人、时间与凭证号。
      </Paragraph>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} md={8} lg={6}>
          <StatBadge label="待采样" value={counts.pending} status="warning" hint="等待班组取样登记" />
        </Col>
        <Col xs={12} md={8} lg={6}>
          <StatBadge label="已采样 / 待送检" value={counts.sampled} status="default" hint="已取样，等待送检登记" />
        </Col>
        <Col xs={12} md={8} lg={6}>
          <StatBadge label="已送检" value={counts.delivered} status="success" hint="已送化验室" />
        </Col>
        <Col xs={12} md={8} lg={6}>
          <StatBadge label="样品总数" value={samples.length} />
        </Col>
      </Row>

      <Space style={{ marginBottom: 12 }} wrap>
        <span style={{ color: '#6b7a86' }}>钻孔</span>
        <Select
          allowClear
          style={{ width: 220 }}
          placeholder="全部钻孔"
          value={holeFilter}
          onChange={(v?: string) => setHoleFilter(v)}
          options={holeOptions}
        />
        <span style={{ color: '#6b7a86' }}>状态</span>
        <Select
          allowClear
          style={{ width: 150 }}
          placeholder="全部状态"
          value={statusFilter}
          onChange={(v?: SampleStatus) => setStatusFilter(v)}
          options={SAMPLE_STATUS_ORDER.map((s) => ({ label: SAMPLE_STATUS_LABEL[s], value: s }))}
        />
        <Input.Search
          allowClear
          style={{ width: 220 }}
          placeholder="搜索样品号 / 凭证号 / 送检单位"
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Tag color={filtered.length === samples.length ? 'default' : 'blue'}>
          命中 {filtered.length} / {samples.length}
        </Tag>
      </Space>

      {samples.length === 0 ? (
        <Alert
          type="info"
          showIcon
          message="暂无样品记录"
          description="请先在「岩性编录」中为深度区间填写样品号，保存后自动建立待采样记录。"
        />
      ) : (
        <Card size="small" title="样品流转明细">
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={filtered}
            pagination={{ pageSize: 10, showSizeChanger: true }}
            scroll={{ x: 1750 }}
          />
        </Card>
      )}

      <Modal
        open={action !== null}
        title={
          acting
            ? action === 'sample'
              ? `取样登记 · ${acting.sampleNo}（${holeNoOf(acting.holeId)}）`
              : `送检登记 · ${acting.sampleNo}（${holeNoOf(acting.holeId)}）`
            : ''
        }
        onCancel={closeAction}
        onOk={submitAction}
        okText={action === 'sample' ? '确认取样' : '确认送检'}
        cancelText="取消"
        width={560}
      >
        {action === 'deliver' && acting?.status !== 'sampled' ? (
          <Alert style={{ marginBottom: 12 }} type="error" showIcon message="该样品尚未完成取样，不能直接送检" />
        ) : null}
        <Form form={form} layout="vertical">
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item
              name="operator"
              label={action === 'sample' ? '取样经办人' : '送检经办人'}
              rules={[{ required: true, message: '请填写经办人' }]}
            >
              <Input style={{ width: 180 }} maxLength={16} placeholder="经办人姓名" />
            </Form.Item>
            <Form.Item name="actedAt" label="时间" rules={[{ required: true, message: '请选择时间' }]}>
              <DatePicker showTime style={{ width: 220 }} />
            </Form.Item>
          </Space>
          <Form.Item
            name="voucherNo"
            label={action === 'sample' ? '取样凭证号' : '送样凭证号'}
            rules={[{ required: true, message: '请填写凭证号' }]}
          >
            <Input style={{ width: 320 }} maxLength={32} placeholder={action === 'sample' ? '如：QZ-2402-01' : '如：SY-2402-01'} />
          </Form.Item>
          {action === 'deliver' ? (
            <Space size={12} style={{ display: 'flex' }} align="start">
              <Form.Item name="sampleWeight" label="样品重量(kg)" rules={[{ required: true, message: '请填写样品重量' }]}>
                <InputNumber min={0} step={0.1} precision={3} style={{ width: 180 }} placeholder="如：1.250" />
              </Form.Item>
              <Form.Item name="labName" label="送检单位" rules={[{ required: true, message: '请填写送检单位' }]}>
                <Select
                  style={{ width: 240 }}
                  showSearch
                  options={LAB_NAMES.map((name) => ({ label: name, value: name }))}
                  dropdownRender={(menu) => (
                    <>
                      {menu}
                      <div style={{ padding: '4px 8px', color: '#9aa8b2', fontSize: 12 }}>可直接输入其他化验室名称</div>
                    </>
                  )}
                />
              </Form.Item>
            </Space>
          ) : null}
        </Form>
      </Modal>

      <Drawer
        open={detail !== null}
        width={480}
        title={detail ? `样品流转明细 · ${detail.sampleNo}` : ''}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <>
            <Steps
              size="small"
              current={stepIndex(detail.status)}
              style={{ marginBottom: 20 }}
              items={[
                { title: '编录建号' },
                { title: '取样' },
                { title: '送检' },
              ]}
            />
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="样品号">{detail.sampleNo}</Descriptions.Item>
              <Descriptions.Item label="所属钻孔">{holeNoOf(detail.holeId)}</Descriptions.Item>
              <Descriptions.Item label="采样深度">{`${detail.fromDepth}~${detail.toDepth} m`}</Descriptions.Item>
              <Descriptions.Item label="当前状态">
                <Tag color={SAMPLE_STATUS_COLOR[detail.status]}>{SAMPLE_STATUS_LABEL[detail.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="取样经办人">{detail.sampledBy ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="取样时间">{formatTime(detail.sampledAt)}</Descriptions.Item>
              <Descriptions.Item label="取样凭证号">{detail.sampleVoucherNo ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="送检经办人">{detail.deliveredBy ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="送检时间">{formatTime(detail.deliveredAt)}</Descriptions.Item>
              <Descriptions.Item label="送样凭证号">{detail.deliverVoucherNo ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="样品重量(kg)">
                {typeof detail.sampleWeight === 'number' ? detail.sampleWeight.toFixed(3) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="送检单位">{detail.labName ?? '—'}</Descriptions.Item>
            </Descriptions>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
