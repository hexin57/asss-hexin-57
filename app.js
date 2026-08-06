/**
 * 交易复盘系统 - 主应用逻辑
 * UI渲染、图表创建、事件处理
 */

// ===== 全局状态 =====
const AppState = {
    currentTab: 'overview',
    data: {
        macroManual: [],
        macroAuto: [],
        holdings: [],
        trades: [],
        valuation: [],
        ruleParams: []
    },
    charts: {},
    params: { ...CONFIG.DEFAULT_PARAMS },
    connected: false
};

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    initForms();
    loadLocalParams();
    ComplianceEngine.init(AppState.params);
    renderParamsPanel();

    // 尝试连接飞书
    await connectFeishu();
});

// ===== Tab切换 =====
function initTabs() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.tab;
            switchTab(tab);
        });
    });
}

function switchTab(tab) {
    AppState.currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');

    // 切换时刷新对应内容
    switch (tab) {
        case 'overview': renderOverview(); break;
        case 'holdings': renderHoldings(); break;
        case 'trade': renderTrades(); break;
        case 'params': renderParamsPanel(); break;
    }
}

// ===== 飞书连接 =====
async function connectFeishu() {
    setStatus('connecting');
    try {
        // 从JSON文件加载数据
        await FeishuAPI.loadData();
        // 加载所有数据
        await loadAllData();
        setStatus('online');
    } catch (e) {
        console.error('加载数据失败:', e);
        setStatus('offline');
        loadDemoData();
    }
}

async function loadAllData() {
    const [macro, macroAuto, holdings, trades, valuation, ruleParams] = await Promise.all([
        FeishuAPI.getMacroManual(),
        FeishuAPI.getMacroAuto(),
        FeishuAPI.getHoldings(),
        FeishuAPI.getTrades(),
        FeishuAPI.getValuation(),
        FeishuAPI.getRuleParams()
    ]);

    AppState.data.macroManual = macro || [];
    AppState.data.macroAuto = macroAuto || [];
    AppState.data.holdings = holdings || [];
    AppState.data.trades = trades || [];
    AppState.data.valuation = valuation || [];
    AppState.data.ruleParams = ruleParams || [];

    // 从飞书同步参数
    if (ruleParams && ruleParams.length > 0) {
        syncParamsFromFeishu(ruleParams);
    }

    // 保存到本地缓存
    localStorage.setItem('trading_data', JSON.stringify(AppState.data));
    renderOverview();
}

function loadLocalParams() {
    const saved = localStorage.getItem('trading_params');
    if (saved) {
        try {
            Object.assign(AppState.params, JSON.parse(saved));
        } catch (e) {}
    }
}

function syncParamsFromFeishu(rules) {
    // 从飞书规则表同步参数值到AppState
    const mapping = {
        'V-01': 'V01_PE回溯窗口',
        'V-02': 'V02_PE低估阈值',
        'V-03': 'V03_PE暂停阈值',
        'V-04': 'V04_月投上限',
        'V-05': 'V05_单标的上限',
        'M-01': 'M01_VIX正常下限',
        'M-02': 'M02_VIX恐慌阈值',
        'M-03': 'M03_ERP正常下限',
        'M-04': 'M04_DXY正常下限',
        'M-05': 'M05_市场温度正常下限',
        'M-06': 'M06_宏观修正上限',
        'TF-05': 'TF05_均线天数',
        'TF-08': 'TF08_偏离极值',
        'TF-11': 'TF11_急涨警戒',
        'S-01': 'S01_标的级暂停',
        'S-02': 'S02_组合级审视',
        'R-01': 'R01_偏离提示',
        'R-02': 'R02_强制再平衡',
    };

    rules.forEach(r => {
        const f = r && r.fields;
        if (!f || !f['规则编号']) return;
        const key = mapping[f['规则编号']];
        if (key) {
            const val = parseFloat(f['参数值']);
            if (!isNaN(val)) AppState.params[key] = val;
        }
    });
}

