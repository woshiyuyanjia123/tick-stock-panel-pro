import crypto from 'node:crypto';
import { getDb } from '../db/sqliteDb';
import { getBeijingTimeInfo } from '../utils/marketHelpers';

export type BacktestEngineType =
  | 'ashare_t1'
  | 'pm_event'
  | 'cpo_dag'
  | 'alt_consensus'
  | 'futures_t0'
  | 'fact_buypoint'
  | 'fupeng_barbell'
  | string;

export interface ArchivedBacktestItem {
  id: string;
  userId: string;
  engineType: BacktestEngineType;
  symbol: string;
  symbolName: string;
  strategyName: string;
  totalReturnPct: number;
  excessReturnPct: number;
  annualReturnPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  winRatePct: number;
  tradeCount: number;
  paramsSummary: string;
  createdAt: string;
}

export type WebhookProviderType =
  | 'feishu'
  | 'dingtalk'
  | 'wecom'
  | 'telegram'
  | 'custom_json';

export interface WebhookChannelItem {
  id: string;
  name: string;
  provider: WebhookProviderType;
  webhookUrl: string;
  secret?: string;
  enabled: boolean;
  eventsFilter: string[];
  lastStatus?: string | null;
  lastSentAt?: string | null;
  createdAt: string;
}

function nowBj(): string {
  const bj = getBeijingTimeInfo();
  return `${bj.dateStr} ${bj.timeStr}`;
}

function mapBacktestRow(r: any): ArchivedBacktestItem {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    engineType: r.engine_type as BacktestEngineType,
    symbol: String(r.symbol),
    symbolName: String(r.symbol_name),
    strategyName: String(r.strategy_name),
    totalReturnPct: Number(r.total_return_pct),
    excessReturnPct: Number(r.excess_return_pct),
    annualReturnPct: Number(r.annual_return_pct),
    sharpe: Number(r.sharpe),
    maxDrawdownPct: Number(r.max_drawdown_pct),
    winRatePct: Number(r.win_rate_pct),
    tradeCount: Number(r.trade_count),
    paramsSummary: String(r.params_summary || ''),
    createdAt: String(r.created_at),
  };
}

export interface ArchiveBacktestInput {
  userId?: string;
  engineType: BacktestEngineType;
  symbol: string;
  symbolName: string;
  strategyName: string;
  totalReturnPct: number;
  excessReturnPct: number;
  annualReturnPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  winRatePct: number;
  tradeCount: number;
  paramsSummary: string;
  payload?: unknown;
}

export function archiveBacktestRun(input: ArchiveBacktestInput): ArchivedBacktestItem {
  const db = getDb();
  const id = `bt_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const userId = input.userId || 'u_desk_admin';
  const createdAt = nowBj();

  // Keep payload compact (omit giant intraday arrays if unnecessary, keep metrics & trades)
  let payloadStr = '{}';
  try {
    payloadStr = JSON.stringify(input.payload ?? {});
    if (payloadStr.length > 250_000 && input.payload && typeof input.payload === 'object') {
      const p = input.payload as Record<string, unknown>;
      payloadStr = JSON.stringify({
        metrics: p.metrics,
        trades: Array.isArray(p.trades) ? p.trades.slice(0, 200) : [],
        executionRule: p.executionRule,
        startDate: p.startDate,
        endDate: p.endDate,
      });
    }
  } catch {
    payloadStr = '{}';
  }

  db.prepare(`
    INSERT INTO backtest_runs
      (id, user_id, engine_type, symbol, symbol_name, strategy_name, total_return_pct, excess_return_pct, annual_return_pct, sharpe, max_drawdown_pct, win_rate_pct, trade_count, params_summary, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    input.engineType,
    String(input.symbol || ''),
    String(input.symbolName || input.symbol || ''),
    String(input.strategyName || '量化策略'),
    Number(Number(input.totalReturnPct || 0).toFixed(2)),
    Number(Number(input.excessReturnPct || 0).toFixed(2)),
    Number(Number(input.annualReturnPct || 0).toFixed(2)),
    Number(Number(input.sharpe || 0).toFixed(2)),
    Number(Number(input.maxDrawdownPct || 0).toFixed(2)),
    Number(Number(input.winRatePct || 0).toFixed(2)),
    Math.round(Number(input.tradeCount || 0)),
    String(input.paramsSummary || ''),
    payloadStr,
    createdAt
  );

  const row = db.prepare(`SELECT * FROM backtest_runs WHERE id = ?`).get(id) as any;
  return mapBacktestRow(row);
}

