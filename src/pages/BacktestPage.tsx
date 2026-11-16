import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { api, formatPct } from '../api/client';
import type {
  BacktestResponse,
  PmDiscoveredRelationItem,
  PmEventBacktestResponse,
  PmEventItem,
  PmEventSignalMode,
  PmRelationMatrixResponse,
  StockSearchItem,
} from '../types/market';

interface BacktestPageProps {
  onSelectStock: (code: string, name?: string, date?: string) => void;
  onNavigate?: (tab: string) => void;
}

function upDownCls(val?: number | null): string {
  if (val === undefined || val === null || val === 0) return 'text-[#8b949e]';
  return val > 0 ? 'text-[#ff3535]' : 'text-[#00c853]';
}

const STRATEGIES = [
  { id: '双均线趋势 MA5/MA20', label: '双均线趋势 MA5/MA20' },
  { id: 'MACD趋势共振', label: 'MACD趋势共振' },
  { id: '布林带突破', label: '布林带突破' },
  { id: 'RSI波段低吸', label: 'RSI波段低吸' },
  { id: '放量突破前高', label: '放量突破前高' },
  { id: 'PandaAI 多因子截面动量', label: 'PandaAI 多因子截面动量' },
  { id: 'pm_event_resonance', label: 'PM事件概率预期差共振' },
  { id: 'cpo_bayesian_cascade', label: 'CPO五节点门控传导共振' },
  { id: 'alt_consensus_divergence', label: '跨平台超前认知预期差' },
];

const STRATEGY_LABEL_MAP: Record<string, string> = {
  pm_event_resonance: 'PM事件概率预期差共振',
  cpo_bayesian_cascade: 'CPO五节点门控传导共振',
  alt_consensus_divergence: '跨平台超前认知预期差',
};

const PM_SIGNAL_MODES: { id: PmEventSignalMode; label: string }[] = [
  { id: 'shock_breakout', label: '概率脉冲突破 (|ΔP|>=阈值)' },
  { id: 'divergence_reversion', label: '隐含定价偏离回归 (Z-Score)' },
  { id: 'regime_trend', label: '概率阈值趋势共振 (Regime)' },
  { id: 'kelly_pair_basket', label: '跨品种多空篮子 + Kelly' },
];

const QUICK_STOCKS = [
  { code: '600519', name: '贵州茅台' },
  { code: '300750', name: '宁德时代' },
  { code: '159915', name: '创业板ETF' },
  { code: '601899', name: '紫金矿业' },
  { code: '300308', name: '中际旭创' },
  { code: '002837', name: '英维克' },
];

