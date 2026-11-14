import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  Database,
  ExternalLink,
  FileText,
  Filter,
  Layers,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';
import { api } from '../api/client';
import type {
  AssetFactBuyPointProfile,
  AssetFactDetailResponse,
  FactArchetypeCategory,
  FactBuyPointBacktestResponse,
  FactBuyPointOverviewResponse,
  FupengBarbellBacktestResponse,
  FupengIntelItem,
  FupengMacroPillar,
  FupengOverviewResponse,
  FupengReferenceTarget,
  FupengTradableBasket,
  HistoricalFactEpisode,
} from '../types/market';

export interface FactFupengPageProps {
  onSelectStock: (code: string, name?: string) => void;
  onNavigate?: (tab: string) => void;
}

type SubTabId = 'fact-retro' | 'fupeng-ficc' | 'fupeng-24h' | 'threshold-lab';

const SUB_TABS: { id: SubTabId; label: string }[] = [
  { id: 'fact-retro', label: '[01] 多标的专属事实因子 · 历史预测大复盘与确定性买点' },
  { id: 'fupeng-ficc', label: '[02] 付鹏全球宏观 FICC 框架 · 杠铃策略与专属标的参考' },
  { id: 'fupeng-24h', label: '[03] 付鹏老师 24小时全网动态实时抓取流 & 观点映射解析' },
  { id: 'threshold-lab', label: '[04] 确定买点阈值实验室 · 18标的横向审计与模拟联动' },
];

const ARCHETYPE_FILTERS: { id: FactArchetypeCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'precious_rates', label: '贵金属利率' },
  { id: 'energy_shipping', label: '能源航运咽喉' },
  { id: 'ai_optics', label: 'AI光通信硬件' },
  { id: 'grid_storage', label: '电网储能' },
  { id: 'dividend_bond', label: '红利长债' },
];

const FUPENG_PILLARS: FupengMacroPillar[] = [
  '哑铃左端·长债红利防御',
  '哑铃右端·AI生产力与出海硬瓶颈',
  '逆全球化·黄金硬通货重估',
  'FICC套息拆仓与波动率冲击',
  '大宗商品·Back现实缺口vs过剩内卷',
  '居民资产负债表与地产周期',
];

const SAMPLE_FUPENG_NOTES: { label: string; title: string; content: string }[] = [
  {
    label: '示例: 逆全球化与黄金定价重估',
    title: '付鹏宏观闭门纪要：黄金脱离实际利率单锚与哑铃两端配置',
    content:
      '逆全球化与主权信用重估下，黄金已脱离美债实际利率单一锚定价，央行购金与地缘秩序重构使黄金成为组合必备硬通货底仓(AU0/山东黄金/紫金矿业)。国内有效需求不足与低利率资产荒背景下，继续维持哑铃左端长久期国债(TL0)与垄断高股息现金流(长江电力/中国神华)防御底仓；右端只跟踪全球AI生产力奇点与北美缺电电网出海硬瓶颈，但需严防高拥挤度回撤。',
  },
  {
    label: '示例: 日元Carry拆仓与AI拥挤排雷',
    title: '付鹏点评美股科技拥挤度与商品Back结构现实主义',
    content:
      '当美日利差收敛触发套息Carry Trade拆仓时，高拥挤度的AI算力科技板块会出现剧烈去杠杆波动率冲击，此时必须用期指(IC0/IM0)做尾部保护并收缩右端仓位；大宗商品不要交易远期Contango预期幻觉，只做现货近月强Back升水现实缺口(EC0欧线/SC0原油)，坚决规避地产黑色链条(RB0/FG0/I0)的过剩内卷。',
  },
];

