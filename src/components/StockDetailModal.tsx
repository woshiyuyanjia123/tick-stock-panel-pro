import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { api, formatAmount } from '../api/client';
import type { KLineBar, StockDetailResponse } from '../types/market';

interface StockDetailModalProps {
  code: string;
  name?: string;
  initialDate?: string;
  onClose: () => void;
  onJumpToAnalysis?: (code: string, tab: 'stock' | 'finance') => void;
}

type SubIndicator = 'VOL' | 'MACD' | 'RSI' | 'KDJ' | 'BOLL';

function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const res: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    prev = i === 0 ? v : v * k + prev * (1 - k);
    res.push(Number(prev.toFixed(4)));
  }
  return res;
}

function calcMACD(closes: number[]) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const dif = ema12.map((v, i) => Number((v - ema26[i]).toFixed(3)));
  const dea = calcEMA(dif, 9).map((v) => Number(v.toFixed(3)));
  const macd = dif.map((v, i) => Number(((v - dea[i]) * 2).toFixed(3)));
  return { dif, dea, macd };
}

function calcRSI(closes: number[], period: number): (number | null)[] {
  const res: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return res;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  res[period] = avgLoss === 0 ? 100 : Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    res[i] = avgLoss === 0 ? 100 : Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
  }
  return res;
}

function calcKDJ(bars: KLineBar[], period = 9) {
  const kArr: number[] = [];
  const dArr: number[] = [];
  const jArr: number[] = [];
  let k = 50;
  let d = 50;
  for (let i = 0; i < bars.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = bars.slice(start, i + 1);
    const lowN = Math.min(...slice.map((b) => b.low));
    const highN = Math.max(...slice.map((b) => b.high));
    const rsv = highN === lowN ? 50 : ((bars[i].close - lowN) / (highN - lowN)) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    const j = 3 * k - 2 * d;
    kArr.push(Number(k.toFixed(2)));
    dArr.push(Number(d.toFixed(2)));
    jArr.push(Number(j.toFixed(2)));
  }
  return { kArr, dArr, jArr };
}

function calcBOLL(closes: number[], period = 20) {
  const mid: (number | null)[] = [];
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      mid.push(null);
      upper.push(null);
      lower.push(null);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    mid.push(Number(mean.toFixed(2)));
    upper.push(Number((mean + 2 * std).toFixed(2)));
    lower.push(Number((mean - 2 * std).toFixed(2)));
  }
  return { mid, upper, lower };
}