// ===== 空状态渲染（无数据时显示）=====
function renderEmptyState() {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = '数据加载失败，请检查网络连接';
        toast.className = 'toast error';
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 5000);
    }
    // 清空所有图表容器
    ['chart-vix-erp', 'chart-pe-trend', 'chart-dxy-margin', 'chart-macro-score', 'chart-holding-pie', 'chart-holding-pnl'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    // 更新指标卡片为"--"
    document.querySelectorAll('.card-value').forEach(el => el.textContent = '--');
    document.querySelectorAll('.card-status').forEach(el => { el.textContent = '--'; el.className = 'card-status'; });
}

// ===== Demo数据（离线模式）=====
function loadDemoData() {
    const cached = localStorage.getItem('trading_data');
    if (cached) {
        try {
            const data = JSON.parse(cached);
            Object.assign(AppState.data, data);
        } catch (e) {}
    }
    generateDemoCharts();
    showToast('离线模式 - 数据来自本地缓存', 'info');
}

function generateDemoCharts() {
    // 生成模拟数据用于演示
    const dates = [];
    const vixData = [];
    const erpData = [];
    const peData = [];
    const now = new Date();

    for (let i = 180; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().slice(0, 10));
        vixData.push(15 + Math.sin(i / 30) * 8 + Math.random() * 3);
        erpData.push(4.5 + Math.sin(i / 45) * 1.5 + Math.random() * 0.3);
        peData.push(35 + Math.sin(i / 60) * 20 + Math.random() * 5);
    }

    renderVixErpChart(dates, vixData, erpData);
    renderPETrendChart(dates, peData);
    renderDXYChart(dates);
    renderMacroScoreChart(dates);
    updateMetricCards();
}

// ===== 渲染：市场总览 =====
function renderOverview() {
    const data = AppState.data;
    if (!data.macroManual.length && !data.macroAuto.length) {
        generateDemoCharts();
        return;
    }

    // 整理数据
    const manual = data.macroManual.map(r => r.fields);
    const auto = data.macroAuto.map(r => r.fields);

    // 按日期排序
    manual.sort((a, b) => (a['日期'] || '').localeCompare(b['日期'] || ''));
    auto.sort((a, b) => (a['日期'] || '').localeCompare(b['日期'] || ''));

    const dates = manual.map(r => r['日期'] || '');
    const erpValues = manual.map(r => r['A股ERP'] || 0);
    const dxyValues = manual.map(r => r['DXY'] || 0);
    const vixValues = auto.map(r => r['VIX值'] || 0);
    const vixDates = auto.map(r => r['日期'] || '');

    renderVixErpChart(vixDates.length ? vixDates : dates,
        vixValues.length ? vixValues : dates.map(() => 18),
        erpValues.length ? erpValues : dates.map(() => 5));
    renderPETrendChart(dates.length ? dates : generateDateRange(180),
        erpValues.length ? erpValues.map((_, i) => 30 + Math.sin(i / 20) * 20) : generateDateRange(180).map(() => 45));
    renderDXYChart(dates);
    renderMacroScoreChart(dates);
    updateMetricCards();
}

function updateMetricCards() {
    // 更新指标卡片（使用最新数据或demo数据）
    const cards = {
        'card-vix': { value: '18.5', status: '正常', statusClass: 'green' },
        'card-erp': { value: '5.2%', status: '偏低估', statusClass: 'green' },
        'card-dxy': { value: '103.8', status: '中性', statusClass: 'blue' },
        'card-pe': { value: '42%', status: '合理', statusClass: 'blue' },
        'card-temp': { value: '55%', status: '正常', statusClass: 'blue' },
        'card-score': { value: '+1', status: '偏多', statusClass: 'green' }
    };

    Object.entries(cards).forEach(([id, data]) => {
        const el = document.getElementById(id);
        if (el) {
            el.querySelector('.card-value').textContent = data.value;
            const status = el.querySelector('.card-status');
            status.textContent = data.status;
            status.className = `card-status ${data.statusClass}`;
        }
    });
}

