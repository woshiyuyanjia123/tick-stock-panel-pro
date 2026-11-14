import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { api, formatAmount, formatPct } from '../api/client';
import type { StockDetailResponse, StockSearchItem } from '../types/market';

interface StockAnalysisPageProps {
  onSelectStock: (code: string, name?: string, date?: string) => void;
  initialTab?: 'stock' | 'finance';
  defaultCode?: string;
}

function upDownCls(val?: number | null): string {
  if (val === undefined || val === null || val === 0) return 'text-[#8b949e]';
  return val > 0 ? 'text-[#ff3535]' : 'text-[#00c853]';
}

const HOT_TICKERS = [
  { code: '600519', name: '贵州茅台' },
  { code: '300750', name: '宁德时代' },
  { code: '002594', name: '比亚迪' },
  { code: '601138', name: '工业富联' },
  { code: '688256', name: '寒武纪' },
  { code: '510300', name: '沪深300ETF' },
];

export default function StockAnalysisPage({
  onSelectStock,
  initialTab = 'stock',
  defaultCode = '600519',
}: StockAnalysisPageProps) {
  const [activeTab, setActiveTab] = useState<'stock' | 'finance'>(initialTab);
  const [code, setCode] = useState(defaultCode || '600519');
  const [detail, setDetail] = useState<StockDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchItem[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const [chartMode, setChartMode] = useState<'kline' | 'intraday'>('kline');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string | null>(null);

  const stockChartRef = useRef<HTMLDivElement>(null);
  const revChartRef = useRef<HTMLDivElement>(null);
  const ratioChartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (defaultCode && defaultCode !== code) {
      setCode(defaultCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCode]);

  const loadDetail = useCallback(async (targetCode: string) => {
    setLoading(true);
    setError(null);
    setAiReply(null);
    try {
      const res = await api.getStockDetail(targetCode, { days: 120 });
      setDetail(res);
    } catch (e: any) {
      setError(e?.message || '加载个股深度研究数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDetail(code);
  }, [code, loadDetail]);

  useEffect(() => {
    const q = searchQ.trim();
    if (!q) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchStocks(q);
        setSearchResults(Array.isArray(res) ? res : []);
        setShowDropdown(true);
      } catch {
        setSearchResults([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQ]);

  const handleToggleWatchlist = async () => {
    if (!detail) return;
    try {
      if (detail.watchlistAdded) {
        await api.removeWatchlist(detail.code);
        setDetail({ ...detail, watchlistAdded: false });
      } else {
        await api.upsertWatchlist({ code: detail.code, name: detail.name });
        setDetail({ ...detail, watchlistAdded: true });
      }
    } catch {
      // ignore
    }
  };

  const handleRunAiDiagnosis = async () => {
    if (!detail) return;
    setAiLoading(true);
    try {
      const recentBars = detail.klines.slice(-10).map((b) => ({
        date: b.date,
        close: b.close,
        changePct: b.changePct,
        turnoverRate: b.turnoverRate,
      }));
      const prompt = `请以专业 A 股短线游资与机构量化双重视角，对 ${detail.name} (${detail.code}) 进行深度诊断：
1. 当前价格 ${detail.quote.price}（涨跌幅 ${detail.quote.changePct}%），换手率 ${detail.quote.turnoverRate}%，量比 ${detail.quote.volumeRatio}。
2. 量化评分：总分 ${detail.diagnosis?.totalScore ?? '-'}/100，支撑位 ${detail.diagnosis?.supportLevel ?? '-'}，压力位 ${detail.diagnosis?.resistanceLevel ?? '-'}，技术信号：${(detail.diagnosis?.signals || []).join('、')}。
3. 财务指标：PE ${detail.quote.pe ?? detail.financials?.pe ?? '-'}，PB ${detail.quote.pb ?? detail.financials?.pb ?? '-'}，ROE ${detail.financials?.roe ?? '-'}%，营收同比 ${detail.financials?.revenueYoY ?? '-'}%，净利同比 ${detail.financials?.netProfitYoY ?? '-'}%。
请输出：【趋势定性】【量价与筹码结构】【基本面护城河】【关键操作位与仓位建议】。`;

      const res = await api.chatAi([{ role: 'user', content: prompt }], {
        code: detail.code,
        name: detail.name,
        quote: detail.quote,
        recentBars,
      });
      setAiReply(res.reply);
      setAiModel(res.model);
    } catch (e: any) {
      setAiReply(`诊断请求失败: ${e?.message || '请检查 AI 配置'}`);
    } finally {
      setAiLoading(false);
    }
  };

  // Standard Wind/THS MA5=#fff, MA10=#f0b90b, MA20=#e879f9, MA60=#00e676 on #0d1015
  useEffect(() => {
    if (activeTab !== 'stock' || !stockChartRef.current || !detail) return;
    const chart = echarts.init(stockChartRef.current);

    if (chartMode === 'kline') {
      const bars = detail.klines || [];
      const dates = bars.map((b) => b.date);
      const ohlc = bars.map((b) => [b.open, b.close, b.low, b.high]);

      chart.setOption({
        backgroundColor: '#0d1015',
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'cross', lineStyle: { color: '#475569' } },
          backgroundColor: '#141923',
          borderColor: '#2b3342',
          textStyle: { color: '#e8edf5', fontSize: 11 },
        },
        legend: {
          data: ['日K', 'MA5', 'MA10', 'MA20', 'MA60'],
          top: 4,
          left: 8,
          textStyle: { color: '#8b95a5', fontSize: 11 },
        },
        grid: [
          { left: 52, right: 14, top: 30, height: '58%' },
          { left: 52, right: 14, top: '75%', height: '18%' },
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
            splitLine: { lineStyle: { color: '#1b212c', type: 'dashed' } },
            axisLabel: { color: '#8b95a5', fontSize: 10 },
          },
          {
            gridIndex: 1,
            splitNumber: 2,
            splitLine: { show: false },
            axisLabel: { show: false },
          },
        ],
        series: [
          {
            name: '日K',
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
            showSymbol: false,
            lineStyle: { width: 1.2, color: '#ffffff' },
            data: bars.map((b) => b.ma5 ?? null),
          },
          {
            name: 'MA10',
            type: 'line',
            showSymbol: false,
            lineStyle: { width: 1.2, color: '#f0b90b' },
            data: bars.map((b) => b.ma10 ?? null),
          },
          {
            name: 'MA20',
            type: 'line',
            showSymbol: false,
            lineStyle: { width: 1.2, color: '#e879f9' },
            data: bars.map((b) => b.ma20 ?? null),
          },
          {
            name: 'MA60',
            type: 'line',
            showSymbol: false,
            lineStyle: { width: 1.2, color: '#00e676' },
            data: bars.map((b) => b.ma60 ?? null),
          },
          {
            name: '成交量',
            type: 'bar',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: bars.map((b) => ({
              value: b.volume,
              itemStyle: { color: b.close >= b.open ? '#ff3535' : '#00c853' },
            })),
          },
        ],
      });
    } else {
      const pts = detail.intraday?.points || [];
      const prevClose = detail.intraday?.prevClose || detail.quote.prevClose || detail.quote.price;
      chart.setOption({
        backgroundColor: '#0d1015',
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#141923',
          borderColor: '#2b3342',
          textStyle: { color: '#e8edf5', fontSize: 11 },
        },
        legend: {
          data: ['分时价(白)', '均价(黄)'],
          top: 4,
          left: 8,
          textStyle: { color: '#8b95a5', fontSize: 11 },
        },
        grid: [
          { left: 52, right: 14, top: 30, height: '58%' },
          { left: 52, right: 14, top: '75%', height: '18%' },
        ],
        xAxis: [
          {
            type: 'category',
            data: pts.map((p) => p.time),
            axisLine: { lineStyle: { color: '#232a36' } },
            axisLabel: { show: false },
          },
          {
            type: 'category',
            gridIndex: 1,
            data: pts.map((p) => p.time),
            axisLine: { lineStyle: { color: '#232a36' } },
            axisLabel: { color: '#7d8796', fontSize: 10 },
          },
        ],
        yAxis: [
          {
            scale: true,
            splitLine: { lineStyle: { color: '#1b212c', type: 'dashed' } },
            axisLabel: { color: '#8b95a5', fontSize: 10 },
          },
          {
            gridIndex: 1,
            splitNumber: 2,
            splitLine: { show: false },
            axisLabel: { show: false },
          },
        ],
        series: [
          {
            name: '分时价(白)',
            type: 'line',
            showSymbol: false,
            lineStyle: { width: 1.5, color: '#ffffff' },
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { type: 'dashed', color: '#5c6675' },
              data: [{ yAxis: prevClose }],
            },
            data: pts.map((p) => p.price),
          },
          {
            name: '均价(黄)',
            type: 'line',
            showSymbol: false,
            lineStyle: { width: 1.3, color: '#f0b90b' },
            data: pts.map((p) => p.avgPrice),
          },
          {
            name: '成交量',
            type: 'bar',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: pts.map((p, idx) => ({
              value: p.volume,
              itemStyle: {
                color: idx === 0 || p.price >= pts[idx - 1].price ? '#ff3535' : '#00c853',
              },
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
  }, [activeTab, chartMode, detail]);

  useEffect(() => {
    if (activeTab !== 'finance' || !detail?.financials?.history?.length) return;
    const hist = detail.financials.history;
    const periods = hist.map((h) => h.period);

    let revChart: echarts.ECharts | null = null;
    let ratioChart: echarts.ECharts | null = null;

    if (revChartRef.current) {
      revChart = echarts.init(revChartRef.current);
      revChart.setOption({
        backgroundColor: '#0d1015',
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#141923',
          borderColor: '#2b3342',
          textStyle: { color: '#e8edf5', fontSize: 11 },
        },
        legend: {
          data: ['营业收入(亿)', '归母净利润(亿)', '营收同比(%)', '净利同比(%)'],
          top: 4,
          textStyle: { color: '#8b95a5', fontSize: 11 },
        },
        grid: { left: 48, right: 48, top: 36, bottom: 26 },
        xAxis: {
          type: 'category',
          data: periods,
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { color: '#8b95a5', fontSize: 10 },
        },
        yAxis: [
          {
            type: 'value',
            splitLine: { lineStyle: { color: '#1b212c', type: 'dashed' } },
            axisLabel: { color: '#8b95a5', fontSize: 10 },
          },
          {
            type: 'value',
            splitLine: { show: false },
            axisLabel: { color: '#f0b90b', fontSize: 10, formatter: '{value}%' },
          },
        ],
        series: [
          {
            name: '营业收入(亿)',
            type: 'bar',
            barMaxWidth: 22,
            itemStyle: { color: '#4da3ff' },
            data: hist.map((h) => Number((h.revenue / 1e8).toFixed(2))),
          },
          {
            name: '归母净利润(亿)',
            type: 'bar',
            barMaxWidth: 22,
            itemStyle: { color: '#ff3535' },
            data: hist.map((h) => Number((h.netProfit / 1e8).toFixed(2))),
          },
          {
            name: '营收同比(%)',
            type: 'line',
            yAxisIndex: 1,
            itemStyle: { color: '#f0b90b' },
            data: hist.map((h) => Number(h.revenueYoY.toFixed(2))),
          },
          {
            name: '净利同比(%)',
            type: 'line',
            yAxisIndex: 1,
            itemStyle: { color: '#e879f9' },
            data: hist.map((h) => Number(h.netProfitYoY.toFixed(2))),
          },
        ],
      });
    }

    if (ratioChartRef.current) {
      ratioChart = echarts.init(ratioChartRef.current);
      ratioChart.setOption({
        backgroundColor: '#0d1015',
        tooltip: {
          trigger: 'axis',
          backgroundColor: '#141923',
          borderColor: '#2b3342',
          textStyle: { color: '#e8edf5', fontSize: 11 },
        },
        legend: {
          data: ['ROE(%)', '销售毛利率(%)', '资产负债率(%)'],
          top: 4,
          textStyle: { color: '#8b95a5', fontSize: 11 },
        },
        grid: { left: 48, right: 20, top: 36, bottom: 26 },
        xAxis: {
          type: 'category',
          data: periods,
          axisLine: { lineStyle: { color: '#232a36' } },
          axisLabel: { color: '#8b95a5', fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: '#1b212c', type: 'dashed' } },
          axisLabel: { color: '#8b95a5', fontSize: 10, formatter: '{value}%' },
        },
        series: [
          {
            name: 'ROE(%)',
            type: 'line',
            itemStyle: { color: '#ff3535' },
            lineStyle: { width: 2, color: '#ff3535' },
            data: hist.map((h) => Number(h.roe.toFixed(2))),
          },
          {
            name: '销售毛利率(%)',
            type: 'line',
            itemStyle: { color: '#4da3ff' },
            lineStyle: { width: 1.8, color: '#4da3ff' },
            data: hist.map((h) => Number(h.grossMargin.toFixed(2))),
          },
          {
            name: '资产负债率(%)',
            type: 'line',
            itemStyle: { color: '#00c853' },
            lineStyle: { width: 1.5, type: 'dashed', color: '#00c853' },
            data: hist.map((h) => Number(h.debtRatio.toFixed(2))),
          },
        ],
      });
    }

    const onResize = () => {
      revChart?.resize();
      ratioChart?.resize();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      revChart?.dispose();
      ratioChart?.dispose();
    };
  }, [activeTab, detail]);

  const maChecks = useMemo(() => {
    if (!detail?.klines?.length) return [];
    const last = detail.klines[detail.klines.length - 1];
    const p = detail.quote.price || last.close;
    return [
      {
        label: '现价 >= MA5',
        ok: last.ma5 ? p >= last.ma5 : false,
        detail: last.ma5 ? `${p.toFixed(2)} / ${last.ma5.toFixed(2)}` : '-',
      },
      {
        label: 'MA5 >= MA10',
        ok: last.ma5 && last.ma10 ? last.ma5 >= last.ma10 : false,
        detail: last.ma5 && last.ma10 ? `${last.ma5.toFixed(2)} / ${last.ma10.toFixed(2)}` : '-',
      },
      {
        label: 'MA10 >= MA20',
        ok: last.ma10 && last.ma20 ? last.ma10 >= last.ma20 : false,
        detail:
          last.ma10 && last.ma20 ? `${last.ma10.toFixed(2)} / ${last.ma20.toFixed(2)}` : '-',
      },
      {
        label: 'MA20 >= MA60',
        ok: last.ma20 && last.ma60 ? last.ma20 >= last.ma60 : false,
        detail:
          last.ma20 && last.ma60 ? `${last.ma20.toFixed(2)} / ${last.ma60.toFixed(2)}` : '-',
      },
    ];
  }, [detail]);

  return (
    <div className="h-full w-full flex flex-col bg-[#222832] gap-[1px] overflow-hidden">
      {/* Top 28px Wind F9/F10 Bar */}
      <div className="h-[28px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center h-full gap-3">
          <div className="flex items-center">
            <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
            <span className="text-[12px] font-bold text-[#dfe6f0]">
              F9/F10 个股深度资料与财务透视
            </span>
          </div>

          <div className="flex items-center h-full border-l border-[#232a36]">
            <button
              onClick={() => setActiveTab('stock')}
              className={`h-full px-3 text-[11px] font-medium border-r border-[#232a36] ${
                activeTab === 'stock'
                  ? 'bg-[#0e1117] text-[#ff9500] border-t-2 border-t-[#ff8800]'
                  : 'text-[#8b95a5] hover:text-[#e8edf5]'
              }`}
            >
              [F9] 个股全景诊断
            </button>
            <button
              onClick={() => setActiveTab('finance')}
              className={`h-full px-3 text-[11px] font-medium border-r border-[#232a36] ${
                activeTab === 'finance'
                  ? 'bg-[#0e1117] text-[#ff9500] border-t-2 border-t-[#ff8800]'
                  : 'text-[#8b95a5] hover:text-[#e8edf5]'
              }`}
            >
              [F10] 财务深度分析
            </button>
          </div>

          <div className="flex items-center gap-1 border-l border-[#232a36] pl-2.5">
            {HOT_TICKERS.map((t) => (
              <button
                key={t.code}
                onClick={() => setCode(t.code)}
                className={`px-1.5 h-[20px] rounded-[2px] text-[11px] border ${
                  code === t.code
                    ? 'bg-[#0e1117] border-[#ff8800] text-[#ff9500]'
                    : 'border-[#2b3342] text-[#8b95a5] hover:text-[#e8edf5]'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div className="relative w-56">
          <input
            type="text"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="切换代码/名称..."
            className="w-full h-[22px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-2 text-[11px] text-[#e8edf5] placeholder-[#5c6675] focus:outline-none"
          />
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-[24px] z-40 bg-[#141923] border border-[#ff8800] max-h-64 overflow-y-auto">
              {searchResults.map((s) => (
                <button
                  key={s.code}
                  onClick={() => {
                    setCode(s.code);
                    setSearchQ('');
                    setShowDropdown(false);
                  }}
                  className="w-full h-[26px] flex items-center justify-between px-2 hover:bg-[#1b2434] text-left text-[11px] border-b border-[#181d26]"
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
      </div>

      {error ? (
        <div className="flex-1 bg-[#0e1117] p-8 text-center text-[12px] text-[#ff3535]">
          {error}
        </div>
      ) : loading || !detail ? (
        <div className="flex-1 bg-[#0e1117] p-10 text-center text-[12px] text-[#7d8796]">
          正在加载 {code} 深度行情与 F10 基本面数据...
        </div>
      ) : (
        <>
          {/* Compact 36px Stock Header Strip */}
          <div className="h-[36px] bg-[#0e1117] px-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono text-[13px] font-bold text-[#e5b567]">{detail.code}</span>
              <span className="text-[13px] font-bold text-[#e8edf5]">{detail.name}</span>
              <span
                className={`font-mono text-[15px] font-bold tabular-nums ${upDownCls(
                  detail.quote.changePct
                )}`}
              >
                {detail.quote.price.toFixed(2)}
              </span>
              <span
                className={`font-mono text-[12px] font-semibold tabular-nums ${upDownCls(
                  detail.quote.changePct
                )}`}
              >
                {detail.quote.change >= 0 ? '+' : ''}
                {detail.quote.change.toFixed(2)} ({formatPct(detail.quote.changePct)})
              </span>
              <div className="hidden xl:flex items-center gap-3 text-[11px] font-mono tabular-nums text-[#8b95a5] border-l border-[#222832] pl-3">
                <span>
                  换手 <b className="text-[#f0b90b]">{detail.quote.turnoverRate.toFixed(2)}%</b>
                </span>
                <span>
                  量比 <b className="text-[#4da3ff]">{detail.quote.volumeRatio.toFixed(2)}</b>
                </span>
                <span>
                  成交额 <b className="text-[#f0b90b]">{formatAmount(detail.quote.amount)}</b>
                </span>
                <span>
                  总市值 <b className="text-[#dfe6f0]">{formatAmount(detail.quote.marketCap)}</b>
                </span>
                <span>PE {detail.quote.pe ? detail.quote.pe.toFixed(1) : '-'}</span>
                <span>PB {detail.quote.pb ? detail.quote.pb.toFixed(2) : '-'}</span>
                {detail.industry && (
                  <span className="px-1.5 py-0.5 rounded-[2px] border border-[#2b3342] text-[#4da3ff]">
                    {detail.industry}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleToggleWatchlist}
                className={`h-[24px] px-2.5 rounded-[2px] text-[11px] border ${
                  detail.watchlistAdded
                    ? 'border-[#f0b90b] text-[#f0b90b] bg-[#211b0c]'
                    : 'border-[#2b3342] text-[#dfe6f0] hover:border-[#ff8800]'
                }`}
              >
                {detail.watchlistAdded ? '已自选' : '+自选'}
              </button>
              <button
                onClick={() => onSelectStock(detail.code, detail.name)}
                className="h-[24px] px-2.5 rounded-[2px] bg-[#ff8800] text-[#090c10] text-[11px] font-bold hover:bg-[#ff9922]"
              >
                F5 双栏看盘窗
              </button>
            </div>
          </div>

          {activeTab === 'stock' ? (
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-[1px] bg-[#222832] overflow-hidden">
              {/* Left 8 cols: Chart + AI Diagnosis */}
              <div className="lg:col-span-8 flex flex-col gap-[1px] bg-[#222832] min-h-0 overflow-hidden">
                <div className="bg-[#0e1117] flex flex-col flex-1 min-h-[280px]">
                  <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0">
                    <div className="flex items-center">
                      <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
                      <span className="text-[12px] font-bold text-[#dfe6f0]">
                        K线与分时走势图
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setChartMode('kline')}
                        className={`px-2 h-[20px] rounded-[2px] text-[11px] border ${
                          chartMode === 'kline'
                            ? 'bg-[#0e1117] border-[#ff8800] text-[#ff9500]'
                            : 'border-[#2b3342] text-[#8b95a5]'
                        }`}
                      >
                        日K线(MA)
                      </button>
                      <button
                        onClick={() => setChartMode('intraday')}
                        className={`px-2 h-[20px] rounded-[2px] text-[11px] border ${
                          chartMode === 'intraday'
                            ? 'bg-[#0e1117] border-[#ff8800] text-[#ff9500]'
                            : 'border-[#2b3342] text-[#8b95a5]'
                        }`}
                      >
                        分时走势
                      </button>
                    </div>
                  </div>
                  <div ref={stockChartRef} className="w-full flex-1 min-h-0" />
                </div>

                {/* AI Research Terminal */}
                <div className="h-[210px] bg-[#0e1117] flex flex-col shrink-0">
                  <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="w-[2px] h-3 bg-[#ff8800] inline-block" />
                      <span className="text-[12px] font-bold text-[#dfe6f0]">
                        AI 量化深度诊股研报
                      </span>
                      {aiModel && (
                        <span className="text-[10px] font-mono text-[#4da3ff]">[{aiModel}]</span>
                      )}
                    </div>
                    <button
                      onClick={handleRunAiDiagnosis}
                      disabled={aiLoading}
                      className="px-2.5 h-[20px] rounded-[2px] bg-[#ff8800] text-[#090c10] text-[11px] font-bold hover:bg-[#ff9922] disabled:opacity-60"
                    >
                      {aiLoading ? 'AI推理中...' : '生成AI诊断'}
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto p-2.5 text-[12px] leading-relaxed text-[#dfe6f0] whitespace-pre-wrap">
                    {aiReply ||
                      '点击右侧 [生成AI诊断] 按钮，自动综合近10日K线、量价换手、支撑压力位及F10财务数据生成操作简报。'}
                  </div>
                </div>
              </div>

              {/* Right 4 cols: Quant Score + Support/Resistance + MA Checklist */}
              <div className="lg:col-span-4 flex flex-col gap-[1px] bg-[#222832] min-h-0 overflow-y-auto">
                {detail.diagnosis && (
                  <div className="bg-[#0e1117] flex flex-col">
                    <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between">
                      <div className="flex items-center">
                        <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
                        <span className="text-[12px] font-bold text-[#dfe6f0]">
                          多维量化综合评分
                        </span>
                      </div>
                      <span className="font-mono text-[13px] font-bold text-[#f0b90b]">
                        {detail.diagnosis.totalScore} / 100
                      </span>
                    </div>

                    <div className="p-2.5 space-y-2 text-[12px]">
                      {[
                        { label: '趋势强度', val: detail.diagnosis.trendScore, color: '#ff3535' },
                        { label: '量价配合', val: detail.diagnosis.volumeScore, color: '#f0b90b' },
                        { label: '筹码结构', val: detail.diagnosis.chipScore, color: '#4da3ff' },
                        { label: '涨停基因', val: detail.diagnosis.limitGeneScore, color: '#e879f9' },
                      ].map((bar) => (
                        <div key={bar.label} className="space-y-1">
                          <div className="flex justify-between text-[11px]">
                            <span className="text-[#8b95a5]">{bar.label}</span>
                            <span className="font-mono text-[#e8edf5]">{bar.val}</span>
                          </div>
                          <div className="w-full h-[5px] bg-[#1a202c]">
                            <div
                              className="h-full"
                              style={{
                                width: `${Math.min(100, Math.max(0, bar.val))}%`,
                                backgroundColor: bar.color,
                              }}
                            />
                          </div>
                        </div>
                      ))}

                      <div className="grid grid-cols-2 gap-[1px] bg-[#222832] border border-[#232a36] mt-2">
                        <div className="bg-[#11151d] p-2">
                          <div className="text-[10px] text-[#00c853]">核心支撑位</div>
                          <div className="font-mono text-[14px] font-bold text-[#e8edf5] mt-0.5">
                            {detail.diagnosis.supportLevel.toFixed(2)}
                          </div>
                          <div className="font-mono text-[10px] text-[#7d8796]">
                            距现价{' '}
                            {(
                              ((detail.diagnosis.supportLevel - detail.quote.price) /
                                detail.quote.price) *
                              100
                            ).toFixed(1)}
                            %
                          </div>
                        </div>
                        <div className="bg-[#11151d] p-2">
                          <div className="text-[10px] text-[#ff3535]">上方压力位</div>
                          <div className="font-mono text-[14px] font-bold text-[#e8edf5] mt-0.5">
                            {detail.diagnosis.resistanceLevel.toFixed(2)}
                          </div>
                          <div className="font-mono text-[10px] text-[#7d8796]">
                            距现价 +
                            {(
                              ((detail.diagnosis.resistanceLevel - detail.quote.price) /
                                detail.quote.price) *
                              100
                            ).toFixed(1)}
                            %
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1 pt-1">
                        {(detail.diagnosis.signals || []).map((sig, i) => (
                          <span
                            key={i}
                            className="text-[10px] px-1.5 py-0.5 rounded-[2px] bg-[#161b24] border border-[#2b3342] text-[#4da3ff]"
                          >
                            {sig}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-[#0e1117] flex-1 flex flex-col">
                  <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center">
                    <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
                    <span className="text-[12px] font-bold text-[#dfe6f0]">均线多头排列核验</span>
                  </div>
                  <table className="w-full text-left border-collapse text-[12px] tabular-nums">
                    <tbody>
                      {maChecks.map((chk) => (
                        <tr
                          key={chk.label}
                          className="h-[26px] border-b border-[#181d26] even:bg-[#11151d]"
                        >
                          <td className="px-2.5 text-[#dfe6f0]">{chk.label}</td>
                          <td className="px-2.5 font-mono text-[11px] text-[#8b95a5] text-right">
                            {chk.detail}
                          </td>
                          <td
                            className={`px-2.5 text-right font-mono font-bold w-12 ${
                              chk.ok ? 'text-[#ff3535]' : 'text-[#00c853]'
                            }`}
                          >
                            {chk.ok ? '多' : '空'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {(detail.concepts || []).length > 0 && (
                    <div className="p-2.5 border-t border-[#232a36]">
                      <div className="text-[11px] text-[#7d8796] mb-1.5">所属核心概念:</div>
                      <div className="flex flex-wrap gap-1">
                        {(detail.concepts || []).map((c) => (
                          <span
                            key={c}
                            className="text-[10px] px-1.5 py-0.5 rounded-[2px] bg-[#151a23] border border-[#252c38] text-[#dfe6f0]"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* F10 Finance Tab */
            <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-y-auto">
              {detail.financials ? (
                <>
                  {/* 8-cell Finance KPI Strip */}
                  <div className="grid grid-cols-4 lg:grid-cols-8 gap-[1px] bg-[#222832] shrink-0">
                    {[
                      { label: '最新报告期', val: detail.financials.reportDate, cls: 'text-[#dfe6f0]' },
                      {
                        label: '营业收入',
                        val: formatAmount(detail.financials.revenue),
                        cls: 'text-[#e8edf5]',
                      },
                      {
                        label: '营收同比',
                        val: formatPct(detail.financials.revenueYoY),
                        cls: upDownCls(detail.financials.revenueYoY),
                      },
                      {
                        label: '归母净利润',
                        val: formatAmount(detail.financials.netProfit),
                        cls: 'text-[#e8edf5]',
                      },
                      {
                        label: '净利同比',
                        val: formatPct(detail.financials.netProfitYoY),
                        cls: upDownCls(detail.financials.netProfitYoY),
                      },
                      {
                        label: 'ROE',
                        val: `${detail.financials.roe.toFixed(2)}%`,
                        cls: detail.financials.roe >= 15 ? 'text-[#ff3535]' : 'text-[#e8edf5]',
                      },
                      {
                        label: '毛利率',
                        val: `${detail.financials.grossMargin.toFixed(2)}%`,
                        cls: 'text-[#4da3ff]',
                      },
                      {
                        label: '负债率',
                        val: `${detail.financials.debtRatio.toFixed(2)}%`,
                        cls: detail.financials.debtRatio > 70 ? 'text-[#f0b90b]' : 'text-[#00c853]',
                      },
                    ].map((kpi) => (
                      <div key={kpi.label} className="bg-[#0e1117] px-2.5 py-2">
                        <div className="text-[10px] text-[#7d8796]">{kpi.label}</div>
                        <div className={`text-[13px] font-bold font-mono tabular-nums mt-0.5 ${kpi.cls}`}>
                          {kpi.val}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Charts */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-[1px] bg-[#222832] shrink-0">
                    <div className="bg-[#0e1117] flex flex-col">
                      <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center">
                        <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
                        <span className="text-[12px] font-bold text-[#dfe6f0]">
                          营收与归母净利润成长趋势 (亿元 / 同比%)
                        </span>
                      </div>
                      <div ref={revChartRef} className="w-full h-[220px]" />
                    </div>

                    <div className="bg-[#0e1117] flex flex-col">
                      <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center">
                        <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
                        <span className="text-[12px] font-bold text-[#dfe6f0]">
                          盈利质量 (ROE / 毛利率) 与资产负债率
                        </span>
                      </div>
                      <div ref={ratioChartRef} className="w-full h-[220px]" />
                    </div>
                  </div>

                  {/* DuPont + History Table */}
                  <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-[1px] bg-[#222832]">
                    <div className="lg:col-span-4 bg-[#0e1117] flex flex-col">
                      <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between">
                        <div className="flex items-center">
                          <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
                          <span className="text-[12px] font-bold text-[#dfe6f0]">
                            杜邦财务排雷核验
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-[#7d8796]">
                          EPS ¥{detail.financials.eps.toFixed(2)}
                        </span>
                      </div>
                      <table className="w-full text-left border-collapse text-[12px] tabular-nums">
                        <tbody>
                          {[
                            {
                              label: 'ROE >= 12% 高净资产收益',
                              ok: detail.financials.roe >= 12,
                              val: `${detail.financials.roe.toFixed(2)}%`,
                            },
                            {
                              label: '毛利率 >= 30% 定价权',
                              ok: detail.financials.grossMargin >= 30,
                              val: `${detail.financials.grossMargin.toFixed(2)}%`,
                            },
                            {
                              label: '负债率 <= 65% 低杠杆',
                              ok: detail.financials.debtRatio <= 65,
                              val: `${detail.financials.debtRatio.toFixed(2)}%`,
                            },
                            {
                              label: '净利同比 > 0 利润增长',
                              ok: detail.financials.netProfitYoY > 0,
                              val: formatPct(detail.financials.netProfitYoY),
                            },
                          ].map((row) => (
                            <tr
                              key={row.label}
                              className="h-[26px] border-b border-[#181d26] even:bg-[#11151d]"
                            >
                              <td className="px-2.5 text-[#dfe6f0]">{row.label}</td>
                              <td className="px-2.5 text-right font-mono text-[#e8edf5]">
                                {row.val}
                              </td>
                              <td
                                className={`px-2.5 text-right font-mono font-bold w-12 ${
                                  row.ok ? 'text-[#ff3535]' : 'text-[#7d8796]'
                                }`}
                              >
                                {row.ok ? '达标' : '偏弱'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="lg:col-span-8 bg-[#0e1117] flex flex-col overflow-hidden">
                      <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center">
                        <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
                        <span className="text-[12px] font-bold text-[#dfe6f0]">
                          F10 历史报告期核心财务指标表
                        </span>
                      </div>
                      <div className="flex-1 overflow-auto">
                        <table className="w-full text-left border-collapse text-[12px] tabular-nums font-mono">
                          <thead className="sticky top-0 bg-[#151a23] border-b border-[#252c38] text-[11px] text-[#8b95a5] font-sans">
                            <tr className="h-[26px]">
                              <th className="px-2.5">报告期</th>
                              <th className="px-2.5 text-right">营业收入</th>
                              <th className="px-2.5 text-right">营收同比</th>
                              <th className="px-2.5 text-right">归母净利润</th>
                              <th className="px-2.5 text-right">净利同比</th>
                              <th className="px-2.5 text-right">ROE</th>
                              <th className="px-2.5 text-right">毛利率</th>
                              <th className="px-2.5 text-right">负债率</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.financials.history.map((h) => (
                              <tr
                                key={h.period}
                                className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434]"
                              >
                                <td className="px-2.5 text-[#dfe6f0]">{h.period}</td>
                                <td className="px-2.5 text-right text-[#e8edf5]">
                                  {formatAmount(h.revenue)}
                                </td>
                                <td className={`px-2.5 text-right ${upDownCls(h.revenueYoY)}`}>
                                  {formatPct(h.revenueYoY)}
                                </td>
                                <td className="px-2.5 text-right text-[#e8edf5]">
                                  {formatAmount(h.netProfit)}
                                </td>
                                <td className={`px-2.5 text-right ${upDownCls(h.netProfitYoY)}`}>
                                  {formatPct(h.netProfitYoY)}
                                </td>
                                <td className="px-2.5 text-right text-[#ff3535]">
                                  {h.roe.toFixed(2)}%
                                </td>
                                <td className="px-2.5 text-right text-[#4da3ff]">
                                  {h.grossMargin.toFixed(2)}%
                                </td>
                                <td className="px-2.5 text-right text-[#8b95a5]">
                                  {h.debtRatio.toFixed(2)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 bg-[#0e1117] p-10 text-center text-[12px] text-[#7d8796]">
                  当前标的暂无详细财务报表数据
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
