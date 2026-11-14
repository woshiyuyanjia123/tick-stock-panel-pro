import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { api, formatAmount, formatPct } from '../api/client';
import type { ScreenerRequest, ScreenerResponse, ScreenerResultItem } from '../types/market';

interface StrategyScreenerPageProps {
  onSelectStock: (code: string, name?: string, date?: string) => void;
  initialTab?: 'strategy' | 'factor';
}

interface PandaFactorMeta {
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
  direction?: string;
}

interface PandaScanResponse {
  factor?: PandaFactorMeta;
  targets?: {
    code: string;
    name: string;
    price: number;
    changePct: number;
    factorValue?: number;
    zScore?: number;
    signal?: string;
    reason?: string;
    turnoverRate?: number;
    volumeRatio?: number;
    amount?: number;
    marketCap?: number;
    industry?: string;
  }[];
  stats?: {
    mean?: number;
    std?: number;
    longTopAvgPct?: number;
    shortBottomAvgPct?: number;
    spreadPct?: number;
  };
}

interface StrategyPreset {
  id: string;
  name: string;
  tag: string;
  desc: string;
  defaults: NonNullable<ScreenerRequest['filters']>;
}

function upDownCls(val?: number | null): string {
  if (val === undefined || val === null || val === 0) return 'text-[#8b949e]';
  return val > 0 ? 'text-[#ff3535]' : 'text-[#00c853]';
}

const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: 'weak_to_strong',
    name: '首板弱转强',
    tag: '游资短线',
    desc: '昨日首板/分歧强承接，今日高开或放量转一致',
    defaults: {
      minChangePct: 2.5,
      maxChangePct: 20.5,
      minTurnover: 4,
      maxTurnover: 35,
      minVolRatio: 1.5,
      minMarketCap: 20,
      maxMarketCap: 800,
      excludeSt: true,
      excludeBse: true,
    },
  },
  {
    id: 'dragon_divergence',
    name: '连板龙头分歧博弈',
    tag: '情绪接力',
    desc: '高换手分歧回封与主线高标品种承接筛选',
    defaults: {
      minChangePct: 4.0,
      maxChangePct: 20.5,
      minTurnover: 8,
      maxTurnover: 45,
      minVolRatio: 1.8,
      minMarketCap: 25,
      maxMarketCap: 1500,
      excludeSt: true,
      excludeBse: true,
    },
  },
  {
    id: 'ma_breakout',
    name: '均线多头放量突破',
    tag: '右侧趋势',
    desc: '均线多头排列且成交量显著放大突破平台',
    defaults: {
      minChangePct: 1.5,
      maxChangePct: 12,
      minTurnover: 2,
      maxTurnover: 25,
      minVolRatio: 1.6,
      minMarketCap: 40,
      maxMarketCap: 5000,
      excludeSt: true,
      excludeBse: true,
    },
  },
  {
    id: 'rsi_rebound',
    name: '超跌RSI底背离反弹',
    tag: '左侧低吸',
    desc: '连续调整后动量底背离，温和放量企稳回升',
    defaults: {
      minChangePct: -2,
      maxChangePct: 7,
      minTurnover: 1.2,
      maxTurnover: 15,
      minVolRatio: 1.1,
      minMarketCap: 30,
      maxMarketCap: 3000,
      excludeSt: true,
      excludeBse: true,
    },
  },
  {
    id: 'high_turnover_core',
    name: '高换手主线容量核心',
    tag: '容量中军',
    desc: '大成交额与高活跃度兼备的主线中军容量标的',
    defaults: {
      minChangePct: 1,
      maxChangePct: 20,
      minTurnover: 5,
      maxTurnover: 30,
      minVolRatio: 1.3,
      minMarketCap: 150,
      maxMarketCap: 10000,
      excludeSt: true,
      excludeBse: true,
    },
  },
];

interface FactorPreset {
  id: string;
  name: string;
  formula: string;
  desc: string;
}

