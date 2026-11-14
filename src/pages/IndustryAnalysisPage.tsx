import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { RefreshCw, Search, X } from 'lucide-react';
import { api, formatAmount, formatPct } from '../api/client';
import type {
  IndustriesResponse,
  IndustryBoardItem,
  IndustryDetailResponse,
  KLineBar,
  StockQuoteItem,
} from '../types/market';

interface IndustryAnalysisPageProps {
  onSelectStock: (code: string, name?: string, date?: string) => void;
}

type SortKey = 'strength' | 'gain' | 'leader' | 'amount' | 'loss';
type IndicatorTab = 'VOL' | 'MACD' | 'RSI' | 'KDJ' | 'BOLL';
type WindowRange = '60' | '120' | 'all';
type ConstituentSortKey = 'gainDesc' | 'gainAsc' | 'amountDesc' | 'turnoverDesc';

const WIND_TOOLTIP_CSS = 'border-radius:0;box-shadow:none;';

function windColorClass(val?: number | null): string {
  if (val === undefined || val === null || val === 0) return 'text-[#8b949e]';
  return val > 0 ? 'text-[#ff3535]' : 'text-[#00c853]';
}

function calcSMA(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = Number((sum / period).toFixed(2));
  }
  return out;
}

function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[i] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function calcMACD(closes: number[]) {
  if (!closes.length) return { dif: [], dea: [], hist: [] };
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const dif = ema12.map((v, i) => Number((v - ema26[i]).toFixed(3)));
  const deaRaw = calcEMA(dif, 9);
  const dea = deaRaw.map((v) => Number(v.toFixed(3)));
  const hist = dif.map((v, i) => Number(((v - dea[i]) * 2).toFixed(3)));
  return { dif, dea, hist };
}

function calcRSI(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
  }
  return out;
}

function calcKDJ(bars: KLineBar[], n = 9) {
  const kArr: number[] = [];
  const dArr: number[] = [];
  const jArr: number[] = [];
  let k = 50;
  let d = 50;
  for (let i = 0; i < bars.length; i++) {
    const start = Math.max(0, i - n + 1);
    let lowN = Infinity;
    let highN = -Infinity;
    for (let j = start; j <= i; j++) {
      if (bars[j].low < lowN) lowN = bars[j].low;
      if (bars[j].high > highN) highN = bars[j].high;
    }
    const rsv = highN === lowN ? 50 : ((bars[i].close - lowN) / (highN - lowN)) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    const jVal = 3 * k - 2 * d;
    kArr.push(Number(k.toFixed(2)));
    dArr.push(Number(d.toFixed(2)));
    jArr.push(Number(jVal.toFixed(2)));
  }
  return { k: kArr, d: dArr, j: jArr };
}

function calcBOLL(closes: number[], period = 20, mult = 2) {
  const mid = calcSMA(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i] ?? closes[i];
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += (closes[j] - m) ** 2;
    }
    const std = Math.sqrt(variance / period);
    upper[i] = Number((m + mult * std).toFixed(2));
    lower[i] = Number((m - mult * std).toFixed(2));
  }
  return { mid, upper, lower };
}

function getBoardBadge(code: string, name: string): { label: string; cls: string } | null {
  if (name.includes('ST')) {
    return { label: 'ST', cls: 'bg-[#2a2214] text-[#f0b90b] border-[#52401d]' };
  }
  if (code.startsWith('30')) {
    return { label: '创', cls: 'bg-[#2a1d14] text-[#ff8800] border-[#52341d]' };
  }
  if (code.startsWith('68')) {
    return { label: '科', cls: 'bg-[#162235] text-[#4da3ff] border-[#26426b]' };
  }
  if (code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) {
    return { label: '北', cls: 'bg-[#15242d] text-[#38bdf8] border-[#234559]' };
  }
  return null;
}

