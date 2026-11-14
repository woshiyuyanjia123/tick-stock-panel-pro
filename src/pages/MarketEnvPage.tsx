import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { RefreshCw } from 'lucide-react';
import { api, formatPct } from '../api/client';
import type { EnvState, MarketEnvDay, MarketEnvResponse } from '../types/market';

interface MarketEnvPageProps {
  onSelectStock: (code: string, name?: string, date?: string) => void;
}

const STATE_META: Record<
  EnvState,
  { color: string; bgTint: string; textColor: string }
> = {
  强势: { color: '#ff3535', bgTint: 'rgba(255, 53, 53, 0.08)', textColor: 'text-[#ff3535]' },
  偏强: { color: '#ff8800', bgTint: 'rgba(255, 136, 0, 0.07)', textColor: 'text-[#ff8800]' },
  震荡: { color: '#64748b', bgTint: 'rgba(100, 116, 139, 0.05)', textColor: 'text-[#8b95a5]' },
  偏弱: { color: '#4da3ff', bgTint: 'rgba(77, 163, 255, 0.07)', textColor: 'text-[#4da3ff]' },
  弱势: { color: '#00c853', bgTint: 'rgba(0, 200, 83, 0.08)', textColor: 'text-[#00c853]' },
};

const CYCLE_PHASES: {
  phase: '冰点期' | '启动期' | '发酵期' | '高潮期' | '退潮期';
  scoreRange: string;
  defaultPos: string;
  tactic: string;
  color: string;
}[] = [
  { phase: '冰点期', scoreRange: '< 25 分', defaultPos: '0%-20%', tactic: '空仓防守或轻仓试错首板/反核', color: '#00c853' },
  { phase: '启动期', scoreRange: '25-45 分', defaultPos: '30%-50%', tactic: '聚焦首次弱转强与新题材首板卡位', color: '#4da3ff' },
  { phase: '发酵期', scoreRange: '45-65 分', defaultPos: '60%-80%', tactic: '主升梯队接力，围绕主线核心做加仓', color: '#ff8800' },
  { phase: '高潮期', scoreRange: '>= 65 分', defaultPos: '50%-70%', tactic: '去弱留强，警惕一致后分歧兑现后排', color: '#ff3535' },
  { phase: '退潮期', scoreRange: '高位回落', defaultPos: '10%-30%', tactic: '严控回撤，规避中位补跌等待新冰点', color: '#e879f9' },
];

const WIND_TOOLTIP_CSS = 'border-radius:0;box-shadow:none;';

function getStateMeta(state?: EnvState | string) {
  if (state && state in STATE_META) {
    return STATE_META[state as EnvState];
  }
  return STATE_META['震荡'];
}

function scoreToState(score: number): EnvState {
  if (score >= 70) return '强势';
  if (score >= 55) return '偏强';
  if (score >= 45) return '震荡';
  if (score >= 30) return '偏弱';
  return '弱势';
}