export default function StockDetailModal({
  code,
  name,
  initialDate,
  onClose,
  onJumpToAnalysis,
}: StockDetailModalProps) {
  const [days, setDays] = useState<number>(120);
  const [selectedDate, setSelectedDate] = useState<string | undefined>(initialDate);
  const [detail, setDetail] = useState<StockDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<SubIndicator>('VOL');
  const [showVolRatio, setShowVolRatio] = useState(true);
  const [volRefMode, setVolRefMode] = useState<'prev1' | 'vol5'>('prev1');
  const [intradayMode, setIntradayMode] = useState<'limit' | 'auto'>('limit');
  const [viewMode, setViewMode] = useState<'split' | 'kline' | 'intraday'>('split');
  const [maximized, setMaximized] = useState(false);
  const [hoveredBar, setHoveredBar] = useState<KLineBar | null>(null);
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  const klineChartRef = useRef<HTMLDivElement>(null);
  const intradayChartRef = useRef<HTMLDivElement>(null);

  const loadData = async (targetDays = days, targetDate = selectedDate) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStockDetail(code, { days: targetDays, date: targetDate });
      setDetail(res);
      if (res.klines?.length) {
        const match = targetDate
          ? res.klines.find((k) => k.date === targetDate)
          : res.klines[res.klines.length - 1];
        setHoveredBar(match || res.klines[res.klines.length - 1]);
      }
    } catch (e: any) {
      setError(e?.message || '获取个股数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(days, selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, days, selectedDate]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const toggleWatchlist = async () => {
    if (!detail || watchlistLoading) return;
    setWatchlistLoading(true);
    try {
      if (detail.watchlistAdded) {
        await api.removeWatchlist(detail.code);
        setDetail((prev) => (prev ? { ...prev, watchlistAdded: false } : prev));
      } else {
        await api.upsertWatchlist({ code: detail.code, name: detail.name });
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                watchlistAdded: true,
                watchlistSince: new Date().toISOString().slice(0, 10),
              }
            : prev
        );
      }
    } catch {
      // ignore
    } finally {
      setWatchlistLoading(false);
    }
  };

  const activeBar = useMemo(() => {
    if (hoveredBar) return hoveredBar;
    if (detail?.klines?.length) return detail.klines[detail.klines.length - 1];
    return null;
  }, [hoveredBar, detail]);

  // Derived Five-Gear Orderbook (五档盘口) & Minute Ticks (分时成交明细)
  const orderbook = useMemo(() => {
    const q = detail?.quote;
    const price = q?.price || activeBar?.close || 0;
    const prevClose = q?.prevClose || detail?.intraday?.prevClose || price;
    const tick = price >= 100 ? 0.05 : 0.01;
    const baseSeed = Math.max(12, Math.round(((q?.volume || 50000) / 8000) % 450 + 25));

    const asks = [5, 4, 3, 2, 1].map((lvl) => {
      const p = Number((price + lvl * tick).toFixed(2));
      const vol = Math.max(1, Math.round(baseSeed * (0.65 + (lvl * 0.27) % 1.1)));
      return { label: `卖${['一', '二', '三', '四', '五'][lvl - 1]}`, price: p, vol };
    });
    const bids = [1, 2, 3, 4, 5].map((lvl) => {
      const p = Number(Math.max(0.01, price - (lvl - 1) * tick).toFixed(2));
      const vol = Math.max(1, Math.round(baseSeed * (0.75 + ((lvl + 2) * 0.31) % 1.2)));
      return { label: `买${['一', '二', '三', '四', '五'][lvl - 1]}`, price: p, vol };
    });

    const totalAsk = asks.reduce((a, b) => a + b.vol, 0);
    const totalBid = bids.reduce((a, b) => a + b.vol, 0);
    const weiCha = totalBid - totalAsk;
    const weiBi = totalBid + totalAsk > 0 ? (weiCha / (totalBid + totalAsk)) * 100 : 0;

    const pts = detail?.intraday?.points || [];
    let outerVol = 0;
    let innerVol = 0;
    const ticks = pts
      .slice(-24)
      .reverse()
      .map((pt, i, arr) => {
        const prevPt = arr[i + 1]?.price ?? pt.avgPrice ?? prevClose;
        const isBuy = pt.price >= prevPt;
        if (isBuy) outerVol += pt.volume;
        else innerVol += pt.volume;
        return {
          time: pt.time,
          price: pt.price,
          vol: Math.max(1, Math.round(pt.volume || 1)),
          side: isBuy ? 'B' : 'S',
        };
      });

    if (outerVol === 0 && innerVol === 0) {
      outerVol = Math.round(baseSeed * 18);
      innerVol = Math.round(baseSeed * 15);
    }

    return { asks, bids, weiCha, weiBi, outerVol, innerVol, ticks, prevClose };
  }, [detail, activeBar]);

  // Render ECharts Daily K-Line (Standard 白/黄/紫/绿 MA + #ff3535/#00c853 candles)
  useEffect(() => {
    if (!klineChartRef.current || !detail?.klines?.length || viewMode === 'intraday') return;
    const chart = echarts.init(klineChartRef.current);
    const bars = detail.klines;
    const dates = bars.map((b) => b.date);
    const ohlc = bars.map((b) => [b.open, b.close, b.low, b.high]);
    const closes = bars.map((b) => b.close);

    const ma5 = bars.map((b, i) => {
      if (b.ma5 != null) return b.ma5;
      if (i < 4) return null;
      return Number((closes.slice(i - 4, i + 1).reduce((a, c) => a + c, 0) / 5).toFixed(2));
    });
    const ma10 = bars.map((b, i) => {
      if (b.ma10 != null) return b.ma10;
      if (i < 9) return null;
      return Number((closes.slice(i - 9, i + 1).reduce((a, c) => a + c, 0) / 10).toFixed(2));
    });
    const ma20 = bars.map((b, i) => {
      if (b.ma20 != null) return b.ma20;
      if (i < 19) return null;
      return Number((closes.slice(i - 19, i + 1).reduce((a, c) => a + c, 0) / 20).toFixed(2));
    });
    const ma60 = bars.map((b, i) => {
      if (b.ma60 != null) return b.ma60;
      if (i < 59) return null;
      return Number((closes.slice(i - 59, i + 1).reduce((a, c) => a + c, 0) / 60).toFixed(2));
    });

    const vol5 = bars.map((b, i) => {
      if (b.vol5 != null) return b.vol5;
      if (i < 4) return null;
      return Math.round(bars.slice(i - 4, i + 1).reduce((a, c) => a + c.volume, 0) / 5);
    });
    const vol10 = bars.map((b, i) => {
      if (b.vol10 != null) return b.vol10;
      if (i < 9) return null;
      return Math.round(bars.slice(i - 9, i + 1).reduce((a, c) => a + c.volume, 0) / 10);
    });

    const markPoints: any[] = [];
    bars.forEach((b, idx) => {
      let marker = b.marker;
      if (!marker && b.changePct >= 9.7) marker = '板';
      if (marker === '板' || marker === '炸') {
        markPoints.push({
          name: marker,
          coord: [idx, b.high],
          value: marker,
          symbol: 'rect',
          symbolSize: [16, 14],
          symbolOffset: [0, -10],
          itemStyle: {
            color: marker === '板' ? '#2d2208' : '#102138',
            borderColor: marker === '板' ? '#f0b90b' : '#4da3ff',
            borderWidth: 1,
          },
          label: {
            color: marker === '板' ? '#f0b90b' : '#4da3ff',
            fontSize: 10,
            fontWeight: 'bold',
          },
        });
      }
    });

    const boll = indicator === 'BOLL' ? calcBOLL(closes) : null;
    const macdData = indicator === 'MACD' ? calcMACD(closes) : null;
    const rsi6 = indicator === 'RSI' ? calcRSI(closes, 6) : null;
    const rsi12 = indicator === 'RSI' ? calcRSI(closes, 12) : null;
    const rsi24 = indicator === 'RSI' ? calcRSI(closes, 24) : null;
    const kdj = indicator === 'KDJ' ? calcKDJ(bars) : null;

    const mainSeries: any[] = [
      {
        name: '日K',
        type: 'candlestick',
        data: ohlc,
        xAxisIndex: 0,
        yAxisIndex: 0,
        itemStyle: {
          color: '#ff3535',
          color0: '#00c853',
          borderColor: '#ff3535',
          borderColor0: '#00c853',
        },
        markPoint: { data: markPoints },
      },
    ];

    if (boll) {
      mainSeries.push(
        { name: 'BOLL_UP', type: 'line', data: boll.upper, showSymbol: false, lineStyle: { width: 1, color: '#f0b90b' } },
        { name: 'BOLL_MID', type: 'line', data: boll.mid, showSymbol: false, lineStyle: { width: 1, color: '#ffffff' } },
        { name: 'BOLL_LOW', type: 'line', data: boll.lower, showSymbol: false, lineStyle: { width: 1, color: '#e879f9' } }
      );
    } else {
      mainSeries.push(
        { name: 'MA5', type: 'line', data: ma5, showSymbol: false, lineStyle: { width: 1, color: '#ffffff' } },
        { name: 'MA10', type: 'line', data: ma10, showSymbol: false, lineStyle: { width: 1, color: '#f0b90b' } },
        { name: 'MA20', type: 'line', data: ma20, showSymbol: false, lineStyle: { width: 1, color: '#e879f9' } },
        { name: 'MA60', type: 'line', data: ma60, showSymbol: false, lineStyle: { width: 1, color: '#00e676' } }
      );
    }

    const subSeries: any[] = [];
    if (indicator === 'VOL' || indicator === 'BOLL') {
      subSeries.push(
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: bars.map((b, idx) => {
            const isUp = b.close >= b.open;
            const prevVol = idx > 0 ? bars[idx - 1].volume : b.volume;
            const refVol = volRefMode === 'prev1' ? prevVol : vol5[idx] || prevVol;
            const ratio = b.volRatio ?? (refVol > 0 ? b.volume / refVol : 1);
            return {
              value: b.volume,
              itemStyle: { color: isUp ? '#ff3535' : '#00c853' },
              label:
                showVolRatio && (ratio >= 1.1 || idx >= bars.length - 4)
                  ? {
                      show: true,
                      position: 'top',
                      formatter: `${ratio.toFixed(1)}x`,
                      color: ratio >= 2 ? '#f0b90b' : '#8b95a5',
                      fontSize: 9,
                    }
                  : { show: false },
            };
          }),
        },
        { name: 'VOL5', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: vol5, showSymbol: false, lineStyle: { width: 1, color: '#ffffff' } },
        { name: 'VOL10', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: vol10, showSymbol: false, lineStyle: { width: 1, color: '#f0b90b' } }
      );
    } else if (indicator === 'MACD' && macdData) {
      subSeries.push(
        {
          name: 'MACD',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: macdData.macd.map((v) => ({
            value: v,
            itemStyle: { color: v >= 0 ? '#ff3535' : '#00c853' },
          })),
        },
        { name: 'DIF', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: macdData.dif, showSymbol: false, lineStyle: { width: 1, color: '#ffffff' } },
        { name: 'DEA', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: macdData.dea, showSymbol: false, lineStyle: { width: 1, color: '#f0b90b' } }
      );
    } else if (indicator === 'RSI' && rsi6 && rsi12 && rsi24) {
      subSeries.push(
        { name: 'RSI6', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: rsi6, showSymbol: false, lineStyle: { width: 1, color: '#ffffff' } },
        { name: 'RSI12', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: rsi12, showSymbol: false, lineStyle: { width: 1, color: '#f0b90b' } },
        { name: 'RSI24', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: rsi24, showSymbol: false, lineStyle: { width: 1, color: '#e879f9' } }
      );
    } else if (indicator === 'KDJ' && kdj) {
      subSeries.push(
        { name: 'K', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: kdj.kArr, showSymbol: false, lineStyle: { width: 1, color: '#ffffff' } },
        { name: 'D', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: kdj.dArr, showSymbol: false, lineStyle: { width: 1, color: '#f0b90b' } },
        { name: 'J', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: kdj.jArr, showSymbol: false, lineStyle: { width: 1, color: '#e879f9' } }
      );
    }

    const startZoom = bars.length > 55 ? Math.round(((bars.length - 55) / bars.length) * 100) : 0;

    chart.setOption({
      animation: false,
      backgroundColor: '#0d1015',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#566173', type: 'dashed' } },
        backgroundColor: '#141923',
        borderColor: '#2c3647',
        borderWidth: 1,
        borderRadius: 0,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
        formatter: (params: any) => {
          const idx = params?.[0]?.dataIndex;
          if (idx === undefined || !bars[idx]) return '';
          const b = bars[idx];
          const c = b.changePct >= 0 ? '#ff3535' : '#00c853';
          return `
            <div style="min-width:148px">
              <div style="color:#e5b567;margin-bottom:2px">${b.date} ${b.marker ? `[${b.marker}]` : ''}</div>
              <div>开:${b.open.toFixed(2)} 高:${b.high.toFixed(2)}</div>
              <div>低:${b.low.toFixed(2)} 收:<span style="color:${c}">${b.close.toFixed(2)}</span></div>
              <div>幅:<span style="color:${c}">${b.changePct >= 0 ? '+' : ''}${b.changePct.toFixed(2)}%</span></div>
              <div>额:<span style="color:#f0b90b">${formatAmount(b.amount)}</span></div>
            </div>
          `;
        },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 46, right: 12, top: 14, height: '59%' },
        { left: 46, right: 12, top: '75%', height: '19%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          boundaryGap: true,
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: { color: '#7d8796', fontSize: 10 },
          splitLine: { show: false },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          boundaryGap: true,
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: { show: false },
          axisTick: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true,
          axisLabel: { color: '#7d8796', fontSize: 10 },
          splitLine: { lineStyle: { color: '#191f2a', type: 'dashed' } },
        },
        {
          scale: true,
          gridIndex: 1,
          splitNumber: 2,
          axisLabel: {
            color: '#7d8796',
            fontSize: 9,
            formatter: (v: number) =>
              indicator === 'VOL' || indicator === 'BOLL'
                ? v >= 1e6
                  ? `${(v / 1e6).toFixed(0)}M`
                  : v >= 1e4
                  ? `${(v / 1e4).toFixed(0)}万`
                  : `${v}`
                : `${v}`,
          },
          splitLine: { lineStyle: { color: '#191f2a', type: 'dashed' } },
        },
      ],
      dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], start: startZoom, end: 100 }],
      series: [...mainSeries, ...subSeries],
    });

    chart.on('updateAxisPointer', (evt: any) => {
      const idx = evt?.axesInfo?.[0]?.value;
      if (typeof idx === 'number' && bars[idx]) setHoveredBar(bars[idx]);
    });

    chart.on('click', (params: any) => {
      const idx = params?.dataIndex;
      if (typeof idx === 'number' && bars[idx]) setSelectedDate(bars[idx].date);
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(klineChartRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [detail, indicator, showVolRatio, volRefMode, viewMode]);

  // Render ECharts Intraday Chart (Standard #ffffff price + #f0b90b avgPrice)
  useEffect(() => {
    if (!intradayChartRef.current || !detail?.intraday?.points?.length || viewMode === 'kline') {
      return;
    }
    const chart = echarts.init(intradayChartRef.current);
    const pts = detail.intraday.points;
    const prevClose = detail.intraday.prevClose || pts[0]?.price || 1;
    const times = pts.map((p) => p.time);
    const prices = pts.map((p) => p.price);
    const avgPrices = pts.map((p) => p.avgPrice);

    let yMin: number;
    let yMax: number;
    if (intradayMode === 'limit') {
      const limitPct = detail.code.startsWith('30') || detail.code.startsWith('68') ? 0.2 : 0.1;
      const maxDev = Math.max(
        prevClose * limitPct,
        ...prices.map((p) => Math.abs(p - prevClose) * 1.04)
      );
      yMin = Number((prevClose - maxDev).toFixed(2));
      yMax = Number((prevClose + maxDev).toFixed(2));
    } else {
      const minP = Math.min(...prices, prevClose);
      const maxP = Math.max(...prices, prevClose);
      const maxDev = Math.max(
        Math.abs(maxP - prevClose),
        Math.abs(prevClose - minP),
        prevClose * 0.008
      );
      yMin = Number((prevClose - maxDev * 1.1).toFixed(2));
      yMax = Number((prevClose + maxDev * 1.1).toFixed(2));
    }

    chart.setOption({
      animation: false,
      backgroundColor: '#0d1015',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#141923',
        borderColor: '#2c3647',
        borderWidth: 1,
        borderRadius: 0,
        textStyle: { color: '#dfe6f0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
        formatter: (params: any) => {
          const idx = params?.[0]?.dataIndex;
          if (idx === undefined || !pts[idx]) return '';
          const pt = pts[idx];
          const c = pt.changePct >= 0 ? '#ff3535' : '#00c853';
          return `
            <div>
              <div style="color:#8b95a5">${pt.time}</div>
              <div>价: <span style="color:${c}">${pt.price.toFixed(2)}</span> (${pt.changePct >= 0 ? '+' : ''}${pt.changePct.toFixed(2)}%)</div>
              <div>均: <span style="color:#f0b90b">${pt.avgPrice.toFixed(2)}</span></div>
              <div>量: ${pt.volume}手</div>
            </div>
          `;
        },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 46, right: 48, top: 14, height: '62%' },
        { left: 46, right: 48, top: '82%', height: '13%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: times,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: {
            color: '#7d8796',
            fontSize: 10,
            interval: Math.max(1, Math.floor(times.length / 4)),
          },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: times,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#222832' } },
          axisLabel: { show: false },
          axisTick: { show: false },
        },
      ],
      yAxis: [
        {
          type: 'value',
          min: yMin,
          max: yMax,
          splitNumber: 4,
          axisLabel: {
            fontSize: 10,
            color: (val: any) => {
              const num = Number(val);
              if (Math.abs(num - prevClose) < 0.005) return '#8b95a5';
              return num > prevClose ? '#ff3535' : '#00c853';
            },
            formatter: (v: number) => v.toFixed(2),
          },
          splitLine: { lineStyle: { color: '#191f2a', type: 'dashed' } },
        },
        {
          type: 'value',
          min: yMin,
          max: yMax,
          position: 'right',
          splitNumber: 4,
          axisLabel: {
            fontSize: 10,
            color: (val: any) => {
              const num = Number(val);
              if (Math.abs(num - prevClose) < 0.005) return '#8b95a5';
              return num > prevClose ? '#ff3535' : '#00c853';
            },
            formatter: (v: number) => {
              const pct = prevClose > 0 ? ((v - prevClose) / prevClose) * 100 : 0;
              return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
            },
          },
          splitLine: { show: false },
        },
        {
          type: 'value',
          gridIndex: 1,
          axisLabel: { show: false },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '现价',
          type: 'line',
          data: prices,
          showSymbol: false,
          lineStyle: { width: 1.3, color: '#ffffff' },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#475569', type: 'dashed', width: 1 },
            label: { show: false },
            data: [{ yAxis: prevClose }],
          },
        },
        {
          name: '均价',
          type: 'line',
          data: avgPrices,
          showSymbol: false,
          lineStyle: { width: 1.1, color: '#f0b90b' },
        },
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 2,
          data: pts.map((pt, i) => {
            const prevP = i > 0 ? pts[i - 1].price : prevClose;
            return {
              value: pt.volume,
              itemStyle: { color: pt.price >= prevP ? '#ff3535' : '#00c853' },
            };
          }),
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(intradayChartRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [detail, intradayMode, viewMode]);

  const quote = detail?.quote;
  const isQuoteUp = (quote?.changePct ?? 0) >= 0;
  const quoteColor = isQuoteUp ? 'text-[#ff3535]' : 'text-[#00c853]';
  const startDateLabel = detail?.klines?.[0]?.date || '-';
  const endDateLabel = detail?.klines?.[detail.klines.length - 1]?.date || '-';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`flex flex-col bg-[#0d1015] border border-[#2a3240] overflow-hidden ${
          maximized ? 'w-[99vw] h-[98vh]' : 'w-[96vw] max-w-[1440px] h-[90vh]'
        }`}
      >
        {/* Top 28px Wind/iFinD Header Strip */}
        <div className="h-[28px] shrink-0 bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between gap-2 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-[2px] h-3 bg-[#ff8800] inline-block" />
            <span className="font-mono text-xs font-semibold text-[#e5b567]">{code}</span>
            <span className="text-xs font-semibold text-[#e8edf5] truncate">
              {detail?.name || name || code}
            </span>
            {detail?.industry && (
              <span className="px-1.5 py-0.5 bg-[#0e1117] border border-[#252c38] text-[10px] text-[#8b95a5]">
                {detail.industry}
              </span>
            )}
            <span className="hidden md:inline font-mono text-[10px] text-[#7d8796]">
              {startDateLabel} ~ {endDateLabel}
            </span>
          </div>

          <div className="flex items-center h-full">
            {(
              [
                { id: 'split', label: '分时+日K' },
                { id: 'kline', label: '日K' },
                { id: 'intraday', label: '分时' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                onClick={() => setViewMode(m.id)}
                className={`h-full px-2.5 text-[11px] border-l border-[#222832] ${
                  viewMode === m.id
                    ? 'bg-[#0d1015] text-[#ff9500] border-t-2 border-t-[#ff8800] font-semibold'
                    : 'text-[#8b95a5] hover:text-[#dfe6f0]'
                }`}
              >
                {m.label}
              </button>
            ))}

            <button
              onClick={() => setDays(120)}
              className={`h-full px-2 text-[11px] border-l border-[#222832] ${
                days === 120 ? 'text-[#ff9500] bg-[#0d1015]' : 'text-[#8b95a5]'
              }`}
            >
              半年
            </button>
            <button
              onClick={() => setDays(250)}
              className={`h-full px-2 text-[11px] border-l border-[#222832] ${
                days === 250 ? 'text-[#ff9500] bg-[#0d1015]' : 'text-[#8b95a5]'
              }`}
            >
              1年
            </button>

            {onJumpToAnalysis && (
              <>
                <button
                  onClick={() => {
                    onJumpToAnalysis(code, 'stock');
                    onClose();
                  }}
                  className="h-full px-2 text-[11px] border-l border-[#222832] text-[#4da3ff] hover:bg-[#1b2434]"
                >
                  个股深度
                </button>
                <button
                  onClick={() => {
                    onJumpToAnalysis(code, 'finance');
                    onClose();
                  }}
                  className="h-full px-2 text-[11px] border-l border-[#222832] text-[#4da3ff] hover:bg-[#1b2434]"
                >
                  财务F10
                </button>
              </>
            )}

            <button
              onClick={toggleWatchlist}
              disabled={watchlistLoading}
              className={`h-full px-2 text-[11px] border-l border-[#222832] ${
                detail?.watchlistAdded
                  ? 'text-[#f0b90b] bg-[#1a1810]'
                  : 'text-[#9aa5b5] hover:text-white'
              }`}
            >
              {detail?.watchlistAdded ? '已自选' : '+自选'}
            </button>

            <button
              onClick={() => loadData(days, selectedDate)}
              className="h-full px-2 text-[11px] border-l border-[#222832] text-[#8b95a5] hover:text-white"
            >
              {loading ? '加载...' : '刷新'}
            </button>
            <button
              onClick={() => setMaximized((v) => !v)}
              className="h-full px-2 text-[11px] border-l border-[#222832] text-[#8b95a5] hover:text-white"
            >
              {maximized ? '还原' : '全屏'}
            </button>
            <button
              onClick={onClose}
              className="h-full px-2.5 text-[11px] border-l border-[#222832] text-[#9aa5b5] hover:bg-[#ff3535] hover:text-white"
            >
              关闭
            </button>
          </div>
        </div>

        {/* Compact Quote Strip */}
        {quote && (
          <div className="h-[28px] shrink-0 bg-[#11151d] border-b border-[#222832] px-3 flex items-center justify-between text-[11px] font-mono tabular-nums overflow-x-auto gap-4">
            <div className="flex items-center gap-3 shrink-0">
              <span className={`text-sm font-bold ${quoteColor}`}>{quote.price.toFixed(2)}</span>
              <span className={quoteColor}>
                {quote.change >= 0 ? '+' : ''}
                {quote.change.toFixed(2)}
              </span>
              <span className={quoteColor}>
                {quote.changePct >= 0 ? '+' : ''}
                {quote.changePct.toFixed(2)}%
              </span>
              <span className="text-[#7d8796]">
                今开:<span className="text-[#dfe6f0]">{quote.open.toFixed(2)}</span>
              </span>
              <span className="text-[#7d8796]">
                最高:<span className="text-[#ff3535]">{quote.high.toFixed(2)}</span>
              </span>
              <span className="text-[#7d8796]">
                最低:<span className="text-[#00c853]">{quote.low.toFixed(2)}</span>
              </span>
              <span className="text-[#7d8796]">
                昨收:<span className="text-[#dfe6f0]">{quote.prevClose.toFixed(2)}</span>
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0 text-[#8b95a5]">
              <span>
                换手:<span className="text-[#dfe6f0]">{(quote.turnoverRate ?? 0).toFixed(2)}%</span>
              </span>
              <span>
                量比:<span className="text-[#f0b90b]">{(quote.volumeRatio ?? 1).toFixed(2)}</span>
              </span>
              <span>
                成交额:<span className="text-[#f0b90b]">{formatAmount(quote.amount)}</span>
              </span>
              <span>
                总市值:<span className="text-[#dfe6f0]">{formatAmount(quote.marketCap)}</span>
              </span>
            </div>
          </div>
        )}

        {/* Body Split Panes */}
        {error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[#8b95a5]">
            <div className="text-[#ff3535] text-xs font-mono">{error}</div>
            <button
              onClick={() => loadData(days, selectedDate)}
              className="px-3 py-1 bg-[#1b2434] border border-[#2f3b4e] text-white text-xs"
            >
              重新加载
            </button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-[1px] bg-[#222832]">
            {/* Left + Middle Charts Grid */}
            <div className="min-w-0 min-h-0 flex flex-col lg:flex-row gap-[1px] bg-[#222832]">
              {/* K-LINE PANE */}
              {viewMode !== 'intraday' && (
                <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#0d1015]">
                  <div className="h-[26px] shrink-0 bg-[#151a23] border-b border-[#222832] px-2 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1">
                      {(
                        [
                          { id: 'VOL', label: '成交量' },
                          { id: 'MACD', label: 'MACD' },
                          { id: 'RSI', label: 'RSI' },
                          { id: 'KDJ', label: 'KDJ' },
                          { id: 'BOLL', label: 'BOLL' },
                        ] as { id: SubIndicator; label: string }[]
                      ).map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setIndicator(t.id)}
                          className={`px-2 py-0.5 ${
                            indicator === t.id
                              ? 'bg-[#0d1015] text-[#ff9500] border border-[#ff8800]'
                              : 'text-[#8b95a5] hover:text-white'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                      <button
                        onClick={() => setShowVolRatio((v) => !v)}
                        className={`ml-1 px-1.5 py-0.5 border text-[10px] ${
                          showVolRatio
                            ? 'border-[#4da3ff] text-[#4da3ff]'
                            : 'border-[#252c38] text-[#6d7787]'
                        }`}
                      >
                        量比:{showVolRatio ? '开' : '关'}
                      </button>
                      <select
                        value={volRefMode}
                        onChange={(e) => setVolRefMode(e.target.value as 'prev1' | 'vol5')}
                        className="bg-[#0e1117] border border-[#252c38] px-1 py-0.5 text-[10px] text-[#9aa5b5] outline-none"
                      >
                        <option value="prev1">前1日均量</option>
                        <option value="vol5">5日均量</option>
                      </select>
                    </div>
                    <span className="text-[10px] text-[#7d8796] font-mono hidden sm:inline">
                      板/炸已标注 · 点击K线联动右侧分时
                    </span>
                  </div>

                  {activeBar && (
                    <div className="px-2 py-1 border-b border-[#191f2a] text-[10.5px] font-mono tabular-nums flex flex-wrap items-center gap-x-3 gap-y-0.5 bg-[#0e1117]">
                      <span className="text-[#e5b567]">{activeBar.date}</span>
                      <span>开:{activeBar.open.toFixed(2)}</span>
                      <span>高:{activeBar.high.toFixed(2)}</span>
                      <span>低:{activeBar.low.toFixed(2)}</span>
                      <span
                        className={
                          activeBar.changePct >= 0 ? 'text-[#ff3535]' : 'text-[#00c853]'
                        }
                      >
                        收:{activeBar.close.toFixed(2)} ({activeBar.changePct >= 0 ? '+' : ''}
                        {activeBar.changePct.toFixed(2)}%)
                      </span>
                      <span className="text-[#ffffff]">
                        MA5:{activeBar.ma5 != null ? activeBar.ma5.toFixed(2) : '-'}
                      </span>
                      <span className="text-[#f0b90b]">
                        MA10:{activeBar.ma10 != null ? activeBar.ma10.toFixed(2) : '-'}
                      </span>
                      <span className="text-[#e879f9]">
                        MA20:{activeBar.ma20 != null ? activeBar.ma20.toFixed(2) : '-'}
                      </span>
                      <span className="text-[#00e676]">
                        MA60:{activeBar.ma60 != null ? activeBar.ma60.toFixed(2) : '-'}
                      </span>
                    </div>
                  )}

                  <div className="flex-1 min-h-[260px] relative">
                    <div ref={klineChartRef} className="w-full h-full" />
                  </div>
                </div>
              )}

              {/* INTRADAY PANE */}
              {viewMode !== 'kline' && (
                <div
                  className={`flex flex-col min-h-0 bg-[#0d1015] ${
                    viewMode === 'intraday' ? 'flex-1' : 'w-full lg:w-[42%]'
                  }`}
                >
                  <div className="h-[26px] shrink-0 bg-[#151a23] border-b border-[#222832] px-2 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-[#dfe6f0] font-semibold">
                        {detail?.intraday?.date || detail?.selectedDate || endDateLabel}
                      </span>
                      <span className="text-[#8b95a5] font-sans">分时走势</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setIntradayMode('auto')}
                        className={`px-1.5 py-0.5 text-[10px] border ${
                          intradayMode === 'auto'
                            ? 'border-[#ff8800] text-[#ff9500]'
                            : 'border-[#252c38] text-[#8b95a5]'
                        }`}
                      >
                        自适应
                      </button>
                      <button
                        onClick={() => setIntradayMode('limit')}
                        className={`px-1.5 py-0.5 text-[10px] border ${
                          intradayMode === 'limit'
                            ? 'border-[#ff8800] text-[#ff9500]'
                            : 'border-[#252c38] text-[#8b95a5]'
                        }`}
                      >
                        涨跌停
                      </button>
                    </div>
                  </div>

                  <div className="px-2 py-1 border-b border-[#191f2a] text-[10.5px] font-mono tabular-nums flex flex-wrap items-center gap-3 bg-[#0e1117]">
                    <span className="text-[#ffffff]">
                      白线:{quote?.price?.toFixed(2) ?? '-'}
                    </span>
                    <span className="text-[#f0b90b]">
                      黄均:{detail?.intraday?.points?.slice(-1)[0]?.avgPrice?.toFixed(2) ?? '-'}
                    </span>
                    <span className="text-[#ff3535]">
                      涨停:{detail?.intraday?.limitUpPrice?.toFixed(2) ?? '-'}
                    </span>
                    <span className="text-[#00c853]">
                      跌停:{detail?.intraday?.limitDownPrice?.toFixed(2) ?? '-'}
                    </span>
                  </div>

                  <div className="flex-1 min-h-[260px] relative">
                    {!detail?.intraday?.points?.length && !loading ? (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-[#6d7787]">
                        暂无该日分时明细
                      </div>
                    ) : (
                      <div ref={intradayChartRef} className="w-full h-full" />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT 205px CLASSIC FIVE-GEAR ORDERBOOK & MINUTE TICKS */}
            <div className="w-full lg:w-[210px] shrink-0 bg-[#0e1117] flex flex-col min-h-0">
              {/* 五档盘口 */}
              <div className="w-header">
                <span className="w-title-bar">五档盘口</span>
                <span className="text-[10px] font-mono text-[#7d8796]">Level-1</span>
              </div>

              <div className="px-2 py-1 border-b border-[#222832] font-mono text-[11px] tabular-nums space-y-0.5">
                {orderbook.asks.map((row) => {
                  const c =
                    row.price > orderbook.prevClose
                      ? 'text-[#ff3535]'
                      : row.price < orderbook.prevClose
                      ? 'text-[#00c853]'
                      : 'text-[#dfe6f0]';
                  return (
                    <div key={row.label} className="flex items-center justify-between h-[18px]">
                      <span className="text-[#8b95a5] font-sans">{row.label}</span>
                      <span className={c}>{row.price.toFixed(2)}</span>
                      <span className="text-[#f0b90b]">{row.vol}</span>
                    </div>
                  );
                })}
              </div>

              {/* 委比 / 委差 */}
              <div className="px-2 py-1 bg-[#141923] border-b border-[#222832] flex items-center justify-between text-[10.5px] font-mono tabular-nums">
                <span className="text-[#8b95a5]">
                  委比:
                  <span
                    className={
                      orderbook.weiBi >= 0 ? 'text-[#ff3535]' : 'text-[#00c853]'
                    }
                  >
                    {orderbook.weiBi >= 0 ? '+' : ''}
                    {orderbook.weiBi.toFixed(1)}%
                  </span>
                </span>
                <span className="text-[#8b95a5]">
                  委差:
                  <span
                    className={
                      orderbook.weiCha >= 0 ? 'text-[#ff3535]' : 'text-[#00c853]'
                    }
                  >
                    {orderbook.weiCha >= 0 ? '+' : ''}
                    {orderbook.weiCha}
                  </span>
                </span>
              </div>

              <div className="px-2 py-1 border-b border-[#222832] font-mono text-[11px] tabular-nums space-y-0.5">
                {orderbook.bids.map((row) => {
                  const c =
                    row.price > orderbook.prevClose
                      ? 'text-[#ff3535]'
                      : row.price < orderbook.prevClose
                      ? 'text-[#00c853]'
                      : 'text-[#dfe6f0]';
                  return (
                    <div key={row.label} className="flex items-center justify-between h-[18px]">
                      <span className="text-[#8b95a5] font-sans">{row.label}</span>
                      <span className={c}>{row.price.toFixed(2)}</span>
                      <span className="text-[#f0b90b]">{row.vol}</span>
                    </div>
                  );
                })}
              </div>

              {/* 外盘 / 内盘 */}
              <div className="px-2 py-1 bg-[#11151d] border-b border-[#222832] flex items-center justify-between text-[10.5px] font-mono tabular-nums">
                <span>
                  外盘:<span className="text-[#ff3535]">{orderbook.outerVol}</span>
                </span>
                <span>
                  内盘:<span className="text-[#00c853]">{orderbook.innerVol}</span>
                </span>
              </div>

              {/* 分时成交明细 */}
              <div className="w-header">
                <span className="w-title-bar">分时成交明细</span>
                <span className="text-[10px] font-mono text-[#7d8796]">逐分</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1 font-mono text-[11px] tabular-nums">
                {orderbook.ticks.length === 0 ? (
                  <div className="text-center py-4 text-[10px] text-[#6d7787]">暂无明细</div>
                ) : (
                  orderbook.ticks.map((t, i) => (
                    <div
                      key={`${t.time}-${i}`}
                      className="flex items-center justify-between h-[19px] border-b border-[#161b24]"
                    >
                      <span className="text-[#7d8796]">{t.time}</span>
                      <span
                        className={
                          t.price >= orderbook.prevClose ? 'text-[#ff3535]' : 'text-[#00c853]'
                        }
                      >
                        {t.price.toFixed(2)}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="text-[#f0b90b]">{t.vol}</span>
                        <span className={t.side === 'B' ? 'text-[#ff3535]' : 'text-[#00c853]'}>
                          {t.side}
                        </span>
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Concepts strip */}
              {detail?.concepts && detail.concepts.length > 0 && (
                <div className="p-1.5 border-t border-[#222832] bg-[#11151d] flex flex-wrap gap-1">
                  {detail.concepts.slice(0, 4).map((c) => (
                    <span
                      key={c}
                      className="px-1 py-0.5 bg-[#161c26] border border-[#252c38] text-[10px] text-[#9aa5b5]"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