export function listArchivedBacktests(userId: string, engineType?: string): ArchivedBacktestItem[] {
  const db = getDb();
  const filterEngine = engineType && engineType !== 'all' && engineType !== '全部';
  const rows = (filterEngine
    ? db.prepare(`
        SELECT * FROM backtest_runs
        WHERE user_id = ? AND engine_type = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 200
      `).all(userId, engineType)
    : db.prepare(`
        SELECT * FROM backtest_runs
        WHERE user_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 200
      `).all(userId)) as any[];

  return rows.map(mapBacktestRow);
}

export function deleteArchivedBacktest(userId: string, id: string): ArchivedBacktestItem[] {
  const db = getDb();
  db.prepare(`DELETE FROM backtest_runs WHERE id = ? AND user_id = ?`).run(id, userId);
  return listArchivedBacktests(userId);
}

export function getArchivedBacktestById(
  userId: string,
  id: string
): { item: ArchivedBacktestItem; payload: any } | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM backtest_runs WHERE id = ? AND user_id = ?`).get(id, userId) as any;
  if (!row) return null;
  let payload: any = {};
  try {
    payload = JSON.parse(row.payload_json || '{}');
  } catch {
    payload = {};
  }
  return { item: mapBacktestRow(row), payload };
}

function escapeCsv(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const ENGINE_LABELS: Record<string, string> = {
  ashare_t1: 'A股 T+1 规则回测引擎',
  pm_event: 'Polymarket 事件概率联立引擎',
  cpo_dag: 'CPO 五节点贝叶斯传导引擎',
  alt_consensus: '跨平台超前认知预期差引擎',
  futures_t0: '国内期货 T+0 杠杆引擎',
  fact_buypoint: '多标的专属事实因子确定性买点引擎',
  fupeng_barbell: '付鹏全球宏观动态杠铃 FICC 引擎',
};

export function exportBacktestCsv(
  userId: string,
  id: string
): { filename: string; content: string } | null {
  const found = getArchivedBacktestById(userId, id);
  if (!found) return null;
  const { item, payload } = found;
  const trades: any[] = Array.isArray(payload?.trades) ? payload.trades : [];

  const summaryLines = [
    ['归档ID', item.id],
    ['引擎类型', ENGINE_LABELS[item.engineType] || item.engineType],
    ['标的', `${item.symbol} ${item.symbolName}`],
    ['策略名称', item.strategyName],
    ['总收益率(%)', item.totalReturnPct],
    ['超额收益率(%)', item.excessReturnPct],
    ['年化收益率(%)', item.annualReturnPct],
    ['Sharpe比率', item.sharpe],
    ['最大回撤(%)', item.maxDrawdownPct],
    ['胜率(%)', item.winRatePct],
    ['成交笔数', item.tradeCount],
    ['参数摘要', item.paramsSummary],
    ['归档时间', item.createdAt],
  ]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n');

  const tradeHeader = '序号,入场日期,出场日期,方向,入场价,出场价,盈亏金额,收益率(%),信号说明';
  const tradeLines = trades.map((t, idx) =>
    [
      t.id ?? idx + 1,
      t.entryDate || t.buyDate || '',
      t.exitDate || t.sellDate || '',
      t.side || '做多',
      t.entryPrice ?? t.buyPrice ?? '',
      t.exitPrice ?? t.sellPrice ?? '',
      t.pnl ?? '',
      t.returnPct ?? t.pnlPct ?? '',
      t.reason || '',
    ]
      .map(escapeCsv)
      .join(',')
  );

  const content = `\uFEFF${summaryLines}\n\n${tradeHeader}\n${tradeLines.join('\n')}`;
  return {
    filename: `tsp_backtest_${item.symbol}_${item.id}.csv`,
    content,
  };
}

export function exportBacktestMarkdown(
  userId: string,
  id: string
): { filename: string; content: string } | null {
  const found = getArchivedBacktestById(userId, id);
  if (!found) return null;
  const { item, payload } = found;
  const trades: any[] = Array.isArray(payload?.trades) ? payload.trades : [];

  const lines: string[] = [
    `# TSP Pro 机构投研回测归档报告 — ${item.symbol} ${item.symbolName}`,
    '',
    `- **归档编号**: \`${item.id}\``,
    `- **回测引擎**: ${ENGINE_LABELS[item.engineType] || item.engineType}`,
    `- **策略模型**: ${item.strategyName}`,
    `- **参数配置**: ${item.paramsSummary || '标准默认参数'}`,
    `- **归档时间**: ${item.createdAt}`,
    '',
    '## 一、核心绩效指标',
    '',
    '| 指标 | 数值 |',
    '| :--- | :--- |',
    `| 累计总收益率 | ${item.totalReturnPct >= 0 ? '+' : ''}${item.totalReturnPct.toFixed(2)}% |`,
    `| 超额收益率 | ${item.excessReturnPct >= 0 ? '+' : ''}${item.excessReturnPct.toFixed(2)}% |`,
    `| 年化收益率 | ${item.annualReturnPct >= 0 ? '+' : ''}${item.annualReturnPct.toFixed(2)}% |`,
    `| 夏普比率 (Sharpe) | ${item.sharpe.toFixed(2)} |`,
    `| 最大回撤 | -${Math.abs(item.maxDrawdownPct).toFixed(2)}% |`,
    `| 胜率 | ${item.winRatePct.toFixed(1)}% |`,
    `| 交易笔数 | ${item.tradeCount} 笔 |`,
    '',
    '## 二、逐笔交割审计流水',
    '',
  ];

  if (trades.length === 0) {
    lines.push('_该次归档未附带逐笔明细或区间内未触发有效建仓信号。_');
  } else {
    lines.push('| # | 入场日 | 出场日 | 方向 | 入场价 | 出场价 | 盈亏 | 收益率 | 信号归因 |');
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const ret = Number(t.returnPct ?? t.pnlPct ?? 0);
      lines.push(
        `| ${t.id ?? i + 1} | ${t.entryDate || t.buyDate || '-'} | ${t.exitDate || t.sellDate || '-'} | ${t.side || '做多'} | ${t.entryPrice ?? t.buyPrice ?? '-'} | ${t.exitPrice ?? t.sellPrice ?? '-'} | ${Number(t.pnl || 0).toFixed(2)} | ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}% | ${String(t.reason || '-').replace(/\|/g, '/')} |`
      );
    }
  }

  return {
    filename: `tsp_report_${item.symbol}_${item.id}.md`,
    content: lines.join('\n'),
  };
}