export default function BacktestPage({ onSelectStock, onNavigate }: BacktestPageProps) {
  const [code, setCode] = useState('600519');
  const [stockLabel, setStockLabel] = useState('贵州茅台 (600519)');
  const [searchQ, setSearchQ] = useState('');
  const [searchList, setSearchList] = useState<StockSearchItem[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  const [strategy, setStrategy] = useState(STRATEGIES[0].id);
  const [days, setDays] = useState(250);
  const [initialCapital, setInitialCapital] = useState(300000);
  const [commissionRate, setCommissionRate] = useState(0.025);
  const [stampDutyRate, setStampDutyRate] = useState(0.05);
  const [slippageRate, setSlippageRate] = useState(0.1);
  const [stopLossPct, setStopLossPct] = useState(8);
  const [takeProfitPct, setTakeProfitPct] = useState(20);

  // Polymarket 宏观事件共振过滤参数
  const [pmEvents, setPmEvents] = useState<PmEventItem[]>([]);
  const [pmMatrix, setPmMatrix] = useState<PmRelationMatrixResponse | null>(null);
  const [pmEventId, setPmEventId] = useState<string>('');
  const [pmSignalMode, setPmSignalMode] = useState<PmEventSignalMode>('shock_breakout');
  const [pmShockThresholdPp, setPmShockThresholdPp] = useState<number>(2.5);
  const [pmEventBt, setPmEventBt] = useState<PmEventBacktestResponse | null>(null);
  const [pmDiagLoading, setPmDiagLoading] = useState(false);
  const [pmDiagError, setPmDiagError] = useState<string | null>(null);
  const [curveView, setCurveView] = useState<'ashare' | 'pm_joint'>('ashare');

  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestArchiveId, setLatestArchiveId] = useState<string | null>(null);
  const [paperSending, setPaperSending] = useState(false);
  const [paperNotice, setPaperNotice] = useState<string | null>(null);

  const chartRef = useRef<HTMLDivElement>(null);

  // 加载 Polymarket 事件列表与关联矩阵
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const matrix = await api.getPmRelationMatrix('all');
        if (!active) return;
        setPmMatrix(matrix);
        if (Array.isArray(matrix.events) && matrix.events.length > 0) {
          setPmEvents(matrix.events);
          return;
        }
      } catch {
        // Fallback to overview endpoint if relation-matrix is unavailable
      }
      try {
        const ov = await api.getPandaPmOverview();
        if (!active) return;
        if (Array.isArray(ov.pmEvents)) {
          setPmEvents(ov.pmEvents);
        }
      } catch {
        // Ignore if backend is still starting
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const q = searchQ.trim();
    if (!q) {
      setSearchList([]);
      setShowSearch(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchStocks(q);
        setSearchList(Array.isArray(res) ? res : []);
        setShowSearch(true);
      } catch {
        setSearchList([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQ]);

  const fetchPmDiagnostics = useCallback(
    async (
      targetCode: string,
      targetEventId: string,
      targetSignalMode: PmEventSignalMode,
      targetShockPp: number,
      targetDays: number,
      targetCap: number,
      targetStopLoss: number
    ) => {
      if (!targetEventId) {
        setPmEventBt(null);
        setPmDiagError(null);
        setCurveView('ashare');
        return;
      }
      setPmDiagLoading(true);
      setPmDiagError(null);
      try {
        const bt = await api.runPmEventBacktest({
          eventId: targetEventId,
          assetSymbol: targetCode,
          signalMode: targetSignalMode,
          days: targetDays,
          shockThresholdPp: targetShockPp,
          initialCapital: targetCap,
          leverage: 1,
          stopLossPct: -Math.abs(targetStopLoss),
          useKellySizing: targetSignalMode === 'kelly_pair_basket',
        });
        setPmEventBt(bt);
      } catch (e: any) {
        setPmEventBt(null);
        setPmDiagError(e?.message || 'PM事件领先滞后诊断暂不可用');
      } finally {
        setPmDiagLoading(false);
      }
    },
    []
  );

  const runBacktest = useCallback(
    async (
      targetCode = code,
      override?: {
        strategy?: string;
        pmEventId?: string;
        pmSignalMode?: PmEventSignalMode;
        pmShockThresholdPp?: number;
      }
    ) => {
      const effStrategy = override?.strategy ?? strategy;
      let effEventId = override?.pmEventId ?? pmEventId;
      if (effStrategy === 'pm_event_resonance' && !effEventId && pmEvents.length > 0) {
        effEventId = pmEvents[0].id;
        setPmEventId(effEventId);
      }
      const effSignalMode = override?.pmSignalMode ?? pmSignalMode;
      const effShockPp = override?.pmShockThresholdPp ?? pmShockThresholdPp;

      setLoading(true);
      setError(null);
      try {
        const payload = {
          code: targetCode,
          strategy: effStrategy,
          days,
          initialCapital,
          commissionRate: commissionRate / 100,
          stampDutyRate: stampDutyRate / 100,
          slippageRate: slippageRate / 100,
          stopLossPct: -Math.abs(stopLossPct),
          takeProfitPct: Math.abs(takeProfitPct),
          ...(effEventId
            ? {
                pmEventId: effEventId,
                pmSignalMode: effSignalMode,
                pmShockThresholdPp: effShockPp,
              }
            : {}),
        };

        const [res] = await Promise.all([
          api.runBacktest(payload),
          effEventId
            ? fetchPmDiagnostics(
                targetCode,
                effEventId,
                effSignalMode,
                effShockPp,
                days,
                initialCapital,
                stopLossPct
              )
            : Promise.resolve(),
        ]);
        setResult(res);
        if (!effEventId) {
          setPmEventBt(null);
          setCurveView('ashare');
        }
        setLatestArchiveId(null);
        api
          .getArchivedBacktests('ashare_t1')
          .then((list) => {
            if (!Array.isArray(list) || list.length === 0) return;
            const match = list.find((it) => it.symbol === res.code) || list[0];
            if (match?.id) setLatestArchiveId(match.id);
          })
          .catch(() => {
            // Archive endpoint optional fallback
          });
      } catch (e: any) {
        setError(e?.message || '回测执行失败');
      } finally {
        setLoading(false);
      }
    },
    [
      code,
      strategy,
      pmEventId,
      pmEvents,
      pmSignalMode,
      pmShockThresholdPp,
      days,
      initialCapital,
      commissionRate,
      stampDutyRate,
      slippageRate,
      stopLossPct,
      takeProfitPct,
      fetchPmDiagnostics,
    ]
  );

  useEffect(() => {
    runBacktest('600519');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当用户切换 PM 事件或信号模式时，实时更新当前标的 × PM事件领先滞后快览
  useEffect(() => {
    if (!pmEventId) {
      setPmEventBt(null);
      setPmDiagError(null);
      setCurveView('ashare');
      return;
    }
    fetchPmDiagnostics(
      code,
      pmEventId,
      pmSignalMode,
      pmShockThresholdPp,
      days,
      initialCapital,
      stopLossPct
    );
  }, [
    code,
    pmEventId,
    pmSignalMode,
    pmShockThresholdPp,
    days,
    initialCapital,
    stopLossPct,
    fetchPmDiagnostics,
  ]);

  const selectedPmEvent = useMemo(
    () => pmEvents.find((ev) => ev.id === pmEventId) || null,
    [pmEvents, pmEventId]
  );

  const relationMatch: PmDiscoveredRelationItem | null = useMemo(() => {
    if (!pmEventId || !pmMatrix?.relations?.length) return null;
    return (
      pmMatrix.relations.find(
        (r) => r.eventId === pmEventId && r.assetSymbol.toUpperCase() === code.toUpperCase()
      ) || null
    );
  }, [pmEventId, pmMatrix, code]);

  const activeCurve = useMemo(() => {
    if (curveView === 'pm_joint' && pmEventBt?.equityCurve?.length) {
      return pmEventBt.equityCurve;
    }
    return result?.equityCurve || [];
  }, [curveView, pmEventBt, result]);

  useEffect(() => {
    if (!chartRef.current || !activeCurve.length) return;
    const chart = echarts.init(chartRef.current);
    const dates = activeCurve.map((c) => c.date);
    const isPmJoint = curveView === 'pm_joint' && Boolean(pmEventBt?.equityCurve?.length);

    chart.setOption({
      backgroundColor: '#0d1015',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#475569' } },
        backgroundColor: '#141923',
        borderColor: '#2b3342',
        textStyle: { color: '#e8edf5', fontSize: 11 },
        formatter: (params: any) => {
          const arr = Array.isArray(params) ? params : [params];
          const idx = arr[0]?.dataIndex ?? 0;
          const pt = activeCurve[idx];
          if (!pt) return '';
          return `
            <div style="font-family:monospace;font-weight:700;margin-bottom:4px;">${pt.date}${isPmJoint ? ' (PM联立)' : ' (A股T+1)'}</div>
            <div>策略累计收益: <span style="color:${pt.returnPct >= 0 ? '#ff3535' : '#00c853'};font-family:monospace;">${pt.returnPct >= 0 ? '+' : ''}${pt.returnPct.toFixed(2)}%</span></div>
            <div>基准指数收益: <span style="color:#4da3ff;font-family:monospace;">${pt.benchmarkPct >= 0 ? '+' : ''}${pt.benchmarkPct.toFixed(2)}%</span></div>
            <div>账户净值: <span style="color:#f0b90b;font-family:monospace;">¥${pt.equity.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</span></div>
            <div>当前回撤: <span style="color:#00c853;font-family:monospace;">-${Math.abs(pt.drawdownPct).toFixed(2)}%</span></div>
          `;
        },
      },
      legend: {
        data: [
          isPmJoint ? 'PM联立收益(%)' : '策略收益率(%)',
          '基准收益率(%)',
          '动态回撤(%)',
        ],
        top: 4,
        right: 12,
        textStyle: { color: '#8b95a5', fontSize: 11 },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 52, right: 16, top: 30, height: '54%' },
        { left: 52, right: 16, top: '72%', height: '20%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { color: '#7d8796', fontSize: 10 },
        },
      ],
      yAxis: [
        {
          type: 'value',
          splitLine: { lineStyle: { color: '#1b212c', type: 'dashed' } },
          axisLabel: { color: '#8b95a5', fontSize: 10, formatter: '{value}%' },
        },
        {
          type: 'value',
          gridIndex: 1,
          max: 0,
          splitNumber: 2,
          splitLine: { lineStyle: { color: '#1b212c', type: 'dashed' } },
          axisLabel: { color: '#7d8796', fontSize: 10, formatter: '{value}%' },
        },
      ],
      series: [
        {
          name: isPmJoint ? 'PM联立收益(%)' : '策略收益率(%)',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 1.8, color: isPmJoint ? '#ff8800' : '#ff3535' },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'dashed', color: '#3b4454' },
            data: [{ yAxis: 0 }],
          },
          data: activeCurve.map((c) => Number(c.returnPct.toFixed(2))),
        },
        {
          name: '基准收益率(%)',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 1.4, type: 'dashed', color: '#4da3ff' },
          data: activeCurve.map((c) => Number(c.benchmarkPct.toFixed(2))),
        },
        {
          name: '动态回撤(%)',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { width: 1.2, color: '#00c853' },
          areaStyle: { color: 'rgba(0,200,83,0.16)' },
          data: activeCurve.map((c) => -Math.abs(Number(c.drawdownPct.toFixed(2)))),
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [activeCurve, curveView, pmEventBt]);

  const metrics = result?.metrics;

  const handleSendSignalToPaper = async () => {
    if (!result || !metrics) return;
    setPaperSending(true);
    setPaperNotice(null);
    try {
      await api.placePaperOrder({
        symbol: result.code,
        name: result.name,
        market: 'ashare',
        action: 'buy_long',
        capitalAllocationPct: 15,
        leverage: 1,
        strategyTag: STRATEGY_LABEL_MAP[result.strategy] || result.strategy,
        note: `F8回测信号转入 (收益${formatPct(metrics.totalReturnPct)} Sharpe ${metrics.sharpe.toFixed(2)})`,
      });
      setPaperNotice(`已直通OMS实盘专户(15%仓位): ${result.code} ${result.name}`);
      setTimeout(() => setPaperNotice(null), 5000);
    } catch (e: any) {
      setPaperNotice(`实盘执行下单失败: ${e?.message || '未知错误'}`);
    } finally {
      setPaperSending(false);
    }
  };

  const handleExportMarkdown = () => {
    if (!result || !metrics) return;
    if (latestArchiveId) {
      const url = api.getArchivedBacktestExportUrl(latestArchiveId, 'md');
      const a = document.createElement('a');
      a.href = url;
      a.download = `TSP_Backtest_${result.code}_${result.endDate}.md`;
      a.click();
      return;
    }
    const stratName = STRATEGY_LABEL_MAP[result.strategy] || result.strategy;
    const lines = [
      `# TSP Pro A股 T+1 策略回测报告: ${result.name} (${result.code})`,
      '',
      `- 策略模型: ${stratName}`,
      `- 回测区间: ${result.startDate} ~ ${result.endDate}`,
      `- 初始资金: ¥${result.initialCapital.toLocaleString('zh-CN')}`,
      `- 期末净值: ¥${result.finalCapital.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`,
      `- 总收益率: ${formatPct(metrics.totalReturnPct)} | 年化收益: ${formatPct(metrics.annualReturnPct)}`,
      `- 基准收益: ${formatPct(metrics.benchmarkReturnPct)} | 超额Alpha: ${formatPct(metrics.totalReturnPct - metrics.benchmarkReturnPct)}`,
      `- 最大回撤: -${Math.abs(metrics.maxDrawdownPct).toFixed(2)}% | 夏普比率: ${metrics.sharpe.toFixed(2)}`,
      `- 胜率: ${metrics.winRatePct.toFixed(1)}% | 盈亏比: ${metrics.profitFactor.toFixed(2)} | 成交笔数: ${metrics.totalTrades}`,
      '',
      '## 交割流水明细',
      '| # | 买入日 | T+1解锁日 | 卖出日 | 买入价 | 卖出价 | 股数 | 净盈亏 | 收益率 | 原因 |',
      '|---|--------|-----------|--------|--------|--------|------|--------|--------|------|',
      ...result.trades.map(
        (t) =>
          `| ${t.id} | ${t.buyDate} | ${t.unlockDate} | ${t.sellDate} | ${t.buyPrice.toFixed(2)} | ${t.sellPrice.toFixed(2)} | ${t.shares} | ${t.pnl.toFixed(2)} | ${formatPct(t.pnlPct)} | ${t.reason} |`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TSP_Backtest_${result.code}_${result.endDate}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const diagSummary = pmEventBt?.relationSummary || relationMatch;
  const diagLag = diagSummary ? diagSummary.optimalLagDays : null;
  const diagHitRate = diagSummary ? diagSummary.shockHitRate : null;
  const diagShockCorr = diagSummary ? diagSummary.shockCorr : null;
  const diagPearson = diagSummary ? diagSummary.pearsonCorr : null;
  const diagDivZ =
    pmEventBt?.relationSummary?.currentDivergenceZ ?? relationMatch?.divergenceZScore ?? null;
  const diagBeta = diagSummary ? diagSummary.rollingBeta : null;
  const diagKelly = diagSummary ? diagSummary.kellySuggestedPct : null;
  const diagMechanism = diagSummary?.mechanism || '';

  return (
    <div className="h-full w-full flex flex-col bg-[#222832] gap-[1px] overflow-hidden">
      {/* Top 28px Wind Header */}
      <div className="h-[28px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center shrink-0">
            <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
            <span className="text-[12px] font-bold text-[#dfe6f0]">
              F8 A股 T+1 实盘摩擦策略回测终端
            </span>
          </div>
          <span className="text-[11px] font-mono text-[#7d8796] border-l border-[#232a36] pl-2.5 truncate">
            T+1锁仓 · 卖出单边印花税 · 100股整手 · 一字涨跌停拦截 · PM宏观事件共振
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {QUICK_STOCKS.map((qs) => (
            <button
              key={qs.code}
              onClick={() => {
                setCode(qs.code);
                setStockLabel(`${qs.name} (${qs.code})`);
                runBacktest(qs.code);
              }}
              className={`px-1.5 h-[20px] rounded-[2px] text-[11px] border ${
                code === qs.code
                  ? 'bg-[#0e1117] border-[#ff8800] text-[#ff9500]'
                  : 'border-[#2b3342] text-[#8b95a5] hover:text-[#e8edf5]'
              }`}
            >
              {qs.name}
            </button>
          ))}
          <button
            onClick={() => onNavigate?.('consensus-cpo')}
            className="ml-1 px-2 h-[20px] rounded-[2px] text-[11px] font-bold border border-[#ff8800] bg-[#0e1117] text-[#ff9500] hover:bg-[#1b2434]"
            title="前往 F12 全维超前认知定价与CPO五节点传导台"
          >
            [F12 认知定价/CPO传导]
          </button>
        </div>
      </div>

      {/* Config Strip */}
      <div className="bg-[#0e1117] px-2.5 py-2 shrink-0 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-10 gap-2 text-[11px] items-end">
        <div className="relative lg:col-span-2">
          <label className="block text-[10px] text-[#7d8796] mb-0.5">
            回测标的: <span className="text-[#e5b567] font-mono">{stockLabel}</span>
          </label>
          <input
            type="text"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="搜索代码/名称切换..."
            className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-2 text-[#e8edf5] placeholder-[#5c6675] focus:outline-none"
          />
          {showSearch && searchList.length > 0 && (
            <div className="absolute left-0 right-0 top-[42px] z-40 bg-[#141923] border border-[#ff8800] max-h-56 overflow-y-auto">
              {searchList.map((s) => (
                <button
                  key={s.code}
                  onClick={() => {
                    setCode(s.code);
                    setStockLabel(`${s.name} (${s.code})`);
                    setSearchQ('');
                    setShowSearch(false);
                  }}
                  className="w-full h-[26px] flex items-center justify-between px-2 hover:bg-[#1b2434] text-left border-b border-[#181d26]"
                >
                  <span>
                    <span className="font-mono text-[#e5b567] mr-1.5">{s.code}</span>
                    <span className="text-[#e8edf5]">{s.name}</span>
                  </span>
                  <span className="text-[10px] text-[#7d8796]">{s.industry || s.market}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <label className="block text-[10px] text-[#7d8796] mb-0.5">策略模型</label>
          <select
            value={strategy}
            onChange={(e) => {
              const nextStrat = e.target.value;
              setStrategy(nextStrat);
              if (nextStrat === 'pm_event_resonance' && !pmEventId && pmEvents.length > 0) {
                setPmEventId(pmEvents[0].id);
              }
            }}
            className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-1.5 text-[#e8edf5] focus:outline-none"
          >
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] text-[#7d8796] mb-0.5">周期(日)</label>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1.5 font-mono text-[#e8edf5] focus:outline-none"
          >
            {[60, 120, 180, 250, 500].map((d) => (
              <option key={d} value={d}>
                {d}D
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] text-[#7d8796] mb-0.5">初始资金(元)</label>
          <input
            type="number"
            step="10000"
            min="10000"
            value={initialCapital}
            onChange={(e) => setInitialCapital(Number(e.target.value) || 300000)}
            className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1.5 font-mono text-[#f0b90b] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[10px] text-[#7d8796] mb-0.5">佣金/印花/滑点%</label>
          <div className="flex gap-1">
            <input
              type="number"
              step="0.005"
              value={commissionRate}
              onChange={(e) => setCommissionRate(Number(e.target.value))}
              className="w-1/3 h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1 font-mono text-[#dfe6f0]"
              title="佣金%"
            />
            <input
              type="number"
              step="0.01"
              value={stampDutyRate}
              onChange={(e) => setStampDutyRate(Number(e.target.value))}
              className="w-1/3 h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1 font-mono text-[#dfe6f0]"
              title="印花税%"
            />
            <input
              type="number"
              step="0.05"
              value={slippageRate}
              onChange={(e) => setSlippageRate(Number(e.target.value))}
              className="w-1/3 h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1 font-mono text-[#dfe6f0]"
              title="滑点%"
            />
          </div>
        </div>

        <div>
          <label className="block text-[10px] text-[#00c853] mb-0.5">硬止损%</label>
          <input
            type="number"
            step="1"
            min="1"
            max="50"
            value={stopLossPct}
            onChange={(e) => setStopLossPct(Number(e.target.value))}
            className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1.5 font-mono text-[#00c853]"
          />
        </div>

        <div>
          <label className="block text-[10px] text-[#ff3535] mb-0.5">止盈目标%</label>
          <input
            type="number"
            step="1"
            min="2"
            max="200"
            value={takeProfitPct}
            onChange={(e) => setTakeProfitPct(Number(e.target.value))}
            className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1.5 font-mono text-[#ff3535]"
          />
        </div>

        <button
          onClick={() => runBacktest(code)}
          disabled={loading}
          className="h-[24px] rounded-[2px] bg-[#ff8800] hover:bg-[#ff9922] text-[#090c10] font-bold disabled:opacity-60"
        >
          {loading ? '计算中...' : '执行回测'}
        </button>
      </div>

      {/* Polymarket 宏观事件共振过滤栏 */}
      <div className="bg-[#11151d] px-2.5 py-1.5 shrink-0 flex flex-wrap items-center gap-2 text-[11px] border-t border-[#1c2330]">
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`w-[6px] h-[6px] inline-block ${
              pmEventId ? 'bg-[#ff8800]' : 'bg-[#5c6675]'
            }`}
          />
          <span className="font-bold text-[#f0b90b]">Polymarket 宏观事件共振过滤</span>
        </div>

        <div className="flex items-center gap-1.5 min-w-[260px] flex-1 max-w-[460px]">
          <span className="text-[10px] text-[#7d8796] shrink-0">关联PM事件</span>
          <select
            value={pmEventId}
            onChange={(e) => setPmEventId(e.target.value)}
            className="w-full h-[22px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-1.5 text-[#e8edf5] focus:outline-none"
          >
            <option value="">不关联 PM 事件 (纯技术面/因子策略独立回测)</option>
            {pmEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>
                [{ev.category}] {ev.title} (Yes {ev.yesProb.toFixed(1)}% | 24h{' '}
                {ev.change24h >= 0 ? '+' : ''}
                {ev.change24h.toFixed(1)}%)
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-[#7d8796]">信号模式</span>
          <select
            value={pmSignalMode}
            onChange={(e) => setPmSignalMode(e.target.value as PmEventSignalMode)}
            className="h-[22px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-1.5 text-[#dfe6f0] focus:outline-none"
          >
            {PM_SIGNAL_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-[#7d8796]">脉冲阈值 |ΔP|%</span>
          <input
            type="number"
            step="0.5"
            min="0.5"
            max="20"
            value={pmShockThresholdPp}
            onChange={(e) => setPmShockThresholdPp(Number(e.target.value) || 2.5)}
            className="w-16 h-[22px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-1.5 font-mono text-[#ff9500] focus:outline-none"
          />
        </div>

        {pmEventId && (
          <button
            onClick={() => runBacktest(code)}
            disabled={loading}
            className="h-[22px] px-2 rounded-[2px] border border-[#ff8800] bg-[#161b24] text-[#ff9500] hover:bg-[#1f2633] font-medium shrink-0 disabled:opacity-60"
          >
            应用PM共振重测
          </button>
        )}

        <span className="ml-auto text-[10px] font-mono text-[#7d8796] shrink-0">
          {pmEventId
            ? '盘前 09:00 CST 概率截断对齐 · 零未来函数'
            : '选择事件后可联合校验领先滞后与预期差Z-Score'}
        </span>
      </div>

      {/* 当前标的 × PM事件领先滞后快览 strip */}
      {pmEventId && (
        <div className="bg-[#0e1117] border-l-2 border-l-[#ff8800] px-2.5 py-1.5 shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="px-1 py-0.5 rounded-[2px] bg-[#161b24] border border-[#ff8800] text-[#ff9500] text-[10px] font-bold">
              标的 x PM领先滞后快览
            </span>
            <span className="font-mono text-[#e5b567]">{code}</span>
            {selectedPmEvent && (
              <span className="text-[#dfe6f0] max-w-[260px] truncate" title={selectedPmEvent.title}>
                {selectedPmEvent.title}
              </span>
            )}
            {selectedPmEvent && (
              <span className="font-mono text-[#f0b90b]">
                Yes {selectedPmEvent.yesProb.toFixed(1)}% (
                <span className={upDownCls(selectedPmEvent.change24h)}>
                  {selectedPmEvent.change24h >= 0 ? '+' : ''}
                  {selectedPmEvent.change24h.toFixed(1)}%
                </span>
                )
              </span>
            )}
          </div>

          {pmDiagLoading ? (
            <span className="text-[#7d8796] font-mono">正在计算领先滞后互相关与协整预期差...</span>
          ) : diagSummary ? (
            <>
              <div className="flex items-center gap-3 font-mono tabular-nums">
                <span>
                  <span className="text-[#7d8796] font-sans mr-1">最优领先:</span>
                  <span className="text-[#ff9500] font-bold">
                    {diagLag !== null
                      ? diagLag > 0
                        ? `PM领先 +${diagLag}d`
                        : diagLag < 0
                        ? `标的领先 ${Math.abs(diagLag)}d`
                        : '当日同步 0d'
                      : '-'}
                  </span>
                </span>
                <span>
                  <span className="text-[#7d8796] font-sans mr-1">冲击胜率:</span>
                  <span
                    className={
                      (diagHitRate ?? 0) >= 55 ? 'text-[#ff3535] font-bold' : 'text-[#f0b90b]'
                    }
                  >
                    {diagHitRate !== null ? `${diagHitRate.toFixed(1)}%` : '-'}
                  </span>
                </span>
                <span>
                  <span className="text-[#7d8796] font-sans mr-1">预期差Z:</span>
                  <span className={upDownCls(diagDivZ)}>
                    {diagDivZ !== null
                      ? `${diagDivZ >= 0 ? '+' : ''}${diagDivZ.toFixed(2)}σ`
                      : '-'}
                  </span>
                </span>
                <span>
                  <span className="text-[#7d8796] font-sans mr-1">冲击/全期Corr:</span>
                  <span className="text-[#4da3ff]">
                    {diagShockCorr !== null ? diagShockCorr.toFixed(2) : '-'} /{' '}
                    {diagPearson !== null ? diagPearson.toFixed(2) : '-'}
                  </span>
                </span>
                <span>
                  <span className="text-[#7d8796] font-sans mr-1">弹性Beta:</span>
                  <span className="text-[#dfe6f0]">
                    {diagBeta !== null ? diagBeta.toFixed(2) : '-'}
                  </span>
                </span>
                <span>
                  <span className="text-[#7d8796] font-sans mr-1">半Kelly仓位:</span>
                  <span className="text-[#f0b90b]">
                    {diagKelly !== null ? `${diagKelly.toFixed(1)}%` : '-'}
                  </span>
                </span>
                {relationMatch && (
                  <span
                    className={`px-1.5 py-0.5 rounded-[2px] font-sans text-[10px] border ${
                      relationMatch.alphaState === '预期差严重滞后'
                        ? 'border-[#ff8800] text-[#ff9500] bg-[#19120b]'
                        : relationMatch.alphaState === 'PM异动共振'
                        ? 'border-[#ff3535] text-[#ff3535] bg-[#1a0d10]'
                        : 'border-[#2b3342] text-[#8b95a5]'
                    }`}
                  >
                    {relationMatch.alphaState}
                  </span>
                )}
              </div>

              {diagMechanism && (
                <span
                  className="text-[10px] text-[#8b95a5] truncate max-w-[320px]"
                  title={diagMechanism}
                >
                  机理: {diagMechanism}
                </span>
              )}

              {pmEventBt && (
                <span className="ml-auto font-mono text-[10px] text-[#dfe6f0] shrink-0">
                  PM联立参考:{' '}
                  <span className={upDownCls(pmEventBt.metrics.totalReturnPct)}>
                    {formatPct(pmEventBt.metrics.totalReturnPct)}
                  </span>{' '}
                  ({pmEventBt.metrics.tradeCount}笔 / Sharpe {pmEventBt.metrics.sharpe.toFixed(2)})
                </span>
              )}
            </>
          ) : pmDiagError ? (
            <span className="text-[#7d8796] text-[10px]">{pmDiagError}</span>
          ) : null}
        </div>
      )}

      {error ? (
        <div className="flex-1 bg-[#0e1117] p-8 text-center text-[12px] text-[#ff3535]">
          {error}
        </div>
      ) : loading && !result ? (
        <div className="flex-1 bg-[#0e1117] p-10 text-center text-[12px] text-[#7d8796]">
          正在拉取前复权历史日K并回溯 A股 T+1 撮合轨迹...
        </div>
      ) : result && metrics ? (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
          {/* 6-KPI Strip */}
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-[1px] bg-[#222832] shrink-0">
            <div className="bg-[#0e1117] px-3 py-1.5">
              <div className="text-[10px] text-[#7d8796]">总收益率 / 期末净值</div>
              <div className="flex items-baseline justify-between mt-0.5 font-mono tabular-nums">
                <span className={`text-[14px] font-bold ${upDownCls(metrics.totalReturnPct)}`}>
                  {formatPct(metrics.totalReturnPct)}
                </span>
                <span className="text-[11px] text-[#f0b90b]">
                  ¥{result.finalCapital.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>

            <div className="bg-[#0e1117] px-3 py-1.5">
              <div className="text-[10px] text-[#7d8796]">年化收益率</div>
              <div className="flex items-baseline justify-between mt-0.5 font-mono tabular-nums">
                <span className={`text-[14px] font-bold ${upDownCls(metrics.annualReturnPct)}`}>
                  {formatPct(metrics.annualReturnPct)}
                </span>
                <span className="text-[10px] text-[#7d8796]">
                  {result.startDate} ~ {result.endDate}
                </span>
              </div>
            </div>

            <div className="bg-[#0e1117] px-3 py-1.5">
              <div className="text-[10px] text-[#7d8796]">基准收益 / 超额Alpha</div>
              <div className="flex items-baseline justify-between mt-0.5 font-mono tabular-nums">
                <span className={`text-[14px] font-bold ${upDownCls(metrics.benchmarkReturnPct)}`}>
                  {formatPct(metrics.benchmarkReturnPct)}
                </span>
                <span
                  className={`text-[11px] ${upDownCls(
                    metrics.totalReturnPct - metrics.benchmarkReturnPct
                  )}`}
                >
                  α {formatPct(metrics.totalReturnPct - metrics.benchmarkReturnPct)}
                </span>
              </div>
            </div>

            <div className="bg-[#0e1117] px-3 py-1.5">
              <div className="text-[10px] text-[#7d8796]">最大回撤</div>
              <div className="text-[14px] font-bold font-mono tabular-nums mt-0.5 text-[#00c853]">
                -{Math.abs(metrics.maxDrawdownPct).toFixed(2)}%
              </div>
            </div>

            <div className="bg-[#0e1117] px-3 py-1.5">
              <div className="text-[10px] text-[#7d8796]">夏普比率 Sharpe</div>
              <div className="text-[14px] font-bold font-mono tabular-nums mt-0.5 text-[#4da3ff]">
                {metrics.sharpe.toFixed(2)}
              </div>
            </div>

            <div className="bg-[#0e1117] px-3 py-1.5">
              <div className="text-[10px] text-[#7d8796]">胜率 / 盈亏比 / 交易次数</div>
              <div className="flex items-baseline justify-between mt-0.5 font-mono tabular-nums">
                <span className="text-[14px] font-bold text-[#e8edf5]">
                  {metrics.winRatePct.toFixed(1)}%
                </span>
                <span className="text-[11px] text-[#f0b90b]">
                  PF {metrics.profitFactor.toFixed(2)} · {metrics.totalTrades}笔
                </span>
              </div>
            </div>
          </div>

          {/* V6 SQLite Archive / Paper Desk / MD Export Action Strip */}
          <div className="h-[26px] bg-[#12161f] px-2.5 flex items-center justify-between text-[11px] shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-[6px] h-[6px] bg-[#00c853] inline-block" />
              <button
                onClick={() => onNavigate?.('saas-desk')}
                className="px-2 h-[20px] rounded-[2px] border border-[#2b3342] bg-[#0e1117] text-[#4da3ff] hover:border-[#4da3ff] font-mono"
              >
                结果已自动归档SQLite · 查看归档库
              </button>
              {paperNotice && (
                <span className="font-mono text-[#f0b90b] flex items-center gap-1.5">
                  <span>{paperNotice}</span>
                  <button
                    onClick={() => onNavigate?.('saas-desk')}
                    className="underline text-[#ff9500]"
                  >
                    前往 OMS 实盘交易柜台
                  </button>
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleSendSignalToPaper}
                disabled={paperSending}
                className="px-2.5 h-[20px] rounded-[2px] border border-[#ff8800] bg-[#161b24] text-[#ff9500] hover:bg-[#ff8800] hover:text-[#090c10] font-bold disabled:opacity-50"
              >
                {paperSending ? '下单中...' : '信号直通实盘'}
              </button>
              <button
                onClick={handleExportMarkdown}
                className="px-2.5 h-[20px] rounded-[2px] border border-[#2b3342] bg-[#161b24] text-[#f0b90b] hover:border-[#f0b90b]"
              >
                导出MD报告
              </button>
            </div>
          </div>

          {/* Chart Pane */}
          <div className="bg-[#0e1117] h-[240px] flex flex-col shrink-0">
            <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-[2px] h-3 bg-[#ff8800] inline-block" />
                <span className="text-[12px] font-bold text-[#dfe6f0]">
                  {result.name} ({result.code}) ·{' '}
                  {STRATEGY_LABEL_MAP[result.strategy] || result.strategy}{' '}
                  — {curveView === 'pm_joint' && pmEventBt ? 'PM事件联立净值与回撤' : '收益曲线与水下回撤'}
                </span>
                {pmEventId && (
                  <span className="px-1.5 py-0.5 rounded-[2px] border border-[#ff8800] text-[10px] text-[#ff9500]">
                    已启用PM共振过滤
                  </span>
                )}
                {(strategy === 'cpo_bayesian_cascade' || strategy === 'alt_consensus_divergence') && (
                  <button
                    onClick={() => onNavigate?.('consensus-cpo')}
                    className="px-1.5 py-0.5 rounded-[2px] border border-[#f0b90b] text-[10px] text-[#f0b90b] hover:bg-[#1b2434]"
                  >
                    打开F12五节点门控传导图
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {pmEventBt && (
                  <div className="flex items-center border border-[#2b3342]">
                    <button
                      onClick={() => setCurveView('ashare')}
                      className={`px-2 h-[18px] text-[10px] ${
                        curveView === 'ashare'
                          ? 'bg-[#ff8800] text-[#090c10] font-bold'
                          : 'bg-[#0e1117] text-[#8b95a5] hover:text-[#e8edf5]'
                      }`}
                    >
                      A股T+1净值
                    </button>
                    <button
                      onClick={() => setCurveView('pm_joint')}
                      className={`px-2 h-[18px] text-[10px] border-l border-[#2b3342] ${
                        curveView === 'pm_joint'
                          ? 'bg-[#ff8800] text-[#090c10] font-bold'
                          : 'bg-[#0e1117] text-[#8b95a5] hover:text-[#e8edf5]'
                      }`}
                    >
                      PM事件联立净值
                    </button>
                  </div>
                )}
                <button
                  onClick={() => onSelectStock(result.code, result.name)}
                  className="text-[11px] text-[#4da3ff] hover:underline"
                >
                  查看标的 F5 日K/分时
                </button>
              </div>
            </div>
            <div ref={chartRef} className="w-full flex-1 min-h-0" />
          </div>

          {/* Trade Execution Blotter */}
          <div className="flex-1 min-h-0 bg-[#0e1117] flex flex-col overflow-hidden">
            <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-[2px] h-3 bg-[#ff8800] inline-block" />
                <span className="text-[12px] font-bold text-[#dfe6f0]">
                  {curveView === 'pm_joint' && pmEventBt
                    ? `PM事件联立交割流水 (${pmEventBt.trades.length} 笔)`
                    : `T+1 交割流水明细 (${result.trades.length} 笔)`}
                </span>
              </div>
              <span className="text-[11px] text-[#7d8796]">
                {curveView === 'pm_joint' && pmEventBt
                  ? pmEventBt.executionRule
                  : '严格校验卖出日 >= T+1解锁日'}
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              {curveView === 'pm_joint' && pmEventBt ? (
                pmEventBt.trades.length === 0 ? (
                  <div className="p-6 text-center text-[12px] text-[#7d8796]">
                    当前 PM 事件脉冲阈值与信号模式下未触发联立成交，可下调 |ΔP| 阈值或切换信号模式
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#151a23] border-b border-[#252c38] text-[11px] text-[#8b95a5]">
                      <tr className="h-[26px]">
                        <th className="px-2.5 w-10">#</th>
                        <th className="px-2.5">开仓日期</th>
                        <th className="px-2.5">平仓日期</th>
                        <th className="px-2.5">方向</th>
                        <th className="px-2.5 text-right">入场价</th>
                        <th className="px-2.5 text-right">出场价</th>
                        <th className="px-2.5 text-right">入场PM概率(ΔP)</th>
                        <th className="px-2.5 text-right">预期差Z</th>
                        <th className="px-2.5 text-right">仓位%</th>
                        <th className="px-2.5 text-right">净盈亏(元)</th>
                        <th className="px-2.5 text-right">收益率%</th>
                        <th className="px-2.5">触发原因</th>
                      </tr>
                    </thead>
                    <tbody className="text-[12px] font-mono tabular-nums">
                      {pmEventBt.trades.map((t) => (
                        <tr
                          key={t.id}
                          className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434]"
                        >
                          <td className="px-2.5 text-[#7d8796]">{t.id}</td>
                          <td className="px-2.5 text-[#dfe6f0]">{t.entryDate}</td>
                          <td className="px-2.5 text-[#dfe6f0]">{t.exitDate}</td>
                          <td
                            className={`px-2.5 font-sans font-bold ${
                              t.side === '做多'
                                ? 'text-[#ff3535]'
                                : t.side === '做空'
                                ? 'text-[#00c853]'
                                : 'text-[#f0b90b]'
                            }`}
                          >
                            {t.side}
                          </td>
                          <td className="px-2.5 text-right text-[#e8edf5]">
                            {t.entryPrice.toFixed(2)}
                          </td>
                          <td className="px-2.5 text-right text-[#e8edf5]">
                            {t.exitPrice.toFixed(2)}
                          </td>
                          <td className="px-2.5 text-right text-[#f0b90b]">
                            {t.entryProb.toFixed(1)}% ({t.entryProbDelta >= 0 ? '+' : ''}
                            {t.entryProbDelta.toFixed(1)})
                          </td>
                          <td className={`px-2.5 text-right ${upDownCls(t.entryDivergenceZ)}`}>
                            {t.entryDivergenceZ >= 0 ? '+' : ''}
                            {t.entryDivergenceZ.toFixed(2)}σ
                          </td>
                          <td className="px-2.5 text-right text-[#4da3ff]">
                            {t.positionPct.toFixed(1)}%
                          </td>
                          <td className={`px-2.5 text-right font-semibold ${upDownCls(t.pnl)}`}>
                            {t.pnl > 0 ? '+' : ''}
                            {t.pnl.toFixed(2)}
                          </td>
                          <td className={`px-2.5 text-right font-semibold ${upDownCls(t.returnPct)}`}>
                            {formatPct(t.returnPct)}
                          </td>
                          <td className="px-2.5 font-sans text-[11px] text-[#dfe6f0]">
                            {t.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : result.trades.length === 0 ? (
                <div className="p-6 text-center text-[12px] text-[#7d8796]">
                  当前回测窗口内未触发完整买卖信号，可尝试切换策略或调整资金/周期
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#151a23] border-b border-[#252c38] text-[11px] text-[#8b95a5]">
                    <tr className="h-[26px]">
                      <th className="px-2.5 w-10">#</th>
                      <th className="px-2.5">买入日期</th>
                      <th className="px-2.5">T+1解锁日</th>
                      <th className="px-2.5">卖出日期</th>
                      <th className="px-2.5 text-right">买入价</th>
                      <th className="px-2.5 text-right">卖出价</th>
                      <th className="px-2.5 text-right">数量(股)</th>
                      <th className="px-2.5 text-right">税费合计</th>
                      <th className="px-2.5 text-right">净盈亏(元)</th>
                      <th className="px-2.5 text-right">单笔收益率</th>
                      <th className="px-2.5">触发原因</th>
                    </tr>
                  </thead>
                  <tbody className="text-[12px] font-mono tabular-nums">
                    {result.trades.map((t) => (
                      <tr
                        key={t.id}
                        className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434]"
                      >
                        <td className="px-2.5 text-[#7d8796]">{t.id}</td>
                        <td className="px-2.5 text-[#dfe6f0]">{t.buyDate}</td>
                        <td className="px-2.5 text-[#4da3ff]">{t.unlockDate}</td>
                        <td className="px-2.5 text-[#dfe6f0]">{t.sellDate}</td>
                        <td className="px-2.5 text-right text-[#e8edf5]">
                          {t.buyPrice.toFixed(2)}
                        </td>
                        <td className="px-2.5 text-right text-[#e8edf5]">
                          {t.sellPrice.toFixed(2)}
                        </td>
                        <td className="px-2.5 text-right text-[#dfe6f0]">{t.shares}</td>
                        <td className="px-2.5 text-right text-[#8b95a5]">¥{t.fee.toFixed(2)}</td>
                        <td className={`px-2.5 text-right font-semibold ${upDownCls(t.pnl)}`}>
                          {t.pnl > 0 ? '+' : ''}
                          {t.pnl.toFixed(2)}
                        </td>
                        <td className={`px-2.5 text-right font-semibold ${upDownCls(t.pnlPct)}`}>
                          {formatPct(t.pnlPct)}
                        </td>
                        <td className="px-2.5 font-sans text-[11px]">
                          <span
                            className={`px-1.5 py-0.5 rounded-[2px] border ${
                              t.reason.includes('止盈')
                                ? 'border-[#ff3535] text-[#ff3535]'
                                : t.reason.includes('止损')
                                ? 'border-[#00c853] text-[#00c853]'
                                : t.reason.includes('CPO门控') ||
                                  t.reason.includes('跨所共识') ||
                                  t.reason.includes('PM概率')
                                ? 'border-[#ff8800] text-[#f0b90b]'
                                : 'border-[#2b3342] text-[#dfe6f0]'
                            }`}
                          >
                            {t.reason}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
