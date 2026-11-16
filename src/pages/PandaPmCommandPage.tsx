import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Check, Copy, ExternalLink, Play, RefreshCw, Search } from 'lucide-react';

export interface PandaPmCommandPageProps {
  onSelectStock: (code: string, name?: string, date?: string) => void;
  onNavigate?: (tab: string) => void;
}

type WorkspaceTab = 'pm-futures' | 'pm-correlation' | 'factors' | 'futures-bt' | 'autonomy';
type ScanUniverse = 'ashare' | 'futures';
type PoolFilter = '全部' | 'Pool 153/159' | '4th大赛' | 'V11-V13深挖' | '24h进化实验室' | '学术/行为金融';
type ExchangeFilter = '全部' | 'SHFE' | 'DCE' | 'CZCE' | 'INE' | 'CFFEX' | 'GFEX';

type PmAssetUniverse = 'all' | 'futures' | 'ashare_stock' | 'sector';
type PmEventSignalMode = 'shock_breakout' | 'divergence_reversion' | 'regime_trend' | 'kelly_pair_basket';

interface OverviewSummary {
  totalMinedFactors?: number;
  activePoolsCount?: number;
  futuresContractsCount?: number;
  pmEventsCount?: number;
  account5091NotesCount?: number;
  lastUpdated?: string;
}

interface PandaFactor {
  id: string;
  name: string;
  category?: string;
  pool?: string;
  sourceFile?: string;
  expression?: string;
  description?: string;
  sharpe?: number;
  ic?: number;
  rankIc?: number;
  ir?: number;
  turnover?: number;
  fitness?: number;
  direction?: number | string;
  tags?: string[];
}

interface ImpactAsset {
  symbol: string;
  name: string;
  market?: string;
  direction?: string;
  confidence?: number;
  logic?: string;
}

interface PmEvent {
  id: string;
  title: string;
  category?: string;
  yesProb?: number;
  change24h?: number;
  volumeUsd?: number;
  url?: string;
  impactAssets?: ImpactAsset[];
}

interface FuturesQuote {
  symbol: string;
  code?: string;
  name: string;
  exchange?: string;
  price?: number;
  changePct?: number;
  open?: number;
  high?: number;
  low?: number;
  prevSettle?: number;
  volume?: number;
  openInterest?: number;
  pmSignal?: string;
  linkedEventTitle?: string;
  strategyAdvice?: string;
}

interface ArbitrageStrategy {
  id: string;
  name: string;
  type?: string;
  legs?: string[];
  triggerCondition?: string;
  currentSpread?: number | string;
  zScore?: number;
  signal?: string;
  winRateEst?: number;
  riskRule?: string;
  sourceDoc?: string;
}

interface AutonomyLog {
  id: string;
  folder?: string;
  title: string;
  updatedAt?: string;
  summary?: string;
  content?: string;
}

interface OverviewPayload {
  summary?: OverviewSummary;
  factors?: PandaFactor[];
  pmEvents?: PmEvent[];
  futuresQuotes?: FuturesQuote[];
  arbitrageStrategies?: ArbitrageStrategy[];
  autonomyLogs?: AutonomyLog[];
}

interface FactorScanTarget {
  code: string;
  name: string;
  price?: number;
  changePct?: number;
  factorValue?: number;
  zScore?: number;
  signal?: string;
  reason?: string;
}

interface FactorScanResponse {
  factor?: PandaFactor;
  targets?: FactorScanTarget[];
  stats?: {
    mean?: number;
    std?: number;
    longTopAvgPct?: number;
    shortBottomAvgPct?: number;
    spreadPct?: number;
  };
}

interface FuturesKlineBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  openInterest?: number;
  changePct?: number;
  ma5?: number | null;
  ma10?: number | null;
  ma20?: number | null;
  ma60?: number | null;
}

interface FuturesKlineResponse {
  symbol: string;
  name?: string;
  klines?: FuturesKlineBar[];
}

interface FuturesBacktestResponse {
  metrics?: {
    totalReturnPct?: number;
    annualReturnPct?: number;
    maxDrawdownPct?: number;
    sharpe?: number;
    winRatePct?: number;
    profitFactor?: number;
    tradeCount?: number;
  };
  equityCurve?: Array<{
    date: string;
    equity: number;
    benchmark?: number;
    price?: number;
  }>;
  klines?: FuturesKlineBar[];
  trades?: Array<{
    entryDate: string;
    exitDate: string;
    side: string;
    entryPrice: number;
    exitPrice: number;
    lots?: number;
    pnl: number;
    returnPct: number;
    reason?: string;
  }>;
}

// V4 Locked Contract Interfaces
interface PmLeadLagPoint {
  lag: number;
  corr: number;
  rankCorr: number;
  tStat: number;
  sampleSize: number;
}

interface PmDiscoveredRelationItem {
  eventId: string;
  eventTitle: string;
  eventCategory: string;
  yesProb: number;
  probChange24h: number;
  probChange5d: number;
  assetSymbol: string;
  assetName: string;
  assetMarket: string;
  transmissionTier: '一阶直连' | '二阶传导' | '宏观共振' | string;
  expectedDirection: 1 | -1;
  mechanism: string;
  hedgeLegSymbol?: string;
  hedgeLegName?: string;
  optimalLagDays: number;
  pearsonCorr: number;
  spearmanCorr: number;
  shockCorr: number;
  shockHitRate: number;
  grangerFStat: number;
  rollingBeta: number;
  impliedPrice: number;
  actualPrice: number;
  divergenceZScore: number;
  alphaState: '预期差严重滞后' | 'PM异动共振' | '定价充分' | '短期过热背离' | string;
  compositeScore: number;
  kellySuggestedPct: number;
  leadLagProfile: PmLeadLagPoint[];
}

interface PmMatrixCell {
  eventId: string;
  eventShortTitle: string;
  assetSymbol: string;
  assetName: string;
  optimalLagDays: number;
  shockCorr: number;
  divergenceZScore: number;
  compositeScore: number;
}

interface PmRelationMatrixResponse {
  updatedAt?: string;
  alignmentRule?: string;
  events?: PmEvent[];
  relations?: PmDiscoveredRelationItem[];
  matrixCells?: PmMatrixCell[];
  methodologyNotes?: string[];
}

interface PmEventAlignedPoint {
  date: string;
  yesProb: number;
  probDelta: number;
  assetClose: number;
  assetReturnPct: number;
  impliedAssetPrice: number;
  divergenceZ: number;
  rollingCorr20d: number;
  positionDir: -1 | 0 | 1;
}

interface PmEventBacktestTrade {
  id: number;
  entryDate: string;
  exitDate: string;
  side: '做多' | '做空' | '多空配对' | string;
  entryPrice: number;
  exitPrice: number;
  entryProb: number;
  exitProb: number;
  entryProbDelta: number;
  entryDivergenceZ: number;
  positionPct: number;
  pnl: number;
  returnPct: number;
  holdingDays: number;
  reason: string;
}

interface PmEventBacktestResponse {
  eventId: string;
  eventTitle: string;
  assetSymbol: string;
  assetName: string;
  assetMarket: string;
  executionRule: string;
  signalMode: PmEventSignalMode;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalCapital: number;
  relationSummary?: {
    optimalLagDays?: number;
    pearsonCorr?: number;
    shockCorr?: number;
    shockHitRate?: number;
    currentDivergenceZ?: number;
    rollingBeta?: number;
    kellySuggestedPct?: number;
    mechanism?: string;
  };
  leadLagProfile?: PmLeadLagPoint[];
  alignedSeries?: PmEventAlignedPoint[];
  equityCurve?: Array<{
    date: string;
    equity: number;
    returnPct: number;
    benchmarkPct: number;
    drawdownPct: number;
  }>;
  metrics?: {
    totalReturnPct?: number;
    annualReturnPct?: number;
    benchmarkReturnPct?: number;
    excessReturnPct?: number;
    maxDrawdownPct?: number;
    sharpe?: number;
    calmar?: number;
    informationRatio?: number;
    winRatePct?: number;
    profitFactor?: number;
    avgHoldingDays?: number;
    kellyOptimalPct?: number;
    tradeCount?: number;
  };
  trades?: PmEventBacktestTrade[];
}

const POOL_FILTERS: PoolFilter[] = [
  '全部',
  'Pool 153/159',
  '4th大赛',
  'V11-V13深挖',
  '24h进化实验室',
  '学术/行为金融',
];

const EXCHANGE_FILTERS: Array<{ id: ExchangeFilter; label: string }> = [
  { id: '全部', label: '全部' },
  { id: 'SHFE', label: '上期所' },
  { id: 'DCE', label: '大商所' },
  { id: 'CZCE', label: '郑商所' },
  { id: 'INE', label: '能源' },
  { id: 'CFFEX', label: '中金所' },
  { id: 'GFEX', label: '广期所' },
];

const PM_UNIVERSES: Array<{ id: PmAssetUniverse; label: string }> = [
  { id: 'all', label: '全部标的' },
  { id: 'futures', label: '国内28期货' },
  { id: 'ashare_stock', label: 'A股瓶颈龙头' },
  { id: 'sector', label: 'A股核心板块' },
];

const PM_SIGNAL_MODES: Array<{ id: PmEventSignalMode; label: string }> = [
  { id: 'shock_breakout', label: '概率脉冲突破' },
  { id: 'divergence_reversion', label: '隐含定价偏离回归' },
  { id: 'regime_trend', label: '概率阈值趋势共振' },
  { id: 'kelly_pair_basket', label: '多空瓶颈篮子+Kelly' },
];

const FUTURES_STRATEGIES = [
  {
    id: 'pm_macro_trend',
    name: 'PM宏观情绪共振趋势',
    tag: '跨市概率锚',
    desc: '结合Polymarket宏观事件概率变动、订单簿OBI与国内期货趋势共振开平仓',
  },
  {
    id: 'panda_factor_momentum',
    name: 'PandaAI动量截面突破',
    tag: '因子驱动',
    desc: '基于PandaAI多尺度量价动量与波动率软门控，捕捉主连趋势加速段',
  },
  {
    id: 'dual_thrust',
    name: 'Dual Thrust日内/波段突破',
    tag: '经典CTA',
    desc: '动态计算前N日振幅Range上下轨，突破上轨做多、跌破下轨反手做空',
  },
  {
    id: 'turtle_breakout',
    name: '海龟通道趋势',
    tag: '长波段CTA',
    desc: '20日唐奇安通道突破建仓 + 10日通道反向止盈 + ATR动态追踪止损',
  },
  {
    id: 'spread_reversion',
    name: '均值回归布林反转',
    tag: '震荡高胜率',
    desc: '价格偏离20日均线超过2倍标准差出现动能衰竭时反向做多/做空回归均值',
  },
] as const;

const QUICK_FUTURES = [
  { symbol: 'AU0', label: '沪金AU0' },
  { symbol: 'AG0', label: '沪银AG0' },
  { symbol: 'SC0', label: '原油SC0' },
  { symbol: 'CU0', label: '沪铜CU0' },
  { symbol: 'RB0', label: '螺纹RB0' },
  { symbol: 'M0', label: '豆粕M0' },
  { symbol: 'P0', label: '棕榈P0' },
  { symbol: 'LC0', label: '碳酸锂LC0' },
  { symbol: 'IF0', label: '沪深IF0' },
];

const LOG_FOLDERS = [
  '全部',
  '00_MOC总控台',
  '01_PM实时抓取与推演思考',
  '02_不间断因子进化实验室',
  '03_账户5091实盘与错题复盘',
  '04_每日完整成交复盘',
];