const FACTOR_PRESETS: FactorPreset[] = [
  {
    id: 'MOM_5D',
    name: '5日动量因子 (MOM_5D)',
    formula: 'Close(t) / Close(t-5) - 1',
    desc: '衡量短期价格动量惯性与主线资金追击强度',
  },
  {
    id: 'TURNOVER_RATIO',
    name: '换手异动因子 (TURNOVER_RATIO)',
    formula: 'Turnover(t) / Mean(Turnover, 20)',
    desc: '捕捉筹码换手骤增、主力资金异动建仓阶段',
  },
  {
    id: 'VOL_PRICE_CORR',
    name: '量价相关因子 (VOL_PRICE_CORR)',
    formula: 'Corr(Close, Volume, 10)',
    desc: '检验价涨量增、价跌量缩的健康多头结构',
  },
  {
    id: 'AMPLITUDE_20D',
    name: '20日振幅弹性 (AMPLITUDE_20D)',
    formula: '(High20 - Low20) / Close(t-20)',
    desc: '评估标的波动弹性与短期博弈赔率空间',
  },
  {
    id: 'SEAL_STRENGTH',
    name: '封单强度因子 (SEAL_STRENGTH)',
    formula: 'SealAmount / FloatMarketCap',
    desc: '衡量涨停封单占流通盘比例及连板溢价预期',
  },
];