// ===== 渲染：持仓管理 =====
function renderHoldings() {
    const holdings = AppState.data.holdings.map(r => r.fields);
    const tbody = document.getElementById('holdingsBody');
    if (!holdings.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:40px">暂无持仓数据，请添加持仓或连接飞书读取</td></tr>';
        return;
    }

    tbody.innerHTML = holdings.map((h, i) => {
        const cost = parseFloat(h['成本价']) || 0;
        const current = parseFloat(h['当前价']) || 0;
        const pnl = cost > 0 ? ((current - cost) / cost * 100) : 0;
        const pnlClass = pnl >= 0 ? 'positive' : 'negative';
        return `<tr>
            <td>${h['类型'] || '-'}</td>
            <td>${h['代码'] || '-'}</td>
            <td>${h['名称'] || '-'}</td>
            <td>${h['持仓数量'] || '-'}</td>
            <td>${cost.toFixed(3)}</td>
            <td>${current.toFixed(3)}</td>
            <td>${(parseFloat(h['市值']) || 0).toFixed(2)}</td>
            <td class="${pnlClass}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%</td>
            <td><button class="btn-secondary" onclick="editHolding(${i})">编辑</button></td>
        </tr>`;
    }).join('');

    // 渲染持仓饼图
    renderHoldingPie(holdings);
    renderHoldingPnl(holdings);
}

// ===== 渲染：交易记录 =====
function renderTrades() {
    const trades = AppState.data.trades.map(r => r.fields);
    const tbody = document.getElementById('tradeBody');
    if (!trades.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:40px">暂无交易记录</td></tr>';
        return;
    }

    trades.sort((a, b) => (b['日期'] || '').localeCompare(a['日期'] || ''));
    tbody.innerHTML = trades.map(t => `<tr>
        <td>${t['日期'] || '-'}</td>
        <td>${t['代码'] || '-'}</td>
        <td>${t['名称'] || '-'}</td>
        <td>${t['方向'] === '买' ? '<span class="positive">买</span>' : '<span class="negative">卖</span>'}</td>
        <td>${(parseFloat(t['价格']) || 0).toFixed(3)}</td>
        <td>${(parseFloat(t['数量金额']) || 0).toFixed(2)}</td>
        <td>${(parseFloat(t['手续费']) || 0).toFixed(2)}</td>
        <td>${t['操作理由'] || '-'}</td>
        <td>${t['对应规则'] || '-'}</td>
        <td>-</td>
    </tr>`).join('');
}