export default function MarketEnvPage({ onSelectStock }: MarketEnvPageProps) {
  const [range, setRange] = useState<'1y' | '2y' | 'all'>('1y');
  const [subTab, setSubTab] = useState<'env' | 'cycle'>('env');
  const [data, setData] = useState<MarketEnvResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [hoveredDay, setHoveredDay] = useState<MarketEnvDay | null>(null);

  const trendChartRef = useRef<HTMLDivElement | null>(null);
  const donutChartRef = useRef<HTMLDivElement | null>(null);
  const cycleChartRef = useRef<HTMLDivElement | null>(null);

  const fetchData = useCallback(async (targetRange: '1y' | '2y' | 'all') => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMarketEnv(targetRange);
      setData(res);
    } catch (err: any) {
      setError(err?.message || '加载市场环境数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(range);
  }, [range, fetchData]);

  const timeline = useMemo(() => data?.timeline ?? [], [data]);
  const latest = data?.latest;
  const latestMeta = getStateMeta(latest?.state);

  const stateMarkAreas = useMemo(() => {
    if (!timeline.length) return [];
    const blocks: any[] = [];
    let startIdx = 0;
    for (let i = 1; i <= timeline.length; i++) {
      if (i === timeline.length || timeline[i].state !== timeline[startIdx].state) {
        const meta = getStateMeta(timeline[startIdx].state);
        blocks.push([
          { xAxis: timeline[startIdx].date, itemStyle: { color: meta.bgTint } },
          { xAxis: timeline[i - 1].date },
        ]);
        startIdx = i;
      }
    }
    return blocks;
  }, [timeline]);

  // Main composite trend chart (Market Env tab)
  useEffect(() => {
    if (subTab !== 'env' || !trendChartRef.current || !timeline.length) return;
    const chart = echarts.init(trendChartRef.current);

    const dates = timeline.map((d) => d.date);
    const shortDates = timeline.map((d) => d.date.slice(5));
    const maxLimitUp = Math.max(120, ...timeline.map((d) => d.limitUpCount || 0));
    const defaultStart =
      timeline.length > 75 ? Math.round(((timeline.length - 75) / timeline.length) * 100) : 0;

    const option: echarts.EChartsOption = {
      animation: false,
      backgroundColor: '#0d1015',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#141923',
        borderColor: '#2a3342',
        borderWidth: 1,
        extraCssText: WIND_TOOLTIP_CSS,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
        axisPointer: { type: 'cross', lineStyle: { color: '#475569', type: 'dashed' } },
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return '';
          const idx = params[0].dataIndex;
          const item = timeline[idx];
          if (!item) return '';
          const meta = getStateMeta(item.state);
          const shText =
            item.shChangePct !== undefined
              ? `<span style="color:${item.shChangePct >= 0 ? '#ff3535' : '#00c853'}">${formatPct(item.shChangePct)}</span>`
              : '-';
          return `
            <div style="min-width:170px">
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid #252c38;padding-bottom:3px;margin-bottom:4px">
                <span style="color:#8b95a5">${item.date}</span>
                <span style="color:${meta.color};font-weight:700">${item.state} ${item.score}分</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;font-size:11px">
                <span style="color:#8b95a5">涨停数:</span><span style="text-align:right;color:#ff3535">${item.limitUpCount}</span>
                <span style="color:#8b95a5">上证涨跌:</span><span style="text-align:right">${shText}</span>
                <span style="color:#8b95a5">赚钱:</span><span style="text-align:right;color:#ff8800">${item.profit}</span>
                <span style="color:#8b95a5">投机:</span><span style="text-align:right;color:#e879f9">${item.speculation}</span>
                <span style="color:#8b95a5">抗跌:</span><span style="text-align:right;color:#00c853">${item.resilience}</span>
                <span style="color:#8b95a5">趋势:</span><span style="text-align:right;color:#4da3ff">${item.trend}</span>
              </div>
            </div>`;
        },
      },
      legend: {
        top: 4,
        left: 'center',
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { color: '#8b95a5', fontSize: 11 },
        selected: {
          综合分: true,
          涨停数: true,
          赚钱: false,
          投机: false,
          抗跌: false,
          趋势: false,
        },
        data: ['综合分', '涨停数', '赚钱', '投机', '抗跌', '趋势'],
      },
      grid: { top: 30, left: 40, right: 54, bottom: 48 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#222832' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#7d8796',
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace',
          formatter: (_val: string, idx: number) => shortDates[idx] || '',
        },
      },
      yAxis: [
        {
          type: 'value',
          name: '涨停',
          nameTextStyle: { color: '#7d8796', fontSize: 10, align: 'right' },
          min: 0,
          max: Math.ceil(maxLimitUp / 30) * 30,
          splitNumber: 5,
          axisLine: { show: false },
          splitLine: { lineStyle: { color: '#1b212c', type: 'dashed' } },
          axisLabel: { color: '#7d8796', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
        },
        {
          type: 'value',
          name: '综合分',
          nameTextStyle: { color: '#7d8796', fontSize: 10, align: 'left' },
          min: 0,
          max: 100,
          interval: 20,
          axisLine: { show: false },
          splitLine: { show: false },
          axisLabel: { color: '#7d8796', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
        },
      ],
      dataZoom: [
        { type: 'inside', start: defaultStart, end: 100 },
        {
          type: 'slider',
          height: 16,
          bottom: 4,
          start: defaultStart,
          end: 100,
          borderColor: '#222832',
          backgroundColor: '#090c10',
          fillerColor: 'rgba(255, 136, 0, 0.16)',
          handleStyle: { color: '#ff8800', borderColor: '#dfe6f0' },
          textStyle: { color: '#7d8796', fontSize: 10 },
          dataBackground: {
            lineStyle: { color: '#334155' },
            areaStyle: { color: '#151a23' },
          },
        },
      ],
      series: [
        {
          name: '涨停数',
          type: 'bar',
          yAxisIndex: 0,
          barMaxWidth: 7,
          itemStyle: { color: 'rgba(255, 53, 53, 0.42)' },
          data: timeline.map((d) => d.limitUpCount),
          markArea: { silent: true, data: stateMarkAreas },
        },
        {
          name: '综合分',
          type: 'line',
          yAxisIndex: 1,
          smooth: false,
          showSymbol: false,
          lineStyle: { color: '#ffffff', width: 1.8 },
          itemStyle: { color: '#ffffff' },
          data: timeline.map((d) => d.score),
          markLine: {
            symbol: ['none', 'none'],
            silent: true,
            data: [
              {
                yAxis: 70,
                lineStyle: { color: '#ff3535', type: 'dashed', width: 1 },
                label: {
                  position: 'end',
                  formatter: '强势 70',
                  backgroundColor: '#ff3535',
                  color: '#fff',
                  padding: [1, 4],
                  borderRadius: 0,
                  fontSize: 10,
                },
              },
              {
                yAxis: 55,
                lineStyle: { color: '#ff8800', type: 'dashed', width: 1 },
                label: {
                  position: 'end',
                  formatter: '偏强 55',
                  backgroundColor: '#ff8800',
                  color: '#090c10',
                  padding: [1, 4],
                  borderRadius: 0,
                  fontSize: 10,
                },
              },
              {
                yAxis: 45,
                lineStyle: { color: '#64748b', type: 'dashed', width: 1 },
                label: {
                  position: 'end',
                  formatter: '震荡 45',
                  backgroundColor: '#475569',
                  color: '#fff',
                  padding: [1, 4],
                  borderRadius: 0,
                  fontSize: 10,
                },
              },
              {
                yAxis: 30,
                lineStyle: { color: '#4da3ff', type: 'dashed', width: 1 },
                label: {
                  position: 'end',
                  formatter: '偏弱 30',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  padding: [1, 4],
                  borderRadius: 0,
                  fontSize: 10,
                },
              },
            ],
          },
        },
        {
          name: '赚钱',
          type: 'line',
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#ff8800', width: 1.2 },
          itemStyle: { color: '#ff8800' },
          data: timeline.map((d) => d.profit),
        },
        {
          name: '投机',
          type: 'line',
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#e879f9', width: 1.2 },
          itemStyle: { color: '#e879f9' },
          data: timeline.map((d) => d.speculation),
        },
        {
          name: '抗跌',
          type: 'line',
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#00c853', width: 1.2 },
          itemStyle: { color: '#00c853' },
          data: timeline.map((d) => d.resilience),
        },
        {
          name: '趋势',
          type: 'line',
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#4da3ff', width: 1.2 },
          itemStyle: { color: '#4da3ff' },
          data: timeline.map((d) => d.trend),
        },
      ],
    };

    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(trendChartRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [subTab, timeline, stateMarkAreas]);

  // State Distribution Donut Chart
  useEffect(() => {
    if (subTab !== 'env' || !donutChartRef.current || !data?.stateDistribution?.length) return;
    const chart = echarts.init(donutChartRef.current);

    const dist = data.stateDistribution;
    const dominant = [...dist].sort((a, b) => b.count - a.count)[0];
    const option: echarts.EChartsOption = {
      animation: false,
      backgroundColor: '#0d1015',
      tooltip: {
        trigger: 'item',
        backgroundColor: '#141923',
        borderColor: '#2a3342',
        borderWidth: 1,
        extraCssText: WIND_TOOLTIP_CSS,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
        formatter: (p: any) => `${p.name}: ${p.data.count}天 (${p.percent}%)`,
      },
      title: dominant
        ? {
            text: `${dominant.pct?.toFixed?.(1) ?? dominant.count}%`,
            subtext: `${dominant.state}`,
            left: 'center',
            top: '41%',
            textStyle: {
              color: '#e8edf5',
              fontSize: 16,
              fontWeight: 700,
              fontFamily: 'JetBrains Mono, monospace',
            },
            subtextStyle: { color: '#8b95a5', fontSize: 11 },
          }
        : undefined,
      series: [
        {
          name: '状态分布',
          type: 'pie',
          radius: ['50%', '72%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: '#0d1015', borderWidth: 2 },
          label: {
            show: true,
            color: '#8b95a5',
            fontSize: 10,
            fontFamily: 'JetBrains Mono, monospace',
            formatter: (p: any) => `${p.name} ${Number(p.percent).toFixed(1)}%`,
          },
          labelLine: { length: 8, length2: 10, lineStyle: { color: '#334155' } },
          data: dist.map((item) => ({
            name: item.state,
            value: item.count,
            count: item.count,
            itemStyle: { color: getStateMeta(item.state).color },
          })),
        },
      ],
    };

    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(donutChartRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [subTab, data]);

  // Sentiment Cycle Evolution Chart (Cycle tab)
  useEffect(() => {
    if (subTab !== 'cycle' || !cycleChartRef.current || !timeline.length) return;
    const chart = echarts.init(cycleChartRef.current);
    const recent = timeline.slice(-60);

    const option: echarts.EChartsOption = {
      animation: false,
      backgroundColor: '#0d1015',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#141923',
        borderColor: '#2a3342',
        borderWidth: 1,
        extraCssText: WIND_TOOLTIP_CSS,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
      },
      legend: {
        top: 4,
        textStyle: { color: '#8b95a5', fontSize: 11 },
        data: ['综合分', '赚钱效应', '投机热度', '上证涨跌%'],
      },
      grid: { top: 30, left: 40, right: 44, bottom: 24 },
      xAxis: {
        type: 'category',
        data: recent.map((d) => d.date.slice(5)),
        axisLine: { lineStyle: { color: '#222832' } },
        axisLabel: { color: '#7d8796', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
      },
      yAxis: [
        {
          type: 'value',
          min: 0,
          max: 100,
          splitLine: { lineStyle: { color: '#1b212c', type: 'dashed' } },
          axisLabel: { color: '#7d8796', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
        },
        {
          type: 'value',
          splitLine: { show: false },
          axisLabel: { color: '#7d8796', fontSize: 10, formatter: '{value}%' },
        },
      ],
      series: [
        {
          name: '综合分',
          type: 'line',
          showSymbol: false,
          lineStyle: { color: '#ffffff', width: 1.8 },
          data: recent.map((d) => d.score),
        },
        {
          name: '赚钱效应',
          type: 'line',
          showSymbol: false,
          lineStyle: { color: '#ff3535', width: 1.4 },
          data: recent.map((d) => d.profit),
        },
        {
          name: '投机热度',
          type: 'line',
          showSymbol: false,
          lineStyle: { color: '#f0b90b', width: 1.4 },
          data: recent.map((d) => d.speculation),
        },
        {
          name: '上证涨跌%',
          type: 'bar',
          yAxisIndex: 1,
          barMaxWidth: 6,
          data: recent.map((d) => ({
            value: Number((d.shChangePct ?? 0).toFixed(2)),
            itemStyle: {
              color: (d.shChangePct ?? 0) >= 0 ? 'rgba(255, 53, 53, 0.55)' : 'rgba(0, 200, 83, 0.55)',
            },
          })),
        },
      ],
    };

    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(cycleChartRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [subTab, timeline]);

  const recentTransitions = useMemo(() => {
    const events: {
      date: string;
      from: EnvState;
      to: EnvState;
      score: number;
      limitUpCount: number;
    }[] = [];
    for (let i = 1; i < timeline.length; i++) {
      if (timeline[i].state !== timeline[i - 1].state) {
        events.push({
          date: timeline[i].date,
          from: timeline[i - 1].state,
          to: timeline[i].state,
          score: timeline[i].score,
          limitUpCount: timeline[i].limitUpCount,
        });
      }
    }
    return events.slice(-16).reverse();
  }, [timeline]);

  const displayedMonths = useMemo(() => {
    const months = data?.calendarMonths ?? [];
    if (calendarExpanded || months.length <= 9) return months;
    return months.slice(-9);
  }, [data, calendarExpanded]);

  const breakdownItems = [
    { label: '赚钱', value: latest?.breakdown?.profit ?? 0, color: '#ff8800' },
    { label: '投机', value: latest?.breakdown?.speculation ?? 0, color: '#e879f9' },
    { label: '抗跌', value: latest?.breakdown?.resilience ?? 0, color: '#00c853' },
    { label: '趋势', value: latest?.breakdown?.trend ?? 0, color: '#4da3ff' },
  ];

  return (
    <div className="h-full w-full flex flex-col bg-[#222832] gap-[1px] overflow-hidden text-[#dfe6f0]">
      {/* Top 26px Wind Control Bar */}
      <div className="w-header shrink-0 px-0">
        <div className="flex items-center h-full">
          <div className="w-title-bar px-2.5 border-r border-[#222832] h-full">
            市场环境 · 宏观周期
          </div>
          <button
            onClick={() => setSubTab('env')}
            className={`w-tab ${subTab === 'env' ? 'w-tab-active' : ''}`}
          >
            [01] 环境综合评分
          </button>
          <button
            onClick={() => setSubTab('cycle')}
            className={`w-tab ${subTab === 'cycle' ? 'w-tab-active' : ''}`}
          >
            [02] 情绪周期定位
          </button>

          <div className="flex items-center h-full border-r border-[#222832]">
            {(
              [
                { id: '1y', label: '1年' },
                { id: '2y', label: '2年' },
                { id: 'all', label: '全部' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => setRange(item.id)}
                className={`h-full px-2.5 text-[11px] font-mono border-l border-[#222832] ${
                  range === item.id
                    ? 'bg-[#0e1117] text-[#ff9500] font-semibold'
                    : 'text-[#8b95a5] hover:text-[#dfe6f0] hover:bg-[#1b2230]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 pr-2 text-[11px] font-mono">
          {data?.updatedAt && (
            <span className="hidden md:inline text-[#7d8796]">SYNC {data.updatedAt}</span>
          )}
          <button
            onClick={() => onSelectStock('000001', '上证指数', latest?.date)}
            className="px-2 py-0.5 bg-[#11151d] hover:bg-[#1b2434] border border-[#252c38] text-[#e5b567] rounded-[2px]"
          >
            000001.SH 上证K线
          </button>
          <button
            onClick={() => fetchData(range)}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#11151d] hover:bg-[#1b2434] border border-[#252c38] text-[#dfe6f0] rounded-[2px] disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin text-[#ff8800]' : ''}`} />
            重算
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-[#1a1114] border-b border-[#ff3535] px-3 py-1.5 text-xs text-[#ff3535] flex items-center justify-between shrink-0">
          <span>{error}</span>
          <button onClick={() => fetchData(range)} className="underline">
            重试
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="flex-1 bg-[#0e1117] flex items-center justify-center text-xs font-mono text-[#7d8796]">
          正在计算市场环境与周期序列...
        </div>
      ) : null}

      {data && subTab === 'env' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-y-auto">
          {/* Row 1: 4-Pane Unified Summary Strip */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-[1px] bg-[#222832] shrink-0">
            {/* Pane 1: Latest State */}
            <div className="bg-[#0e1117] p-2.5 flex flex-col justify-between">
              <div className="flex items-center justify-between text-[11px] text-[#8b95a5]">
                <span>最新状态 · <span className="font-mono text-[#e5b567]">{latest?.date || '-'}</span></span>
                <span className="px-1.5 py-0.5 bg-[#151a23] border border-[#252c38] text-[#f0b90b] text-[10px]">
                  {data.cyclePhase?.phase || '周期跟踪'}
                </span>
              </div>
              <div className="flex items-baseline gap-2.5 my-1.5">
                <span className={`text-xl font-bold ${latestMeta.textColor}`}>
                  {latest?.state || '-'}
                </span>
                <span className="text-base font-mono font-bold text-[#e8edf5] tabular-nums">
                  {latest?.score ?? 0} 分
                </span>
              </div>
              <div className="w-full h-1 bg-[#161b24]">
                <div
                  className="h-full"
                  style={{
                    width: `${Math.min(100, Math.max(4, latest?.score ?? 0))}%`,
                    backgroundColor: latestMeta.color,
                  }}
                />
              </div>
            </div>

            {/* Pane 2: Momentum */}
            <div className="bg-[#0e1117] p-2.5 flex flex-col justify-between">
              <div className="flex items-center justify-between text-[11px] text-[#8b95a5]">
                <span>当前势头</span>
                <span className="font-mono text-[#7d8796]">{latest?.momentumText || '-'}</span>
              </div>
              <div className="my-1.5 text-sm font-semibold text-[#e8edf5]">
                连续{' '}
                <span className={`font-mono text-lg font-bold tabular-nums ${latestMeta.textColor}`}>
                  {latest?.momentumDays ?? 1}
                </span>{' '}
                天{latest?.state || ''}
              </div>
              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#181d26]">
                <span className="text-[#7d8796]">建议仓位</span>
                <span className="font-mono text-[#f0b90b] font-semibold">
                  {data.cyclePhase?.positionRange || '30% - 50%'}
                </span>
              </div>
            </div>

            {/* Pane 3: 4D Breakdown */}
            <div className="bg-[#0e1117] p-2.5 flex flex-col justify-between">
              <div className="text-[11px] text-[#8b95a5] mb-1">
                四维拆解 · <span className="font-mono">{latest?.date || '-'}</span>
              </div>
              <div className="flex flex-col gap-1">
                {breakdownItems.map((item) => (
                  <div key={item.label} className="flex items-center gap-2 text-[11px]">
                    <span className="w-7 text-[#8b95a5] shrink-0">{item.label}</span>
                    <div className="flex-1 h-1.5 bg-[#161b24]">
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.min(100, Math.max(0, item.value))}%`,
                          backgroundColor: item.color,
                        }}
                      />
                    </div>
                    <span className="w-6 text-right font-mono text-[#dfe6f0] tabular-nums">
                      {Math.round(item.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pane 4: Transitions */}
            <div className="bg-[#0e1117] p-2.5 flex flex-col justify-between">
              <div className="text-[11px] text-[#8b95a5]">
                状态转换 · 近 <span className="font-mono">{data.transitions?.windowDays ?? timeline.length}</span> 天
              </div>
              <div className="flex items-baseline gap-2 my-1.5">
                <span className="text-xl font-mono font-bold text-[#e8edf5] tabular-nums">
                  {data.transitions?.count ?? 0}
                </span>
                <span className="text-xs text-[#8b95a5]">次切换</span>
              </div>
              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#181d26]">
                <span className="text-[#7d8796]">切换节奏</span>
                <span className="text-[#4da3ff] font-medium">
                  {data.transitions?.rhythm || '平稳轮动'}
                </span>
              </div>
            </div>
          </div>

          {/* Row 2: Timeline Barcode Strip */}
          <div className="bg-[#0e1117] shrink-0">
            <div className="w-header">
              <span className="w-title-bar">状态时间轴</span>
              <div className="flex items-center gap-3 text-[11px] font-mono text-[#7d8796]">
                {hoveredDay && (
                  <span className="px-2 py-0.5 bg-[#11151d] border border-[#252c38] text-[#dfe6f0]">
                    {hoveredDay.date} ·{' '}
                    <span className={getStateMeta(hoveredDay.state).textColor}>
                      {hoveredDay.state} {hoveredDay.score}分
                    </span>{' '}
                    · 涨停 {hoveredDay.limitUpCount}家
                  </span>
                )}
                <span>
                  {timeline[0]?.date || '-'} ~ {timeline[timeline.length - 1]?.date || '-'} ({timeline.length}D)
                </span>
              </div>
            </div>
            <div className="p-2.5">
              <div
                className="w-full h-5 flex bg-[#090c10] border border-[#222832]"
                onMouseLeave={() => setHoveredDay(null)}
              >
                {timeline.map((day) => {
                  const meta = getStateMeta(day.state);
                  const isHovered = hoveredDay?.date === day.date;
                  return (
                    <div
                      key={day.date}
                      onMouseEnter={() => setHoveredDay(day)}
                      style={{ backgroundColor: meta.color }}
                      className={`flex-1 h-full cursor-crosshair ${
                        isHovered ? 'ring-1 ring-white z-10' : 'opacity-90 hover:opacity-100'
                      }`}
                      title={`${day.date} ${day.state} ${day.score}分 (涨停${day.limitUpCount}家)`}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-5 mt-2 text-[11px] text-[#8b95a5]">
                {(['强势', '偏强', '震荡', '偏弱', '弱势'] as EnvState[]).map((st) => (
                  <div key={st} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2" style={{ backgroundColor: STATE_META[st].color }} />
                    <span>{st}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Row 3: Middle Split (Composite Trend + Distribution) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-[1px] bg-[#222832] shrink-0">
            <div className="lg:col-span-8 bg-[#0e1117] flex flex-col">
              <div className="w-header">
                <span className="w-title-bar">环境综合分趋势</span>
                <span className="text-[11px] text-[#7d8796]">
                  白线=综合分 · 红柱=涨停数 · 点击图例切换四维细线
                </span>
              </div>
              <div ref={trendChartRef} className="w-full h-[290px]" />
            </div>

            <div className="lg:col-span-4 bg-[#0e1117] flex flex-col">
              <div className="w-header">
                <span className="w-title-bar">状态分布</span>
                <span className="text-[11px] font-mono text-[#7d8796]">
                  近 {data.transitions?.windowDays ?? timeline.length} 天
                </span>
              </div>
              <div ref={donutChartRef} className="w-full h-[185px]" />
              <div className="border-t border-[#222832] flex-1">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-left">状态</th>
                      <th className="text-right">天数</th>
                      <th className="text-right">占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.stateDistribution ?? []).map((item) => {
                      const meta = getStateMeta(item.state);
                      return (
                        <tr key={item.state}>
                          <td className={`font-semibold ${meta.textColor}`}>{item.state}</td>
                          <td className="text-right font-mono text-[#dfe6f0]">{item.count}</td>
                          <td className="text-right font-mono text-[#8b95a5]">
                            {item.pct.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Row 4: Calendar Heatmap */}
          <div className="bg-[#0e1117]">
            <div className="w-header">
              <span className="w-title-bar">日历热力图</span>
              <button
                onClick={() => setCalendarExpanded((v) => !v)}
                className="px-2 py-0.5 bg-[#11151d] hover:bg-[#1b2434] border border-[#252c38] text-[11px] text-[#dfe6f0] rounded-[2px]"
              >
                {calendarExpanded ? '收起' : `展开 (${data.calendarMonths?.length ?? 0}月)`}
              </button>
            </div>
            <div
              className={`p-2.5 grid gap-2 ${
                calendarExpanded
                  ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'
                  : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9'
              }`}
            >
              {displayedMonths.map((month) => {
                const avgMeta = getStateMeta(scoreToState(month.avgScore));
                const sortedDays = [...(month.days || [])].sort((a, b) =>
                  a.date.localeCompare(b.date)
                );
                const firstDate = sortedDays[0]?.date;
                const firstCol = firstDate
                  ? (() => {
                      const d = new Date(`${firstDate}T00:00:00`).getDay();
                      return d === 0 ? 6 : d - 1;
                    })()
                  : 0;
                const firstDayNum = sortedDays[0]?.day ?? 1;
                const blanksBefore = Math.max(0, firstCol - ((firstDayNum - 1) % 7));
                const dayMap = new Map<number, (typeof sortedDays)[number]>();
                let maxDay = 28;
                for (const d of sortedDays) {
                  dayMap.set(d.day, d);
                  if (d.day > maxDay) maxDay = d.day;
                }
                const day1Col = firstDate
                  ? (() => {
                      const dt = new Date(`${month.month}-01T00:00:00`);
                      if (Number.isNaN(dt.getTime())) return blanksBefore;
                      const g = dt.getDay();
                      return g === 0 ? 6 : g - 1;
                    })()
                  : blanksBefore;

                return (
                  <div
                    key={month.month}
                    className="bg-[#11151d] border border-[#222832] p-2"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium text-[#dfe6f0]">{month.label}</span>
                      <span
                        className="text-[10px] font-mono font-bold px-1.5 py-0.5 text-white"
                        style={{ backgroundColor: avgMeta.color }}
                      >
                        {Math.round(month.avgScore)}
                      </span>
                    </div>

                    <div className="grid grid-cols-7 gap-0.5 text-[9px] text-[#7d8796] text-center mb-1">
                      {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
                        <span key={w}>{w}</span>
                      ))}
                    </div>

                    <div className="grid grid-cols-7 gap-0.5">
                      {Array.from({ length: day1Col }).map((_, idx) => (
                        <div key={`pad-${idx}`} className="aspect-square" />
                      ))}
                      {Array.from({ length: maxDay }).map((_, idx) => {
                        const dayNum = idx + 1;
                        const entry = dayMap.get(dayNum);
                        if (!entry) {
                          return <div key={`empty-${dayNum}`} className="aspect-square bg-[#161b24]" />;
                        }
                        const m = getStateMeta(entry.state);
                        return (
                          <div
                            key={entry.date}
                            style={{ backgroundColor: m.color }}
                            title={`${entry.date} · ${entry.state} ${entry.score}分`}
                            className="aspect-square flex items-center justify-center text-[8px] font-mono text-white hover:ring-1 hover:ring-white cursor-default"
                          >
                            {calendarExpanded ? dayNum : ''}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {data && subTab === 'cycle' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-y-auto">
          {/* Active Cycle Pipeline */}
          <div className="bg-[#0e1117] shrink-0">
            <div className="w-header">
              <span className="w-title-bar">A股情绪周期定位与仓位模型</span>
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="text-[#8b95a5]">
                  当前周期: <strong className="text-[#ff8800]">{data.cyclePhase?.phase}</strong>
                </span>
                <span className="text-[#8b95a5]">
                  建议仓位: <strong className="text-[#f0b90b]">{data.cyclePhase?.positionRange}</strong>
                </span>
                <span className="text-[#dfe6f0] hidden md:inline">{data.cyclePhase?.advice}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-[1px] bg-[#222832]">
              {CYCLE_PHASES.map((stage, idx) => {
                const isActive = data.cyclePhase?.phase === stage.phase;
                return (
                  <div
                    key={stage.phase}
                    className={`p-2.5 ${
                      isActive
                        ? 'bg-[#151b26] border-t-2 border-t-[#ff8800]'
                        : 'bg-[#0e1117] opacity-75'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold" style={{ color: stage.color }}>
                        {idx + 1}. {stage.phase}
                      </span>
                      {isActive && (
                        <span className="px-1.5 py-0.5 text-[10px] bg-[#ff8800] text-[#090c10] font-bold">
                          当前
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-[#7d8796] mb-1">
                      阈值 {stage.scoreRange} | 仓位 {stage.defaultPos}
                    </div>
                    <div className="text-[11px] text-[#dfe6f0] leading-snug">{stage.tactic}</div>
                  </div>
                );
              })}
            </div>
            {data.cyclePhase?.description && (
              <div className="px-3 py-1.5 bg-[#11151d] border-t border-[#222832] text-[11px] text-[#8b95a5]">
                周期研判: <span className="text-[#dfe6f0]">{data.cyclePhase.description}</span>
              </div>
            )}
          </div>

          {/* Cycle Chart + Transitions Table */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-[1px] bg-[#222832] flex-1 min-h-[320px]">
            <div className="lg:col-span-8 bg-[#0e1117] flex flex-col">
              <div className="w-header">
                <span className="w-title-bar">近60交易日情绪周期演进</span>
                <span className="text-[11px] text-[#7d8796]">
                  综合分 · 赚钱效应 · 投机热度 vs 上证涨跌
                </span>
              </div>
              <div ref={cycleChartRef} className="w-full flex-1 min-h-[290px]" />
            </div>

            <div className="lg:col-span-4 bg-[#0e1117] flex flex-col min-h-0">
              <div className="w-header">
                <span className="w-title-bar">近期状态拐点日志</span>
                <span className="text-[11px] font-mono text-[#7d8796]">
                  {recentTransitions.length} 条
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-left">日期</th>
                      <th className="text-left">状态切换</th>
                      <th className="text-right">分值</th>
                      <th className="text-right">涨停</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTransitions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center py-6 text-[#7d8796]">
                          暂无状态切换记录
                        </td>
                      </tr>
                    ) : (
                      recentTransitions.map((ev) => {
                        const fromMeta = getStateMeta(ev.from);
                        const toMeta = getStateMeta(ev.to);
                        return (
                          <tr key={`${ev.date}-${ev.to}`}>
                            <td className="font-mono text-[#8b95a5]">{ev.date}</td>
                            <td>
                              <span className={fromMeta.textColor}>{ev.from}</span>
                              <span className="text-[#566070] mx-1">-&gt;</span>
                              <span className={`font-semibold ${toMeta.textColor}`}>{ev.to}</span>
                            </td>
                            <td className="text-right font-mono text-[#dfe6f0]">{ev.score}</td>
                            <td className="text-right font-mono text-[#ff3535]">{ev.limitUpCount}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