function safeNum(val: unknown, fallback = 0): number {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function fmtNum(val: unknown, digits = 2): string {
  const n = safeNum(val, NaN);
  if (Number.isNaN(n)) return '--';
  return n.toFixed(digits);
}

function fmtPct(val: unknown, digits = 2): string {
  const n = safeNum(val, NaN);
  if (Number.isNaN(n)) return '--';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtSigned(val: unknown, digits = 2): string {
  const n = safeNum(val, NaN);
  if (Number.isNaN(n)) return '--';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}`;
}

function colorUpDown(val: unknown): string {
  const n = safeNum(val, 0);
  if (n > 0) return 'text-[#ff3535]';
  if (n < 0) return 'text-[#00c853]';
  return 'text-[#cfd8e3]';
}

function shortTime(iso?: string | null): string {
  if (!iso) return '--';
  return String(iso).replace('T', ' ').replace('Z', '').slice(0, 19);
}

function isFuturesCode(symbol: string): boolean {
  const clean = symbol.split(/[\/,\s]+/)[0].trim().toUpperCase();
  if (/^\d{6}$/.test(clean)) return false;
  return /^(IC|IM|IF|IH|AU|AG|SC|EC|LC|CU|RB|I|MA|TA|SI|M|TL|T|FG|JM|J|ZC|FU|BU|RU|SP|AL|ZN|NI|SN|SS)\d*$/.test(
    clean
  );
}

function PaneHeader({
  title,
  badge,
  right,
}: {
  title: string;
  badge?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="h-[26px] bg-[#161b24] border-b border-[#222832] px-2.5 flex items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-[2px] h-3 bg-[#ff8800] shrink-0" />
        <span className="text-[12px] font-bold text-[#dfe6f0] truncate">{title}</span>
        {badge && (
          <span className="px-1.5 py-0.5 text-[10px] bg-[#0e1117] border border-[#222832] text-[#e5b567] tabular-nums shrink-0">
            {badge}
          </span>
        )}
      </div>
      {right && <div className="flex items-center gap-1.5 text-[11px] text-[#8b95a5] shrink-0">{right}</div>}
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'up' | 'down' | 'orange' | 'gold' | 'blue' | 'neutral';
}) {
  const valueClass =
    tone === 'up'
      ? 'text-[#ff3535]'
      : tone === 'down'
      ? 'text-[#00c853]'
      : tone === 'orange'
      ? 'text-[#ff8800]'
      : tone === 'gold'
      ? 'text-[#f0b90b]'
      : tone === 'blue'
      ? 'text-[#4da3ff]'
      : 'text-[#dfe6f0]';

  return (
    <div className="bg-[#0e1117] px-2.5 py-1.5 flex flex-col justify-between min-w-0">
      <div className="text-[10px] text-[#7d8796] truncate">{label}</div>
      <div className={`text-[13px] font-bold tabular-nums leading-tight mt-0.5 truncate ${valueClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-[#6d7787] tabular-nums truncate mt-0.5">{sub}</div>}
    </div>
  );
}

function readinessColorClass(count: number): string {
  if (count >= 4) return 'text-[#ff8800] font-bold';
  if (count === 3) return 'text-[#f0b90b] font-semibold';
  return 'text-[#8b95a5]';
}

function buyPointBadgeClass(state: AssetFactBuyPointProfile['buyPointState']): string {
  if (state.includes('4/4')) return 'bg-[#2a1706] border-[#ff8800] text-[#ff8800]';
  if (state.includes('3/4')) return 'bg-[#211c08] border-[#f0b90b] text-[#f0b90b]';
  if (state.includes('2/4')) return 'bg-[#121926] border-[#2e4366] text-[#4da3ff]';
  return 'bg-[#12151c] border-[#252c38] text-[#7d8796]';
}

function stanceBadgeClass(stance: FupengIntelItem['stance']): string {
  if (stance === '看多配置') return 'bg-[#261114] border-[#ff3535] text-[#ff3535]';
  if (stance === '超配防御') return 'bg-[#241809] border-[#ff8800] text-[#ff8800]';
  if (stance === '警惕拥挤去杠杆') return 'bg-[#241e09] border-[#f0b90b] text-[#f0b90b]';
  return 'bg-[#0c2116] border-[#00c853] text-[#00c853]';
}

function regimeFitBadgeClass(fit: FupengTradableBasket['currentRegimeFit']): string {
  if (fit.includes('强烈契合')) return 'bg-[#261114] border-[#ff3535] text-[#ff3535]';
  if (fit.includes('标准底仓')) return 'bg-[#241809] border-[#ff8800] text-[#ff8800]';
  if (fit.includes('收缩防守')) return 'bg-[#241e09] border-[#f0b90b] text-[#f0b90b]';
  return 'bg-[#0c2116] border-[#00c853] text-[#00c853]';
}

export default function FactFupengPage({ onSelectStock, onNavigate }: FactFupengPageProps) {
  const [activeTab, setActiveTab] = useState<SubTabId>('fact-retro');

  // Paper Desk integration state
  const [paperBusyKey, setPaperBusyKey] = useState<string | null>(null);
  const [paperToast, setPaperToast] = useState<{ ok: boolean; text: string } | null>(null);

  // Tab [01] & [04]: Fact Buy-Point Overview + Selected Asset Detail + Threshold Lab
  const [factOverview, setFactOverview] = useState<FactBuyPointOverviewResponse | null>(null);
  const [factLoading, setFactLoading] = useState(false);
  const [factError, setFactError] = useState<string | null>(null);
  const [archetypeFilter, setArchetypeFilter] = useState<FactArchetypeCategory>('all');
  const [assetSortBy, setAssetSortBy] = useState<'readiness' | 'detWinRate' | 'retT5'>('readiness');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('AU0');

  const [assetDetail, setAssetDetail] = useState<AssetFactDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [episodeFilter, setEpisodeFilter] = useState<'all' | 'deterministic' | 'raw'>('all');

  // Interactive Threshold Lab controls (shared across [01] bottom & [04])
  const [labMaxLagZ, setLabMaxLagZ] = useState<number>(-1.15);
  const [labHoldingDays, setLabHoldingDays] = useState<number>(5);
  const [labRequireMicro, setLabRequireMicro] = useState<boolean>(true);
  const [labRequireCrowding, setLabRequireCrowding] = useState<boolean>(true);
  const [labDays, setLabDays] = useState<number>(180);
  const [labLoading, setLabLoading] = useState<boolean>(false);
  const [labError, setLabError] = useState<string | null>(null);
  const [labResult, setLabResult] = useState<FactBuyPointBacktestResponse | null>(null);

  // Tab [02] & [03]: Fu Peng FICC & 24h Intel
  const [fupengOverview, setFupengOverview] = useState<FupengOverviewResponse | null>(null);
  const [fupengLoading, setFupengLoading] = useState(false);
  const [fupengError, setFupengError] = useState<string | null>(null);
  const [selectedBasketId, setSelectedBasketId] = useState<string>('all');
  const [batchOrdering, setBatchOrdering] = useState(false);

  // Fu Peng Barbell Backtest
  const [bbDays, setBbDays] = useState<number>(180);
  const [bbDivWeight, setBbDivWeight] = useState<number>(40);
  const [bbAiMaxWeight, setBbAiMaxWeight] = useState<number>(30);
  const [bbGoldWeight, setBbGoldWeight] = useState<number>(30);
  const [bbDeleverage, setBbDeleverage] = useState<boolean>(true);
  const [bbLoading, setBbLoading] = useState<boolean>(false);
  const [bbError, setBbError] = useState<string | null>(null);
  const [bbResult, setBbResult] = useState<FupengBarbellBacktestResponse | null>(null);

  // Tab [03]: Scraper + Ingest Note
  const [scrapingNow, setScrapingNow] = useState(false);
  const [scrapeStatusMsg, setScrapeStatusMsg] = useState<string | null>(null);
  const [pillarFilter, setPillarFilter] = useState<'all' | FupengMacroPillar>('all');
  const [intelSearch, setIntelSearch] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteUrl, setNoteUrl] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [ingestingNote, setIngestingNote] = useState(false);
  const [lastIngestedItem, setLastIngestedItem] = useState<FupengIntelItem | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  // ECharts refs
  const priceMarkersChartRef = useRef<HTMLDivElement | null>(null);
  const curveCompareChartRef = useRef<HTMLDivElement | null>(null);
  const barbellChartRef = useRef<HTMLDivElement | null>(null);
  const crossAssetBarChartRef = useRef<HTMLDivElement | null>(null);
  const labEquityChartRef = useRef<HTMLDivElement | null>(null);

  const loadFactOverview = useCallback(async () => {
    setFactLoading(true);
    setFactError(null);
    try {
      const data = await api.getFactBuyPointOverview();
      setFactOverview(data);
      if (data.profiles?.length) {
        setSelectedSymbol((prev) =>
          data.profiles.some((p) => p.symbol === prev) ? prev : data.profiles[0].symbol
        );
      }
    } catch (e: unknown) {
      setFactError(e instanceof Error ? e.message : '加载多标的事实因子总表失败');
    } finally {
      setFactLoading(false);
    }
  }, []);

  const loadAssetDetail = useCallback(async (symbol: string) => {
    if (!symbol) return;
    setDetailLoading(true);
    setDetailError(null);
    setLabResult(null);
    setLabError(null);
    try {
      const data = await api.getAssetFactDetail(symbol, 180);
      setAssetDetail(data);
    } catch (e: unknown) {
      setDetailError(e instanceof Error ? e.message : `加载 ${symbol} 复盘详情失败`);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadFupengOverview = useCallback(async () => {
    setFupengLoading(true);
    setFupengError(null);
    try {
      const data = await api.getFupengOverview();
      setFupengOverview(data);
    } catch (e: unknown) {
      setFupengError(e instanceof Error ? e.message : '加载付鹏宏观FICC总览失败');
    } finally {
      setFupengLoading(false);
    }
  }, []);

  const runBarbellBacktest = useCallback(async () => {
    setBbLoading(true);
    setBbError(null);
    try {
      const res = await api.runFupengBarbellBacktest({
        days: bbDays,
        dividendLeftWeightPct: bbDivWeight,
        aiRightMaxWeightPct: bbAiMaxWeight,
        goldHardWeightPct: bbGoldWeight,
        enableDeleverageGate: bbDeleverage,
      });
      setBbResult(res);
    } catch (e: unknown) {
      setBbError(e instanceof Error ? e.message : '杠铃组合回测执行失败');
    } finally {
      setBbLoading(false);
    }
  }, [bbDays, bbDivWeight, bbAiMaxWeight, bbGoldWeight, bbDeleverage]);

  useEffect(() => {
    loadFactOverview();
    loadFupengOverview();
  }, [loadFactOverview, loadFupengOverview]);

  useEffect(() => {
    if (selectedSymbol) {
      loadAssetDetail(selectedSymbol);
    }
  }, [selectedSymbol, loadAssetDetail]);

  useEffect(() => {
    if (activeTab === 'fupeng-ficc' && !bbResult && !bbLoading) {
      runBarbellBacktest();
    }
  }, [activeTab, bbResult, bbLoading, runBarbellBacktest]);

  const handleRunThresholdLab = useCallback(async () => {
    if (!selectedSymbol) return;
    setLabLoading(true);
    setLabError(null);
    try {
      const res = await api.runFactBuyPointBacktest({
        symbol: selectedSymbol,
        days: labDays,
        maxLagZ: labMaxLagZ,
        requireMicroConfirm: labRequireMicro,
        requireCrowdingSafe: labRequireCrowding,
        holdingDays: labHoldingDays,
        stopLossPct: 4,
      });
      setLabResult(res);
    } catch (e: unknown) {
      setLabError(e instanceof Error ? e.message : '阈值实验室回测失败');
    } finally {
      setLabLoading(false);
    }
  }, [selectedSymbol, labDays, labMaxLagZ, labRequireMicro, labRequireCrowding, labHoldingDays]);

  useEffect(() => {
    if (activeTab === 'threshold-lab' && !labResult && !labLoading && selectedSymbol) {
      handleRunThresholdLab();
    }
  }, [activeTab, labResult, labLoading, selectedSymbol, handleRunThresholdLab]);

  const handleSendToPaperDesk = useCallback(
    async (opts: {
      key: string;
      rawSymbol: string;
      name?: string;
      action?: 'buy_long' | 'sell_long' | 'open_short' | 'cover_short';
      capitalAllocationPct?: number;
      price?: number;
      strategyTag: string;
      note: string;
    }) => {
      const cleanSymbol = opts.rawSymbol.split(/[\/,\s]+/)[0].trim();
      if (!cleanSymbol) return;
      const futures = isFuturesCode(cleanSymbol);
      const market: 'ashare' | 'futures' = futures ? 'futures' : 'ashare';
      const resolvedAction = opts.action || 'buy_long';

      if (market === 'ashare' && resolvedAction === 'open_short') {
        setPaperToast({
          ok: false,
          text: `${cleanSymbol} ${opts.name || ''} 为A股/ETF T+1 标的，不支持直接开空单；请使用期货品种(如 IC0/IM0/RB0/FG0)进行空头对冲`,
        });
        return;
      }

      setPaperBusyKey(opts.key);
      setPaperToast(null);
      try {
        const alloc = Math.max(3, Math.min(35, safeNum(opts.capitalAllocationPct, 10)));
        const res = await api.placePaperOrder({
          symbol: cleanSymbol,
          name: opts.name,
          market,
          action: resolvedAction,
          capitalAllocationPct: alloc,
          price: opts.price && opts.price > 0 ? opts.price : undefined,
          leverage: market === 'futures' ? 2 : 1,
          strategyTag: opts.strategyTag,
          note: opts.note,
        });
        const eq = res.activePortfolio?.totalEquity;
        const actionLabel =
          resolvedAction === 'open_short'
            ? '开仓做空'
            : resolvedAction === 'sell_long'
            ? '卖出平多'
            : '买入做多';
        setPaperToast({
          ok: true,
          text: `已转入模拟实盘舱 [${res.activePortfolio?.name || '主组合'}]: ${cleanSymbol} ${
            opts.name || ''
          } (${actionLabel}, 配比 ${alloc.toFixed(1)}%) · 组合净值 ¥${fmtNum(eq, 0)}`,
        });
      } catch (e: unknown) {
        setPaperToast({
          ok: false,
          text: `模拟建仓失败 (${cleanSymbol}): ${e instanceof Error ? e.message : '未知错误'}`,
        });
      } finally {
        setPaperBusyKey(null);
      }
    },
    []
  );

  const handleBatchBarbellToPaper = useCallback(async () => {
    if (!fupengOverview?.baskets?.length) return;
    const poolBaskets =
      selectedBasketId === 'all'
        ? fupengOverview.baskets
        : fupengOverview.baskets.filter((b) => b.id === selectedBasketId);

    const queue: { target: FupengReferenceTarget; basketName: string }[] = [];
    for (const b of poolBaskets) {
      for (const t of b.targets) {
        if (safeNum(t.suggestedWeightPct, 0) <= 0) continue;
        const futures = isFuturesCode(t.symbol);
        if (!futures && t.direction === '空头对冲/规避') continue;
        queue.push({ target: t, basketName: b.name });
      }
    }
    if (!queue.length) {
      setPaperToast({ ok: false, text: '当前选中篮子内没有可直接建仓的标的配比' });
      return;
    }

    setBatchOrdering(true);
    setPaperToast(null);
    let okCount = 0;
    let failCount = 0;
    let lastEquity = 0;

    for (const item of queue.slice(0, 8)) {
      const futures = isFuturesCode(item.target.symbol);
      const action: 'buy_long' | 'open_short' =
        item.target.direction === '空头对冲/规避' && futures ? 'open_short' : 'buy_long';
      try {
        const res = await api.placePaperOrder({
          symbol: item.target.symbol,
          name: item.target.name,
          market: futures ? 'futures' : 'ashare',
          action,
          capitalAllocationPct: Math.max(4, Math.min(25, safeNum(item.target.suggestedWeightPct, 8))),
          price: item.target.price > 0 ? item.target.price : undefined,
          leverage: futures ? 2 : 1,
          strategyTag: '付鹏FICC杠铃批量',
          note: `${item.basketName} | ${item.target.frameworkRole}`,
        });
        okCount += 1;
        lastEquity = safeNum(res.activePortfolio?.totalEquity, lastEquity);
      } catch {
        failCount += 1;
      }
    }
    setBatchOrdering(false);
    setPaperToast({
      ok: okCount > 0,
      text: `付鹏杠铃配比批量下单完成: 成功 ${okCount} 笔${failCount > 0 ? ` · 跳过/失败 ${failCount} 笔` : ''}${
        lastEquity > 0 ? ` · 最新组合净值 ¥${fmtNum(lastEquity, 0)}` : ''
      }`,
    });
  }, [fupengOverview, selectedBasketId]);

  const handleBatch4of4ToPaper = useCallback(async () => {
    const ready = (factOverview?.profiles || []).filter(
      (p) => p.passedConditionsCount >= 4 && p.recommendedSide !== '观望'
    );
    if (!ready.length) {
      setPaperToast({
        ok: false,
        text: '当前暂无满足 4/4 确定性买点的标的，请保持耐心等待门控共振触发',
      });
      return;
    }
    setBatchOrdering(true);
    let okCount = 0;
    let failCount = 0;
    let lastEq = 0;
    for (const p of ready) {
      const futures = p.market === '国内期货' || isFuturesCode(p.symbol);
      const action: 'buy_long' | 'open_short' =
        p.recommendedSide === '做空' && futures ? 'open_short' : 'buy_long';
      try {
        const res = await api.placePaperOrder({
          symbol: p.symbol,
          name: p.name,
          market: futures ? 'futures' : 'ashare',
          action,
          capitalAllocationPct: Math.max(5, Math.min(25, safeNum(p.kellySuggestedPct, 12))),
          price: p.lastPrice > 0 ? p.lastPrice : undefined,
          leverage: futures ? 2 : 1,
          strategyTag: 'V7四维确定买点批量',
          note: `${p.factRecipeTitle} | 胜率${fmtNum(p.deterministicWinRatePct, 1)}%`,
        });
        okCount += 1;
        lastEq = safeNum(res.activePortfolio?.totalEquity, lastEq);
      } catch {
        failCount += 1;
      }
    }
    setBatchOrdering(false);
    setPaperToast({
      ok: okCount > 0,
      text: `4/4 确定性买点批量建仓完成: 成功 ${okCount} 笔${failCount > 0 ? ` · 失败 ${failCount} 笔` : ''}${
        lastEq > 0 ? ` · 最新净值 ¥${fmtNum(lastEq, 0)}` : ''
      }`,
    });
  }, [factOverview]);

  const handleScrapeNow = useCallback(async () => {
    setScrapingNow(true);
    setScrapeStatusMsg(null);
    try {
      const res = await api.scrapeFupengNow();
      setFupengOverview(res.overview);
      setScrapeStatusMsg(
        `全网抓取完成: 新增入库 ${res.newlyAdded} 条，SQLite 累计存储 ${res.totalCount} 条付鹏动态`
      );
    } catch (e: unknown) {
      setScrapeStatusMsg(`抓取付鹏动态失败: ${e instanceof Error ? e.message : '网络异常'}`);
    } finally {
      setScrapingNow(false);
    }
  }, []);

  const handleIngestNote = useCallback(async () => {
    if (!noteContent.trim()) {
      setIngestError('请先粘贴付鹏老师访谈、视频逐字稿或微博原文');
      return;
    }
    setIngestingNote(true);
    setIngestError(null);
    try {
      const res = await api.ingestFupengNote({
        title: noteTitle.trim() || '付鹏宏观观点即时解析纪要',
        content: noteContent.trim(),
        sourceUrl: noteUrl.trim() || undefined,
      });
      setLastIngestedItem(res.item);
      setFupengOverview(res.overview);
      setNoteTitle('');
      setNoteUrl('');
      setNoteContent('');
    } catch (e: unknown) {
      setIngestError(e instanceof Error ? e.message : '观点解析入库失败');
    } finally {
      setIngestingNote(false);
    }
  }, [noteTitle, noteContent, noteUrl]);

  // Filtered & sorted profiles for Tab [01]
  const filteredProfiles = useMemo(() => {
    const list = (factOverview?.profiles || []).filter((p) =>
      archetypeFilter === 'all' ? true : p.archetype === archetypeFilter
    );
    return [...list].sort((a, b) => {
      if (assetSortBy === 'detWinRate') {
        return safeNum(b.deterministicWinRatePct) - safeNum(a.deterministicWinRatePct);
      }
      if (assetSortBy === 'retT5') {
        return safeNum(b.deterministicAvgRetT5Pct) - safeNum(a.deterministicAvgRetT5Pct);
      }
      if (b.passedConditionsCount !== a.passedConditionsCount) {
        return b.passedConditionsCount - a.passedConditionsCount;
      }
      return safeNum(b.deterministicWinRatePct) - safeNum(a.deterministicWinRatePct);
    });
  }, [factOverview, archetypeFilter, assetSortBy]);

  const selectedProfile: AssetFactBuyPointProfile | null = useMemo(() => {
    if (assetDetail?.profile && assetDetail.profile.symbol === selectedSymbol) {
      return assetDetail.profile;
    }
    return (factOverview?.profiles || []).find((p) => p.symbol === selectedSymbol) || null;
  }, [assetDetail, factOverview, selectedSymbol]);

  const activeEpisodes: HistoricalFactEpisode[] = useMemo(() => {
    const raw = labResult?.episodes || assetDetail?.episodes || [];
    if (episodeFilter === 'deterministic') return raw.filter((e) => e.isDeterministicSetup);
    if (episodeFilter === 'raw') return raw.filter((e) => !e.isDeterministicSetup);
    return raw;
  }, [labResult, assetDetail, episodeFilter]);

  const activeComparisonCurve = useMemo(() => {
    return labResult?.comparisonCurve || assetDetail?.comparisonCurve || [];
  }, [labResult, assetDetail]);

  const visibleBaskets = useMemo(() => {
    const all = fupengOverview?.baskets || [];
    if (selectedBasketId === 'all') return all;
    return all.filter((b) => b.id === selectedBasketId);
  }, [fupengOverview, selectedBasketId]);

  const filteredIntelFeed = useMemo(() => {
    const q = intelSearch.trim().toLowerCase();
    return (fupengOverview?.intelFeed || []).filter((item) => {
      if (pillarFilter !== 'all' && item.pillar !== pillarFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.mappedTargets.some(
          (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
        )
      );
    });
  }, [fupengOverview, pillarFilter, intelSearch]);

  // EChart 1: Asset Price + Historical Deterministic Buy Points (Orange Triangle) vs Raw Noise (Gray Circle)
  useEffect(() => {
    if (activeTab !== 'fact-retro') return;
    const dom = priceMarkersChartRef.current;
    if (!dom || !assetDetail?.priceSeries?.length) return;
    const chart = echarts.init(dom);
    const series = assetDetail.priceSeries;
    const dates = series.map((s) => s.date);
    const closes = series.map((s) => safeNum(s.close));
    const factIdx = series.map((s) => safeNum(s.factCompositeIndex));

    const detPoints = series
      .filter((s) => s.marker === 'deterministic_buy')
      .map((s) => ({
        name: '四维确定性买点',
        value: [s.date, safeNum(s.close)],
        lagZ: safeNum(s.valuationLagZ),
      }));

    const rawPoints = series
      .filter((s) => s.marker === 'raw_noise')
      .map((s) => ({
        name: '单因子粗糙触发',
        value: [s.date, safeNum(s.close)],
        lagZ: safeNum(s.valuationLagZ),
      }));

    chart.setOption({
      backgroundColor: '#0d1015',
      animation: false,
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#161b24',
        borderColor: '#2b3444',
        textStyle: { color: '#dfe6f0', fontSize: 11 },
      },
      legend: {
        top: 4,
        right: 10,
        textStyle: { color: '#9aa5b5', fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8,
        data: ['标的收盘价', '专属事实脉冲', '四维确定性买点', '单因子粗糙触发'],
      },
      title: {
        text: `${assetDetail.profile.symbol} ${assetDetail.profile.name} · 历史买点时空复盘`,
        left: 8,
        top: 4,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontWeight: 600 },
      },
      grid: { left: 48, right: 44, top: 30, bottom: 24 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#222832' } },
        axisLabel: { color: '#7d8796', fontSize: 9 },
      },
      yAxis: [
        {
          type: 'value',
          scale: true,
          splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
          axisLabel: { color: '#8b95a5', fontSize: 9 },
        },
        {
          type: 'value',
          scale: true,
          splitLine: { show: false },
          axisLabel: { color: '#4da3ff', fontSize: 9 },
        },
      ],
      series: [
        {
          name: '标的收盘价',
          type: 'line',
          showSymbol: false,
          data: closes,
          lineStyle: { width: 1.6, color: '#e5b567' },
          areaStyle: { color: 'rgba(229, 181, 103, 0.06)' },
        },
        {
          name: '专属事实脉冲',
          type: 'line',
          yAxisIndex: 1,
          showSymbol: false,
          data: factIdx,
          lineStyle: { width: 1.1, color: '#4da3ff', type: 'dashed' },
        },
        {
          name: '四维确定性买点',
          type: 'scatter',
          symbol: 'triangle',
          symbolSize: 11,
          itemStyle: { color: '#ff8800', borderColor: '#090c10', borderWidth: 1 },
          data: detPoints,
          z: 6,
        },
        {
          name: '单因子粗糙触发',
          type: 'scatter',
          symbol: 'circle',
          symbolSize: 7,
          itemStyle: { color: '#7d8796', opacity: 0.85 },
          data: rawPoints,
          z: 5,
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, assetDetail]);

  // EChart 2: Deterministic vs Raw Factor vs Benchmark Equity Curve + Drawdown
  useEffect(() => {
    if (activeTab !== 'fact-retro') return;
    const dom = curveCompareChartRef.current;
    if (!dom || !activeComparisonCurve.length) return;
    const chart = echarts.init(dom);
    chart.setOption({
      backgroundColor: '#0d1015',
      animation: false,
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#161b24',
        borderColor: '#2b3444',
        textStyle: { color: '#dfe6f0', fontSize: 11 },
      },
      title: {
        text: '四维确定性买点 vs 粗糙单因子触发 净值对比',
        left: 8,
        top: 4,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontWeight: 600 },
      },
      legend: {
        top: 4,
        right: 10,
        textStyle: { color: '#9aa5b5', fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8,
        data: ['四维确定性买点%', '粗糙单因子%', '标的基准%', '水下回撤%'],
      },
      grid: [
        { left: 46, right: 14, top: 30, height: '52%' },
        { left: 46, right: 14, top: '72%', height: '19%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: activeComparisonCurve.map((c) => c.date),
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: activeComparisonCurve.map((c) => c.date),
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: { color: '#7d8796', fontSize: 9 },
        },
      ],
      yAxis: [
        {
          scale: true,
          splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
          axisLabel: { color: '#8b95a5', fontSize: 9, formatter: (v: number) => `${v}%` },
        },
        {
          gridIndex: 1,
          max: 0,
          splitNumber: 2,
          splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
          axisLabel: { color: '#00c853', fontSize: 9, formatter: (v: number) => `${v}%` },
        },
      ],
      series: [
        {
          name: '四维确定性买点%',
          type: 'line',
          showSymbol: false,
          data: activeComparisonCurve.map((c) => safeNum(c.deterministicReturnPct)),
          lineStyle: { width: 2, color: '#ff8800' },
        },
        {
          name: '粗糙单因子%',
          type: 'line',
          showSymbol: false,
          data: activeComparisonCurve.map((c) => safeNum(c.rawFactorReturnPct)),
          lineStyle: { width: 1.3, color: '#8b95a5', type: 'dashed' },
        },
        {
          name: '标的基准%',
          type: 'line',
          showSymbol: false,
          data: activeComparisonCurve.map((c) => safeNum(c.benchmarkPct)),
          lineStyle: { width: 1.2, color: '#4da3ff' },
        },
        {
          name: '水下回撤%',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          data: activeComparisonCurve.map((c) => -Math.abs(safeNum(c.drawdownPct))),
          lineStyle: { width: 1, color: '#00c853' },
          areaStyle: { color: 'rgba(0, 200, 83, 0.16)' },
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, activeComparisonCurve]);

  // EChart 3: Fu Peng Barbell 3-line Equity + AI Effective Weight + Drawdown
  useEffect(() => {
    if (activeTab !== 'fupeng-ficc') return;
    const dom = barbellChartRef.current;
    if (!dom || !bbResult?.equityCurve?.length) return;
    const chart = echarts.init(dom);
    const curve = bbResult.equityCurve;
    chart.setOption({
      backgroundColor: '#0d1015',
      animation: false,
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#161b24',
        borderColor: '#2b3444',
        textStyle: { color: '#dfe6f0', fontSize: 11 },
      },
      legend: {
        top: 4,
        right: 10,
        textStyle: { color: '#9aa5b5', fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8,
        data: ['付鹏动态杠铃%', '静态等权%', '沪深300%', 'AI右端动态权重%', '水下回撤%'],
      },
      grid: [
        { left: 46, right: 16, top: 28, height: '42%' },
        { left: 46, right: 16, top: '57%', height: '14%' },
        { left: 46, right: 16, top: '78%', height: '14%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: curve.map((c) => c.date),
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: curve.map((c) => c.date),
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: { show: false },
        },
        {
          type: 'category',
          gridIndex: 2,
          data: curve.map((c) => c.date),
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: { color: '#7d8796', fontSize: 9 },
        },
      ],
      yAxis: [
        {
          scale: true,
          splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
          axisLabel: { color: '#8b95a5', fontSize: 9, formatter: (v: number) => `${v}%` },
        },
        {
          gridIndex: 1,
          min: 0,
          max: 45,
          splitNumber: 2,
          splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
          axisLabel: { color: '#f0b90b', fontSize: 9, formatter: (v: number) => `${v}%` },
        },
        {
          gridIndex: 2,
          max: 0,
          splitNumber: 2,
          splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
          axisLabel: { color: '#00c853', fontSize: 9, formatter: (v: number) => `${v}%` },
        },
      ],
      series: [
        {
          name: '付鹏动态杠铃%',
          type: 'line',
          showSymbol: false,
          data: curve.map((c) => safeNum(c.barbellReturnPct)),
          lineStyle: { width: 2, color: '#ff8800' },
        },
        {
          name: '静态等权%',
          type: 'line',
          showSymbol: false,
          data: curve.map((c) => safeNum(c.staticEqualReturnPct)),
          lineStyle: { width: 1.3, color: '#f0b90b', type: 'dashed' },
        },
        {
          name: '沪深300%',
          type: 'line',
          showSymbol: false,
          data: curve.map((c) => safeNum(c.hs300ReturnPct)),
          lineStyle: { width: 1.3, color: '#4da3ff' },
        },
        {
          name: 'AI右端动态权重%',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          step: 'end',
          showSymbol: false,
          data: curve.map((c) => safeNum(c.aiEffectiveWeightPct)),
          lineStyle: { width: 1.3, color: '#f0b90b' },
          areaStyle: { color: 'rgba(240, 185, 11, 0.16)' },
        },
        {
          name: '水下回撤%',
          type: 'line',
          xAxisIndex: 2,
          yAxisIndex: 2,
          showSymbol: false,
          data: curve.map((c) => -Math.abs(safeNum(c.drawdownPct))),
          lineStyle: { width: 1, color: '#00c853' },
          areaStyle: { color: 'rgba(0, 200, 83, 0.16)' },
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, bbResult]);

  // EChart 4 & 5: Tab [04] Cross-Asset Win Rate Comparison + Lab Equity
  useEffect(() => {
    if (activeTab !== 'threshold-lab') return;
    const dom = crossAssetBarChartRef.current;
    const profiles = factOverview?.profiles || [];
    if (!dom || !profiles.length) return;
    const chart = echarts.init(dom);
    chart.setOption({
      backgroundColor: '#0d1015',
      animation: false,
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#161b24',
        borderColor: '#2b3444',
        textStyle: { color: '#dfe6f0', fontSize: 11 },
      },
      title: {
        text: '18大核心标的 · 单因子粗糙胜率 vs 四维确定性买点胜率 (%)',
        left: 8,
        top: 4,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontWeight: 600 },
      },
      legend: {
        top: 4,
        right: 10,
        textStyle: { color: '#9aa5b5', fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8,
        data: ['单因子粗糙胜率%', '四维确定性买点胜率%'],
      },
      grid: { left: 42, right: 16, top: 32, bottom: 48 },
      xAxis: {
        type: 'category',
        data: profiles.map((p) => `${p.symbol}\n${p.name.slice(0, 4)}`),
        axisLine: { lineStyle: { color: '#222832' } },
        axisLabel: { color: '#8b95a5', fontSize: 9, interval: 0, rotate: 24 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
        axisLabel: { color: '#8b95a5', fontSize: 9, formatter: (v: number) => `${v}%` },
      },
      series: [
        {
          name: '单因子粗糙胜率%',
          type: 'bar',
          barMaxWidth: 14,
          itemStyle: { color: '#475569' },
          data: profiles.map((p) => safeNum(p.rawWinRatePct)),
        },
        {
          name: '四维确定性买点胜率%',
          type: 'bar',
          barMaxWidth: 14,
          itemStyle: { color: '#ff8800' },
          data: profiles.map((p) => safeNum(p.deterministicWinRatePct)),
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, factOverview]);

  useEffect(() => {
    if (activeTab !== 'threshold-lab') return;
    const dom = labEquityChartRef.current;
    const curve = labResult?.comparisonCurve || [];
    if (!dom || !curve.length) return;
    const chart = echarts.init(dom);
    chart.setOption({
      backgroundColor: '#0d1015',
      animation: false,
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#161b24',
        borderColor: '#2b3444',
        textStyle: { color: '#dfe6f0', fontSize: 11 },
      },
      title: {
        text: `${labResult?.symbol} ${labResult?.name} · 阈值实验室净值与回撤`,
        left: 8,
        top: 4,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontWeight: 600 },
      },
      legend: {
        top: 4,
        right: 10,
        textStyle: { color: '#9aa5b5', fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8,
        data: ['四维确定性%', '粗糙单因子%', '标的基准%', '回撤%'],
      },
      grid: [
        { left: 46, right: 14, top: 30, height: '54%' },
        { left: 46, right: 14, top: '74%', height: '18%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: curve.map((c) => c.date),
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: curve.map((c) => c.date),
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: { color: '#7d8796', fontSize: 9 },
        },
      ],
      yAxis: [
        {
          scale: true,
          splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
          axisLabel: { color: '#8b95a5', fontSize: 9, formatter: (v: number) => `${v}%` },
        },
        {
          gridIndex: 1,
          max: 0,
          splitNumber: 2,
          splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
          axisLabel: { color: '#00c853', fontSize: 9, formatter: (v: number) => `${v}%` },
        },
      ],
      series: [
        {
          name: '四维确定性%',
          type: 'line',
          showSymbol: false,
          data: curve.map((c) => safeNum(c.deterministicReturnPct)),
          lineStyle: { width: 2, color: '#ff8800' },
        },
        {
          name: '粗糙单因子%',
          type: 'line',
          showSymbol: false,
          data: curve.map((c) => safeNum(c.rawFactorReturnPct)),
          lineStyle: { width: 1.2, color: '#8b95a5', type: 'dashed' },
        },
        {
          name: '标的基准%',
          type: 'line',
          showSymbol: false,
          data: curve.map((c) => safeNum(c.benchmarkPct)),
          lineStyle: { width: 1.2, color: '#4da3ff' },
        },
        {
          name: '回撤%',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          data: curve.map((c) => -Math.abs(safeNum(c.drawdownPct))),
          lineStyle: { width: 1, color: '#00c853' },
          areaStyle: { color: 'rgba(0, 200, 83, 0.16)' },
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, labResult]);

  const winRateLiftPp = useMemo(() => {
    if (!factOverview) return 0;
    return safeNum(factOverview.avgDeterministicWinRatePct) - safeNum(factOverview.avgRawWinRatePct);
  }, [factOverview]);

  return (
    <div className="h-full w-full flex flex-col bg-[#090c10] text-[#dfe6f0] overflow-hidden select-none">
      {/* Top 28px Wind Sub-Tab Header Ribbon */}
      <div className="h-[28px] bg-[#161b24] border-b border-[#222832] flex items-center justify-between shrink-0">
        <div className="flex items-center h-full overflow-x-auto">
          {SUB_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`w-tab h-full whitespace-nowrap shrink-0 ${active ? 'w-tab-active' : ''}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 px-2 shrink-0 text-[11px]">
          {factOverview && (
            <span className="px-1.5 py-0.5 bg-[#0e1117] border border-[#222832] text-[#ff8800] tabular-nums">
              4/4买点: {factOverview.triggeredCount4of4} 只
            </span>
          )}
          {fupengOverview && (
            <span className="px-1.5 py-0.5 bg-[#0e1117] border border-[#222832] text-[#e5b567] tabular-nums">
              付鹏库: {fupengOverview.watcherDaemonStatus?.totalStoredIntelCount ?? fupengOverview.intelFeed.length} 条
            </span>
          )}
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('saas-desk')}
              className="h-[20px] px-2 bg-[#0e1117] border border-[#2e394a] text-[#ff8800] hover:border-[#ff8800] flex items-center gap-1 font-medium"
            >
              <Send className="w-3 h-3" />
              模拟实盘舱
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              loadFactOverview();
              loadFupengOverview();
              if (selectedSymbol) loadAssetDetail(selectedSymbol);
            }}
            className="h-[20px] px-2 bg-[#0e1117] border border-[#222832] text-[#cfd8e3] hover:border-[#ff8800] flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${factLoading || fupengLoading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* Paper Order Execution Feedback Toast */}
      {paperToast && (
        <div
          className={`px-3 py-1.5 border-b border-[#222832] flex items-center justify-between gap-2 text-[11px] shrink-0 ${
            paperToast.ok ? 'bg-[#121c15] text-[#dfe6f0]' : 'bg-[#211214] text-[#ff9f9f]'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`px-1.5 py-0.5 text-[10px] font-bold border ${
                paperToast.ok
                  ? 'border-[#00c853] text-[#00c853]'
                  : 'border-[#ff3535] text-[#ff3535]'
              }`}
            >
              {paperToast.ok ? 'PAPER FILL' : 'ORDER VETO'}
            </span>
            <span className="truncate tabular-nums">{paperToast.text}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('saas-desk')}
                className="px-2 py-0.5 bg-[#ff8800] text-[#090c10] font-bold hover:bg-[#ff9c2a] flex items-center gap-1"
              >
                立即前往模拟实盘舱
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setPaperToast(null)}
              className="px-2 py-0.5 bg-[#0e1117] border border-[#222832] text-[#8b95a5] hover:text-[#dfe6f0]"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* ==================== TAB 01: 多标的专属事实因子 · 历史预测大复盘与确定性买点 ==================== */}
      {activeTab === 'fact-retro' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
          {/* Top Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-[1px] bg-[#222832] shrink-0">
            <KpiCell
              label="历史审计预测事件总数"
              value={factOverview ? `${factOverview.totalEpisodesAudited} 次` : '--'}
              sub="横跨18大标的 真实K线+PM闭环"
              tone="gold"
            />
            <KpiCell
              label="单因子粗糙触发平均胜率"
              value={factOverview ? `${fmtNum(factOverview.avgRawWinRatePct, 1)}%` : '--'}
              sub="未做滞后Z/VWAP/拥挤过滤"
              tone="neutral"
            />
            <KpiCell
              label="四维共振确定性买点平均胜率"
              value={factOverview ? `${fmtNum(factOverview.avgDeterministicWinRatePct, 1)}%` : '--'}
              sub={factOverview ? `胜率净提升 +${fmtNum(winRateLiftPp, 1)} pp` : '等待数据'}
              tone="orange"
            />
            <KpiCell
              label="当前 4/4 确定性买点触发"
              value={factOverview ? `${factOverview.triggeredCount4of4} 只` : '--'}
              sub={factOverview ? `3/4 临近确认: ${factOverview.nearCount3of4} 只` : ''}
              tone={factOverview && factOverview.triggeredCount4of4 > 0 ? 'up' : 'neutral'}
            />
            <div className="lg:col-span-2 bg-[#0e1117] px-2.5 py-1.5 flex flex-col justify-between gap-1">
              <div className="flex items-center justify-between text-[10px] text-[#7d8796]">
                <span>产业链原型过滤 (6大专属事实配方)</span>
                <span className="tabular-nums text-[#e5b567]">显示 {filteredProfiles.length}/18</span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {ARCHETYPE_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setArchetypeFilter(f.id)}
                    className={`px-1.5 py-0.5 text-[10px] border ${
                      archetypeFilter === f.id
                        ? 'bg-[#ff8800] border-[#ff8800] text-[#090c10] font-bold'
                        : 'bg-[#161b24] border-[#222832] text-[#9aa5b5] hover:text-[#dfe6f0]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {factError && (
            <div className="px-3 py-1.5 bg-[#211214] text-[#ff8a8a] text-[11px] flex items-center justify-between shrink-0">
              <span>事实因子总表加载异常: {factError}</span>
              <button
                type="button"
                onClick={loadFactOverview}
                className="px-2 py-0.5 border border-[#ff3535] text-[#ff3535]"
              >
                重试
              </button>
            </div>
          )}

          {/* Split Body: Left 42% Asset Matrix | Right 58% Detail + Audit */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-[1px] bg-[#222832] overflow-hidden">
            {/* Left Docked Pane (~42%) */}
            <div className="w-full lg:w-[42%] min-h-0 flex flex-col bg-[#0e1117]">
              <PaneHeader
                title="18大核心标的专属事实因子与确定性买点总表"
                badge={`${filteredProfiles.length} 标的`}
                right={
                  <div className="flex items-center gap-1">
                    <span className="text-[10px]">排序:</span>
                    <select
                      value={assetSortBy}
                      onChange={(e) => setAssetSortBy(e.target.value as 'readiness' | 'detWinRate' | 'retT5')}
                      className="h-[20px] bg-[#0e1117] border border-[#222832] text-[#dfe6f0] text-[10px] px-1 outline-none"
                    >
                      <option value="readiness">当前就绪度</option>
                      <option value="detWinRate">确定买点胜率</option>
                      <option value="retT5">T+5均益</option>
                    </select>
                  </div>
                }
              />
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-left">代码</th>
                      <th className="text-left">名称/市场</th>
                      <th className="text-left">专属事实因子配方</th>
                      <th className="text-right">粗糙 vs 确定胜率</th>
                      <th className="text-right">T+5均益</th>
                      <th className="text-center">就绪度</th>
                      <th className="text-left">买点状态</th>
                      <th className="text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factLoading && !filteredProfiles.length ? (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-[#7d8796]">
                          正在扫描 18 大核心标的专属事实因子与历史预测样本...
                        </td>
                      </tr>
                    ) : !filteredProfiles.length ? (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-[#7d8796]">
                          当前过滤条件下无标的数据
                        </td>
                      </tr>
                    ) : (
                      filteredProfiles.map((p) => {
                        const active = p.symbol === selectedSymbol;
                        const busy = paperBusyKey === `tbl_${p.symbol}`;
                        return (
                          <tr
                            key={p.symbol}
                            onClick={() => setSelectedSymbol(p.symbol)}
                            className={`cursor-pointer ${
                              active ? '!bg-[#1f293a] outline outline-1 outline-[#ff8800]' : ''
                            }`}
                          >
                            <td>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectStock(p.symbol, p.name);
                                }}
                                className="text-[#e5b567] font-mono font-bold hover:underline"
                              >
                                {p.symbol}
                              </button>
                            </td>
                            <td>
                              <div className="flex items-center gap-1">
                                <span className="text-[#dfe6f0] font-medium">{p.name}</span>
                                <span className="px-1 text-[9px] bg-[#161b24] border border-[#222832] text-[#7d8796]">
                                  {p.market === '国内期货' ? '期T0' : '股T1'}
                                </span>
                              </div>
                            </td>
                            <td className="max-w-[160px] truncate text-[#9aa5b5]" title={`${p.factRecipeTitle}: ${p.factFactors.join(' + ')}`}>
                              {p.factRecipeTitle}
                            </td>
                            <td className="text-right tabular-nums">
                              <span className="text-[#7d8796]">{fmtNum(p.rawWinRatePct, 0)}%</span>
                              <span className="text-[#5c6675] mx-0.5">-&gt;</span>
                              <span className="text-[#ff8800] font-bold">
                                {fmtNum(p.deterministicWinRatePct, 0)}%
                              </span>
                            </td>
                            <td className={`text-right font-semibold ${colorUpDown(p.deterministicAvgRetT5Pct)}`}>
                              {fmtPct(p.deterministicAvgRetT5Pct, 2)}
                            </td>
                            <td className={`text-center tabular-nums ${readinessColorClass(p.passedConditionsCount)}`}>
                              {p.passedConditionsCount}/4
                            </td>
                            <td>
                              <span
                                className={`inline-block px-1.5 py-0 text-[10px] border ${buyPointBadgeClass(
                                  p.buyPointState
                                )}`}
                              >
                                {p.buyPointState}
                              </span>
                            </td>
                            <td className="text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setSelectedSymbol(p.symbol)}
                                  className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] hover:border-[#ff8800]"
                                >
                                  复盘
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    handleSendToPaperDesk({
                                      key: `tbl_${p.symbol}`,
                                      rawSymbol: p.symbol,
                                      name: p.name,
                                      action:
                                        p.recommendedSide === '做空' && p.market === '国内期货'
                                          ? 'open_short'
                                          : 'buy_long',
                                      capitalAllocationPct: p.kellySuggestedPct || 10,
                                      price: p.lastPrice,
                                      strategyTag: 'V7四维确定买点',
                                      note: `${p.factRecipeTitle} | 就绪度 ${p.passedConditionsCount}/4`,
                                    })
                                  }
                                  className="px-1.5 py-0.5 text-[10px] bg-[#241809] border border-[#ff8800] text-[#ff8800] hover:bg-[#ff8800] hover:text-[#090c10] disabled:opacity-50"
                                >
                                  {busy ? '...' : '模拟建仓'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Docked Column (~58%) */}
            <div className="w-full lg:w-[58%] min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
              {/* Right-Top Pane: 4-Condition Card + 2 ECharts */}
              <div className="flex flex-col bg-[#0e1117] shrink-0">
                <PaneHeader
                  title={
                    selectedProfile
                      ? `${selectedProfile.symbol} ${selectedProfile.name} · 确定性买点四维充要条件实时核验`
                      : '选中标的 · 确定性买点核验'
                  }
                  badge={
                    selectedProfile
                      ? `${selectedProfile.archetypeLabel} · ${selectedProfile.executionRule}`
                      : undefined
                  }
                  right={
                    selectedProfile && (
                      <div className="flex items-center gap-1.5">
                        <span className={`tabular-nums font-bold ${colorUpDown(selectedProfile.changePct)}`}>
                          现价 {fmtNum(selectedProfile.lastPrice, 2)} ({fmtPct(selectedProfile.changePct)})
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectStock(selectedProfile.symbol, selectedProfile.name)}
                          className="h-[20px] px-2 bg-[#0e1117] border border-[#2a3240] text-[#e5b567] hover:border-[#ff8800]"
                        >
                          查看K线
                        </button>
                        <button
                          type="button"
                          disabled={paperBusyKey === `hero_${selectedProfile.symbol}`}
                          onClick={() =>
                            handleSendToPaperDesk({
                              key: `hero_${selectedProfile.symbol}`,
                              rawSymbol: selectedProfile.symbol,
                              name: selectedProfile.name,
                              action:
                                selectedProfile.recommendedSide === '做空' &&
                                selectedProfile.market === '国内期货'
                                  ? 'open_short'
                                  : 'buy_long',
                              capitalAllocationPct: selectedProfile.kellySuggestedPct || 12,
                              price: selectedProfile.lastPrice,
                              strategyTag: 'V7四维确定买点',
                              note: `${selectedProfile.factRecipeTitle} | 止损 ${fmtNum(
                                selectedProfile.falsificationStopPrice,
                                2
                              )}`,
                            })
                          }
                          className="h-[20px] px-2 bg-[#ff8800] text-[#090c10] font-bold hover:bg-[#ff9c2a] disabled:opacity-50"
                        >
                          模拟建仓 ({fmtNum(selectedProfile.kellySuggestedPct, 1)}%)
                        </button>
                      </div>
                    )
                  }
                />

                {detailError && (
                  <div className="px-2.5 py-1 bg-[#211214] text-[#ff8a8a] text-[11px]">
                    标的详情加载失败: {detailError}
                  </div>
                )}

                {selectedProfile && (
                  <>
                    {/* 4-Condition Real-Time Checklist Cards */}
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-[1px] bg-[#222832] border-b border-[#222832]">
                      {selectedProfile.checklist.map((cond) => (
                        <div
                          key={cond.id}
                          className={`bg-[#0e1117] px-2.5 py-1.5 border-l-2 ${
                            cond.passed ? 'border-l-[#ff8800]' : 'border-l-[#364152]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[11px] font-bold text-[#dfe6f0] truncate">{cond.label}</span>
                            <span
                              className={`px-1 py-0 text-[9px] border shrink-0 ${
                                cond.passed
                                  ? 'bg-[#241809] border-[#ff8800] text-[#ff8800]'
                                  : 'bg-[#161b24] border-[#252c38] text-[#7d8796]'
                              }`}
                            >
                              {cond.passed ? '通过' : '未满足'}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#e5b567] tabular-nums mt-0.5 truncate" title={cond.currentText}>
                            {cond.currentText}
                          </div>
                          <div className="text-[10px] text-[#7d8796] truncate mt-0.5" title={cond.ruleText}>
                            门限: {cond.ruleText}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Execution Price Plan Strip */}
                    <div className="bg-[#11151d] border-b border-[#222832] px-2.5 py-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] tabular-nums">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span>
                          建议方向:{' '}
                          <strong
                            className={
                              selectedProfile.recommendedSide === '做多'
                                ? 'text-[#ff3535]'
                                : selectedProfile.recommendedSide === '做空'
                                ? 'text-[#00c853]'
                                : 'text-[#8b95a5]'
                            }
                          >
                            {selectedProfile.recommendedSide}
                          </strong>
                        </span>
                        <span>
                          建议触发价:{' '}
                          <strong className="text-[#ff8800]">{fmtNum(selectedProfile.suggestedEntryPrice, 2)}</strong>
                        </span>
                        <span>
                          证伪止损价:{' '}
                          <strong className="text-[#00c853]">
                            {fmtNum(selectedProfile.falsificationStopPrice, 2)}
                          </strong>
                        </span>
                        <span>
                          T+5预期区间:{' '}
                          <strong className="text-[#e5b567]">{selectedProfile.targetPayoffRangeText}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[#9aa5b5]">
                        <span>
                          半Kelly建议仓位:{' '}
                          <strong className="text-[#ff8800]">{fmtNum(selectedProfile.kellySuggestedPct, 1)}%</strong>
                        </span>
                        <span>
                          历史MAE均值: <strong className="text-[#00c853]">{fmtPct(selectedProfile.optimalStopLossMaePct)}</strong>
                        </span>
                        <span>
                          盈亏比PF: <strong className="text-[#dfe6f0]">{fmtNum(selectedProfile.profitFactor, 2)}</strong>
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {/* Dual #0d1015 ECharts Row */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-[1px] bg-[#222832] h-[220px] shrink-0">
                  <div className="bg-[#0d1015] relative">
                    {detailLoading && !assetDetail ? (
                      <div className="h-full flex items-center justify-center text-[11px] text-[#7d8796]">
                        正在渲染历史买点全景图...
                      </div>
                    ) : (
                      <div ref={priceMarkersChartRef} className="w-full h-full" />
                    )}
                  </div>
                  <div className="bg-[#0d1015] relative">
                    {!activeComparisonCurve.length ? (
                      <div className="h-full flex items-center justify-center text-[11px] text-[#7d8796]">
                        暂无净值对比曲线数据
                      </div>
                    ) : (
                      <div ref={curveCompareChartRef} className="w-full h-full" />
                    )}
                  </div>
                </div>
              </div>

              {/* Right-Bottom Pane: Interactive Threshold Lab + Episode Post-Mortem Audit Table */}
              <div className="flex-1 min-h-0 flex flex-col bg-[#0e1117]">
                <PaneHeader
                  title="历史预测事件逐次复盘审计明细 & 阈值实验室"
                  badge={`${activeEpisodes.length} 条记录`}
                  right={
                    <div className="flex items-center gap-1">
                      {(['all', 'deterministic', 'raw'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setEpisodeFilter(mode)}
                          className={`px-1.5 py-0.5 text-[10px] border ${
                            episodeFilter === mode
                              ? 'bg-[#ff8800] border-[#ff8800] text-[#090c10] font-bold'
                              : 'bg-[#0e1117] border-[#222832] text-[#8b95a5]'
                          }`}
                        >
                          {mode === 'all' ? '全部' : mode === 'deterministic' ? '四维确定买点' : '单因子粗糙'}
                        </button>
                      ))}
                    </div>
                  }
                />

                {/* Threshold Lab Controls Strip */}
                <div className="px-2.5 py-1.5 bg-[#11151d] border-b border-[#222832] flex flex-wrap items-center justify-between gap-2 text-[11px] shrink-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[#ff8800] font-bold flex items-center gap-1">
                      <SlidersHorizontal className="w-3 h-3" />
                      阈值重算:
                    </span>
                    <label className="flex items-center gap-1 text-[#8b95a5]">
                      <span>滞后Z阈值</span>
                      <select
                        value={labMaxLagZ}
                        onChange={(e) => setLabMaxLagZ(Number(e.target.value))}
                        className="h-[22px] bg-[#161b24] border border-[#2a3240] text-[#e5b567] px-1 outline-none"
                      >
                        <option value={-0.6}>&lt;= -0.60</option>
                        <option value={-0.85}>&lt;= -0.85</option>
                        <option value={-1.15}>&lt;= -1.15 (标准)</option>
                        <option value={-1.45}>&lt;= -1.45 (严苛)</option>
                        <option value={-1.8}>&lt;= -1.80 (极端)</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1 text-[#8b95a5]">
                      <span>持有天数</span>
                      <select
                        value={labHoldingDays}
                        onChange={(e) => setLabHoldingDays(Number(e.target.value))}
                        className="h-[22px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] px-1 outline-none"
                      >
                        <option value={3}>T+3</option>
                        <option value={5}>T+5</option>
                        <option value={10}>T+10</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1 text-[#cfd8e3] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={labRequireMicro}
                        onChange={(e) => setLabRequireMicro(e.target.checked)}
                      />
                      <span>强制微观VWAP/Back确认</span>
                    </label>
                    <label className="flex items-center gap-1 text-[#cfd8e3] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={labRequireCrowding}
                        onChange={(e) => setLabRequireCrowding(e.target.checked)}
                      />
                      <span>强制拥挤排雷</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {labResult && (
                      <button
                        type="button"
                        onClick={() => setLabResult(null)}
                        className="h-[22px] px-2 bg-[#161b24] border border-[#2a3240] text-[#9aa5b5] hover:text-[#dfe6f0] flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        还原默认
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={labLoading || !selectedSymbol}
                      onClick={handleRunThresholdLab}
                      className="h-[22px] px-2.5 bg-[#ff8800] text-[#090c10] font-bold hover:bg-[#ff9c2a] disabled:opacity-50 flex items-center gap-1"
                    >
                      <Play className="w-3 h-3" />
                      {labLoading ? '重算中...' : '运行阈值回测 & 归档'}
                    </button>
                  </div>
                </div>

                {labError && (
                  <div className="px-2.5 py-1 bg-[#211214] text-[#ff8a8a] text-[11px] shrink-0">
                    {labError}
                  </div>
                )}

                {labResult && (
                  <div className="px-2.5 py-1 bg-[#161b24] border-b border-[#222832] flex flex-wrap items-center gap-4 text-[11px] tabular-nums shrink-0">
                    <span className="text-[#ff8800] font-bold">
                      四维确定性: {labResult.deterministicMetrics.tradeCount}笔 | 胜率{' '}
                      {fmtNum(labResult.deterministicMetrics.winRatePct, 1)}% | 总收益{' '}
                      {fmtPct(labResult.deterministicMetrics.totalReturnPct)} | Sharpe{' '}
                      {fmtNum(labResult.deterministicMetrics.sharpe, 2)} | 最大回撤{' '}
                      {fmtPct(labResult.deterministicMetrics.maxDrawdownPct)}
                    </span>
                    <span className="text-[#8b95a5]">
                      对比粗糙单因子: {labResult.rawMetrics.tradeCount}笔 | 胜率{' '}
                      {fmtNum(labResult.rawMetrics.winRatePct, 1)}% | 总收益{' '}
                      {fmtPct(labResult.rawMetrics.totalReturnPct)} | Sharpe{' '}
                      {fmtNum(labResult.rawMetrics.sharpe, 2)}
                    </span>
                  </div>
                )}

                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="w-table">
                    <thead>
                      <tr>
                        <th className="text-left">历史触发日</th>
                        <th className="text-left">关联PM/事实事件 & 结算</th>
                        <th className="text-left">当时事实脉冲</th>
                        <th className="text-right">滞后Z</th>
                        <th className="text-center">买点等级</th>
                        <th className="text-right">T+1%</th>
                        <th className="text-right">T+5%</th>
                        <th className="text-right">T+10%</th>
                        <th className="text-right">最大回撤MAE%</th>
                        <th className="text-left">复盘定性归因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!activeEpisodes.length ? (
                        <tr>
                          <td colSpan={10} className="text-center py-6 text-[#7d8796]">
                            暂无历史复盘事件样本
                          </td>
                        </tr>
                      ) : (
                        activeEpisodes.map((ep) => (
                          <tr key={ep.episodeId}>
                            <td className="font-mono text-[#e5b567]">{ep.triggerDate}</td>
                            <td className="max-w-[210px] truncate" title={`${ep.pmEventTitle} (${ep.pmResolvedStatus})`}>
                              <span
                                className={`mr-1 px-1 text-[9px] border ${
                                  ep.pmResolvedStatus.includes('YES')
                                    ? 'border-[#ff3535] text-[#ff3535]'
                                    : ep.pmResolvedStatus.includes('NO')
                                    ? 'border-[#00c853] text-[#00c853]'
                                    : 'border-[#f0b90b] text-[#f0b90b]'
                                }`}
                              >
                                {ep.pmResolvedStatus}
                              </span>
                              <span className="text-[#dfe6f0]">{ep.pmEventTitle}</span>
                            </td>
                            <td className="max-w-[170px] truncate text-[#9aa5b5]" title={ep.factShockSummary}>
                              {ep.factShockSummary}
                            </td>
                            <td
                              className={`text-right tabular-nums ${
                                ep.valuationLagZ <= -1.15 ? 'text-[#ff8800] font-bold' : 'text-[#8b95a5]'
                              }`}
                            >
                              {fmtSigned(ep.valuationLagZ, 2)}
                            </td>
                            <td className="text-center">
                              {ep.isDeterministicSetup ? (
                                <span className="px-1.5 py-0 text-[10px] bg-[#241809] border border-[#ff8800] text-[#ff8800]">
                                  四维确定
                                </span>
                              ) : (
                                <span className="px-1.5 py-0 text-[10px] bg-[#161b24] border border-[#252c38] text-[#7d8796]">
                                  单因子粗糙
                                </span>
                              )}
                            </td>
                            <td className={`text-right ${colorUpDown(ep.retT1Pct)}`}>{fmtPct(ep.retT1Pct)}</td>
                            <td className={`text-right font-bold ${colorUpDown(ep.retT5Pct)}`}>
                              {fmtPct(ep.retT5Pct)}
                            </td>
                            <td className={`text-right ${colorUpDown(ep.retT10Pct)}`}>{fmtPct(ep.retT10Pct)}</td>
                            <td className="text-right text-[#00c853]">{fmtPct(ep.maePct)}</td>
                            <td className="max-w-[260px] truncate text-[#cfd8e3]" title={ep.postMortemNote}>
                              {ep.postMortemNote}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 02: 付鹏全球宏观 FICC 框架 · 杠铃策略与专属标的参考 ==================== */}
      {activeTab === 'fupeng-ficc' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
          {/* Top Macro Regime Banner */}
          <div className="bg-[#0e1117] px-3 py-1.5 border-b border-[#222832] flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="px-1.5 py-0.5 text-[10px] bg-[#241809] border border-[#ff8800] text-[#ff8800] font-bold shrink-0">
                付鹏FICC宏观总纲
              </span>
              <span className="text-[12px] font-bold text-[#dfe6f0] truncate">
                {fupengOverview?.macroRegimeHeadline || '正在读取付鹏 FICC 四维宏观坐标轴...'}
              </span>
              <span className="text-[11px] text-[#9aa5b5] truncate hidden xl:inline">
                {fupengOverview?.macroRegimeSummary}
              </span>
            </div>
            <button
              type="button"
              disabled={batchOrdering || !fupengOverview?.baskets?.length}
              onClick={handleBatchBarbellToPaper}
              className="h-[22px] px-2.5 bg-[#ff8800] text-[#090c10] font-bold text-[11px] hover:bg-[#ff9c2a] disabled:opacity-50 flex items-center gap-1 shrink-0"
            >
              <Send className="w-3 h-3" />
              {batchOrdering ? '批量下单中...' : '一键按付鹏杠铃配比批量转入模拟盘'}
            </button>
          </div>

          {fupengError && (
            <div className="px-3 py-1.5 bg-[#211214] text-[#ff8a8a] text-[11px] shrink-0">
              付鹏FICC数据异常: {fupengError}
            </div>
          )}

          {/* 4 Live FICC Coordinates Gauge Strip */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-[1px] bg-[#222832] shrink-0">
            {(fupengOverview?.coordinates || []).map((coord) => (
              <div key={coord.id} className="bg-[#0e1117] px-2.5 py-1.5 flex flex-col justify-between gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-[#dfe6f0] truncate">{coord.name}</span>
                  <span className="px-1.5 py-0 text-[10px] bg-[#161b24] border border-[#2a3240] text-[#ff8800] shrink-0">
                    {coord.signalBias}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 tabular-nums">
                  <span className="text-[14px] font-bold text-[#e5b567]">{coord.currentValueText}</span>
                  <span className="text-[11px] text-[#9aa5b5]">{coord.change20dText}</span>
                </div>
                <div className="text-[10px] text-[#8b95a5] truncate" title={coord.regimeReading}>
                  {coord.regimeReading}
                </div>
              </div>
            ))}
          </div>

          {/* Main Split: Left 54% Six Baskets Matrix | Right 46% Barbell Backtest Terminal */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-[1px] bg-[#222832] overflow-hidden">
            {/* Left Split (~54%) */}
            <div className="w-full lg:w-[54%] min-h-0 flex flex-col bg-[#0e1117]">
              <PaneHeader
                title="付鹏框架六大交易篮子 · 实时标的参考矩阵"
                badge={`${fupengOverview?.baskets?.length || 0} 大策略池`}
                right={
                  <div className="flex items-center gap-1 overflow-x-auto max-w-[360px]">
                    <button
                      type="button"
                      onClick={() => setSelectedBasketId('all')}
                      className={`px-1.5 py-0.5 text-[10px] border shrink-0 ${
                        selectedBasketId === 'all'
                          ? 'bg-[#ff8800] border-[#ff8800] text-[#090c10] font-bold'
                          : 'bg-[#0e1117] border-[#222832] text-[#8b95a5]'
                      }`}
                    >
                      全部展开
                    </button>
                    {(fupengOverview?.baskets || []).map((b, idx) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setSelectedBasketId(b.id)}
                        className={`px-1.5 py-0.5 text-[10px] border shrink-0 ${
                          selectedBasketId === b.id
                            ? 'bg-[#ff8800] border-[#ff8800] text-[#090c10] font-bold'
                            : 'bg-[#0e1117] border-[#222832] text-[#8b95a5]'
                        }`}
                      >
                        {`0${idx + 1}`}
                      </button>
                    ))}
                  </div>
                }
              />

              <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-[1px] bg-[#222832]">
                {visibleBaskets.map((basket: FupengTradableBasket) => (
                  <div key={basket.id} className="bg-[#0e1117] flex flex-col">
                    <div className="px-2.5 py-1.5 bg-[#131822] border-b border-[#222832] flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-bold text-[#dfe6f0]">{basket.name}</span>
                        <span
                          className={`px-1.5 py-0 text-[10px] border ${regimeFitBadgeClass(
                            basket.currentRegimeFit
                          )}`}
                        >
                          {basket.currentRegimeFit}
                        </span>
                        <span className="text-[10px] text-[#e5b567] tabular-nums">
                          建议配比 {fmtNum(basket.recommendedAllocationPct, 0)}%
                        </span>
                      </div>
                      <div className="text-[10px] text-[#8b95a5] truncate max-w-full" title={basket.thesisSummary}>
                        {basket.thesisSummary}
                      </div>
                    </div>
                    <table className="w-table">
                      <thead>
                        <tr>
                          <th className="text-left">代码</th>
                          <th className="text-left">名称</th>
                          <th className="text-right">现价/涨跌%</th>
                          <th className="text-left">付鹏框架定位</th>
                          <th className="text-left">核心参与条件(定量)</th>
                          <th className="text-left">逻辑证伪离场线</th>
                          <th className="text-right">配比%</th>
                          <th className="text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {basket.targets.map((t) => {
                          const key = `fp_${basket.id}_${t.symbol}`;
                          const busy = paperBusyKey === key;
                          const futures = isFuturesCode(t.symbol);
                          const action: 'buy_long' | 'open_short' =
                            t.direction === '空头对冲/规避' && futures ? 'open_short' : 'buy_long';
                          return (
                            <tr key={key}>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => onSelectStock(t.symbol, t.name)}
                                  className="text-[#e5b567] font-mono font-bold hover:underline"
                                >
                                  {t.symbol}
                                </button>
                              </td>
                              <td className="text-[#dfe6f0]">{t.name}</td>
                              <td className="text-right tabular-nums">
                                <span className="text-[#dfe6f0] mr-1">{fmtNum(t.price, 2)}</span>
                                <span className={colorUpDown(t.changePct)}>{fmtPct(t.changePct)}</span>
                              </td>
                              <td className="max-w-[140px] truncate" title={`${t.frameworkRole} (${t.direction})`}>
                                <span
                                  className={`mr-1 px-1 text-[9px] border ${
                                    t.direction.includes('空')
                                      ? 'border-[#00c853] text-[#00c853]'
                                      : 'border-[#ff8800] text-[#ff8800]'
                                  }`}
                                >
                                  {t.direction}
                                </span>
                                <span className="text-[#9aa5b5]">{t.frameworkRole}</span>
                              </td>
                              <td className="max-w-[170px] truncate text-[#cfd8e3]" title={t.entryTriggerRule}>
                                {t.entryTriggerRule}
                              </td>
                              <td className="max-w-[160px] truncate text-[#7d8796]" title={t.falsificationRule}>
                                {t.falsificationRule}
                              </td>
                              <td className="text-right text-[#e5b567] font-bold">
                                {fmtNum(t.suggestedWeightPct, 0)}%
                              </td>
                              <td className="text-right">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => onSelectStock(t.symbol, t.name)}
                                    className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] hover:border-[#ff8800]"
                                  >
                                    K线
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      handleSendToPaperDesk({
                                        key,
                                        rawSymbol: t.symbol,
                                        name: t.name,
                                        action,
                                        capitalAllocationPct: t.suggestedWeightPct || 10,
                                        price: t.price,
                                        strategyTag: '付鹏FICC杠铃',
                                        note: `${basket.name} | ${t.frameworkRole}`,
                                      })
                                    }
                                    className="px-1.5 py-0.5 text-[10px] bg-[#241809] border border-[#ff8800] text-[#ff8800] hover:bg-[#ff8800] hover:text-[#090c10] disabled:opacity-50"
                                  >
                                    {busy ? '...' : '转入模拟盘'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Split (~46%): Fu Peng Dynamic Barbell Backtest Terminal */}
            <div className="w-full lg:w-[46%] min-h-0 flex flex-col bg-[#0e1117]">
              <PaneHeader
                title="付鹏动态杠铃 FICC 组合 vs 沪深300 vs 静态等权 实盘回测"
                badge={bbResult ? `${bbResult.startDate} ~ ${bbResult.endDate}` : '动态拥挤去杠杆门控'}
                right={
                  <button
                    type="button"
                    disabled={bbLoading}
                    onClick={runBarbellBacktest}
                    className="h-[20px] px-2 bg-[#ff8800] text-[#090c10] font-bold hover:bg-[#ff9c2a] disabled:opacity-50 flex items-center gap-1"
                  >
                    <Play className="w-3 h-3" />
                    {bbLoading ? '回测中...' : '运行杠铃回测'}
                  </button>
                }
              />

              {/* Barbell Parameters Strip */}
              <div className="px-2.5 py-1.5 bg-[#11151d] border-b border-[#222832] flex flex-wrap items-center gap-2 text-[11px] shrink-0">
                <label className="flex items-center gap-1 text-[#8b95a5]">
                  <span>红利防御%</span>
                  <input
                    type="number"
                    min={10}
                    max={80}
                    value={bbDivWeight}
                    onChange={(e) => setBbDivWeight(Number(e.target.value))}
                    className="w-[48px] h-[22px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] px-1 outline-none tabular-nums"
                  />
                </label>
                <label className="flex items-center gap-1 text-[#8b95a5]">
                  <span>AI硬瓶颈上限%</span>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={bbAiMaxWeight}
                    onChange={(e) => setBbAiMaxWeight(Number(e.target.value))}
                    className="w-[48px] h-[22px] bg-[#161b24] border border-[#2a3240] text-[#ff8800] px-1 outline-none tabular-nums"
                  />
                </label>
                <label className="flex items-center gap-1 text-[#8b95a5]">
                  <span>黄金底仓%</span>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={bbGoldWeight}
                    onChange={(e) => setBbGoldWeight(Number(e.target.value))}
                    className="w-[48px] h-[22px] bg-[#161b24] border border-[#2a3240] text-[#e5b567] px-1 outline-none tabular-nums"
                  />
                </label>
                <label className="flex items-center gap-1 text-[#8b95a5]">
                  <span>天数</span>
                  <select
                    value={bbDays}
                    onChange={(e) => setBbDays(Number(e.target.value))}
                    className="h-[22px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] px-1 outline-none"
                  >
                    <option value={60}>60d</option>
                    <option value={120}>120d</option>
                    <option value={180}>180d</option>
                    <option value={240}>240d</option>
                  </select>
                </label>
                <label className="flex items-center gap-1 text-[#cfd8e3] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bbDeleverage}
                    onChange={(e) => setBbDeleverage(e.target.checked)}
                  />
                  <span>高拥挤自动去杠杆</span>
                </label>
              </div>

              {bbError && (
                <div className="px-2.5 py-1 bg-[#211214] text-[#ff8a8a] text-[11px] shrink-0">{bbError}</div>
              )}

              {/* Barbell KPI Strip */}
              <div className="grid grid-cols-4 gap-[1px] bg-[#222832] border-b border-[#222832] shrink-0">
                <KpiCell
                  label="动态杠铃总收益"
                  value={bbResult ? fmtPct(bbResult.barbellMetrics.totalReturnPct) : '--'}
                  sub={bbResult ? `静态等权 ${fmtPct(bbResult.staticEqualMetrics.totalReturnPct)}` : ''}
                  tone={bbResult && bbResult.barbellMetrics.totalReturnPct >= 0 ? 'up' : 'down'}
                />
                <KpiCell
                  label="超额沪深300"
                  value={bbResult ? fmtPct(bbResult.barbellMetrics.excessVsHs300Pct) : '--'}
                  sub={bbResult ? `HS300 ${fmtPct(bbResult.hs300BenchmarkPct)}` : ''}
                  tone="orange"
                />
                <KpiCell
                  label="Sharpe / Calmar"
                  value={
                    bbResult
                      ? `${fmtNum(bbResult.barbellMetrics.sharpe, 2)} / ${fmtNum(
                          bbResult.barbellMetrics.calmar,
                          2
                        )}`
                      : '--'
                  }
                  sub={bbResult ? `等权Sharpe ${fmtNum(bbResult.staticEqualMetrics.sharpe, 2)}` : ''}
                  tone="gold"
                />
                <KpiCell
                  label="最大回撤 / 去杠杆"
                  value={
                    bbResult
                      ? `${fmtPct(bbResult.barbellMetrics.maxDrawdownPct)} / ${
                          bbResult.deleverageEventsCount
                        }次`
                      : '--'
                  }
                  sub={bbResult ? `月胜率 ${fmtNum(bbResult.barbellMetrics.winRateMonthsPct, 0)}%` : ''}
                  tone="down"
                />
              </div>

              {/* 3-line Equity + AI Weight + Drawdown Chart */}
              <div className="h-[260px] bg-[#0d1015] border-b border-[#222832] shrink-0">
                {bbLoading && !bbResult ? (
                  <div className="h-full flex items-center justify-center text-[11px] text-[#7d8796]">
                    正在运行付鹏动态杠铃组合实盘回测...
                  </div>
                ) : (
                  <div ref={barbellChartRef} className="w-full h-full" />
                )}
              </div>

              {/* Rebalance & Deleverage Trigger Logs */}
              <PaneHeader
                title="动态杠铃调仓与去杠杆触发日志"
                badge={bbResult ? `${bbResult.rebalanceLogs.length} 条记录` : undefined}
              />
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-left">日期</th>
                      <th className="text-left">触发动作</th>
                      <th className="text-left">付鹏FICC触发原因</th>
                      <th className="text-left">目标权重分配</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!bbResult?.rebalanceLogs?.length ? (
                      <tr>
                        <td colSpan={4} className="text-center py-5 text-[#7d8796]">
                          暂无调仓日志
                        </td>
                      </tr>
                    ) : (
                      bbResult.rebalanceLogs.map((log, idx) => (
                        <tr key={`${log.date}_${idx}`}>
                          <td className="font-mono text-[#e5b567]">{log.date}</td>
                          <td className="text-[#ff8800] font-semibold">{log.action}</td>
                          <td className="max-w-[200px] truncate text-[#cfd8e3]" title={log.reason}>
                            {log.reason}
                          </td>
                          <td className="text-[#9aa5b5] tabular-nums">{log.weightsText}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 03: 付鹏老师 24小时全网动态实时抓取流 & 观点映射解析 ==================== */}
      {activeTab === 'fupeng-24h' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
          {/* Top 24x7 Watcher Status Bar */}
          <div className="bg-[#0e1117] px-3 py-1.5 border-b border-[#222832] flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1 text-[#00c853] font-bold">
                <Radio className="w-3.5 h-3.5" />
                后台{Math.round((fupengOverview?.watcherDaemonStatus?.intervalSec || 600) / 60)}分钟自动巡检:{' '}
                {fupengOverview?.watcherDaemonStatus?.enabled ? '开启' : '待命'}
              </span>
              <span className="text-[#9aa5b5] tabular-nums">
                最近抓取: {shortTime(fupengOverview?.watcherDaemonStatus?.lastScrapedAt)}
              </span>
              <span className="text-[#e5b567] tabular-nums flex items-center gap-1">
                <Database className="w-3 h-3" />
                SQLite 永久存储: {fupengOverview?.watcherDaemonStatus?.totalStoredIntelCount ?? 0} 条
              </span>
              {scrapeStatusMsg && (
                <span className="px-2 py-0.5 bg-[#161b24] border border-[#ff8800] text-[#ff8800]">
                  {scrapeStatusMsg}
                </span>
              )}
            </div>

            <button
              type="button"
              disabled={scrapingNow}
              onClick={handleScrapeNow}
              className="h-[24px] px-3 bg-[#ff8800] text-[#090c10] font-bold text-[11px] hover:bg-[#ff9c2a] disabled:opacity-50 flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${scrapingNow ? 'animate-spin' : ''}`} />
              {scrapingNow ? '全网多渠道并发抓取中...' : '立即全网抓取付鹏最新动态'}
            </button>
          </div>

          {/* 6 Scraper Channels Matrix */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-[1px] bg-[#222832] shrink-0">
            {(fupengOverview?.scraperChannels || []).map((ch) => (
              <div key={ch.id} className="bg-[#0e1117] px-2.5 py-1.5 flex flex-col justify-between gap-0.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-bold text-[#dfe6f0] truncate">{ch.name}</span>
                  <span
                    className={`px-1 text-[9px] border shrink-0 ${
                      ch.ok
                        ? 'bg-[#0c2116] border-[#00c853] text-[#00c853]'
                        : 'bg-[#261114] border-[#ff3535] text-[#ff3535]'
                    }`}
                  >
                    {ch.ok ? '在线' : '降级'}
                  </span>
                </div>
                <div className="text-[10px] text-[#8b95a5] flex items-center justify-between tabular-nums">
                  <span className="truncate">{ch.method}</span>
                  <span className="text-[#e5b567] shrink-0">
                    {ch.fetchedCount}条 / {ch.latencyMs}ms
                  </span>
                </div>
                <div className="text-[10px] text-[#6d7787] truncate" title={ch.detail}>
                  {ch.detail}
                </div>
              </div>
            ))}
          </div>

          {/* Main Split: Left 60% Intel Feed | Right 40% Live Paste & Parse Desk */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-[1px] bg-[#222832] overflow-hidden">
            {/* Left (~60%): Filterable Chronological Intel Stream */}
            <div className="w-full lg:w-[60%] min-h-0 flex flex-col bg-[#0e1117]">
              <PaneHeader
                title="付鹏最新言论 · 访谈 · 专栏实时情报流"
                badge={`${filteredIntelFeed.length} 条`}
                right={
                  <div className="flex items-center gap-1.5">
                    <Filter className="w-3 h-3 text-[#8b95a5]" />
                    <input
                      type="text"
                      value={intelSearch}
                      onChange={(e) => setIntelSearch(e.target.value)}
                      placeholder="搜关键词/标的..."
                      className="h-[20px] w-[130px] bg-[#0e1117] border border-[#222832] text-[#dfe6f0] px-1.5 text-[10px] outline-none"
                    />
                  </div>
                }
              />

              {/* FICC Pillar Filter Ribbon */}
              <div className="px-2.5 py-1.5 bg-[#11151d] border-b border-[#222832] flex flex-wrap items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setPillarFilter('all')}
                  className={`px-1.5 py-0.5 text-[10px] border ${
                    pillarFilter === 'all'
                      ? 'bg-[#ff8800] border-[#ff8800] text-[#090c10] font-bold'
                      : 'bg-[#161b24] border-[#222832] text-[#9aa5b5]'
                  }`}
                >
                  全部FICC支柱
                </button>
                {FUPENG_PILLARS.map((pl) => (
                  <button
                    key={pl}
                    type="button"
                    onClick={() => setPillarFilter(pl)}
                    className={`px-1.5 py-0.5 text-[10px] border ${
                      pillarFilter === pl
                        ? 'bg-[#ff8800] border-[#ff8800] text-[#090c10] font-bold'
                        : 'bg-[#161b24] border-[#222832] text-[#9aa5b5] hover:text-[#dfe6f0]'
                    }`}
                  >
                    {pl}
                  </button>
                ))}
              </div>

              <div className="flex-1 min-h-0 overflow-auto divide-y divide-[#1b2230]">
                {!filteredIntelFeed.length ? (
                  <div className="p-8 text-center text-[11px] text-[#7d8796]">
                    暂无匹配的付鹏动态记录，请点击右上角「立即全网抓取付鹏最新动态」或右侧投喂解析
                  </div>
                ) : (
                  filteredIntelFeed.map((item) => (
                    <div key={item.id} className="p-2.5 hover:bg-[#131923] flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[#e5b567] tabular-nums">
                            {shortTime(item.publishedAt || item.capturedAt)}
                          </span>
                          <span className="px-1.5 py-0 bg-[#161b24] border border-[#2a3240] text-[#4da3ff]">
                            {item.sourceChannel}
                          </span>
                          <span className="px-1.5 py-0 bg-[#161b24] border border-[#252c38] text-[#dfe6f0]">
                            {item.pillar}
                          </span>
                          <span className={`px-1.5 py-0 border ${stanceBadgeClass(item.stance)}`}>
                            {item.stance}
                          </span>
                        </div>
                        <span className="text-[#7d8796] tabular-nums">
                          置信度 {fmtNum(item.confidenceScore, 0)}%
                        </span>
                      </div>

                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[12px] font-bold text-[#dfe6f0] leading-snug">{item.title}</div>
                        {item.url && item.url.startsWith('http') && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-[#4da3ff] hover:underline flex items-center gap-0.5 shrink-0"
                          >
                            原文
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      <div className="text-[11px] text-[#9aa5b5] leading-relaxed">{item.summary}</div>

                      {/* Mapped Tradeable Tickets Strip */}
                      {item.mappedTargets?.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <span className="text-[10px] text-[#7d8796]">映射交易标的:</span>
                          {item.mappedTargets.map((mt) => {
                            const futures = isFuturesCode(mt.symbol);
                            const canOrder = mt.direction !== '做空' || futures;
                            const ordKey = `intel_${item.id}_${mt.symbol}`;
                            return (
                              <div
                                key={`${item.id}_${mt.symbol}`}
                                className="inline-flex items-center bg-[#161b24] border border-[#252c38] text-[10px]"
                              >
                                <button
                                  type="button"
                                  onClick={() => onSelectStock(mt.symbol, mt.name)}
                                  className="px-1.5 py-0.5 hover:bg-[#1f293a] flex items-center gap-1"
                                >
                                  <span className="text-[#e5b567] font-mono font-bold">{mt.symbol}</span>
                                  <span className="text-[#dfe6f0]">{mt.name}</span>
                                  <span
                                    className={
                                      mt.direction === '做多'
                                        ? 'text-[#ff3535]'
                                        : mt.direction === '做空'
                                        ? 'text-[#00c853]'
                                        : 'text-[#f0b90b]'
                                    }
                                  >
                                    {mt.direction === '做多' ? '+多' : mt.direction === '做空' ? '-空' : '门控观察'}
                                  </span>
                                </button>
                                {canOrder && mt.direction !== '门控观察' && (
                                  <button
                                    type="button"
                                    disabled={paperBusyKey === ordKey}
                                    onClick={() =>
                                      handleSendToPaperDesk({
                                        key: ordKey,
                                        rawSymbol: mt.symbol,
                                        name: mt.name,
                                        action: mt.direction === '做空' && futures ? 'open_short' : 'buy_long',
                                        capitalAllocationPct: 10,
                                        strategyTag: '付鹏情报映射',
                                        note: `${item.title} | ${item.pillar}`,
                                      })
                                    }
                                    className="px-1.5 py-0.5 border-l border-[#252c38] text-[#ff8800] hover:bg-[#ff8800] hover:text-[#090c10]"
                                  >
                                    {paperBusyKey === ordKey ? '...' : '下单'}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right (~40%): Live Paste & Quant Mapping Desk */}
            <div className="w-full lg:w-[40%] min-h-0 flex flex-col bg-[#0e1117]">
              <PaneHeader
                title="付鹏最新访谈/视频文稿/微博 实时粘贴量化解析台"
                badge="SQLite 永久入库"
              />
              <div className="p-3 flex flex-col gap-2.5 overflow-auto flex-1 min-h-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-[#7d8796]">快速示例:</span>
                  {SAMPLE_FUPENG_NOTES.map((sp) => (
                    <button
                      key={sp.label}
                      type="button"
                      onClick={() => {
                        setNoteTitle(sp.title);
                        setNoteContent(sp.content);
                      }}
                      className="px-2 py-0.5 text-[10px] bg-[#161b24] border border-[#2a3240] text-[#e5b567] hover:border-[#ff8800]"
                    >
                      {sp.label}
                    </button>
                  ))}
                </div>

                <label className="flex flex-col gap-1 text-[11px] text-[#8b95a5]">
                  <span>言论标题 / 演讲场次</span>
                  <input
                    type="text"
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder="例如：付鹏2026最新内部Macro闭门会纪要"
                    className="h-[28px] bg-[#11151d] border border-[#252c38] text-[#dfe6f0] px-2 outline-none focus:border-[#ff8800]"
                  />
                </label>

                <label className="flex flex-col gap-1 text-[11px] text-[#8b95a5]">
                  <span>来源链接 (可选)</span>
                  <input
                    type="text"
                    value={noteUrl}
                    onChange={(e) => setNoteUrl(e.target.value)}
                    placeholder="https://..."
                    className="h-[28px] bg-[#11151d] border border-[#252c38] text-[#dfe6f0] px-2 outline-none focus:border-[#ff8800]"
                  />
                </label>

                <label className="flex flex-col gap-1 text-[11px] text-[#8b95a5]">
                  <span>粘贴付鹏最新直播逐字稿 / 微博全文 / 专栏摘要</span>
                  <textarea
                    rows={7}
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="粘贴付鹏老师关于黄金、美债、AI算力拥挤度、日元Carry拆仓、红利高股息或商品Back结构的最新原话，系统将自动打上FICC支柱标签并映射可执行期货/A股标的..."
                    className="bg-[#11151d] border border-[#252c38] text-[#dfe6f0] p-2 text-[11px] leading-relaxed outline-none focus:border-[#ff8800] resize-y"
                  />
                </label>

                {ingestError && (
                  <div className="px-2.5 py-1.5 bg-[#211214] border border-[#ff3535] text-[#ff9f9f] text-[11px]">
                    {ingestError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={ingestingNote}
                  onClick={handleIngestNote}
                  className="h-[30px] bg-[#ff8800] text-[#090c10] font-bold text-[12px] hover:bg-[#ff9c2a] disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {ingestingNote ? '正在量化解析并写入 SQLite...' : '解析并映射至FICC交易标的'}
                </button>

                {lastIngestedItem && (
                  <div className="mt-1 bg-[#11151d] border border-[#ff8800] p-2.5 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-[#ff8800] font-bold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        解析入库成功 · FICC 支柱映射完成
                      </span>
                      <span className={`px-1.5 py-0 text-[10px] border ${stanceBadgeClass(lastIngestedItem.stance)}`}>
                        {lastIngestedItem.stance}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#dfe6f0] font-bold">{lastIngestedItem.title}</div>
                    <div className="text-[10px] text-[#e5b567]">
                      归属支柱: {lastIngestedItem.pillar} · 置信度 {fmtNum(lastIngestedItem.confidenceScore, 0)}%
                    </div>
                    <div className="text-[11px] text-[#9aa5b5] leading-relaxed">{lastIngestedItem.summary}</div>
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[#222832]">
                      {lastIngestedItem.mappedTargets.map((mt) => {
                        const futures = isFuturesCode(mt.symbol);
                        const canOrder = mt.direction !== '做空' || futures;
                        const k = `ing_${lastIngestedItem.id}_${mt.symbol}`;
                        return (
                          <div
                            key={k}
                            className="inline-flex items-center bg-[#161b24] border border-[#2a3240] text-[10px]"
                          >
                            <button
                              type="button"
                              onClick={() => onSelectStock(mt.symbol, mt.name)}
                              className="px-2 py-0.5 text-[#dfe6f0] hover:text-[#ff8800]"
                            >
                              <span className="text-[#e5b567] font-mono mr-1">{mt.symbol}</span>
                              {mt.name} ({mt.direction})
                            </button>
                            {canOrder && mt.direction !== '门控观察' && (
                              <button
                                type="button"
                                disabled={paperBusyKey === k}
                                onClick={() =>
                                  handleSendToPaperDesk({
                                    key: k,
                                    rawSymbol: mt.symbol,
                                    name: mt.name,
                                    action: mt.direction === '做空' && futures ? 'open_short' : 'buy_long',
                                    capitalAllocationPct: 10,
                                    strategyTag: '付鹏纪要解析',
                                    note: lastIngestedItem.title,
                                  })
                                }
                                className="px-2 py-0.5 bg-[#241809] border-l border-[#ff8800] text-[#ff8800] hover:bg-[#ff8800] hover:text-[#090c10]"
                              >
                                转入模拟盘
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-auto pt-2 border-t border-[#222832] text-[10px] text-[#6d7787] flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-[#8b95a5]">
                    <Activity className="w-3 h-3 text-[#ff8800]" />
                    24h 静默守护脚本路径:
                  </div>
                  <code className="bg-[#090c10] border border-[#222832] px-2 py-1 text-[#e5b567] break-all">
                    {fupengOverview?.watcherDaemonStatus?.egoWatcherScriptPath ||
                      'scripts/ego_fupeng_24h_watcher.mjs'}
                  </code>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 04: 确定买点阈值实验室 · 18标的横向审计与模拟联动 ==================== */}
      {activeTab === 'threshold-lab' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
          {/* Top Action & Parameter Strip */}
          <div className="bg-[#0e1117] px-3 py-1.5 border-b border-[#222832] flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-[#ff8800] font-bold flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" />
                阈值实验室参数:
              </span>
              <label className="flex items-center gap-1 text-[#8b95a5]">
                <span>目标标的</span>
                <select
                  value={selectedSymbol}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                  className="h-[22px] bg-[#161b24] border border-[#2a3240] text-[#e5b567] px-1.5 outline-none"
                >
                  {(factOverview?.profiles || []).map((p) => (
                    <option key={p.symbol} value={p.symbol}>
                      {p.symbol} {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-[#8b95a5]">
                <span>回测窗口</span>
                <select
                  value={labDays}
                  onChange={(e) => setLabDays(Number(e.target.value))}
                  className="h-[22px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] px-1 outline-none"
                >
                  <option value={90}>90d</option>
                  <option value={120}>120d</option>
                  <option value={180}>180d</option>
                  <option value={240}>240d</option>
                </select>
              </label>
              <label className="flex items-center gap-1 text-[#8b95a5]">
                <span>滞后Z上限</span>
                <select
                  value={labMaxLagZ}
                  onChange={(e) => setLabMaxLagZ(Number(e.target.value))}
                  className="h-[22px] bg-[#161b24] border border-[#2a3240] text-[#e5b567] px-1 outline-none"
                >
                  <option value={-0.6}>-0.60</option>
                  <option value={-0.85}>-0.85</option>
                  <option value={-1.15}>-1.15</option>
                  <option value={-1.45}>-1.45</option>
                  <option value={-1.8}>-1.80</option>
                </select>
              </label>
              <label className="flex items-center gap-1 text-[#8b95a5]">
                <span>持有</span>
                <select
                  value={labHoldingDays}
                  onChange={(e) => setLabHoldingDays(Number(e.target.value))}
                  className="h-[22px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] px-1 outline-none"
                >
                  <option value={3}>3d</option>
                  <option value={5}>5d</option>
                  <option value={10}>10d</option>
                </select>
              </label>
              <button
                type="button"
                disabled={labLoading}
                onClick={handleRunThresholdLab}
                className="h-[22px] px-2.5 bg-[#ff8800] text-[#090c10] font-bold hover:bg-[#ff9c2a] disabled:opacity-50 flex items-center gap-1"
              >
                <Play className="w-3 h-3" />
                {labLoading ? '计算中...' : '运行定制回测'}
              </button>
            </div>

            <button
              type="button"
              disabled={batchOrdering}
              onClick={handleBatch4of4ToPaper}
              className="h-[22px] px-2.5 bg-[#241809] border border-[#ff8800] text-[#ff8800] font-bold text-[11px] hover:bg-[#ff8800] hover:text-[#090c10] disabled:opacity-50 flex items-center gap-1"
            >
              <ShieldCheck className="w-3 h-3" />
              一键将全部 4/4 确定性买点转入模拟实盘舱
            </button>
          </div>

          {/* Two Charts Top Half */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[1px] bg-[#222832] h-[250px] shrink-0">
            <div className="bg-[#0d1015]">
              <div ref={crossAssetBarChartRef} className="w-full h-full" />
            </div>
            <div className="bg-[#0d1015] relative">
              {!labResult ? (
                <div className="h-full flex items-center justify-center text-[11px] text-[#7d8796]">
                  {labLoading ? '正在计算阈值实验室回测曲线...' : '点击「运行定制回测」生成对比净值曲线'}
                </div>
              ) : (
                <div ref={labEquityChartRef} className="w-full h-full" />
              )}
            </div>
          </div>

          {/* Lab Metrics Strip */}
          {labResult && (
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-[1px] bg-[#222832] shrink-0">
              <KpiCell
                label="确定性买点触发次数"
                value={`${labResult.deterministicMetrics.tradeCount} 笔`}
                sub={`粗糙触发 ${labResult.rawMetrics.tradeCount} 笔`}
                tone="gold"
              />
              <KpiCell
                label="确定性胜率 vs 粗糙胜率"
                value={`${fmtNum(labResult.deterministicMetrics.winRatePct, 1)}%`}
                sub={`粗糙 ${fmtNum(labResult.rawMetrics.winRatePct, 1)}%`}
                tone="orange"
              />
              <KpiCell
                label="策略累计收益"
                value={fmtPct(labResult.deterministicMetrics.totalReturnPct)}
                sub={`粗糙 ${fmtPct(labResult.rawMetrics.totalReturnPct)}`}
                tone={labResult.deterministicMetrics.totalReturnPct >= 0 ? 'up' : 'down'}
              />
              <KpiCell
                label="Sharpe Ratio"
                value={fmtNum(labResult.deterministicMetrics.sharpe, 2)}
                sub={`粗糙 ${fmtNum(labResult.rawMetrics.sharpe, 2)}`}
                tone="blue"
              />
              <KpiCell
                label="最大回撤 MDD"
                value={fmtPct(labResult.deterministicMetrics.maxDrawdownPct)}
                sub={`粗糙 ${fmtPct(labResult.rawMetrics.maxDrawdownPct)}`}
                tone="down"
              />
              <KpiCell
                label="单笔均益 / PF"
                value={`${fmtPct(labResult.deterministicMetrics.avgTradePct)} / ${fmtNum(
                  labResult.deterministicMetrics.profitFactor,
                  2
                )}`}
                sub={labResult.executionRule}
                tone="neutral"
              />
            </div>
          )}

          {/* Cross-Asset 18-Symbol Audit Comparison Matrix */}
          <div className="flex-1 min-h-0 flex flex-col bg-[#0e1117]">
            <PaneHeader
              title="18大核心标的确定性买点横向审计矩阵"
              badge="粗糙单因子 vs 四维共振"
              right={
                <span className="text-[10px] text-[#8b95a5] flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-[#ff8800]" />
                  点击行载入实验室
                </span>
              }
            />
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-table">
                <thead>
                  <tr>
                    <th className="text-left">代码</th>
                    <th className="text-left">名称</th>
                    <th className="text-left">原型分类</th>
                    <th className="text-right">总样本</th>
                    <th className="text-right">粗糙胜率</th>
                    <th className="text-right">确定买点胜率</th>
                    <th className="text-right">胜率提升</th>
                    <th className="text-right">T+5均益</th>
                    <th className="text-right">T+10均益</th>
                    <th className="text-right">历史MAE</th>
                    <th className="text-right">盈亏比PF</th>
                    <th className="text-center">当前就绪</th>
                    <th className="text-right">半Kelly</th>
                    <th className="text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(factOverview?.profiles || []).map((p) => {
                    const lift = safeNum(p.deterministicWinRatePct) - safeNum(p.rawWinRatePct);
                    const active = p.symbol === selectedSymbol;
                    return (
                      <tr
                        key={p.symbol}
                        onClick={() => setSelectedSymbol(p.symbol)}
                        className={`cursor-pointer ${
                          active ? '!bg-[#1f293a] outline outline-1 outline-[#ff8800]' : ''
                        }`}
                      >
                        <td className="text-[#e5b567] font-mono font-bold">{p.symbol}</td>
                        <td className="text-[#dfe6f0]">{p.name}</td>
                        <td className="text-[#8b95a5]">{p.archetypeLabel}</td>
                        <td className="text-right tabular-nums text-[#cfd8e3]">{p.totalHistoricalEpisodes}</td>
                        <td className="text-right tabular-nums text-[#7d8796]">
                          {fmtNum(p.rawWinRatePct, 1)}%
                        </td>
                        <td className="text-right tabular-nums text-[#ff8800] font-bold">
                          {fmtNum(p.deterministicWinRatePct, 1)}%
                        </td>
                        <td className={`text-right tabular-nums ${lift >= 0 ? 'text-[#ff3535]' : 'text-[#00c853]'}`}>
                          +{fmtNum(lift, 1)}pp
                        </td>
                        <td className={`text-right ${colorUpDown(p.deterministicAvgRetT5Pct)}`}>
                          {fmtPct(p.deterministicAvgRetT5Pct)}
                        </td>
                        <td className={`text-right ${colorUpDown(p.deterministicAvgRetT10Pct)}`}>
                          {fmtPct(p.deterministicAvgRetT10Pct)}
                        </td>
                        <td className="text-right text-[#00c853]">{fmtPct(p.optimalStopLossMaePct)}</td>
                        <td className="text-right text-[#e5b567]">{fmtNum(p.profitFactor, 2)}</td>
                        <td className={`text-center ${readinessColorClass(p.passedConditionsCount)}`}>
                          {p.passedConditionsCount}/4
                        </td>
                        <td className="text-right text-[#dfe6f0]">{fmtNum(p.kellySuggestedPct, 1)}%</td>
                        <td className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSymbol(p.symbol);
                                api
                                  .runFactBuyPointBacktest({
                                    symbol: p.symbol,
                                    days: labDays,
                                    maxLagZ: labMaxLagZ,
                                    requireMicroConfirm: labRequireMicro,
                                    requireCrowdingSafe: labRequireCrowding,
                                    holdingDays: labHoldingDays,
                                    stopLossPct: 4,
                                  })
                                  .then(setLabResult)
                                  .catch((err) =>
                                    setLabError(err instanceof Error ? err.message : '回测失败')
                                  );
                              }}
                              className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] hover:border-[#ff8800]"
                            >
                              测算
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleSendToPaperDesk({
                                  key: `lab_${p.symbol}`,
                                  rawSymbol: p.symbol,
                                  name: p.name,
                                  action:
                                    p.recommendedSide === '做空' && p.market === '国内期货'
                                      ? 'open_short'
                                      : 'buy_long',
                                  capitalAllocationPct: p.kellySuggestedPct || 10,
                                  price: p.lastPrice,
                                  strategyTag: 'V7阈值实验室',
                                  note: `确定胜率${fmtNum(p.deterministicWinRatePct, 1)}% | PF ${fmtNum(
                                    p.profitFactor,
                                    2
                                  )}`,
                                })
                              }
                              className="px-1.5 py-0.5 text-[10px] bg-[#241809] border border-[#ff8800] text-[#ff8800] hover:bg-[#ff8800] hover:text-[#090c10]"
                            >
                              模拟建仓
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Subtle Loading Indicator when both top-level datasets are absent */}
      {!factOverview && !fupengOverview && (factLoading || fupengLoading) && (
        <div className="px-3 py-1 bg-[#11151d] border-t border-[#222832] text-[10px] text-[#8b95a5] flex items-center gap-1.5 shrink-0">
          <AlertTriangle className="w-3 h-3 text-[#ff8800]" />
          正在初始化 V7 多标的专属事实因子历史复盘引擎与付鹏24h宏观终端...
        </div>
      )}
    </div>
  );
}
