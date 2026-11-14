import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { RefreshCw, X } from 'lucide-react';
import { api, formatAmount, formatPct } from '../api/client';
import type { ConceptBoardItem, ConceptsResponse } from '../types/market';

interface ConceptAnalysisPageProps {
  onSelectStock: (code: string, name?: string, date?: string) => void;
}

const WIND_TOOLTIP_CSS = 'border-radius:0;box-shadow:none;';

function windColorClass(val?: number | null): string {
  if (val === undefined || val === null || val === 0) return 'text-[#8b949e]';
  return val > 0 ? 'text-[#ff3535]' : 'text-[#00c853]';
}

export default function ConceptAnalysisPage({ onSelectStock }: ConceptAnalysisPageProps) {
  const [data, setData] = useState<ConceptsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedConcept, setSelectedConcept] = useState<ConceptBoardItem | null>(null);

  const switchChartRef = useRef<HTMLDivElement | null>(null);

  const fetchConcepts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api.getConcepts();
      setData(res);
    } catch (err: any) {
      setError(err?.message || '加载概念轮动数据失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConcepts();
    const timer = setInterval(() => {
      fetchConcepts(true);
    }, 30000);
    return () => clearInterval(timer);
  }, [fetchConcepts]);

  const switchSeries = useMemo(() => data?.switchSeries ?? [], [data]);

  useEffect(() => {
    if (!switchChartRef.current || !switchSeries.length) return;
    const chart = echarts.init(switchChartRef.current);

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
        axisPointer: { lineStyle: { color: '#475569', type: 'dashed' } },
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return '';
          const idx = params[0].dataIndex;
          const pt = switchSeries[idx];
          if (!pt) return '';
          const idxColor = pt.indexPct >= 0 ? '#ff3535' : '#00c853';
          return `
            <div style="min-width:140px">
              <div style="color:#8b95a5;border-bottom:1px solid #252c38;padding-bottom:2px;margin-bottom:4px">${pt.time}</div>
              <div style="display:flex;justify-content:space-between;gap:10px">
                <span style="color:#8b95a5">切换强度:</span>
                <span style="color:#f0b90b;font-weight:700">${pt.switchRate.toFixed(2)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;gap:10px">
                <span style="color:#8b95a5">指数基准:</span>
                <span style="color:${idxColor};font-weight:700">${formatPct(pt.indexPct)}</span>
              </div>
            </div>`;
        },
      },
      grid: { top: 14, left: 36, right: 44, bottom: 22 },
      xAxis: {
        type: 'category',
        data: switchSeries.map((s) => s.time),
        axisLine: { lineStyle: { color: '#222832' } },
        axisTick: { show: false },
        axisLabel: { color: '#7d8796', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
      },
      yAxis: [
        {
          type: 'value',
          min: 0,
          max: 1,
          interval: 0.2,
          axisLine: { show: false },
          splitLine: { lineStyle: { color: '#1b212c', type: 'dashed' } },
          axisLabel: { color: '#7d8796', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
        },
        {
          type: 'value',
          axisLine: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: '#7d8796',
            fontSize: 10,
            fontFamily: 'JetBrains Mono, monospace',
            formatter: (v: number) => `${v.toFixed(1)}%`,
          },
        },
      ],
      series: [
        {
          name: '切换强度',
          type: 'line',
          yAxisIndex: 0,
          showSymbol: false,
          lineStyle: { color: '#f0b90b', width: 1.8 },
          data: switchSeries.map((s) => Number(s.switchRate.toFixed(3))),
        },
        {
          name: '指数涨跌',
          type: 'line',
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#4da3ff', width: 1.2, type: 'dashed' },
          data: switchSeries.map((s) => Number(s.indexPct.toFixed(2))),
        },
      ],
    };

    chart.setOption(option);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(switchChartRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [switchSeries]);

  const totalConcepts = (data?.kpis?.upCount ?? 0) + (data?.kpis?.downCount ?? 0);

  const renderLeaderboardPane = (
    title: string,
    items: ConceptBoardItem[],
    variant: 'leading' | 'lagging'
  ) => {
    const isLeading = variant === 'leading';
    return (
      <div className="bg-[#0e1117] flex flex-col min-h-0 overflow-hidden">
        <div className="w-header shrink-0">
          <span className="w-title-bar">
            <span className={isLeading ? 'text-[#ff3535]' : 'text-[#00c853]'}>{title}</span>
          </span>
          <span className="text-[11px] font-mono text-[#7d8796]">
            Top {items.length || 10} · 点击行查看龙头详情
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-table">
            <thead>
              <tr>
                <th className="text-center w-8">序</th>
                <th className="text-left">概念名称</th>
                <th className="text-left w-28">涨跌分布</th>
                <th className="text-right w-16">涨幅%</th>
                <th className="text-right">领涨标的 Top 3</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#7d8796]">
                    暂无板块数据
                  </td>
                </tr>
              ) : (
                items.map((item, idx) => {
                  const totalMembers = Math.max(1, (item.upCount ?? 0) + (item.downCount ?? 0));
                  const upRatio = Math.round(((item.upCount ?? 0) / totalMembers) * 100);
                  const downRatio = 100 - upRatio;

                  return (
                    <tr
                      key={`${item.code}-${item.name}`}
                      onClick={() => setSelectedConcept(item)}
                      className="cursor-pointer"
                    >
                      <td
                        className={`text-center font-mono font-bold ${
                          idx < 3
                            ? isLeading
                              ? 'text-[#ff8800]'
                              : 'text-[#00c853]'
                            : 'text-[#7d8796]'
                        }`}
                      >
                        {item.rank || idx + 1}
                      </td>
                      <td className="font-medium text-[#e8edf5] max-w-[130px] truncate">
                        {item.name}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <div className="w-14 h-1.5 bg-[#161b24] flex shrink-0">
                            <div className="h-full bg-[#ff3535]" style={{ width: `${upRatio}%` }} />
                            <div className="h-full bg-[#00c853]" style={{ width: `${downRatio}%` }} />
                          </div>
                          <span className="text-[10px] font-mono">
                            <span className="text-[#ff3535]">{item.upCount ?? 0}</span>/
                            <span className="text-[#00c853]">{item.downCount ?? 0}</span>
                          </span>
                        </div>
                      </td>
                      <td
                        className={`text-right font-mono font-semibold ${windColorClass(
                          item.changePct
                        )}`}
                      >
                        {formatPct(item.changePct)}
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-1 justify-end">
                          {(item.leaders ?? []).slice(0, 3).map((leader) => (
                            <button
                              key={leader.code}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectStock(leader.code, leader.name);
                              }}
                              className="px-1.5 py-0.5 bg-[#151a23] hover:bg-[#1f293a] border border-[#252c38] text-[11px] rounded-[2px] inline-flex items-center gap-1"
                              title={`${leader.name} (${leader.code}) 龙头分 ${leader.dragonScore}`}
                            >
                              <span className="text-[#dfe6f0] max-w-[56px] truncate">
                                {leader.name}
                              </span>
                              <span className={`font-mono ${windColorClass(leader.changePct)}`}>
                                {formatPct(leader.changePct)}
                              </span>
                            </button>
                          ))}
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
    );
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#222832] gap-[1px] overflow-hidden text-[#dfe6f0]">
      {/* Top 26px Wind Header Bar */}
      <div className="w-header shrink-0">
        <span className="w-title-bar">概念分析 · 题材轮动监控</span>
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span className="text-[#7d8796]">30s自动刷新 · {data?.updatedAt || 'LIVE'}</span>
          <button
            onClick={() => fetchConcepts(false)}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#11151d] hover:bg-[#1b2434] border border-[#252c38] text-[#dfe6f0] rounded-[2px]"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin text-[#ff8800]' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* Rotation Ticker Strips */}
      <div className="bg-[#0e1117] shrink-0 divide-y divide-[#181d26]">
        <div className="h-[26px] px-2.5 flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] font-bold text-[#ff8800] shrink-0 w-10">↑ 转强</span>
          <div className="flex items-center gap-1 flex-nowrap">
            {(data?.turningStrong ?? []).map((item, i) => (
              <span
                key={`${item.name}-${i}`}
                title={`${item.name} ${formatPct(item.changePct)}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#161b24] border border-[#3a2a14] text-[11px] whitespace-nowrap rounded-[2px]"
              >
                <span className="text-[#f0b90b] font-medium">{item.name}</span>
                <span className="font-mono text-[#7d8796]">{item.time}</span>
              </span>
            ))}
            {(!data?.turningStrong || data.turningStrong.length === 0) && (
              <span className="text-[11px] text-[#7d8796]">暂无实时转强信号</span>
            )}
          </div>
        </div>

        <div className="h-[26px] px-2.5 flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] font-bold text-[#00c853] shrink-0 w-10">↓ 转弱</span>
          <div className="flex items-center gap-1 flex-nowrap">
            {(data?.turningWeak ?? []).map((item, i) => (
              <span
                key={`${item.name}-${i}`}
                title={`${item.name} ${formatPct(item.changePct)}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#161b24] border border-[#163125] text-[11px] whitespace-nowrap rounded-[2px]"
              >
                <span className="text-[#00c853] font-medium">{item.name}</span>
                <span className="font-mono text-[#7d8796]">{item.time}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-[#1a1114] border-b border-[#ff3535] px-3 py-1.5 text-xs text-[#ff3535] flex items-center justify-between shrink-0">
          <span>{error}</span>
          <button onClick={() => fetchConcepts(false)} className="underline">
            重试
          </button>
        </div>
      )}

      {/* Upper Split: Switch Chart + Momentum Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-[1px] bg-[#222832] shrink-0">
        <div className="lg:col-span-6 bg-[#0e1117] flex flex-col">
          <div className="w-header">
            <span className="w-title-bar">切换强度 (1h 领涨梯队换血率)</span>
            <span className="text-[11px] font-mono text-[#7d8796]">
              {totalConcepts || 269}概念 · 黄=切换率 / 蓝虚=指数(右轴)
            </span>
          </div>
          <div ref={switchChartRef} className="w-full h-[205px]" />
        </div>

        <div className="lg:col-span-6 bg-[#0e1117] flex flex-col">
          <div className="w-header">
            <span className="w-title-bar">综合分前10 · 1h排名动量</span>
            <span className="text-[11px] text-[#7d8796]">↑切入 ↓退潮 (相对1h前)</span>
          </div>
          <div className="overflow-x-auto max-h-[205px]">
            <table className="w-table">
              <thead>
                <tr>
                  <th className="text-left">概念</th>
                  <th className="text-right">现涨幅</th>
                  <th className="text-right">1h前</th>
                  <th className="text-right">排名变化</th>
                  <th className="text-right">综合分</th>
                </tr>
              </thead>
              <tbody>
                {(data?.momentumTable ?? []).slice(0, 7).map((row) => (
                  <tr key={`${row.code}-${row.name}`}>
                    <td className="font-medium text-[#e8edf5] max-w-[140px] truncate">
                      {row.name}
                    </td>
                    <td className={`text-right font-mono ${windColorClass(row.changePct)}`}>
                      {formatPct(row.changePct)}
                    </td>
                    <td className={`text-right font-mono ${windColorClass(row.prev1hPct)}`}>
                      {formatPct(row.prev1hPct)}
                    </td>
                    <td className="text-right font-mono">
                      {row.rankChange > 0 ? (
                        <span className="text-[#ff3535]">↑{row.rankChange}</span>
                      ) : row.rankChange < 0 ? (
                        <span className="text-[#00c853]">↓{Math.abs(row.rankChange)}</span>
                      ) : (
                        <span className="text-[#7d8796]">-</span>
                      )}
                    </td>
                    <td className="text-right font-mono text-[#f0b90b]">
                      {Math.round(row.score)}分
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 5-Cell Unified KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-[1px] bg-[#222832] shrink-0">
        <div className="bg-[#11151d] px-3 py-2 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-[#7d8796]">最强主线</div>
            <div className="text-xs font-bold text-[#ff3535] truncate max-w-[120px]">
              {data?.kpis?.strongestMainline?.name || '-'}
            </div>
          </div>
          <div className="text-right font-mono">
            <div className="text-xs font-bold text-[#ff3535]">
              {formatPct(data?.kpis?.strongestMainline?.changePct)}
            </div>
            <div className="text-[10px] text-[#8b95a5]">
              {data?.kpis?.strongestMainline?.leader || '-'}
            </div>
          </div>
        </div>

        <div className="bg-[#11151d] px-3 py-2 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-[#7d8796]">最大风险</div>
            <div className="text-xs font-bold text-[#00c853] truncate max-w-[120px]">
              {data?.kpis?.biggestRisk?.name || '-'}
            </div>
          </div>
          <div className="text-right font-mono text-xs font-bold text-[#00c853]">
            {formatPct(data?.kpis?.biggestRisk?.changePct)}
          </div>
        </div>

        <div className="bg-[#11151d] px-3 py-2 flex items-center justify-between">
          <span className="text-[11px] text-[#7d8796]">涨跌板块</span>
          <div className="font-mono text-sm font-bold">
            <span className="text-[#ff3535]">{data?.kpis?.upCount ?? 0}</span>
            <span className="text-[#566070] mx-1">/</span>
            <span className="text-[#00c853]">{data?.kpis?.downCount ?? 0}</span>
          </div>
        </div>

        <div className="bg-[#11151d] px-3 py-2 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-[#7d8796]">资金活跃</div>
            <div className="text-xs font-semibold text-[#dfe6f0] truncate max-w-[110px]">
              {data?.leading?.[0]?.name || '核心主线'}
            </div>
          </div>
          <div className="text-right font-mono">
            <div className="text-xs font-bold text-[#f0b90b]">
              {data?.leading?.[0]?.amount
                ? formatAmount(data.leading[0].amount)
                : `${(data?.kpis?.activeRate ?? 0).toFixed(1)}%`}
            </div>
            <div className="text-[10px] text-[#7d8796]">
              活跃 {(data?.kpis?.activeRate ?? 0).toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="bg-[#11151d] px-3 py-2 flex items-center justify-between col-span-2 md:col-span-1">
          <div>
            <div className="text-[11px] text-[#7d8796]">龙头算法</div>
            <div className="text-[11px] text-[#dfe6f0] truncate">
              {data?.kpis?.algoNote || '强势 + 承接 + 容量'}
            </div>
          </div>
          <span className="font-mono text-xs font-bold text-[#e5b567]">6因子</span>
        </div>
      </div>

      {/* Bottom 2-Column Leaderboard */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-[1px] bg-[#222832] flex-1 min-h-0">
        {renderLeaderboardPane('领涨主线', data?.leading ?? [], 'leading')}
        {renderLeaderboardPane('领跌方向', data?.lagging ?? [], 'lagging')}
      </div>

      {/* Sharp Wind Concept Detail Popup Window */}
      {selectedConcept && (
        <div
          className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setSelectedConcept(null)}
        >
          <div
            className="w-full max-w-2xl bg-[#0e1117] border border-[#ff8800] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-header">
              <div className="flex items-center gap-2">
                <span className="w-title-bar">{selectedConcept.name}</span>
                <span className="font-mono text-[11px] text-[#e5b567]">{selectedConcept.code}</span>
                <span
                  className={`font-mono text-xs font-bold ${windColorClass(
                    selectedConcept.changePct
                  )}`}
                >
                  {formatPct(selectedConcept.changePct)}
                </span>
              </div>
              <button
                onClick={() => setSelectedConcept(null)}
                className="text-[#8b95a5] hover:text-white p-0.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-3 py-1.5 bg-[#11151d] border-b border-[#222832] text-[11px] font-mono text-[#8b95a5] flex items-center justify-between">
              <span>
                综合评分 <strong className="text-[#f0b90b]">{Math.round(selectedConcept.score)}</strong> ·{' '}
                <span className="text-[#ff3535]">{selectedConcept.upCount}涨</span> /{' '}
                <span className="text-[#00c853]">{selectedConcept.downCount}跌</span>
                {selectedConcept.amount ? ` · 成交额 ${formatAmount(selectedConcept.amount)}` : ''}
              </span>
              <span>点击股票打开 F5 分时/K线</span>
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-table">
                <thead>
                  <tr>
                    <th className="text-left w-10">排名</th>
                    <th className="text-left">代码</th>
                    <th className="text-left">名称</th>
                    <th className="text-right">现价</th>
                    <th className="text-right">涨跌幅</th>
                    <th className="text-right">6因子龙头分</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedConcept.leaders ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-[#7d8796]">
                        暂无龙头标的明细
                      </td>
                    </tr>
                  ) : (
                    selectedConcept.leaders.map((leader, idx) => (
                      <tr
                        key={leader.code}
                        onClick={() => {
                          setSelectedConcept(null);
                          onSelectStock(leader.code, leader.name);
                        }}
                        className="cursor-pointer"
                      >
                        <td className="font-mono text-[#ff8800] font-bold">#{idx + 1}</td>
                        <td className="font-mono text-[#e5b567]">{leader.code}</td>
                        <td className="font-medium text-[#e8edf5]">{leader.name}</td>
                        <td className="text-right font-mono text-[#dfe6f0]">
                          {leader.price !== undefined ? leader.price.toFixed(2) : '-'}
                        </td>
                        <td
                          className={`text-right font-mono font-semibold ${windColorClass(
                            leader.changePct
                          )}`}
                        >
                          {formatPct(leader.changePct)}
                        </td>
                        <td className="text-right font-mono text-[#f0b90b]">
                          {Math.round(leader.dragonScore)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