export default function IndustryAnalysisPage({ onSelectStock }: IndustryAnalysisPageProps) {
  const [listData, setListData] = useState<IndustriesResponse | null>(null);
  const [selectedCode, setSelectedCode] = useState<string>('');
  const [detail, setDetail] = useState<IndustryDetailResponse | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [heatExpanded, setHeatExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('strength');

  const [indicatorTab, setIndicatorTab] = useState<IndicatorTab>('VOL');
  const [showVolRatio, setShowVolRatio] = useState(false);
  const [windowRange, setWindowRange] = useState<WindowRange>('all');
  const [hoveredBar, setHoveredBar] = useState<KLineBar | null>(null);

  // Constituent Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalSearch, setModalSearch] = useState('');
  const [modalSort, setModalSort] = useState<ConstituentSortKey>('gainDesc');

  const klineChartRef = useRef<HTMLDivElement | null>(null);

  const fetchIndustries = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await api.getIndustries();
      setListData(res);
      if (res.industries?.length && !selectedCode) {
        setSelectedCode(res.industries[0].code);
      }
    } catch (err: any) {
      setError(err?.message || '加载行业列表失败');
    } finally {
      setLoadingList(false);
    }
  }, [selectedCode]);

  useEffect(() => {
    fetchIndustries();
  }, [fetchIndustries]);

  const fetchDetail = useCallback(async (code: string) => {
    if (!code) return;
    setLoadingDetail(true);
    try {
      const res = await api.getIndustryDetail(code);
      setDetail(res);
      setHoveredBar(null);
    } catch (err: any) {
      setError(err?.message || '加载行业K线与成分股失败');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCode) {
      fetchDetail(selectedCode);
    }
  }, [selectedCode, fetchDetail]);

  const filteredIndustries = useMemo(() => {
    const items = [...(listData?.industries ?? [])];
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? items.filter(
          (i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q)
        )
      : items;

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'gain':
          return b.changePct - a.changePct;
        case 'loss':
          return a.changePct - b.changePct;
        case 'amount':
          return (b.amount ?? 0) - (a.amount ?? 0);
        case 'leader':
          return (b.leaderChangePct ?? b.changePct) - (a.leaderChangePct ?? a.changePct);
        case 'strength':
        default:
          return (b.strength ?? 0) - (a.strength ?? 0);
      }
    });
    return filtered.slice(0, 120);
  }, [listData, searchQuery, sortBy]);

  const selectedIndustryMeta: IndustryBoardItem | undefined = useMemo(
    () => listData?.industries?.find((i) => i.code === selectedCode),
    [listData, selectedCode]
  );

  const displayedHeat = useMemo(() => {
    const all = listData?.heatDistribution ?? [];
    if (heatExpanded || all.length <= 18) return all;
    return all.slice(0, 18);
  }, [listData, heatExpanded]);

  const displayedKlines = useMemo(() => {
    const raw = detail?.klines ?? [];
    if (!raw.length) return [];
    if (windowRange === '60') return raw.slice(-60);
    if (windowRange === '120') return raw.slice(-120);
    return raw;
  }, [detail, windowRange]);

  const activeBar = useMemo(() => {
    if (hoveredBar) return hoveredBar;
    return displayedKlines[displayedKlines.length - 1] ?? null;
  }, [hoveredBar, displayedKlines]);

  const computedMAs = useMemo(() => {
    const closes = displayedKlines.map((b) => b.close);
    const ma5Calc = calcSMA(closes, 5);
    const ma10Calc = calcSMA(closes, 10);
    const ma20Calc = calcSMA(closes, 20);
    const ma60Calc = calcSMA(closes, 60);
    return {
      ma5: displayedKlines.map((b, i) => b.ma5 ?? ma5Calc[i]),
      ma10: displayedKlines.map((b, i) => b.ma10 ?? ma10Calc[i]),
      ma20: displayedKlines.map((b, i) => b.ma20 ?? ma20Calc[i]),
      ma60: displayedKlines.map((b, i) => b.ma60 ?? ma60Calc[i]),
    };
  }, [displayedKlines]);

  // ECharts Candlestick + Sub-indicator (Standard 白/黄/紫/绿 MA colors on #0d1015)
  useEffect(() => {
    if (!klineChartRef.current || !displayedKlines.length) return;
    const chart = echarts.init(klineChartRef.current);

    const dates = displayedKlines.map((b) => b.date);
    const closes = displayedKlines.map((b) => b.close);
    const ohlc = displayedKlines.map((b) => [b.open, b.close, b.low, b.high]);
    const macd = calcMACD(closes);
    const rsi6 = calcRSI(closes, 6);
    const rsi12 = calcRSI(closes, 12);
    const rsi24 = calcRSI(closes, 24);
    const kdj = calcKDJ(displayedKlines, 9);
    const boll = calcBOLL(closes, 20, 2);

    const volRatioSeries = displayedKlines.map((b, idx) => {
      if (b.volRatio !== undefined) return Number(b.volRatio.toFixed(2));
      const start = Math.max(0, idx - 5);
      const prevSlice = displayedKlines.slice(start, idx);
      const avgVol = prevSlice.length
        ? prevSlice.reduce((s, x) => s + x.volume, 0) / prevSlice.length
        : b.volume || 1;
      return avgVol > 0 ? Number((b.volume / avgVol).toFixed(2)) : 1;
    });

    const mainSeries: echarts.SeriesOption[] = [
      {
        name: 'K线',
        type: 'candlestick',
        xAxisIndex: 0,
        yAxisIndex: 0,
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
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        lineStyle: { color: '#ffffff', width: 1.1 },
        data: computedMAs.ma5,
      },
      {
        name: 'MA10',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        lineStyle: { color: '#f0b90b', width: 1.1 },
        data: computedMAs.ma10,
      },
      {
        name: 'MA20',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        lineStyle: { color: '#e879f9', width: 1.1 },
        data: computedMAs.ma20,
      },
      {
        name: 'MA60',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        lineStyle: { color: '#00e676', width: 1.1 },
        data: computedMAs.ma60,
      },
    ];

    if (indicatorTab === 'BOLL') {
      mainSeries.push(
        {
          name: 'BOLL上轨',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          lineStyle: { color: '#ff3535', width: 1, type: 'dashed' },
          data: boll.upper,
        },
        {
          name: 'BOLL中轨',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          lineStyle: { color: '#f0b90b', width: 1, type: 'dashed' },
          data: boll.mid,
        },
        {
          name: 'BOLL下轨',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          lineStyle: { color: '#00c853', width: 1, type: 'dashed' },
          data: boll.lower,
        }
      );
    }

    const subSeries: echarts.SeriesOption[] = [];
    if (indicatorTab === 'VOL' || indicatorTab === 'BOLL') {
      subSeries.push({
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: displayedKlines.map((b) => ({
          value: b.volume,
          itemStyle: {
            color: b.close >= b.open ? 'rgba(255, 53, 53, 0.72)' : 'rgba(0, 200, 83, 0.72)',
          },
        })),
      });
      if (showVolRatio) {
        subSeries.push({
          name: '量比',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 2,
          showSymbol: false,
          lineStyle: { color: '#f0b90b', width: 1.4 },
          data: volRatioSeries,
        });
      }
    } else if (indicatorTab === 'MACD') {
      subSeries.push(
        {
          name: 'MACD',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: macd.hist.map((v) => ({
            value: v,
            itemStyle: { color: v >= 0 ? '#ff3535' : '#00c853' },
          })),
        },
        {
          name: 'DIF',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#ffffff', width: 1.2 },
          data: macd.dif,
        },
        {
          name: 'DEA',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#f0b90b', width: 1.2 },
          data: macd.dea,
        }
      );
    } else if (indicatorTab === 'RSI') {
      subSeries.push(
        {
          name: 'RSI6',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#ffffff', width: 1.2 },
          data: rsi6,
        },
        {
          name: 'RSI12',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#f0b90b', width: 1.2 },
          data: rsi12,
        },
        {
          name: 'RSI24',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#e879f9', width: 1.2 },
          data: rsi24,
        }
      );
    } else if (indicatorTab === 'KDJ') {
      subSeries.push(
        {
          name: 'K',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#ffffff', width: 1.2 },
          data: kdj.k,
        },
        {
          name: 'D',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#f0b90b', width: 1.2 },
          data: kdj.d,
        },
        {
          name: 'J',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { color: '#e879f9', width: 1.2 },
          data: kdj.j,
        }
      );
    }

    const defaultZoomStart =
      displayedKlines.length > 90
        ? Math.round(((displayedKlines.length - 90) / displayedKlines.length) * 100)
        : 0;

    const option: echarts.EChartsOption = {
      animation: false,
      backgroundColor: '#0d1015',
      axisPointer: {
        link: [{ xAxisIndex: 'all' }],
        lineStyle: { color: '#475569', type: 'dashed' },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: '#141923',
        borderColor: '#2a3342',
        borderWidth: 1,
        extraCssText: WIND_TOOLTIP_CSS,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
        formatter: (params: any) => {
          if (!Array.isArray(params) || !params.length) return '';
          const idx = params[0].dataIndex;
          const b = displayedKlines[idx];
          if (!b) return '';
          const chgColor = b.changePct >= 0 ? '#ff3535' : '#00c853';
          return `
            <div style="min-width:170px">
              <div style="display:flex;justify-content:space-between;border-bottom:1px solid #252c38;padding-bottom:3px;margin-bottom:4px">
                <span style="color:#8b95a5">${b.date}</span>
                <span style="color:${chgColor};font-weight:700">${formatPct(b.changePct)}</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;font-size:11px">
                <span style="color:#8b95a5">开盘:</span><span style="text-align:right">${b.open.toFixed(2)}</span>
                <span style="color:#8b95a5">最高:</span><span style="text-align:right;color:#ff3535">${b.high.toFixed(2)}</span>
                <span style="color:#8b95a5">最低:</span><span style="text-align:right;color:#00c853">${b.low.toFixed(2)}</span>
                <span style="color:#8b95a5">收盘:</span><span style="text-align:right">${b.close.toFixed(2)}</span>
                <span style="color:#8b95a5">成交额:</span><span style="text-align:right;color:#f0b90b">${formatAmount(b.amount)}</span>
                <span style="color:#8b95a5">量比:</span><span style="text-align:right;color:#f0b90b">${volRatioSeries[idx]}x</span>
              </div>
            </div>`;
        },
      },
      grid: [
        { top: 10, left: 50, right: 16, height: '59%' },
        { top: '75%', left: 50, right: 16, height: '15%' },
      ],
      xAxis: [
        {
          type: 'category',
          gridIndex: 0,
          data: dates,
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: { show: false },
          axisTick: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: { color: '#7d8796', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
        },
      ],
      yAxis: [
        {
          scale: true,
          gridIndex: 0,
          splitNumber: 4,
          axisLine: { show: false },
          splitLine: { lineStyle: { color: '#1b212c', type: 'dashed' } },
          axisLabel: { color: '#7d8796', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
        },
        {
          scale: true,
          gridIndex: 1,
          splitNumber: 2,
          axisLine: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: '#7d8796',
            fontSize: 9,
            fontFamily: 'JetBrains Mono, monospace',
            formatter: (v: number) =>
              indicatorTab === 'VOL' || indicatorTab === 'BOLL'
                ? v >= 1e6
                  ? `${(v / 1e6).toFixed(1)}M`
                  : v >= 1e4
                  ? `${(v / 1e4).toFixed(0)}W`
                  : String(v)
                : String(v),
          },
        },
        {
          scale: true,
          gridIndex: 1,
          show: false,
        },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: defaultZoomStart, end: 100 },
        {
          type: 'slider',
          xAxisIndex: [0, 1],
          height: 14,
          bottom: 2,
          start: defaultZoomStart,
          end: 100,
          borderColor: '#222832',
          backgroundColor: '#090c10',
          fillerColor: 'rgba(255, 136, 0, 0.16)',
          handleStyle: { color: '#ff8800', borderColor: '#dfe6f0' },
          textStyle: { color: '#7d8796', fontSize: 9 },
        },
      ],
      series: [...mainSeries, ...subSeries],
    };

    chart.setOption(option);

    chart.on('updateAxisPointer', (event: any) => {
      const dataIndex = event?.axesInfo?.[0]?.value;
      if (typeof dataIndex === 'number' && displayedKlines[dataIndex]) {
        setHoveredBar(displayedKlines[dataIndex]);
      }
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(klineChartRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [displayedKlines, computedMAs, indicatorTab, showVolRatio]);

  const filteredConstituents: StockQuoteItem[] = useMemo(() => {
    const raw = [...(detail?.constituents ?? [])];
    const q = modalSearch.trim().toLowerCase();
    const filtered = q
      ? raw.filter(
          (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
        )
      : raw;

    filtered.sort((a, b) => {
      switch (modalSort) {
        case 'gainAsc':
          return a.changePct - b.changePct;
        case 'amountDesc':
          return (b.amount ?? 0) - (a.amount ?? 0);
        case 'turnoverDesc':
          return (b.turnoverRate ?? 0) - (a.turnoverRate ?? 0);
        case 'gainDesc':
        default:
          return b.changePct - a.changePct;
      }
    });
    return filtered;
  }, [detail, modalSearch, modalSort]);

  const activeIdx = activeBar
    ? displayedKlines.findIndex((b) => b.date === activeBar.date)
    : -1;
  const activeMa5 = activeIdx >= 0 ? computedMAs.ma5[activeIdx] : null;
  const activeMa10 = activeIdx >= 0 ? computedMAs.ma10[activeIdx] : null;
  const activeMa20 = activeIdx >= 0 ? computedMAs.ma20[activeIdx] : null;
  const activeMa60 = activeIdx >= 0 ? computedMAs.ma60[activeIdx] : null;

  return (
    <div className="h-full w-full flex flex-col bg-[#222832] gap-[1px] overflow-hidden text-[#dfe6f0]">
      {/* Top Heat Distribution Strip */}
      <div className="bg-[#0e1117] shrink-0">
        <div className="w-header">
          <span className="w-title-bar">行业热度分布 (按标的覆盖数)</span>
          <div className="flex items-center gap-2 text-[11px] font-mono">
            {listData?.updatedAt && (
              <span className="hidden sm:inline text-[#7d8796]">{listData.updatedAt}</span>
            )}
            <button
              onClick={fetchIndustries}
              disabled={loadingList}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#11151d] hover:bg-[#1b2434] border border-[#252c38] text-[#dfe6f0] rounded-[2px]"
            >
              <RefreshCw className={`w-3 h-3 ${loadingList ? 'animate-spin text-[#ff8800]' : ''}`} />
              刷新
            </button>
            <button
              onClick={() => setHeatExpanded((v) => !v)}
              className="px-2 py-0.5 bg-[#11151d] hover:bg-[#1b2434] border border-[#252c38] text-[#8b95a5] hover:text-[#dfe6f0] rounded-[2px]"
            >
              {heatExpanded
                ? '收起'
                : `展开全部 (${listData?.heatDistribution?.length ?? 0})`}
            </button>
          </div>
        </div>

        <div className="p-2 flex flex-wrap gap-1 max-h-[140px] overflow-y-auto">
          {displayedHeat.map((pill) => {
            const isActive = pill.code === selectedCode;
            return (
              <button
                key={pill.code}
                onClick={() => setSelectedCode(pill.code)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] border rounded-[2px] ${
                  isActive
                    ? 'bg-[#1b2434] border-[#ff8800] text-[#ff9500]'
                    : 'bg-[#151a23] hover:bg-[#1b2434] border-[#252c38] text-[#dfe6f0]'
                }`}
              >
                <span className="font-medium">{pill.name}</span>
                <span className="font-mono text-[#f0b90b]">{pill.stockCount}</span>
                <span className={`font-mono tabular-nums ${windColorClass(pill.changePct)}`}>
                  {formatPct(pill.changePct)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="bg-[#1a1114] border-b border-[#ff3535] px-3 py-1.5 text-xs text-[#ff3535] flex items-center justify-between shrink-0">
          <span>{error}</span>
          <button onClick={fetchIndustries} className="underline">
            重试
          </button>
        </div>
      )}

      {/* Main Split: Industry Matrix Left + Industry K-Line Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-[1px] bg-[#222832] flex-1 min-h-0">
        {/* Left: Industry Matrix */}
        <div className="lg:col-span-4 xl:col-span-3 bg-[#0e1117] flex flex-col min-h-0 overflow-hidden">
          <div className="w-header shrink-0">
            <span className="w-title-bar">行业矩阵</span>
            <span className="text-[11px] font-mono text-[#7d8796]">
              Top {filteredIndustries.length}
            </span>
          </div>

          <div className="p-1.5 border-b border-[#222832] bg-[#11151d] flex flex-col gap-1.5 shrink-0">
            <div className="relative">
              <Search className="w-3 h-3 text-[#7d8796] absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索行业名称 / 代码"
                className="w-full bg-[#090c10] border border-[#252c38] focus:border-[#ff8800] rounded-[2px] pl-6 pr-2 py-1 text-[11px] text-[#dfe6f0] placeholder:text-[#7d8796] outline-none"
              />
            </div>

            <div className="grid grid-cols-5 border border-[#222832] bg-[#0e1117]">
              {(
                [
                  { key: 'strength', label: '强度' },
                  { key: 'gain', label: '涨幅' },
                  { key: 'leader', label: '龙头' },
                  { key: 'amount', label: '成交' },
                  { key: 'loss', label: '跌幅' },
                ] as { key: SortKey; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setSortBy(tab.key)}
                  className={`py-1 text-[11px] border-r last:border-r-0 border-[#222832] ${
                    sortBy === tab.key
                      ? 'bg-[#161b24] text-[#ff9500] border-t-2 border-t-[#ff8800] font-semibold'
                      : 'text-[#8b95a5] hover:text-[#dfe6f0]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <table className="w-table">
              <thead>
                <tr>
                  <th className="text-left">行业名称</th>
                  <th className="text-right">涨幅%</th>
                  <th className="text-right">涨/跌</th>
                  <th className="text-right">
                    {sortBy === 'amount' ? '成交额' : sortBy === 'leader' ? '龙头' : '强度'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {loadingList && !listData ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-[#7d8796]">
                      加载行业矩阵...
                    </td>
                  </tr>
                ) : filteredIndustries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-[#7d8796]">
                      未找到匹配行业
                    </td>
                  </tr>
                ) : (
                  filteredIndustries.map((ind) => {
                    const isSelected = ind.code === selectedCode;
                    return (
                      <tr
                        key={ind.code}
                        onClick={() => setSelectedCode(ind.code)}
                        className={`cursor-pointer ${
                          isSelected ? '!bg-[#1b2434] border-l-2 border-l-[#ff8800]' : ''
                        }`}
                      >
                        <td className="font-medium text-[#e8edf5] max-w-[105px] truncate">
                          {ind.name}
                        </td>
                        <td
                          className={`text-right font-mono font-semibold ${windColorClass(
                            ind.changePct
                          )}`}
                        >
                          {formatPct(ind.changePct)}
                        </td>
                        <td className="text-right font-mono text-[11px]">
                          <span className="text-[#ff3535]">{ind.upCount}</span>/
                          <span className="text-[#00c853]">{ind.downCount}</span>
                        </td>
                        <td className="text-right font-mono text-[11px] text-[#f0b90b]">
                          {sortBy === 'amount'
                            ? formatAmount(ind.amount)
                            : sortBy === 'leader' && ind.leaderName
                            ? ind.leaderName
                            : Math.round(ind.strength)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Selected Industry Real Daily K-line + Constituent Trigger */}
        <div className="lg:col-span-8 xl:col-span-9 bg-[#0e1117] flex flex-col min-h-0 overflow-hidden">
          <div className="w-header shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-title-bar">
                {detail?.level || selectedIndustryMeta?.level || '行业板块'} ·{' '}
                {detail?.name || selectedIndustryMeta?.name || '请选择行业'}
              </span>
              <span className="font-mono text-[11px] text-[#e5b567]">
                {detail?.code || selectedCode || '-'}
              </span>
              <span className="text-[11px] text-[#7d8796]">真实日K</span>
            </div>

            <button
              onClick={() => setShowModal(true)}
              disabled={!detail?.constituents?.length}
              className="px-2.5 py-0.5 bg-[#161b24] hover:bg-[#1b2434] border border-[#ff8800] text-[11px] font-medium text-[#ff9500] rounded-[2px] disabled:opacity-40"
            >
              查看成分股明细 ({detail?.constituents?.length ?? 0})
            </button>
          </div>

          {/* Hierarchy & Window Bar */}
          <div className="px-2.5 py-1 bg-[#11151d] border-b border-[#222832] flex flex-wrap items-center justify-between gap-2 text-[11px] shrink-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedIndustryMeta?.parentName && (
                <span className="px-1.5 py-0.5 bg-[#151a23] border border-[#252c38] text-[#8b95a5]">
                  上级: {selectedIndustryMeta.parentName}
                </span>
              )}
              {(detail?.hierarchy ?? []).map((item, i) => (
                <span
                  key={`${item}-${i}`}
                  className="px-1.5 py-0.5 bg-[#151a23] border border-[#252c38] text-[#dfe6f0]"
                >
                  {item}
                </span>
              ))}
              {detail?.stats && (
                <span className="font-mono text-[#8b95a5] ml-1">
                  均值{' '}
                  <span className={windColorClass(detail.stats.avgChangePct)}>
                    {formatPct(detail.stats.avgChangePct)}
                  </span>{' '}
                  · <span className="text-[#ff3535]">{detail.stats.upCount}涨</span> /{' '}
                  <span className="text-[#00c853]">{detail.stats.downCount}跌</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 font-mono">
              <span className="text-[#7d8796] mr-1">
                {displayedKlines[0]?.date || '-'} ~{' '}
                {displayedKlines[displayedKlines.length - 1]?.date || '-'}
              </span>
              {(
                [
                  { id: '60', label: '60D' },
                  { id: '120', label: '120D' },
                  { id: 'all', label: '全部' },
                ] as { id: WindowRange; label: string }[]
              ).map((w) => (
                <button
                  key={w.id}
                  onClick={() => setWindowRange(w.id)}
                  className={`px-2 py-0.5 border text-[11px] rounded-[2px] ${
                    windowRange === w.id
                      ? 'bg-[#161b24] border-[#ff8800] text-[#ff9500]'
                      : 'bg-[#0e1117] border-[#252c38] text-[#8b95a5] hover:text-[#dfe6f0]'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {/* Indicator Toolbar & Standard MA Readout */}
          <div className="h-[26px] bg-[#151a23] border-b border-[#222832] flex items-center justify-between shrink-0">
            <div className="flex items-center h-full">
              {(
                [
                  { id: 'VOL', label: '成交量' },
                  { id: 'MACD', label: 'MACD' },
                  { id: 'RSI', label: 'RSI' },
                  { id: 'KDJ', label: 'KDJ' },
                  { id: 'BOLL', label: 'BOLL' },
                ] as { id: IndicatorTab; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setIndicatorTab(tab.id)}
                  className={`w-tab ${indicatorTab === tab.id ? 'w-tab-active' : ''}`}
                >
                  {tab.label}
                </button>
              ))}
              {(indicatorTab === 'VOL' || indicatorTab === 'BOLL') && (
                <button
                  onClick={() => setShowVolRatio((v) => !v)}
                  className={`h-full px-2.5 text-[11px] border-r border-[#222832] ${
                    showVolRatio
                      ? 'bg-[#0e1117] text-[#f0b90b] font-semibold'
                      : 'text-[#8b95a5] hover:text-[#dfe6f0]'
                  }`}
                >
                  量比(5日){showVolRatio ? ':开' : ':关'}
                </button>
              )}
            </div>

            {activeBar && (
              <div className="hidden md:flex items-center gap-3 px-2.5 text-[11px] font-mono tabular-nums">
                <span className="text-[#ffffff]">
                  MA5:{activeMa5 !== null ? activeMa5.toFixed(2) : '-'}
                </span>
                <span className="text-[#f0b90b]">
                  MA10:{activeMa10 !== null ? activeMa10.toFixed(2) : '-'}
                </span>
                <span className="text-[#e879f9]">
                  MA20:{activeMa20 !== null ? activeMa20.toFixed(2) : '-'}
                </span>
                <span className="text-[#00e676]">
                  MA60:{activeMa60 !== null ? activeMa60.toFixed(2) : '-'}
                </span>
              </div>
            )}
          </div>

          {/* OHLCV Live Readout Strip */}
          {activeBar && (
            <div className="px-2.5 py-1 bg-[#0e1117] border-b border-[#1b212c] font-mono text-[11px] flex flex-wrap items-center gap-x-4 gap-y-0.5 tabular-nums shrink-0">
              <span className="text-[#8b95a5]">{activeBar.date}</span>
              <span>开 {activeBar.open.toFixed(2)}</span>
              <span className="text-[#ff3535]">高 {activeBar.high.toFixed(2)}</span>
              <span className="text-[#00c853]">低 {activeBar.low.toFixed(2)}</span>
              <span>收 {activeBar.close.toFixed(2)}</span>
              <span className={windColorClass(activeBar.changePct)}>
                {formatPct(activeBar.changePct)}
              </span>
              <span className="text-[#8b95a5]">
                量 {Math.round(activeBar.volume).toLocaleString()}
              </span>
              <span className="text-[#f0b90b]">额 {formatAmount(activeBar.amount)}</span>
            </div>
          )}

          {/* K-Line ECharts Canvas */}
          <div className="relative flex-1 min-h-[280px] bg-[#0d1015]">
            {loadingDetail && (
              <div className="absolute inset-0 z-10 bg-[#0d1015]/80 flex items-center justify-center text-xs font-mono text-[#8b95a5]">
                加载行业日K数据...
              </div>
            )}
            {displayedKlines.length === 0 && !loadingDetail ? (
              <div className="h-full flex items-center justify-center text-xs text-[#7d8796]">
                暂无该行业历史K线数据
              </div>
            ) : (
              <div ref={klineChartRef} className="w-full h-full" />
            )}
          </div>
        </div>
      </div>

      {/* Sharp Rectangular Constituent Stocks Popup Window (Slide 09) */}
      {showModal && detail && (
        <div
          className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-4xl bg-[#0e1117] border border-[#ff8800] overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-header shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-title-bar">{detail.name} · 成分股明细</span>
                <span className="font-mono text-[11px] text-[#e5b567]">{detail.code}</span>
                <span className="text-[11px] text-[#7d8796]">
                  ({detail.constituents.length}只)
                </span>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-[#8b95a5] hover:text-white p-0.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 4 KPI Summary Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-[#222832] bg-[#11151d] divide-x divide-[#222832] shrink-0 text-xs font-mono">
              <div className="py-2 px-3 text-center">
                <span className="text-[#7d8796] mr-2">上涨</span>
                <span className="font-bold text-[#ff3535]">{detail.stats.upCount}</span>
              </div>
              <div className="py-2 px-3 text-center">
                <span className="text-[#7d8796] mr-2">下跌</span>
                <span className="font-bold text-[#00c853]">{detail.stats.downCount}</span>
              </div>
              <div className="py-2 px-3 text-center">
                <span className="text-[#7d8796] mr-2">平盘</span>
                <span className="font-bold text-[#dfe6f0]">{detail.stats.flatCount}</span>
              </div>
              <div className="py-2 px-3 text-center">
                <span className="text-[#7d8796] mr-2">平均涨跌</span>
                <span className={`font-bold ${windColorClass(detail.stats.avgChangePct)}`}>
                  {formatPct(detail.stats.avgChangePct)}
                </span>
              </div>
            </div>

            {/* Search & Sort Strip */}
            <div className="px-2.5 py-1.5 border-b border-[#222832] bg-[#0e1117] flex flex-wrap items-center gap-2 shrink-0">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3 h-3 text-[#7d8796] absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  placeholder="搜索代码或名称"
                  className="w-full bg-[#090c10] border border-[#252c38] focus:border-[#ff8800] rounded-[2px] pl-6 pr-2 py-1 text-[11px] text-[#dfe6f0] placeholder:text-[#7d8796] outline-none"
                />
              </div>

              <select
                value={modalSort}
                onChange={(e) => setModalSort(e.target.value as ConstituentSortKey)}
                className="bg-[#090c10] border border-[#252c38] rounded-[2px] px-2 py-1 text-[11px] text-[#dfe6f0] outline-none"
              >
                <option value="gainDesc">涨幅从高到低</option>
                <option value="gainAsc">涨幅从低到高</option>
                <option value="amountDesc">成交额从高到低</option>
                <option value="turnoverDesc">换手率从高到低</option>
              </select>
            </div>

            {/* Constituents Table */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-table">
                <thead>
                  <tr>
                    <th className="text-left w-10">序</th>
                    <th className="text-left">代码</th>
                    <th className="text-left">股票名称</th>
                    <th className="text-right">现价</th>
                    <th className="text-right">涨跌幅</th>
                    <th className="text-right">换手率</th>
                    <th className="text-right">成交额</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredConstituents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-[#7d8796]">
                        暂无匹配的成分股
                      </td>
                    </tr>
                  ) : (
                    filteredConstituents.map((stock, idx) => {
                      const badge = getBoardBadge(stock.code, stock.name);
                      return (
                        <tr
                          key={stock.code}
                          onClick={() => onSelectStock(stock.code, stock.name)}
                          className="cursor-pointer"
                        >
                          <td className="font-mono text-[#7d8796]">{idx + 1}</td>
                          <td className="font-mono text-[#e5b567]">{stock.code}</td>
                          <td>
                            <div className="inline-flex items-center gap-1.5">
                              <span className="font-medium text-[#e8edf5]">{stock.name}</span>
                              {badge && (
                                <span
                                  className={`px-1 py-0 text-[10px] border rounded-[2px] ${badge.cls}`}
                                >
                                  {badge.label}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="text-right font-mono text-[#dfe6f0]">
                            {stock.price ? stock.price.toFixed(2) : '-'}
                          </td>
                          <td
                            className={`text-right font-mono font-semibold ${windColorClass(
                              stock.changePct
                            )}`}
                          >
                            {formatPct(stock.changePct)}
                          </td>
                          <td className="text-right font-mono text-[#8b95a5]">
                            {stock.turnoverRate !== undefined
                              ? `${stock.turnoverRate.toFixed(2)}%`
                              : '-'}
                          </td>
                          <td className="text-right font-mono text-[#f0b90b]">
                            {formatAmount(stock.amount)}
                          </td>
                        </tr>
                      );
                    })
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
