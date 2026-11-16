import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Database,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { api, formatAmount } from '../api/client';
import type {
  AltConsensusBacktestResponse,
  AltConsensusOverviewResponse,
  AltConsensusSourceType,
  ConsensusCollectorConfig,
  CpoTransmissionBacktestResponse,
  CpoTransmissionOverviewResponse,
  FuturesTermStructureItem,
} from '../types/market';

export interface ConsensusCpoPageProps {
  onSelectStock: (code: string, name?: string) => void;
  onNavigate?: (tab: string) => void;
}

type SubTabId = 'cpo-dag' | 'cross-venue' | 'shadow-options' | 'term-structure' | 'ingestion-ops';

function safeNum(val: unknown, fallback = 0): number {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function fmtPct(val: unknown, digits = 2): string {
  const n = safeNum(val, NaN);
  if (Number.isNaN(n)) return '--';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtNum(val: unknown, digits = 2): string {
  const n = safeNum(val, NaN);
  if (Number.isNaN(n)) return '--';
  return n.toFixed(digits);
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

function isAShareCode(symbol?: string): boolean {
  if (!symbol) return false;
  return /^\d{6}$/.test(symbol.trim());
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
      <div className={`text-[14px] font-bold tabular-nums leading-tight mt-0.5 ${valueClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-[#6d7787] tabular-nums truncate mt-0.5">{sub}</div>}
    </div>
  );
}

interface AltBacktestTerminalProps {
  title: string;
  sourceOptions: { value: AltConsensusSourceType; label: string }[];
  sourceType: AltConsensusSourceType;
  onChangeSourceType: (v: AltConsensusSourceType) => void;
  signalOptions: { value: string; label: string }[];
  signalId: string;
  onChangeSignalId: (v: string) => void;
  assetOptions: { value: string; label: string }[];
  assetSymbol: string;
  onChangeAssetSymbol: (v: string) => void;
  onSelectStock: (code: string, name?: string) => void;
  autoRunKey: string;
}

function AltBacktestTerminal({
  title,
  sourceOptions,
  sourceType,
  onChangeSourceType,
  signalOptions,
  signalId,
  onChangeSignalId,
  assetOptions,
  assetSymbol,
  onChangeAssetSymbol,
  onSelectStock,
  autoRunKey,
}: AltBacktestTerminalProps) {
  const [days, setDays] = useState<number>(120);
  const [entryZ, setEntryZ] = useState<number>(1.25);
  const [holdingDays, setHoldingDays] = useState<number>(5);
  const [leverage, setLeverage] = useState<number>(1);
  const [useKelly, setUseKelly] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AltConsensusBacktestResponse | null>(null);

  const leadLagChartRef = useRef<HTMLDivElement | null>(null);
  const equityChartRef = useRef<HTMLDivElement | null>(null);

  const isEquity = isAShareCode(assetSymbol);

  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.runAltConsensusBacktest({
        sourceType,
        signalId: signalId || undefined,
        assetSymbol,
        days,
        entryZThreshold: entryZ,
        holdingDays,
        leverage: isEquity ? 1 : leverage,
        useKellySizing: useKelly,
        stopLossPct: 5,
        initialCapital: 500000,
      });
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '回测执行失败');
    } finally {
      setLoading(false);
    }
  }, [sourceType, signalId, assetSymbol, days, entryZ, holdingDays, leverage, useKelly, isEquity]);

  useEffect(() => {
    runBacktest();
  }, [autoRunKey, runBacktest]);

  useEffect(() => {
    const dom = leadLagChartRef.current;
    if (!dom || !result?.leadLagProfile?.length) return;
    const chart = echarts.init(dom);
    const prof = result.leadLagProfile;
    chart.setOption({
      backgroundColor: '#0d1015',
      animation: false,
      grid: { left: 42, right: 16, top: 26, bottom: 26 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#161b24',
        borderColor: '#2b3444',
        textStyle: { color: '#dfe6f0', fontSize: 11 },
      },
      title: {
        text: 'Lead-Lag 领先滞后相关谱 (-5d .. +5d, 正Lag=信号领先标的)',
        left: 8,
        top: 4,
        textStyle: { color: '#9aa5b5', fontSize: 11, fontWeight: 600 },
      },
      xAxis: {
        type: 'category',
        data: prof.map((p) => (p.lag > 0 ? `+${p.lag}d` : `${p.lag}d`)),
        axisLine: { lineStyle: { color: '#222832' } },
        axisLabel: { color: '#8b95a5', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
        axisLabel: { color: '#8b95a5', fontSize: 10, formatter: (v: number) => v.toFixed(2) },
      },
      series: [
        {
          name: 'Pearson Corr',
          type: 'bar',
          barMaxWidth: 20,
          data: prof.map((p) => ({
            value: safeNum(p.corr),
            itemStyle: {
              color:
                p.lag === result.optimalLagDays
                  ? '#ff8800'
                  : safeNum(p.corr) >= 0
                  ? '#ff3535'
                  : '#00c853',
            },
          })),
        },
        {
          name: 'Rank Corr',
          type: 'line',
          symbolSize: 4,
          data: prof.map((p) => safeNum(p.rankCorr)),
          lineStyle: { width: 1.4, color: '#4da3ff' },
          itemStyle: { color: '#4da3ff' },
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [result]);

  useEffect(() => {
    const dom = equityChartRef.current;
    if (!dom || !result?.equityCurve?.length) return;
    const chart = echarts.init(dom);
    const curve = result.equityCurve;
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
        itemWidth: 14,
        itemHeight: 8,
        data: ['信号策略净值%', '标的基准%', '水下回撤%'],
      },
      grid: [
        { left: 46, right: 16, top: 28, height: '54%' },
        { left: 46, right: 16, top: '73%', height: '18%' },
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
          name: '信号策略净值%',
          type: 'line',
          showSymbol: false,
          data: curve.map((c) => safeNum(c.returnPct)),
          lineStyle: { width: 1.8, color: '#ff8800' },
        },
        {
          name: '标的基准%',
          type: 'line',
          showSymbol: false,
          data: curve.map((c) => safeNum(c.benchmarkPct)),
          lineStyle: { width: 1.2, color: '#4da3ff', type: 'dashed' },
        },
        {
          name: '水下回撤%',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          data: curve.map((c) => -Math.abs(safeNum(c.drawdownPct))),
          lineStyle: { width: 1, color: '#00c853' },
          areaStyle: { color: 'rgba(0, 200, 83, 0.18)' },
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [result]);

  return (
    <div className="flex flex-col h-full bg-[#090c10] gap-[1px]">
      <div className="w-pane flex flex-col shrink-0">
        <PaneHeader
          title={title}
          badge={result ? `${result.assetSymbol} · ${result.executionRule}` : '09:00 CST 严格防前视'}
          right={
            <button
              type="button"
              onClick={runBacktest}
              disabled={loading}
              className="h-[20px] px-2 bg-[#ff8800] text-[#090c10] font-bold text-[11px] flex items-center gap-1 hover:bg-[#ff9c2a] disabled:opacity-60"
            >
              <Play className="w-3 h-3" />
              {loading ? '计算中...' : '运行联立回测'}
            </button>
          }
        />

        <div className="p-2 bg-[#0e1117] border-b border-[#222832] flex flex-wrap items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1 text-[#8b95a5]">
            <span>信号源</span>
            <select
              value={sourceType}
              onChange={(e) => onChangeSourceType(e.target.value as AltConsensusSourceType)}
              className="h-[24px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] px-1.5 outline-none"
            >
              {sourceOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {signalOptions.length > 0 && (
            <label className="flex items-center gap-1 text-[#8b95a5] max-w-[260px]">
              <span>子信号</span>
              <select
                value={signalId}
                onChange={(e) => onChangeSignalId(e.target.value)}
                className="h-[24px] bg-[#161b24] border border-[#2a3240] text-[#e5b567] px-1.5 outline-none max-w-[200px]"
              >
                {signalOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex items-center gap-1 text-[#8b95a5]">
            <span>交易标的</span>
            <select
              value={assetSymbol}
              onChange={(e) => onChangeAssetSymbol(e.target.value)}
              className="h-[24px] bg-[#161b24] border border-[#2a3240] text-[#e5b567] px-1.5 outline-none"
            >
              {assetOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1 text-[#8b95a5]">
            <span>窗口</span>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-[24px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] px-1.5 outline-none tabular-nums"
            >
              <option value={60}>60D</option>
              <option value={120}>120D</option>
              <option value={180}>180D</option>
            </select>
          </label>

          <label className="flex items-center gap-1 text-[#8b95a5]">
            <span>触发Z阈值</span>
            <select
              value={entryZ}
              onChange={(e) => setEntryZ(Number(e.target.value))}
              className="h-[24px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] px-1.5 outline-none tabular-nums"
            >
              <option value={1.0}>1.00</option>
              <option value={1.25}>1.25</option>
              <option value={1.5}>1.50</option>
              <option value={2.0}>2.00</option>
            </select>
          </label>

          <label className="flex items-center gap-1 text-[#8b95a5]">
            <span>持有</span>
            <select
              value={holdingDays}
              onChange={(e) => setHoldingDays(Number(e.target.value))}
              className="h-[24px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] px-1.5 outline-none tabular-nums"
            >
              <option value={3}>3D</option>
              <option value={5}>5D</option>
              <option value={10}>10D</option>
            </select>
          </label>

          {!isEquity && (
            <label className="flex items-center gap-1 text-[#8b95a5]">
              <span>期货杠杆</span>
              <select
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="h-[24px] bg-[#161b24] border border-[#2a3240] text-[#f0b90b] px-1.5 outline-none tabular-nums"
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={3}>3x</option>
                <option value={5}>5x</option>
              </select>
            </label>
          )}

          <label className="flex items-center gap-1 text-[#cfd8e3] cursor-pointer">
            <input
              type="checkbox"
              checked={useKelly}
              onChange={(e) => setUseKelly(e.target.checked)}
              className="accent-[#ff8800]"
            />
            <span>半Kelly仓位</span>
          </label>

          {isEquity && (
            <button
              type="button"
              onClick={() => onSelectStock(assetSymbol, result?.assetName)}
              className="ml-auto px-2 h-[22px] bg-[#161b24] border border-[#2a3240] text-[#e5b567] hover:border-[#ff8800] text-[11px]"
            >
              调出 {assetSymbol} 日K
            </button>
          )}
        </div>

        {error && (
          <div className="px-2.5 py-1.5 bg-[#1d1214] border-b border-[#4d2025] text-[#ff3535] text-[11px]">
            回测异常: {error}
          </div>
        )}

        {result && (
          <div className="grid grid-cols-5 lg:grid-cols-10 gap-[1px] bg-[#222832]">
            <KpiCell
              label="最优领先Lag"
              value={result.optimalLagDays > 0 ? `+${result.optimalLagDays}D` : `${result.optimalLagDays}D`}
              sub="正值=信号领先"
              tone="orange"
            />
            <KpiCell
              label="冲击相关Corr"
              value={fmtSigned(result.shockCorr, 3)}
              sub={`胜率 ${fmtNum(result.shockHitRate, 1)}%`}
              tone={result.shockCorr >= 0 ? 'up' : 'down'}
            />
            <KpiCell
              label="当前Signal Z"
              value={fmtSigned(result.currentSignalZ, 2)}
              sub={`半Kelly ${fmtNum(result.kellySuggestedPct, 1)}%`}
              tone="gold"
            />
            <KpiCell
              label="累计收益"
              value={fmtPct(result.metrics.totalReturnPct)}
              sub={`年化 ${fmtPct(result.metrics.annualReturnPct)}`}
              tone={result.metrics.totalReturnPct >= 0 ? 'up' : 'down'}
            />
            <KpiCell
              label="超额Alpha"
              value={fmtPct(result.metrics.excessReturnPct)}
              sub={`IR ${fmtNum(result.metrics.informationRatio, 2)}`}
              tone={result.metrics.excessReturnPct >= 0 ? 'up' : 'down'}
            />
            <KpiCell
              label="Sharpe"
              value={fmtNum(result.metrics.sharpe, 2)}
              sub={`PF ${fmtNum(result.metrics.profitFactor, 2)}`}
              tone="blue"
            />
            <KpiCell
              label="最大回撤"
              value={`-${Math.abs(safeNum(result.metrics.maxDrawdownPct)).toFixed(2)}%`}
              sub="风控硬约束"
              tone="down"
            />
            <KpiCell
              label="胜率"
              value={`${fmtNum(result.metrics.winRatePct, 1)}%`}
              sub={`${result.metrics.tradeCount} 笔交易`}
              tone="neutral"
            />
            <KpiCell
              label="起止区间"
              value={result.startDate.slice(5)}
              sub={`至 ${result.endDate.slice(5)}`}
              tone="neutral"
            />
            <KpiCell
              label="信号源标签"
              value={result.sourceLabel.slice(0, 8)}
              sub={result.assetName}
              tone="gold"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-[1px] bg-[#222832] shrink-0">
        <div className="xl:col-span-5 bg-[#0d1015] h-[220px]" ref={leadLagChartRef} />
        <div className="xl:col-span-7 bg-[#0d1015] h-[220px]" ref={equityChartRef} />
      </div>

      <div className="w-pane flex-1 min-h-[180px] flex flex-col overflow-hidden">
        <PaneHeader
          title="联立事件交易明细 Blotter"
          badge={`${result?.trades?.length ?? 0} 笔`}
          right={result ? `${result.startDate} ~ ${result.endDate}` : ''}
        />
        <div className="flex-1 overflow-auto">
          <table className="w-table">
            <thead>
              <tr>
                <th className="text-left">#</th>
                <th className="text-left">入场</th>
                <th className="text-left">出场</th>
                <th className="text-center">方向</th>
                <th className="text-right">入场价</th>
                <th className="text-right">出场价</th>
                <th className="text-right">信号Z</th>
                <th className="text-right">仓位%</th>
                <th className="text-right">收益%</th>
                <th className="text-right">盈亏额</th>
                <th className="text-left">触发与平仓归因</th>
              </tr>
            </thead>
            <tbody>
              {(result?.trades || []).map((t) => (
                <tr key={t.id}>
                  <td className="text-[#7d8796]">{t.id}</td>
                  <td className="text-[#cfd8e3]">{t.entryDate}</td>
                  <td className="text-[#cfd8e3]">{t.exitDate}</td>
                  <td className="text-center">
                    <span
                      className={`px-1 text-[10px] border ${
                        t.side === '做多'
                          ? 'border-[#ff3535]/50 text-[#ff3535] bg-[#241214]'
                          : 'border-[#00c853]/50 text-[#00c853] bg-[#0f2218]'
                      }`}
                    >
                      {t.side}
                    </span>
                  </td>
                  <td className="text-right text-[#cfd8e3]">{fmtNum(t.entryPrice, 2)}</td>
                  <td className="text-right text-[#cfd8e3]">{fmtNum(t.exitPrice, 2)}</td>
                  <td className="text-right text-[#f0b90b]">{fmtSigned(t.signalZ, 2)}</td>
                  <td className="text-right text-[#e5b567]">{fmtNum(t.positionPct, 1)}%</td>
                  <td className={`text-right font-semibold ${colorUpDown(t.returnPct)}`}>
                    {fmtPct(t.returnPct, 2)}
                  </td>
                  <td className={`text-right ${colorUpDown(t.pnl)}`}>{fmtSigned(t.pnl, 0)}</td>
                  <td className="text-[#9aa5b5] max-w-[280px] truncate" title={t.reason}>
                    {t.reason}
                  </td>
                </tr>
              ))}
              {(!result || result.trades.length === 0) && (
                <tr>
                  <td colSpan={11} className="text-center text-[#6d7787] py-4">
                    {loading ? '正在计算信号对齐与历史回测...' : '当前参数下无满足阈值的触发交易，可适当降低Z阈值'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ConsensusCpoPage({ onSelectStock, onNavigate }: ConsensusCpoPageProps) {
  const [activeTab, setActiveTab] = useState<SubTabId>('cpo-dag');

  // Overview states
  const [cpoOverview, setCpoOverview] = useState<CpoTransmissionOverviewResponse | null>(null);
  const [cpoLoading, setCpoLoading] = useState<boolean>(false);
  const [cpoError, setCpoError] = useState<string | null>(null);

  const [altOverview, setAltOverview] = useState<AltConsensusOverviewResponse | null>(null);
  const [altLoading, setAltLoading] = useState<boolean>(false);
  const [altError, setAltError] = useState<string | null>(null);

  // Tab [01] CPO Backtest state
  const [cpoTarget, setCpoTarget] = useState<string>('159915');
  const [cpoDays, setCpoDays] = useState<number>(120);
  const [cpoCrowdingCap, setCpoCrowdingCap] = useState<number>(38);
  const [cpoReqUsPrior, setCpoReqUsPrior] = useState<boolean>(true);
  const [cpoReqVwap, setCpoReqVwap] = useState<boolean>(true);
  const [cpoReqDualCore, setCpoReqDualCore] = useState<boolean>(true);
  const [cpoUseKelly, setCpoUseKelly] = useState<boolean>(true);
  const [cpoBtLoading, setCpoBtLoading] = useState<boolean>(false);
  const [cpoBtError, setCpoBtError] = useState<string | null>(null);
  const [cpoBtResult, setCpoBtResult] = useState<CpoTransmissionBacktestResponse | null>(null);
  const cpoChartRef = useRef<HTMLDivElement | null>(null);
  const cpoAutoRanRef = useRef<boolean>(false);
  const [secondOrderAsc, setSecondOrderAsc] = useState<boolean>(true);

  // Tab [02] Cross-Venue state
  const [cvCategory, setCvCategory] = useState<string>('全部');
  const [cvSearch, setCvSearch] = useState<string>('');
  const [cvSortBy, setCvSortBy] = useState<'spread' | 'consensus' | 'delta'>('spread');
  const [cvSourceType, setCvSourceType] = useState<AltConsensusSourceType>('kalshi_pm_spread');
  const [cvSignalId, setCvSignalId] = useState<string>('');
  const [cvAssetSymbol, setCvAssetSymbol] = useState<string>('AU0');

  // Tab [03] Shadow Perps & Options Skew state
  const [soSourceType, setSoSourceType] = useState<AltConsensusSourceType>('hyperliquid_shadow_gap');
  const [soSignalId, setSoSignalId] = useState<string>('PAXG');
  const [soAssetSymbol, setSoAssetSymbol] = useState<string>('AU0');

  // Tab [04] Term Structure state
  const [tsFilter, setTsFilter] = useState<'all' | 'back' | 'contango'>('all');
  const [tsSortCol, setTsSortCol] = useState<'roll' | 'zscore' | 'spread'>('roll');
  const [tsSortAsc, setTsSortAsc] = useState<boolean>(false);
  const [tsSignalId, setTsSignalId] = useState<string>('LC');
  const [tsAssetSymbol, setTsAssetSymbol] = useState<string>('300750');
  const tsChartRef = useRef<HTMLDivElement | null>(null);

  // Tab [05] Ingestion & Snapshots state
  const [capturing, setCapturing] = useState<boolean>(false);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [cfgForm, setCfgForm] = useState<ConsensusCollectorConfig>({
    metaculusToken: '',
    githubToken: '',
    autoSnapshotMinutes: 15,
    egoCollectorEnabled: true,
  });
  const [savingCfg, setSavingCfg] = useState<boolean>(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const snapshotChartRef = useRef<HTMLDivElement | null>(null);

  // V6 Paper Trading Desk handoff state
  const [paperOrderKey, setPaperOrderKey] = useState<string | null>(null);
  const [paperToast, setPaperToast] = useState<{ ok: boolean; text: string } | null>(null);

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
      const isFutures = /^(IC|IM|IF|IH|AU|AG|SC|EC|LC|CU|RB|I|MA|TA|SI|M)\d*$/i.test(cleanSymbol);
      const market: 'ashare' | 'futures' = isFutures ? 'futures' : 'ashare';
      const resolvedAction = opts.action || 'buy_long';
      setPaperOrderKey(opts.key);
      setPaperToast(null);
      try {
        const res = await api.placePaperOrder({
          symbol: cleanSymbol,
          name: opts.name,
          market,
          action: resolvedAction,
          capitalAllocationPct: opts.capitalAllocationPct ?? 12,
          price: opts.price && opts.price > 0 ? opts.price : undefined,
          leverage: market === 'futures' ? 2 : 1,
          strategyTag: opts.strategyTag,
          note: opts.note,
        });
        const eq = res.activePortfolio?.totalEquity;
        setPaperToast({
          ok: true,
          text: `已直通 OMS 实盘专户 [${res.activePortfolio?.name || '主组合'}]: ${cleanSymbol} ${
            opts.name || ''
          } (${resolvedAction === 'open_short' ? '开仓做空' : resolvedAction === 'sell_long' ? '卖出平多' : '买入做多'}, 仓位约${
            opts.capitalAllocationPct ?? 12
          }%) · 最新净值 ¥${fmtNum(eq, 0)}`,
        });
      } catch (e: unknown) {
        setPaperToast({
          ok: false,
          text: `实盘下单失败 (${cleanSymbol}): ${e instanceof Error ? e.message : '未知错误'}`,
        });
      } finally {
        setPaperOrderKey(null);
      }
    },
    []
  );

  const loadCpoOverview = useCallback(async (silent = false) => {
    if (silent !== true) {
      setCpoLoading(true);
      setCpoError(null);
    }
    try {
      const res = await api.getCpoTransmissionOverview();
      setCpoOverview(res);
    } catch (e: unknown) {
      if (silent !== true) {
        setCpoError(e instanceof Error ? e.message : '加载CPO传导截面失败');
      }
    } finally {
      if (silent !== true) {
        setCpoLoading(false);
      }
    }
  }, []);

  const loadAltOverview = useCallback(async (silent = false) => {
    if (silent !== true) {
      setAltLoading(true);
      setAltError(null);
    }
    try {
      const res = await api.getAltConsensusOverview();
      setAltOverview(res);
      if (res.collectorConfig && silent !== true) {
        setCfgForm((prev) => ({
          ...prev,
          autoSnapshotMinutes: res.collectorConfig.autoSnapshotMinutes ?? 15,
          egoCollectorEnabled: res.collectorConfig.egoCollectorEnabled ?? true,
          hasMetaculusToken: res.collectorConfig.hasMetaculusToken,
          hasGithubToken: res.collectorConfig.hasGithubToken,
        }));
      }
      if (!cvSignalId && res.crossVenuePredictions?.length) {
        const first = res.crossVenuePredictions[0];
        setCvSignalId(first.id);
        if (first.mappedAssets?.[0]?.symbol) {
          setCvAssetSymbol(first.mappedAssets[0].symbol);
        }
      }
    } catch (e: unknown) {
      if (silent !== true) {
        setAltError(e instanceof Error ? e.message : '加载全维认知截面失败');
      }
    } finally {
      if (silent !== true) {
        setAltLoading(false);
      }
    }
  }, [cvSignalId]);

  useEffect(() => {
    loadCpoOverview();
    loadAltOverview();
  }, [loadCpoOverview, loadAltOverview]);

  useEffect(() => {
    const onJobTick = (evt: Event) => {
      const job = (evt as CustomEvent<{ job?: string }>).detail?.job;
      if (job === 'alert_and_cpo_watch') {
        void loadCpoOverview(true);
      } else if (job === 'consensus_auto_snapshot') {
        void loadAltOverview(true);
      }
    };
    window.addEventListener('tsp:job-tick', onJobTick);
    const timer = setInterval(() => {
      if (document.hidden) return;
      void loadCpoOverview(true);
      void loadAltOverview(true);
    }, 45_000);
    return () => {
      window.removeEventListener('tsp:job-tick', onJobTick);
      clearInterval(timer);
    };
  }, [loadCpoOverview, loadAltOverview]);

  const runCpoBacktest = useCallback(
    async (overrideTarget?: string) => {
      const target = overrideTarget || cpoTarget;
      setCpoBtLoading(true);
      setCpoBtError(null);
      try {
        const res = await api.runCpoTransmissionBacktest({
          targetSymbol: target,
          days: cpoDays,
          crowdingCapPct: cpoCrowdingCap,
          requireUsPrior: cpoReqUsPrior,
          requireVwapGate: cpoReqVwap,
          requireDualCore: cpoReqDualCore,
          useKellySizing: cpoUseKelly,
          initialCapital: 500000,
          stopLossPct: 5,
        });
        setCpoBtResult(res);
      } catch (e: unknown) {
        setCpoBtError(e instanceof Error ? e.message : 'CPO传导回测失败');
      } finally {
        setCpoBtLoading(false);
      }
    },
    [cpoTarget, cpoDays, cpoCrowdingCap, cpoReqUsPrior, cpoReqVwap, cpoReqDualCore, cpoUseKelly]
  );

  useEffect(() => {
    if (activeTab === 'cpo-dag' && !cpoAutoRanRef.current) {
      cpoAutoRanRef.current = true;
      runCpoBacktest('159915');
    }
  }, [activeTab, runCpoBacktest]);

  // Tab [01] ECharts 3-Line Equity + Underwater Drawdown
  useEffect(() => {
    if (activeTab !== 'cpo-dag' || !cpoChartRef.current || !cpoBtResult?.equityCurve?.length) return;
    const dom = cpoChartRef.current;
    const chart = echarts.init(dom);
    const curve = cpoBtResult.equityCurve;
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
        itemWidth: 14,
        itemHeight: 8,
        data: ['四重门控净值%', '单纯追涨基准%', '标的基准%', '门控回撤%'],
      },
      grid: [
        { left: 46, right: 16, top: 28, height: '55%' },
        { left: 46, right: 16, top: '73%', height: '18%' },
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
          name: '四重门控净值%',
          type: 'line',
          showSymbol: false,
          data: curve.map((c) => safeNum(c.gatedReturnPct)),
          lineStyle: { width: 2.0, color: '#ff8800' },
          itemStyle: { color: '#ff8800' },
        },
        {
          name: '单纯追涨基准%',
          type: 'line',
          showSymbol: false,
          data: curve.map((c) => safeNum(c.naiveReturnPct)),
          lineStyle: { width: 1.4, color: '#4da3ff', type: 'dashed' },
          itemStyle: { color: '#4da3ff' },
        },
        {
          name: '标的基准%',
          type: 'line',
          showSymbol: false,
          data: curve.map((c) => safeNum(c.benchmarkPct)),
          lineStyle: { width: 1.2, color: '#6d7787', type: 'dotted' },
          itemStyle: { color: '#6d7787' },
        },
        {
          name: '门控回撤%',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          data: curve.map((c) => -Math.abs(safeNum(c.gatedDrawdownPct))),
          lineStyle: { width: 1.0, color: '#00c853' },
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
  }, [activeTab, cpoBtResult]);

  // Tab [04] Term Structure Roll Yield & Z-Score Chart
  useEffect(() => {
    if (activeTab !== 'term-structure' || !tsChartRef.current || !altOverview?.termStructures?.length) return;
    const dom = tsChartRef.current;
    const chart = echarts.init(dom);
    const items = [...altOverview.termStructures].sort(
      (a, b) => safeNum(b.annualizedRollYieldPct) - safeNum(a.annualizedRollYieldPct)
    );
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
        data: ['年化展期收益率 Roll Yield%', '20日价差 Z-Score'],
      },
      grid: { left: 48, right: 44, top: 30, bottom: 28 },
      xAxis: {
        type: 'category',
        data: items.map((i) => `${i.variety} ${i.name}`),
        axisLine: { lineStyle: { color: '#222832' } },
        axisLabel: { color: '#8b95a5', fontSize: 10, interval: 0 },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Roll%',
          nameTextStyle: { color: '#7d8796', fontSize: 9 },
          splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
          axisLabel: { color: '#8b95a5', fontSize: 9, formatter: (v: number) => `${v}%` },
        },
        {
          type: 'value',
          name: 'Z',
          nameTextStyle: { color: '#f0b90b', fontSize: 9 },
          splitLine: { show: false },
          axisLabel: { color: '#f0b90b', fontSize: 9 },
        },
      ],
      series: [
        {
          name: '年化展期收益率 Roll Yield%',
          type: 'bar',
          barMaxWidth: 22,
          data: items.map((i) => ({
            value: safeNum(i.annualizedRollYieldPct),
            itemStyle: { color: safeNum(i.annualizedRollYieldPct) >= 0 ? '#ff3535' : '#00c853' },
          })),
        },
        {
          name: '20日价差 Z-Score',
          type: 'line',
          yAxisIndex: 1,
          symbolSize: 5,
          data: items.map((i) => safeNum(i.spreadZScore20d)),
          lineStyle: { width: 1.6, color: '#f0b90b' },
          itemStyle: { color: '#f0b90b' },
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, altOverview]);

  // Tab [05] Snapshot JSONL trend chart
  useEffect(() => {
    if (activeTab !== 'ingestion-ops' || !snapshotChartRef.current || !altOverview?.snapshots?.length) return;
    const dom = snapshotChartRef.current;
    const chart = echarts.init(dom);
    const list = [...altOverview.snapshots].slice(-40);
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
        data: ['BTC年化Funding%', '最强Back Roll%', '创业板159915 PCR'],
      },
      grid: { left: 42, right: 44, top: 28, bottom: 24 },
      xAxis: {
        type: 'category',
        data: list.map((s) => s.timestamp.slice(5, 16).replace('T', ' ')),
        axisLine: { lineStyle: { color: '#222832' } },
        axisLabel: { color: '#7d8796', fontSize: 9 },
      },
      yAxis: [
        {
          type: 'value',
          splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
          axisLabel: { color: '#8b95a5', fontSize: 9, formatter: (v: number) => `${v}%` },
        },
        {
          type: 'value',
          splitLine: { show: false },
          axisLabel: { color: '#f0b90b', fontSize: 9 },
        },
      ],
      series: [
        {
          name: 'BTC年化Funding%',
          type: 'line',
          showSymbol: false,
          data: list.map((s) => safeNum(s.btcFundingAnnualPct)),
          lineStyle: { width: 1.5, color: '#ff8800' },
        },
        {
          name: '最强Back Roll%',
          type: 'line',
          showSymbol: false,
          data: list.map((s) => safeNum(s.topBackRollYieldPct)),
          lineStyle: { width: 1.5, color: '#ff3535' },
        },
        {
          name: '创业板159915 PCR',
          type: 'line',
          yAxisIndex: 1,
          showSymbol: false,
          data: list.map((s) => safeNum(s.chinextPcr)),
          lineStyle: { width: 1.3, color: '#4da3ff' },
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [activeTab, altOverview]);

  const sortedSecondOrder = useMemo(() => {
    const list = [...(cpoOverview?.secondOrderTargets || [])];
    list.sort((a, b) =>
      secondOrderAsc ? safeNum(a.residualZScore) - safeNum(b.residualZScore) : safeNum(b.residualZScore) - safeNum(a.residualZScore)
    );
    return list;
  }, [cpoOverview, secondOrderAsc]);

  const filteredCrossVenue = useMemo(() => {
    const list = altOverview?.crossVenuePredictions || [];
    const q = cvSearch.trim().toLowerCase();
    return list
      .filter((item) => cvCategory === '全部' || item.category === cvCategory)
      .filter(
        (item) =>
          !q ||
          item.title.toLowerCase().includes(q) ||
          item.theme.toLowerCase().includes(q) ||
          item.mappedAssets.some((m) => m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      )
      .sort((a, b) => {
        if (cvSortBy === 'spread') return safeNum(b.maxVenueSpreadPp) - safeNum(a.maxVenueSpreadPp);
        if (cvSortBy === 'consensus') return safeNum(b.consensusProb) - safeNum(a.consensusProb);
        return Math.abs(safeNum(b.delta24hPp)) - Math.abs(safeNum(a.delta24hPp));
      });
  }, [altOverview, cvCategory, cvSearch, cvSortBy]);

  const cvCategories = useMemo(() => {
    const set = new Set<string>(['全部']);
    for (const item of altOverview?.crossVenuePredictions || []) {
      if (item.category) set.add(item.category);
    }
    return Array.from(set);
  }, [altOverview]);

  const sortedTermStructures = useMemo(() => {
    const list = [...(altOverview?.termStructures || [])].filter((item) => {
      if (tsFilter === 'back') return safeNum(item.annualizedRollYieldPct) > 0;
      if (tsFilter === 'contango') return safeNum(item.annualizedRollYieldPct) <= 0;
      return true;
    });
    list.sort((a: FuturesTermStructureItem, b: FuturesTermStructureItem) => {
      const av =
        tsSortCol === 'roll'
          ? safeNum(a.annualizedRollYieldPct)
          : tsSortCol === 'zscore'
          ? safeNum(a.spreadZScore20d)
          : safeNum(a.spread);
      const bv =
        tsSortCol === 'roll'
          ? safeNum(b.annualizedRollYieldPct)
          : tsSortCol === 'zscore'
          ? safeNum(b.spreadZScore20d)
          : safeNum(b.spread);
      return tsSortAsc ? av - bv : bv - av;
    });
    return list;
  }, [altOverview, tsFilter, tsSortCol, tsSortAsc]);

  const cpoTargetOptions = useMemo(() => {
    const presets = [
      { value: '159915', label: '159915 创业板ETF (T+1)' },
      { value: 'IC0', label: 'IC0 中证500期指 (T+0)' },
      { value: 'IM0', label: 'IM0 中证1000期指 (T+0)' },
      { value: 'PAIR_CPO_IM0', label: 'PAIR_CPO_IM0 多CPO空IM0对冲' },
      { value: '002837', label: '002837 英维克 (液冷二阶)' },
      { value: '002463', label: '002463 沪电股份 (AI PCB)' },
      { value: '688256', label: '688256 寒武纪 (国产ASIC)' },
      { value: '300308', label: '300308 中际旭创 (一阶锚)' },
    ];
    if (presets.some((p) => p.value === cpoTarget)) return presets;
    const matched = cpoOverview?.secondOrderTargets?.find((t) => t.code === cpoTarget);
    return [
      ...presets,
      { value: cpoTarget, label: `${cpoTarget} ${matched?.name || '二阶硬件'} (T+1)` },
    ];
  }, [cpoTarget, cpoOverview]);

  const handleCaptureSnapshot = async () => {
    setCapturing(true);
    setCaptureNotice(null);
    try {
      const res = await api.captureConsensusSnapshot();
      setCaptureNotice(
        `落库成功: ${res.record.timestamp} | Kalshi:${res.record.kalshiCount} Manifold:${res.record.manifoldCount} PM:${res.record.pmCount} | PAXG:$${fmtNum(
          res.record.paxgPrice,
          1
        )} | 最强Back:${res.record.topBackVariety}(${fmtPct(res.record.topBackRollYieldPct, 1)}) | 累计${res.totalSnapshots}条`
      );
      await loadAltOverview();
    } catch (e: unknown) {
      setCaptureNotice(`落库失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setCapturing(false);
    }
  };

  const handleSaveConfig = async () => {
    setSavingCfg(true);
    setCaptureNotice(null);
    try {
      const saved = await api.saveCollectorConfig({
        metaculusToken: cfgForm.metaculusToken?.trim() || undefined,
        githubToken: cfgForm.githubToken?.trim() || undefined,
        autoSnapshotMinutes: Number(cfgForm.autoSnapshotMinutes) || 15,
        egoCollectorEnabled: cfgForm.egoCollectorEnabled,
      });
      setCfgForm((prev) => ({
        ...prev,
        metaculusToken: '',
        githubToken: '',
        autoSnapshotMinutes: saved.autoSnapshotMinutes,
        egoCollectorEnabled: saved.egoCollectorEnabled,
        hasMetaculusToken: saved.hasMetaculusToken,
        hasGithubToken: saved.hasGithubToken,
      }));
      setCaptureNotice('采集器配置已保存至 data/collector_config.json');
      await loadAltOverview();
    } catch (e: unknown) {
      setCaptureNotice(`保存失败: ${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setSavingCfg(false);
    }
  };

  const handleCopy = (txt: string) => {
    navigator.clipboard?.writeText(txt).catch(() => {});
    setCopiedCmd(txt);
    setTimeout(() => setCopiedCmd(null), 1600);
  };

  const SUB_TABS: { id: SubTabId; label: string }[] = [
    { id: 'cpo-dag', label: '[01] CPO->科技->创业板->期指 五节点贝叶斯传导台' },
    { id: 'cross-venue', label: '[02] 跨平台预测市场三角共识 (Kalshi x PM x Manifold)' },
    { id: 'shadow-options', label: '[03] 24x7 影子暗盘·资金费率与期权偏度抢跑' },
    { id: 'term-structure', label: '[04] 28期货近远月期限结构 (Back/Contango) 产业认知' },
    { id: 'ingestion-ops', label: '[05] 零付费实时抓取引擎与本地时序库 (No-API/Ego守护)' },
  ];

  const ctx = cpoOverview?.marketContext;
  const anyTrapTriggered = (cpoOverview?.traps || []).some((t) => t.triggered);

  return (
    <div className="h-full flex flex-col bg-[#090c10] text-[#dfe6f0] overflow-hidden select-none">
      {/* Top 28px Wind Sub-Tab Ribbon */}
      <div className="h-[28px] bg-[#161b24] border-b border-[#222832] flex items-center justify-between shrink-0 overflow-x-auto">
        <div className="flex items-center h-full shrink-0">
          <div className="px-2.5 h-full flex items-center gap-1.5 border-r border-[#222832] bg-[#0e1117]">
            <span className="text-[10px] font-bold px-1 bg-[#ff8800] text-[#090c10]">F12</span>
            <span className="text-[11px] font-bold text-[#ff8800] whitespace-nowrap">超前认知定价 · CPO传导</span>
          </div>
          {SUB_TABS.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`h-full px-2.5 text-[11px] border-r border-[#222832] whitespace-nowrap transition-none ${
                  active
                    ? 'bg-[#0e1117] text-[#ff8800] border-t-2 border-t-[#ff8800] font-bold'
                    : 'text-[#8b95a5] hover:text-[#dfe6f0] hover:bg-[#1b2434]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 px-2 shrink-0 text-[11px]">
          {cpoOverview && (
            <div className="hidden 2xl:flex items-center gap-2 pr-2 border-r border-[#222832] tabular-nums">
              <span className="text-[#8b95a5]">后验置信:</span>
              <span className="text-[#ff8800] font-bold">{fmtNum(cpoOverview.bayesianPosteriorProb, 1)}%</span>
              <span className="text-[#8b95a5]">Kelly建议:</span>
              <span className="text-[#f0b90b] font-bold">{fmtNum(cpoOverview.kellyPositionPct, 1)}%</span>
            </div>
          )}
          {onNavigate && (
            <>
              <button
                type="button"
                onClick={() => onNavigate('panda-pm')}
                className="h-[20px] px-2 bg-[#0e1117] border border-[#2a3240] text-[#e5b567] hover:border-[#ff8800]"
              >
                F11 期货PM盘
              </button>
              <button
                type="button"
                onClick={() => onNavigate('backtest')}
                className="h-[20px] px-2 bg-[#0e1117] border border-[#2a3240] text-[#4da3ff] hover:border-[#ff8800]"
              >
                F9 策略回测
              </button>
              <button
                type="button"
                onClick={() => onNavigate('saas-desk')}
                className="h-[20px] px-2 bg-[#0e1117] border border-[#ff8800]/60 text-[#ff8800] hover:bg-[#ff8800] hover:text-[#090c10] font-bold"
              >
                OMS 实盘柜台
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              loadCpoOverview();
              loadAltOverview();
            }}
            disabled={cpoLoading || altLoading}
            className="h-[20px] px-2 bg-[#0e1117] border border-[#2a3240] text-[#dfe6f0] hover:border-[#ff8800] flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${cpoLoading || altLoading ? 'animate-spin text-[#ff8800]' : ''}`} />
            刷新全维截面
          </button>
        </div>
      </div>

      {/* V6 Paper Trading Handoff Toast Strip */}
      {paperToast && (
        <div
          className={`px-2.5 py-1 border-b text-[11px] flex items-center justify-between gap-2 shrink-0 ${
            paperToast.ok
              ? 'bg-[#111916] border-[#00c853]/50 text-[#00c853]'
              : 'bg-[#1e1215] border-[#ff3535]/50 text-[#ff3535]'
          }`}
        >
          <span className="truncate">{paperToast.text}</span>
          <div className="flex items-center gap-2 shrink-0">
            {onNavigate && paperToast.ok && (
              <button
                type="button"
                onClick={() => onNavigate('saas-desk')}
                className="px-2 h-[19px] bg-[#ff8800] text-[#090c10] font-bold text-[10px]"
              >
                立即前往 OMS 实盘柜台
              </button>
            )}
            <button
              type="button"
              onClick={() => setPaperToast(null)}
              className="text-[#8b95a5] hover:text-[#dfe6f0] text-[10px]"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* Global Error Strip if any */}
      {(cpoError || altError) && (
        <div className="px-2.5 py-1 bg-[#1e1215] border-b border-[#4d2025] text-[#ff3535] text-[11px] flex items-center justify-between shrink-0">
          <span>接口告警: {cpoError || altError}</span>
          <button
            type="button"
            onClick={() => {
              loadCpoOverview();
              loadAltOverview();
            }}
            className="underline text-[#e5b567]"
          >
            重试
          </button>
        </div>
      )}

      {/* ==================== TAB 01: CPO 5-NODE BAYESIAN DAG ==================== */}
      {activeTab === 'cpo-dag' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
          {/* Top 5-Node Causal DAG + 4-Gate + 3-Trap Banner */}
          <div className="bg-[#0e1117] shrink-0 flex flex-col gap-[1px]">
            {/* Market Context & Posterior Bar */}
            <div className="px-2.5 py-1.5 bg-[#11151d] border-b border-[#222832] flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-1.5 py-0.5 bg-[#161b24] border border-[#ff8800]/60 text-[#ff8800] font-bold">
                  当前状态: {cpoOverview?.regime || '加载中...'}
                </span>
                <span className="text-[#8b95a5] tabular-nums">
                  贝叶斯后验 P(扩散成功):{' '}
                  <strong className="text-[#ff8800] text-[13px]">
                    {fmtNum(cpoOverview?.bayesianPosteriorProb, 1)}%
                  </strong>
                </span>
                <span className="text-[#8b95a5] tabular-nums">
                  半Kelly权重 w_t:{' '}
                  <strong className="text-[#f0b90b] text-[13px]">
                    {fmtNum(cpoOverview?.kellyPositionPct, 1)}%
                  </strong>
                </span>
                {ctx && (
                  <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-[#9aa5b5] tabular-nums border-l border-[#222832] pl-2.5">
                    <span>
                      全A量比{' '}
                      <strong className={ctx.allAVolumeRatio >= 0.95 ? 'text-[#ff3535]' : 'text-[#00c853]'}>
                        {fmtNum(ctx.allAVolumeRatio, 2)}x
                      </strong>
                    </span>
                    <span>
                      TMT拥挤度{' '}
                      <strong
                        className={
                          ctx.tmtTurnoverSharePct > 38
                            ? 'text-[#ff3535]'
                            : ctx.tmtTurnoverSharePct >= 18
                            ? 'text-[#f0b90b]'
                            : 'text-[#4da3ff]'
                        }
                      >
                        {fmtNum(ctx.tmtTurnoverSharePct, 1)}%
                      </strong>
                    </span>
                    <span>
                      CPO三中军{' '}
                      <strong className={colorUpDown(ctx.cpoBasketChangePct)}>
                        {fmtPct(ctx.cpoBasketChangePct)}
                      </strong>{' '}
                      (VWAP {ctx.vwapConfirmCount}/3)
                    </span>
                    <span>
                      宁德300750{' '}
                      <strong className={colorUpDown(ctx.catlChangePct)}>{fmtPct(ctx.catlChangePct)}</strong>
                    </span>
                    <span>
                      创业板399006{' '}
                      <strong className={colorUpDown(ctx.chinextChangePct)}>{fmtPct(ctx.chinextChangePct)}</strong>
                    </span>
                    <span>
                      159915期权 PCR{' '}
                      <strong className="text-[#e5b567]">{fmtNum(ctx.chinextOptionPcr, 2)}</strong> / Skew{' '}
                      <strong className={colorUpDown(ctx.chinextOptionSkew)}>
                        {fmtSigned(ctx.chinextOptionSkew, 2)}
                      </strong>
                    </span>
                    <span>
                      IC0 <strong className={colorUpDown(ctx.ic0ChangePct)}>{fmtPct(ctx.ic0ChangePct)}</strong> · IM0{' '}
                      <strong className={colorUpDown(ctx.im0ChangePct)}>{fmtPct(ctx.im0ChangePct)}</strong>
                    </span>
                  </div>
                )}
              </div>
              <span className="text-[10px] text-[#6d7787] tabular-nums">
                {cpoOverview?.alignmentNote || '09:00 CST 美股先验截止 / 09:45 VWAP 承接确认'}
              </span>
            </div>

            {/* 5-Node Causal DAG Ribbon */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-[1px] bg-[#222832]">
              {(cpoOverview?.nodes || []).map((node, idx) => {
                const statusColor =
                  node.status === '强力传导'
                    ? 'text-[#ff3535] border-[#ff3535]/50 bg-[#241214]'
                    : node.status === '温和顺畅'
                    ? 'text-[#ff8800] border-[#ff8800]/50 bg-[#21180e]'
                    : node.status === '空头反噬' || node.status === '断链阻断'
                    ? 'text-[#00c853] border-[#00c853]/50 bg-[#0f2218]'
                    : 'text-[#8b95a5] border-[#2a3240] bg-[#161b24]';

                return (
                  <div key={node.nodeId} className="bg-[#0e1117] px-2.5 py-1.5 flex flex-col justify-between relative">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-bold text-[#dfe6f0] truncate">{node.title}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`px-1 text-[10px] border ${statusColor}`}>{node.status}</span>
                        {idx < 4 && <ArrowRight className="w-3 h-3 text-[#ff8800] hidden md:inline" />}
                      </div>
                    </div>
                    <div className="text-[10px] text-[#7d8796] truncate mt-0.5">{node.subtitle}</div>
                    <div className="flex items-baseline justify-between gap-1 mt-1 tabular-nums">
                      <span className={`text-[13px] font-bold ${colorUpDown(node.score)}`}>
                        Score {fmtSigned(node.score, 0)}
                      </span>
                      <span className="text-[10px] text-[#e5b567] truncate">{node.keyMetricText}</span>
                    </div>
                    <div className="text-[10px] text-[#6d7787] truncate mt-0.5">{node.leadLagText}</div>
                  </div>
                );
              })}
            </div>

            {/* 4-Gate Pass/Veto Strip + 3-Trap Alert Strip */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-[1px] bg-[#222832]">
              <div className="xl:col-span-7 grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-[#222832]">
                {(cpoOverview?.gates || []).map((gate) => (
                  <div
                    key={gate.id}
                    className={`px-2 py-1 flex flex-col justify-between ${
                      gate.passed ? 'bg-[#0e1117]' : 'bg-[#1a1114]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-semibold text-[#dfe6f0] truncate">{gate.name}</span>
                      <span
                        className={`px-1 text-[10px] font-bold flex items-center gap-0.5 shrink-0 ${
                          gate.passed
                            ? 'bg-[#0f2218] text-[#00c853] border border-[#00c853]/40'
                            : 'bg-[#2a1216] text-[#ff3535] border border-[#ff3535]/50'
                        }`}
                      >
                        {gate.passed ? <ShieldCheck className="w-2.5 h-2.5" /> : <ShieldAlert className="w-2.5 h-2.5" />}
                        {gate.passed ? 'PASS' : 'VETO'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] tabular-nums mt-0.5">
                      <span className="text-[#e5b567]">{gate.currentValueText}</span>
                      <span className="text-[#6d7787]">阈值 {gate.thresholdText}</span>
                    </div>
                    {!gate.passed && gate.vetoReason && (
                      <div className="text-[10px] text-[#ff3535] truncate mt-0.5" title={gate.vetoReason}>
                        否决: {gate.vetoReason}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div
                className={`xl:col-span-5 grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-[#222832] ${
                  anyTrapTriggered ? 'border-l-2 border-l-[#ff3535]' : ''
                }`}
              >
                {(cpoOverview?.traps || []).map((trap) => {
                  const bg =
                    trap.triggered && trap.severity === 'critical'
                      ? 'bg-[#241214]'
                      : trap.triggered
                      ? 'bg-[#21190e]'
                      : 'bg-[#0e1117]';
                  const tagCls = trap.triggered
                    ? trap.severity === 'critical'
                      ? 'text-[#ff3535] border-[#ff3535]/60'
                      : 'text-[#ff8800] border-[#ff8800]/60'
                    : 'text-[#6d7787] border-[#222832]';
                  return (
                    <div key={trap.id} className={`${bg} px-2 py-1 flex flex-col justify-between`}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-semibold text-[#dfe6f0] flex items-center gap-1 truncate">
                          <AlertTriangle
                            className={`w-3 h-3 shrink-0 ${
                              trap.triggered ? 'text-[#ff3535]' : 'text-[#6d7787]'
                            }`}
                          />
                          {trap.name}
                        </span>
                        <span className={`px-1 text-[10px] border shrink-0 ${tagCls}`}>
                          {trap.triggered ? '触发预警' : '安全'}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#9aa5b5] truncate mt-0.5" title={trap.detail}>
                        {trap.detail}
                      </div>
                      <div className="text-[10px] text-[#e5b567] truncate" title={trap.counterMeasure}>
                        应对: {trap.counterMeasure}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Main Left/Right Docked Split Panes */}
          <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-[1px] bg-[#222832] overflow-hidden">
            {/* LEFT SPLIT (6 cols): US vs A-Share Anchors + 2nd-Order Screener + 4 Playbook Cards */}
            <div className="xl:col-span-6 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-auto">
              {/* Pane 1: US Optical Anchors vs A-Share CPO Core 3 */}
              <div className="w-pane shrink-0">
                <PaneHeader
                  title="节点0 美股原厂先验锚 vs 节点1 A股CPO三中军 (含VWAP分时均价承接)"
                  badge="1:1 供应链映射"
                />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-[1px] bg-[#222832]">
                  <div className="bg-[#0e1117] overflow-x-auto">
                    <div className="px-2 py-1 text-[10px] font-bold text-[#8b95a5] bg-[#11151d] border-b border-[#222832]">
                      美股光模块/AI算力原厂锚 (09:00 CST 先验截止)
                    </div>
                    <table className="w-table">
                      <thead>
                        <tr>
                          <th className="text-left">代码</th>
                          <th className="text-left">名称/角色</th>
                          <th className="text-right">现价$</th>
                          <th className="text-right">涨跌%</th>
                          <th className="text-right">量比</th>
                          <th className="text-center">信号</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(cpoOverview?.usAnchors || []).map((u) => (
                          <tr key={u.symbol}>
                            <td className="text-[#e5b567] font-bold">{u.symbol}</td>
                            <td className="text-[#cfd8e3] max-w-[120px] truncate" title={`${u.name} · ${u.role}`}>
                              {u.name}
                            </td>
                            <td className="text-right text-[#cfd8e3]">{fmtNum(u.price, 2)}</td>
                            <td className={`text-right font-semibold ${colorUpDown(u.changePct)}`}>
                              {fmtPct(u.changePct)}
                            </td>
                            <td className="text-right text-[#f0b90b]">{fmtNum(u.volumeRatio, 2)}</td>
                            <td className="text-center">
                              <span
                                className={`px-1 text-[10px] border ${
                                  u.signal === '强共振利多'
                                    ? 'text-[#ff3535] border-[#ff3535]/50'
                                    : u.signal === '背离承压'
                                    ? 'text-[#00c853] border-[#00c853]/50'
                                    : 'text-[#8b95a5] border-[#2a3240]'
                                }`}
                              >
                                {u.signal}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-[#0e1117] overflow-x-auto">
                    <div className="px-2 py-1 text-[10px] font-bold text-[#8b95a5] bg-[#11151d] border-b border-[#222832]">
                      A股CPO三中军 (300308/300502/300394) VWAP真承接
                    </div>
                    <table className="w-table">
                      <thead>
                        <tr>
                          <th className="text-left">代码</th>
                          <th className="text-left">名称</th>
                          <th className="text-right">现价</th>
                          <th className="text-right">涨跌%</th>
                          <th className="text-right">VWAP偏离</th>
                          <th className="text-right">量比</th>
                          <th className="text-center">VWAP门</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(cpoOverview?.cpoAnchors || []).map((c) => (
                          <tr key={c.code}>
                            <td>
                              <button
                                type="button"
                                onClick={() => onSelectStock(c.code, c.name)}
                                className="text-[#e5b567] hover:text-[#ff8800] font-bold underline-offset-2 hover:underline"
                              >
                                {c.code}
                              </button>
                            </td>
                            <td className="text-[#dfe6f0]">{c.name}</td>
                            <td className="text-right text-[#cfd8e3]">{fmtNum(c.price, 2)}</td>
                            <td className={`text-right font-semibold ${colorUpDown(c.changePct)}`}>
                              {fmtPct(c.changePct)}
                            </td>
                            <td className={`text-right ${colorUpDown(c.vwapSpreadPct)}`}>
                              {fmtPct(c.vwapSpreadPct)}
                            </td>
                            <td className="text-right text-[#f0b90b]">{fmtNum(c.volumeRatio, 2)}</td>
                            <td className="text-center">
                              <span
                                className={`px-1 text-[10px] border ${
                                  c.vwapConfirmed
                                    ? 'text-[#ff3535] border-[#ff3535]/50 bg-[#241214]'
                                    : 'text-[#00c853] border-[#00c853]/50 bg-[#0f2218]'
                                }`}
                              >
                                {c.vwapConfirmed ? '站稳VWAP' : '跌破均价'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Pane 2: 2nd-Order Hardware Residual Lag Scanner */}
              <div className="w-pane flex-1 min-h-[210px] flex flex-col overflow-hidden">
                <PaneHeader
                  title="节点2 二阶算力硬件滞后补涨残差扫描 (液冷/AI PCB/国产ASIC/光芯片)"
                  badge={`${sortedSecondOrder.length} 只标的`}
                  right={
                    <button
                      type="button"
                      onClick={() => setSecondOrderAsc((p) => !p)}
                      className="px-1.5 h-[19px] bg-[#0e1117] border border-[#2a3240] text-[#cfd8e3] hover:border-[#ff8800]"
                    >
                      残差Z排序: {secondOrderAsc ? '低估优先(升序)' : '透支优先(降序)'}
                    </button>
                  }
                />
                <div className="flex-1 overflow-auto">
                  <table className="w-table">
                    <thead>
                      <tr>
                        <th className="text-left">代码</th>
                        <th className="text-left">名称</th>
                        <th className="text-left">细分方向</th>
                        <th className="text-right">现价</th>
                        <th className="text-right">涨跌%</th>
                        <th className="text-right">60d Beta</th>
                        <th className="text-right">隐含涨幅</th>
                        <th className="text-right">残差Z</th>
                        <th className="text-right">滞后D</th>
                        <th className="text-right">胜率%</th>
                        <th className="text-center">信号</th>
                        <th className="text-center">联动</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSecondOrder.map((t) => {
                        const sigCls =
                          t.catchupSignal === '强补涨滞后'
                            ? 'text-[#ff3535] border-[#ff3535]/50 bg-[#241214]'
                            : t.catchupSignal === '同步共振'
                            ? 'text-[#ff8800] border-[#ff8800]/50 bg-[#21180e]'
                            : t.catchupSignal === '门控拦截'
                            ? 'text-[#8b95a5] border-[#2a3240] bg-[#161b24]'
                            : 'text-[#00c853] border-[#00c853]/50 bg-[#0f2218]';
                        return (
                          <tr key={t.code}>
                            <td>
                              <button
                                type="button"
                                onClick={() => onSelectStock(t.code, t.name)}
                                className="text-[#e5b567] hover:text-[#ff8800] font-bold hover:underline"
                              >
                                {t.code}
                              </button>
                            </td>
                            <td className="text-[#dfe6f0]">{t.name}</td>
                            <td className="text-[#8b95a5]">{t.subSector}</td>
                            <td className="text-right text-[#cfd8e3]">{fmtNum(t.price, 2)}</td>
                            <td className={`text-right ${colorUpDown(t.changePct)}`}>{fmtPct(t.changePct)}</td>
                            <td className="text-right text-[#4da3ff]">{fmtNum(t.rollingBetaToCpo, 2)}</td>
                            <td className={`text-right ${colorUpDown(t.impliedChangePct)}`}>
                              {fmtPct(t.impliedChangePct)}
                            </td>
                            <td
                              className={`text-right font-bold ${
                                t.residualZScore < -1.25
                                  ? 'text-[#ff3535]'
                                  : t.residualZScore > 1.25
                                  ? 'text-[#00c853]'
                                  : 'text-[#f0b90b]'
                              }`}
                            >
                              {fmtSigned(t.residualZScore, 2)}
                            </td>
                            <td className="text-right text-[#cfd8e3]">{t.optimalLagDays}d</td>
                            <td className="text-right text-[#f0b90b]">{fmtNum(t.hitRatePct, 0)}%</td>
                            <td className="text-center">
                              <span className={`px-1 text-[10px] border ${sigCls}`}>{t.catchupSignal}</span>
                            </td>
                            <td className="text-center">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCpoTarget(t.code);
                                    runCpoBacktest(t.code);
                                  }}
                                  className="px-1.5 h-[18px] bg-[#161b24] border border-[#2a3240] text-[#ff8800] hover:border-[#ff8800] text-[10px]"
                                >
                                  [测算]
                                </button>
                                <button
                                  type="button"
                                  disabled={paperOrderKey === `2nd-${t.code}`}
                                  onClick={() =>
                                    handleSendToPaperDesk({
                                      key: `2nd-${t.code}`,
                                      rawSymbol: t.code,
                                      name: t.name,
                                      action: 'buy_long',
                                      capitalAllocationPct: Math.max(
                                        8,
                                        Math.min(20, Math.round(cpoOverview?.kellyPositionPct || 10))
                                      ),
                                      price: t.price,
                                      strategyTag: 'CPO五节点二阶补涨',
                                      note: `残差Z=${fmtSigned(t.residualZScore, 2)} ${t.subSector} ${t.catchupSignal}`,
                                    })
                                  }
                                  className="px-1.5 h-[18px] bg-[#161b24] border border-[#e5b567]/50 text-[#e5b567] hover:bg-[#ff8800] hover:text-[#090c10] hover:border-[#ff8800] text-[10px] disabled:opacity-50"
                                >
                                  {paperOrderKey === `2nd-${t.code}` ? '下单...' : '[一键直通实盘柜台]'}
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

              {/* Pane 3: 4-Quadrant Tactical Execution Playbook Cards */}
              <div className="w-pane shrink-0">
                <PaneHeader title="节点3-4 四象限战术执行剧本卡 (一阶锚 / 二阶补涨 / 159915 / 期指IC0·IM0)" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-[#222832]">
                  {(cpoOverview?.playbooks || []).map((pb) => {
                    const actCls =
                      pb.action === '做多出击'
                        ? 'text-[#ff3535] border-[#ff3535]/60 bg-[#241214]'
                        : pb.action === '配对多空对冲'
                        ? 'text-[#ff8800] border-[#ff8800]/60 bg-[#21180e]'
                        : pb.action === '减仓/空单保护'
                        ? 'text-[#00c853] border-[#00c853]/60 bg-[#0f2218]'
                        : 'text-[#8b95a5] border-[#2a3240] bg-[#161b24]';
                    return (
                      <div key={pb.legType} className="bg-[#0e1117] p-2 flex flex-col gap-1 text-[11px]">
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[#8b95a5] text-[10px] shrink-0">{pb.legType}</span>
                            <button
                              type="button"
                              onClick={() => isAShareCode(pb.symbol) && onSelectStock(pb.symbol, pb.name)}
                              className="text-[#e5b567] font-bold truncate hover:text-[#ff8800]"
                            >
                              {pb.symbol} {pb.name}
                            </button>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[#f0b90b] font-bold tabular-nums">
                              仓位 {fmtNum(pb.suggestedWeightPct, 0)}%
                            </span>
                            <span className={`px-1 text-[10px] border ${actCls}`}>{pb.action}</span>
                          </div>
                        </div>
                        <div className="text-[10px] text-[#cfd8e3] leading-snug">
                          <span className="text-[#7d8796]">入场规则: </span>
                          {pb.entryRule}
                        </div>
                        <div className="text-[10px] text-[#00c853] leading-snug">
                          <span className="text-[#7d8796]">证伪止损: </span>
                          {pb.falsificationStop}
                        </div>
                        <div className="text-[10px] text-[#9aa5b5] leading-snug">{pb.rationale}</div>
                        <div className="pt-1 mt-auto border-t border-[#1b212c] flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={paperOrderKey === `pb-${pb.legType}`}
                            onClick={() => {
                              const primarySym = pb.symbol.split(/[\/,\s]+/)[0].trim();
                              const isFutures = /^(IC|IM|IF|IH|AU|AG|SC|EC|LC|CU|RB|I|MA|TA|SI|M)\d*$/i.test(
                                primarySym
                              );
                              const action =
                                pb.action === '减仓/空单保护'
                                  ? isFutures
                                    ? 'open_short'
                                    : 'sell_long'
                                  : 'buy_long';
                              handleSendToPaperDesk({
                                key: `pb-${pb.legType}`,
                                rawSymbol: pb.symbol,
                                name: pb.name,
                                action,
                                capitalAllocationPct: Math.max(8, Math.min(35, Math.round(pb.suggestedWeightPct || 12))),
                                strategyTag: `CPO五节点·${pb.legType}`,
                                note: `${pb.action} | ${pb.entryRule}`,
                              });
                            }}
                            className="px-2 h-[20px] bg-[#161b24] border border-[#ff8800]/60 text-[#ff8800] hover:bg-[#ff8800] hover:text-[#090c10] text-[10px] font-bold disabled:opacity-50"
                          >
                            {paperOrderKey === `pb-${pb.legType}` ? '下单中...' : '[一键直通实盘柜台]'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* RIGHT SPLIT (6 cols): 4-Gate Bayesian vs Naive CPO Comparison Backtester */}
            <div className="xl:col-span-6 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
              <div className="w-pane shrink-0">
                <PaneHeader
                  title="四重门控贝叶斯传导 vs 单纯线性追涨 对比回测终端"
                  badge={cpoBtResult ? `${cpoBtResult.targetSymbol} · ${cpoBtResult.executionRule}` : 'A股T+1 / 期指T+0'}
                  right={
                    <button
                      type="button"
                      onClick={() => runCpoBacktest()}
                      disabled={cpoBtLoading}
                      className="h-[20px] px-2 bg-[#ff8800] text-[#090c10] font-bold text-[11px] flex items-center gap-1 hover:bg-[#ff9c2a] disabled:opacity-60"
                    >
                      <Play className="w-3 h-3" />
                      {cpoBtLoading ? '回测中...' : '执行对比回测'}
                    </button>
                  }
                />

                {/* Controls Bar */}
                <div className="p-2 bg-[#0e1117] border-b border-[#222832] flex flex-wrap items-center gap-2 text-[11px]">
                  <label className="flex items-center gap-1 text-[#8b95a5]">
                    <span>传导标的</span>
                    <select
                      value={cpoTarget}
                      onChange={(e) => {
                        setCpoTarget(e.target.value);
                        runCpoBacktest(e.target.value);
                      }}
                      className="h-[24px] bg-[#161b24] border border-[#2a3240] text-[#e5b567] px-1.5 outline-none"
                    >
                      {cpoTargetOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex items-center gap-1 text-[#8b95a5]">
                    <span>窗口</span>
                    <select
                      value={cpoDays}
                      onChange={(e) => setCpoDays(Number(e.target.value))}
                      className="h-[24px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] px-1.5 outline-none tabular-nums"
                    >
                      <option value={60}>60D</option>
                      <option value={120}>120D</option>
                      <option value={180}>180D</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-1 text-[#8b95a5]">
                    <span>拥挤上限%</span>
                    <input
                      type="number"
                      min={20}
                      max={60}
                      value={cpoCrowdingCap}
                      onChange={(e) => setCpoCrowdingCap(Number(e.target.value) || 38)}
                      className="w-[54px] h-[24px] bg-[#161b24] border border-[#2a3240] text-[#f0b90b] px-1.5 outline-none tabular-nums"
                    />
                  </label>

                  <label className="flex items-center gap-1 text-[#cfd8e3] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cpoReqUsPrior}
                      onChange={(e) => setCpoReqUsPrior(e.target.checked)}
                      className="accent-[#ff8800]"
                    />
                    <span>美股先验锚</span>
                  </label>
                  <label className="flex items-center gap-1 text-[#cfd8e3] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cpoReqVwap}
                      onChange={(e) => setCpoReqVwap(e.target.checked)}
                      className="accent-[#ff8800]"
                    />
                    <span>VWAP承接门</span>
                  </label>
                  <label className="flex items-center gap-1 text-[#cfd8e3] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cpoReqDualCore}
                      onChange={(e) => setCpoReqDualCore(e.target.checked)}
                      className="accent-[#ff8800]"
                    />
                    <span>宁德双核门</span>
                  </label>
                  <label className="flex items-center gap-1 text-[#cfd8e3] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cpoUseKelly}
                      onChange={(e) => setCpoUseKelly(e.target.checked)}
                      className="accent-[#ff8800]"
                    />
                    <span>Kelly仓位</span>
                  </label>
                </div>

                {cpoBtError && (
                  <div className="px-2.5 py-1 bg-[#1e1215] border-b border-[#4d2025] text-[#ff3535] text-[11px]">
                    {cpoBtError}
                  </div>
                )}

                {/* Side-by-Side KPI Comparison: 4-Gate Bayesian vs Naive Linear Chasing vs Buy & Hold */}
                {cpoBtResult && (
                  <div className="grid grid-cols-3 gap-[1px] bg-[#222832]">
                    <div className="bg-[#0e1117] px-2.5 py-1.5 border-t-2 border-t-[#ff8800]">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[#ff8800] font-bold">四重门控贝叶斯策略</span>
                        <span className="text-[#f0b90b] tabular-nums">
                          Kelly {fmtNum(cpoBtResult.gatedMetrics.kellySuggestedPct, 1)}%
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between mt-0.5 tabular-nums">
                        <span className={`text-[15px] font-bold ${colorUpDown(cpoBtResult.gatedMetrics.totalReturnPct)}`}>
                          {fmtPct(cpoBtResult.gatedMetrics.totalReturnPct)}
                        </span>
                        <span className="text-[11px] text-[#cfd8e3]">
                          Sharpe {fmtNum(cpoBtResult.gatedMetrics.sharpe, 2)}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#8b95a5] tabular-nums mt-0.5">
                        回撤 -{Math.abs(safeNum(cpoBtResult.gatedMetrics.maxDrawdownPct)).toFixed(2)}% · 胜率{' '}
                        {fmtNum(cpoBtResult.gatedMetrics.winRatePct, 1)}% ({cpoBtResult.gatedMetrics.tradeCount}笔)
                      </div>
                    </div>

                    <div className="bg-[#0e1117] px-2.5 py-1.5 border-t-2 border-t-[#4da3ff]">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[#4da3ff] font-bold">无门控单纯追CPO基准</span>
                        <span className="text-[#7d8796]">线性直连</span>
                      </div>
                      <div className="flex items-baseline justify-between mt-0.5 tabular-nums">
                        <span className={`text-[15px] font-bold ${colorUpDown(cpoBtResult.naiveMetrics.totalReturnPct)}`}>
                          {fmtPct(cpoBtResult.naiveMetrics.totalReturnPct)}
                        </span>
                        <span className="text-[11px] text-[#cfd8e3]">
                          Sharpe {fmtNum(cpoBtResult.naiveMetrics.sharpe, 2)}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#8b95a5] tabular-nums mt-0.5">
                        回撤 -{Math.abs(safeNum(cpoBtResult.naiveMetrics.maxDrawdownPct)).toFixed(2)}% · 胜率{' '}
                        {fmtNum(cpoBtResult.naiveMetrics.winRatePct, 1)}% ({cpoBtResult.naiveMetrics.tradeCount}笔)
                      </div>
                    </div>

                    <div className="bg-[#0e1117] px-2.5 py-1.5 border-t-2 border-t-[#6d7787]">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[#9aa5b5] font-bold">标的买入持有基准</span>
                        <span className="text-[#e5b567]">{cpoBtResult.targetSymbol}</span>
                      </div>
                      <div className="flex items-baseline justify-between mt-0.5 tabular-nums">
                        <span className={`text-[15px] font-bold ${colorUpDown(cpoBtResult.benchmarkReturnPct)}`}>
                          {fmtPct(cpoBtResult.benchmarkReturnPct)}
                        </span>
                        <span className="text-[11px] text-[#ff8800]">
                          超额 {fmtPct(cpoBtResult.gatedMetrics.totalReturnPct - cpoBtResult.benchmarkReturnPct)}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#8b95a5] tabular-nums mt-0.5">
                        {cpoBtResult.startDate} ~ {cpoBtResult.endDate}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 3-Line Equity Curve + Drawdown */}
              <div className="bg-[#0d1015] h-[230px] shrink-0" ref={cpoChartRef} />

              {/* 4-Gate Trap Filter Attribution Bar */}
              {cpoBtResult?.gateAttribution?.length ? (
                <div className="bg-[#0e1117] px-2.5 py-1.5 border-y border-[#222832] shrink-0">
                  <div className="text-[10px] text-[#8b95a5] font-bold mb-1">
                    四重门控陷阱拦截归因 (各门控过滤亏损陷阱次数与规避回撤)
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
                    {cpoBtResult.gateAttribution.map((g) => (
                      <div key={g.gateName} className="bg-[#11151d] border border-[#222832] px-2 py-1 text-[10px]">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[#cfd8e3] truncate">{g.gateName}</span>
                          <span className="text-[#ff8800] font-bold tabular-nums shrink-0">
                            拦截 {g.blockedTrades} 笔
                          </span>
                        </div>
                        <div className="w-full h-[4px] bg-[#1a202b] mt-1">
                          <div
                            className="h-full bg-[#ff8800]"
                            style={{ width: `${Math.min(100, Math.max(8, g.blockedTrades * 14))}%` }}
                          />
                        </div>
                        <div className="text-[#00c853] tabular-nums mt-0.5">
                          规避潜在亏损 {fmtPct(Math.abs(safeNum(g.avoidedLossPct)), 2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* 26px Trade Blotter */}
              <div className="w-pane flex-1 min-h-[150px] flex flex-col overflow-hidden">
                <PaneHeader
                  title="门控传导策略成交明细 Blotter"
                  badge={`${cpoBtResult?.trades?.length ?? 0} 笔`}
                  right={cpoBtResult?.targetName}
                />
                <div className="flex-1 overflow-auto">
                  <table className="w-table">
                    <thead>
                      <tr>
                        <th className="text-left">#</th>
                        <th className="text-left">入场</th>
                        <th className="text-left">出场</th>
                        <th className="text-center">方向</th>
                        <th className="text-right">入场价</th>
                        <th className="text-right">出场价</th>
                        <th className="text-right">后验P%</th>
                        <th className="text-right">CPO锚%</th>
                        <th className="text-right">美光%</th>
                        <th className="text-right">拥挤%</th>
                        <th className="text-right">仓位%</th>
                        <th className="text-right">收益%</th>
                        <th className="text-left">门控归因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(cpoBtResult?.trades || []).map((t) => (
                        <tr key={t.id}>
                          <td className="text-[#7d8796]">{t.id}</td>
                          <td className="text-[#cfd8e3]">{t.entryDate}</td>
                          <td className="text-[#cfd8e3]">{t.exitDate}</td>
                          <td className="text-center">
                            <span
                              className={`px-1 text-[10px] border ${
                                t.side === '做多'
                                  ? 'border-[#ff3535]/50 text-[#ff3535] bg-[#241214]'
                                  : t.side === '多CPO/空IM0'
                                  ? 'border-[#ff8800]/50 text-[#ff8800] bg-[#21180e]'
                                  : 'border-[#00c853]/50 text-[#00c853] bg-[#0f2218]'
                              }`}
                            >
                              {t.side}
                            </span>
                          </td>
                          <td className="text-right text-[#cfd8e3]">{fmtNum(t.entryPrice, 2)}</td>
                          <td className="text-right text-[#cfd8e3]">{fmtNum(t.exitPrice, 2)}</td>
                          <td className="text-right text-[#ff8800]">{fmtNum(t.posteriorProb, 1)}%</td>
                          <td className={`text-right ${colorUpDown(t.cpoAnchorPct)}`}>{fmtPct(t.cpoAnchorPct, 1)}</td>
                          <td className={`text-right ${colorUpDown(t.usOpticsPct)}`}>{fmtPct(t.usOpticsPct, 1)}</td>
                          <td className="text-right text-[#f0b90b]">{fmtNum(t.tmtCrowdingPct, 1)}%</td>
                          <td className="text-right text-[#e5b567]">{fmtNum(t.positionPct, 1)}%</td>
                          <td className={`text-right font-semibold ${colorUpDown(t.returnPct)}`}>
                            {fmtPct(t.returnPct, 2)}
                          </td>
                          <td className="text-[#9aa5b5] max-w-[220px] truncate" title={t.reason}>
                            {t.reason}
                          </td>
                        </tr>
                      ))}
                      {(!cpoBtResult || cpoBtResult.trades.length === 0) && (
                        <tr>
                          <td colSpan={13} className="text-center text-[#6d7787] py-4">
                            {cpoBtLoading ? '正在计算五节点贝叶斯门控传导路径...' : '暂无成交记录'}
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
      )}

      {/* ==================== TAB 02: CROSS-VENUE PREDICTION CONSENSUS ==================== */}
      {activeTab === 'cross-venue' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-[1px] bg-[#222832] overflow-hidden">
          <div className="xl:col-span-6 w-pane min-h-0 flex flex-col overflow-hidden">
            <PaneHeader
              title="跨平台预测市场三角共识矩阵 (Kalshi合规机构盘 x Polymarket加密真金盘 x Manifold极客盘)"
              badge={`${filteredCrossVenue.length} 个事件`}
            />

            <div className="p-2 bg-[#11151d] border-b border-[#222832] flex flex-wrap items-center gap-1.5 text-[11px] shrink-0">
              {cvCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCvCategory(cat)}
                  className={`h-[22px] px-2 border ${
                    cvCategory === cat
                      ? 'bg-[#0e1117] border-[#ff8800] text-[#ff8800] font-bold'
                      : 'bg-[#161b24] border-[#2a3240] text-[#8b95a5] hover:text-[#dfe6f0]'
                  }`}
                >
                  {cat}
                </button>
              ))}
              <input
                type="text"
                value={cvSearch}
                onChange={(e) => setCvSearch(e.target.value)}
                placeholder="筛选事件/代码..."
                className="h-[22px] px-2 bg-[#0e1117] border border-[#2a3240] text-[#dfe6f0] outline-none w-[140px] ml-auto"
              />
              <select
                value={cvSortBy}
                onChange={(e) => setCvSortBy(e.target.value as 'spread' | 'consensus' | 'delta')}
                className="h-[22px] bg-[#161b24] border border-[#2a3240] text-[#cfd8e3] px-1.5 outline-none"
              >
                <option value="spread">按跨平台分歧差降序</option>
                <option value="consensus">按加权共识概率降序</option>
                <option value="delta">按24h异动幅度降序</option>
              </select>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-table">
                <thead>
                  <tr>
                    <th className="text-left">分类</th>
                    <th className="text-left">跨平台共识事件</th>
                    <th className="text-right">Kalshi%</th>
                    <th className="text-right">PM%</th>
                    <th className="text-right">Manifold%</th>
                    <th className="text-right">加权共识</th>
                    <th className="text-right">24hΔ</th>
                    <th className="text-right">分歧差pp</th>
                    <th className="text-left">领先平台</th>
                    <th className="text-left">研判信号</th>
                    <th className="text-left">映射交易标的</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCrossVenue.map((item) => {
                    const selected = item.id === cvSignalId;
                    return (
                      <tr
                        key={item.id}
                        onClick={() => {
                          setCvSignalId(item.id);
                          if (item.mappedAssets?.[0]?.symbol) {
                            setCvAssetSymbol(item.mappedAssets[0].symbol);
                          }
                        }}
                        className={`cursor-pointer ${selected ? 'bg-[#1b2434] outline outline-1 outline-[#ff8800]' : ''}`}
                      >
                        <td className="text-[#8b95a5]">{item.category}</td>
                        <td className="text-[#dfe6f0] max-w-[210px] truncate" title={`${item.theme} · ${item.title}`}>
                          {item.title}
                        </td>
                        <td className="text-right text-[#4da3ff]">
                          {item.kalshiProb !== null ? `${fmtNum(item.kalshiProb, 1)}%` : '--'}
                        </td>
                        <td className="text-right text-[#ff8800]">
                          {item.pmProb !== null ? `${fmtNum(item.pmProb, 1)}%` : '--'}
                        </td>
                        <td className="text-right text-[#f0b90b]">
                          {item.manifoldProb !== null ? `${fmtNum(item.manifoldProb, 1)}%` : '--'}
                        </td>
                        <td className="text-right font-bold text-[#dfe6f0]">{fmtNum(item.consensusProb, 1)}%</td>
                        <td className={`text-right ${colorUpDown(item.delta24hPp)}`}>
                          {fmtSigned(item.delta24hPp, 1)}
                        </td>
                        <td
                          className={`text-right font-bold ${
                            item.maxVenueSpreadPp >= 8 ? 'text-[#ff3535]' : 'text-[#e5b567]'
                          }`}
                        >
                          {fmtNum(item.maxVenueSpreadPp, 1)}
                        </td>
                        <td className="text-[#cfd8e3]">{item.leadVenue}</td>
                        <td>
                          <span
                            className={`px-1 text-[10px] border ${
                              item.divergenceSignal === '机构盘抢跑看多'
                                ? 'text-[#ff3535] border-[#ff3535]/50'
                                : item.divergenceSignal === '极客盘超前异动'
                                ? 'text-[#ff8800] border-[#ff8800]/50'
                                : 'text-[#4da3ff] border-[#4da3ff]/50'
                            }`}
                          >
                            {item.divergenceSignal}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            {(item.mappedAssets || []).slice(0, 2).map((ma) => (
                              <button
                                key={ma.symbol}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCvSignalId(item.id);
                                  setCvAssetSymbol(ma.symbol);
                                  if (isAShareCode(ma.symbol)) {
                                    onSelectStock(ma.symbol, ma.name);
                                  }
                                }}
                                className={`px-1 text-[10px] border ${
                                  ma.direction === '做多'
                                    ? 'border-[#ff3535]/40 text-[#e5b567] hover:border-[#ff8800]'
                                    : 'border-[#00c853]/40 text-[#00c853] hover:border-[#ff8800]'
                                }`}
                                title={`${ma.name} (${ma.direction})`}
                              >
                                {ma.symbol}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="xl:col-span-6 min-h-0 overflow-hidden">
            <AltBacktestTerminal
              title="跨平台认知分歧 Lead-Lag (-5..+5d) 与联合回测"
              sourceOptions={[
                { value: 'kalshi_pm_spread', label: 'Kalshi x PM 跨平台分歧收敛 (kalshi_pm_spread)' },
                { value: 'manifold_tech_velocity', label: 'Manifold 硅谷AI极客流速脉冲 (manifold_tech_velocity)' },
              ]}
              sourceType={cvSourceType}
              onChangeSourceType={setCvSourceType}
              signalOptions={(altOverview?.crossVenuePredictions || []).map((c) => ({
                value: c.id,
                label: `[${c.category}] ${c.title.slice(0, 26)}`,
              }))}
              signalId={cvSignalId}
              onChangeSignalId={setCvSignalId}
              assetOptions={[
                { value: 'AU0', label: 'AU0 沪金主力 (T+0)' },
                { value: 'SC0', label: 'SC0 原油主力 (T+0)' },
                { value: 'EC0', label: 'EC0 欧线集运 (T+0)' },
                { value: 'LC0', label: 'LC0 碳酸锂 (T+0)' },
                { value: 'IC0', label: 'IC0 中证500期指 (T+0)' },
                { value: '159915', label: '159915 创业板ETF (T+1)' },
                { value: '300308', label: '300308 中际旭创 (T+1)' },
                { value: '601899', label: '601899 紫金矿业 (T+1)' },
                { value: '601919', label: '601919 中远海控 (T+1)' },
                { value: '300750', label: '300750 宁德时代 (T+1)' },
              ]}
              assetSymbol={cvAssetSymbol}
              onChangeAssetSymbol={setCvAssetSymbol}
              onSelectStock={onSelectStock}
              autoRunKey={`cv-${cvSourceType}-${cvSignalId}-${cvAssetSymbol}`}
            />
          </div>
        </div>
      )}

      {/* ==================== TAB 03: 24x7 SHADOW PERPS & OPTIONS SKEW ==================== */}
      {activeTab === 'shadow-options' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-[1px] bg-[#222832] overflow-hidden">
          <div className="xl:col-span-6 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-auto">
            {/* Hyperliquid 24x7 Shadow Perps */}
            <div className="w-pane shrink-0">
              <PaneHeader
                title="Hyperliquid 24x7 盘前/周末影子资产与永续资金费率挤仓监控"
                badge="15:00 -> 09:00 CST 隔夜休市窗口"
              />
              <div className="overflow-x-auto">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-left">影子资产</th>
                      <th className="text-left">映射国内标的</th>
                      <th className="text-right">标记价$</th>
                      <th className="text-right">24h涨跌%</th>
                      <th className="text-right">隔夜跳空差%</th>
                      <th className="text-right">年化Funding%</th>
                      <th className="text-right">挤仓Z</th>
                      <th className="text-right">OI($)</th>
                      <th className="text-left">状态信号</th>
                      <th className="text-center">回测</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(altOverview?.shadowPerps || []).map((sp) => (
                      <tr key={sp.coin}>
                        <td className="text-[#e5b567] font-bold">
                          {sp.coin} <span className="text-[#7d8796] font-normal text-[10px]">{sp.label}</span>
                        </td>
                        <td className="text-[#cfd8e3]">{sp.mappedCnAsset}</td>
                        <td className="text-right text-[#dfe6f0]">{fmtNum(sp.markPrice, sp.markPrice > 100 ? 1 : 3)}</td>
                        <td className={`text-right ${colorUpDown(sp.change24hPct)}`}>{fmtPct(sp.change24hPct)}</td>
                        <td className={`text-right font-bold ${colorUpDown(sp.overnightShadowGapPct)}`}>
                          {fmtPct(sp.overnightShadowGapPct)}
                        </td>
                        <td className={`text-right ${colorUpDown(sp.annualizedFundingPct)}`}>
                          {fmtPct(sp.annualizedFundingPct, 1)}
                        </td>
                        <td className="text-right text-[#f0b90b]">{fmtSigned(sp.fundingZScore, 2)}</td>
                        <td className="text-right text-[#8b95a5]">{formatAmount(sp.openInterestUsd)}</td>
                        <td>
                          <span
                            className={`px-1 text-[10px] border ${
                              sp.regimeSignal === '周末/隔夜抢跑利多'
                                ? 'text-[#ff3535] border-[#ff3535]/50'
                                : sp.regimeSignal === '空头挤仓预警'
                                ? 'text-[#ff8800] border-[#ff8800]/50'
                                : sp.regimeSignal === '多头拥挤过热'
                                ? 'text-[#00c853] border-[#00c853]/50'
                                : 'text-[#8b95a5] border-[#2a3240]'
                            }`}
                          >
                            {sp.regimeSignal}
                          </span>
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => {
                              setSoSourceType('hyperliquid_shadow_gap');
                              setSoSignalId(sp.coin);
                              setSoAssetSymbol(sp.coin === 'PAXG' ? 'AU0' : sp.coin === 'BTC' ? '601899' : '159915');
                            }}
                            className="px-1.5 h-[18px] bg-[#161b24] border border-[#2a3240] text-[#ff8800] hover:border-[#ff8800] text-[10px]"
                          >
                            [测算]
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Global & Domestic Options IV Skew & PCR Matrix */}
            <div className="w-pane flex-1 min-h-[220px] flex flex-col overflow-hidden">
              <PaneHeader
                title="全球 & 国内ETF期权隐波偏度矩阵 (Deribit DVOL/25D Skew · 159915/510300/510050 · USD/CNH)"
                badge="聪明钱尾部定价"
              />
              <div className="flex-1 overflow-auto">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-left">代码</th>
                      <th className="text-left">合约名称</th>
                      <th className="text-right">标的现价</th>
                      <th className="text-right">标的涨跌%</th>
                      <th className="text-right">ATM IV%</th>
                      <th className="text-right">25D Skew</th>
                      <th className="text-right">成交PCR</th>
                      <th className="text-left">聪明钱信号</th>
                      <th className="text-left">领先映射</th>
                      <th className="text-center">回测</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(altOverview?.optionSkews || []).map((op) => (
                      <tr key={op.symbol}>
                        <td>
                          <button
                            type="button"
                            onClick={() => isAShareCode(op.underlyingCode) && onSelectStock(op.underlyingCode, op.name)}
                            className="text-[#e5b567] font-bold hover:text-[#ff8800]"
                          >
                            {op.symbol}
                          </button>
                        </td>
                        <td className="text-[#dfe6f0]">{op.name}</td>
                        <td className="text-right text-[#cfd8e3]">{fmtNum(op.underlyingPrice, 3)}</td>
                        <td className={`text-right ${colorUpDown(op.underlyingChangePct)}`}>
                          {fmtPct(op.underlyingChangePct)}
                        </td>
                        <td className="text-right text-[#f0b90b]">{fmtNum(op.atmIvPct, 1)}%</td>
                        <td className={`text-right font-bold ${colorUpDown(op.ivSkew25d)}`}>
                          {fmtSigned(op.ivSkew25d, 2)}
                        </td>
                        <td className="text-right text-[#4da3ff]">{fmtNum(op.pcrVolume, 2)}</td>
                        <td>
                          <span
                            className={`px-1 text-[10px] border ${
                              op.smartMoneySignal === '机构抢购虚值看涨'
                                ? 'text-[#ff3535] border-[#ff3535]/50'
                                : op.smartMoneySignal === '尾部认沽保护升温'
                                ? 'text-[#00c853] border-[#00c853]/50'
                                : op.smartMoneySignal === '期权正股背离预警'
                                ? 'text-[#ff8800] border-[#ff8800]/50'
                                : 'text-[#8b95a5] border-[#2a3240]'
                            }`}
                          >
                            {op.smartMoneySignal}
                          </span>
                        </td>
                        <td className="text-[#9aa5b5]">{op.leadTarget}</td>
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => {
                              setSoSourceType('option_skew_pcr');
                              setSoSignalId(op.symbol);
                              setSoAssetSymbol(
                                isAShareCode(op.underlyingCode) ? op.underlyingCode : 'IC0'
                              );
                            }}
                            className="px-1.5 h-[18px] bg-[#161b24] border border-[#2a3240] text-[#ff8800] hover:border-[#ff8800] text-[10px]"
                          >
                            [测算]
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="xl:col-span-6 min-h-0 overflow-hidden">
            <AltBacktestTerminal
              title="24x7 影子暗盘 · 资金费率 · 期权偏度抢跑回测终端"
              sourceOptions={[
                { value: 'hyperliquid_shadow_gap', label: 'Hyperliquid 隔夜休市跳空差 (hyperliquid_shadow_gap)' },
                { value: 'funding_rate_squeeze', label: '永续资金费率挤仓脉冲 (funding_rate_squeeze)' },
                { value: 'option_skew_pcr', label: '期权25D Skew & PCR聪明钱 (option_skew_pcr)' },
              ]}
              sourceType={soSourceType}
              onChangeSourceType={setSoSourceType}
              signalOptions={[
                ...(altOverview?.shadowPerps || []).map((s) => ({
                  value: s.coin,
                  label: `[暗盘] ${s.coin} (${s.mappedCnAsset})`,
                })),
                ...(altOverview?.optionSkews || []).map((o) => ({
                  value: o.symbol,
                  label: `[期权] ${o.symbol} ${o.name}`,
                })),
              ]}
              signalId={soSignalId}
              onChangeSignalId={setSoSignalId}
              assetOptions={[
                { value: 'AU0', label: 'AU0 沪金主力 (T+0)' },
                { value: 'SC0', label: 'SC0 原油主力 (T+0)' },
                { value: '159915', label: '159915 创业板ETF (T+1)' },
                { value: 'IC0', label: 'IC0 中证500期指 (T+0)' },
                { value: '300308', label: '300308 中际旭创 (T+1)' },
                { value: '601899', label: '601899 紫金矿业 (T+1)' },
              ]}
              assetSymbol={soAssetSymbol}
              onChangeAssetSymbol={setSoAssetSymbol}
              onSelectStock={onSelectStock}
              autoRunKey={`so-${soSourceType}-${soSignalId}-${soAssetSymbol}`}
            />
          </div>
        </div>
      )}

      {/* ==================== TAB 04: 28 FUTURES NEAR-FAR TERM STRUCTURE ==================== */}
      {activeTab === 'term-structure' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-[1px] bg-[#222832] overflow-hidden">
          <div className="xl:col-span-6 w-pane min-h-0 flex flex-col overflow-hidden">
            <PaneHeader
              title="国内大宗商品近远月期限结构 (Backwardation现货逼仓 vs Contango累库)"
              badge={`${sortedTermStructures.length} 品种`}
              right={
                <div className="flex items-center gap-1">
                  {(['all', 'back', 'contango'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setTsFilter(f)}
                      className={`px-1.5 h-[19px] border text-[10px] ${
                        tsFilter === f
                          ? 'bg-[#0e1117] border-[#ff8800] text-[#ff8800] font-bold'
                          : 'bg-[#161b24] border-[#2a3240] text-[#8b95a5]'
                      }`}
                    >
                      {f === 'all' ? '全部' : f === 'back' ? 'Back升水' : 'Contango贴水'}
                    </button>
                  ))}
                </div>
              }
            />

            <div className="px-2.5 py-1 bg-[#11151d] border-b border-[#222832] flex items-center justify-between text-[11px] shrink-0">
              <span className="text-[#8b95a5]">
                正展期收益率 (Near &gt; Far) 代表现货紧缺逼仓，领先映射上游A股资源龙头
              </span>
              <div className="flex items-center gap-1">
                <span className="text-[#7d8796]">排序:</span>
                {(['roll', 'zscore', 'spread'] as const).map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => {
                      if (tsSortCol === col) setTsSortAsc((p) => !p);
                      else {
                        setTsSortCol(col);
                        setTsSortAsc(false);
                      }
                    }}
                    className={`px-1.5 h-[20px] border text-[10px] ${
                      tsSortCol === col
                        ? 'border-[#ff8800] text-[#ff8800]'
                        : 'border-[#2a3240] text-[#8b95a5]'
                    }`}
                  >
                    {col === 'roll' ? '展期Roll%' : col === 'zscore' ? '20日Z' : '价差'}
                    {tsSortCol === col ? (tsSortAsc ? '↑' : '↓') : ''}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-table">
                <thead>
                  <tr>
                    <th className="text-left">品种</th>
                    <th className="text-left">近月合约</th>
                    <th className="text-left">远月合约</th>
                    <th className="text-right">近月价</th>
                    <th className="text-right">远月价</th>
                    <th className="text-right">价差</th>
                    <th className="text-right">年化Roll%</th>
                    <th className="text-right">20日Z</th>
                    <th className="text-left">期限结构状态</th>
                    <th className="text-left">映射A股龙头</th>
                    <th className="text-center">联动</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTermStructures.map((ts) => {
                    const selected = ts.variety === tsSignalId;
                    const regCls =
                      ts.structureRegime === '强Back现货逼仓'
                        ? 'text-[#ff3535] border-[#ff3535]/50 bg-[#241214]'
                        : ts.structureRegime === '温和Back去库'
                        ? 'text-[#ff8800] border-[#ff8800]/50 bg-[#21180e]'
                        : 'text-[#00c853] border-[#00c853]/50 bg-[#0f2218]';
                    return (
                      <tr
                        key={ts.variety}
                        onClick={() => {
                          setTsSignalId(ts.variety);
                          setTsAssetSymbol(ts.mappedStockCode || `${ts.variety}0`);
                        }}
                        className={`cursor-pointer ${selected ? 'bg-[#1b2434] outline outline-1 outline-[#ff8800]' : ''}`}
                      >
                        <td className="text-[#e5b567] font-bold">
                          {ts.variety} <span className="text-[#dfe6f0] font-normal">{ts.name}</span>
                        </td>
                        <td className="text-[#cfd8e3]">{ts.nearContract}</td>
                        <td className="text-[#8b95a5]">{ts.farContract}</td>
                        <td className="text-right text-[#dfe6f0]">{fmtNum(ts.nearPrice, 1)}</td>
                        <td className="text-right text-[#8b95a5]">{fmtNum(ts.farPrice, 1)}</td>
                        <td className={`text-right ${colorUpDown(ts.spread)}`}>{fmtSigned(ts.spread, 1)}</td>
                        <td className={`text-right font-bold ${colorUpDown(ts.annualizedRollYieldPct)}`}>
                          {fmtPct(ts.annualizedRollYieldPct, 2)}
                        </td>
                        <td className="text-right text-[#f0b90b]">{fmtSigned(ts.spreadZScore20d, 2)}</td>
                        <td>
                          <span className={`px-1 text-[10px] border ${regCls}`}>{ts.structureRegime}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectStock(ts.mappedStockCode, ts.mappedStockName);
                            }}
                            className="text-[#e5b567] hover:text-[#ff8800] hover:underline"
                          >
                            {ts.mappedStockCode} {ts.mappedStockName}
                          </button>
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTsSignalId(ts.variety);
                              setTsAssetSymbol(ts.mappedStockCode);
                            }}
                            className="px-1.5 h-[18px] bg-[#161b24] border border-[#2a3240] text-[#ff8800] hover:border-[#ff8800] text-[10px]"
                          >
                            [测算]
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="xl:col-span-6 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
            <div className="bg-[#0d1015] h-[200px] shrink-0" ref={tsChartRef} />
            <div className="flex-1 min-h-0 overflow-hidden">
              <AltBacktestTerminal
                title="产业现货期限结构 (Back/Contango) -> A股龙头 Lead-Lag 回测"
                sourceOptions={[
                  { value: 'futures_back_contango', label: '近远月展期结构强度 (futures_back_contango)' },
                ]}
                sourceType="futures_back_contango"
                onChangeSourceType={() => {}}
                signalOptions={(altOverview?.termStructures || []).map((t) => ({
                  value: t.variety,
                  label: `${t.variety} ${t.name} (${t.nearContract}/${t.farContract})`,
                }))}
                signalId={tsSignalId}
                onChangeSignalId={setTsSignalId}
                assetOptions={[
                  { value: '601899', label: '601899 紫金矿业 (黄金/铜)' },
                  { value: '600938', label: '600938 中国海油 (原油)' },
                  { value: '601919', label: '601919 中远海控 (欧线集运)' },
                  { value: '300750', label: '300750 宁德时代 (碳酸锂)' },
                  { value: '601600', label: '601600 中国铝业 (工业金属)' },
                  { value: '600426', label: '600426 华鲁恒升 (化工甲醇/PTA)' },
                  { value: 'AU0', label: 'AU0 沪金主力 (T+0)' },
                  { value: 'SC0', label: 'SC0 原油主力 (T+0)' },
                  { value: 'EC0', label: 'EC0 欧线集运 (T+0)' },
                  { value: 'LC0', label: 'LC0 碳酸锂 (T+0)' },
                ]}
                assetSymbol={tsAssetSymbol}
                onChangeAssetSymbol={setTsAssetSymbol}
                onSelectStock={onSelectStock}
                autoRunKey={`ts-${tsSignalId}-${tsAssetSymbol}`}
              />
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 05: ZERO-COST INGESTION & JSONL TIME-SERIES ==================== */}
      {activeTab === 'ingestion-ops' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
          {/* Top Action Ribbon */}
          <div className="bg-[#0e1117] px-2.5 py-2 border-b border-[#222832] flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex flex-wrap items-center gap-3 text-[11px] tabular-nums">
              <span className="flex items-center gap-1.5 font-bold text-[#dfe6f0]">
                <Activity className="w-3.5 h-3.5 text-[#ff8800]" />
                零付费免Key实时采集引擎状态:
                <strong className="text-[#00c853]">
                  {(altOverview?.feeds || []).filter((f) => f.ok).length}/{(altOverview?.feeds || []).length} 在线
                </strong>
              </span>
              <span className="text-[#8b95a5]">
                本地时序快照数:{' '}
                <strong className="text-[#f0b90b]">{altOverview?.snapshots?.length ?? 0} 条</strong>
              </span>
              <span className="text-[#8b95a5]">
                校准规则: <strong className="text-[#cfd8e3]">{altOverview?.alignmentRule || 'Strict 09:00 CST'}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              {captureNotice && (
                <span className="text-[11px] text-[#e5b567] bg-[#161b24] border border-[#2a3240] px-2 py-0.5">
                  {captureNotice}
                </span>
              )}
              <button
                type="button"
                onClick={handleCaptureSnapshot}
                disabled={capturing}
                className="h-[24px] px-3 bg-[#ff8800] text-[#090c10] font-bold text-[11px] flex items-center gap-1.5 hover:bg-[#ff9c2a] disabled:opacity-60"
              >
                <Database className="w-3.5 h-3.5" />
                {capturing ? '全源抓取落库中...' : '[立即抓取全源截面落库]'}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-[1px] bg-[#222832] overflow-hidden">
            {/* Left Split: Ingestion Diagnostics + Token Config + EGO CLI */}
            <div className="xl:col-span-6 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-auto">
              <div className="w-pane flex-1 min-h-[240px] flex flex-col overflow-hidden">
                <PaneHeader
                  title="零付费免Key实时抓取源诊断矩阵 (JSON REST + SSR + EGO静默守护)"
                  badge={`${altOverview?.feeds?.length ?? 0} 通道`}
                />
                <div className="flex-1 overflow-auto">
                  <table className="w-table">
                    <thead>
                      <tr>
                        <th className="text-left">数据源</th>
                        <th className="text-left">模块</th>
                        <th className="text-left">采集协议</th>
                        <th className="text-center">状态</th>
                        <th className="text-right">耗时</th>
                        <th className="text-right">条目</th>
                        <th className="text-left">端点 / 详情</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(altOverview?.feeds || []).map((f) => (
                        <tr key={f.id}>
                          <td className="text-[#dfe6f0] font-semibold">{f.name}</td>
                          <td className="text-[#8b95a5]">{f.moduleName}</td>
                          <td className="text-[#4da3ff]">{f.method}</td>
                          <td className="text-center">
                            <span
                              className={`px-1 text-[10px] border ${
                                f.ok
                                  ? 'text-[#00c853] border-[#00c853]/50 bg-[#0f2218]'
                                  : 'text-[#ff3535] border-[#ff3535]/50 bg-[#241214]'
                              }`}
                            >
                              {f.ok ? 'OK' : 'FALLBACK'}
                            </span>
                          </td>
                          <td className="text-right text-[#f0b90b]">{f.latencyMs}ms</td>
                          <td className="text-right text-[#e5b567]">{f.itemCount}</td>
                          <td className="text-[#9aa5b5] max-w-[230px] truncate" title={`${f.endpointHint} | ${f.detail}`}>
                            {f.detail || f.endpointHint}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Optional Token & Auto Snapshot Config */}
              <div className="w-pane shrink-0">
                <PaneHeader
                  title="可选扩展 Token 与自动截面采集配置 (非必须, 零Key已全功能运行)"
                  right={
                    <SlidersHorizontal className="w-3.5 h-3.5 text-[#8b95a5]" />
                  }
                />
                <div className="p-2.5 bg-[#0e1117] grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                  <label className="flex flex-col gap-1">
                    <span className="text-[#8b95a5]">
                      Metaculus API Token (可选{' '}
                      {cfgForm.hasMetaculusToken ? (
                        <strong className="text-[#00c853]">已配置</strong>
                      ) : (
                        '未配置'
                      )}
                      )
                    </span>
                    <input
                      type="password"
                      value={cfgForm.metaculusToken || ''}
                      onChange={(e) => setCfgForm((p) => ({ ...p, metaculusToken: e.target.value }))}
                      placeholder="留空保持现有配置"
                      className="h-[26px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] px-2 outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[#8b95a5]">
                      GitHub Token (可选 AI算力开源流速{' '}
                      {cfgForm.hasGithubToken ? (
                        <strong className="text-[#00c853]">已配置</strong>
                      ) : (
                        '未配置'
                      )}
                      )
                    </span>
                    <input
                      type="password"
                      value={cfgForm.githubToken || ''}
                      onChange={(e) => setCfgForm((p) => ({ ...p, githubToken: e.target.value }))}
                      placeholder="留空保持现有配置"
                      className="h-[26px] bg-[#161b24] border border-[#2a3240] text-[#dfe6f0] px-2 outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-[#cfd8e3]">
                    <span>定时落库间隔(分钟, 0=手动):</span>
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      value={cfgForm.autoSnapshotMinutes}
                      onChange={(e) =>
                        setCfgForm((p) => ({ ...p, autoSnapshotMinutes: Number(e.target.value) || 0 }))
                      }
                      className="w-[70px] h-[24px] bg-[#161b24] border border-[#2a3240] text-[#f0b90b] px-2 outline-none tabular-nums"
                    />
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-1.5 text-[#cfd8e3] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cfgForm.egoCollectorEnabled}
                        onChange={(e) => setCfgForm((p) => ({ ...p, egoCollectorEnabled: e.target.checked }))}
                        className="accent-[#ff8800]"
                      />
                      <span>启用 EGO 静默守护采集</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleSaveConfig}
                      disabled={savingCfg}
                      className="h-[24px] px-3 bg-[#161b24] border border-[#ff8800] text-[#ff8800] hover:bg-[#ff8800] hover:text-[#090c10] font-bold"
                    >
                      {savingCfg ? '保存中...' : '保存配置'}
                    </button>
                  </div>
                </div>
              </div>

              {/* EGO Silent Collector CLI Reference */}
              <div className="w-pane shrink-0">
                <PaneHeader
                  title="EGO 静默浏览器隔离采集守护 (无痕提取 CME FedWatch / DRAM现货 / OpenRouter)"
                  badge={altOverview?.egoScriptPath || 'scripts/ego_alt_collector.mjs'}
                />
                <div className="p-2.5 bg-[#0e1117] space-y-1.5 text-[11px]">
                  {[
                    {
                      label: '单次静默截面抓取 (写入 data/ego_web_snapshots.jsonl)',
                      cmd: `node ${altOverview?.egoScriptPath || 'scripts/ego_alt_collector.mjs'} --once`,
                    },
                    {
                      label: '后台守护模式 (每15分钟轮询提取并自动释放EGO隔离空间)',
                      cmd: `node ${altOverview?.egoScriptPath || 'scripts/ego_alt_collector.mjs'} --watch --interval=15`,
                    },
                  ].map((c) => (
                    <div
                      key={c.cmd}
                      className="flex items-center justify-between gap-2 bg-[#11151d] border border-[#222832] px-2 py-1"
                    >
                      <div className="min-w-0">
                        <div className="text-[10px] text-[#7d8796]">{c.label}</div>
                        <code className="text-[#e5b567] text-[11px] font-mono break-all">{c.cmd}</code>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(c.cmd)}
                        className="h-[22px] px-2 bg-[#161b24] border border-[#2a3240] text-[#cfd8e3] hover:border-[#ff8800] flex items-center gap-1 shrink-0"
                      >
                        {copiedCmd === c.cmd ? <Check className="w-3 h-3 text-[#00c853]" /> : <Copy className="w-3 h-3" />}
                        {copiedCmd === c.cmd ? '已复制' : '复制'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Split: JSONL Historical Snapshot Log Viewer & Mini Trend */}
            <div className="xl:col-span-6 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
              <div className="bg-[#0d1015] h-[200px] shrink-0" ref={snapshotChartRef} />
              <div className="w-pane flex-1 min-h-[200px] flex flex-col overflow-hidden">
                <PaneHeader
                  title="本地时序快照日志 (data/consensus_snapshots.jsonl)"
                  badge={`共 ${altOverview?.snapshots?.length ?? 0} 条`}
                  right="最新记录在顶部"
                />
                <div className="flex-1 overflow-auto">
                  <table className="w-table">
                    <thead>
                      <tr>
                        <th className="text-left">抓取时间戳</th>
                        <th className="text-right">Kalshi</th>
                        <th className="text-right">Manifold</th>
                        <th className="text-right">PM</th>
                        <th className="text-right">PAXG($)</th>
                        <th className="text-right">BTC年化Funding</th>
                        <th className="text-right">159915 PCR</th>
                        <th className="text-left">最强Back品种</th>
                        <th className="text-right">最强Roll%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...(altOverview?.snapshots || [])].reverse().map((s, idx) => (
                        <tr key={`${s.timestamp}-${idx}`}>
                          <td className="text-[#cfd8e3]">{s.timestamp.replace('T', ' ').slice(0, 19)}</td>
                          <td className="text-right text-[#4da3ff]">{s.kalshiCount}</td>
                          <td className="text-right text-[#f0b90b]">{s.manifoldCount}</td>
                          <td className="text-right text-[#ff8800]">{s.pmCount}</td>
                          <td className="text-right text-[#e5b567]">{fmtNum(s.paxgPrice, 1)}</td>
                          <td className={`text-right ${colorUpDown(s.btcFundingAnnualPct)}`}>
                            {fmtPct(s.btcFundingAnnualPct, 1)}
                          </td>
                          <td className="text-right text-[#cfd8e3]">{fmtNum(s.chinextPcr, 2)}</td>
                          <td className="text-[#ff3535] font-bold">{s.topBackVariety}</td>
                          <td className={`text-right font-semibold ${colorUpDown(s.topBackRollYieldPct)}`}>
                            {fmtPct(s.topBackRollYieldPct, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
