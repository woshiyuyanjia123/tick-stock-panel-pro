import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatAmount, formatPct } from '../api/client';
import type { StockSearchItem, WatchlistItem } from '../types/market';

interface WatchlistPageProps {
  onSelectStock: (code: string, name?: string, date?: string) => void;
  onNavigate?: (tab: string) => void;
}

type FilterMode = 'all' | 'up' | 'down' | 'alert';
type SortField = 'default' | 'price' | 'changePct' | 'change' | 'turnoverRate' | 'volumeRatio' | 'amount' | 'pnlPct';

interface EditDraft {
  code: string;
  name: string;
  groupName: string;
  costPrice: string;
  shares: string;
  targetPrice: string;
  stopLossPrice: string;
  note: string;
}

const DEFAULT_GROUPS = ['核心自选', 'CPO算力链', 'PM宏观对冲'];

function upDownCls(val?: number | null): string {
  if (val === undefined || val === null || val === 0) return 'text-[#8b949e]';
  return val > 0 ? 'text-[#ff3535]' : 'text-[#00c853]';
}

function getAlertState(item: WatchlistItem): {
  status: 'take-profit' | 'stop-loss' | 'near-tp' | 'near-sl' | 'normal';
  label: string;
  tpDistPct: number | null;
  slDistPct: number | null;
} {
  const price = item.quote?.price;
  if (!price || price <= 0) {
    return { status: 'normal', label: '待行情', tpDistPct: null, slDistPct: null };
  }
  const tpDistPct =
    item.targetPrice && item.targetPrice > 0
      ? ((item.targetPrice - price) / price) * 100
      : null;
  const slDistPct =
    item.stopLossPrice && item.stopLossPrice > 0
      ? ((price - item.stopLossPrice) / price) * 100
      : null;

  if (item.targetPrice && item.targetPrice > 0 && price >= item.targetPrice) {
    return { status: 'take-profit', label: '触发止盈', tpDistPct, slDistPct };
  }
  if (item.stopLossPrice && item.stopLossPrice > 0 && price <= item.stopLossPrice) {
    return { status: 'stop-loss', label: '触及止损', tpDistPct, slDistPct };
  }
  if (tpDistPct !== null && tpDistPct <= 3) {
    return { status: 'near-tp', label: '临近止盈', tpDistPct, slDistPct };
  }
  if (slDistPct !== null && slDistPct <= 3) {
    return { status: 'near-sl', label: '临近止损', tpDistPct, slDistPct };
  }
  return { status: 'normal', label: '正常', tpDistPct, slDistPct };
}