// ================= Real HTTP Webhook Gateway =================

function mapWebhookRow(r: any): WebhookChannelItem {
  let eventsFilter: string[] = ['anomaly', 'cpo_gate', 'pm_shock', 'paper_fill'];
  try {
    const parsed = JSON.parse(r.events_filter_json || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) eventsFilter = parsed;
  } catch {
    // keep default
  }
  return {
    id: String(r.id),
    name: String(r.name),
    provider: (r.provider || 'custom_json') as WebhookProviderType,
    webhookUrl: String(r.webhook_url),
    secret: r.secret ? String(r.secret) : undefined,
    enabled: Boolean(r.enabled),
    eventsFilter,
    lastStatus: r.last_status || null,
    lastSentAt: r.last_sent_at || null,
    createdAt: String(r.created_at),
  };
}

export function listWebhookChannels(userId: string): WebhookChannelItem[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM webhook_channels
    WHERE user_id = ?
    ORDER BY created_at DESC, rowid DESC
  `).all(userId) as any[];
  return rows.map(mapWebhookRow);
}

export function saveWebhookChannel(
  userId: string,
  payload: Partial<WebhookChannelItem>
): WebhookChannelItem[] {
  const db = getDb();
  const id = payload.id || `wh_${crypto.randomBytes(6).toString('hex')}`;
  const existing = db.prepare(`SELECT * FROM webhook_channels WHERE id = ? AND user_id = ?`).get(id, userId) as any;

  const provider: WebhookProviderType = (
    ['feishu', 'dingtalk', 'wecom', 'telegram', 'custom_json'].includes(String(payload.provider))
      ? payload.provider
      : existing?.provider || 'custom_json'
  ) as WebhookProviderType;

  const webhookUrl = String(payload.webhookUrl ?? existing?.webhook_url ?? '').trim();
  if (!webhookUrl) {
    throw new Error('请输入有效的 Webhook 推送地址');
  }

  const name = String(payload.name ?? existing?.name ?? '量化信号推送通道').trim() || '量化信号推送通道';
  const secret = payload.secret !== undefined ? String(payload.secret).trim() : (existing?.secret ?? '');
  const enabled = payload.enabled !== undefined ? (payload.enabled ? 1 : 0) : (existing ? existing.enabled : 1);
  const eventsFilter =
    Array.isArray(payload.eventsFilter) && payload.eventsFilter.length > 0
      ? payload.eventsFilter
      : existing
        ? JSON.parse(existing.events_filter_json || '[]')
        : ['anomaly', 'cpo_gate', 'pm_shock', 'paper_fill'];

  if (existing) {
    db.prepare(`
      UPDATE webhook_channels
      SET name = ?, provider = ?, webhook_url = ?, secret = ?, enabled = ?, events_filter_json = ?
      WHERE id = ? AND user_id = ?
    `).run(name, provider, webhookUrl, secret, enabled, JSON.stringify(eventsFilter), id, userId);
  } else {
    db.prepare(`
      INSERT INTO webhook_channels
        (id, user_id, name, provider, webhook_url, secret, enabled, events_filter_json, last_status, last_sent_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      name,
      provider,
      webhookUrl,
      secret,
      enabled,
      JSON.stringify(eventsFilter),
      '已创建，待测试推送',
      null,
      nowBj()
    );
  }

  return listWebhookChannels(userId);
}