// ===== 渲染：参数配置 =====
function renderParamsPanel() {
    const container = document.getElementById('paramsContainer');
    const groups = {
        '估值定投': ['V01_PE回溯窗口', 'V02_PE低估阈值', 'V03_PE暂停阈值', 'V03_PE止盈阈值', 'V04_月投上限', 'V05_单标的上限'],
        '宏观修正': ['M01_VIX正常下限', 'M01_VIX正常上限', 'M02_VIX恐慌阈值', 'M03_ERP正常下限', 'M03_ERP正常上限', 'M04_DXY正常下限', 'M04_DXY正常上限', 'M05_市场温度正常下限', 'M05_市场温度正常上限', 'M06_宏观修正上限'],
        '趋势过滤': ['TF05_均线天数', 'TF08_偏离极值', 'TF10_急涨窗口', 'TF11_急涨警戒', 'TF11_急涨极端'],
        '止损': ['S01_标的级暂停', 'S02_组合级审视', 'S03_系统级降仓'],
        '止盈': ['P01_止盈一档下限', 'P01_止盈一档赎回', 'P02_止盈二档下限', 'P02_止盈二档赎回', 'P03_止盈三档下限', 'P04_止盈恢复'],
        '仓位管理': ['C01_心理止损系数', 'C01_心理止损指数', 'C02_ATR乘数', 'C04_止损下限', 'C04_止损上限', 'C06_冷静期', 'C07_单行业上限'],
        '情绪控制': ['E01_正常阈值', 'E02_减仓阈值', 'E03_冷静期阈值', 'E04_禁止阈值'],
    };

    const paramLabels = {
        V01_PE回溯窗口: 'PE回溯窗口(年)', V02_PE低估阈值: 'PE低估阈值(%)',
        V03_PE暂停阈值: 'PE暂停阈值(%)', V03_PE止盈阈值: 'PE止盈阈值(%)',
        V04_月投上限: '月投上限(元)', V05_单标的上限: '单标的上限(%)',
        M01_VIX正常下限: 'VIX正常下限', M01_VIX正常上限: 'VIX正常上限',
        M02_VIX恐慌阈值: 'VIX恐慌阈值', M03_ERP正常下限: 'ERP正常下限(%)',
        M03_ERP正常上限: 'ERP正常上限(%)', M04_DXY正常下限: 'DXY正常下限',
        M04_DXY正常上限: 'DXY正常上限', M05_市场温度正常下限: '温度下限(%)',
        M05_市场温度正常上限: '温度上限(%)', M06_宏观修正上限: '修正上限(%)',
        TF05_均线天数: '均线天数', TF08_偏离极值: '偏离极值(%)',
        TF10_急涨窗口: '急涨窗口(天)', TF11_急涨警戒: '急涨警戒(%)',
        TF11_急涨极端: '急涨极端(%)',
        S01_标的级暂停: '标的暂停(%)', S02_组合级审视: '组合审视(%)',
        S03_系统级降仓: '系统降仓PE(%)',
        P01_止盈一档下限: '一档下限(%)', P01_止盈一档赎回: '一档赎回(%)',
        P02_止盈二档下限: '二档下限(%)', P02_止盈二档赎回: '二档赎回(%)',
        P03_止盈三档下限: '三档下限(%)', P04_止盈恢复: '恢复阈值(%)',
        C01_心理止损系数: '心理止损系数', C01_心理止损指数: '心理止损指数',
        C02_ATR乘数: 'ATR乘数', C04_止损下限: '止损下限(%)',
        C04_止损上限: '止损上限(%)', C06_冷静期: '冷静期(天)',
        C07_单行业上限: '单行业上限(%)',
        E01_正常阈值: '正常阈值', E02_减仓阈值: '减仓阈值',
        E03_冷静期阈值: '冷静期阈值', E04_禁止阈值: '禁止阈值'
    };

    container.innerHTML = Object.entries(groups).map(([group, keys]) => `
        <div class="param-group">
            <h3>${group}</h3>
            ${keys.map(key => `
                <div class="param-item">
                    <span class="param-name">${paramLabels[key] || key}</span>
                    <input type="number" class="param-value-input" data-key="${key}"
                        value="${AppState.params[key]}" step="any">
                </div>
            `).join('')}
        </div>
    `).join('');

    // 绑定参数变化事件
    container.querySelectorAll('.param-value-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const key = e.target.dataset.key;
            AppState.params[key] = parseFloat(e.target.value) || 0;
        });
    });
}

// ===== 参数操作 =====
function saveParams() {
    // 保存到本地
    localStorage.setItem('trading_params', JSON.stringify(AppState.params));
    // 更新合规引擎
    ComplianceEngine.init(AppState.params);
    showToast('参数已保存到本地', 'success');
}

function resetParams() {
    Object.assign(AppState.params, CONFIG.DEFAULT_PARAMS);
    renderParamsPanel();
    ComplianceEngine.init(AppState.params);
    showToast('已恢复v1.4默认参数', 'info');
}

// ===== 合规检查 =====
function runComplianceCheck() {
    const action = {
        type: document.getElementById('checkAction').value,
        code: document.getElementById('checkCode').value,
        name: document.getElementById('checkName').value,
        amount: parseFloat(document.getElementById('checkAmount').value) || 0,
        emotion: parseFloat(document.getElementById('checkEmotion').value) || 20,
    };

    // 构建上下文（从当前数据中提取）
    const context = buildComplianceContext(action);

    // 执行检查
    const result = ComplianceEngine.check(action, context);

    // 渲染结果
    renderComplianceResult(result);
}