function safeNum(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && !Number.isNaN(val) && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Number(val.replace(/[,%]/g, ''));
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function fmtNum(val: unknown, digits = 2): string {
  if (val === undefined || val === null) return '-';
  const n = typeof val === 'number' ? val : Number(val);
  if (Number.isNaN(n) || !Number.isFinite(n)) return '-';
  return n.toFixed(digits);
}

function fmtPct(val: unknown, digits = 2): string {
  if (val === undefined || val === null) return '-';
  const n = typeof val === 'number' ? val : Number(val);
  if (Number.isNaN(n) || !Number.isFinite(n)) return '-';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function fmtCompact(val: unknown): string {
  const n = safeNum(val, NaN);
  if (Number.isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function fmtUsd(val: unknown): string {
  const n = safeNum(val, NaN);
  if (Number.isNaN(n)) return '-';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// Authentic Wind / Tonghuashun palette: Up = #ff3535, Down = #00c853, Flat = #8b949e
function dirColorClass(val?: number | null): string {
  if (val === undefined || val === null || val === 0 || Number.isNaN(val)) return 'text-[#8b949e]';
  return val > 0 ? 'text-[#ff3535]' : 'text-[#00c853]';
}

function signalTagClass(signal?: string): string {
  const s = (signal || '').toLowerCase();
  if (
    s.includes('强多') ||
    s.includes('做多') ||
    s.includes('偏多') ||
    s.includes('long') ||
    s.includes('买入') ||
    s.includes('多头')
  ) {
    return 'bg-[#2a1215] text-[#ff3535] border-[#5c1d22]';
  }
  if (
    s.includes('强空') ||
    s.includes('做空') ||
    s.includes('偏空') ||
    s.includes('short') ||
    s.includes('卖出') ||
    s.includes('空头')
  ) {
    return 'bg-[#0d261a] text-[#00c853] border-[#194d33]';
  }
  if (s.includes('触发') || s.includes('共振') || s.includes('alpha') || s.includes('滞后')) {
    return 'bg-[#261d0d] text-[#f0b90b] border-[#574115]';
  }
  return 'bg-[#161b24] text-[#8b95a5] border-[#252c38]';
}

function alphaStateTagClass(state?: string): string {
  if (!state) return 'bg-[#161b24] text-[#8b95a5] border-[#252c38]';
  if (state.includes('滞后')) return 'bg-[#2a1215] text-[#ff8800] border-[#ff8800] font-bold';
  if (state.includes('共振')) return 'bg-[#2a1215] text-[#ff3535] border-[#5c1d22]';
  if (state.includes('背离') || state.includes('过热')) return 'bg-[#0d261a] text-[#00c853] border-[#194d33]';
  return 'bg-[#161b24] text-[#8b95a5] border-[#252c38]';
}

function isLongDirection(signal?: string): boolean {
  const s = (signal || '').toLowerCase();
  return s.includes('多') || s.includes('long') || s.includes('buy') || s.includes('bull');
}

function isShortDirection(signal?: string): boolean {
  const s = (signal || '').toLowerCase();
  return s.includes('空') || s.includes('short') || s.includes('sell') || s.includes('bear');
}

function isAShareLikeSymbol(symbol?: string, market?: string): boolean {
  const s = (symbol || '').trim();
  const m = (market || '').toLowerCase();
  return /^\d{6}$/.test(s) || /^bk\d+/i.test(s) || m.includes('a股') || m.includes('板块') || m.includes('ashare');
}

function matchPoolFilter(f: PandaFactor, filter: PoolFilter): boolean {
  if (filter === '全部') return true;
  const hay = `${f.pool || ''} ${f.category || ''} ${f.sourceFile || ''} ${(f.tags || []).join(' ')} ${f.name || ''}`.toLowerCase();
  if (filter === 'Pool 153/159') return hay.includes('153') || hay.includes('159') || hay.includes('pool');
  if (filter === '4th大赛') return hay.includes('4th') || hay.includes('大赛') || hay.includes('竞赛') || hay.includes('冠军');
  if (filter === 'V11-V13深挖') return hay.includes('v11') || hay.includes('v12') || hay.includes('v13') || hay.includes('深挖');
  if (filter === '24h进化实验室') return hay.includes('24h') || hay.includes('进化') || hay.includes('auton') || hay.includes('pm');
  if (filter === '学术/行为金融')
    return (
      hay.includes('学术') ||
      hay.includes('行为') ||
      hay.includes('salience') ||
      hay.includes('entropy') ||
      hay.includes('yale') ||
      hay.includes('耶鲁')
    );
  return true;
}

function matchExchangeFilter(q: FuturesQuote, filter: ExchangeFilter): boolean {
  if (filter === '全部') return true;
  const ex = (q.exchange || '').toUpperCase();
  if (filter === 'SHFE') return ex.includes('SHFE') || ex.includes('SHF') || ex.includes('上期');
  if (filter === 'DCE') return ex.includes('DCE') || ex.includes('大商');
  if (filter === 'CZCE') return ex.includes('CZCE') || ex.includes('CZC') || ex.includes('郑商');
  if (filter === 'INE') return ex.includes('INE') || ex.includes('能源');
  if (filter === 'CFFEX') return ex.includes('CFFEX') || ex.includes('中金');
  if (filter === 'GFEX') return ex.includes('GFEX') || ex.includes('GFE') || ex.includes('广期');
  return true;
}

function matchLogFolder(log: AutonomyLog, folderFilter: string): boolean {
  if (folderFilter === '全部') return true;
  const hay = `${log.folder || ''} ${log.title || ''}`.toLowerCase();
  const prefix = folderFilter.slice(0, 6).toLowerCase();
  return hay.includes(prefix) || hay.includes(folderFilter.toLowerCase());
}

const HIGHLIGHT_KEYWORDS = new Set([
  'RANK',
  'TS_MEAN',
  'TS_STD',
  'TS_MAX',
  'TS_MIN',
  'TS_SUM',
  'TS_RANK',
  'DELTA',
  'DELAY',
  'CORR',
  'COV',
  'EMA',
  'SMA',
  'WMA',
  'STD',
  'MEAN',
  'ZSCORE',
  'ORTH',
  'SOFT_GATE',
  'GATE',
  'CYQ',
  'ABS',
  'SIGN',
  'LOG',
  'SQRT',
  'CLIP',
  'CLOSE',
  'OPEN',
  'HIGH',
  'LOW',
  'VOLUME',
  'AMOUNT',
  'VWAP',
  'RETURNS',
  'TURNOVER',
  'CAP',
  'BETA',
  'UMP',
  'BGS',
  'OBI',
  'def',
  'return',
  'np',
  'pd',
]);

function renderHighlightedExpression(expr: string): React.ReactNode {
  const lines = (expr || '').split('\n');
  return lines.map((line, li) => {
    const commentIdx = line.indexOf('#');
    const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
    const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : '';
    const tokens = codePart.split(/([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()[\]{},+\-*/=<>!&|]+)/g);

    return (
      <div key={li} className="leading-snug whitespace-pre-wrap break-all">
        {tokens.map((tok, ti) => {
          if (!tok) return null;
          if (HIGHLIGHT_KEYWORDS.has(tok) || HIGHLIGHT_KEYWORDS.has(tok.toUpperCase())) {
            return (
              <span key={ti} className="text-[#f0b90b] font-semibold">
                {tok}
              </span>
            );
          }
          if (/^\d+(?:\.\d+)?$/.test(tok)) {
            return (
              <span key={ti} className="text-[#ff6b6b]">
                {tok}
              </span>
            );
          }
          if (/^[()[\]{},+\-*/=<>!&|]+$/.test(tok)) {
            return (
              <span key={ti} className="text-[#4da3ff]">
                {tok}
              </span>
            );
          }
          return (
            <span key={ti} className="text-[#dfe6f0]">
              {tok}
            </span>
          );
        })}
        {commentPart && <span className="text-[#647084] italic">{commentPart}</span>}
      </div>
    );
  });
}

function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\])/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="text-[#f0b90b] font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1 py-0.5 mx-0.5 bg-[#090c10] border border-[#252c38] text-[#e5b567] font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('[[') && part.endsWith(']]')) {
      const inner = part.slice(2, -2);
      const label = inner.includes('|') ? inner.split('|')[1] : inner;
      return (
        <span
          key={idx}
          className="inline-flex items-center px-1.5 py-0.5 mx-0.5 bg-[#161b24] border border-[#2c3647] text-[#4da3ff] text-[11px] rounded-[2px]"
        >
          {label}
        </span>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function WindNoteViewer({ content }: { content: string }) {
  const lines = (content || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line || line === '<!-- AUTO-MOC:START -->' || line === '<!-- AUTO-MOC:END -->') {
      i++;
      continue;
    }

    if (i === 0 && line === '---') {
      i++;
      const meta: string[] = [];
      while (i < lines.length && lines[i].trim() !== '---') {
        if (lines[i].trim()) meta.push(lines[i].trim());
        i++;
      }
      i++;
      if (meta.length > 0) {
        blocks.push(
          <div
            key={`fm-${i}`}
            className="flex flex-wrap gap-1.5 p-2 bg-[#11151d] border border-[#232a36] text-[11px] font-mono text-[#8b95a5]"
          >
            {meta.map((m, mi) => (
              <span key={mi} className="px-1.5 py-0.5 bg-[#090c10] border border-[#232a36] text-[#e5b567]">
                {m}
              </span>
            ))}
          </div>
        );
      }
      continue;
    }

    if (line === '---') {
      blocks.push(<hr key={`hr-${i}`} className="border-[#232a36] my-1.5" />);
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <pre
          key={`code-${i}`}
          className="p-2.5 bg-[#090c10] border border-[#232a36] text-[11px] font-mono text-[#dfe6f0] overflow-x-auto"
        >
          {codeLines.join('\n')}
        </pre>
      );
      continue;
    }

    if (
      line.startsWith('|') &&
      i + 1 < lines.length &&
      lines[i + 1].trim().startsWith('|') &&
      lines[i + 1].includes('-')
    ) {
      const headers = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(
          lines[i]
            .trim()
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim())
        );
        i++;
      }
      blocks.push(
        <div key={`tbl-${i}`} className="overflow-x-auto border border-[#232a36] bg-[#0e1117]">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="h-[26px] bg-[#151a23] text-[#8b95a5] border-b border-[#252c38]">
                {headers.map((h, hi) => (
                  <th key={hi} className="px-2.5 text-left font-medium whitespace-nowrap">
                    {renderInlineMarkdown(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434]">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2.5 text-[#dfe6f0] tabular-nums">
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const first = quoteLines[0] || '';
      const isWarn = first.includes('[!warning]') || first.includes('[!caution]') || first.includes('错题');
      const isSuccess = first.includes('[!success]') || first.includes('心跳');
      const cleaned = quoteLines.map((ql) =>
        ql.replace(/^\[!(success|warning|caution|info|note|tip)\]\s*/i, '')
      );
      blocks.push(
        <div
          key={`qt-${i}`}
          className={`px-2.5 py-2 border border-[#232a36] border-l-2 text-xs space-y-1 bg-[#11151d] ${
            isWarn ? 'border-l-[#ff3535]' : isSuccess ? 'border-l-[#00c853]' : 'border-l-[#ff8800]'
          }`}
        >
          {cleaned.map((ql, qi) => (
            <div key={qi} className="text-[#dfe6f0] leading-snug">
              {renderInlineMarkdown(ql)}
            </div>
          ))}
        </div>
      );
      continue;
    }

    if (line.startsWith('### ')) {
      blocks.push(
        <h4 key={`h3-${i}`} className="text-xs font-bold text-[#4da3ff] pt-2 flex items-center gap-1.5">
          <span className="w-[2px] h-3 bg-[#4da3ff] inline-block" />
          {renderInlineMarkdown(line.slice(4))}
        </h4>
      );
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push(
        <h3
          key={`h2-${i}`}
          className="text-xs font-bold text-[#ff9500] pt-2 pb-1 border-b border-[#232a36] flex items-center gap-1.5"
        >
          <span className="w-[2px] h-3 bg-[#ff8800] inline-block" />
          {renderInlineMarkdown(line.slice(3))}
        </h3>
      );
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      blocks.push(
        <h2 key={`h1-${i}`} className="text-sm font-bold text-[#e8edf5] tracking-tight">
          {renderInlineMarkdown(line.slice(2))}
        </h2>
      );
      i++;
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="space-y-1 pl-1">
          {items.map((item, ii) => (
            <li key={ii} className="flex items-start gap-2 text-xs text-[#cfd8e3] leading-snug">
              <span className="mt-1.5 w-1 h-1 bg-[#ff8800] shrink-0" />
              <span>{renderInlineMarkdown(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    blocks.push(
      <p key={`p-${i}`} className="text-xs text-[#cfd8e3] leading-snug">
        {renderInlineMarkdown(line)}
      </p>
    );
    i++;
  }

  return <div className="space-y-2">{blocks}</div>;
}

function PaneHeader({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-[2px] h-3 bg-[#ff8800] shrink-0" />
        <span className="text-[12px] font-bold text-[#dfe6f0] truncate">{title}</span>
        {children}
      </div>
      {right && <div className="flex items-center gap-2 text-[11px] text-[#7d8796] shrink-0">{right}</div>}
    </div>
  );
}

export default function PandaPmCommandPage({ onSelectStock, onNavigate }: PandaPmCommandPageProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('pm-correlation');

  // Overview state
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // [01] PM Radar x 28 Futures Matrix + K-line
  const [pmCategoryFilter, setPmCategoryFilter] = useState<string>('全部');
  const [selectedPmEventId, setSelectedPmEventId] = useState<string>('');
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('全部');
  const [futuresSearch, setFuturesSearch] = useState('');
  const [futuresSort, setFuturesSort] = useState<'changePct' | 'price' | 'openInterest' | 'volume'>('changePct');
  const [futuresSortAsc, setFuturesSortAsc] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('AU0');
  const [klineData, setKlineData] = useState<FuturesKlineResponse | null>(null);
  const [klineLoading, setKlineLoading] = useState(false);
  const [klineError, setKlineError] = useState<string | null>(null);
  const futuresChartRef = useRef<HTMLDivElement>(null);

  // [02] V4 PM x Asset Correlation Discovery & Joint Event-Driven Backtest
  const [corrEventId, setCorrEventId] = useState<string>('');
  const [corrCustomQuery, setCorrCustomQuery] = useState<string>('');
  const [corrUniverse, setCorrUniverse] = useState<PmAssetUniverse>('all');
  const [corrLookbackDays, setCorrLookbackDays] = useState<number>(120);
  const [corrShockThresholdPp, setCorrShockThresholdPp] = useState<number>(2.5);
  const [relationMatrix, setRelationMatrix] = useState<PmRelationMatrixResponse | null>(null);
  const [relationLoading, setRelationLoading] = useState(false);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [relationSortCol, setRelationSortCol] = useState<
    'compositeScore' | 'shockHitRate' | 'optimalLagDays' | 'divergenceZScore'
  >('compositeScore');
  const [relationSortAsc, setRelationSortAsc] = useState(false);
  const [selectedRelKey, setSelectedRelKey] = useState<{ eventId: string; assetSymbol: string } | null>(null);

  // [02] Event-Driven Joint Backtest Params & State
  const [ebSignalMode, setEbSignalMode] = useState<PmEventSignalMode>('shock_breakout');
  const [ebShockThreshold, setEbShockThreshold] = useState<number>(2.5);
  const [ebDivZEntry, setEbDivZEntry] = useState<number>(1.35);
  const [ebHoldingDays, setEbHoldingDays] = useState<number>(5);
  const [ebHedgeSymbol, setEbHedgeSymbol] = useState<string>('');
  const [ebLeverage, setEbLeverage] = useState<number>(3);
  const [ebStopLossPct, setEbStopLossPct] = useState<number>(6);
  const [ebUseKelly, setEbUseKelly] = useState<boolean>(true);
  const [ebResult, setEbResult] = useState<PmEventBacktestResponse | null>(null);
  const [ebLoading, setEbLoading] = useState(false);
  const [ebError, setEbError] = useState<string | null>(null);
  const ebDualChartRef = useRef<HTMLDivElement>(null);
  const ebLeadLagChartRef = useRef<HTMLDivElement>(null);
  const ebEquityChartRef = useRef<HTMLDivElement>(null);
  const ebAutoRanKey = useRef<string>('');

  // [03] PandaAI Factor Vault & Live Scanner
  const [poolFilter, setPoolFilter] = useState<PoolFilter>('全部');
  const [factorSearch, setFactorSearch] = useState('');
  const [factorSort, setFactorSort] = useState<'sharpe' | 'rankIc' | 'ir' | 'turnover'>('sharpe');
  const [factorSortAsc, setFactorSortAsc] = useState(false);
  const [selectedFactorId, setSelectedFactorId] = useState<string>('');
  const [scanUniverse, setScanUniverse] = useState<ScanUniverse>('ashare');
  const [scanTopN, setScanTopN] = useState<number>(20);
  const [scanResult, setScanResult] = useState<FactorScanResponse | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [copiedExpr, setCopiedExpr] = useState(false);
  const factorChartRef = useRef<HTMLDivElement>(null);

  // [04] Futures T+0 Bidirectional Leveraged Backtest Lab
  const [btSymbol, setBtSymbol] = useState<string>('AU0');
  const [btStrategy, setBtStrategy] = useState<string>('pm_macro_trend');
  const [btDays, setBtDays] = useState<number>(250);
  const [btCapital, setBtCapital] = useState<number>(1000000);
  const [btLeverage, setBtLeverage] = useState<number>(3);
  const [btStopLoss, setBtStopLoss] = useState<number>(5);
  const [btResult, setBtResult] = useState<FuturesBacktestResponse | null>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);
  const btHasAutoRun = useRef(false);
  const btChartRef = useRef<HTMLDivElement>(null);

  // [05] 24h Autonomy & Account 5091 Review Hub
  const [logFolderFilter, setLogFolderFilter] = useState<string>('全部');
  const [logSearch, setLogSearch] = useState('');
  const [selectedLogId, setSelectedLogId] = useState<string>('');

  // V6 Paper Trading Dispatch State
  const [paperOrderBusyKey, setPaperOrderBusyKey] = useState<string>('');
  const [paperOrderToast, setPaperOrderToast] = useState<{ ok: boolean; text: string } | null>(null);

  const sendToPaperDesk = async (params: {
    key: string;
    symbol: string;
    name?: string;
    market: 'ashare' | 'futures';
    directionSign: number;
    price?: number;
    strategyTag: string;
    note?: string;
  }) => {
    const cleanSymbol = String(params.symbol || '').trim();
    if (!cleanSymbol) return;
    setPaperOrderBusyKey(params.key);
    setPaperOrderToast(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const token = window.localStorage.getItem('tsp_saas_token');
        const tenant = window.localStorage.getItem('tsp_tenant_user');
        if (token) headers.Authorization = `Bearer ${token}`;
        if (tenant) headers['X-TSP-Tenant-User'] = tenant;
      } catch {
        // ignore storage access issues
      }

      const isFutures = params.market === 'futures';
      const action = isFutures ? (params.directionSign < 0 ? 'open_short' : 'buy_long') : 'buy_long';
      const leverage = isFutures ? 3 : 1;
      const capitalAllocationPct = 10;

      const res = await fetch('/api/paper/order', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          symbol: cleanSymbol,
          name: params.name,
          market: params.market,
          action,
          capitalAllocationPct,
          price: params.price && params.price > 0 ? params.price : undefined,
          leverage,
          strategyTag: params.strategyTag,
          note: params.note,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || `HTTP ${res.status}`);
      }
      const portfolioName = payload?.activePortfolio?.name || '默认模拟账户';
      const dirLabel = action === 'open_short' ? '开空' : '做多';
      setPaperOrderToast({
        ok: true,
        text: `已转入模拟实盘舱 [${portfolioName}]: ${cleanSymbol} ${params.name || ''} | ${dirLabel} ${leverage}x | 仓位 ${capitalAllocationPct}% (${params.strategyTag})`,
      });
    } catch (err) {
      setPaperOrderToast({
        ok: false,
        text: `转入模拟实盘舱失败 (${cleanSymbol}): ${err instanceof Error ? err.message : '请求异常'}`,
      });
    } finally {
      setPaperOrderBusyKey('');
    }
  };

  // Load overview
  const loadOverview = useCallback(async (silent = false) => {
    if (silent !== true) {
      setOverviewLoading(true);
      setOverviewError(null);
    }
    try {
      const res = await fetch('/api/panda-pm/overview');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: OverviewPayload = await res.json();
      setOverview(json);
      if (json?.factors?.length) {
        setSelectedFactorId((prev) => prev || json.factors![0].id);
      }
      if (json?.pmEvents?.length) {
        setSelectedPmEventId((prev) => prev || json.pmEvents![0].id);
      }
      if (json?.futuresQuotes?.length) {
        let focusFut = '';
        try {
          const pending = window.localStorage.getItem('tsp_focus_symbol');
          if (pending && json.futuresQuotes!.some((q) => q.symbol === pending)) {
            focusFut = pending;
            window.localStorage.removeItem('tsp_focus_symbol');
          }
        } catch {
          // ignore
        }
        setSelectedSymbol((prev) => {
          if (focusFut) return focusFut;
          const exists = json.futuresQuotes!.some((q) => q.symbol === prev);
          return exists ? prev : json.futuresQuotes![0].symbol;
        });
        setBtSymbol((prev) => {
          if (focusFut) return focusFut;
          const exists = json.futuresQuotes!.some((q) => q.symbol === prev);
          return exists ? prev : json.futuresQuotes![0].symbol;
        });
      }
      if (json?.autonomyLogs?.length) {
        setSelectedLogId((prev) => prev || json.autonomyLogs![0].id);
      }
    } catch (e: any) {
      if (silent !== true) {
        setOverviewError(e?.message || '无法加载 PandaAI x Polymarket 跨市总览数据');
      }
    } finally {
      if (silent !== true) {
        setOverviewLoading(false);
      }
    }
  }, []);

  // Load initial relation matrix
  const loadRelationMatrix = useCallback(async (univ: PmAssetUniverse = 'all') => {
    setRelationLoading(true);
    setRelationError(null);
    try {
      const res = await fetch(`/api/panda-pm/relation-matrix?universe=${encodeURIComponent(univ)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: PmRelationMatrixResponse = await res.json();
      setRelationMatrix(json);
      if (json?.relations?.length) {
        const first = json.relations[0];
        setSelectedRelKey((prev) => prev || { eventId: first.eventId, assetSymbol: first.assetSymbol });
        setEbHedgeSymbol((prev) => prev || first.hedgeLegSymbol || '');
      }
    } catch (e: any) {
      setRelationError(e?.message || '无法加载 PM 关联挖掘矩阵');
    } finally {
      setRelationLoading(false);
    }
  }, []);

  const discoverRelations = useCallback(
    async (overrides?: {
      eventId?: string;
      customQuery?: string;
      universe?: PmAssetUniverse;
      lookbackDays?: number;
      shockThresholdPp?: number;
    }) => {
      setRelationLoading(true);
      setRelationError(null);
      try {
        const evId = overrides?.eventId !== undefined ? overrides.eventId : corrEventId;
        const q = overrides?.customQuery !== undefined ? overrides.customQuery : corrCustomQuery;
        const univ = overrides?.universe ?? corrUniverse;
        const lb = overrides?.lookbackDays ?? corrLookbackDays;
        const st = overrides?.shockThresholdPp ?? corrShockThresholdPp;

        const res = await fetch('/api/panda-pm/discover-relations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: evId || undefined,
            customQuery: q.trim() || undefined,
            universe: univ,
            lookbackDays: lb,
            shockThresholdPp: st,
            topN: 30,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: PmRelationMatrixResponse = await res.json();
        setRelationMatrix(json);
        if (json?.relations?.length) {
          const first = json.relations[0];
          setSelectedRelKey({ eventId: first.eventId, assetSymbol: first.assetSymbol });
          setEbHedgeSymbol(first.hedgeLegSymbol || '');
        }
      } catch (e: any) {
        setRelationError(e?.message || '扫描 PM 关联矩阵失败');
      } finally {
        setRelationLoading(false);
      }
    },
    [corrEventId, corrCustomQuery, corrUniverse, corrLookbackDays, corrShockThresholdPp]
  );

  useEffect(() => {
    loadOverview();
    loadRelationMatrix('all');
  }, [loadOverview, loadRelationMatrix]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) {
        void loadOverview(true);
      }
    }, 45_000);
    return () => clearInterval(timer);
  }, [loadOverview]);

  const factors = useMemo(() => overview?.factors ?? [], [overview]);
  const pmEvents = useMemo(() => overview?.pmEvents ?? [], [overview]);
  const futuresQuotes = useMemo(() => overview?.futuresQuotes ?? [], [overview]);
  const arbitrageStrategies = useMemo(() => overview?.arbitrageStrategies ?? [], [overview]);
  const autonomyLogs = useMemo(() => overview?.autonomyLogs ?? [], [overview]);

  // Derived sorted relations for [02]
  const sortedRelations = useMemo(() => {
    const list = [...(relationMatrix?.relations ?? [])];
    list.sort((a, b) => {
      const av =
        relationSortCol === 'divergenceZScore'
          ? Math.abs(safeNum(a.divergenceZScore, 0))
          : safeNum((a as any)[relationSortCol], -999);
      const bv =
        relationSortCol === 'divergenceZScore'
          ? Math.abs(safeNum(b.divergenceZScore, 0))
          : safeNum((b as any)[relationSortCol], -999);
      return relationSortAsc ? av - bv : bv - av;
    });
    return list;
  }, [relationMatrix?.relations, relationSortCol, relationSortAsc]);

  const selectedRelation = useMemo(() => {
    if (!sortedRelations.length) return null;
    if (selectedRelKey) {
      const hit = sortedRelations.find(
        (r) => r.eventId === selectedRelKey.eventId && r.assetSymbol === selectedRelKey.assetSymbol
      );
      if (hit) return hit;
    }
    return sortedRelations[0];
  }, [sortedRelations, selectedRelKey]);

  const selectedIsAShare = useMemo(
    () => isAShareLikeSymbol(selectedRelation?.assetSymbol, selectedRelation?.assetMarket),
    [selectedRelation?.assetSymbol, selectedRelation?.assetMarket]
  );

  // Matrix rows/cols for [02] heatmap table
  const matrixPivot = useMemo(() => {
    const cells = relationMatrix?.matrixCells ?? [];
    const eventMap = new Map<string, string>();
    const assetMap = new Map<string, string>();
    const cellLookup = new Map<string, PmMatrixCell>();
    cells.forEach((c) => {
      eventMap.set(c.eventId, c.eventShortTitle || c.eventId);
      assetMap.set(c.assetSymbol, c.assetName || c.assetSymbol);
      cellLookup.set(`${c.eventId}::${c.assetSymbol}`, c);
    });
    return {
      events: Array.from(eventMap.entries()),
      assets: Array.from(assetMap.entries()).slice(0, 10),
      cellLookup,
    };
  }, [relationMatrix?.matrixCells]);

  const toggleRelationSort = (col: 'compositeScore' | 'shockHitRate' | 'optimalLagDays' | 'divergenceZScore') => {
    if (relationSortCol === col) {
      setRelationSortAsc((p) => !p);
    } else {
      setRelationSortCol(col);
      setRelationSortAsc(false);
    }
  };

  // Run PM Event-Driven Joint Backtest
  const runEventBacktest = useCallback(
    async (overrideEventId?: string, overrideSymbol?: string, overrideHedge?: string) => {
      const evId = overrideEventId || selectedRelation?.eventId || corrEventId;
      const sym = overrideSymbol || selectedRelation?.assetSymbol;
      if (!evId || !sym) return;
      const isA = isAShareLikeSymbol(sym, selectedRelation?.assetMarket);

      setEbLoading(true);
      setEbError(null);
      try {
        const res = await fetch('/api/panda-pm/event-backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: evId,
            assetSymbol: sym,
            hedgeSymbol: (overrideHedge !== undefined ? overrideHedge : ebHedgeSymbol).trim() || undefined,
            signalMode: ebSignalMode,
            days: corrLookbackDays,
            shockThresholdPp: ebShockThreshold,
            divergenceZEntry: ebDivZEntry,
            holdingHorizonDays: ebHoldingDays,
            lagExecutionDays: Math.max(0, selectedRelation?.optimalLagDays ?? 0),
            initialCapital: 1000000,
            leverage: isA ? 1 : ebLeverage,
            stopLossPct: ebStopLossPct,
            useKellySizing: ebUseKelly,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: PmEventBacktestResponse = await res.json();
        setEbResult(json);
      } catch (e: any) {
        setEbError(e?.message || 'PM事件联立回测失败');
      } finally {
        setEbLoading(false);
      }
    },
    [
      selectedRelation,
      corrEventId,
      ebHedgeSymbol,
      ebSignalMode,
      corrLookbackDays,
      ebShockThreshold,
      ebDivZEntry,
      ebHoldingDays,
      ebLeverage,
      ebStopLossPct,
      ebUseKelly,
    ]
  );

  // Auto-run event backtest whenever selected relation changes in tab [02]
  useEffect(() => {
    if (activeTab !== 'pm-correlation' || !selectedRelation) return;
    const key = `${selectedRelation.eventId}::${selectedRelation.assetSymbol}`;
    if (ebAutoRanKey.current !== key) {
      ebAutoRanKey.current = key;
      setEbHedgeSymbol(selectedRelation.hedgeLegSymbol || '');
      runEventBacktest(selectedRelation.eventId, selectedRelation.assetSymbol, selectedRelation.hedgeLegSymbol || '');
    }
  }, [activeTab, selectedRelation, runEventBacktest]);

  // ECharts [02-A]: Dual-Axis Historical Fit & Divergence Z-Score
  useEffect(() => {
    if (activeTab !== 'pm-correlation' || !ebDualChartRef.current) return;
    const series = ebResult?.alignedSeries ?? [];
    if (!series.length) return;

    const dom = ebDualChartRef.current;
    const chart = echarts.init(dom);
    const dates = series.map((p) => p.date);
    const probs = series.map((p) => safeNum(p.yesProb));
    const closes = series.map((p) => safeNum(p.assetClose));
    const implied = series.map((p) => safeNum(p.impliedAssetPrice));
    const divZ = series.map((p) => safeNum(p.divergenceZ));

    const closeByDate = new Map(series.map((p) => [p.date, safeNum(p.assetClose)]));
    const buyMarkers: Array<{ value: [string, number]; side: string; reason: string }> = [];
    const sellMarkers: Array<{ value: [string, number]; side: string; reason: string }> = [];
    (ebResult?.trades ?? []).forEach((tr) => {
      const pEntry = closeByDate.get(tr.entryDate) ?? tr.entryPrice;
      const pExit = closeByDate.get(tr.exitDate) ?? tr.exitPrice;
      if (tr.entryDate) buyMarkers.push({ value: [tr.entryDate, pEntry], side: tr.side, reason: tr.reason });
      if (tr.exitDate) sellMarkers.push({ value: [tr.exitDate, pExit], side: '平仓', reason: tr.reason });
    });

    chart.setOption({
      backgroundColor: '#0d1015',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#8b95a5', width: 1 } },
        backgroundColor: '#131822',
        borderColor: '#2c3647',
        borderWidth: 1,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'ui-monospace, monospace' },
      },
      legend: {
        top: 2,
        left: 8,
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { color: '#8b95a5', fontSize: 10 },
        data: ['PM隐含概率(%)', '标的收盘价', 'PM协整隐含价', '预期差Z'],
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 44, right: 50, top: 26, height: '50%' },
        { left: 44, right: 50, top: '67%', height: '23%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { color: '#7d8796', fontSize: 9 },
        },
      ],
      yAxis: [
        {
          type: 'value',
          name: 'PM%',
          nameTextStyle: { color: '#ff8800', fontSize: 9 },
          scale: true,
          splitLine: { show: false },
          axisLabel: { color: '#ff8800', fontSize: 9, fontFamily: 'ui-monospace, monospace' },
        },
        {
          type: 'value',
          name: '价格',
          position: 'right',
          nameTextStyle: { color: '#dfe6f0', fontSize: 9 },
          scale: true,
          splitLine: { lineStyle: { color: '#191f2a', type: 'dashed' } },
          axisLabel: { color: '#dfe6f0', fontSize: 9, fontFamily: 'ui-monospace, monospace' },
        },
        {
          type: 'value',
          gridIndex: 1,
          splitNumber: 2,
          splitLine: { lineStyle: { color: '#191f2a', type: 'dashed' } },
          axisLabel: { color: '#8b95a5', fontSize: 9, fontFamily: 'ui-monospace, monospace' },
        },
      ],
      series: [
        {
          name: 'PM隐含概率(%)',
          type: 'line',
          yAxisIndex: 0,
          data: probs,
          showSymbol: false,
          lineStyle: { width: 1.6, color: '#ff8800' },
        },
        {
          name: '标的收盘价',
          type: 'line',
          yAxisIndex: 1,
          data: closes,
          showSymbol: false,
          lineStyle: { width: 1.5, color: '#ffffff' },
        },
        {
          name: 'PM协整隐含价',
          type: 'line',
          yAxisIndex: 1,
          data: implied,
          showSymbol: false,
          lineStyle: { width: 1.2, color: '#f0b90b', type: 'dashed' },
        },
        {
          name: '开仓',
          type: 'scatter',
          yAxisIndex: 1,
          symbol: 'triangle',
          symbolSize: 8,
          itemStyle: { color: '#ff3535' },
          data: buyMarkers.map((m) => m.value),
        },
        {
          name: '平仓',
          type: 'scatter',
          yAxisIndex: 1,
          symbol: 'triangle',
          symbolRotate: 180,
          symbolSize: 7,
          itemStyle: { color: '#00c853' },
          data: sellMarkers.map((m) => m.value),
        },
        {
          name: '预期差Z',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 2,
          barMaxWidth: 8,
          data: divZ.map((v) => ({
            value: v,
            itemStyle: { color: v >= 0 ? '#ff3535' : '#00c853' },
          })),
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'dashed', width: 1, color: '#f0b90b' },
            data: [{ yAxis: 1.35 }, { yAxis: -1.35 }],
          },
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, ebResult]);

  // ECharts [02-B]: Lead-Lag Cross-Correlation Spectrum (-5d..+5d)
  useEffect(() => {
    if (activeTab !== 'pm-correlation' || !ebLeadLagChartRef.current) return;
    const profile = ebResult?.leadLagProfile?.length
      ? ebResult.leadLagProfile
      : selectedRelation?.leadLagProfile ?? [];
    if (!profile.length) return;

    const dom = ebLeadLagChartRef.current;
    const chart = echarts.init(dom);
    const lags = profile.map((p) => (p.lag > 0 ? `+${p.lag}d` : `${p.lag}d`));

    chart.setOption({
      backgroundColor: '#0d1015',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#131822',
        borderColor: '#2c3647',
        borderWidth: 1,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'ui-monospace, monospace' },
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params;
          const pt = profile[item?.dataIndex ?? 0];
          if (!pt) return '';
          return `
            <div>
              <div style="color:#ff9500;font-weight:700">Lag ${pt.lag > 0 ? `+${pt.lag}` : pt.lag} 日</div>
              <div>Pearson Corr: ${fmtNum(pt.corr, 3)}</div>
              <div>Spearman Corr: ${fmtNum(pt.rankCorr, 3)}</div>
              <div>t-Stat: ${fmtNum(pt.tStat, 2)} (n=${pt.sampleSize})</div>
              <div style="color:#8b95a5;font-size:10px">${pt.lag > 0 ? 'PM概率领先标的' : pt.lag < 0 ? '标的领先PM' : '同步共振'}</div>
            </div>
          `;
        },
      },
      grid: { left: 36, right: 10, top: 14, bottom: 22 },
      xAxis: {
        type: 'category',
        data: lags,
        axisLine: { lineStyle: { color: '#232a36' } },
        axisLabel: { color: '#8b95a5', fontSize: 9, fontFamily: 'ui-monospace, monospace' },
      },
      yAxis: {
        type: 'value',
        splitNumber: 3,
        splitLine: { lineStyle: { color: '#191f2a', type: 'dashed' } },
        axisLabel: { color: '#8b95a5', fontSize: 9, fontFamily: 'ui-monospace, monospace' },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 14,
          data: profile.map((p) => ({
            value: safeNum(p.corr, 0),
            itemStyle: {
              color: p.lag > 0 ? '#ff8800' : p.lag === 0 ? '#f0b90b' : '#4da3ff',
            },
          })),
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: 0, lineStyle: { color: '#475569' } }],
          },
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, ebResult?.leadLagProfile, selectedRelation?.leadLagProfile]);

  // ECharts [02-C]: Event-Driven Joint Backtest Equity vs Benchmark + Drawdown
  useEffect(() => {
    if (activeTab !== 'pm-correlation' || !ebEquityChartRef.current) return;
    const curve = ebResult?.equityCurve ?? [];
    if (!curve.length) return;

    const dom = ebEquityChartRef.current;
    const chart = echarts.init(dom);

    chart.setOption({
      backgroundColor: '#0d1015',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#8b95a5', width: 1 } },
        backgroundColor: '#131822',
        borderColor: '#2c3647',
        borderWidth: 1,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'ui-monospace, monospace' },
      },
      legend: {
        top: 2,
        left: 8,
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { color: '#8b95a5', fontSize: 10 },
        data: ['事件策略收益%', '标的基准%', '水下回撤%'],
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 44, right: 14, top: 26, height: '53%' },
        { left: 44, right: 14, top: '70%', height: '20%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: curve.map((c) => c.date),
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: curve.map((c) => c.date),
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { color: '#7d8796', fontSize: 9 },
        },
      ],
      yAxis: [
        {
          scale: true,
          splitLine: { lineStyle: { color: '#191f2a', type: 'dashed' } },
          axisLabel: { color: '#8b95a5', fontSize: 9, formatter: (v: number) => `${v}%` },
        },
        {
          gridIndex: 1,
          max: 0,
          splitNumber: 2,
          splitLine: { lineStyle: { color: '#191f2a', type: 'dashed' } },
          axisLabel: { color: '#00c853', fontSize: 9, formatter: (v: number) => `${v}%` },
        },
      ],
      series: [
        {
          name: '事件策略收益%',
          type: 'line',
          data: curve.map((c) => safeNum(c.returnPct)),
          showSymbol: false,
          lineStyle: { width: 1.8, color: '#ff8800' },
        },
        {
          name: '标的基准%',
          type: 'line',
          data: curve.map((c) => safeNum(c.benchmarkPct)),
          showSymbol: false,
          lineStyle: { width: 1.2, color: '#4da3ff', type: 'dashed' },
        },
        {
          name: '水下回撤%',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: curve.map((c) => -Math.abs(safeNum(c.drawdownPct))),
          showSymbol: false,
          lineStyle: { width: 1.1, color: '#00c853' },
          areaStyle: { color: 'rgba(0, 200, 83, 0.2)' },
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, ebResult]);

  // Derived factors for [03]
  const filteredFactors = useMemo(() => {
    const q = factorSearch.trim().toLowerCase();
    return factors
      .filter((f) => matchPoolFilter(f, poolFilter))
      .filter((f) => {
        if (!q) return true;
        return (
          (f.name || '').toLowerCase().includes(q) ||
          (f.description || '').toLowerCase().includes(q) ||
          (f.expression || '').toLowerCase().includes(q) ||
          (f.sourceFile || '').toLowerCase().includes(q) ||
          (f.tags || []).some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const av = safeNum((a as any)[factorSort], -999);
        const bv = safeNum((b as any)[factorSort], -999);
        return factorSortAsc ? av - bv : bv - av;
      });
  }, [factors, poolFilter, factorSearch, factorSort, factorSortAsc]);

  const selectedFactor = useMemo(
    () => factors.find((f) => f.id === selectedFactorId) || filteredFactors[0] || factors[0] || null,
    [factors, filteredFactors, selectedFactorId]
  );

  const toggleFactorSort = (col: 'sharpe' | 'rankIc' | 'ir' | 'turnover') => {
    if (factorSort === col) {
      setFactorSortAsc((p) => !p);
    } else {
      setFactorSort(col);
      setFactorSortAsc(false);
    }
  };

  const runFactorScan = useCallback(
    async (fId?: string, univ?: ScanUniverse, topN?: number) => {
      const targetId = fId || selectedFactor?.id;
      if (!targetId) return;
      setScanLoading(true);
      setScanError(null);
      try {
        const res = await fetch('/api/panda-pm/factor-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            factorId: targetId,
            topN: topN ?? scanTopN,
            universe: univ ?? scanUniverse,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: FactorScanResponse = await res.json();
        setScanResult(json);
      } catch (e: any) {
        setScanError(e?.message || '因子扫描失败');
      } finally {
        setScanLoading(false);
      }
    },
    [selectedFactor?.id, scanTopN, scanUniverse]
  );

  useEffect(() => {
    if (selectedFactor?.id && activeTab === 'factors') {
      runFactorScan(selectedFactor.id, scanUniverse, scanTopN);
    }
  }, [selectedFactor?.id, scanUniverse, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFuturesKlines = useCallback(async (symbol: string) => {
    if (!symbol) return;
    setKlineLoading(true);
    setKlineError(null);
    try {
      const res = await fetch(`/api/panda-pm/futures/${encodeURIComponent(symbol)}/klines`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: FuturesKlineResponse = await res.json();
      setKlineData(json);
    } catch (e: any) {
      setKlineError(e?.message || `加载 ${symbol} 期货K线失败`);
    } finally {
      setKlineLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'pm-futures' && selectedSymbol) {
      loadFuturesKlines(selectedSymbol);
    }
  }, [activeTab, selectedSymbol, loadFuturesKlines]);

  const runFuturesBacktest = useCallback(
    async (overrideSymbol?: string) => {
      const sym = overrideSymbol || btSymbol;
      if (!sym) return;
      setBtLoading(true);
      setBtError(null);
      try {
        const res = await fetch('/api/panda-pm/futures-backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: sym,
            strategyType: btStrategy,
            days: btDays,
            initialCapital: btCapital,
            leverage: btLeverage,
            stopLossPct: btStopLoss,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: FuturesBacktestResponse = await res.json();
        setBtResult(json);
      } catch (e: any) {
        setBtError(e?.message || '期货回测执行失败');
      } finally {
        setBtLoading(false);
      }
    },
    [btSymbol, btStrategy, btDays, btCapital, btLeverage, btStopLoss]
  );

  useEffect(() => {
    if (activeTab === 'futures-bt' && !btHasAutoRun.current && btSymbol) {
      btHasAutoRun.current = true;
      runFuturesBacktest(btSymbol);
    }
  }, [activeTab, btSymbol, runFuturesBacktest]);

  // ECharts [03]: Factor Z-Score Distribution
  useEffect(() => {
    if (activeTab !== 'factors' || !factorChartRef.current || !scanResult?.targets?.length) return;
    const dom = factorChartRef.current;
    const chart = echarts.init(dom);
    const targets = scanResult.targets.slice(0, 20);
    const labels = targets.map((t) => `${t.name}(${t.code})`);
    const zValues = targets.map((t) => safeNum(t.zScore, 0));

    chart.setOption({
      backgroundColor: '#0d1015',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: '#ff8800', width: 1 } },
        backgroundColor: '#131822',
        borderColor: '#2c3647',
        borderWidth: 1,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'ui-monospace, monospace' },
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params;
          const idx = item?.dataIndex ?? 0;
          const t = targets[idx];
          if (!t) return '';
          const chgColor = safeNum(t.changePct) >= 0 ? '#ff3535' : '#00c853';
          return `
            <div style="min-width:180px">
              <div style="font-weight:700;color:#e5b567;margin-bottom:2px">${t.name} [${t.code}]</div>
              <div>Z-Score: <span style="color:${safeNum(t.zScore) >= 0 ? '#ff3535' : '#00c853'};font-weight:700">${fmtNum(t.zScore, 2)}</span></div>
              <div>因子值: ${fmtNum(t.factorValue, 4)}</div>
              <div>涨跌幅: <span style="color:${chgColor}">${fmtPct(t.changePct)}</span></div>
              <div style="color:#8b95a5;margin-top:2px;font-size:10px">${t.reason || t.signal || ''}</div>
            </div>
          `;
        },
      },
      grid: { left: 42, right: 14, top: 16, bottom: 36 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#232a36' } },
        axisTick: { lineStyle: { color: '#232a36' } },
        axisLabel: {
          color: '#8b95a5',
          fontSize: 10,
          rotate: 22,
          formatter: (val: string) => (val.length > 10 ? `${val.slice(0, 9)}..` : val),
        },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#191f2a', type: 'dashed' } },
        axisLabel: { color: '#8b95a5', fontSize: 10, fontFamily: 'ui-monospace, monospace' },
      },
      series: [
        {
          name: 'Z-Score',
          type: 'bar',
          barMaxWidth: 16,
          data: zValues.map((v) => ({
            value: v,
            itemStyle: { color: v >= 0 ? '#ff3535' : '#00c853' },
          })),
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'dashed', width: 1 },
            data: [
              { yAxis: 0, lineStyle: { color: '#475569' } },
              { yAxis: 1.5, lineStyle: { color: '#f0b90b' } },
              { yAxis: -1.5, lineStyle: { color: '#00c853' } },
            ],
          },
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, scanResult]);

  // ECharts [01]: Futures Candlestick + MA(白/黄/紫/绿) + OI
  useEffect(() => {
    if (activeTab !== 'pm-futures' || !futuresChartRef.current || !klineData?.klines?.length) return;
    const dom = futuresChartRef.current;
    const chart = echarts.init(dom);
    const bars = klineData.klines;
    const dates = bars.map((b) => b.date);
    const ohlc = bars.map((b) => [b.open, b.close, b.low, b.high]);
    const vols = bars.map((b) => ({
      value: safeNum(b.volume, 0),
      itemStyle: { color: b.close >= b.open ? '#ff3535' : '#00c853' },
    }));
    const ois = bars.map((b) => safeNum(b.openInterest, 0));

    chart.setOption({
      backgroundColor: '#0d1015',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#8b95a5', width: 1 } },
        backgroundColor: '#131822',
        borderColor: '#2c3647',
        borderWidth: 1,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'ui-monospace, monospace' },
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          const idx = list[0]?.dataIndex ?? 0;
          const b = bars[idx];
          if (!b) return '';
          const up = b.close >= b.open;
          const col = up ? '#ff3535' : '#00c853';
          return `
            <div style="min-width:195px">
              <div style="font-weight:700;color:#e5b567;margin-bottom:2px">${klineData.name || klineData.symbol} ${b.date}</div>
              <div>开:${fmtNum(b.open, 2)} 高:${fmtNum(b.high, 2)}</div>
              <div>低:${fmtNum(b.low, 2)} 收:<span style="color:${col};font-weight:700">${fmtNum(b.close, 2)}</span></div>
              <div>涨跌:<span style="color:${col}">${fmtPct(b.changePct)}</span></div>
              <div>成交:${fmtCompact(b.volume)} 持仓:<span style="color:#f0b90b">${fmtCompact(b.openInterest)}</span></div>
              <div style="color:#8b95a5;font-size:10px;margin-top:2px">
                MA5:${fmtNum(b.ma5, 1)} MA10:${fmtNum(b.ma10, 1)} MA20:${fmtNum(b.ma20, 1)}
              </div>
            </div>
          `;
        },
      },
      legend: {
        top: 4,
        left: 8,
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { color: '#8b95a5', fontSize: 10 },
        data: ['K线', 'MA5', 'MA10', 'MA20', 'MA60', '持仓量'],
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 52, right: 54, top: 26, height: '56%' },
        { left: 52, right: 54, top: '71%', height: '18%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          boundaryGap: true,
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          boundaryGap: true,
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { color: '#7d8796', fontSize: 10 },
        },
      ],
      yAxis: [
        {
          scale: true,
          splitLine: { lineStyle: { color: '#191f2a', type: 'dashed' } },
          axisLabel: { color: '#8b95a5', fontSize: 10, fontFamily: 'ui-monospace, monospace' },
        },
        {
          scale: true,
          gridIndex: 1,
          splitNumber: 2,
          splitLine: { show: false },
          axisLabel: { color: '#7d8796', fontSize: 9, formatter: (v: number) => fmtCompact(v) },
        },
        {
          scale: true,
          gridIndex: 1,
          position: 'right',
          splitNumber: 2,
          splitLine: { show: false },
          axisLabel: { color: '#f0b90b', fontSize: 9, formatter: (v: number) => fmtCompact(v) },
        },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: Math.max(0, 100 - (80 / Math.max(bars.length, 1)) * 100), end: 100 },
        {
          type: 'slider',
          xAxisIndex: [0, 1],
          bottom: 2,
          height: 14,
          borderColor: '#232a36',
          fillerColor: 'rgba(255,136,0,0.18)',
          textStyle: { color: '#7d8796', fontSize: 9 },
        },
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: ohlc,
          itemStyle: {
            color: '#ff3535',
            color0: '#00c853',
            borderColor: '#ff3535',
            borderColor0: '#00c853',
          },
        },
        {
          name: 'MA5',
          type: 'line',
          data: bars.map((b) => b.ma5 ?? null),
          smooth: false,
          showSymbol: false,
          lineStyle: { width: 1.1, color: '#ffffff' },
        },
        {
          name: 'MA10',
          type: 'line',
          data: bars.map((b) => b.ma10 ?? null),
          smooth: false,
          showSymbol: false,
          lineStyle: { width: 1.1, color: '#f0b90b' },
        },
        {
          name: 'MA20',
          type: 'line',
          data: bars.map((b) => b.ma20 ?? null),
          smooth: false,
          showSymbol: false,
          lineStyle: { width: 1.1, color: '#e879f9' },
        },
        {
          name: 'MA60',
          type: 'line',
          data: bars.map((b) => b.ma60 ?? null),
          smooth: false,
          showSymbol: false,
          lineStyle: { width: 1.1, color: '#00e676' },
        },
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: vols,
        },
        {
          name: '持仓量',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 2,
          data: ois,
          showSymbol: false,
          lineStyle: { width: 1.2, color: '#f0b90b' },
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, klineData]);

  // ECharts [04]: Futures T+0 Equity Curve + Drawdown
  useEffect(() => {
    if (activeTab !== 'futures-bt' || !btChartRef.current || !btResult?.equityCurve?.length) return;
    const dom = btChartRef.current;
    const chart = echarts.init(dom);
    const curve = btResult.equityCurve;
    const dates = curve.map((c) => c.date);
    const equities = curve.map((c) => safeNum(c.equity));
    const benchmarks = curve.map((c) => safeNum(c.benchmark, equities[0] || btCapital));

    let peak = equities[0] || 1;
    const drawdowns = equities.map((eq) => {
      if (eq > peak) peak = eq;
      return peak > 0 ? Number((((eq - peak) / peak) * 100).toFixed(2)) : 0;
    });

    chart.setOption({
      backgroundColor: '#0d1015',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#8b95a5', width: 1 } },
        backgroundColor: '#131822',
        borderColor: '#2c3647',
        borderWidth: 1,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'ui-monospace, monospace' },
      },
      legend: {
        top: 4,
        left: 10,
        textStyle: { color: '#8b95a5', fontSize: 10 },
        data: ['策略净值(杠杆)', '标的基准', '动态回撤%'],
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 64, right: 18, top: 28, height: '57%' },
        { left: 64, right: 18, top: '74%', height: '18%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { color: '#7d8796', fontSize: 10 },
        },
      ],
      yAxis: [
        {
          scale: true,
          splitLine: { lineStyle: { color: '#191f2a', type: 'dashed' } },
          axisLabel: {
            color: '#8b95a5',
            fontSize: 10,
            fontFamily: 'ui-monospace, monospace',
            formatter: (v: number) => fmtCompact(v),
          },
        },
        {
          gridIndex: 1,
          max: 0,
          splitNumber: 2,
          splitLine: { lineStyle: { color: '#191f2a', type: 'dashed' } },
          axisLabel: { color: '#00c853', fontSize: 10, formatter: (v: number) => `${v}%` },
        },
      ],
      series: [
        {
          name: '策略净值(杠杆)',
          type: 'line',
          data: equities,
          smooth: false,
          showSymbol: false,
          lineStyle: { width: 1.8, color: '#ff8800' },
        },
        {
          name: '标的基准',
          type: 'line',
          data: benchmarks,
          smooth: false,
          showSymbol: false,
          lineStyle: { width: 1.2, color: '#4da3ff', type: 'dashed' },
        },
        {
          name: '动态回撤%',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: drawdowns,
          showSymbol: false,
          lineStyle: { width: 1.1, color: '#00c853' },
          areaStyle: { color: 'rgba(0, 200, 83, 0.2)' },
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, btResult, btCapital]);

  const pmCategories = useMemo(() => {
    const cats = new Set<string>(['全部']);
    pmEvents.forEach((e) => {
      if (e.category) cats.add(e.category);
    });
    return Array.from(cats);
  }, [pmEvents]);

  const filteredPmEvents = useMemo(() => {
    if (pmCategoryFilter === '全部') return pmEvents;
    return pmEvents.filter((e) => e.category === pmCategoryFilter);
  }, [pmEvents, pmCategoryFilter]);

  const selectedPmEvent = useMemo(
    () => pmEvents.find((e) => e.id === selectedPmEventId) || filteredPmEvents[0] || pmEvents[0] || null,
    [pmEvents, filteredPmEvents, selectedPmEventId]
  );

  const filteredFutures = useMemo(() => {
    const q = futuresSearch.trim().toLowerCase();
    return futuresQuotes
      .filter((item) => matchExchangeFilter(item, exchangeFilter))
      .filter((item) => {
        if (!q) return true;
        return (
          (item.symbol || '').toLowerCase().includes(q) ||
          (item.name || '').toLowerCase().includes(q) ||
          (item.pmSignal || '').toLowerCase().includes(q) ||
          (item.linkedEventTitle || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const av = safeNum((a as any)[futuresSort], -999999);
        const bv = safeNum((b as any)[futuresSort], -999999);
        return futuresSortAsc ? av - bv : bv - av;
      });
  }, [futuresQuotes, exchangeFilter, futuresSearch, futuresSort, futuresSortAsc]);

  const toggleFuturesSort = (col: 'changePct' | 'price' | 'openInterest' | 'volume') => {
    if (futuresSort === col) {
      setFuturesSortAsc((p) => !p);
    } else {
      setFuturesSort(col);
      setFuturesSortAsc(false);
    }
  };

  const selectedFuturesQuote = useMemo(
    () => futuresQuotes.find((f) => f.symbol === selectedSymbol) || futuresQuotes[0] || null,
    [futuresQuotes, selectedSymbol]
  );

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return autonomyLogs
      .filter((l) => matchLogFolder(l, logFolderFilter))
      .filter((l) => {
        if (!q) return true;
        return (
          (l.title || '').toLowerCase().includes(q) ||
          (l.summary || '').toLowerCase().includes(q) ||
          (l.content || '').toLowerCase().includes(q)
        );
      });
  }, [autonomyLogs, logFolderFilter, logSearch]);

  const selectedLog = useMemo(
    () => autonomyLogs.find((l) => l.id === selectedLogId) || filteredLogs[0] || autonomyLogs[0] || null,
    [autonomyLogs, filteredLogs, selectedLogId]
  );

  const handleJumpToFutures = useCallback(
    (rawSymbol: string, goBacktest = false) => {
      const cleaned = (rawSymbol || '').split('.')[0].toUpperCase();
      const match =
        futuresQuotes.find((q) => q.symbol.toUpperCase() === cleaned || q.code?.toUpperCase() === cleaned) ||
        futuresQuotes.find((q) => cleaned.startsWith(q.symbol.replace(/0$/, '').toUpperCase()));
      const sym = match?.symbol || cleaned || 'AU0';
      if (goBacktest) {
        setBtSymbol(sym);
        setActiveTab('futures-bt');
        runFuturesBacktest(sym);
      } else {
        setSelectedSymbol(sym);
        setActiveTab('pm-futures');
      }
    },
    [futuresQuotes, runFuturesBacktest]
  );

  const handleImpactAssetClick = useCallback(
    (asset: ImpactAsset) => {
      const mkt = (asset.market || '').toLowerCase();
      const sym = (asset.symbol || '').trim();
      if (/^\d{6}$/.test(sym) || mkt.includes('a股') || mkt.includes('ashare') || mkt === 'sh' || mkt === 'sz') {
        onSelectStock(sym, asset.name);
        return;
      }
      handleJumpToFutures(sym, false);
    },
    [onSelectStock, handleJumpToFutures]
  );

  const handleJumpToCorrelation = useCallback(
    (eventId: string) => {
      setCorrEventId(eventId);
      setActiveTab('pm-correlation');
      discoverRelations({ eventId });
    },
    [discoverRelations]
  );

  const handleCopyExpr = useCallback(() => {
    if (!selectedFactor?.expression) return;
    navigator.clipboard?.writeText(selectedFactor.expression).catch(() => {});
    setCopiedExpr(true);
    setTimeout(() => setCopiedExpr(false), 1500);
  }, [selectedFactor?.expression]);

  const summary = overview?.summary;
  const eventPickerList = relationMatrix?.events?.length ? relationMatrix.events : pmEvents;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[#0b0e13] text-[#dfe6f0]">
      {/* ==================== TOP 28px WIND WORKSPACE RIBBON & SUMMARY TICKER ==================== */}
      <div className="h-[28px] bg-[#161b24] border-b border-[#232a36] flex items-center justify-between px-2 shrink-0 gap-2">
        <div className="flex items-center h-full overflow-x-auto">
          {[
            { id: 'pm-futures' as WorkspaceTab, label: '[01] PM事件雷达与28期货映射' },
            { id: 'pm-correlation' as WorkspaceTab, label: '[02] PM×标的关联挖掘与联立回测' },
            { id: 'factors' as WorkspaceTab, label: '[03] PandaAI本地因子库与截面扫描' },
            { id: 'futures-bt' as WorkspaceTab, label: '[04] 期货量化回测与跨期套利' },
            { id: 'autonomy' as WorkspaceTab, label: '[05] 5091自治实盘复盘日志' },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`h-full px-2.5 text-[12px] whitespace-nowrap border-r border-[#232a36] transition-colors ${
                  active
                    ? 'bg-[#0e1117] text-[#ff9500] font-bold border-t-2 border-t-[#ff8800]'
                    : 'bg-transparent text-[#8b95a5] hover:text-[#dfe6f0] hover:bg-[#1b222d] border-t-2 border-t-transparent'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums shrink-0">
          <span className="hidden xl:inline text-[#8b95a5]">
            本地因子:<strong className="text-[#f0b90b] ml-0.5">{summary?.totalMinedFactors ?? factors.length}</strong>
            <span className="mx-1.5 text-[#2b3444]">|</span>
            主力期货:<strong className="text-[#e5b567] ml-0.5">{summary?.futuresContractsCount ?? futuresQuotes.length}</strong>
            <span className="mx-1.5 text-[#2b3444]">|</span>
            PM事件:<strong className="text-[#ff9500] ml-0.5">{summary?.pmEventsCount ?? pmEvents.length}</strong>
            <span className="mx-1.5 text-[#2b3444]">|</span>
            关联对:<strong className="text-[#4da3ff] ml-0.5">{relationMatrix?.relations?.length ?? 0}</strong>
            <span className="mx-1.5 text-[#2b3444]">|</span>
            5091笔记:<strong className="text-[#00c853] ml-0.5">{summary?.account5091NotesCount ?? autonomyLogs.length}</strong>
          </span>

          {onNavigate && (
            <button
              onClick={() => onNavigate('consensus-cpo')}
              className="px-2 h-[20px] bg-[#261d0d] border border-[#ff8800] hover:bg-[#ff8800] hover:text-[#090c10] text-[#ff9500] text-[11px] font-bold rounded-[2px] whitespace-nowrap"
            >
              [F12 超前认知/CPO传导]
            </button>
          )}

          <button
            onClick={() => {
              loadOverview();
              loadRelationMatrix(corrUniverse);
            }}
            disabled={overviewLoading || relationLoading}
            className="inline-flex items-center gap-1 px-2 h-[20px] bg-[#11151d] border border-[#2b3444] hover:border-[#ff8800] text-[#dfe6f0] text-[11px] rounded-[2px] disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3 h-3 text-[#ff8800] ${overviewLoading || relationLoading ? 'animate-spin' : ''}`}
            />
            刷新
          </button>
        </div>
      </div>

      {overviewError && (
        <div className="h-[24px] px-3 bg-[#2a1215] border-b border-[#5c1d22] flex items-center justify-between text-xs text-[#ff6b6b] shrink-0">
          <span>数据加载异常: {overviewError}</span>
          <button
            onClick={() => void loadOverview(false)}
            className="px-2 py-0.5 bg-[#3b181c] border border-[#ff3535] text-[11px]"
          >
            重试
          </button>
        </div>
      )}

      {paperOrderToast && (
        <div
          className={`h-[26px] px-3 border-b flex items-center justify-between text-[11px] shrink-0 ${
            paperOrderToast.ok
              ? 'bg-[#102018] border-[#1f5c3a] text-[#6ee7b7]'
              : 'bg-[#2a1215] border-[#5c1d22] text-[#ff6b6b]'
          }`}
        >
          <span className="truncate font-mono">{paperOrderToast.text}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {paperOrderToast.ok && onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('saas-desk')}
                className="px-2 h-[18px] bg-[#161b24] border border-[#ff8800] text-[#ff9500] hover:bg-[#ff8800] hover:text-[#090c10] text-[10px] font-bold rounded-[2px]"
              >
                前往模拟实盘舱
              </button>
            )}
            <button
              type="button"
              onClick={() => setPaperOrderToast(null)}
              className="px-1.5 h-[18px] bg-[#161b24] border border-[#2d3646] text-[#9aa5b5] hover:text-white text-[10px] rounded-[2px]"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* ==================== [02] V4 PM x ASSET CORRELATION DISCOVERY & JOINT BACKTEST ==================== */}
      {activeTab === 'pm-correlation' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832]">
          {/* Top Filter & Anti-Lookahead Ribbon */}
          <div className="bg-[#11151d] border-b border-[#232a36] px-2.5 py-1 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <select
                value={corrEventId}
                onChange={(e) => {
                  const val = e.target.value;
                  setCorrEventId(val);
                  discoverRelations({ eventId: val });
                }}
                className="h-[22px] max-w-[230px] px-1.5 bg-[#090c10] border border-[#252c38] text-[#e5b567] outline-none rounded-[2px]"
              >
                <option value="">全部核心PM事件 ({eventPickerList.length})</option>
                {eventPickerList.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    [{fmtNum(ev.yesProb, 0)}%] {ev.title}
                  </option>
                ))}
              </select>

              <div className="relative">
                <Search className="w-3 h-3 text-[#7d8796] absolute left-1.5 top-1/2 -translate-y-1/2" />
                <input
                  value={corrCustomQuery}
                  onChange={(e) => setCorrCustomQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') discoverRelations();
                  }}
                  placeholder="关键词 (Fed/Iran/Gold/AI)..."
                  className="pl-5 pr-2 h-[22px] w-40 bg-[#090c10] border border-[#252c38] focus:border-[#ff8800] outline-none text-[11px] text-[#dfe6f0] rounded-[2px]"
                />
              </div>

              <div className="inline-flex border border-[#252c38] bg-[#090c10] rounded-[2px]">
                {PM_UNIVERSES.map((u, idx) => (
                  <button
                    key={u.id}
                    onClick={() => {
                      setCorrUniverse(u.id);
                      discoverRelations({ universe: u.id });
                    }}
                    className={`px-2 h-[20px] text-[11px] ${idx > 0 ? 'border-l border-[#252c38]' : ''} ${
                      corrUniverse === u.id
                        ? 'bg-[#261d0d] text-[#ff9500] font-bold'
                        : 'text-[#8b95a5] hover:text-[#dfe6f0]'
                    }`}
                  >
                    {u.label}
                  </button>
                ))}
              </div>

              <select
                value={corrLookbackDays}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setCorrLookbackDays(v);
                  discoverRelations({ lookbackDays: v });
                }}
                className="h-[22px] px-1.5 bg-[#090c10] border border-[#252c38] font-mono text-[#dfe6f0] outline-none rounded-[2px]"
              >
                <option value={60}>60日</option>
                <option value={120}>120日</option>
                <option value={180}>180日</option>
              </select>

              <select
                value={corrShockThresholdPp}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setCorrShockThresholdPp(v);
                  setEbShockThreshold(v);
                  discoverRelations({ shockThresholdPp: v });
                }}
                className="h-[22px] px-1.5 bg-[#090c10] border border-[#252c38] font-mono text-[#f0b90b] outline-none rounded-[2px]"
              >
                <option value={1.5}>|ΔP|&gt;=1.5%</option>
                <option value={2.5}>|ΔP|&gt;=2.5%</option>
                <option value={4.0}>|ΔP|&gt;=4.0%</option>
              </select>

              <button
                onClick={() => discoverRelations()}
                disabled={relationLoading}
                className="inline-flex items-center gap-1 px-2.5 h-[22px] bg-[#ff8800] hover:bg-[#ff991a] text-[#090c10] font-bold text-[11px] rounded-[2px] disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${relationLoading ? 'animate-spin' : ''}`} />
                重新扫描关联矩阵
              </button>
            </div>

            <span
              className="text-[11px] font-mono text-[#00c853] shrink-0"
              title={relationMatrix?.alignmentRule || 'UTC->Asia/Shanghai 09:00 pre-market cutoff'}
            >
              对齐基准: UTC-&gt;北京时间09:00盘前截断(零未来函数)
            </span>
          </div>

          {relationError && (
            <div className="px-2.5 py-1 bg-[#2a1215] border-b border-[#5c1d22] text-xs text-[#ff3535] shrink-0">
              {relationError}
            </div>
          )}

          {/* Main Split Workspace */}
          <div className="flex-1 min-h-0 grid grid-cols-12 gap-[1px] bg-[#222832]">
            {/* Left Docked Column (~41.6%): Heatmap Matrix + Discovery Leaderboard */}
            <div className="col-span-12 xl:col-span-5 flex flex-col gap-[1px] bg-[#222832] min-h-0">
              {/* 1) Cross-Market Event x Asset Shock Heatmap Matrix */}
              <div className="h-[34%] min-h-[165px] bg-[#0e1117] flex flex-col min-h-0">
                <PaneHeader
                  title="跨市场事件 × 标的冲击相关热力矩阵"
                  right="点击矩阵单元格联动拟合与回测"
                />
                <div className="flex-1 min-h-0 overflow-auto">
                  {matrixPivot.events.length > 0 && matrixPivot.assets.length > 0 ? (
                    <table className="w-full text-[11px] border-collapse tabular-nums font-mono">
                      <thead className="sticky top-0 z-10 bg-[#151a23] text-[#8b95a5] border-b border-[#252c38]">
                        <tr className="h-[24px]">
                          <th className="px-2 text-left font-medium sticky left-0 bg-[#151a23] z-20 min-w-[125px]">
                            PM事件 \ 标的
                          </th>
                          {matrixPivot.assets.map(([sym, name]) => (
                            <th key={sym} className="px-1.5 text-center font-medium whitespace-nowrap" title={name}>
                              <span className="text-[#e5b567]">{sym}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrixPivot.events.map(([evId, shortTitle]) => (
                          <tr key={evId} className="h-[26px] border-b border-[#181d26] even:bg-[#11151d]">
                            <td
                              className="px-2 text-left text-[#dfe6f0] sticky left-0 bg-[#0e1117] border-r border-[#232a36] max-w-[140px] truncate font-sans"
                              title={shortTitle}
                            >
                              {shortTitle}
                            </td>
                            {matrixPivot.assets.map(([sym]) => {
                              const cell = matrixPivot.cellLookup.get(`${evId}::${sym}`);
                              if (!cell) {
                                return (
                                  <td key={sym} className="px-1 text-center text-[#3f4a5c]">
                                    -
                                  </td>
                                );
                              }
                              const active =
                                selectedRelation?.eventId === cell.eventId &&
                                selectedRelation?.assetSymbol === cell.assetSymbol;
                              const sc = safeNum(cell.shockCorr, 0);
                              const heatBg =
                                sc >= 0.35
                                  ? 'bg-[#361419] text-[#ff3535]'
                                  : sc >= 0.15
                                  ? 'bg-[#221216] text-[#ff6b6b]'
                                  : sc <= -0.35
                                  ? 'bg-[#0c2e1d] text-[#00c853]'
                                  : sc <= -0.15
                                  ? 'bg-[#0d2018] text-[#34d399]'
                                  : 'bg-[#141922] text-[#8b95a5]';
                              return (
                                <td key={sym} className="p-[1px]">
                                  <button
                                    onClick={() => {
                                      setSelectedRelKey({ eventId: cell.eventId, assetSymbol: cell.assetSymbol });
                                      ebAutoRanKey.current = `${cell.eventId}::${cell.assetSymbol}`;
                                      runEventBacktest(cell.eventId, cell.assetSymbol);
                                    }}
                                    title={`${shortTitle} × ${cell.assetName}(${sym}) | 冲击Corr:${fmtNum(sc, 2)} | 滞后Z:${fmtNum(cell.divergenceZScore, 2)} | 综合:${fmtNum(cell.compositeScore, 0)}`}
                                    className={`w-full h-[22px] text-[10px] border ${
                                      active ? 'border-[#ff8800] ring-1 ring-[#ff8800]' : 'border-[#232a36] hover:border-[#8b95a5]'
                                    } ${heatBg}`}
                                  >
                                    {sc > 0 ? '+' : ''}
                                    {fmtNum(sc, 2)}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="py-8 text-center text-xs text-[#7d8796]">
                      {relationLoading ? '正在计算跨市场关联矩阵...' : '暂无矩阵单元数据'}
                    </div>
                  )}
                </div>
              </div>

              {/* 2) Discovery & Divergence Alpha Leaderboard */}
              <div className="flex-1 min-h-0 bg-[#0e1117] flex flex-col">
                <PaneHeader
                  title={`关联挖掘与预期差排行榜 (${sortedRelations.length})`}
                  right="点击表头排序 · 突出显示预期差严重滞后"
                />
                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-[#151a23] text-[#8b95a5] border-b border-[#252c38]">
                      <tr className="h-[26px]">
                        <th className="px-1.5 text-left font-medium">代码</th>
                        <th className="px-1.5 text-left font-medium">标的/层级</th>
                        <th className="px-1 text-center font-medium">方向</th>
                        <th
                          onClick={() => toggleRelationSort('optimalLagDays')}
                          className="px-1.5 text-right font-medium cursor-pointer hover:text-[#ff9500] select-none"
                        >
                          领先{relationSortCol === 'optimalLagDays' ? (relationSortAsc ? '↑' : '↓') : ''}
                        </th>
                        <th
                          onClick={() => toggleRelationSort('shockHitRate')}
                          className="px-1.5 text-right font-medium cursor-pointer hover:text-[#ff9500] select-none"
                        >
                          冲击Corr/胜率{relationSortCol === 'shockHitRate' ? (relationSortAsc ? '↑' : '↓') : ''}
                        </th>
                        <th className="px-1.5 text-right font-medium">Beta</th>
                        <th className="px-1.5 text-right font-medium">隐含/现价</th>
                        <th
                          onClick={() => toggleRelationSort('divergenceZScore')}
                          className="px-1.5 text-right font-medium cursor-pointer hover:text-[#ff9500] select-none"
                        >
                          预期差Z{relationSortCol === 'divergenceZScore' ? (relationSortAsc ? '↑' : '↓') : ''}
                        </th>
                        <th
                          onClick={() => toggleRelationSort('compositeScore')}
                          className="px-1.5 text-center font-medium cursor-pointer hover:text-[#ff9500] select-none"
                        >
                          Alpha状态{relationSortCol === 'compositeScore' ? (relationSortAsc ? '↑' : '↓') : ''}
                        </th>
                        <th className="px-1.5 text-center font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRelations.map((r) => {
                        const isSel =
                          selectedRelation?.eventId === r.eventId && selectedRelation?.assetSymbol === r.assetSymbol;
                        const isLagAlpha = (r.alphaState || '').includes('滞后');
                        return (
                          <tr
                            key={`${r.eventId}-${r.assetSymbol}`}
                            onClick={() => {
                              setSelectedRelKey({ eventId: r.eventId, assetSymbol: r.assetSymbol });
                              setEbHedgeSymbol(r.hedgeLegSymbol || '');
                            }}
                            className={`h-[26px] border-b border-[#181d26] cursor-pointer tabular-nums ${
                              isSel
                                ? 'bg-[#1f293b]'
                                : isLagAlpha
                                ? 'bg-[#1c1410] hover:bg-[#241a14]'
                                : 'even:bg-[#11151d] hover:bg-[#1b2434]'
                            }`}
                          >
                            <td className="px-1.5 font-mono text-[#e5b567] font-semibold whitespace-nowrap">
                              {r.assetSymbol}
                            </td>
                            <td className="px-1.5 max-w-[125px]">
                              <div className="flex items-center gap-1 truncate">
                                <span
                                  onClick={(e) => {
                                    if (isAShareLikeSymbol(r.assetSymbol, r.assetMarket) && /^\d{6}$/.test(r.assetSymbol)) {
                                      e.stopPropagation();
                                      onSelectStock(r.assetSymbol, r.assetName);
                                    }
                                  }}
                                  className="text-[#e8edf5] font-medium truncate hover:underline"
                                  title={`${r.eventTitle} -> ${r.assetName} (${r.transmissionTier})`}
                                >
                                  {r.assetName}
                                </span>
                                <span className="px-1 text-[9px] bg-[#161b24] border border-[#2c3647] text-[#4da3ff] shrink-0 rounded-[2px]">
                                  {r.transmissionTier === '一阶直连'
                                    ? '一阶'
                                    : r.transmissionTier === '二阶传导'
                                    ? '二阶'
                                    : '共振'}
                                </span>
                              </div>
                            </td>
                            <td className="px-1 text-center font-mono font-bold">
                              <span className={r.expectedDirection >= 0 ? 'text-[#ff3535]' : 'text-[#00c853]'}>
                                {r.expectedDirection >= 0 ? '+多' : '-空'}
                              </span>
                            </td>
                            <td className="px-1.5 text-right font-mono text-[#ff9500] whitespace-nowrap">
                              PM+{r.optimalLagDays}d
                            </td>
                            <td className="px-1.5 text-right font-mono whitespace-nowrap">
                              <span className={dirColorClass(r.shockCorr)}>{fmtNum(r.shockCorr, 2)}</span>
                              <span className="text-[#475569] mx-0.5">/</span>
                              <span className="text-[#f0b90b]">{fmtNum(r.shockHitRate, 0)}%</span>
                            </td>
                            <td className="px-1.5 text-right font-mono text-[#4da3ff]">{fmtNum(r.rollingBeta, 2)}</td>
                            <td className="px-1.5 text-right font-mono text-[#dfe6f0] whitespace-nowrap">
                              {fmtNum(r.impliedPrice, 1)}/{fmtNum(r.actualPrice, 1)}
                            </td>
                            <td className={`px-1.5 text-right font-mono font-bold ${dirColorClass(r.divergenceZScore)}`}>
                              {safeNum(r.divergenceZScore) > 0 ? '+' : ''}
                              {fmtNum(r.divergenceZScore, 2)}
                            </td>
                            <td className="px-1.5 text-center whitespace-nowrap">
                              <span className={`px-1 py-0.5 text-[9px] border rounded-[2px] ${alphaStateTagClass(r.alphaState)}`}>
                                {r.alphaState}
                              </span>
                            </td>
                            <td className="px-1.5 text-center whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedRelKey({ eventId: r.eventId, assetSymbol: r.assetSymbol });
                                    setEbHedgeSymbol(r.hedgeLegSymbol || '');
                                    ebAutoRanKey.current = `${r.eventId}::${r.assetSymbol}`;
                                    runEventBacktest(r.eventId, r.assetSymbol, r.hedgeLegSymbol || '');
                                  }}
                                  className="px-1.5 h-[18px] bg-[#161b24] border border-[#ff8800] text-[#ff9500] hover:bg-[#ff8800] hover:text-[#090c10] text-[10px] font-bold rounded-[2px]"
                                >
                                  回测
                                </button>
                                <button
                                  type="button"
                                  disabled={paperOrderBusyKey === `rel:${r.eventId}:${r.assetSymbol}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const market = isAShareLikeSymbol(r.assetSymbol, r.assetMarket) ? 'ashare' : 'futures';
                                    sendToPaperDesk({
                                      key: `rel:${r.eventId}:${r.assetSymbol}`,
                                      symbol: r.assetSymbol,
                                      name: r.assetName,
                                      market,
                                      directionSign: safeNum(r.expectedDirection, 1),
                                      price: safeNum(r.actualPrice, 0) > 0 ? safeNum(r.actualPrice, 0) : undefined,
                                      strategyTag: 'PM事件关联信号',
                                      note: `PM[${r.eventTitle || r.eventId}] lag=${r.optimalLagDays}d`,
                                    });
                                  }}
                                  className="px-1.5 h-[18px] bg-[#161b24] border border-[#00c853] text-[#4ade80] hover:bg-[#00c853] hover:text-[#090c10] disabled:opacity-50 text-[10px] font-bold rounded-[2px]"
                                >
                                  {paperOrderBusyKey === `rel:${r.eventId}:${r.assetSymbol}` ? '发送中' : '转入模拟实盘舱'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!relationLoading && sortedRelations.length === 0 && (
                        <tr>
                          <td colSpan={10} className="py-10 text-center text-xs text-[#7d8796]">
                            暂无关联挖掘结果，请切换标的域或点击「重新扫描关联矩阵」
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right Docked Column (~58.4%): Dual-Axis Chart + Lead-Lag + Joint Backtest */}
            <div className="col-span-12 xl:col-span-7 flex flex-col gap-[1px] bg-[#222832] min-h-0">
              {/* Upper Docked Row: Dual-Axis Historical Fit (70%) + Lead-Lag Spectrum & Mechanism (30%) */}
              <div className="h-[44%] min-h-[220px] grid grid-cols-12 gap-[1px] bg-[#222832] shrink-0">
                {/* Dual-Axis Historical Fit & Divergence Z */}
                <div className="col-span-12 lg:col-span-8 bg-[#0d1015] flex flex-col min-h-0">
                  <PaneHeader
                    title={
                      selectedRelation
                        ? `${selectedRelation.assetName}(${selectedRelation.assetSymbol}) × ${selectedRelation.eventTitle}`
                        : '双轴历史拟合与预期差残差 Z-Score'
                    }
                    right={ebResult?.executionRule && <span className="text-[#00c853] truncate max-w-[200px]">{ebResult.executionRule}</span>}
                  />
                  <div className="relative flex-1 min-h-0">
                    {ebLoading && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d1015]/80 text-xs text-[#ff9500]">
                        正在对齐时间序列与执行联合回测...
                      </div>
                    )}
                    <div ref={ebDualChartRef} className="w-full h-full" />
                  </div>
                </div>

                {/* Lead-Lag Spectrum (-5d..+5d) & Mechanism */}
                <div className="col-span-12 lg:col-span-4 bg-[#0d1015] flex flex-col min-h-0">
                  <PaneHeader title="领先滞后互相关 (-5d..+5d)" right="橙柱=PM领先" />
                  <div ref={ebLeadLagChartRef} className="w-full h-[54%] min-h-[95px]" />
                  <div className="flex-1 min-h-0 overflow-y-auto bg-[#11151d] border-t border-[#232a36] px-2 py-1.5 text-[11px] space-y-1">
                    {selectedRelation ? (
                      <>
                        <div className="grid grid-cols-2 gap-1 font-mono tabular-nums">
                          <div>
                            <span className="text-[#7d8796]">Granger F: </span>
                            <span className="text-[#4da3ff] font-bold">{fmtNum(selectedRelation.grangerFStat, 2)}</span>
                          </div>
                          <div>
                            <span className="text-[#7d8796]">最优领先: </span>
                            <span className="text-[#ff9500] font-bold">+{selectedRelation.optimalLagDays}d</span>
                          </div>
                          <div>
                            <span className="text-[#7d8796]">冲击胜率: </span>
                            <span className="text-[#ff3535] font-bold">{fmtNum(selectedRelation.shockHitRate, 1)}%</span>
                          </div>
                          <div>
                            <span className="text-[#7d8796]">半Kelly: </span>
                            <span className="text-[#f0b90b] font-bold">{fmtNum(selectedRelation.kellySuggestedPct, 1)}%</span>
                          </div>
                        </div>
                        <div className="text-[10px] text-[#cfd8e3] leading-snug border-t border-[#232a36] pt-1">
                          <span className="text-[#e5b567] font-semibold">传导路径: </span>
                          {selectedRelation.mechanism}
                        </div>
                      </>
                    ) : (
                      <div className="text-[#7d8796]">选择左侧关联对查看传导机理</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Lower Docked Row: PM Event-Driven Joint Backtest Terminal */}
              <div className="flex-1 min-h-0 bg-[#0e1117] flex flex-col">
                <PaneHeader
                  title={`PM事件驱动联立回测终端${selectedRelation ? ` · ${selectedRelation.assetName}(${selectedRelation.assetSymbol})` : ''}`}
                  right={
                    <span className={selectedIsAShare ? 'text-[#4da3ff]' : 'text-[#f0b90b]'}>
                      {selectedIsAShare ? 'A股 T+1 规则 · 杠杆锁定 1x' : '期货 T+0 双向 · 支持 1x-10x 杠杆'}
                    </span>
                  }
                />

                {/* Parameter Control Strip */}
                <div className="px-2 py-1 bg-[#11151d] border-b border-[#232a36] flex flex-wrap items-center gap-2 text-[11px] shrink-0">
                  <select
                    value={ebSignalMode}
                    onChange={(e) => setEbSignalMode(e.target.value as PmEventSignalMode)}
                    className="h-[22px] px-1.5 bg-[#090c10] border border-[#252c38] text-[#dfe6f0] outline-none rounded-[2px]"
                  >
                    {PM_SIGNAL_MODES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>

                  <label className="flex items-center gap-1 text-[#8b95a5]">
                    ΔP阈值%
                    <input
                      type="number"
                      step={0.5}
                      min={0.5}
                      max={20}
                      value={ebShockThreshold}
                      onChange={(e) => setEbShockThreshold(Math.max(0.5, Number(e.target.value) || 2.5))}
                      className="w-12 h-[22px] px-1 bg-[#090c10] border border-[#252c38] font-mono text-[#f0b90b] text-center outline-none rounded-[2px]"
                    />
                  </label>

                  <label className="flex items-center gap-1 text-[#8b95a5]">
                    Z阈值
                    <input
                      type="number"
                      step={0.1}
                      min={0.3}
                      max={4}
                      value={ebDivZEntry}
                      onChange={(e) => setEbDivZEntry(Math.max(0.3, Number(e.target.value) || 1.35))}
                      className="w-12 h-[22px] px-1 bg-[#090c10] border border-[#252c38] font-mono text-[#dfe6f0] text-center outline-none rounded-[2px]"
                    />
                  </label>

                  <label className="flex items-center gap-1 text-[#8b95a5]">
                    持有(天)
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={ebHoldingDays}
                      onChange={(e) => setEbHoldingDays(Math.max(1, Number(e.target.value) || 5))}
                      className="w-10 h-[22px] px-1 bg-[#090c10] border border-[#252c38] font-mono text-[#dfe6f0] text-center outline-none rounded-[2px]"
                    />
                  </label>

                  <label className="flex items-center gap-1 text-[#8b95a5]">
                    对冲腿
                    <input
                      value={ebHedgeSymbol}
                      onChange={(e) => setEbHedgeSymbol(e.target.value)}
                      placeholder="可选 e.g. AG0"
                      className="w-20 h-[22px] px-1.5 bg-[#090c10] border border-[#252c38] font-mono text-[#e5b567] outline-none rounded-[2px]"
                    />
                  </label>

                  <label className="flex items-center gap-1 text-[#8b95a5]">
                    杠杆
                    <select
                      value={selectedIsAShare ? 1 : ebLeverage}
                      disabled={selectedIsAShare}
                      onChange={(e) => setEbLeverage(Number(e.target.value))}
                      className="h-[22px] px-1 bg-[#090c10] border border-[#252c38] font-mono text-[#f0b90b] outline-none rounded-[2px] disabled:opacity-60"
                    >
                      {(selectedIsAShare ? [1] : [1, 2, 3, 4, 5, 8, 10]).map((lv) => (
                        <option key={lv} value={lv}>
                          {lv}x
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex items-center gap-1 text-[#8b95a5]">
                    止损%
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={ebStopLossPct}
                      onChange={(e) => setEbStopLossPct(Math.max(1, Number(e.target.value) || 6))}
                      className="w-10 h-[22px] px-1 bg-[#090c10] border border-[#252c38] font-mono text-[#ff3535] text-center outline-none rounded-[2px]"
                    />
                  </label>

                  <label className="flex items-center gap-1 text-[#cfd8e3] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={ebUseKelly}
                      onChange={(e) => setEbUseKelly(e.target.checked)}
                      className="accent-[#ff8800]"
                    />
                    Kelly仓位
                  </label>

                  <button
                    onClick={() => runEventBacktest()}
                    disabled={ebLoading || !selectedRelation}
                    className="inline-flex items-center gap-1 px-2.5 h-[22px] bg-[#ff8800] hover:bg-[#ff991a] text-[#090c10] font-bold text-[11px] rounded-[2px] disabled:opacity-50"
                  >
                    {ebLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
                    运行事件联立回测
                  </button>
                </div>

                {ebError && (
                  <div className="px-2.5 py-1 bg-[#2a1215] text-xs text-[#ff3535] border-b border-[#5c1d22] shrink-0">
                    {ebError}
                  </div>
                )}

                {/* 8-Cell Wind KPI Bar */}
                <div className="grid grid-cols-4 lg:grid-cols-8 divide-x divide-[#232a36] border-b border-[#232a36] bg-[#0e1117] text-[11px] font-mono tabular-nums shrink-0">
                  <div className="px-2 py-1 flex items-center justify-between">
                    <span className="text-[#7d8796]">总收益</span>
                    <span className={`font-bold ${dirColorClass(ebResult?.metrics?.totalReturnPct)}`}>
                      {fmtPct(ebResult?.metrics?.totalReturnPct)}
                    </span>
                  </div>
                  <div className="px-2 py-1 flex items-center justify-between">
                    <span className="text-[#7d8796]">超额</span>
                    <span className={`font-bold ${dirColorClass(ebResult?.metrics?.excessReturnPct)}`}>
                      {fmtPct(ebResult?.metrics?.excessReturnPct)}
                    </span>
                  </div>
                  <div className="px-2 py-1 flex items-center justify-between">
                    <span className="text-[#7d8796]">年化</span>
                    <span className={`font-bold ${dirColorClass(ebResult?.metrics?.annualReturnPct)}`}>
                      {fmtPct(ebResult?.metrics?.annualReturnPct)}
                    </span>
                  </div>
                  <div className="px-2 py-1 flex items-center justify-between">
                    <span className="text-[#7d8796]">夏普</span>
                    <span className="text-[#f0b90b] font-bold">{fmtNum(ebResult?.metrics?.sharpe, 2)}</span>
                  </div>
                  <div className="px-2 py-1 flex items-center justify-between">
                    <span className="text-[#7d8796]">IR</span>
                    <span className="text-[#4da3ff] font-bold">{fmtNum(ebResult?.metrics?.informationRatio, 2)}</span>
                  </div>
                  <div className="px-2 py-1 flex items-center justify-between">
                    <span className="text-[#7d8796]">回撤</span>
                    <span className="text-[#00c853] font-bold">{fmtNum(ebResult?.metrics?.maxDrawdownPct, 2)}%</span>
                  </div>
                  <div className="px-2 py-1 flex items-center justify-between">
                    <span className="text-[#7d8796]">胜率</span>
                    <span className="text-[#ff3535] font-bold">{fmtNum(ebResult?.metrics?.winRatePct, 1)}%</span>
                  </div>
                  <div className="px-2 py-1 flex items-center justify-between">
                    <span className="text-[#7d8796]">Kelly</span>
                    <span className="text-[#e5b567] font-bold">{fmtNum(ebResult?.metrics?.kellyOptimalPct, 1)}%</span>
                  </div>
                </div>

                {/* Split Bottom: Equity Curve (50%) + Trade Blotter (50%) */}
                <div className="flex-1 min-h-0 grid grid-cols-12 gap-[1px] bg-[#222832]">
                  <div className="col-span-12 lg:col-span-6 bg-[#0d1015] flex flex-col min-h-0">
                    <div ref={ebEquityChartRef} className="w-full h-full min-h-[140px]" />
                  </div>

                  <div className="col-span-12 lg:col-span-6 bg-[#0e1117] flex flex-col min-h-0">
                    <div className="flex-1 min-h-0 overflow-auto">
                      <table className="w-full text-[11px] border-collapse">
                        <thead className="sticky top-0 z-10 bg-[#151a23] text-[#8b95a5] border-b border-[#252c38]">
                          <tr className="h-[24px]">
                            <th className="px-1.5 text-left font-medium">开/平日期</th>
                            <th className="px-1 text-center font-medium">方向</th>
                            <th className="px-1.5 text-right font-medium">成交价</th>
                            <th className="px-1.5 text-right font-medium">入场PM(ΔP)</th>
                            <th className="px-1 text-right font-medium">Z</th>
                            <th className="px-1 text-right font-medium">仓位</th>
                            <th className="px-1.5 text-right font-medium">净盈亏</th>
                            <th className="px-1.5 text-right font-medium">收益%</th>
                            <th className="px-1.5 text-left font-medium">触发原因</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(ebResult?.trades ?? []).map((tr) => {
                            const long = isLongDirection(tr.side);
                            return (
                              <tr
                                key={tr.id}
                                className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434] tabular-nums"
                              >
                                <td className="px-1.5 font-mono text-[10px] text-[#8b95a5] whitespace-nowrap">
                                  {tr.entryDate.slice(5)}→{tr.exitDate.slice(5)}
                                </td>
                                <td className="px-1 text-center">
                                  <span
                                    className={`px-1 py-0.5 text-[9px] border rounded-[2px] ${
                                      long
                                        ? 'bg-[#2a1215] text-[#ff3535] border-[#5c1d22]'
                                        : 'bg-[#0d261a] text-[#00c853] border-[#194d33]'
                                    }`}
                                  >
                                    {tr.side}
                                  </span>
                                </td>
                                <td className="px-1.5 text-right font-mono text-[#dfe6f0] whitespace-nowrap">
                                  {fmtNum(tr.entryPrice, 1)}→{fmtNum(tr.exitPrice, 1)}
                                </td>
                                <td className="px-1.5 text-right font-mono whitespace-nowrap">
                                  <span className="text-[#f0b90b]">{fmtNum(tr.entryProb, 0)}%</span>
                                  <span className={dirColorClass(tr.entryProbDelta)}>
                                    ({tr.entryProbDelta > 0 ? '+' : ''}
                                    {fmtNum(tr.entryProbDelta, 1)})
                                  </span>
                                </td>
                                <td className="px-1 text-right font-mono text-[#4da3ff]">
                                  {fmtNum(tr.entryDivergenceZ, 2)}
                                </td>
                                <td className="px-1 text-right font-mono text-[#e5b567]">
                                  {fmtNum(tr.positionPct, 0)}%
                                </td>
                                <td className={`px-1.5 text-right font-mono font-bold ${dirColorClass(tr.pnl)}`}>
                                  {tr.pnl > 0 ? '+' : ''}
                                  {fmtNum(tr.pnl, 0)}
                                </td>
                                <td className={`px-1.5 text-right font-mono font-bold ${dirColorClass(tr.returnPct)}`}>
                                  {fmtPct(tr.returnPct)}
                                </td>
                                <td className="px-1.5 text-[10px] text-[#8b95a5] max-w-[110px] truncate" title={tr.reason}>
                                  {tr.reason}
                                </td>
                              </tr>
                            );
                          })}
                          {!(ebResult?.trades?.length) && (
                            <tr>
                              <td colSpan={9} className="py-8 text-center text-xs text-[#7d8796]">
                                暂无触发交割记录，可调低 ΔP/Z 阈值后重试
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== [01] 28 MAIN FUTURES QUOTES & PM EVENT MAPPING ==================== */}
      {activeTab === 'pm-futures' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#232a36]">
          {/* Top Row: PM Probability Matrix + Cross-Market Arbitrage Table */}
          <div className="h-[42%] min-h-[220px] grid grid-cols-12 gap-[1px] bg-[#232a36] shrink-0">
            {/* PM Probability-to-Futures Transmission Matrix */}
            <div className="col-span-12 lg:col-span-6 bg-[#0e1117] flex flex-col min-h-0">
              <PaneHeader title={`Polymarket 宏观概率雷达与传导矩阵 (${filteredPmEvents.length})`}>
                <div className="flex items-center gap-1 ml-2 overflow-x-auto">
                  {pmCategories.slice(0, 5).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setPmCategoryFilter(cat)}
                      className={`px-1.5 h-[18px] text-[10px] border rounded-[2px] whitespace-nowrap ${
                        pmCategoryFilter === cat
                          ? 'bg-[#261d0d] text-[#ff9500] border-[#ff8800]'
                          : 'bg-[#0e1117] text-[#8b95a5] border-[#252c38] hover:text-[#dfe6f0]'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </PaneHeader>

              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead className="sticky top-0 z-10 bg-[#151a23] text-[#8b95a5] border-b border-[#252c38]">
                    <tr className="h-[26px] text-[11px]">
                      <th className="px-2 text-left font-medium">分类</th>
                      <th className="px-2 text-left font-medium">宏观事件盘口</th>
                      <th className="px-2 text-right font-medium">YES%</th>
                      <th className="px-2 text-right font-medium">24hΔ</th>
                      <th className="px-2 text-right font-medium">成交量</th>
                      <th className="px-2 text-left font-medium">传导映射资产</th>
                      <th className="px-2 text-center font-medium">深度挖掘</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPmEvents.map((ev) => {
                      const prob = Math.min(100, Math.max(0, safeNum(ev.yesProb, 50)));
                      const chg24 = safeNum(ev.change24h, 0);
                      const isSel = selectedPmEvent?.id === ev.id;
                      return (
                        <tr
                          key={ev.id}
                          onClick={() => setSelectedPmEventId(ev.id)}
                          className={`h-[26px] border-b border-[#181d26] cursor-pointer tabular-nums ${
                            isSel ? 'bg-[#1f293b]' : 'even:bg-[#11151d] hover:bg-[#1b2434]'
                          }`}
                        >
                          <td className="px-2 text-[10px] text-[#4da3ff] whitespace-nowrap">{ev.category || '宏观'}</td>
                          <td className="px-2 max-w-[180px]">
                            <div className="flex items-center gap-1 truncate">
                              <span className="text-[#e8edf5] truncate" title={ev.title}>
                                {ev.title}
                              </span>
                              {ev.url && (
                                <a
                                  href={ev.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[#4da3ff] hover:text-[#ff9500] shrink-0"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="px-2 text-right font-mono font-bold text-[#f0b90b] whitespace-nowrap">
                            {prob.toFixed(1)}%
                          </td>
                          <td className={`px-2 text-right font-mono whitespace-nowrap ${dirColorClass(chg24)}`}>
                            {chg24 > 0 ? '+' : ''}
                            {chg24.toFixed(1)}%
                          </td>
                          <td className="px-2 text-right font-mono text-[#f0b90b] whitespace-nowrap">
                            {fmtUsd(ev.volumeUsd)}
                          </td>
                          <td className="px-2">
                            <div className="flex items-center gap-1 flex-wrap py-0.5">
                              {(ev.impactAssets || []).slice(0, 2).map((asset, ai) => {
                                const long = isLongDirection(asset.direction);
                                const short = isShortDirection(asset.direction);
                                return (
                                  <button
                                    key={`${asset.symbol}-${ai}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleImpactAssetClick(asset);
                                    }}
                                    title={asset.logic || `${asset.name} (${asset.symbol})`}
                                    className={`px-1.5 h-[18px] text-[10px] border rounded-[2px] whitespace-nowrap ${
                                      long
                                        ? 'bg-[#2a1215] text-[#ff3535] border-[#5c1d22] hover:border-[#ff3535]'
                                        : short
                                        ? 'bg-[#0d261a] text-[#00c853] border-[#194d33] hover:border-[#00c853]'
                                        : 'bg-[#161b24] text-[#dfe6f0] border-[#252c38]'
                                    }`}
                                  >
                                    {asset.symbol} {asset.direction}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-2 text-center whitespace-nowrap">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleJumpToCorrelation(ev.id);
                              }}
                              className="px-1.5 h-[18px] bg-[#161b24] border border-[#ff8800] text-[#ff9500] hover:bg-[#ff8800] hover:text-[#090c10] text-[10px] font-bold rounded-[2px]"
                            >
                              深度关联挖掘/回测
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Cross-Market Arbitrage & Selected Event Logic */}
            <div className="col-span-12 lg:col-span-6 bg-[#0e1117] flex flex-col min-h-0">
              <PaneHeader
                title={`跨市套利监控矩阵 (${arbitrageStrategies.length})`}
                right={
                  selectedPmEvent && (
                    <button
                      onClick={() => handleJumpToCorrelation(selectedPmEvent.id)}
                      className="px-2 h-[18px] bg-[#261d0d] border border-[#ff8800] text-[#ff9500] text-[10px] font-bold rounded-[2px]"
                    >
                      联动挖掘: {selectedPmEvent.title.slice(0, 16)}
                    </button>
                  )
                }
              />
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead className="sticky top-0 z-10 bg-[#151a23] text-[#8b95a5] border-b border-[#252c38]">
                    <tr className="h-[26px] text-[11px]">
                      <th className="px-2 text-left font-medium">套利策略 / 腿</th>
                      <th className="px-2 text-right font-medium">当前价差</th>
                      <th className="px-2 text-right font-medium">Z-Score</th>
                      <th className="px-2 text-center font-medium">信号</th>
                      <th className="px-2 text-right font-medium">胜率%</th>
                      <th className="px-2 text-left font-medium">触发条件与风控纪律</th>
                    </tr>
                  </thead>
                  <tbody>
                    {arbitrageStrategies.map((st) => {
                      const z = safeNum(st.zScore, 0);
                      return (
                        <tr
                          key={st.id}
                          className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434] tabular-nums"
                        >
                          <td className="px-2 whitespace-nowrap">
                            <span className="text-[#e8edf5] font-medium">{st.name}</span>
                            <span className="ml-1.5 font-mono text-[10px] text-[#e5b567]">
                              [{(st.legs || []).join('/')}]
                            </span>
                          </td>
                          <td className="px-2 text-right font-mono text-[#dfe6f0]">{String(st.currentSpread ?? '-')}</td>
                          <td
                            className={`px-2 text-right font-mono font-bold ${
                              Math.abs(z) >= 1.5 ? 'text-[#f0b90b]' : 'text-[#4da3ff]'
                            }`}
                          >
                            {z > 0 ? '+' : ''}
                            {fmtNum(z, 2)}
                          </td>
                          <td className="px-2 text-center">
                            <span className={`px-1.5 py-0.5 text-[10px] border rounded-[2px] ${signalTagClass(st.signal)}`}>
                              {st.signal || '跟踪'}
                            </span>
                          </td>
                          <td className="px-2 text-right font-mono text-[#ff3535]">{fmtNum(st.winRateEst, 1)}%</td>
                          <td
                            className="px-2 text-[11px] text-[#8b95a5] max-w-[230px] truncate"
                            title={`${st.triggerCondition || ''} | ${st.riskRule || ''}`}
                          >
                            {st.triggerCondition || '-'} · {st.riskRule || ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Bottom Row: 28 Futures Quotes Table + Candlestick & OI Chart */}
          <div className="flex-1 min-h-0 grid grid-cols-12 gap-[1px] bg-[#232a36]">
            {/* Left: 28 Domestic Futures Matrix */}
            <div className="col-span-12 lg:col-span-6 bg-[#0e1117] flex flex-col min-h-0">
              <PaneHeader title={`国内28主力期货实时报价 (${filteredFutures.length})`}>
                <div className="flex items-center gap-1 ml-1 overflow-x-auto">
                  {EXCHANGE_FILTERS.map((ex) => (
                    <button
                      key={ex.id}
                      onClick={() => setExchangeFilter(ex.id)}
                      className={`px-1.5 h-[18px] text-[10px] border rounded-[2px] whitespace-nowrap ${
                        exchangeFilter === ex.id
                          ? 'bg-[#261d0d] text-[#ff9500] border-[#ff8800]'
                          : 'bg-[#0e1117] text-[#8b95a5] border-[#252c38] hover:text-[#dfe6f0]'
                      }`}
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              </PaneHeader>

              <div className="bg-[#11151d] border-b border-[#232a36] px-2 py-1 flex items-center justify-between gap-2 shrink-0">
                <div className="relative">
                  <Search className="w-3 h-3 text-[#7d8796] absolute left-2 top-1/2 -translate-y-1/2" />
                  <input
                    value={futuresSearch}
                    onChange={(e) => setFuturesSearch(e.target.value)}
                    placeholder="搜合约代码/品种/PM信号..."
                    className="pl-6 pr-2 h-[22px] w-48 bg-[#090c10] border border-[#252c38] focus:border-[#ff8800] outline-none text-[11px] text-[#dfe6f0] rounded-[2px]"
                  />
                </div>
                <span className="text-[11px] text-[#7d8796]">点击行切换右侧主连K线与持仓图</span>
              </div>

              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead className="sticky top-0 z-10 bg-[#151a23] text-[#8b95a5] border-b border-[#252c38]">
                    <tr className="h-[26px] text-[11px]">
                      <th className="px-2 text-left font-medium">代码</th>
                      <th className="px-2 text-left font-medium">品种</th>
                      <th className="px-2 text-left font-medium">交易所</th>
                      <th
                        onClick={() => toggleFuturesSort('price')}
                        className="px-2 text-right font-medium cursor-pointer hover:text-[#ff9500] select-none"
                      >
                        最新价{futuresSort === 'price' ? (futuresSortAsc ? '↑' : '↓') : ''}
                      </th>
                      <th
                        onClick={() => toggleFuturesSort('changePct')}
                        className="px-2 text-right font-medium cursor-pointer hover:text-[#ff9500] select-none"
                      >
                        涨幅%{futuresSort === 'changePct' ? (futuresSortAsc ? '↑' : '↓') : ''}
                      </th>
                      <th
                        onClick={() => toggleFuturesSort('openInterest')}
                        className="px-2 text-right font-medium cursor-pointer hover:text-[#ff9500] select-none"
                      >
                        持仓量{futuresSort === 'openInterest' ? (futuresSortAsc ? '↑' : '↓') : ''}
                      </th>
                      <th className="px-2 text-center font-medium">PM共振</th>
                      <th className="px-2 text-left font-medium">关联事件</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFutures.map((q) => {
                      const active = q.symbol === selectedFuturesQuote?.symbol;
                      const chg = safeNum(q.changePct, 0);
                      return (
                        <tr
                          key={q.symbol}
                          onClick={() => setSelectedSymbol(q.symbol)}
                          className={`h-[26px] border-b border-[#181d26] cursor-pointer tabular-nums ${
                            active ? 'bg-[#1f293b]' : 'even:bg-[#11151d] hover:bg-[#1b2434]'
                          }`}
                        >
                          <td className="px-2 font-mono text-[#e5b567] font-semibold">{q.symbol}</td>
                          <td className={`px-2 font-medium whitespace-nowrap ${active ? 'text-[#ff9500]' : 'text-[#e8edf5]'}`}>
                            {q.name}
                          </td>
                          <td className="px-2 font-mono text-[11px] text-[#7d8796]">{q.exchange || '-'}</td>
                          <td className="px-2 text-right font-mono text-[#dfe6f0]">{fmtNum(q.price, 2)}</td>
                          <td className={`px-2 text-right font-mono font-bold ${dirColorClass(chg)}`}>{fmtPct(chg)}</td>
                          <td className="px-2 text-right font-mono text-[#f0b90b]">{fmtCompact(q.openInterest)}</td>
                          <td className="px-2 text-center">
                            <span className={`px-1.5 py-0.5 text-[10px] border rounded-[2px] ${signalTagClass(q.pmSignal)}`}>
                              {q.pmSignal || '中性'}
                            </span>
                          </td>
                          <td className="px-2 text-[11px] text-[#8b95a5] max-w-[140px] truncate" title={q.linkedEventTitle}>
                            {q.linkedEventTitle || '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right: Futures Candlestick (White/Yellow/Purple/Green MA) + OI */}
            <div className="col-span-12 lg:col-span-6 bg-[#0d1015] flex flex-col min-h-0">
              <PaneHeader
                title={`${selectedFuturesQuote?.name || klineData?.name || selectedSymbol} (${selectedSymbol}) 主连日K · 持仓量`}
                right={
                  <button
                    onClick={() => handleJumpToFutures(selectedSymbol, true)}
                    className="px-2 h-[18px] bg-[#ff8800] hover:bg-[#ff991a] text-[#090c10] font-bold text-[10px] rounded-[2px]"
                  >
                    送入T+0杠杆回测
                  </button>
                }
              />

              {selectedFuturesQuote && (
                <div className="px-2.5 py-1 bg-[#11151d] border-b border-[#232a36] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums shrink-0">
                  <div className="flex items-center gap-3">
                    <span className={`font-bold text-xs ${dirColorClass(selectedFuturesQuote.changePct)}`}>
                      {fmtNum(selectedFuturesQuote.price, 2)} ({fmtPct(selectedFuturesQuote.changePct)})
                    </span>
                    <span className="text-[#8b95a5]">
                      开:<strong className="text-[#dfe6f0] ml-0.5">{fmtNum(selectedFuturesQuote.open, 2)}</strong>
                    </span>
                    <span className="text-[#8b95a5]">
                      高:<strong className="text-[#ff3535] ml-0.5">{fmtNum(selectedFuturesQuote.high, 2)}</strong>
                    </span>
                    <span className="text-[#8b95a5]">
                      低:<strong className="text-[#00c853] ml-0.5">{fmtNum(selectedFuturesQuote.low, 2)}</strong>
                    </span>
                    <span className="text-[#8b95a5]">
                      昨结:<strong className="text-[#dfe6f0] ml-0.5">{fmtNum(selectedFuturesQuote.prevSettle, 2)}</strong>
                    </span>
                    <span className="text-[#8b95a5]">
                      持仓:<strong className="text-[#f0b90b] ml-0.5">{fmtCompact(selectedFuturesQuote.openInterest)}</strong>
                    </span>
                  </div>
                  {selectedFuturesQuote.strategyAdvice && (
                    <span className="text-[#e5b567] truncate max-w-xs" title={selectedFuturesQuote.strategyAdvice}>
                      {selectedFuturesQuote.strategyAdvice}
                    </span>
                  )}
                </div>
              )}

              {klineError && <div className="px-2.5 py-1 text-xs text-[#ff3535]">{klineError}</div>}

              <div className="relative flex-1 min-h-0">
                {klineLoading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0d1015]/80 text-xs text-[#ff9500]">
                    正在加载 {selectedSymbol} K线数据...
                  </div>
                )}
                <div ref={futuresChartRef} className="w-full h-full" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== [03] PANDAAI LOCAL FACTOR VAULT & CROSS-SECTION SCANNER ==================== */}
      {activeTab === 'factors' && (
        <div className="flex-1 min-h-0 grid grid-cols-12 gap-[1px] bg-[#232a36]">
          {/* Left Pane: Dense Factor Matrix */}
          <div className="col-span-12 lg:col-span-5 bg-[#0e1117] flex flex-col min-h-0">
            <PaneHeader title={`PandaAI 本地因子实证库 (${filteredFactors.length})`} right="点击行运行实盘扫描" />

            {/* Filter & Search Bar */}
            <div className="bg-[#11151d] border-b border-[#232a36] px-2 py-1.5 flex flex-wrap items-center justify-between gap-1.5 shrink-0">
              <div className="flex flex-wrap items-center gap-1">
                {POOL_FILTERS.map((pf) => (
                  <button
                    key={pf}
                    onClick={() => setPoolFilter(pf)}
                    className={`px-1.5 h-[20px] text-[11px] border rounded-[2px] transition-colors ${
                      poolFilter === pf
                        ? 'bg-[#261d0d] text-[#ff9500] border-[#ff8800]'
                        : 'bg-[#0e1117] text-[#8b95a5] border-[#252c38] hover:text-[#dfe6f0]'
                    }`}
                  >
                    {pf}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="w-3 h-3 text-[#7d8796] absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  value={factorSearch}
                  onChange={(e) => setFactorSearch(e.target.value)}
                  placeholder="搜因子/AST/源码..."
                  className="pl-6 pr-2 h-[22px] w-40 bg-[#090c10] border border-[#252c38] focus:border-[#ff8800] outline-none text-[11px] text-[#dfe6f0] rounded-[2px]"
                />
              </div>
            </div>

            {/* Sortable Factor Table */}
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead className="sticky top-0 z-10 bg-[#151a23] text-[#8b95a5] border-b border-[#252c38]">
                  <tr className="h-[26px] text-[11px]">
                    <th className="px-2 text-left font-medium w-7">#</th>
                    <th className="px-2 text-left font-medium">因子名称 / 池</th>
                    <th className="px-2 text-center font-medium w-10">方向</th>
                    <th
                      onClick={() => toggleFactorSort('sharpe')}
                      className="px-2 text-right font-medium cursor-pointer hover:text-[#ff9500] select-none"
                    >
                      Sharpe{factorSort === 'sharpe' ? (factorSortAsc ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => toggleFactorSort('rankIc')}
                      className="px-2 text-right font-medium cursor-pointer hover:text-[#ff9500] select-none"
                    >
                      RankIC{factorSort === 'rankIc' ? (factorSortAsc ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => toggleFactorSort('ir')}
                      className="px-2 text-right font-medium cursor-pointer hover:text-[#ff9500] select-none"
                    >
                      IR{factorSort === 'ir' ? (factorSortAsc ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => toggleFactorSort('turnover')}
                      className="px-2 text-right font-medium cursor-pointer hover:text-[#ff9500] select-none"
                    >
                      换手{factorSort === 'turnover' ? (factorSortAsc ? '↑' : '↓') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFactors.map((f, idx) => {
                    const isSelected = selectedFactor?.id === f.id;
                    const isRev =
                      f.direction === -1 || String(f.direction).includes('空') || String(f.direction).includes('反');
                    return (
                      <tr
                        key={f.id}
                        onClick={() => setSelectedFactorId(f.id)}
                        className={`h-[26px] border-b border-[#181d26] cursor-pointer tabular-nums ${
                          isSelected ? 'bg-[#1f293b]' : 'even:bg-[#11151d] hover:bg-[#1b2434]'
                        }`}
                      >
                        <td className="px-2 font-mono text-[#7d8796]">{idx + 1}</td>
                        <td className="px-2 max-w-[190px]">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className={`font-medium truncate ${isSelected ? 'text-[#ff9500]' : 'text-[#e8edf5]'}`}>
                              {f.name}
                            </span>
                            {f.pool && (
                              <span className="px-1 text-[10px] bg-[#161b24] border border-[#2c3647] text-[#4da3ff] shrink-0 rounded-[2px]">
                                {f.pool}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 text-center">
                          <span className={`text-[11px] font-medium ${isRev ? 'text-[#00c853]' : 'text-[#ff3535]'}`}>
                            {isRev ? '反向' : '正向'}
                          </span>
                        </td>
                        <td className="px-2 text-right font-mono font-bold text-[#f0b90b]">{fmtNum(f.sharpe, 2)}</td>
                        <td className="px-2 text-right font-mono text-[#ff3535]">{fmtNum(f.rankIc ?? f.ic, 4)}</td>
                        <td className="px-2 text-right font-mono text-[#4da3ff]">{fmtNum(f.ir, 3)}</td>
                        <td className="px-2 text-right font-mono text-[#8b95a5]">{fmtNum(f.turnover, 2)}</td>
                      </tr>
                    );
                  })}
                  {filteredFactors.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-xs text-[#7d8796]">
                        {overviewLoading ? '正在加载本地因子库...' : '无匹配因子'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Pane: AST Formula + Z-Score Chart + Target Table */}
          <div className="col-span-12 lg:col-span-7 bg-[#232a36] flex flex-col gap-[1px] min-h-0">
            {selectedFactor ? (
              <>
                <div className="bg-[#0e1117] shrink-0">
                  <PaneHeader
                    title={`${selectedFactor.name} [${selectedFactor.pool || selectedFactor.category || 'ALPHA'}]`}
                    right={
                      <div className="flex items-center gap-2">
                        {selectedFactor.sourceFile && (
                          <span className="font-mono text-[#e5b567] max-w-[240px] truncate" title={selectedFactor.sourceFile}>
                            {selectedFactor.sourceFile}
                          </span>
                        )}
                        <button
                          onClick={handleCopyExpr}
                          className="inline-flex items-center gap-1 px-1.5 h-[18px] bg-[#11151d] border border-[#2b3444] hover:border-[#ff8800] text-[#dfe6f0] text-[10px] rounded-[2px]"
                        >
                          {copiedExpr ? <Check className="w-2.5 h-2.5 text-[#00c853]" /> : <Copy className="w-2.5 h-2.5" />}
                          {copiedExpr ? '已复制' : '复制AST'}
                        </button>
                      </div>
                    }
                  />

                  <div className="grid grid-cols-6 divide-x divide-[#232a36] border-b border-[#232a36] bg-[#11151d] text-[11px] font-mono tabular-nums">
                    <div className="px-2 py-1 flex items-center justify-between">
                      <span className="text-[#7d8796]">Sharpe</span>
                      <span className="text-[#f0b90b] font-bold">{fmtNum(selectedFactor.sharpe, 3)}</span>
                    </div>
                    <div className="px-2 py-1 flex items-center justify-between">
                      <span className="text-[#7d8796]">IC</span>
                      <span className="text-[#ff3535]">{fmtNum(selectedFactor.ic, 4)}</span>
                    </div>
                    <div className="px-2 py-1 flex items-center justify-between">
                      <span className="text-[#7d8796]">RankIC</span>
                      <span className="text-[#ff3535] font-bold">{fmtNum(selectedFactor.rankIc, 4)}</span>
                    </div>
                    <div className="px-2 py-1 flex items-center justify-between">
                      <span className="text-[#7d8796]">IR</span>
                      <span className="text-[#4da3ff]">{fmtNum(selectedFactor.ir, 3)}</span>
                    </div>
                    <div className="px-2 py-1 flex items-center justify-between">
                      <span className="text-[#7d8796]">换手</span>
                      <span className="text-[#dfe6f0]">{fmtNum(selectedFactor.turnover, 3)}</span>
                    </div>
                    <div className="px-2 py-1 flex items-center justify-between">
                      <span className="text-[#7d8796]">Fitness</span>
                      <span className="text-[#00c853]">{fmtNum(selectedFactor.fitness, 2)}</span>
                    </div>
                  </div>

                  <div className="px-2.5 py-1.5 bg-[#090c10] border-b border-[#232a36] font-mono text-[11px] max-h-20 overflow-y-auto">
                    {renderHighlightedExpression(selectedFactor.expression || '# 暂无表达式')}
                  </div>

                  <div className="px-2.5 py-1 bg-[#131822] border-b border-[#232a36] flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] text-[#8b95a5] truncate max-w-md" title={selectedFactor.description}>
                      {selectedFactor.description || '量化多因子截面打分信号'}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="inline-flex border border-[#252c38] bg-[#090c10] rounded-[2px]">
                        <button
                          onClick={() => setScanUniverse('ashare')}
                          className={`px-2 h-[22px] text-[11px] ${
                            scanUniverse === 'ashare'
                              ? 'bg-[#2a1215] text-[#ff3535] font-bold'
                              : 'text-[#8b95a5] hover:text-[#dfe6f0]'
                          }`}
                        >
                          A股实盘扫描
                        </button>
                        <button
                          onClick={() => setScanUniverse('futures')}
                          className={`px-2 h-[22px] text-[11px] border-l border-[#252c38] ${
                            scanUniverse === 'futures'
                              ? 'bg-[#112233] text-[#4da3ff] font-bold'
                              : 'text-[#8b95a5] hover:text-[#dfe6f0]'
                          }`}
                        >
                          28期货扫描
                        </button>
                      </div>

                      <select
                        value={scanTopN}
                        onChange={(e) => setScanTopN(Number(e.target.value))}
                        className="h-[22px] px-1.5 bg-[#090c10] border border-[#252c38] text-[11px] font-mono text-[#dfe6f0] outline-none rounded-[2px]"
                      >
                        <option value={10}>Top10</option>
                        <option value={20}>Top20</option>
                        <option value={30}>Top30</option>
                      </select>

                      <button
                        onClick={() => runFactorScan(selectedFactor.id, scanUniverse, scanTopN)}
                        disabled={scanLoading}
                        className="inline-flex items-center gap-1 px-2.5 h-[22px] bg-[#ff8800] hover:bg-[#ff991a] text-[#090c10] font-bold text-[11px] rounded-[2px] disabled:opacity-50"
                      >
                        {scanLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
                        执行选股打分
                      </button>
                    </div>
                  </div>
                </div>

                {/* Middle Sub-Pane: Z-Score Chart */}
                <div className="bg-[#0d1015] h-[176px] flex flex-col shrink-0">
                  <PaneHeader
                    title={`截面 Z-Score 分布 (${scanUniverse === 'ashare' ? '沪深A股' : '国内28期货'})`}
                    right={
                      scanResult?.stats && (
                        <div className="flex items-center gap-2.5 font-mono tabular-nums text-[11px]">
                          <span>Mean:{fmtNum(scanResult.stats.mean, 3)}</span>
                          <span>Std:{fmtNum(scanResult.stats.std, 3)}</span>
                          <span className={dirColorClass(scanResult.stats.longTopAvgPct)}>
                            Top:{fmtPct(scanResult.stats.longTopAvgPct)}
                          </span>
                          <span className={dirColorClass(scanResult.stats.shortBottomAvgPct)}>
                            Bot:{fmtPct(scanResult.stats.shortBottomAvgPct)}
                          </span>
                          <span className="text-[#f0b90b] font-bold">Spread:{fmtPct(scanResult.stats.spreadPct)}</span>
                        </div>
                      )
                    }
                  />
                  {scanError ? (
                    <div className="p-2 text-xs text-[#ff3535]">{scanError}</div>
                  ) : (
                    <div ref={factorChartRef} className="w-full flex-1 min-h-0" />
                  )}
                </div>

                {/* Bottom Sub-Pane: Scanned Targets Table */}
                <div className="bg-[#0e1117] flex-1 min-h-0 flex flex-col">
                  <PaneHeader
                    title={`因子实时排名明细 (${scanResult?.targets?.length ?? 0})`}
                    right={scanUniverse === 'ashare' ? '单击行打开F5分时K线' : '单击行联动期货K线'}
                  />
                  <div className="flex-1 min-h-0 overflow-auto">
                    <table className="w-full text-[12px] border-collapse">
                      <thead className="sticky top-0 z-10 bg-[#151a23] text-[#8b95a5] border-b border-[#252c38]">
                        <tr className="h-[26px] text-[11px]">
                          <th className="px-2 text-left font-medium w-8">#</th>
                          <th className="px-2 text-left font-medium">代码</th>
                          <th className="px-2 text-left font-medium">名称</th>
                          <th className="px-2 text-right font-medium">现价</th>
                          <th className="px-2 text-right font-medium">涨跌幅%</th>
                          <th className="px-2 text-right font-medium">因子值</th>
                          <th className="px-2 text-right font-medium">Z-Score</th>
                          <th className="px-2 text-center font-medium">信号</th>
                          <th className="px-2 text-left font-medium">归因逻辑</th>
                          <th className="px-2 text-center font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(scanResult?.targets ?? []).map((t, idx) => {
                          const z = safeNum(t.zScore, 0);
                          const chg = safeNum(t.changePct, 0);
                          const orderKey = `scan:${scanUniverse}:${t.code}`;
                          return (
                            <tr
                              key={`${t.code}-${idx}`}
                              onClick={() => {
                                if (scanUniverse === 'ashare') {
                                  onSelectStock(t.code, t.name);
                                } else {
                                  handleJumpToFutures(t.code, false);
                                }
                              }}
                              className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434] cursor-pointer tabular-nums"
                            >
                              <td className="px-2 font-mono text-[#7d8796]">{idx + 1}</td>
                              <td className="px-2 font-mono text-[#e5b567] font-semibold">{t.code}</td>
                              <td className="px-2 text-[#e8edf5] font-medium whitespace-nowrap">{t.name}</td>
                              <td className="px-2 text-right font-mono text-[#dfe6f0]">{fmtNum(t.price, 2)}</td>
                              <td className={`px-2 text-right font-mono font-bold ${dirColorClass(chg)}`}>{fmtPct(chg)}</td>
                              <td className="px-2 text-right font-mono text-[#8b95a5]">{fmtNum(t.factorValue, 4)}</td>
                              <td className={`px-2 text-right font-mono font-bold ${z >= 0 ? 'text-[#ff3535]' : 'text-[#00c853]'}`}>
                                {z > 0 ? '+' : ''}
                                {fmtNum(z, 2)}
                              </td>
                              <td className="px-2 text-center">
                                <span className={`px-1.5 py-0.5 text-[10px] border rounded-[2px] ${signalTagClass(t.signal)}`}>
                                  {t.signal || (z >= 0 ? '多头' : '空头')}
                                </span>
                              </td>
                              <td className="px-2 text-[11px] text-[#8b95a5] max-w-[220px] truncate" title={t.reason}>
                                {t.reason || '-'}
                              </td>
                              <td className="px-2 text-center whitespace-nowrap">
                                <button
                                  type="button"
                                  disabled={paperOrderBusyKey === orderKey}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    sendToPaperDesk({
                                      key: orderKey,
                                      symbol: t.code,
                                      name: t.name,
                                      market: scanUniverse === 'futures' ? 'futures' : 'ashare',
                                      directionSign: z >= 0 ? 1 : -1,
                                      price: safeNum(t.price, 0) > 0 ? safeNum(t.price, 0) : undefined,
                                      strategyTag: scanResult?.factor?.name || 'PandaAI因子扫描',
                                      note: `${t.signal || (z >= 0 ? '多头' : '空头')} Z=${fmtNum(z, 2)} ${t.reason || ''}`.trim(),
                                    });
                                  }}
                                  className="px-1.5 h-[18px] bg-[#161b24] border border-[#00c853] text-[#4ade80] hover:bg-[#00c853] hover:text-[#090c10] disabled:opacity-50 text-[10px] font-bold rounded-[2px]"
                                >
                                  {paperOrderBusyKey === orderKey ? '发送中' : '转入模拟实盘舱'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {!scanLoading && !(scanResult?.targets?.length) && (
                          <tr>
                            <td colSpan={10} className="py-8 text-center text-xs text-[#7d8796]">
                              点击「执行选股打分」生成最新截面信号
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-[#0e1117] flex-1 flex items-center justify-center text-xs text-[#7d8796]">
                请从左侧选择因子
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== [04] FUTURES T+0 BIDIRECTIONAL LEVERAGED BACKTEST & ARBITRAGE ==================== */}
      {activeTab === 'futures-bt' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#232a36]">
          <div className="bg-[#0e1117] shrink-0">
            <PaneHeader title="期货 T+0 双向杠杆与跨期套利回测配置">
              <div className="flex items-center gap-1 ml-2 overflow-x-auto">
                {QUICK_FUTURES.map((qf) => (
                  <button
                    key={qf.symbol}
                    onClick={() => {
                      setBtSymbol(qf.symbol);
                      runFuturesBacktest(qf.symbol);
                    }}
                    className={`px-1.5 h-[18px] text-[10px] font-mono border rounded-[2px] whitespace-nowrap ${
                      btSymbol === qf.symbol
                        ? 'bg-[#261d0d] text-[#ff9500] border-[#ff8800]'
                        : 'bg-[#0e1117] text-[#8b95a5] border-[#252c38] hover:text-[#dfe6f0]'
                    }`}
                  >
                    {qf.label}
                  </button>
                ))}
              </div>
            </PaneHeader>

            <div className="px-2.5 py-1.5 bg-[#11151d] border-b border-[#232a36] flex flex-wrap items-center gap-2.5 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#8b95a5]">合约</span>
                <select
                  value={btSymbol}
                  onChange={(e) => setBtSymbol(e.target.value)}
                  className="h-[24px] px-2 bg-[#090c10] border border-[#252c38] text-xs text-[#e5b567] font-mono outline-none rounded-[2px]"
                >
                  {(futuresQuotes.length ? futuresQuotes : QUICK_FUTURES.map((q) => ({ symbol: q.symbol, name: q.label }))).map(
                    (f) => (
                      <option key={f.symbol} value={f.symbol}>
                        {f.name} ({f.symbol})
                      </option>
                    )
                  )}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#8b95a5]">策略</span>
                <select
                  value={btStrategy}
                  onChange={(e) => setBtStrategy(e.target.value)}
                  className="h-[24px] px-2 bg-[#090c10] border border-[#252c38] text-xs text-[#dfe6f0] outline-none rounded-[2px]"
                >
                  {FUTURES_STRATEGIES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} [{s.tag}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#8b95a5]">周期</span>
                <select
                  value={btDays}
                  onChange={(e) => setBtDays(Number(e.target.value))}
                  className="h-[24px] px-2 bg-[#090c10] border border-[#252c38] text-xs font-mono text-[#dfe6f0] outline-none rounded-[2px]"
                >
                  <option value={60}>60日</option>
                  <option value={120}>120日</option>
                  <option value={250}>250日</option>
                  <option value={500}>500日</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#8b95a5]">杠杆</span>
                <select
                  value={btLeverage}
                  onChange={(e) => setBtLeverage(Number(e.target.value))}
                  className="h-[24px] px-2 bg-[#090c10] border border-[#252c38] text-xs font-mono text-[#f0b90b] font-bold outline-none rounded-[2px]"
                >
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((lv) => (
                    <option key={lv} value={lv}>
                      {lv}x
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#8b95a5]">止损%</span>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={btStopLoss}
                  onChange={(e) => setBtStopLoss(Math.max(1, Number(e.target.value) || 5))}
                  className="w-12 h-[24px] px-1.5 bg-[#090c10] border border-[#252c38] text-xs font-mono text-[#ff3535] text-center outline-none rounded-[2px]"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#8b95a5]">本金</span>
                <input
                  type="number"
                  step={100000}
                  min={50000}
                  value={btCapital}
                  onChange={(e) => setBtCapital(Math.max(50000, Number(e.target.value) || 1000000))}
                  className="w-24 h-[24px] px-2 bg-[#090c10] border border-[#252c38] text-xs font-mono text-[#dfe6f0] outline-none rounded-[2px]"
                />
              </div>

              <button
                onClick={() => runFuturesBacktest()}
                disabled={btLoading}
                className="inline-flex items-center gap-1 px-3 h-[24px] bg-[#ff8800] hover:bg-[#ff991a] text-[#090c10] font-bold text-xs rounded-[2px] disabled:opacity-50"
              >
                {btLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
                执行T+0回测
              </button>

              <span className="text-[11px] text-[#7d8796] truncate">
                {FUTURES_STRATEGIES.find((s) => s.id === btStrategy)?.desc}
              </span>
            </div>

            {btError && (
              <div className="px-2.5 py-1 bg-[#2a1215] text-xs text-[#ff3535] border-b border-[#5c1d22]">{btError}</div>
            )}

            <div className="grid grid-cols-3 lg:grid-cols-6 divide-x divide-[#232a36] bg-[#0e1117] text-xs font-mono tabular-nums">
              <div className="px-3 py-1.5 flex items-center justify-between">
                <span className="text-[#7d8796]">总收益率</span>
                <span className={`font-bold ${dirColorClass(btResult?.metrics?.totalReturnPct)}`}>
                  {fmtPct(btResult?.metrics?.totalReturnPct)}
                </span>
              </div>
              <div className="px-3 py-1.5 flex items-center justify-between">
                <span className="text-[#7d8796]">年化收益</span>
                <span className={`font-bold ${dirColorClass(btResult?.metrics?.annualReturnPct)}`}>
                  {fmtPct(btResult?.metrics?.annualReturnPct)}
                </span>
              </div>
              <div className="px-3 py-1.5 flex items-center justify-between">
                <span className="text-[#7d8796]">最大回撤</span>
                <span className="text-[#00c853] font-bold">{fmtNum(btResult?.metrics?.maxDrawdownPct, 2)}%</span>
              </div>
              <div className="px-3 py-1.5 flex items-center justify-between">
                <span className="text-[#7d8796]">夏普比率</span>
                <span className="text-[#f0b90b] font-bold">{fmtNum(btResult?.metrics?.sharpe, 2)}</span>
              </div>
              <div className="px-3 py-1.5 flex items-center justify-between">
                <span className="text-[#7d8796]">胜率/盈亏比</span>
                <span className="text-[#4da3ff] font-bold">
                  {fmtNum(btResult?.metrics?.winRatePct, 1)}% / {fmtNum(btResult?.metrics?.profitFactor, 2)}
                </span>
              </div>
              <div className="px-3 py-1.5 flex items-center justify-between">
                <span className="text-[#7d8796]">双向成交</span>
                <span className="text-[#dfe6f0] font-bold">
                  {btResult?.metrics?.tradeCount ?? btResult?.trades?.length ?? 0} 笔
                </span>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-12 gap-[1px] bg-[#232a36]">
            <div className="col-span-12 lg:col-span-7 bg-[#0d1015] flex flex-col min-h-0">
              <PaneHeader
                title={`资金净值曲线 vs 标的基准 & 水下回撤 (${btSymbol} · ${btLeverage}x)`}
                right={btLoading ? '计算中...' : '日频多空净值'}
              />
              <div ref={btChartRef} className="w-full flex-1 min-h-0" />
            </div>

            <div className="col-span-12 lg:col-span-5 bg-[#0e1117] flex flex-col min-h-0">
              <PaneHeader
                title={`做多 / 做空 双向交割流水 (${btResult?.trades?.length ?? 0} 笔)`}
                right="单位: RMB"
              />
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead className="sticky top-0 z-10 bg-[#151a23] text-[#8b95a5] border-b border-[#252c38]">
                    <tr className="h-[26px] text-[11px]">
                      <th className="px-2 text-left font-medium">开仓日</th>
                      <th className="px-2 text-left font-medium">平仓日</th>
                      <th className="px-2 text-center font-medium">方向</th>
                      <th className="px-2 text-right font-medium">开/平价</th>
                      <th className="px-2 text-right font-medium">手</th>
                      <th className="px-2 text-right font-medium">净盈亏</th>
                      <th className="px-2 text-right font-medium">收益%</th>
                      <th className="px-2 text-left font-medium">原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(btResult?.trades ?? []).map((tr, ti) => {
                      const long = isLongDirection(tr.side);
                      return (
                        <tr
                          key={ti}
                          className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434] tabular-nums"
                        >
                          <td className="px-2 font-mono text-[11px] text-[#8b95a5] whitespace-nowrap">{tr.entryDate}</td>
                          <td className="px-2 font-mono text-[11px] text-[#8b95a5] whitespace-nowrap">{tr.exitDate}</td>
                          <td className="px-2 text-center">
                            <span
                              className={`px-1.5 py-0.5 text-[10px] border rounded-[2px] ${
                                long
                                  ? 'bg-[#2a1215] text-[#ff3535] border-[#5c1d22]'
                                  : 'bg-[#0d261a] text-[#00c853] border-[#194d33]'
                              }`}
                            >
                              {tr.side}
                            </span>
                          </td>
                          <td className="px-2 text-right font-mono text-[11px] text-[#dfe6f0] whitespace-nowrap">
                            {fmtNum(tr.entryPrice, 1)}→{fmtNum(tr.exitPrice, 1)}
                          </td>
                          <td className="px-2 text-right font-mono text-[#8b95a5]">{tr.lots ?? '-'}</td>
                          <td className={`px-2 text-right font-mono font-bold ${dirColorClass(tr.pnl)}`}>
                            {tr.pnl > 0 ? '+' : ''}
                            {fmtNum(tr.pnl, 0)}
                          </td>
                          <td className={`px-2 text-right font-mono font-bold ${dirColorClass(tr.returnPct)}`}>
                            {fmtPct(tr.returnPct)}
                          </td>
                          <td className="px-2 text-[11px] text-[#8b95a5] max-w-[110px] truncate" title={tr.reason}>
                            {tr.reason || '-'}
                          </td>
                        </tr>
                      );
                    })}
                    {!(btResult?.trades?.length) && (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-xs text-[#7d8796]">
                          暂无交割记录
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== [05] ACCOUNT 5091 & 24H AUTONOMY LOGS ==================== */}
      {activeTab === 'autonomy' && (
        <div className="flex-1 min-h-0 grid grid-cols-12 gap-[1px] bg-[#232a36]">
          <div className="col-span-12 lg:col-span-4 bg-[#0e1117] flex flex-col min-h-0">
            <PaneHeader title={`账户5091与24h自治文档 (${filteredLogs.length})`} />

            <div className="bg-[#11151d] border-b border-[#232a36] p-1.5 space-y-1.5 shrink-0">
              <div className="flex flex-wrap gap-1">
                {LOG_FOLDERS.map((folder) => (
                  <button
                    key={folder}
                    onClick={() => setLogFolderFilter(folder)}
                    className={`px-1.5 h-[20px] text-[10px] border rounded-[2px] ${
                      logFolderFilter === folder
                        ? 'bg-[#261d0d] text-[#ff9500] border-[#ff8800]'
                        : 'bg-[#0e1117] text-[#8b95a5] border-[#252c38] hover:text-[#dfe6f0]'
                    }`}
                  >
                    {folder}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="w-3 h-3 text-[#7d8796] absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="检索实盘复盘 / 错题本 / PM推演..."
                  className="pl-6 pr-2 h-[22px] w-full bg-[#090c10] border border-[#252c38] focus:border-[#ff8800] outline-none text-[11px] text-[#dfe6f0] rounded-[2px]"
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead className="sticky top-0 z-10 bg-[#151a23] text-[#8b95a5] border-b border-[#252c38]">
                  <tr className="h-[26px] text-[11px]">
                    <th className="px-2 text-left font-medium">分类</th>
                    <th className="px-2 text-left font-medium">文档标题</th>
                    <th className="px-2 text-right font-medium">更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log) => {
                    const active = selectedLog?.id === log.id;
                    return (
                      <tr
                        key={log.id}
                        onClick={() => setSelectedLogId(log.id)}
                        className={`h-[26px] border-b border-[#181d26] cursor-pointer ${
                          active ? 'bg-[#1f293b]' : 'even:bg-[#11151d] hover:bg-[#1b2434]'
                        }`}
                      >
                        <td className="px-2 text-[10px] text-[#4da3ff] whitespace-nowrap max-w-[90px] truncate">
                          {log.folder || '日志'}
                        </td>
                        <td
                          className={`px-2 font-medium max-w-[180px] truncate ${
                            active ? 'text-[#ff9500]' : 'text-[#e8edf5]'
                          }`}
                        >
                          {log.title}
                        </td>
                        <td className="px-2 text-right font-mono text-[10px] text-[#7d8796] whitespace-nowrap">
                          {log.updatedAt || '-'}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredLogs.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-xs text-[#7d8796]">
                        无匹配文档
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-8 bg-[#0e1117] flex flex-col min-h-0">
            <PaneHeader
              title={selectedLog ? selectedLog.title : '复盘文档正文'}
              right={selectedLog?.updatedAt ? `更新: ${selectedLog.updatedAt}` : undefined}
            />
            <div className="flex-1 min-h-0 overflow-auto p-3">
              {selectedLog ? (
                <div className="space-y-2.5">
                  {selectedLog.summary && (
                    <div className="px-2.5 py-1.5 bg-[#11151d] border border-[#232a36] border-l-2 border-l-[#4da3ff] text-xs text-[#cfd8e3]">
                      <span className="text-[#4da3ff] font-bold mr-1.5">摘要:</span>
                      {selectedLog.summary}
                    </div>
                  )}
                  <WindNoteViewer content={selectedLog.content || selectedLog.summary || '暂无正文'} />
                </div>
              ) : (
                <div className="py-16 text-center text-xs text-[#7d8796]">请从左侧选择复盘笔记</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
