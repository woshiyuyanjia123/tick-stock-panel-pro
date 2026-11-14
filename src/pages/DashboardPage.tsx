import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { api, formatAmount, formatPct } from '../api/client';
import type { DashboardData, IndexQuote, PandaPmOverviewResponse, SectorHotItem } from '../types/market';

interface DashboardPageProps {
  onSelectStock: (code: string, name?: string, date?: string) => void;
  onNavigate?: (tab: string) => void;
}

type SectionKey = 'strip' | 'middle' | 'bottom';

const DEFAULT_SECTIONS: Record<SectionKey, boolean> = {
  strip: true,
  middle: true,
  bottom: true,
};

function windColor(val?: number | null): string {
  if (val === undefined || val === null || val === 0) return 'text-[#8b949e]';
  return val > 0 ? 'text-[#ff3535]' : 'text-[#00c853]';
}

function MicroIndexSparkline({ idx }: { idx: IndexQuote }) {
  const isUp = (idx.changePct ?? 0) >= 0;
  const stroke = isUp ? '#ff3535' : '#00c853';
  const points = useMemo(() => {
    const pct = idx.changePct ?? 0;
    const base = 11;
    const endY = Math.max(2, Math.min(20, base - pct * 1.4));
    const mid1 = base - pct * 0.4 + (isUp ? 1.8 : -1.8);
    const mid2 = base - pct * 0.9 + (isUp ? -1.4 : 1.4);
    const mid3 = base - pct * 1.2 + (isUp ? 1.0 : -1.0);
    return [
      [1, base],
      [14, mid1],
      [27, mid2],
      [40, mid3],
      [54, endY],
    ];
  }, [idx.changePct, isUp]);

  const d = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox="0 0 56 22" className="w-12 h-5 shrink-0" fill="none">
      <line x1="0" y1="11" x2="56" y2="11" stroke="#222832" strokeWidth="1" strokeDasharray="2 2" />
      <path d={d} stroke={stroke} strokeWidth="1.4" strokeLinecap="square" />
    </svg>
  );
}

