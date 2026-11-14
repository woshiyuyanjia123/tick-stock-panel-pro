import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatAmount, formatPct } from '../api/client';
import type { BoardFilter, LadderPool, LadderResponse, LadderStockItem } from '../types/market';

interface LimitUpLadderPageProps {
  onSelectStock: (code: string, name?: string, date?: string) => void;
}

const BOARD_FILTERS: { id: BoardFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'main', label: 'A主板' },
  { id: 'chinext', label: '创业板' },
  { id: 'star', label: '科创板' },
  { id: 'bse', label: '北交所' },
  { id: 'st', label: 'ST' },
];

function windColor(val?: number | null): string {
  if (val === undefined || val === null || val === 0) return 'text-[#8b949e]';
  return val > 0 ? 'text-[#ff3535]' : 'text-[#00c853]';
}

function getBoardTag(stock: LadderStockItem): { text: string; cls: string } | null {
  const b = stock.boardBadge;
  if (b === '创' || stock.board === 'chinext') {
    return { text: '创', cls: 'text-[#4da3ff] border-[#4da3ff]/40 bg-[#4da3ff]/10' };
  }
  if (b === '科' || stock.board === 'star') {
    return { text: '科', cls: 'text-[#00c853] border-[#00c853]/40 bg-[#00c853]/10' };
  }
  if (b === '北' || stock.board === 'bse') {
    return { text: '北', cls: 'text-[#e5b567] border-[#e5b567]/40 bg-[#e5b567]/10' };
  }
  if (b === 'ST' || stock.board === 'st') {
    return { text: 'ST', cls: 'text-[#f0b90b] border-[#f0b90b]/40 bg-[#f0b90b]/10' };
  }
  return null;
}