export function deleteWebhookChannel(userId: string, id: string): WebhookChannelItem[] {
  const db = getDb();
  db.prepare(`DELETE FROM webhook_channels WHERE id = ? AND user_id = ?`).run(id, userId);
  return listWebhookChannels(userId);
}

function buildProviderRequest(
  channel: WebhookChannelItem,
  title: string,
  bodyLines: string[],
  level: 'info' | 'warn' | 'critical'
): { url: string; body: Record<string, unknown> } {
  const textBody = bodyLines.join('\n');
  let url = channel.webhookUrl;

  if (channel.provider === 'dingtalk') {
    if (channel.secret) {
      const timestamp = Date.now();
      const stringToSign = `${timestamp}\n${channel.secret}`;
      const sign = encodeURIComponent(
        crypto.createHmac('sha256', channel.secret).update(stringToSign).digest('base64')
      );
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}timestamp=${timestamp}&sign=${sign}`;
    }
    return {
      url,
      body: {
        msgtype: 'markdown',
        markdown: {
          title,
          text: `### ${title}\n${bodyLines.map((l) => `- ${l}`).join('\n')}`,
        },
      },
    };
  }

  if (channel.provider === 'feishu') {
    const body: Record<string, unknown> = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: title },
          template: level === 'critical' ? 'red' : level === 'warn' ? 'orange' : 'blue',
        },
        elements: [
          {
            tag: 'markdown',
            content: bodyLines.join('\n'),
          },
        ],
      },
    };
    if (channel.secret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const stringToSign = `${timestamp}\n${channel.secret}`;
      const sign = crypto.createHmac('sha256', stringToSign).digest('base64');
      body.timestamp = timestamp;
      body.sign = sign;
    }
    return { url, body };
  }

  if (channel.provider === 'wecom') {
    return {
      url,
      body: {
        msgtype: 'markdown',
        markdown: {
          content: `### ${title}\n${bodyLines.map((l) => `> ${l}`).join('\n')}`,
        },
      },
    };
  }

  if (channel.provider === 'telegram') {
    const body: Record<string, unknown> = {
      text: `*${title}*\n${textBody}`,
      parse_mode: 'Markdown',
    };
    if (channel.secret) {
      body.chat_id = channel.secret;
    }
    return { url, body };
  }

  return {
    url,
    body: {
      source: 'TSP_Pro_Enterprise',
      version: 'v1.0.0-enterprise',
      level,
      title,
      lines: bodyLines,
      timestamp: nowBj(),
    },
  };
}