function MicroTrendLine({ trend }: { trend: 'up' | 'flat' | 'down' }) {
  if (trend === 'up') {
    return (
      <svg viewBox="0 0 36 14" className="w-8 h-3 text-[#ff3535]" fill="none">
        <path d="M1 12 L10 9 L18 10 L27 4 L35 2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  if (trend === 'down') {
    return (
      <svg viewBox="0 0 36 14" className="w-8 h-3 text-[#00c853]" fill="none">
        <path d="M1 2 L10 5 L18 4 L27 10 L35 12" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 36 14" className="w-8 h-3 text-[#4da3ff]" fill="none">
      <path d="M1 7 L10 6 L18 8 L27 7 L35 7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function undertakeColorClass(status: string): string {
  if (status.includes('增强') || status.includes('强')) return 'text-[#ff3535]';
  if (status.includes('减弱') || status.includes('弱')) return 'text-[#00c853]';
  return 'text-[#4da3ff]';
}

export default function DashboardPage({ onSelectStock, onNavigate }: DashboardPageProps) {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [pandaPm, setPandaPm] = useState<PandaPmOverviewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showCustomLayout, setShowCustomLayout] = useState<boolean>(false);
  const [visibleSections, setVisibleSections] = useState<Record<SectionKey, boolean>>(() => {
    try {
      const saved = localStorage.getItem('tsp_dashboard_sections_v3');
      if (saved) return { ...DEFAULT_SECTIONS, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
    return DEFAULT_SECTIONS;
  });
  const [detailModalOpen, setDetailModalOpen] = useState<boolean>(false);

  const radarRef = useRef<HTMLDivElement | null>(null);
  const radarChartRef = useRef<echarts.ECharts | null>(null);

  const fetchDashboard = useCallback(async (dateOverride?: string) => {
    setLoading(true);
    setError(null);
    try {
      const [res, pmRes] = await Promise.all([
        api.getDashboard(dateOverride || undefined),
        api.getPandaPmOverview().catch(() => null),
      ]);
      setData(res);
      if (pmRes) setPandaPm(pmRes);
      if (!dateOverride && (res?.resolvedDate || res?.date)) {
        setSelectedDate(res.resolvedDate || res.date);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载市场全貌失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const toggleSection = (key: SectionKey) => {
    setVisibleSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('tsp_dashboard_sections_v3', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  useEffect(() => {
    if (!radarRef.current || !visibleSections.middle) return;
    const axes = data?.sentimentRadar?.axes ?? [
      { name: '指数', value: 30, max: 100 },
      { name: '赚钱', value: 25, max: 100 },
      { name: '量能', value: 45, max: 100 },
      { name: '投机', value: 35, max: 100 },
      { name: '抗跌', value: 20, max: 100 },
      { name: '主线', value: 30, max: 100 },
    ];
    const score = data?.sentimentRadar?.score ?? 30;
    const lineColor = score >= 65 ? '#ff3535' : score >= 45 ? '#f0b90b' : '#00c853';
    const areaFill =
      score >= 65
        ? 'rgba(255, 53, 53, 0.18)'
        : score >= 45
          ? 'rgba(240, 185, 11, 0.16)'
          : 'rgba(0, 200, 83, 0.16)';

    if (!radarChartRef.current) {
      radarChartRef.current = echarts.init(radarRef.current);
    }
    const chart = radarChartRef.current;
    chart.setOption({
      animationDuration: 300,
      tooltip: {
        trigger: 'item',
        backgroundColor: '#151a23',
        borderColor: '#2a3342',
        borderWidth: 1,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
      },
      radar: {
        indicator: axes.map((a) => ({ name: a.name, max: a.max || 100 })),
        radius: '64%',
        center: ['50%', '52%'],
        splitNumber: 3,
        axisName: {
          color: '#8b95a5',
          fontSize: 11,
        },
        splitLine: { lineStyle: { color: '#1e2633' } },
        splitArea: { areaStyle: { color: ['#0e1117', '#11151d'] } },
        axisLine: { lineStyle: { color: '#1e2633' } },
      },
      series: [
        {
          type: 'radar',
          symbol: 'rect',
          symbolSize: 4,
          lineStyle: { color: lineColor, width: 1.5 },
          itemStyle: { color: lineColor },
          areaStyle: { color: areaFill },
          data: [{ value: axes.map((a) => a.value ?? 0), name: '情绪维度' }],
        },
      ],
    });

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [data, visibleSections.middle]);

  useEffect(() => {
    return () => {
      if (radarChartRef.current) {
        radarChartRef.current.dispose();
        radarChartRef.current = null;
      }
    };
  }, []);

  const indices = data?.indices ?? [];
  const breadth = data?.breadth;
  const undertake = data?.undertake;
  const buckets = data?.distributionBuckets ?? [];
  const maxBucketCount = useMemo(
    () => Math.max(1, ...buckets.map((b) => b.count || 0)),
    [buckets]
  );

  const upCount = breadth?.up ?? 0;
  const flatCount = breadth?.flat ?? 0;
  const downCount = breadth?.down ?? 0;
  const totalStocks = Math.max(1, breadth?.total ?? upCount + flatCount + downCount);

  const downRatioPct = (downCount / totalStocks) * 100;
  const flatRatioPct = (flatCount / totalStocks) * 100;
  const upRatioPct = (upCount / totalStocks) * 100;

  const tempScore = data?.temperature?.score ?? data?.sentimentRadar?.score ?? 0;
  const tempLabel =
    data?.temperature?.label ?? (tempScore >= 65 ? '偏热' : tempScore >= 45 ? '中性' : '偏冷');

  const tiers = data?.ladderSummary?.tiers ?? [];
  const topFutureMovers = useMemo(() => {
    const list = pandaPm?.futuresQuotes ?? [];
    return [...list].sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0)).slice(0, 4);
  }, [pandaPm]);

  const conceptRows = useMemo(() => {
    const lead = (data?.conceptHot?.leading ?? []).slice(0, 4).map((x) => ({ ...x, side: '领涨' as const }));
    const lag = (data?.conceptHot?.lagging ?? []).slice(0, 4).map((x) => ({ ...x, side: '领跌' as const }));
    return [...lead, ...lag];
  }, [data]);

  const industryRows = useMemo(() => {
    const lead = (data?.industryHot?.leading ?? []).slice(0, 4).map((x) => ({ ...x, side: '领涨' as const }));
    const lag = (data?.industryHot?.lagging ?? []).slice(0, 4).map((x) => ({ ...x, side: '领跌' as const }));
    return [...lead, ...lag];
  }, [data]);

  const renderSectorTable = (
    rows: (SectorHotItem & { side: '领涨' | '领跌' })[],
    navTab: 'concept' | 'industry'
  ) => (
    <div className="overflow-auto flex-1">
      <table className="w-table">
        <thead>
          <tr>
            <th className="text-left w-10">方向</th>
            <th className="text-left">板块名称</th>
            <th className="text-right">涨跌幅</th>
            <th className="text-right">家数</th>
            <th className="text-left">领涨标的</th>
            <th className="text-right">领涨%</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((item, idx) => (
              <tr
                key={`${item.side}-${item.code}-${idx}`}
                onClick={() => onNavigate?.(navTab)}
                className="cursor-pointer"
              >
                <td>
                  <span
                    className={`px-1 py-0 text-[10px] font-medium border rounded-[2px] ${
                      item.side === '领涨'
                        ? 'text-[#ff3535] border-[#ff3535]/40 bg-[#ff3535]/10'
                        : 'text-[#00c853] border-[#00c853]/40 bg-[#00c853]/10'
                    }`}
                  >
                    {item.side}
                  </span>
                </td>
                <td className="text-[#e8edf5] font-medium truncate max-w-[110px]">{item.name}</td>
                <td className={`text-right font-mono font-semibold ${windColor(item.changePct)}`}>
                  {formatPct(item.changePct)}
                </td>
                <td className="text-right font-mono text-[#8b949e]">{item.stockCount ?? '--'}</td>
                <td>
                  {item.leaderName ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (item.leaderCode) {
                          onSelectStock(
                            item.leaderCode,
                            item.leaderName,
                            data?.resolvedDate || selectedDate
                          );
                        }
                      }}
                      className="text-[#4da3ff] hover:underline truncate max-w-[80px] inline-block align-middle"
                    >
                      {item.leaderName}
                    </button>
                  ) : (
                    <span className="text-[#8b949e]">--</span>
                  )}
                </td>
                <td className={`text-right font-mono ${windColor(item.leaderChangePct)}`}>
                  {item.leaderChangePct !== undefined ? formatPct(item.leaderChangePct) : '--'}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="text-center text-[#8b949e] py-6">
                暂无板块排名数据
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="min-h-full bg-[#222832] flex flex-col gap-[1px] text-[#dfe6f0]">
      {/* Top 28px Wind Ribbon */}
      <div className="bg-[#161b24] px-2.5 h-7 flex items-center justify-between gap-2 text-[11px] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-title-bar">市场全貌 · 早期雷达</span>
          <span
            className={`px-1.5 py-0 border rounded-[2px] font-mono font-semibold ${
              tempScore >= 65
                ? 'text-[#ff3535] border-[#ff3535]/40 bg-[#ff3535]/10'
                : tempScore >= 45
                  ? 'text-[#f0b90b] border-[#f0b90b]/40 bg-[#f0b90b]/10'
                  : 'text-[#00c853] border-[#00c853]/40 bg-[#00c853]/10'
            }`}
          >
            市场温度 {tempLabel} {tempScore}
          </span>
          <span className="hidden xl:inline text-[#7d8796] font-mono">
            更新 {data?.updatedAt || '--'}
          </span>
          <span className="hidden lg:inline text-[#2b3444]">|</span>
          <button
            type="button"
            onClick={() => onNavigate?.('panda-pm')}
            className="hidden lg:inline-flex items-center gap-1.5 text-[#f0b90b] hover:text-[#ff9500] font-mono truncate"
          >
            <span>[PandaAI×期货PM]</span>
            <span className="text-[#8b95a5]">
              因子:{pandaPm?.summary?.totalMinedFactors ?? '--'}
            </span>
            {topFutureMovers[0] && (
              <span>
                {topFutureMovers[0].name}{' '}
                <span className={windColor(topFutureMovers[0].changePct)}>
                  {formatPct(topFutureMovers[0].changePct)}
                </span>
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedDate(val);
              fetchDashboard(val);
            }}
            className="h-5 px-1.5 bg-[#0e1117] border border-[#252c38] rounded-[2px] text-[11px] font-mono text-[#dfe6f0] focus:outline-none [color-scheme:dark]"
          />
          <span className="inline-flex items-center gap-1 px-1.5 h-5 bg-[#0e1117] border border-[#252c38] rounded-[2px] font-mono">
            <span
              className={`w-1.5 h-1.5 ${data?.isMarketOpen ? 'bg-[#00c853]' : 'bg-[#4da3ff]'}`}
            />
            <span>{data?.isMarketOpen ? '实时' : '收盘'}</span>
          </span>
          <button
            type="button"
            onClick={() => fetchDashboard(selectedDate)}
            disabled={loading}
            className="h-5 px-2 bg-[#151a23] hover:bg-[#1b2230] border border-[#252c38] rounded-[2px] text-[#dfe6f0] disabled:opacity-50"
          >
            {loading ? '刷新中' : '重载'}
          </button>
          <button
            type="button"
            onClick={() => setShowCustomLayout((v) => !v)}
            className={`h-5 px-2 border rounded-[2px] ${
              showCustomLayout
                ? 'bg-[#0e1117] border-[#ff8800] text-[#ff9500]'
                : 'bg-[#151a23] hover:bg-[#1b2230] border-[#252c38] text-[#8b95a5]'
            }`}
          >
            布局
          </button>
        </div>
      </div>

      {showCustomLayout && (
        <div className="bg-[#11151d] px-2.5 py-1 flex items-center gap-2 text-[11px]">
          <span className="text-[#ff9500] font-semibold">显示区块:</span>
          {(
            [
              ['strip', '指数与广度条'],
              ['middle', '承接/分布/雷达/梯队'],
              ['bottom', '概念/行业/预警表'],
            ] as [SectionKey, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => toggleSection(k)}
              className={`px-2 py-0.5 border rounded-[2px] ${
                visibleSections[k]
                  ? 'bg-[#0e1117] border-[#ff8800] text-[#dfe6f0]'
                  : 'bg-[#151a23] border-[#252c38] text-[#7d8796]'
              }`}
            >
              {visibleSections[k] ? '[Y] ' : '[N] '}
              {label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-[#1c1114] px-3 py-1.5 text-xs text-[#ff3535] flex items-center justify-between">
          <span>数据请求异常: {error}</span>
          <button
            type="button"
            onClick={() => fetchDashboard(selectedDate)}
            className="px-2 py-0.5 border border-[#ff3535]/50 rounded-[2px] text-[#ff3535]"
          >
            重试
          </button>
        </div>
      )}

      {/* Top Unified Horizontal Data Strip: 4 Indices + 6 Breadth Cells */}
      {visibleSections.strip && (
        <div className="grid grid-cols-2 sm:grid-cols-5 xl:grid-cols-10 gap-[1px] bg-[#222832]">
          {/* 4 Indices */}
          {(indices.length > 0
            ? indices
            : [
                { code: '000001.SH', name: '上证指数', price: 0, change: 0, changePct: 0 },
                { code: '399001.SZ', name: '深证成指', price: 0, change: 0, changePct: 0 },
                { code: '399006.SZ', name: '创业板指', price: 0, change: 0, changePct: 0 },
                { code: '000680.SH', name: '科创综指', price: 0, change: 0, changePct: 0 },
              ]
          )
            .slice(0, 4)
            .map((idx) => (
              <div
                key={idx.code}
                onClick={() => onSelectStock(idx.code, idx.name, data?.resolvedDate || selectedDate)}
                className="bg-[#0e1117] hover:bg-[#1b2434] px-2 py-1.5 cursor-pointer flex items-center justify-between gap-1"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-semibold text-[#e8edf5] truncate">
                      {idx.name}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
                    <span className={`text-xs font-bold ${windColor(idx.changePct)}`}>
                      {loading && !data ? '--' : (idx.price ?? 0).toFixed(2)}
                    </span>
                    <span className={`text-[11px] ${windColor(idx.changePct)}`}>
                      {loading && !data ? '--' : formatPct(idx.changePct)}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-[#e5b567]">{idx.code}</div>
                </div>
                <MicroIndexSparkline idx={idx} />
              </div>
            ))}

          {/* 6 Breadth Cells */}
          <div className="bg-[#0e1117] px-2 py-1.5 flex flex-col justify-between">
            <div className="text-[10px] text-[#8b95a5]">涨 / 平 / 跌</div>
            <div className="text-xs font-mono tabular-nums font-bold">
              <span className="text-[#ff3535]">{upCount}</span>
              <span className="text-[#566070]">/</span>
              <span className="text-[#8b949e]">{flatCount}</span>
              <span className="text-[#566070]">/</span>
              <span className="text-[#00c853]">{downCount}</span>
            </div>
            <div className="text-[10px] font-mono text-[#7d8796]">
              涨率 {(breadth?.upRate ?? 0).toFixed(1)}%
            </div>
          </div>

          <div className="bg-[#0e1117] px-2 py-1.5 flex flex-col justify-between">
            <div className="text-[10px] text-[#8b95a5]">强 / 弱 (≥3%)</div>
            <div className="text-xs font-mono tabular-nums font-bold">
              <span className="text-[#ff3535]">{breadth?.strongCount ?? 0}</span>
              <span className="text-[#566070] mx-1">/</span>
              <span className="text-[#00c853]">{breadth?.weakCount ?? 0}</span>
            </div>
            <div className="text-[10px] font-mono text-[#7d8796]">多空强弱比</div>
          </div>

          <div className="bg-[#0e1117] px-2 py-1.5 flex flex-col justify-between">
            <div className="text-[10px] text-[#8b95a5]">涨停 / 跌停</div>
            <div className="text-xs font-mono tabular-nums font-bold">
              <span className="text-[#ff3535]">{breadth?.limitUp ?? 0}</span>
              <span className="text-[#566070] mx-1">/</span>
              <span className="text-[#00c853]">{breadth?.limitDown ?? 0}</span>
            </div>
            <div className="text-[10px] font-mono text-[#4da3ff]">
              封板 {(breadth?.sealRate ?? 0).toFixed(0)}%
            </div>
          </div>

          <div className="bg-[#0e1117] px-2 py-1.5 flex flex-col justify-between">
            <div className="text-[10px] text-[#8b95a5]">最高连板</div>
            <div className="text-xs font-mono tabular-nums font-bold text-[#ff8800]">
              {breadth?.maxStreak ?? 0}板
            </div>
            <div className="text-[10px] text-[#4da3ff] truncate">
              {(breadth?.maxStreakStocks ?? []).length > 0
                ? breadth!.maxStreakStocks.map((s, idx) => (
                    <React.Fragment key={s.code}>
                      {idx > 0 && <span className="text-[#566070] mx-0.5">·</span>}
                      <button
                        type="button"
                        onClick={() => onSelectStock(s.code, s.name, data?.resolvedDate || selectedDate)}
                        className="hover:underline"
                      >
                        {s.name}
                      </button>
                    </React.Fragment>
                  ))
                : '--'}
            </div>
          </div>

          <div className="bg-[#0e1117] px-2 py-1.5 flex flex-col justify-between">
            <div className="text-[10px] text-[#8b95a5]">两市成交额</div>
            <div className="text-xs font-mono tabular-nums font-bold text-[#f0b90b]">
              {formatAmount(breadth?.totalAmount)}
            </div>
            <div className="text-[10px] font-mono text-[#7d8796] truncate">
              均 {formatAmount(breadth?.avgAmount)}
            </div>
          </div>

          <div className="bg-[#0e1117] px-2 py-1.5 flex flex-col justify-between">
            <div className="text-[10px] text-[#8b95a5]">换手 / 量比</div>
            <div className="text-xs font-mono tabular-nums font-bold text-[#4da3ff]">
              {(breadth?.avgTurnover ?? 0).toFixed(1)}% / {(breadth?.volumeRatio ?? 0).toFixed(2)}
            </div>
            <div className="text-[10px] font-mono text-[#7d8796] truncate">
              高换手 {breadth?.highTurnoverCount ?? 0} · 放量 {(breadth?.volExpansionRatio ?? 0).toFixed(0)}%
            </div>
          </div>
        </div>
      )}

      {/* Middle Docked 3-Column Split */}
      {visibleSections.middle && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-[1px] bg-[#222832]">
          {/* Left: 大盘承接分析 V1.1 */}
          <div className="xl:col-span-4 bg-[#0e1117] flex flex-col">
            <div className="w-header">
              <span className="w-title-bar">大盘承接分析 V1.1 · 15分钟主判断</span>
              <button
                type="button"
                onClick={() => setDetailModalOpen(true)}
                className="text-[11px] text-[#4da3ff] hover:text-[#dfe6f0]"
              >
                详细报告
              </button>
            </div>
            <div className="p-2 space-y-2 flex-1 flex flex-col justify-between">
              <div className="bg-[#11151d] border border-[#222832] px-2.5 py-2 flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] text-[#8b95a5]">当前承接状态</div>
                  <div
                    className={`text-lg font-bold tracking-tight ${undertakeColorClass(
                      undertake?.status ?? ''
                    )}`}
                  >
                    {undertake?.status ?? '承接待确认'}
                  </div>
                  <div className="text-[11px] text-[#cfd7e3] mt-0.5 leading-snug">
                    {undertake?.summary ?? '正在评估指数、量能与广度承接力度...'}
                  </div>
                </div>
                <span className="text-[10px] font-mono text-[#7d8796] shrink-0">
                  {undertake?.note ?? (data?.isMarketOpen ? '盘中实时' : '收盘保留')}
                </span>
              </div>

              {/* 3 Timeframes */}
              <div className="grid grid-cols-3 gap-[1px] bg-[#222832] border border-[#222832]">
                {(undertake?.timeframes ?? [
                  { label: '5分钟', subtitle: '短时止跌', status: '承接待确认', window: '14:55-15:00', trend: 'flat' as const },
                  { label: '15分钟', subtitle: '主要判断', status: '承接减弱', window: '14:45-15:00', trend: 'down' as const },
                  { label: '30分钟', subtitle: '持续验证', status: '承接减弱', window: '14:30-15:00', trend: 'down' as const },
                ]).map((tf) => (
                  <div key={tf.label} className="bg-[#11151d] p-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-[#e8edf5]">{tf.label}</span>
                      {tf.deltaPct !== undefined && (
                        <span className={`font-mono ${windColor(tf.deltaPct)}`}>
                          {formatPct(tf.deltaPct)}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#7d8796]">{tf.subtitle}</div>
                    <div className="my-1">
                      <MicroTrendLine trend={tf.trend} />
                    </div>
                    <div className={`text-[11px] font-semibold ${undertakeColorClass(tf.status)}`}>
                      {tf.status}
                    </div>
                    <div className="text-[10px] font-mono text-[#7d8796]">{tf.window}</div>
                  </div>
                ))}
              </div>

              {/* Evidence Table */}
              <table className="w-table border border-[#222832]">
                <thead>
                  <tr>
                    <th className="text-left w-16">判断依据</th>
                    <th className="text-left">实时观测值</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-[#8b95a5]">指数表现</td>
                    <td className="font-mono text-[#dfe6f0] whitespace-normal py-1">
                      {undertake?.evidence?.indexPerf ?? '--'}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-[#8b95a5]">成交支持</td>
                    <td className="font-mono text-[#dfe6f0] whitespace-normal py-1">
                      {undertake?.evidence?.volumeSupport ?? '--'}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-[#8b95a5]">市场广度</td>
                    <td className="font-mono text-[#dfe6f0] whitespace-normal py-1">
                      {undertake?.evidence?.marketBreadth ?? '--'}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-[#8b95a5]">情绪验证</td>
                    <td className="font-mono text-[#dfe6f0] whitespace-normal py-1">
                      {undertake?.evidence?.sentimentVerify ?? '--'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Center: 涨跌分布 + 市场情绪雷达 + 趋势/短线监控矩阵 */}
          <div className="xl:col-span-5 bg-[#222832] flex flex-col gap-[1px]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-[#222832] flex-1">
              {/* Distribution */}
              <div className="bg-[#0e1117] flex flex-col">
                <div className="w-header">
                  <span className="w-title-bar">涨跌分布 / 广度</span>
                  <span className="text-[11px] font-mono text-[#7d8796]">
                    {breadth?.total ?? totalStocks}只
                  </span>
                </div>
                <div className="p-2 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="h-32 flex items-end justify-between gap-1 pt-4 pb-1 border-b border-[#222832]">
                      {buckets.map((b) => {
                        const h = Math.max(3, Math.round(((b.count || 0) / maxBucketCount) * 82));
                        const color = b.isFlat
                          ? 'bg-[#6b7280]'
                          : b.isPositive
                            ? 'bg-[#ff3535]'
                            : 'bg-[#00c853]';
                        return (
                          <div key={b.label} className="flex-1 flex flex-col items-center justify-end h-full">
                            <span className="text-[9px] font-mono tabular-nums text-[#cfd7e3] mb-0.5">
                              {b.count}
                            </span>
                            <div className={`w-full max-w-[14px] ${color}`} style={{ height: `${h}px` }} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between gap-0.5 mt-1 mb-2">
                      {buckets.map((b) => (
                        <span key={b.label} className="flex-1 text-center text-[9px] font-mono text-[#7d8796] truncate">
                          {b.label}
                        </span>
                      ))}
                    </div>

                    <div className="h-1.5 w-full flex bg-[#151a23] mb-1">
                      <div className="bg-[#00c853] h-full" style={{ width: `${downRatioPct}%` }} />
                      <div className="bg-[#6b7280] h-full" style={{ width: `${flatRatioPct}%` }} />
                      <div className="bg-[#ff3535] h-full" style={{ width: `${upRatioPct}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                      <span className="text-[#00c853]">跌 {downCount}</span>
                      <span className="text-[#8b949e]">平 {flatCount}</span>
                      <span className="text-[#ff3535]">涨 {upCount}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-[1px] bg-[#222832] border border-[#222832] mt-2">
                    <div className="bg-[#11151d] px-2 py-1 flex items-center justify-between">
                      <span className="text-[11px] text-[#8b95a5]">均值</span>
                      <span className={`text-xs font-mono font-semibold ${windColor(breadth?.avgChangePct)}`}>
                        {formatPct(breadth?.avgChangePct)}
                      </span>
                    </div>
                    <div className="bg-[#11151d] px-2 py-1 flex items-center justify-between">
                      <span className="text-[11px] text-[#8b95a5]">中位</span>
                      <span className={`text-xs font-mono font-semibold ${windColor(breadth?.medianChangePct)}`}>
                        {formatPct(breadth?.medianChangePct)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sentiment Radar */}
              <div className="bg-[#0e1117] flex flex-col">
                <div className="w-header">
                  <span className="w-title-bar">情绪雷达</span>
                  <span className="text-[11px] font-mono text-[#dfe6f0]">
                    评分 <strong className="text-[#ff8800]">{data?.sentimentRadar?.score ?? 0}</strong>
                  </span>
                </div>
                <div className="relative flex-1 min-h-[200px] flex items-center justify-center">
                  <div ref={radarRef} className="w-full h-48" />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center pt-2">
                    <span className="text-lg font-mono font-bold text-[#e8edf5] bg-[#0e1117]/80 px-1">
                      {data?.sentimentRadar?.score ?? '--'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Matrix: 趋势强度 + 实用监控 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-[#222832]">
              <div className="bg-[#0e1117]">
                <div className="w-header">
                  <span className="w-title-bar">趋势强度矩阵</span>
                  <span className="text-[10px] font-mono text-[#7d8796]">均线结构</span>
                </div>
                <div className="grid grid-cols-3 gap-[1px] bg-[#222832]">
                  <div className="bg-[#11151d] px-2 py-1.5">
                    <div className="text-[10px] text-[#8b95a5]">站上MA5</div>
                    <div className="text-xs font-mono font-bold text-[#4da3ff]">
                      {(data?.trendStrength?.aboveMa5Pct ?? 0).toFixed(0)}%
                    </div>
                  </div>
                  <div className="bg-[#11151d] px-2 py-1.5">
                    <div className="text-[10px] text-[#8b95a5]">站上MA20</div>
                    <div className="text-xs font-mono font-bold text-[#4da3ff]">
                      {(data?.trendStrength?.aboveMa20Pct ?? 0).toFixed(0)}%
                    </div>
                  </div>
                  <div className="bg-[#11151d] px-2 py-1.5">
                    <div className="text-[10px] text-[#8b95a5]">站上MA60</div>
                    <div className="text-xs font-mono font-bold text-[#4da3ff]">
                      {(data?.trendStrength?.aboveMa60Pct ?? 0).toFixed(0)}%
                    </div>
                  </div>
                  <div className="bg-[#11151d] px-2 py-1.5">
                    <div className="text-[10px] text-[#8b95a5]">60日新高</div>
                    <div className="text-xs font-mono font-bold text-[#ff3535]">
                      {data?.trendStrength?.high60Count ?? 0}
                    </div>
                  </div>
                  <div className="bg-[#11151d] px-2 py-1.5">
                    <div className="text-[10px] text-[#8b95a5]">60日新低</div>
                    <div className="text-xs font-mono font-bold text-[#00c853]">
                      {data?.trendStrength?.low60Count ?? 0}
                    </div>
                  </div>
                  <div className="bg-[#11151d] px-2 py-1.5">
                    <div className="text-[10px] text-[#8b95a5]">高低比</div>
                    <div className="text-xs font-mono font-bold text-[#f0b90b]">
                      {(data?.trendStrength?.highLowRatioPct ?? 0).toFixed(0)}%
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-[#0e1117]">
                <div className="w-header">
                  <span className="w-title-bar">短线监控指标</span>
                  <span className="text-[10px] font-mono text-[#7d8796]">盘口统计</span>
                </div>
                <div className="grid grid-cols-3 gap-[1px] bg-[#222832]">
                  <div className="bg-[#11151d] px-2 py-1.5">
                    <div className="text-[10px] text-[#8b95a5]">炸板家数</div>
                    <div className="text-xs font-mono font-bold text-[#f0b90b]">
                      {data?.practicalMonitor?.brokenCount ?? 0}
                    </div>
                  </div>
                  <div className="bg-[#11151d] px-2 py-1.5">
                    <div className="text-[10px] text-[#8b95a5]">跌停家数</div>
                    <div className="text-xs font-mono font-bold text-[#00c853]">
                      {data?.practicalMonitor?.limitDownCount ?? 0}
                    </div>
                  </div>
                  <div className="bg-[#11151d] px-2 py-1.5">
                    <div className="text-[10px] text-[#8b95a5]">站上MA60</div>
                    <div className="text-xs font-mono font-bold text-[#4da3ff]">
                      {(data?.practicalMonitor?.aboveMa60Pct ?? 0).toFixed(0)}%
                    </div>
                  </div>
                  <div className="bg-[#11151d] px-2 py-1.5">
                    <div className="text-[10px] text-[#8b95a5]">新高/新低</div>
                    <div className="text-xs font-mono font-bold text-[#dfe6f0]">
                      {data?.practicalMonitor?.high60Count ?? 0}/{data?.practicalMonitor?.low60Count ?? 0}
                    </div>
                  </div>
                  <div className="bg-[#11151d] px-2 py-1.5">
                    <div className="text-[10px] text-[#8b95a5]">高换手数</div>
                    <div className="text-xs font-mono font-bold text-[#f0b90b]">
                      {data?.practicalMonitor?.highTurnoverCount ?? 0}
                    </div>
                  </div>
                  <div className="bg-[#11151d] px-2 py-1.5">
                    <div className="text-[10px] text-[#8b95a5]">放量占比</div>
                    <div className="text-xs font-mono font-bold text-[#4da3ff]">
                      {(data?.practicalMonitor?.volExpansionRatio ?? 0).toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: 实时涨停梯队表 & PandaAI×期货PM跨市信号栏 */}
          <div className="xl:col-span-3 bg-[#222832] flex flex-col gap-[1px]">
            <div className="bg-[#0e1117] flex-1 flex flex-col">
              <div className="w-header">
                <button
                  type="button"
                  onClick={() => onNavigate?.('ladder')}
                  className="w-title-bar hover:text-[#ff9500]"
                >
                  实时涨停梯队
                </button>
                <span className="text-[11px] font-mono">
                  涨停 <strong className="text-[#ff3535]">{data?.ladderSummary?.limitUpCount ?? 0}</strong>{' '}
                  · 封板 <strong className="text-[#4da3ff]">{(data?.ladderSummary?.sealRate ?? 0).toFixed(0)}%</strong>
                </span>
              </div>
              <div className="overflow-auto flex-1">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-left w-12">高度</th>
                      <th className="text-right w-10">家数</th>
                      <th className="text-left">代表标的</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.length > 0 ? (
                      tiers.slice(0, 6).map((t) => (
                        <tr key={t.streak}>
                          <td
                            className={`font-mono font-bold ${
                              t.streak >= 4 ? 'text-[#ff3535]' : 'text-[#4da3ff]'
                            }`}
                          >
                            {t.streak}板
                          </td>
                          <td className="text-right font-mono text-[#f0b90b]">{t.count}</td>
                          <td className="whitespace-normal py-1">
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                              {(t.stocks ?? []).slice(0, 5).map((s) => (
                                <button
                                  key={s.code}
                                  type="button"
                                  onClick={() =>
                                    onSelectStock(s.code, s.name, data?.resolvedDate || selectedDate)
                                  }
                                  className="text-[11px] text-[#e8edf5] hover:text-[#ff9500]"
                                >
                                  {s.name}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="text-center text-[#8b949e] py-6">
                          暂无连板梯队
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* PandaAI × 期货PM 跨市信号栏 */}
            <div className="bg-[#0e1117] flex flex-col">
              <div className="w-header">
                <button
                  type="button"
                  onClick={() => onNavigate?.('panda-pm')}
                  className="w-title-bar hover:text-[#f0b90b]"
                >
                  PandaAI × 期货PM 跨市信号
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate?.('panda-pm')}
                  className="text-[11px] text-[#f0b90b] hover:underline font-mono"
                >
                  进入F10
                </button>
              </div>
              <table className="w-table">
                <thead>
                  <tr>
                    <th className="text-left">合约</th>
                    <th className="text-left">品种</th>
                    <th className="text-right">最新价</th>
                    <th className="text-right">涨跌%</th>
                    <th className="text-left">PM信号</th>
                  </tr>
                </thead>
                <tbody>
                  {topFutureMovers.length > 0 ? (
                    topFutureMovers.map((f) => (
                      <tr
                        key={f.symbol}
                        onClick={() => onNavigate?.('panda-pm')}
                        className="cursor-pointer"
                      >
                        <td className="font-mono text-[#e5b567]">{f.symbol}</td>
                        <td className="text-[#e8edf5]">{f.name}</td>
                        <td className={`text-right font-mono ${windColor(f.changePct)}`}>
                          {(f.price ?? 0).toFixed(2)}
                        </td>
                        <td className={`text-right font-mono font-semibold ${windColor(f.changePct)}`}>
                          {formatPct(f.changePct)}
                        </td>
                        <td className="text-[11px] text-[#f0b90b] truncate max-w-[72px]">
                          {f.pmSignal || '--'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="text-center text-[#8b949e] py-3">
                        点击进入 PandaAI×期货PM 终端
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Docked 3-Column Dense Tables */}
      {visibleSections.bottom && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-[1px] bg-[#222832] flex-1">
          {/* Concept Table */}
          <div className="bg-[#0e1117] flex flex-col">
            <div className="w-header">
              <button
                type="button"
                onClick={() => onNavigate?.('concept')}
                className="w-title-bar hover:text-[#ff9500]"
              >
                领涨 / 领跌概念排名表
              </button>
              <span className="text-[10px] font-mono text-[#7d8796]">
                {data?.conceptHot?.sourceNote ?? '板块均值'}
              </span>
            </div>
            {renderSectorTable(conceptRows, 'concept')}
          </div>

          {/* Industry Table */}
          <div className="bg-[#0e1117] flex flex-col">
            <div className="w-header">
              <button
                type="button"
                onClick={() => onNavigate?.('industry')}
                className="w-title-bar hover:text-[#ff9500]"
              >
                领涨 / 领跌行业排名表
              </button>
              <span className="text-[10px] font-mono text-[#7d8796]">
                {data?.industryHot?.sourceNote ?? '通达信二级'}
              </span>
            </div>
            {renderSectorTable(industryRows, 'industry')}
          </div>

          {/* Live Alert Table */}
          <div className="bg-[#0e1117] flex flex-col">
            <div className="w-header">
              <button
                type="button"
                onClick={() => onNavigate?.('monitor')}
                className="w-title-bar hover:text-[#ff9500]"
              >
                实时预警流水表
              </button>
              <span className="text-[10px] font-mono text-[#f0b90b]">
                启用 {data?.monitorSummary?.enabledRules ?? 0}/{data?.monitorSummary?.totalRules ?? 0}
              </span>
            </div>
            <div className="px-2.5 py-1 bg-[#11151d] border-b border-[#222832] text-[11px] text-[#8b95a5] truncate">
              {data?.monitorSummary?.statusText ?? '实时规则监控待命'}
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-table">
                <thead>
                  <tr>
                    <th className="text-left w-14">时间</th>
                    <th className="text-left w-16">标的</th>
                    <th className="text-left w-20">规则</th>
                    <th className="text-left">触发详情</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.monitorSummary?.recentAlerts ?? []).length > 0 ? (
                    data!.monitorSummary.recentAlerts.slice(0, 8).map((a) => (
                      <tr
                        key={a.id}
                        onClick={() =>
                          onSelectStock(a.code, a.name, data?.resolvedDate || selectedDate)
                        }
                        className="cursor-pointer"
                      >
                        <td className="font-mono text-[#8b949e]">{a.time}</td>
                        <td className="text-[#e8edf5] font-medium">{a.name}</td>
                        <td
                          className={`text-[11px] ${
                            a.level === 'critical'
                              ? 'text-[#ff3535]'
                              : a.level === 'warn'
                                ? 'text-[#f0b90b]'
                                : 'text-[#4da3ff]'
                          }`}
                        >
                          {a.ruleName}
                        </td>
                        <td className="text-[#cfd7e3] truncate max-w-[180px]">{a.message}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="text-center text-[#8b949e] py-6">
                        暂无监控触发记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setDetailModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl bg-[#0e1117] border border-[#2a3342] border-t-2 border-t-[#ff8800]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-header">
              <span className="w-title-bar">大盘承接分析 V1.1 · 详细诊断报告</span>
              <button
                type="button"
                onClick={() => setDetailModalOpen(false)}
                className="text-xs text-[#8b95a5] hover:text-white font-mono"
              >
                [关闭]
              </button>
            </div>
            <div className="p-3 space-y-3 max-h-[75vh] overflow-y-auto text-xs">
              <div className="bg-[#11151d] border border-[#222832] p-2.5">
                <div className="text-[#8b95a5]">主结论（15分钟主判断）</div>
                <div className={`mt-1 text-lg font-bold ${undertakeColorClass(undertake?.status ?? '')}`}>
                  {undertake?.status ?? '承接待确认'}
                </div>
                <div className="mt-1 text-[#dfe6f0]">{undertake?.summary}</div>
              </div>

              <table className="w-table border border-[#222832]">
                <thead>
                  <tr>
                    <th className="text-left">周期</th>
                    <th className="text-left">维度</th>
                    <th className="text-left">承接状态</th>
                    <th className="text-left">时间窗口</th>
                  </tr>
                </thead>
                <tbody>
                  {(undertake?.timeframes ?? []).map((tf) => (
                    <tr key={tf.label}>
                      <td className="font-mono font-semibold text-[#e8edf5]">{tf.label}</td>
                      <td className="text-[#8b95a5]">{tf.subtitle}</td>
                      <td className={`font-semibold ${undertakeColorClass(tf.status)}`}>{tf.status}</td>
                      <td className="font-mono text-[#7d8796]">{tf.window}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="bg-[#11151d] border border-[#222832] p-2.5 space-y-1.5 font-mono text-[11px]">
                <div className="text-[#ff9500] font-sans font-semibold">四维核心判断依据</div>
                <div>指数表现: {undertake?.evidence?.indexPerf}</div>
                <div>成交支持: {undertake?.evidence?.volumeSupport}</div>
                <div>市场广度: {undertake?.evidence?.marketBreadth}</div>
                <div>情绪验证: {undertake?.evidence?.sentimentVerify}</div>
              </div>

              {(undertake?.details ?? []).length > 0 && (
                <div className="bg-[#11151d] border border-[#222832] p-2.5 space-y-1">
                  <div className="text-[#ff9500] font-semibold">盘面拆解要点</div>
                  {undertake!.details!.map((line, i) => (
                    <div key={i} className="text-[#cfd7e3]">
                      {i + 1}. {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