export default function LimitUpLadderPage({ onSelectStock }: LimitUpLadderPageProps) {
  const [pool, setPool] = useState<LadderPool>('zt');
  const [board, setBoard] = useState<BoardFilter>('all');
  const [viewMode, setViewMode] = useState<'table' | 'matrix'>('table');
  const [tagMode, setTagMode] = useState<'concept' | 'industry'>('concept');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [data, setData] = useState<LadderResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedConcept, setSelectedConcept] = useState<string | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState<boolean>(false);
  const [auditCollapsed, setAuditCollapsed] = useState<boolean>(false);
  const [collapsedTiers, setCollapsedTiers] = useState<Record<string, boolean>>({});

  const fetchLadder = useCallback(
    async (opts?: { date?: string; pool?: LadderPool; board?: BoardFilter }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.getLadder({
          date: (opts?.date ?? selectedDate) || undefined,
          pool: opts?.pool ?? pool,
          board: opts?.board ?? board,
        });
        setData(res);
        if (!selectedDate && res?.date) {
          setSelectedDate(res.date);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载连板梯队失败');
      } finally {
        setLoading(false);
      }
    },
    [selectedDate, pool, board]
  );

  useEffect(() => {
    fetchLadder({ date: selectedDate, pool, board });
  }, [pool, board, selectedDate, fetchLadder]);

  const handlePoolChange = (nextPool: LadderPool) => {
    setPool(nextPool);
    setSelectedConcept(null);
    setSelectedIndustry(null);
    setCollapsedTiers({});
  };

  const filterStock = useCallback(
    (s: LadderStockItem) => {
      if (selectedConcept && !(s.concepts ?? []).includes(selectedConcept)) return false;
      if (selectedIndustry && s.industry !== selectedIndustry) return false;
      return true;
    },
    [selectedConcept, selectedIndustry]
  );

  const displayTiers = useMemo(() => {
    const rawTiers = data?.tiers ?? [];
    if (rawTiers.length > 0) {
      return rawTiers
        .map((t) => ({
          key: `${pool}-${t.streak}-${t.label}`,
          streak: t.streak,
          label: t.label,
          stocks: (t.stocks ?? []).filter(filterStock),
        }))
        .filter((t) => t.stocks.length > 0);
    }
    const stocks = (data?.stocks ?? []).filter(filterStock);
    if (stocks.length === 0) return [];
    if (pool === 'zb') {
      return [{ key: 'zb-all', streak: 0, label: '触板/炸板', stocks }];
    }
    const map = new Map<number, LadderStockItem[]>();
    for (const s of stocks) {
      const k = pool === 'db' ? s.yesterdayStreak ?? s.streak ?? 1 : s.streak ?? 1;
      const arr = map.get(k) ?? [];
      arr.push(s);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([streak, list]) => ({
        key: `${pool}-${streak}`,
        streak,
        label:
          pool === 'db'
            ? `昨日${streak}板`
            : streak <= 1
              ? '首板'
              : `${streak}板`,
        stocks: list,
      }));
  }, [data, pool, filterStock]);

  const flatStocks = useMemo(() => {
    const out: { stock: LadderStockItem; tierLabel: string }[] = [];
    for (const t of displayTiers) {
      for (const s of t.stocks) {
        out.push({ stock: s, tierLabel: t.label });
      }
    }
    return out;
  }, [displayTiers]);

  const tierCounts = data?.tierCounts ?? [];
  const conceptDist = data?.conceptDist ?? [];
  const industryDist = data?.industryDist ?? [];
  const visibleConcepts = tagsExpanded ? conceptDist : conceptDist.slice(0, 20);
  const visibleIndustries = tagsExpanded ? industryDist : industryDist.slice(0, 16);

  return (
    <div className="min-h-full bg-[#222832] flex flex-col gap-[1px] text-[#dfe6f0]">
      {/* Top 28px Wind Control Strip */}
      <div className="bg-[#161b24] px-2.5 flex flex-wrap items-center justify-between gap-2 min-h-[28px] shrink-0">
        <div className="flex items-center gap-0">
          <span className="w-title-bar mr-3">涨停复盘 · 连板天梯</span>
          <button
            type="button"
            onClick={() => handlePoolChange('zt')}
            className={`w-tab ${pool === 'zt' ? 'w-tab-active' : ''}`}
          >
            涨停池 <span className="ml-1 font-mono text-[#ff3535]">{data?.limitUpCount ?? 0}</span>
          </button>
          <button
            type="button"
            onClick={() => handlePoolChange('zb')}
            className={`w-tab ${pool === 'zb' ? 'w-tab-active' : ''}`}
          >
            炸板池 <span className="ml-1 font-mono text-[#f0b90b]">{data?.brokenCount ?? 0}</span>
          </button>
          <button
            type="button"
            onClick={() => handlePoolChange('db')}
            className={`w-tab ${pool === 'db' ? 'w-tab-active' : ''}`}
          >
            断板池 <span className="ml-1 font-mono text-[#4da3ff]">{data?.brokenStreakCount ?? 0}</span>
          </button>
          <span className="ml-3 text-[11px] font-mono text-[#8b95a5]">
            跌停 <strong className="text-[#00c853]">{data?.limitDownCount ?? 0}</strong> · 封板率{' '}
            <strong className="text-[#4da3ff]">{(data?.sealRate ?? 0).toFixed(1)}%</strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 py-0.5 text-[11px]">
          {/* Board Filter Pills */}
          <div className="flex items-center gap-0.5">
            {BOARD_FILTERS.map((bf) => (
              <button
                key={bf.id}
                type="button"
                onClick={() => setBoard(bf.id)}
                className={`h-5 px-2 border rounded-[2px] ${
                  board === bf.id
                    ? 'bg-[#0e1117] border-[#ff8800] text-[#ff9500] font-semibold'
                    : 'bg-[#151a23] border-[#252c38] text-[#8b95a5] hover:text-[#dfe6f0]'
                }`}
              >
                {bf.label}
              </button>
            ))}
          </div>

          <span className="text-[#2b3444]">|</span>

          {/* View Mode Switch */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`h-5 px-2 border rounded-[2px] ${
                viewMode === 'table'
                  ? 'bg-[#0e1117] border-[#4da3ff] text-[#4da3ff] font-semibold'
                  : 'bg-[#151a23] border-[#252c38] text-[#8b95a5]'
              }`}
            >
              报价表
            </button>
            <button
              type="button"
              onClick={() => setViewMode('matrix')}
              className={`h-5 px-2 border rounded-[2px] ${
                viewMode === 'matrix'
                  ? 'bg-[#0e1117] border-[#4da3ff] text-[#4da3ff] font-semibold'
                  : 'bg-[#151a23] border-[#252c38] text-[#8b95a5]'
              }`}
            >
              天梯矩阵
            </button>
          </div>

          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-5 px-1.5 bg-[#0e1117] border border-[#252c38] rounded-[2px] font-mono text-[#dfe6f0] focus:outline-none [color-scheme:dark]"
          />

          <button
            type="button"
            onClick={() => fetchLadder({ date: selectedDate, pool, board })}
            disabled={loading}
            className="h-5 px-2 bg-[#151a23] hover:bg-[#1b2230] border border-[#252c38] rounded-[2px] text-[#dfe6f0] disabled:opacity-50"
          >
            {loading ? '刷新中' : '刷新'}
          </button>
        </div>
      </div>

      {/* Tier Summary & Provenance Strip */}
      <div className="bg-[#0e1117] px-2.5 py-1.5 space-y-1 text-[11px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 font-mono">
            <span className="text-[#ff9500] font-semibold">梯队分布:</span>
            {tierCounts.length > 0 ? (
              tierCounts.map((tc) => (
                <span
                  key={tc.streak}
                  className="px-1.5 py-0 bg-[#151a23] border border-[#252c38] rounded-[2px]"
                >
                  <span className={tc.streak >= 3 ? 'text-[#ff3535] font-semibold' : 'text-[#dfe6f0]'}>
                    {tc.label}
                  </span>{' '}
                  <strong className="text-[#f0b90b]">{tc.count}</strong>
                </span>
              ))
            ) : (
              <span className="text-[#7d8796]">
                当前展示 {flatStocks.length} 只 ({data?.date || selectedDate || '--'})
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setAuditCollapsed((v) => !v)}
            className="text-[#7d8796] hover:text-[#dfe6f0] font-mono"
          >
            {auditCollapsed ? '[+] 核验口径' : '[-] 收起口径'}
          </button>
        </div>

        {!auditCollapsed && (
          <div className="bg-[#11151d] border border-[#222832] px-2 py-1 text-[11px] text-[#9aa5b5] leading-snug">
            <span className="text-[#f0b90b] font-mono mr-2">
              [{data?.date || selectedDate || '--'} {data?.updatedAt || ''}]
            </span>
            {data?.auditNote ??
              '已核验涨停池、炸板池与昨日连板断板池，历史与实时数据不混用；行业统一采用通达信三级分类。'}
          </div>
        )}
      </div>

      {/* Compact Inline Concept / Industry Filter Bar */}
      <div className="bg-[#0e1117] px-2.5 py-1.5 space-y-1.5 text-[11px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[#8b95a5] font-semibold">标签筛选:</span>
            <button
              type="button"
              onClick={() => setTagMode('concept')}
              className={`px-2 py-0 border rounded-[2px] ${
                tagMode === 'concept'
                  ? 'bg-[#151a23] border-[#ff8800] text-[#ff9500]'
                  : 'bg-[#0e1117] border-[#252c38] text-[#8b95a5]'
              }`}
            >
              概念分布({conceptDist.length})
            </button>
            <button
              type="button"
              onClick={() => setTagMode('industry')}
              className={`px-2 py-0 border rounded-[2px] ${
                tagMode === 'industry'
                  ? 'bg-[#151a23] border-[#4da3ff] text-[#4da3ff]'
                  : 'bg-[#0e1117] border-[#252c38] text-[#8b95a5]'
              }`}
            >
              行业分布({industryDist.length})
            </button>

            {(selectedConcept || selectedIndustry) && (
              <>
                <span className="text-[#2b3444]">|</span>
                {selectedConcept && (
                  <button
                    type="button"
                    onClick={() => setSelectedConcept(null)}
                    className="px-1.5 py-0 bg-[#ff8800]/15 border border-[#ff8800]/50 text-[#ff9500] rounded-[2px]"
                  >
                    概念:{selectedConcept} [x]
                  </button>
                )}
                {selectedIndustry && (
                  <button
                    type="button"
                    onClick={() => setSelectedIndustry(null)}
                    className="px-1.5 py-0 bg-[#4da3ff]/15 border border-[#4da3ff]/50 text-[#4da3ff] rounded-[2px]"
                  >
                    行业:{selectedIndustry} [x]
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedConcept(null);
                    setSelectedIndustry(null);
                  }}
                  className="text-[#8b95a5] hover:text-white underline"
                >
                  重置
                </button>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setTagsExpanded((v) => !v)}
            className="text-[#7d8796] hover:text-[#dfe6f0] font-mono"
          >
            {tagsExpanded ? '收起标签' : '展开全部'}
          </button>
        </div>

        {tagMode === 'concept' ? (
          <div className="flex flex-wrap gap-1">
            {visibleConcepts.length > 0 ? (
              visibleConcepts.map((c) => {
                const active = selectedConcept === c.name;
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => setSelectedConcept((p) => (p === c.name ? null : c.name))}
                    className={`px-1.5 py-0 border rounded-[2px] transition-colors ${
                      active
                        ? 'bg-[#ff8800]/20 border-[#ff8800] text-[#ff9500] font-semibold'
                        : 'bg-[#151a23] border-[#252c38] text-[#e5b567] hover:border-[#e5b567]/60'
                    }`}
                  >
                    {c.name} <span className="font-mono text-[#8b95a5]">{c.count}</span>
                  </button>
                );
              })
            ) : (
              <span className="text-[#7d8796]">暂无概念分布</span>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {visibleIndustries.length > 0 ? (
              visibleIndustries.map((ind) => {
                const active = selectedIndustry === ind.name;
                return (
                  <button
                    key={ind.name}
                    type="button"
                    onClick={() => setSelectedIndustry((p) => (p === ind.name ? null : ind.name))}
                    className={`px-1.5 py-0 border rounded-[2px] transition-colors ${
                      active
                        ? 'bg-[#4da3ff]/20 border-[#4da3ff] text-[#4da3ff] font-semibold'
                        : 'bg-[#151a23] border-[#252c38] text-[#4da3ff] hover:border-[#4da3ff]/60'
                    }`}
                  >
                    {ind.name} <span className="font-mono text-[#8b95a5]">{ind.count}</span>
                  </button>
                );
              })
            ) : (
              <span className="text-[#7d8796]">暂无行业分布</span>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-[#1c1114] px-3 py-1.5 text-xs text-[#ff3535] flex items-center justify-between">
          <span>加载连板数据失败: {error}</span>
          <button
            type="button"
            onClick={() => fetchLadder({ date: selectedDate, pool, board })}
            className="px-2 py-0.5 border border-[#ff3535]/50 rounded-[2px]"
          >
            重试
          </button>
        </div>
      )}

      {/* Main Content: Dense Quotation Table OR Compact Matrix */}
      <div className="bg-[#0e1117] flex-1 flex flex-col min-h-0">
        {loading && !data ? (
          <div className="p-8 text-center text-xs text-[#8b95a5] font-mono">
            正在加载连板复盘数据...
          </div>
        ) : flatStocks.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#8b95a5]">
            当前筛选条件下暂无标的记录
          </div>
        ) : viewMode === 'table' ? (
          <div className="overflow-auto flex-1">
            <table className="w-table">
              <thead>
                <tr>
                  <th className="text-right w-10">序</th>
                  <th className="text-left w-20">代码</th>
                  <th className="text-left w-28">名称</th>
                  <th className="text-center w-16">状态/连板</th>
                  <th className="text-right w-16">现价</th>
                  <th className="text-right w-16">涨幅%</th>
                  <th className="text-center w-16">首次封板</th>
                  <th className="text-center w-16">最后封板</th>
                  <th className="text-right w-14">开板</th>
                  <th className="text-right w-16">换手%</th>
                  <th className="text-right w-20">成交/封单</th>
                  <th className="text-left w-28">所属行业</th>
                  <th className="text-left">核心题材</th>
                </tr>
              </thead>
              <tbody>
                {flatStocks.map(({ stock, tierLabel }, idx) => {
                  const bTag = getBoardTag(stock);
                  const openCount = stock.openCount ?? 0;
                  return (
                    <tr
                      key={`${stock.code}-${idx}`}
                      onClick={() => onSelectStock(stock.code, stock.name, data?.date || selectedDate)}
                      className="cursor-pointer"
                    >
                      <td className="text-right font-mono text-[#7d8796]">{idx + 1}</td>
                      <td className="font-mono text-[#e5b567]">{stock.code}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          <span className="text-[#e8edf5] font-medium">{stock.name}</span>
                          {bTag && (
                            <span
                              className={`px-1 py-0 text-[9px] border rounded-[2px] leading-tight ${bTag.cls}`}
                            >
                              {bTag.text}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-center">
                        {pool === 'zt' ? (
                          <span
                            className={`px-1.5 py-0 text-[10px] font-mono font-bold border rounded-[2px] ${
                              stock.streak >= 3
                                ? 'text-[#ff3535] border-[#ff3535]/50 bg-[#ff3535]/10'
                                : stock.streak === 2
                                  ? 'text-[#ff9500] border-[#ff9500]/45 bg-[#ff9500]/10'
                                  : 'text-[#4da3ff] border-[#4da3ff]/40 bg-[#4da3ff]/10'
                            }`}
                          >
                            {stock.streak}板
                          </span>
                        ) : pool === 'zb' ? (
                          <span className="px-1.5 py-0 text-[10px] font-mono border border-[#f0b90b]/45 bg-[#f0b90b]/10 text-[#f0b90b] rounded-[2px]">
                            炸板
                          </span>
                        ) : (
                          <span className="px-1.5 py-0 text-[10px] font-mono border border-[#566070]/50 bg-[#151a23] text-[#8b949e] rounded-[2px]">
                            {tierLabel || '断板'}
                          </span>
                        )}
                      </td>
                      <td className={`text-right font-mono ${windColor(stock.changePct)}`}>
                        {(stock.price ?? 0).toFixed(2)}
                      </td>
                      <td className={`text-right font-mono font-semibold ${windColor(stock.changePct)}`}>
                        {formatPct(stock.changePct)}
                      </td>
                      <td className="text-center font-mono text-[#cfd7e3]">
                        {stock.firstSealTime || '--'}
                      </td>
                      <td className="text-center font-mono text-[#8b95a5]">
                        {stock.lastSealTime || '--'}
                      </td>
                      <td
                        className={`text-right font-mono ${
                          openCount > 0 ? 'text-[#f0b90b]' : 'text-[#7d8796]'
                        }`}
                      >
                        {pool === 'db' ? '--' : openCount}
                      </td>
                      <td className="text-right font-mono text-[#4da3ff]">
                        {stock.turnoverRate !== undefined ? `${stock.turnoverRate.toFixed(1)}%` : '--'}
                      </td>
                      <td className="text-right font-mono text-[#f0b90b]">
                        {formatAmount(stock.amount ?? stock.sealAmount)}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (stock.industry) {
                              setSelectedIndustry((p) => (p === stock.industry ? null : stock.industry));
                            }
                          }}
                          className={`text-[11px] px-1 py-0 border rounded-[2px] ${
                            selectedIndustry === stock.industry
                              ? 'border-[#4da3ff] bg-[#4da3ff]/20 text-[#4da3ff]'
                              : 'border-[#252c38] bg-[#151a23] text-[#4da3ff]'
                          }`}
                        >
                          {stock.industry || '其他'}
                        </button>
                      </td>
                      <td className="whitespace-normal py-0.5">
                        <div className="flex flex-wrap gap-1">
                          {(stock.concepts ?? []).slice(0, 6).map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedConcept((p) => (p === c ? null : c));
                              }}
                              className={`px-1 py-0 text-[10px] border rounded-[2px] ${
                                selectedConcept === c
                                  ? 'border-[#ff8800] bg-[#ff8800]/20 text-[#ff9500]'
                                  : 'border-[#252c38] bg-[#151a23] text-[#e5b567]'
                              }`}
                            >
                              {c}
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
        ) : (
          /* Compact Tier Matrix View */
          <div className="bg-[#222832] flex flex-col gap-[1px]">
            {displayTiers.map((tier) => {
              const isCollapsed = !!collapsedTiers[tier.key];
              return (
                <div key={tier.key} className="bg-[#0e1117]">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedTiers((prev) => ({ ...prev, [tier.key]: !prev[tier.key] }))
                    }
                    className="w-header w-full text-left"
                  >
                    <span className="w-title-bar">
                      {tier.label} · {tier.stocks.length}只
                    </span>
                    <span className="text-[11px] font-mono text-[#7d8796]">
                      {isCollapsed ? '[展开]' : '[收起]'}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-[1px] bg-[#222832]">
                      {tier.stocks.map((stock) => {
                        const bTag = getBoardTag(stock);
                        return (
                          <div
                            key={`${tier.key}-${stock.code}`}
                            onClick={() =>
                              onSelectStock(stock.code, stock.name, data?.date || selectedDate)
                            }
                            className="bg-[#11151d] hover:bg-[#1b2434] p-2 cursor-pointer flex flex-col justify-between gap-1.5"
                          >
                            <div>
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1 min-w-0">
                                  <span className="text-xs font-semibold text-[#e8edf5] truncate">
                                    {stock.name}
                                  </span>
                                  {bTag && (
                                    <span
                                      className={`px-1 py-0 text-[9px] border rounded-[2px] ${bTag.cls}`}
                                    >
                                      {bTag.text}
                                    </span>
                                  )}
                                </div>
                                <span
                                  className={`text-[11px] font-mono font-bold ${windColor(
                                    stock.changePct
                                  )}`}
                                >
                                  {pool === 'zt'
                                    ? `${stock.streak}板`
                                    : formatPct(stock.changePct)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[10px] font-mono mt-0.5">
                                <span className="text-[#e5b567]">{stock.code}</span>
                                <span className={windColor(stock.changePct)}>
                                  {formatPct(stock.changePct)}
                                </span>
                              </div>
                              <div className="text-[10px] text-[#8b95a5] font-mono mt-1">
                                {pool !== 'db' ? `开板${stock.openCount ?? 0}次` : stock.statusTag || '断板'}
                                {stock.firstSealTime ? ` · ${stock.firstSealTime}` : ''}
                              </div>
                              {stock.reason && (
                                <div className="text-[10px] text-[#7d8796] truncate mt-0.5">
                                  {stock.reason}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1 pt-1 border-t border-[#1e2531]">
                              {(stock.concepts ?? []).slice(0, 4).map((c) => (
                                <span
                                  key={c}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedConcept((p) => (p === c ? null : c));
                                  }}
                                  className="px-1 py-0 text-[9px] border border-[#252c38] bg-[#151a23] text-[#e5b567] rounded-[2px]"
                                >
                                  {c}
                                </span>
                              ))}
                              {stock.industry && (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedIndustry((p) =>
                                      p === stock.industry ? null : stock.industry
                                    );
                                  }}
                                  className="px-1 py-0 text-[9px] border border-[#252c38] bg-[#151a23] text-[#4da3ff] rounded-[2px]"
                                >
                                  {stock.industry}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