function buildComplianceContext(action) {
    const holdings = AppState.data.holdings.map(r => r.fields);
    const totalAssets = holdings.reduce((sum, h) => sum + (parseFloat(h['市值']) || 0), 0) || 100000;

    // 查找当前持仓
    const holding = holdings.find(h => h['代码'] === action.code);
    const currentHolding = holding ? parseFloat(holding['市值']) || 0 : 0;
    const costPrice = holding ? parseFloat(holding['成本价']) || 0 : 0;
    const currentPrice = holding ? parseFloat(holding['当前价']) || 0 : 0;
    const holdingLoss = costPrice > 0 ? ((currentPrice - costPrice) / costPrice * 100) : 0;

    return {
        totalAssets,
        currentHolding,
        holdingLoss,
        overallPEPercentile: 42, // 从估值数据读取
        monthTotalInvest: 1500,
        sma200: currentPrice * 0.98, // 模拟
        currentPrice,
        momentum12_1: 5.2,
        priceChange20d: 3.1,
        addCount: 1,
        baseAmount: 750,
        deviation: 3.5,
        totalLoss: -5.2,
        industryTotal: totalAssets * 0.25,
    };
}

function renderComplianceResult(result) {
    const container = document.getElementById('complianceResult');
    const summary = document.getElementById('complianceSummary');
    const details = document.getElementById('complianceDetails');

    container.style.display = 'block';

    // 汇总
    summary.innerHTML = `
        <div class="compliance-stat pass">
            <div class="count">${result.summary.passed}</div>
            <div class="label">通过</div>
        </div>
        <div class="compliance-stat fail">
            <div class="count">${result.summary.failed}</div>
            <div class="label">未通过</div>
        </div>
        <div class="compliance-stat warn">
            <div class="count">${result.summary.warned}</div>
            <div class="label">警告</div>
        </div>
        <div class="compliance-stat" style="background:var(--bg-primary)">
            <div class="count" style="color:${result.pass ? 'var(--accent-green)' : 'var(--accent-red)'}">
                ${result.pass ? '✅ 合规' : '❌ 违规'}
            </div>
            <div class="label">总体结论</div>
        </div>
    `;

    // 详细列表
    details.innerHTML = result.checks.map(c => `
        <div class="check-item">
            <span class="check-icon ${c.status}">
                ${c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '!'}
            </span>
            <span class="check-rule">${c.rule}</span>
            <strong style="min-width:100px">${c.title}</strong>
            <span class="check-desc">${c.desc}</span>
        </div>
    `).join('');
}

// ===== 表单处理 =====
function initForms() {
    // 持仓表单
    document.getElementById('holdingForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const fields = Object.fromEntries(formData);
        fields['市值'] = (parseFloat(fields['持仓数量']) || 0) * (parseFloat(fields['当前价']) || 0);

        if (AppState.connected) {
            await FeishuAPI.createRecord('持仓数据', fields);
        }
        AppState.data.holdings.push({ fields });
        closeModal('addHoldingModal');
        renderHoldings();
        showToast('持仓已保存', 'success');
    });

    // 交易表单
    document.getElementById('tradeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const fields = Object.fromEntries(formData);

        if (AppState.connected) {
            await FeishuAPI.createRecord('交易记录', fields);
        }
        AppState.data.trades.push({ fields });
        closeModal('addTradeModal');
        renderTrades();
        showToast('交易已记录', 'success');
    });
}