async function sendWebhookPayload(
  userId: string,
  channel: WebhookChannelItem,
  title: string,
  bodyLines: string[],
  level: 'info' | 'warn' | 'critical' = 'info'
): Promise<{ ok: boolean; statusText: string }> {
  const db = getDb();
  const sentAt = nowBj();

  if (channel.webhookUrl.includes('replace-with-your-bot-token')) {
    const statusText = '示例占位地址未配置真实Token，请编辑填入实际Webhook后测试';
    db.prepare(`UPDATE webhook_channels SET last_status = ?, last_sent_at = ? WHERE id = ? AND user_id = ?`).run(
      statusText,
      sentAt,
      channel.id,
      userId
    );
    return { ok: false, statusText };
  }

  const { url, body } = buildProviderRequest(channel, title, bodyLines, level);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TSP-Pro-Enterprise/1.0.0',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await resp.text().catch(() => '');
    const snippet = text.slice(0, 120).replace(/\s+/g, ' ');
    const statusText = `HTTP ${resp.status} ${resp.ok ? 'OK' : 'ERR'}${snippet ? `: ${snippet}` : ''}`;
    db.prepare(`UPDATE webhook_channels SET last_status = ?, last_sent_at = ? WHERE id = ? AND user_id = ?`).run(
      statusText,
      sentAt,
      channel.id,
      userId
    );
    return { ok: resp.ok, statusText };
  } catch (err: any) {
    const statusText = `推送异常: ${err?.message || 'network timeout'}`;
    db.prepare(`UPDATE webhook_channels SET last_status = ?, last_sent_at = ? WHERE id = ? AND user_id = ?`).run(
      statusText,
      sentAt,
      channel.id,
      userId
    );
    return { ok: false, statusText };
  }
}

export async function testWebhookChannel(
  userId: string,
  id: string
): Promise<{ ok: boolean; statusText: string; channels: WebhookChannelItem[] }> {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM webhook_channels WHERE id = ? AND user_id = ?`).get(id, userId) as any;
  if (!row) {
    throw new Error('未找到目标 Webhook 通道');
  }
  const channel = mapWebhookRow(row);
  const result = await sendWebhookPayload(
    userId,
    channel,
    '[TSP Pro v1.0] 实盘预警网关链路测试',
    [
      `通道名称: ${channel.name} (${channel.provider})`,
      `发送时间: ${nowBj()}`,
      '状态: SQLite WAL 引擎与 SSE 实时推送链路运行正常',
    ],
    'info'
  );
  return {
    ok: result.ok,
    statusText: result.statusText,
    channels: listWebhookChannels(userId),
  };
}

export async function dispatchAlertToWebhooks(
  userId: string,
  event: {
    eventType: string;
    title: string;
    message: string;
    symbol?: string;
    level?: 'info' | 'warn' | 'critical';
  }
): Promise<{
  dispatchedCount: number;
  results: { id: string; ok: boolean; statusText: string }[];
}> {
  const channels = listWebhookChannels(userId).filter((c) => {
    if (!c.enabled) return false;
    if (!c.eventsFilter || c.eventsFilter.length === 0) return true;
    return c.eventsFilter.includes(event.eventType) || c.eventsFilter.includes('*');
  });

  if (channels.length === 0) {
    return { dispatchedCount: 0, results: [] };
  }

  const results = await Promise.all(
    channels.map(async (ch) => {
      const r = await sendWebhookPayload(
        userId,
        ch,
        event.title,
        [
          event.symbol ? `标的: ${event.symbol}` : '',
          `事件: ${event.eventType}`,
          `详情: ${event.message}`,
          `时间: ${nowBj()}`,
        ].filter(Boolean),
        event.level || 'warn'
      );
      return { id: ch.id, ok: r.ok, statusText: r.statusText };
    })
  );

  return {
    dispatchedCount: results.filter((r) => r.ok).length,
    results,
  };
}
