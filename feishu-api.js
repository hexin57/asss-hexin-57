/**
 * 数据加载层
 * 从JSON文件读取数据（数据由后台定时从飞书同步）
 */

const FeishuAPI = {
    dataCache: {},
    
    // 中文表名 -> 英文文件名映射
    tableFileMap: {
        '宏观数据_自动': 'macro_auto',
        '宏观数据_手动': 'macro_manual',
        '持仓数据': 'holdings',
        '交易记录': 'trades',
        '指数估值数据': 'valuation',
        '股票历史数据': 'stock_history',
        '规则参数配置': 'rule_params'
    },
    
    // 加载JSON数据文件
    async loadData() {
        const tables = Object.keys(this.tableFileMap);
        
        for (const tableName of tables) {
            const fileName = this.tableFileMap[tableName];
            try {
                const resp = await fetch(`./dashboard-data/${fileName}.json`);
                if (resp.ok) {
                    this.dataCache[tableName] = await resp.json();
                } else {
                    console.warn(`加载 ${tableName} (${fileName}.json) 失败，HTTP ${resp.status}`);
                    this.dataCache[tableName] = [];
                }
            } catch (e) {
                console.error(`加载 ${tableName} 异常:`, e);
                this.dataCache[tableName] = [];
            }
        }
        
        // 加载元数据
        try {
            const metaResp = await fetch('./dashboard-data/metadata.json');
            if (metaResp.ok) {
                this.metadata = await metaResp.json();
                console.log(`数据最后同步: ${this.metadata.last_sync}`);
            }
        } catch (e) {
            console.warn('加载元数据失败');
        }
        
        console.log('数据加载完成:', Object.keys(this.dataCache));
    },

    // 获取宏观数据（手动）
    async getMacroManual() {
        return this.dataCache['宏观数据_手动'] || [];
    },

    // 获取宏观数据（自动）
    async getMacroAuto() {
        return this.dataCache['宏观数据_自动'] || [];
    },

    // 获取持仓数据
    async getHoldings() {
        return this.dataCache['持仓数据'] || [];
    },

    // 获取交易记录
    async getTrades() {
        return this.dataCache['交易记录'] || [];
    },

    // 获取指数估值数据
    async getValuation() {
        return this.dataCache['指数估值数据'] || [];
    },

    // 获取规则参数
    async getRuleParams() {
        return this.dataCache['规则参数配置'] || [];
    },

    // 获取股票历史数据
    async getStockHistory(code) {
        const records = this.dataCache['股票历史数据'] || [];
        return records.filter(r => r.fields['代码'] === code);
    }
};