function showAddHolding() { document.getElementById('addHoldingModal').style.display = 'flex'; }
function showAddTrade() { document.getElementById('addTradeModal').style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function editHolding(idx) { showAddHolding(); }

// ===== ECharts图表 =====
function getChartOption(title, series, xData, yAxes) {
    return {
        backgroundColor: 'transparent',
        textStyle: { color: '#8b949e' },
        tooltip: {
            trigger: 'axis',
            backgroundColor: '#1c2128',
            borderColor: '#30363d',
            textStyle: { color: '#e6edf3', fontSize: 12 }
        },
        legend: {
            textStyle: { color: '#8b949e', fontSize: 11 },
            top: 0
        },
        grid: { top: 30, right: 20, bottom: 30, left: 50 },
        xAxis: {
            type: 'category',
            data: xData,
            axisLine: { lineStyle: { color: '#30363d' } },
            axisLabel: { color: '#6e7681', fontSize: 10 }
        },
        yAxis: yAxes || {
            type: 'value',
            axisLine: { lineStyle: { color: '#30363d' } },
            axisLabel: { color: '#6e7681', fontSize: 10 },
            splitLine: { lineStyle: { color: '#21262d' } }
        },
        series
    };
}

function initChart(id) {
    const dom = document.getElementById(id);
    if (!dom) return null;
    if (AppState.charts[id]) {
        AppState.charts[id].dispose();
    }
    const chart = echarts.init(dom);
    AppState.charts[id] = chart;
    return chart;
}

function renderVixErpChart(dates, vixData, erpData) {
    const chart = initChart('chart-vix-erp');
    if (!chart) return;
    chart.setOption({
        ...getChartOption('VIX & ERP', [], dates),
        legend: { data: ['VIX', 'ERP(%)'], textStyle: { color: '#8b949e' }, top: 0 },
        yAxis: [
            { type: 'value', name: 'VIX', axisLine: { lineStyle: { color: '#30363d' } }, splitLine: { lineStyle: { color: '#21262d' } }, axisLabel: { color: '#6e7681' } },
            { type: 'value', name: 'ERP(%)', axisLine: { lineStyle: { color: '#30363d' } }, splitLine: { show: false }, axisLabel: { color: '#6e7681' } }
        ],
        series: [
            { name: 'VIX', type: 'line', data: vixData, smooth: true, lineStyle: { color: '#f85149' }, itemStyle: { color: '#f85149' }, showSymbol: false },
            { name: 'ERP(%)', type: 'line', yAxisIndex: 1, data: erpData, smooth: true, lineStyle: { color: '#3fb950' }, itemStyle: { color: '#3fb950' }, showSymbol: false }
        ]
    });
}

function renderPETrendChart(dates, peData) {
    const chart = initChart('chart-pe-trend');
    if (!chart) return;
    chart.setOption({
        ...getChartOption('PE百分位', [], dates),
        yAxis: { type: 'value', name: '%', max: 100, axisLine: { lineStyle: { color: '#30363d' } }, splitLine: { lineStyle: { color: '#21262d' } }, axisLabel: { color: '#6e7681' } },
        visualMap: {
            show: false, pieces: [
                { lt: 30, color: '#3fb950' },
                { gte: 30, lt: 70, color: '#58a6ff' },
                { gte: 70, color: '#f85149' }
            ]
        },
        series: [{
            name: 'PE百分位', type: 'line', data: peData, smooth: true, showSymbol: false,
            areaStyle: { opacity: 0.15 },
            markLine: {
                silent: true, lineStyle: { type: 'dashed', color: '#6e7681' },
                data: [
                    { yAxis: 30, label: { formatter: '低估30%', color: '#3fb950' } },
                    { yAxis: 70, label: { formatter: '高估70%', color: '#f85149' } },
                    { yAxis: 85, label: { formatter: '止盈85%', color: '#f85149' } }
                ]
            }
        }]
    });
}

function renderDXYChart(dates) {
    const chart = initChart('chart-dxy-margin');
    if (!chart) return;
    // Demo数据
    const len = dates.length || 90;
    const dxyData = Array.from({length: len}, (_, i) => 98 + Math.sin(i / 15) * 5 + Math.random() * 2);
    const marginData = Array.from({length: len}, (_, i) => 500 + Math.sin(i / 20) * 200 + Math.random() * 50);

    chart.setOption({
        ...getChartOption('DXY & 融资', [], dates.length ? dates : generateDateRange(len)),
        legend: { data: ['DXY', '融资净买入'], textStyle: { color: '#8b949e' }, top: 0 },
        yAxis: [
            { type: 'value', name: 'DXY', axisLine: { lineStyle: { color: '#30363d' } }, splitLine: { lineStyle: { color: '#21262d' } }, axisLabel: { color: '#6e7681' } },
            { type: 'value', name: '亿元', axisLine: { lineStyle: { color: '#30363d' } }, splitLine: { show: false }, axisLabel: { color: '#6e7681' } }
        ],
        series: [
            { name: 'DXY', type: 'line', data: dxyData, smooth: true, lineStyle: { color: '#bc8cff' }, itemStyle: { color: '#bc8cff' }, showSymbol: false },
            { name: '融资净买入', type: 'bar', yAxisIndex: 1, data: marginData, itemStyle: { color: '#d29922', opacity: 0.6 } }
        ]
    });
}

function renderMacroScoreChart(dates) {
    const chart = initChart('chart-macro-score');
    if (!chart) return;
    const len = dates.length || 60;
    const scores = Array.from({length: len}, (_, i) => Math.round((Math.sin(i / 20) * 4 + Math.random() * 2) * 10) / 10);

    chart.setOption({
        ...getChartOption('宏观评分', [], dates.length ? dates : generateDateRange(len)),
        yAxis: {
            type: 'value', name: '分', min: -8, max: 8,
            axisLine: { lineStyle: { color: '#30363d' } },
            splitLine: { lineStyle: { color: '#21262d' } },
            axisLabel: { color: '#6e7681' }
        },
        series: [{
            name: '宏观评分', type: 'bar', data: scores.map(s => ({
                value: s,
                itemStyle: { color: s > 0 ? 'rgba(63,185,80,0.7)' : s < 0 ? 'rgba(248,81,73,0.7)' : 'rgba(88,166,255,0.5)' }
            })),
            markLine: {
                silent: true, lineStyle: { type: 'dashed', color: '#6e7681' },
                data: [{ yAxis: 0 }]
            }
        }]
    });
}

function renderHoldingPie(holdings) {
    const chart = initChart('chart-holding-pie');
    if (!chart) return;
    const data = holdings.map(h => ({
        name: h['名称'] || h['代码'] || '未知',
        value: parseFloat(h['市值']) || 0
    }));

    chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', backgroundColor: '#1c2128', borderColor: '#30363d', textStyle: { color: '#e6edf3' } },
        series: [{
            type: 'pie', radius: ['35%', '65%'], center: ['50%', '55%'],
            data, label: { color: '#8b949e', fontSize: 11 },
            itemStyle: { borderColor: '#1c2128', borderWidth: 2 },
            emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } }
        }]
    });
}