export default function StrategyScreenerPage({
  onSelectStock,
  initialTab = 'strategy',
}: StrategyScreenerPageProps) {
  const [activeTab, setActiveTab] = useState<'strategy' | 'factor'>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const [pandaFactors, setPandaFactors] = useState<PandaFactorMeta[]>([]);
  const [activePandaId, setActivePandaId] = useState<string | null>(null);
  const [pandaFactorEval, setPandaFactorEval] = useState<{
    factor: PandaFactorMeta;
    stats: PandaScanResponse['stats'];
    targets: ScreenerResultItem[];
  } | null>(null);

  const [selectedStrategy, setSelectedStrategy] = useState<string>(STRATEGY_PRESETS[0].id);
  const [filters, setFilters] = useState<NonNullable<ScreenerRequest['filters']>>(
    STRATEGY_PRESETS[0].defaults
  );
  const [screenerData, setScreenerData] = useState<ScreenerResponse | null>(null);
  const [loadingStrat, setLoadingStrat] = useState(false);
  const [stratError, setStratError] = useState<string | null>(null);

  const [selectedFactor, setSelectedFactor] = useState<string>(FACTOR_PRESETS[0].id);
  const [factorData, setFactorData] = useState<ScreenerResponse | null>(null);
  const [loadingFactor, setLoadingFactor] = useState(false);
  const [factorError, setFactorError] = useState<string | null>(null);

  const [addedCodes, setAddedCodes] = useState<Set<string>>(new Set());
  const factorChartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .getWatchlist()
      .then((list) => {
        if (Array.isArray(list)) {
          setAddedCodes(new Set(list.map((i) => i.code)));
        }
      })
      .catch(() => {});

    fetch('/api/panda-pm/overview')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.factors && Array.isArray(data.factors)) {
          setPandaFactors(data.factors.slice(0, 10));
        }
      })
      .catch(() => {});
  }, []);

  const executeStrategy = useCallback(
    async (stratId = selectedStrategy, f = filters) => {
      setActivePandaId(null);
      setLoadingStrat(true);
      setStratError(null);
      try {
        const res = await api.runScreener({ strategyId: stratId, filters: f });
        setScreenerData(res);
      } catch (e: any) {
        setStratError(e?.message || '执行策略选股失败');
      } finally {
        setLoadingStrat(false);
      }
    },
    [selectedStrategy, filters]
  );

  const executePandaScan = useCallback(async (pf: PandaFactorMeta, forTab: 'strategy' | 'factor') => {
    if (forTab === 'strategy') {
      setActivePandaId(pf.id);
      setLoadingStrat(true);
      setStratError(null);
    } else {
      setSelectedFactor(pf.id);
      setLoadingFactor(true);
      setFactorError(null);
    }
    try {
      const res = await fetch('/api/panda-pm/factor-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factorId: pf.id, topN: 35, universe: 'ashare' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: PandaScanResponse = await res.json();
      const mapped: ScreenerResultItem[] = (json.targets || []).map((t) => ({
        code: t.code,
        name: t.name,
        price: Number(t.price || 0),
        changePct: Number(t.changePct || 0),
        turnoverRate: Number(t.turnoverRate || 0),
        volumeRatio: Number(t.volumeRatio || 1),
        amount: Number(t.amount || 0),
        marketCap: Number(t.marketCap || 0),
        industry: t.industry || pf.category || 'PandaAI',
        signalScore: Math.min(99, Math.max(40, Math.round(70 + (t.zScore || 0) * 10))),
        reasons: [
          t.signal || '多头ALPHA',
          t.zScore !== undefined ? `Z=${t.zScore.toFixed(2)}` : `V=${(t.factorValue || 0).toFixed(3)}`,
          t.reason || pf.pool || 'PandaAI挖掘',
        ],
      }));

      if (forTab === 'strategy') {
        setScreenerData({
          updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          strategyName: `PandaAI · ${pf.name}`,
          totalScanned: 5500,
          matched: mapped,
        });
      } else {
        setPandaFactorEval({
          factor: json.factor || pf,
          stats: json.stats || {},
          targets: mapped,
        });
        setFactorData(null);
      }
    } catch (e: any) {
      if (forTab === 'strategy') setStratError(e?.message || 'PandaAI 因子扫描失败');
      else setFactorError(e?.message || 'PandaAI 因子评估失败');
    } finally {
      if (forTab === 'strategy') setLoadingStrat(false);
      else setLoadingFactor(false);
    }
  }, []);

  const executeFactor = useCallback(async (factorId = selectedFactor) => {
    setPandaFactorEval(null);
    setLoadingFactor(true);
    setFactorError(null);
    try {
      const res = await api.runScreener({ factorId });
      setFactorData(res);
    } catch (e: any) {
      setFactorError(e?.message || '因子研究评估失败');
    } finally {
      setLoadingFactor(false);
    }
  }, [selectedFactor]);

  useEffect(() => {
    if (activeTab === 'strategy' && !screenerData && !activePandaId) {
      executeStrategy(selectedStrategy, filters);
    }
    if (activeTab === 'factor' && !factorData && !pandaFactorEval) {
      executeFactor(selectedFactor);
    }
  }, [
    activeTab,
    screenerData,
    factorData,
    pandaFactorEval,
    activePandaId,
    executeStrategy,
    executeFactor,
    selectedStrategy,
    filters,
    selectedFactor,
  ]);

  useEffect(() => {
    if (activeTab !== 'factor' || !factorChartRef.current) return;
    const quintiles = factorData?.factorEval?.quintiles;
    const pandaStats = pandaFactorEval?.stats;
    if (!quintiles && !pandaStats) return;

    const chart = echarts.init(factorChartRef.current);

    if (quintiles) {
      chart.setOption({
        backgroundColor: '#0d1015',
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#141923',
          borderColor: '#2b3342',
          textStyle: { color: '#e8edf5', fontSize: 11 },
        },
        legend: {
          data: ['分组平均收益(%)', '分组胜率(%)'],
          top: 4,
          right: 12,
          textStyle: { color: '#8b95a5', fontSize: 11 },
        },
        grid: { left: 48, right: 48, top: 34, bottom: 26 },
        xAxis: {
          type: 'category',
          data: quintiles.map((q) => q.group),
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { color: '#8b95a5', fontSize: 11 },
        },
        yAxis: [
          {
            type: 'value',
            splitLine: { lineStyle: { color: '#1b212c', type: 'dashed' } },
            axisLabel: { color: '#8b95a5', fontSize: 10, formatter: '{value}%' },
          },
          {
            type: 'value',
            min: 0,
            max: 100,
            splitLine: { show: false },
            axisLabel: { color: '#4da3ff', fontSize: 10, formatter: '{value}%' },
          },
        ],
        series: [
          {
            name: '分组平均收益(%)',
            type: 'bar',
            barWidth: '42%',
            data: quintiles.map((q) => ({
              value: Number(q.avgReturnPct.toFixed(2)),
              itemStyle: { color: q.avgReturnPct >= 0 ? '#ff3535' : '#00c853' },
            })),
            label: {
              show: true,
              position: 'top',
              formatter: (p: any) => `${p.value >= 0 ? '+' : ''}${p.value}%`,
              color: '#dfe6f0',
              fontSize: 10,
              fontFamily: 'monospace',
            },
          },
          {
            name: '分组胜率(%)',
            type: 'line',
            yAxisIndex: 1,
            symbolSize: 6,
            itemStyle: { color: '#4da3ff' },
            lineStyle: { width: 1.8, color: '#4da3ff' },
            data: quintiles.map((q) => Number(q.winRate.toFixed(1))),
          },
        ],
      });
    } else if (pandaStats && pandaFactorEval) {
      const topTargets = pandaFactorEval.targets.slice(0, 12);
      chart.setOption({
        backgroundColor: '#0d1015',
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#141923',
          borderColor: '#2b3342',
          textStyle: { color: '#e8edf5', fontSize: 11 },
        },
        grid: { left: 48, right: 16, top: 24, bottom: 44 },
        xAxis: {
          type: 'category',
          data: topTargets.map((t) => t.name),
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { color: '#8b95a5', fontSize: 10, rotate: 20 },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: '#1b212c', type: 'dashed' } },
          axisLabel: { color: '#8b95a5', fontSize: 10, formatter: '{value}%' },
        },
        series: [
          {
            name: '实时涨跌幅(%)',
            type: 'bar',
            barWidth: '46%',
            data: topTargets.map((t) => ({
              value: Number(t.changePct.toFixed(2)),
              itemStyle: { color: t.changePct >= 0 ? '#ff3535' : '#00c853' },
            })),
          },
        ],
      });
    }

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [activeTab, factorData, pandaFactorEval]);

  const handleSelectPreset = (preset: StrategyPreset) => {
    setSelectedStrategy(preset.id);
    setFilters(preset.defaults);
    executeStrategy(preset.id, preset.defaults);
  };

  const handleQuickAddWatchlist = async (item: ScreenerResultItem) => {
    try {
      await api.upsertWatchlist({ code: item.code, name: item.name });
      setAddedCodes((prev) => new Set(prev).add(item.code));
    } catch {
      // ignore
    }
  };

  const currentFactorMeta =
    FACTOR_PRESETS.find((f) => f.id === selectedFactor) || FACTOR_PRESETS[0];

  const renderResultTable = (items: ScreenerResultItem[], emptyText: string) => {
    if (!items.length) {
      return <div className="p-8 text-center text-[12px] text-[#7d8796]">{emptyText}</div>;
    }
    return (
      <table className="w-full text-left border-collapse">
        <thead className="sticky top-0 z-10 bg-[#151a23] border-b border-[#252c38] text-[11px] text-[#8b95a5]">
          <tr className="h-[26px]">
            <th className="px-2 w-8 text-center">序</th>
            <th className="px-2">代码</th>
            <th className="px-2">名称</th>
            <th className="px-2">行业/板块</th>
            <th className="px-2 text-right">现价</th>
            <th className="px-2 text-right">涨跌幅</th>
            <th className="px-2 text-right">换手%</th>
            <th className="px-2 text-right">量比</th>
            <th className="px-2 text-right">成交额</th>
            <th className="px-2 text-right">总市值</th>
            <th className="px-2 text-right">评分</th>
            <th className="px-2">量化入选依据</th>
            <th className="px-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="text-[12px] tabular-nums">
          {items.map((item, idx) => {
            const isAdded = addedCodes.has(item.code);
            return (
              <tr
                key={item.code}
                onClick={() => onSelectStock(item.code, item.name)}
                className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434] cursor-pointer"
              >
                <td className="px-2 text-center font-mono text-[11px] text-[#7d8796]">{idx + 1}</td>
                <td className="px-2 font-mono text-[#e5b567]">{item.code}</td>
                <td className="px-2 text-[#e8edf5] font-medium whitespace-nowrap">{item.name}</td>
                <td className="px-2 text-[11px] text-[#8b95a5] whitespace-nowrap">
                  {item.industry || '-'}
                </td>
                <td className={`px-2 text-right font-mono font-semibold ${upDownCls(item.changePct)}`}>
                  {item.price.toFixed(2)}
                </td>
                <td className={`px-2 text-right font-mono font-semibold ${upDownCls(item.changePct)}`}>
                  {formatPct(item.changePct)}
                </td>
                <td className="px-2 text-right font-mono text-[#dfe6f0]">
                  {item.turnoverRate ? `${item.turnoverRate.toFixed(2)}%` : '-'}
                </td>
                <td
                  className={`px-2 text-right font-mono ${
                    item.volumeRatio >= 2 ? 'text-[#f0b90b] font-semibold' : 'text-[#dfe6f0]'
                  }`}
                >
                  {item.volumeRatio ? item.volumeRatio.toFixed(2) : '-'}
                </td>
                <td className="px-2 text-right font-mono text-[#f0b90b]">
                  {item.amount ? formatAmount(item.amount) : '-'}
                </td>
                <td className="px-2 text-right font-mono text-[#8b95a5]">
                  {item.marketCap ? formatAmount(item.marketCap) : '-'}
                </td>
                <td className="px-2 text-right font-mono font-bold text-[#ff9500]">
                  {item.signalScore}
                </td>
                <td className="px-2 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    {(item.reasons || []).slice(0, 3).map((r, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-1 py-0.5 rounded-[2px] bg-[#161b24] border border-[#2b3342] text-[#4da3ff]"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <button
                    disabled={isAdded}
                    onClick={() => handleQuickAddWatchlist(item)}
                    className={`px-1.5 py-0.5 rounded-[2px] text-[10px] border ${
                      isAdded
                        ? 'border-[#252c38] text-[#5c6675]'
                        : 'border-[#ff8800] text-[#ff9500] hover:bg-[#ff8800] hover:text-[#090c10]'
                    }`}
                  >
                    {isAdded ? '已自选' : '+自选'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#222832] gap-[1px] overflow-hidden">
      {/* Top 28px Wind Tab Bar */}
      <div className="h-[28px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center h-full gap-3">
          <div className="flex items-center">
            <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
            <span className="text-[12px] font-bold text-[#dfe6f0]">
              F7 量化选股与多因子 Alpha 研究终端
            </span>
          </div>

          <div className="flex items-center h-full border-l border-[#232a36]">
            <button
              onClick={() => setActiveTab('strategy')}
              className={`h-full px-3 text-[11px] font-medium border-r border-[#232a36] ${
                activeTab === 'strategy'
                  ? 'bg-[#0e1117] text-[#ff9500] border-t-2 border-t-[#ff8800]'
                  : 'text-[#8b95a5] hover:text-[#e8edf5]'
              }`}
            >
              [01] 策略选股与PandaAI因子扫盘
            </button>
            <button
              onClick={() => setActiveTab('factor')}
              className={`h-full px-3 text-[11px] font-medium border-r border-[#232a36] ${
                activeTab === 'factor'
                  ? 'bg-[#0e1117] text-[#ff9500] border-t-2 border-t-[#ff8800]'
                  : 'text-[#8b95a5] hover:text-[#e8edf5]'
              }`}
            >
              [02] 多因子 IC / 分层收益检验
            </button>
          </div>
        </div>

        <div className="text-[11px] font-mono text-[#7d8796]">
          全市场实时截面扫描 · A股红涨绿跌
        </div>
      </div>

      {activeTab === 'strategy' ? (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-[1px] bg-[#222832] overflow-hidden">
          {/* Left 4 cols: Strategy Presets + PandaAI Local Mined Factors + Filter Sliders */}
          <div className="lg:col-span-4 bg-[#0e1117] flex flex-col min-h-0 overflow-y-auto">
            <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0">
              <div className="flex items-center">
                <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
                <span className="text-[12px] font-bold text-[#dfe6f0]">经典战法与参数条件</span>
              </div>
              <button
                onClick={() => executeStrategy(selectedStrategy, filters)}
                disabled={loadingStrat}
                className="px-2.5 h-[20px] rounded-[2px] bg-[#ff8800] text-[#090c10] text-[11px] font-bold hover:bg-[#ff9922] disabled:opacity-60"
              >
                {loadingStrat ? '扫描中...' : '执行选股'}
              </button>
            </div>

            <div className="p-2.5 space-y-2.5 text-[11px]">
              {/* 5 Classic Presets */}
              <div className="space-y-1">
                {STRATEGY_PRESETS.map((preset) => {
                  const active = !activePandaId && selectedStrategy === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => handleSelectPreset(preset)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-[2px] border flex items-center justify-between ${
                        active
                          ? 'bg-[#161b24] border-[#ff8800] text-[#ff9500]'
                          : 'bg-[#11151d] border-[#232a36] text-[#dfe6f0] hover:border-[#4da3ff]'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold truncate">{preset.name}</div>
                        <div className="text-[10px] text-[#7d8796] truncate">{preset.desc}</div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-[2px] border border-[#2b3342] text-[#8b95a5] shrink-0">
                        {preset.tag}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* PandaAI Local Mined Factors */}
              {pandaFactors.length > 0 && (
                <div className="border-t border-[#232a36] pt-2 space-y-1.5">
                  <div className="text-[11px] font-bold text-[#f0b90b]">
                    PandaAI 本地挖掘因子策略 (实盘截面扫盘)
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    {pandaFactors.map((pf) => {
                      const isActive = activePandaId === pf.id;
                      return (
                        <button
                          key={pf.id}
                          onClick={() => executePandaScan(pf, 'strategy')}
                          className={`w-full text-left px-2 py-1.5 rounded-[2px] border flex items-center justify-between ${
                            isActive
                              ? 'bg-[#211b0c] border-[#f0b90b] text-[#f0b90b]'
                              : 'bg-[#11151d] border-[#232a36] text-[#dfe6f0] hover:border-[#f0b90b]'
                          }`}
                        >
                          <span className="truncate font-medium pr-2">{pf.name}</span>
                          <span className="font-mono text-[10px] text-[#e5b567] shrink-0">
                            SR {(pf.sharpe ?? 0).toFixed(2)} | IC {(pf.rankIc ?? pf.ic ?? 0).toFixed(3)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Numeric Filter Controls */}
              <div className="border-t border-[#232a36] pt-2 space-y-2">
                <div className="text-[11px] font-bold text-[#dfe6f0]">自定义行情过滤条件</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-[#7d8796] mb-0.5">涨跌幅区间 (%)</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.5"
                        value={filters.minChangePct ?? -10}
                        onChange={(e) =>
                          setFilters({ ...filters, minChangePct: Number(e.target.value) })
                        }
                        className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1.5 font-mono text-[#e8edf5]"
                      />
                      <span className="text-[#5c6675]">~</span>
                      <input
                        type="number"
                        step="0.5"
                        value={filters.maxChangePct ?? 20.5}
                        onChange={(e) =>
                          setFilters({ ...filters, maxChangePct: Number(e.target.value) })
                        }
                        className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1.5 font-mono text-[#e8edf5]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#7d8796] mb-0.5">换手率区间 (%)</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.5"
                        value={filters.minTurnover ?? 0}
                        onChange={(e) =>
                          setFilters({ ...filters, minTurnover: Number(e.target.value) })
                        }
                        className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1.5 font-mono text-[#e8edf5]"
                      />
                      <span className="text-[#5c6675]">~</span>
                      <input
                        type="number"
                        step="1"
                        value={filters.maxTurnover ?? 50}
                        onChange={(e) =>
                          setFilters({ ...filters, maxTurnover: Number(e.target.value) })
                        }
                        className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1.5 font-mono text-[#e8edf5]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#7d8796] mb-0.5">
                      量比下限 ({filters.minVolRatio ?? 1}x)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={filters.minVolRatio ?? 1}
                      onChange={(e) =>
                        setFilters({ ...filters, minVolRatio: Number(e.target.value) })
                      }
                      className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1.5 font-mono text-[#f0b90b]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#7d8796] mb-0.5">总市值 (亿元)</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="10"
                        value={filters.minMarketCap ?? 0}
                        onChange={(e) =>
                          setFilters({ ...filters, minMarketCap: Number(e.target.value) })
                        }
                        className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1.5 font-mono text-[#e8edf5]"
                      />
                      <span className="text-[#5c6675]">~</span>
                      <input
                        type="number"
                        step="50"
                        value={filters.maxMarketCap ?? 10000}
                        onChange={(e) =>
                          setFilters({ ...filters, maxMarketCap: Number(e.target.value) })
                        }
                        className="w-full h-[24px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-1.5 font-mono text-[#e8edf5]"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 pt-1 text-[#dfe6f0]">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.excludeSt ?? true}
                      onChange={(e) => setFilters({ ...filters, excludeSt: e.target.checked })}
                      className="accent-[#ff8800]"
                    />
                    <span>排除 ST/*ST</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.excludeBse ?? true}
                      onChange={(e) => setFilters({ ...filters, excludeBse: e.target.checked })}
                      className="accent-[#ff8800]"
                    />
                    <span>排除北交所</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Right 8 cols: Screener Result Table */}
          <div className="lg:col-span-8 bg-[#0e1117] flex flex-col min-h-0 overflow-hidden">
            <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-[2px] h-3 bg-[#ff8800] inline-block" />
                <span className="text-[12px] font-bold text-[#dfe6f0]">
                  {screenerData?.strategyName || '选股结果池'}
                </span>
                {screenerData && (
                  <span className="font-mono text-[11px] text-[#7d8796]">
                    扫描:{screenerData.totalScanned} | 命中:
                    <b className="text-[#ff3535] ml-1">{screenerData.matched.length}</b>
                  </span>
                )}
              </div>
              {screenerData?.updatedAt && (
                <span className="font-mono text-[11px] text-[#7d8796]">
                  {screenerData.updatedAt}
                </span>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              {stratError ? (
                <div className="p-8 text-center text-[12px] text-[#ff3535]">{stratError}</div>
              ) : loadingStrat ? (
                <div className="p-10 text-center text-[12px] text-[#7d8796]">
                  正在执行全市场量化扫描...
                </div>
              ) : (
                renderResultTable(
                  screenerData?.matched || [],
                  '当前筛选条件下无命中标的，请放宽条件后重试'
                )
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Factor Research Tab */
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-[1px] bg-[#222832] overflow-hidden">
          {/* Left 3 cols: Factor Directory */}
          <div className="lg:col-span-3 bg-[#0e1117] flex flex-col min-h-0 overflow-y-auto">
            <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center shrink-0">
              <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
              <span className="text-[12px] font-bold text-[#dfe6f0]">因子目录与本地库</span>
            </div>
            <div className="p-2 space-y-1.5 text-[11px]">
              <div className="text-[10px] text-[#7d8796] px-1">标准量价技术因子:</div>
              {FACTOR_PRESETS.map((f) => {
                const active = !pandaFactorEval && selectedFactor === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => {
                      setSelectedFactor(f.id);
                      executeFactor(f.id);
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-[2px] border ${
                      active
                        ? 'bg-[#161b24] border-[#ff8800] text-[#ff9500]'
                        : 'bg-[#11151d] border-[#232a36] text-[#dfe6f0] hover:border-[#4da3ff]'
                    }`}
                  >
                    <div className="font-semibold">{f.name}</div>
                    <div className="font-mono text-[10px] text-[#4da3ff] truncate">{f.formula}</div>
                  </button>
                );
              })}

              {pandaFactors.length > 0 && (
                <>
                  <div className="text-[10px] text-[#f0b90b] px-1 pt-2 border-t border-[#232a36]">
                    PandaAI 本地挖掘因子库:
                  </div>
                  {pandaFactors.map((pf) => {
                    const active = pandaFactorEval?.factor?.id === pf.id;
                    return (
                      <button
                        key={pf.id}
                        onClick={() => executePandaScan(pf, 'factor')}
                        className={`w-full text-left px-2 py-1.5 rounded-[2px] border ${
                          active
                            ? 'bg-[#211b0c] border-[#f0b90b] text-[#f0b90b]'
                            : 'bg-[#11151d] border-[#232a36] text-[#dfe6f0] hover:border-[#f0b90b]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold truncate">{pf.name}</span>
                          <span className="font-mono text-[10px] text-[#e5b567] shrink-0">
                            SR {(pf.sharpe ?? 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-[#7d8796] truncate">
                          {pf.pool || pf.category}
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>

          {/* Right 9 cols: Stats + Chart + Ranked Stocks */}
          <div className="lg:col-span-9 flex flex-col gap-[1px] bg-[#222832] min-h-0 overflow-hidden">
            {factorError ? (
              <div className="flex-1 bg-[#0e1117] p-8 text-center text-[12px] text-[#ff3535]">
                {factorError}
              </div>
            ) : loadingFactor ? (
              <div className="flex-1 bg-[#0e1117] p-10 text-center text-[12px] text-[#7d8796]">
                正在计算因子 IC / RankIC 与分层收益...
              </div>
            ) : pandaFactorEval ? (
              <>
                <div className="bg-[#0e1117] p-2.5 shrink-0 flex flex-wrap items-center justify-between gap-3 text-[12px]">
                  <div className="min-w-0">
                    <span className="font-bold text-[#f0b90b] mr-2">
                      {pandaFactorEval.factor.name}
                    </span>
                    <span className="font-mono text-[11px] text-[#7d8796]">
                      {pandaFactorEval.factor.expression || pandaFactorEval.factor.description}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 font-mono tabular-nums shrink-0">
                    <span>
                      多头均涨:{' '}
                      <b className={upDownCls(pandaFactorEval.stats?.longTopAvgPct)}>
                        {formatPct(pandaFactorEval.stats?.longTopAvgPct)}
                      </b>
                    </span>
                    <span>
                      空头均涨:{' '}
                      <b className={upDownCls(pandaFactorEval.stats?.shortBottomAvgPct)}>
                        {formatPct(pandaFactorEval.stats?.shortBottomAvgPct)}
                      </b>
                    </span>
                    <span>
                      多空剪刀差:{' '}
                      <b className="text-[#f0b90b]">
                        {formatPct(pandaFactorEval.stats?.spreadPct)}
                      </b>
                    </span>
                  </div>
                </div>
                <div className="bg-[#0e1117] h-[220px] shrink-0">
                  <div ref={factorChartRef} className="w-full h-full" />
                </div>
                <div className="flex-1 min-h-0 bg-[#0e1117] overflow-auto">
                  {renderResultTable(pandaFactorEval.targets, '暂无匹配标的')}
                </div>
              </>
            ) : factorData?.factorEval ? (
              <>
                <div className="bg-[#0e1117] px-3 py-2 shrink-0 flex flex-wrap items-center justify-between gap-3 text-[12px]">
                  <div>
                    <span className="font-bold text-[#dfe6f0] mr-2">
                      {factorData.factorEval.factorName}
                    </span>
                    <span className="font-mono text-[11px] text-[#4da3ff]">
                      {currentFactorMeta.formula}
                    </span>
                  </div>
                  <div className="flex items-center gap-5 font-mono tabular-nums">
                    <span>
                      IC:{' '}
                      <b className={upDownCls(factorData.factorEval.ic)}>
                        {factorData.factorEval.ic >= 0 ? '+' : ''}
                        {factorData.factorEval.ic.toFixed(4)}
                      </b>
                    </span>
                    <span>
                      RankIC:{' '}
                      <b className={upDownCls(factorData.factorEval.rankIc)}>
                        {factorData.factorEval.rankIc >= 0 ? '+' : ''}
                        {factorData.factorEval.rankIc.toFixed(4)}
                      </b>
                    </span>
                    <span>
                      IR: <b className="text-[#4da3ff]">{factorData.factorEval.ir.toFixed(2)}</b>
                    </span>
                  </div>
                </div>
                <div className="bg-[#0e1117] h-[220px] shrink-0">
                  <div ref={factorChartRef} className="w-full h-full" />
                </div>
                <div className="flex-1 min-h-0 bg-[#0e1117] overflow-auto">
                  {renderResultTable(factorData.matched || [], '暂无因子头部标的')}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