export default function WatchlistPage({ onSelectStock, onNavigate }: WatchlistPageProps) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [groups, setGroups] = useState<{ name: string; count: number }[]>(
    DEFAULT_GROUPS.map((name) => ({ name, count: 0 }))
  );
  const [activeGroup, setActiveGroup] = useState<string>('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [buyingCode, setBuyingCode] = useState<string | null>(null);
  const [lastPaperJump, setLastPaperJump] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [addingCode, setAddingCode] = useState<string | null>(null);

  const [tableFilter, setTableFilter] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [sortField, setSortField] = useState<SortField>('default');
  const [sortDesc, setSortDesc] = useState(true);

  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const flashStatus = useCallback((msg: string, showPaperJump = false) => {
    setStatusMsg(msg);
    setLastPaperJump(showPaperJump);
    setTimeout(() => {
      setStatusMsg((cur) => (cur === msg ? null : cur));
      if (showPaperJump) setLastPaperJump(false);
    }, 4500);
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const res = await api.getWatchlistGroups();
      const serverGroups = Array.isArray(res?.groups) ? res.groups : [];
      const map = new Map<string, number>();
      for (const def of DEFAULT_GROUPS) map.set(def, 0);
      for (const g of serverGroups) {
        if (g.name) map.set(g.name, g.count ?? 0);
      }
      setGroups(Array.from(map.entries()).map(([name, count]) => ({ name, count })));
    } catch {
      // Keep default groups if endpoint not yet available
    }
  }, []);

  const loadWatchlist = useCallback(
    async (silent = false, targetGroup = activeGroup) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const data = await api.getWatchlist(targetGroup || undefined);
        setItems(Array.isArray(data) ? data : []);
      } catch (e: any) {
        setError(e?.message || '获取自选股列表失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeGroup]
  );

  useEffect(() => {
    loadGroups();
    loadWatchlist(false, activeGroup);
    const timer = setInterval(() => {
      loadWatchlist(true, activeGroup);
      loadGroups();
    }, 20000);
    return () => clearInterval(timer);
  }, [loadWatchlist, loadGroups, activeGroup]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.searchStocks(q);
        setSearchResults(Array.isArray(res) ? res : []);
        setShowDropdown(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleAddStock = async (stock: StockSearchItem) => {
    setAddingCode(stock.code);
    const targetGroup = activeGroup || '核心自选';
    try {
      await api.upsertWatchlist({
        code: stock.code,
        name: stock.name,
        groupName: targetGroup,
      });
      await Promise.all([loadWatchlist(true, activeGroup), loadGroups()]);
      setSearchQuery('');
      setShowDropdown(false);
      flashStatus(`已加入自选 [${targetGroup}]: ${stock.code} ${stock.name}`);
    } catch (e: any) {
      flashStatus(`添加失败: ${e?.message || '未知错误'}`);
    } finally {
      setAddingCode(null);
    }
  };

  const handleRemoveStock = async (code: string, name: string) => {
    try {
      await api.removeWatchlist(code);
      await Promise.all([loadWatchlist(true, activeGroup), loadGroups()]);
      flashStatus(`已移出自选: ${code} ${name}`);
    } catch (e: any) {
      flashStatus(`移除失败: ${e?.message || '未知错误'}`);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const g = newGroupName.trim();
    if (!g) return;
    try {
      const res = await api.createWatchlistGroup(g);
      const serverGroups = Array.isArray(res?.groups) ? res.groups : [];
      const map = new Map<string, number>();
      for (const def of DEFAULT_GROUPS) map.set(def, 0);
      for (const item of serverGroups) {
        if (item.name) map.set(item.name, item.count ?? 0);
      }
      if (!map.has(g)) map.set(g, 0);
      setGroups(Array.from(map.entries()).map(([name, count]) => ({ name, count })));
      setActiveGroup(g);
      setNewGroupName('');
      setCreatingGroup(false);
      flashStatus(`已新建 SQLite 自选分组: ${g}`);
    } catch (err: any) {
      flashStatus(`新建分组失败: ${err?.message || '未知错误'}`);
    }
  };

  const handlePaperBuy = async (item: WatchlistItem) => {
    setBuyingCode(item.code);
    try {
      const price = item.quote?.price && item.quote.price > 0 ? item.quote.price : undefined;
      await api.placePaperOrder({
        symbol: item.code,
        name: item.name,
        market: 'ashare',
        action: 'buy_long',
        capitalAllocationPct: 10,
        price,
        leverage: 1,
        strategyTag: `F2自选-${item.groupName || activeGroup || '核心自选'}`,
        note: item.note || 'F2自选池模拟盘买入',
      });
      flashStatus(`模拟盘买入已成交(10%仓位): ${item.code} ${item.name}`, true);
    } catch (err: any) {
      flashStatus(`模拟盘下单失败: ${err?.message || '未知错误'}`);
    } finally {
      setBuyingCode(null);
    }
  };

  const handleExportCsv = () => {
    const header = [
      '分组',
      '代码',
      '名称',
      '行业',
      '现价',
      '涨跌幅(%)',
      '涨跌额',
      '换手率(%)',
      '量比',
      '成交额(元)',
      '持仓成本',
      '模拟股数',
      '浮动盈亏(%)',
      '目标止盈',
      '纪律止损',
      '预警状态',
      '自选备注',
    ];
    const escapeCsv = (val: string | number | undefined | null) => {
      const s = val === undefined || val === null ? '' : String(val);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = filteredItems.map((it) => {
      const q = it.quote;
      const price = q?.price ?? 0;
      const pnlPct =
        it.costPrice && it.costPrice > 0 && price > 0
          ? (((price - it.costPrice) / it.costPrice) * 100).toFixed(2)
          : '';
      const alert = getAlertState(it);
      return [
        it.groupName || activeGroup || '核心自选',
        it.code,
        it.name,
        q?.industry || '',
        price > 0 ? price.toFixed(2) : '',
        q?.changePct !== undefined ? q.changePct.toFixed(2) : '',
        q?.change !== undefined ? q.change.toFixed(2) : '',
        q?.turnoverRate !== undefined ? q.turnoverRate.toFixed(2) : '',
        q?.volumeRatio !== undefined ? q.volumeRatio.toFixed(2) : '',
        q?.amount !== undefined ? q.amount.toFixed(0) : '',
        it.costPrice ?? '',
        it.shares ?? '',
        pnlPct,
        it.targetPrice ?? '',
        it.stopLossPrice ?? '',
        alert.label,
        it.note || '',
      ]
        .map(escapeCsv)
        .join(',');
    });
    const csv = '\uFEFF' + [header.map(escapeCsv).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TSP_自选报价_${activeGroup || '全部分组'}_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    flashStatus(`已导出 ${filteredItems.length} 条自选股 CSV`);
  };

  const openEditor = (item: WatchlistItem) => {
    setEditing({
      code: item.code,
      name: item.name,
      groupName: item.groupName || activeGroup || '核心自选',
      costPrice: item.costPrice ? String(item.costPrice) : '',
      shares: item.shares ? String(item.shares) : '',
      targetPrice: item.targetPrice ? String(item.targetPrice) : '',
      stopLossPrice: item.stopLossPrice ? String(item.stopLossPrice) : '',
      note: item.note || '',
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSavingEdit(true);
    try {
      const numOrUndef = (v: string) => {
        const n = Number(v);
        return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
      };
      await api.upsertWatchlist({
        code: editing.code,
        name: editing.name,
        groupName: editing.groupName || '核心自选',
        costPrice: numOrUndef(editing.costPrice),
        shares: numOrUndef(editing.shares),
        targetPrice: numOrUndef(editing.targetPrice),
        stopLossPrice: numOrUndef(editing.stopLossPrice),
        note: editing.note.trim(),
      });
      await Promise.all([loadWatchlist(true, activeGroup), loadGroups()]);
      setEditing(null);
      flashStatus(`已更新持仓与分组参数: ${editing.code} ${editing.name}`);
    } catch (err: any) {
      flashStatus(`保存失败: ${err?.message || '未知错误'}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const summary = useMemo(() => {
    let up = 0;
    let down = 0;
    let flat = 0;
    let totalCost = 0;
    let totalMarketVal = 0;
    let alertCount = 0;

    for (const item of items) {
      const chg = item.quote?.changePct ?? 0;
      if (chg > 0) up += 1;
      else if (chg < 0) down += 1;
      else flat += 1;

      if (item.costPrice && item.shares && item.quote?.price) {
        totalCost += item.costPrice * item.shares;
        totalMarketVal += item.quote.price * item.shares;
      }

      const alert = getAlertState(item);
      if (alert.status === 'take-profit' || alert.status === 'stop-loss') {
        alertCount += 1;
      }
    }

    const totalPnl = totalMarketVal - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    return {
      total: items.length,
      up,
      down,
      flat,
      totalCost,
      totalMarketVal,
      totalPnl,
      totalPnlPct,
      alertCount,
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    const list = items.filter((item) => {
      if (q) {
        const hit =
          item.code.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          (item.note || '').toLowerCase().includes(q) ||
          (item.quote?.industry || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      const chg = item.quote?.changePct ?? 0;
      if (filterMode === 'up' && chg <= 0) return false;
      if (filterMode === 'down' && chg >= 0) return false;
      if (filterMode === 'alert') {
        const st = getAlertState(item).status;
        if (st === 'normal') return false;
      }
      return true;
    });

    if (sortField === 'default') return list;

    return [...list].sort((a, b) => {
      const getVal = (it: WatchlistItem) => {
        if (sortField === 'pnlPct') {
          if (it.costPrice && it.costPrice > 0 && it.quote?.price) {
            return ((it.quote.price - it.costPrice) / it.costPrice) * 100;
          }
          return -9999;
        }
        return (it.quote?.[sortField] as number | undefined) ?? -9999;
      };
      const diff = getVal(a) - getVal(b);
      return sortDesc ? -diff : diff;
    });
  }, [items, tableFilter, filterMode, sortField, sortDesc]);

  const watchedCodes = useMemo(() => new Set(items.map((i) => i.code)), [items]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDesc((d) => !d);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#222832] gap-[1px] overflow-hidden">
      {/* Top 26px Wind Pane Header + Add Stock Bar */}
      <div className="h-[28px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
            <span className="text-[12px] font-bold text-[#dfe6f0]">
              F2 自选股报价与模拟持仓监控
            </span>
          </div>
          <div className="flex items-center border-l border-[#232a36] pl-2.5 gap-1">
            {(
              [
                { id: 'all', label: `全部(${summary.total})` },
                { id: 'up', label: `涨(${summary.up})` },
                { id: 'down', label: `跌(${summary.down})` },
                { id: 'alert', label: `预警(${summary.alertCount})` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterMode(f.id)}
                className={`px-2 h-[22px] text-[11px] rounded-[2px] border transition-colors ${
                  filterMode === f.id
                    ? 'bg-[#0e1117] text-[#ff9500] border-[#ff8800]'
                    : 'bg-transparent text-[#8b95a5] border-transparent hover:text-[#e8edf5]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {statusMsg && (
            <span className="text-[11px] font-mono text-[#4da3ff] border-l border-[#232a36] pl-2.5 flex items-center gap-2">
              <span>{statusMsg}</span>
              {lastPaperJump && onNavigate && (
                <button
                  onClick={() => onNavigate('saas-desk')}
                  className="px-1.5 py-0.5 rounded-[2px] border border-[#ff8800] text-[#ff9500] hover:bg-[#1b2434] font-sans"
                >
                  进入模拟实盘舱
                </button>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-60">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setShowDropdown(true);
              }}
              placeholder="输入代码/名称加入自选..."
              className="w-full h-[22px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-2 text-[11px] text-[#e8edf5] placeholder-[#5c6675] focus:outline-none"
            />
            {showDropdown && (
              <div className="absolute left-0 right-0 top-[24px] z-40 bg-[#141923] border border-[#ff8800] max-h-64 overflow-y-auto">
                {searching ? (
                  <div className="px-2.5 py-2 text-[11px] text-[#8b95a5]">检索中...</div>
                ) : searchResults.length === 0 ? (
                  <div className="px-2.5 py-2 text-[11px] text-[#5c6675]">无匹配标的</div>
                ) : (
                  searchResults.map((s) => {
                    const exists = watchedCodes.has(s.code);
                    return (
                      <div
                        key={s.code}
                        className="h-[26px] flex items-center justify-between px-2 hover:bg-[#1b2434] border-b border-[#181d26] text-[11px]"
                      >
                        <button
                          onClick={() => {
                            setShowDropdown(false);
                            onSelectStock(s.code, s.name);
                          }}
                          className="flex items-center gap-2 text-left min-w-0 flex-1"
                        >
                          <span className="font-mono text-[#e5b567] shrink-0">{s.code}</span>
                          <span className="text-[#e8edf5] truncate">{s.name}</span>
                        </button>
                        <div className="flex items-center gap-2 shrink-0">
                          {s.price !== undefined && (
                            <span className={`font-mono tabular-nums ${upDownCls(s.changePct)}`}>
                              {s.price.toFixed(2)} {formatPct(s.changePct)}
                            </span>
                          )}
                          <button
                            disabled={exists || addingCode === s.code}
                            onClick={() => handleAddStock(s)}
                            className={`px-1.5 py-0.5 rounded-[2px] text-[10px] border ${
                              exists
                                ? 'border-[#252c38] text-[#5c6675]'
                                : 'bg-[#1a2230] border-[#ff8800] text-[#ff9500] hover:bg-[#ff8800] hover:text-[#090c10]'
                            }`}
                          >
                            {exists ? '已自选' : '+自选'}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <input
            type="text"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            placeholder="过滤表内代码/行业/备注..."
            className="w-40 h-[22px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#4da3ff] rounded-[2px] px-2 text-[11px] text-[#e8edf5] placeholder-[#5c6675] focus:outline-none"
          />

          <button
            onClick={handleExportCsv}
            disabled={filteredItems.length === 0}
            className="h-[22px] px-2.5 rounded-[2px] bg-[#1a202c] hover:bg-[#232b3b] border border-[#2b3342] text-[11px] text-[#f0b90b] disabled:opacity-50"
          >
            导出CSV
          </button>

          <button
            onClick={() => loadWatchlist(true, activeGroup)}
            disabled={refreshing}
            className="h-[22px] px-2.5 rounded-[2px] bg-[#1a202c] hover:bg-[#232b3b] border border-[#2b3342] text-[11px] text-[#dfe6f0]"
          >
            {refreshing ? '刷新中' : '刷新(F5)'}
          </button>
        </div>
      </div>

      {/* SQLite Multi-Group Watchlist Tabs */}
      <div className="h-[26px] bg-[#12161f] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0 text-[11px]">
        <div className="flex items-center gap-1 overflow-x-auto">
          <span className="text-[10px] text-[#7d8796] mr-1 shrink-0">SQLite自选分组:</span>
          <button
            onClick={() => setActiveGroup('')}
            className={`px-2 h-[20px] rounded-[2px] border shrink-0 ${
              activeGroup === ''
                ? 'bg-[#0e1117] border-[#ff8800] text-[#ff9500] font-bold'
                : 'border-[#252c38] text-[#8b95a5] hover:text-[#e8edf5]'
            }`}
          >
            全部
          </button>
          {groups.map((g) => (
            <button
              key={g.name}
              onClick={() => setActiveGroup(g.name)}
              className={`px-2 h-[20px] rounded-[2px] border shrink-0 font-mono ${
                activeGroup === g.name
                  ? 'bg-[#0e1117] border-[#ff8800] text-[#ff9500] font-bold'
                  : 'border-[#252c38] text-[#8b95a5] hover:text-[#e8edf5]'
              }`}
            >
              <span className="font-sans">{g.name}</span>
              {g.count > 0 ? ` (${g.count})` : ''}
            </button>
          ))}
          {creatingGroup ? (
            <form onSubmit={handleCreateGroup} className="flex items-center gap-1 ml-1 shrink-0">
              <input
                type="text"
                autoFocus
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="输入新分组名..."
                className="w-28 h-[20px] bg-[#0a0d12] border border-[#ff8800] rounded-[2px] px-1.5 text-[11px] text-[#e8edf5] focus:outline-none"
              />
              <button
                type="submit"
                className="px-1.5 h-[20px] rounded-[2px] bg-[#ff8800] text-[#090c10] font-bold text-[10px]"
              >
                确定
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingGroup(false);
                  setNewGroupName('');
                }}
                className="px-1.5 h-[20px] rounded-[2px] border border-[#2b3342] text-[#8b95a5] text-[10px]"
              >
                取消
              </button>
            </form>
          ) : (
            <button
              onClick={() => setCreatingGroup(true)}
              className="ml-1 px-2 h-[20px] rounded-[2px] border border-dashed border-[#3b4454] text-[#4da3ff] hover:border-[#4da3ff] shrink-0"
            >
              +新建分组
            </button>
          )}
        </div>
        <span className="text-[10px] font-mono text-[#7d8796] shrink-0">
          当前加入自选默认归入: {activeGroup || '核心自选'}
        </span>
      </div>

      {/* Compact Horizontal Portfolio Summary Strip (32px) */}
      <div className="h-[32px] bg-[#0e1117] px-3 flex items-center justify-between text-[12px] font-mono tabular-nums shrink-0">
        <div className="flex items-center gap-5">
          <div>
            <span className="text-[#7d8796] font-sans mr-1.5">自选总数:</span>
            <span className="text-[#e8edf5] font-bold">{summary.total}</span>
            <span className="text-[#7d8796] ml-2">
              (<span className="text-[#ff3535]">{summary.up}</span>/
              <span className="text-[#8b949e]">{summary.flat}</span>/
              <span className="text-[#00c853]">{summary.down}</span>)
            </span>
          </div>
          <div className="border-l border-[#222832] pl-4">
            <span className="text-[#7d8796] font-sans mr-1.5">持仓市值:</span>
            <span className="text-[#f0b90b] font-bold">
              ¥{summary.totalMarketVal.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[#7d8796] ml-2">
              成本 ¥{summary.totalCost.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="border-l border-[#222832] pl-4">
            <span className="text-[#7d8796] font-sans mr-1.5">浮动盈亏:</span>
            {summary.totalCost > 0 ? (
              <span className={`font-bold ${upDownCls(summary.totalPnl)}`}>
                {summary.totalPnl > 0 ? '+' : ''}
                ¥{summary.totalPnl.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} (
                {formatPct(summary.totalPnlPct)})
              </span>
            ) : (
              <span className="text-[#5c6675] font-sans">未建仓</span>
            )}
          </div>
          <div className="border-l border-[#222832] pl-4">
            <span className="text-[#7d8796] font-sans mr-1.5">止盈/止损触发:</span>
            <span className={summary.alertCount > 0 ? 'text-[#ff8800] font-bold' : 'text-[#8b949e]'}>
              {summary.alertCount} 只
            </span>
          </div>
        </div>
        <div className="text-[11px] text-[#7d8796] font-sans">
          双击/点击行打开 F5 分时K线终端 · 20秒自动轮询
        </div>
      </div>

      {/* Main Dense 同花顺 F2 Quotation Table */}
      <div className="flex-1 min-h-0 bg-[#0e1117] overflow-auto">
        {error ? (
          <div className="p-6 text-center text-[12px] text-[#ff3535]">
            {error}{' '}
            <button
              onClick={() => loadWatchlist(false)}
              className="ml-2 px-2 py-0.5 rounded-[2px] border border-[#ff8800] text-[#ff9500]"
            >
              重试
            </button>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-[12px] text-[#7d8796]">正在加载自选报价表...</div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-[12px] text-[#7d8796]">
            当前自选池为空或无匹配记录，请在右上角搜索添加标的
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-[#151a23] border-b border-[#252c38] text-[11px] text-[#8b95a5] font-medium">
              <tr className="h-[26px]">
                <th className="px-2 w-9 text-center">序</th>
                <th className="px-2">代码</th>
                <th className="px-2">名称</th>
                <th className="px-2">行业</th>
                <th
                  onClick={() => toggleSort('price')}
                  className="px-2 text-right cursor-pointer hover:text-[#e8edf5]"
                >
                  现价 {sortField === 'price' ? (sortDesc ? '↓' : '↑') : ''}
                </th>
                <th
                  onClick={() => toggleSort('changePct')}
                  className="px-2 text-right cursor-pointer hover:text-[#e8edf5]"
                >
                  涨跌幅 {sortField === 'changePct' ? (sortDesc ? '↓' : '↑') : ''}
                </th>
                <th
                  onClick={() => toggleSort('change')}
                  className="px-2 text-right cursor-pointer hover:text-[#e8edf5]"
                >
                  涨跌额 {sortField === 'change' ? (sortDesc ? '↓' : '↑') : ''}
                </th>
                <th
                  onClick={() => toggleSort('turnoverRate')}
                  className="px-2 text-right cursor-pointer hover:text-[#e8edf5]"
                >
                  换手% {sortField === 'turnoverRate' ? (sortDesc ? '↓' : '↑') : ''}
                </th>
                <th
                  onClick={() => toggleSort('volumeRatio')}
                  className="px-2 text-right cursor-pointer hover:text-[#e8edf5]"
                >
                  量比 {sortField === 'volumeRatio' ? (sortDesc ? '↓' : '↑') : ''}
                </th>
                <th
                  onClick={() => toggleSort('amount')}
                  className="px-2 text-right cursor-pointer hover:text-[#e8edf5]"
                >
                  成交额 {sortField === 'amount' ? (sortDesc ? '↓' : '↑') : ''}
                </th>
                <th className="px-2 text-right">持仓成本/股数</th>
                <th
                  onClick={() => toggleSort('pnlPct')}
                  className="px-2 text-right cursor-pointer hover:text-[#e8edf5]"
                >
                  浮动盈亏 {sortField === 'pnlPct' ? (sortDesc ? '↓' : '↑') : ''}
                </th>
                <th className="px-2">止盈/止损预警</th>
                <th className="px-2">自选备注</th>
                <th className="px-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="text-[12px] tabular-nums">
              {filteredItems.map((item, idx) => {
                const q = item.quote;
                const price = q?.price ?? 0;
                const chg = q?.changePct ?? 0;
                const chgAmt = q?.change ?? 0;
                const hasPos = !!(
                  item.costPrice &&
                  item.costPrice > 0 &&
                  item.shares &&
                  item.shares > 0
                );
                const pnlPct =
                  item.costPrice && item.costPrice > 0 && price > 0
                    ? ((price - item.costPrice) / item.costPrice) * 100
                    : null;
                const pnlMoney =
                  hasPos && price > 0 ? (price - item.costPrice!) * item.shares! : null;
                const alert = getAlertState(item);

                return (
                  <tr
                    key={item.code}
                    onClick={() => onSelectStock(item.code, item.name)}
                    className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434] cursor-pointer"
                  >
                    <td className="px-2 text-center font-mono text-[11px] text-[#7d8796]">
                      {idx + 1}
                    </td>
                    <td className="px-2 font-mono text-[#e5b567]">{item.code}</td>
                    <td className="px-2 text-[#e8edf5] font-medium whitespace-nowrap">
                      {item.name}
                    </td>
                    <td className="px-2 text-[11px] text-[#8b95a5] whitespace-nowrap">
                      {q?.industry || '-'}
                    </td>
                    <td className={`px-2 text-right font-mono font-semibold ${upDownCls(chg)}`}>
                      {price > 0 ? price.toFixed(2) : '-'}
                    </td>
                    <td className={`px-2 text-right font-mono font-semibold ${upDownCls(chg)}`}>
                      {formatPct(chg)}
                    </td>
                    <td className={`px-2 text-right font-mono ${upDownCls(chgAmt)}`}>
                      {q?.change !== undefined ? `${chgAmt > 0 ? '+' : ''}${chgAmt.toFixed(2)}` : '-'}
                    </td>
                    <td className="px-2 text-right font-mono text-[#dfe6f0]">
                      {q?.turnoverRate !== undefined ? `${q.turnoverRate.toFixed(2)}%` : '-'}
                    </td>
                    <td
                      className={`px-2 text-right font-mono ${
                        (q?.volumeRatio ?? 0) >= 2 ? 'text-[#f0b90b] font-semibold' : 'text-[#dfe6f0]'
                      }`}
                    >
                      {q?.volumeRatio !== undefined ? q.volumeRatio.toFixed(2) : '-'}
                    </td>
                    <td className="px-2 text-right font-mono text-[#f0b90b]">
                      {formatAmount(q?.amount)}
                    </td>
                    <td className="px-2 text-right font-mono text-[#dfe6f0] whitespace-nowrap">
                      {item.costPrice
                        ? `${item.costPrice.toFixed(2)} / ${item.shares || 0}`
                        : '-'}
                    </td>
                    <td className={`px-2 text-right font-mono font-semibold ${upDownCls(pnlPct)}`}>
                      {pnlPct !== null
                        ? `${formatPct(pnlPct)}${
                            pnlMoney !== null ? ` (${pnlMoney > 0 ? '+' : ''}${pnlMoney.toFixed(0)})` : ''
                          }`
                        : '-'}
                    </td>
                    <td className="px-2 whitespace-nowrap text-[11px] font-mono">
                      <span
                        className={`px-1 py-0.5 rounded-[2px] border mr-1.5 ${
                          alert.status === 'take-profit'
                            ? 'border-[#ff3535] text-[#ff3535] bg-[#2a1215]'
                            : alert.status === 'stop-loss'
                            ? 'border-[#00c853] text-[#00c853] bg-[#0d2418]'
                            : alert.status === 'near-tp' || alert.status === 'near-sl'
                            ? 'border-[#ff8800] text-[#ff9500] bg-[#261a0c]'
                            : 'border-[#252c38] text-[#7d8796]'
                        }`}
                      >
                        {alert.label}
                      </span>
                      <span className="text-[#7d8796]">
                        {item.targetPrice ? `盈${item.targetPrice.toFixed(2)}` : ''}
                        {item.stopLossPrice ? ` 损${item.stopLossPrice.toFixed(2)}` : ''}
                      </span>
                    </td>
                    <td className="px-2 max-w-[160px] truncate text-[11px] text-[#8b95a5]" title={item.note || ''}>
                      {item.note || '-'}
                    </td>
                    <td
                      className="px-2 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => handlePaperBuy(item)}
                        disabled={buyingCode === item.code}
                        className="px-1.5 py-0.5 text-[11px] rounded-[2px] border border-[#ff8800] text-[#ff9500] hover:bg-[#ff8800] hover:text-[#090c10] mr-1 disabled:opacity-50"
                        title="按10%组合净值以现价在模拟实盘舱买入(A股T+1整手)"
                      >
                        {buyingCode === item.code ? '下单中' : '模拟盘买入'}
                      </button>
                      <button
                        onClick={() => openEditor(item)}
                        className="px-1.5 py-0.5 text-[11px] rounded-[2px] border border-[#2b3342] text-[#4da3ff] hover:border-[#4da3ff] mr-1"
                      >
                        持仓
                      </button>
                      <button
                        onClick={() => handleRemoveStock(item.code, item.name)}
                        className="px-1.5 py-0.5 text-[11px] rounded-[2px] border border-[#2b3342] text-[#7d8796] hover:text-[#ff3535] hover:border-[#ff3535]"
                      >
                        删
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Sharp Rectangular Position Editor Dialog */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#11151d] border border-[#ff8800] rounded-none">
            <div className="h-[28px] px-3 bg-[#161b24] border-b border-[#232a36] flex items-center justify-between">
              <span className="text-[12px] font-bold text-[#dfe6f0]">
                持仓与止盈止损参数 — <span className="text-[#e5b567] font-mono">{editing.code}</span> {editing.name}
              </span>
              <button
                onClick={() => setEditing(null)}
                className="text-[12px] text-[#8b95a5] hover:text-[#ff3535]"
              >
                [关闭]
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-3 space-y-2.5 text-[12px]">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-[#8b95a5] mb-1">持仓成本价 (元)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editing.costPrice}
                    onChange={(e) => setEditing({ ...editing, costPrice: e.target.value })}
                    className="w-full h-[26px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-2 font-mono text-[#e8edf5] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#8b95a5] mb-1">模拟持股数 (股)</label>
                  <input
                    type="number"
                    step="100"
                    min="0"
                    value={editing.shares}
                    onChange={(e) => setEditing({ ...editing, shares: e.target.value })}
                    className="w-full h-[26px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-2 font-mono text-[#e8edf5] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#ff3535] mb-1">目标止盈价 (元)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editing.targetPrice}
                    onChange={(e) => setEditing({ ...editing, targetPrice: e.target.value })}
                    className="w-full h-[26px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff3535] rounded-[2px] px-2 font-mono text-[#e8edf5] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#00c853] mb-1">纪律止损价 (元)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editing.stopLossPrice}
                    onChange={(e) => setEditing({ ...editing, stopLossPrice: e.target.value })}
                    className="w-full h-[26px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#00c853] rounded-[2px] px-2 font-mono text-[#e8edf5] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-[#8b95a5] mb-1">所属自选分组</label>
                <select
                  value={editing.groupName}
                  onChange={(e) => setEditing({ ...editing, groupName: e.target.value })}
                  className="w-full h-[26px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-2 text-[#e8edf5] focus:outline-none"
                >
                  {groups.map((g) => (
                    <option key={g.name} value={g.name}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#8b95a5] mb-1">交易逻辑 / 自选备注</label>
                <textarea
                  rows={2}
                  value={editing.note}
                  onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                  className="w-full bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] p-2 text-[#e8edf5] focus:outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#232a36]">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="px-3 h-[26px] rounded-[2px] bg-[#1a202c] border border-[#2b3342] text-[#dfe6f0]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 h-[26px] rounded-[2px] bg-[#ff8800] text-[#090c10] font-bold disabled:opacity-60"
                >
                  {savingEdit ? '保存中...' : '保存确认'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