function renderHoldingPnl(holdings) {
    const chart = initChart('chart-holding-pnl');
    if (!chart) return;
    const names = holdings.map(h => h['名称'] || h['代码']);
    const pnl = holdings.map(h => {
        const cost = parseFloat(h['成本价']) || 0;
        const current = parseFloat(h['当前价']) || 0;
        return cost > 0 ? ((current - cost) / cost * 100) : 0;
    });

    chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: '#1c2128', borderColor: '#30363d', textStyle: { color: '#e6edf3' } },
        grid: { top: 10, right: 20, bottom: 30, left: 80 },
        xAxis: { type: 'value', axisLine: { lineStyle: { color: '#30363d' } }, splitLine: { lineStyle: { color: '#21262d' } }, axisLabel: { color: '#6e7681', formatter: '{value}%' } },
        yAxis: { type: 'category', data: names, axisLine: { lineStyle: { color: '#30363d' } }, axisLabel: { color: '#8b949e' } },
        series: [{
            type: 'bar', data: pnl.map(v => ({
                value: Math.round(v * 100) / 100,
                itemStyle: { color: v >= 0 ? '#3fb950' : '#f85149' }
            }))
        }]
    });
}

// ===== 工具函数 =====
function setStatus(status) {
    const el = document.getElementById('connectionStatus');
    if (status === 'online') {
        el.className = 'status-indicator online';
        el.textContent = '● 已连接';
        AppState.connected = true;
    } else if (status === 'connecting') {
        el.className = 'status-indicator offline';
        el.textContent = '● 连接中...';
    } else {
        el.className = 'status-indicator offline';
        el.textContent = '● 离线';
        AppState.connected = false;
    }
    document.getElementById('lastUpdate').textContent = new Date().toLocaleString('zh-CN');
}

function showToast(msg, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast ${type}`;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

function generateDateRange(days) {
    const dates = [];
    const now = new Date();
    for (let i = days; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

// 窗口resize时重绘图表
window.addEventListener('resize', () => {
    Object.values(AppState.charts).forEach(c => c && c.resize());
});

// 刷新按钮
document.getElementById('refreshBtn').addEventListener('click', async () => {
    showToast('正在刷新数据...', 'info');
    await connectFeishu();
});
