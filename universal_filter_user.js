// ==UserScript==
// @name         Universal Table Filter & Sort (ALL IN ONE) - v6.6 COMPLETE
// @namespace    http://tampermonkey.net/
// @version      6.6
// @description  Təmiz başlıq + filter + export - BÜTÜN PROBLEMLƏR HƏLL OLUNDU
// @author       You
// @match        *://skycatering.aerochef.online/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_log
// ==/UserScript==

(function() {
    'use strict';

    // ====================================================
    // KONFİQURASİYA (dəyişdirilə bilər)
    // ====================================================
    const CONFIG = {
        autoDetectTables: true,
        enableAllTables: true,
        minRows: 2,
        minColumns: 2,
        maxValues: 100,
        excludeTables: ['layout'],
        excludeSelectors: [],
        excludePages: [
            '/acf/ctm/meal-service-rule-detail',
            'ContractManagement/FKMS_CTM_Menu_Compiler_Details'
        ],
        priorityTables: ['gdv', 'grid', 'table', 'data', 'result', 'list', 'tbl', 'report'],
        saveFilters: true,
        saveSorting: false,
        autoRestore: true,
        enableSearch: true,
        enableExport: true,
        enableMultiSort: true,
        debounceDelay: 300,
        checkInterval: 5000,
        maxTables: 20,
        debug: true,
        logLevel: 'info',

        // BAŞLIQ TƏMİZLƏMƏ PATTERNLƏRİ
        headerCleanupPatterns: [
            { pattern: /â/g, replacement: '' },
            { pattern: /¯/g, replacement: '' },
            { pattern: /†/g, replacement: '' },
            { pattern: /‡/g, replacement: '' },
            { pattern: /[Ââ]/g, replacement: '' },
            { pattern: /\s+/g, replacement: ' ' }
        ],

        // EXPORTDA ATILACAQ BAŞLIQLAR
        excludeHeaderWords: ['edit', 'action', 'delete', 'sil', 'düymə', 'button', 'modify', 'remove', 'düzəliş', 'silmək', '', ' ']
    };

    // ====================================================
    // GLOBAL DƏYİŞƏNLƏR
    // ====================================================
    let processedTables = new Map();
    let activeDropdown = null;
    let currentFilters = new Map();
    let originalTableState = new Map();
    let isInitialized = false;

    // ====================================================
    // LOGGER
    // ====================================================
    const Logger = {
        levels: { none: 0, error: 1, warn: 2, info: 3, debug: 4 },
        currentLevel: CONFIG.logLevel,

        log: function(level, message, ...args) {
            const levelNum = this.levels[level] || 0;
            const currentNum = this.levels[this.currentLevel] || 0;

            if (levelNum <= currentNum && CONFIG.debug) {
                const icons = {
                    error: '❌',
                    warn: '⚠️',
                    info: 'ℹ️',
                    debug: '🔍'
                };
                console.log(`${icons[level] || ''} [TableFilter] ${message}`, ...args);
            }
        },

        error: function(msg, ...args) { this.log('error', msg, ...args); },
        warn: function(msg, ...args) { this.log('warn', msg, ...args); },
        info: function(msg, ...args) { this.log('info', msg, ...args); },
        debug: function(msg, ...args) { this.log('debug', msg, ...args); }
    };

    // ====================================================
    // KÖMƏKÇİ FUNKSİYALAR
    // ====================================================
    function cleanHeaderText(text) {
        if (!text) return '';
        let cleaned = text;
        CONFIG.headerCleanupPatterns.forEach(item => {
            cleaned = cleaned.replace(item.pattern, item.replacement);
        });
        return cleaned.trim();
    }

    function extractCellValue(cell) {
        if (!cell) return '';

        // Input elementləri
        const input = cell.querySelector('input, select, textarea');
        if (input) {
            if (input.tagName === 'SELECT') {
                const opt = input.options[input.selectedIndex];
                return opt ? opt.text.trim() : '';
            }
            return input.value || input.textContent || '';
        }

        // Button varsa - mətnini qaytar
        const button = cell.querySelector('button');
        if (button) {
            return button.textContent.trim();
        }

        // Təmiz mətn
        let text = cell.textContent.trim();
        if (!text || text === '&nbsp;' || text === '\u00A0') {
            text = cell.innerText.trim();
        }
        return text;
    }

    function escapeCsvValue(text) {
        if (text.includes(',') || text.includes('"') || text.includes('\n')) {
            text = text.replace(/"/g, '""');
            text = `"${text}"`;
        }
        return text;
    }

    // ====================================================
    // CSS STİLLƏRİ
    // ====================================================
    function injectStyles() {
        const styles = `
            .utf-filter-btn {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                margin-left: 6px !important;
                padding: 2px 6px !important;
                background: linear-gradient(135deg, #6c757d, #495057) !important;
                border: 1px solid #495057 !important;
                border-radius: 4px !important;
                color: white !important;
                font-size: 11px !important;
                font-family: 'Segoe UI', Arial, sans-serif !important;
                font-weight: 600 !important;
                cursor: pointer !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
                min-width: 20px !important;
                height: 18px !important;
                line-height: 1 !important;
                vertical-align: middle !important;
                user-select: none !important;
                text-shadow: 0 1px 1px rgba(0,0,0,0.2) !important;
            }

            .utf-filter-btn:hover {
                background: linear-gradient(135deg, #007bff, #0056b3) !important;
                border-color: #0056b3 !important;
                transform: translateY(-1px) !important;
                box-shadow: 0 3px 6px rgba(0,123,255,0.3) !important;
            }

            .utf-filter-btn.active {
                background: linear-gradient(135deg, #28a745, #1e7e34) !important;
                border-color: #1e7e34 !important;
                animation: pulse 1.5s infinite !important;
            }

            @keyframes pulse {
                0% { box-shadow: 0 0 0 0 rgba(40, 167, 69, 0.4); }
                70% { box-shadow: 0 0 0 6px rgba(40, 167, 69, 0); }
                100% { box-shadow: 0 0 0 0 rgba(40, 167, 69, 0); }
            }

            .utf-dropdown {
                position: fixed !important;
                background: white !important;
                border: 1px solid #ced4da !important;
                border-radius: 8px !important;
                box-shadow: 0 10px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05) !important;
                z-index: 2147483647 !important;
                min-width: 280px !important;
                max-width: 400px !important;
                max-height: 80vh !important;
                overflow: hidden !important;
                font-family: 'Segoe UI', Arial, sans-serif !important;
                font-size: 13px !important;
                animation: slideDown 0.2s ease-out !important;
                display: flex !important;
                flex-direction: column !important;
            }

            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translateY(-10px) scale(0.95);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            .utf-dropdown-header {
                padding: 12px 16px !important;
                background: linear-gradient(135deg, #007bff, #0056b3) !important;
                color: white !important;
                font-weight: 600 !important;
                font-size: 14px !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                border-bottom: 1px solid rgba(255,255,255,0.1) !important;
                flex-shrink: 0 !important;
            }

            .utf-dropdown-content {
                flex: 1 !important;
                overflow-y: auto !important;
                padding: 0 !important;
                display: flex !important;
                flex-direction: column !important;
            }

            .utf-dropdown-section {
                padding: 12px 16px !important;
                border-bottom: 1px solid #e9ecef !important;
                flex-shrink: 0 !important;
            }

            .utf-dropdown-section:last-child {
                border-bottom: none !important;
            }

            .utf-section-title {
                font-weight: 600 !important;
                color: #495057 !important;
                margin-bottom: 10px !important;
                font-size: 12px !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
            }

            .utf-sort-buttons {
                display: grid !important;
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 6px !important;
                margin-bottom: 8px !important;
            }

            .utf-sort-btn {
                padding: 8px 10px !important;
                background: #e9ecef !important;
                border: 1px solid #ced4da !important;
                border-radius: 4px !important;
                color: #495057 !important;
                font-size: 11px !important;
                font-weight: 500 !important;
                cursor: pointer !important;
                transition: all 0.2s !important;
                text-align: center !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 4px !important;
            }

            .utf-sort-btn:hover {
                background: #dee2e6 !important;
                border-color: #adb5bd !important;
                transform: translateY(-1px) !important;
            }

            .utf-sort-btn.asc {
                background: #d1ecf1 !important;
                border-color: #bee5eb !important;
                color: #0c5460 !important;
            }

            .utf-sort-btn.desc {
                background: #d1ecf1 !important;
                border-color: #bee5eb !important;
                color: #0c5460 !important;
            }

            .utf-sort-btn.numeric {
                background: #f8d7da !important;
                border-color: #f5c6cb !important;
                color: #721c24 !important;
            }

            .utf-search-input {
                width: 100% !important;
                padding: 8px 12px !important;
                margin-bottom: 10px !important;
                border: 1px solid #ced4da !important;
                border-radius: 4px !important;
                font-size: 12px !important;
                background: #f8f9fa !important;
                transition: all 0.2s !important;
            }

            .utf-search-input:focus {
                outline: none !important;
                border-color: #80bdff !important;
                box-shadow: 0 0 0 0.2rem rgba(0,123,255,0.25) !important;
                background: white !important;
            }

            .utf-filter-section-content {
                flex: 1 !important;
                min-height: 150px !important;
                max-height: 300px !important;
                display: flex !important;
                flex-direction: column !important;
            }

            .utf-options-container {
                flex: 1 !important;
                overflow-y: auto !important;
                margin-bottom: 10px !important;
                border: 1px solid #e9ecef !important;
                border-radius: 4px !important;
                padding: 4px !important;
                background: #f8f9fa !important;
                max-height: 250px !important;
                min-height: 100px !important;
            }

            .utf-options-container::-webkit-scrollbar {
                width: 8px !important;
            }

            .utf-options-container::-webkit-scrollbar-track {
                background: #f1f1f1 !important;
                border-radius: 4px !important;
            }

            .utf-options-container::-webkit-scrollbar-thumb {
                background: #888 !important;
                border-radius: 4px !important;
            }

            .utf-options-container::-webkit-scrollbar-thumb:hover {
                background: #555 !important;
            }

            .utf-option {
                display: flex !important;
                align-items: center !important;
                padding: 6px 8px !important;
                margin: 2px 0 !important;
                border-radius: 3px !important;
                cursor: pointer !important;
                transition: all 0.15s !important;
                user-select: none !important;
                min-height: 28px !important;
            }

            .utf-option:hover {
                background: #e9ecef !important;
            }

            .utf-option input[type="checkbox"] {
                margin-right: 8px !important;
                cursor: pointer !important;
                transform: scale(1.1) !important;
                flex-shrink: 0 !important;
            }

            .utf-option-text {
                font-size: 12px !important;
                color: #212529 !important;
                flex-grow: 1 !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }

            .utf-bulk-actions {
                display: grid !important;
                grid-template-columns: 1fr 1fr !important;
                gap: 6px !important;
                margin-top: 8px !important;
                flex-shrink: 0 !important;
            }

            .utf-bulk-btn {
                padding: 8px !important;
                border: none !important;
                border-radius: 4px !important;
                font-size: 11px !important;
                font-weight: 500 !important;
                cursor: pointer !important;
                transition: all 0.2s !important;
                text-align: center !important;
            }

            .utf-bulk-btn.select-all {
                background: #28a745 !important;
                color: white !important;
            }

            .utf-bulk-btn.select-all:hover {
                background: #218838 !important;
            }

            .utf-bulk-btn.deselect-all {
                background: #dc3545 !important;
                color: white !important;
            }

            .utf-bulk-btn.deselect-all:hover {
                background: #c82333 !important;
            }

            .utf-quick-actions {
                display: grid !important;
                grid-template-columns: 1fr !important;
                gap: 6px !important;
            }

            .utf-quick-btn {
                padding: 10px 12px !important;
                border: none !important;
                border-radius: 4px !important;
                font-size: 12px !important;
                font-weight: 500 !important;
                cursor: pointer !important;
                transition: all 0.2s !important;
                text-align: left !important;
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
            }

            .utf-quick-btn.show-all {
                background: #17a2b8 !important;
                color: white !important;
            }

            .utf-quick-btn.show-all:hover {
                background: #138496 !important;
            }

            .utf-quick-btn.clear-filters {
                background: #6c757d !important;
                color: white !important;
            }

            .utf-quick-btn.clear-filters:hover {
                background: #545b62 !important;
            }

            .utf-quick-btn.export {
                background: #28a745 !important;
                color: white !important;
            }

            .utf-quick-btn.export:hover {
                background: #218838 !important;
            }

            .utf-counter-badge {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                min-width: 18px !important;
                height: 18px !important;
                padding: 0 4px !important;
                background: #dc3545 !important;
                color: white !important;
                font-size: 10px !important;
                font-weight: bold !important;
                border-radius: 9px !important;
                margin-left: 4px !important;
            }

            @media (max-width: 768px) {
                .utf-dropdown {
                    min-width: 250px !important;
                    max-width: 300px !important;
                    font-size: 12px !important;
                }
                .utf-sort-buttons {
                    grid-template-columns: 1fr !important;
                }
            }

            .utf-hidden-row {
                display: none !important;
            }

            .utf-visible-row {
                animation: fadeIn 0.3s ease-out !important;
            }

            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            .utf-sorted {
                position: relative !important;
            }

            .utf-sorted-asc::after {
                content: " ↑" !important;
                color: #28a745 !important;
                font-weight: bold !important;
            }

            .utf-sorted-desc::after {
                content: " ↓" !important;
                color: #dc3545 !important;
                font-weight: bold !important;
            }

            .utf-table-footer {
                background: #f8f9fa !important;
                font-weight: bold !important;
            }

            .utf-scroll-counter {
                font-size: 11px !important;
                color: #6c757d !important;
                text-align: center !important;
                padding: 5px !important;
                background: #f8f9fa !important;
                border-radius: 3px !important;
                margin-top: 5px !important;
                flex-shrink: 0 !important;
            }
        `;

        try {
            if (typeof GM_addStyle !== 'undefined') {
                GM_addStyle(styles);
            } else {
                const style = document.createElement('style');
                style.type = 'text/css';
                style.textContent = styles;
                document.head.appendChild(style);
            }
            Logger.debug('CSS styles injected');
        } catch (error) {
            Logger.error('CSS injection error:', error);
            const div = document.createElement('div');
            div.innerHTML = `<style>${styles}</style>`;
            document.head.appendChild(div.firstChild);
        }
    }

    // ====================================================
    // SAYT İSTİSNALARI
    // ====================================================
    function shouldSkipPage() {
        const currentUrl = window.location.href.toLowerCase();
        const currentPath = window.location.pathname.toLowerCase();

        for (const page of CONFIG.excludePages) {
            if (currentPath.includes(page.toLowerCase()) ||
                currentUrl.includes(page.toLowerCase())) {
                return true;
            }
        }

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('noFilter') || urlParams.has('disableFilter')) {
            return true;
        }

        return false;
    }

    // ====================================================
    // CƏDVƏL AXTARIŞI
    // ====================================================
    function scanAndProcessTables() {
        try {
            const allTables = document.querySelectorAll('table');
            Logger.debug(`Tapıldı: ${allTables.length} cədvəl`);

            let processedCount = 0;
            const tablesToProcess = [];

            allTables.forEach(table => {
                if (!processedTables.has(table) && shouldProcessTable(table)) {
                    tablesToProcess.push(table);
                }
            });

            const priorityTables = [];
            const normalTables = [];

            tablesToProcess.forEach(table => {
                if (isPriorityTable(table)) {
                    priorityTables.push(table);
                } else {
                    normalTables.push(table);
                }
            });

            priorityTables.forEach(table => {
                if (processedCount < CONFIG.maxTables) {
                    processTable(table);
                    processedCount++;
                }
            });

            normalTables.forEach(table => {
                if (processedCount < CONFIG.maxTables) {
                    processTable(table);
                    processedCount++;
                }
            });

            if (processedCount > 0) {
                Logger.info(`${processedCount} cədvəl işləndi`);
            }

        } catch (error) {
            Logger.error('Cədvəl scan xətası:', error);
        }
    }

    function shouldProcessTable(table) {
        if (!table || table.tagName.toLowerCase() !== 'table') return false;
        if (table.hasAttribute('data-utf-processed')) return false;

        for (const selector of CONFIG.excludeSelectors) {
            if (table.matches(selector) || table.closest(selector)) {
                return false;
            }
        }

        if (!table.rows || table.rows.length < CONFIG.minRows) return false;
        const firstRow = table.rows[0];
        if (!firstRow || !firstRow.cells || firstRow.cells.length < CONFIG.minColumns) return false;

        const style = window.getComputedStyle(table);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }

        return true;
    }

    function isPriorityTable(table) {
        const tableId = (table.id || '').toLowerCase();
        const tableClass = (table.className || '').toLowerCase();

        for (const priority of CONFIG.priorityTables) {
            if (tableId.includes(priority) || tableClass.includes(priority)) {
                return true;
            }
        }
        return false;
    }

    function processTable(table) {
        try {
            if (!table.id || table.id.trim() === '') {
                table.id = 'utf_table_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            }

            if (!originalTableState.has(table.id)) {
                originalTableState.set(table.id, {
                    html: table.outerHTML,
                    timestamp: Date.now()
                });
            }

            table.setAttribute('data-utf-processed', 'true');
            table.setAttribute('data-utf-id', table.id);

            const headersAdded = addFilterButtons(table);

            if (headersAdded > 0) {
                processedTables.set(table, {
                    id: table.id,
                    headers: headersAdded,
                    timestamp: Date.now()
                });

                Logger.debug(`Cədvəl işləndi: ${getTableName(table)} (${headersAdded} başlıq)`);

                if (CONFIG.autoRestore) {
                    restoreTableFilters(table);
                }
            }

        } catch (error) {
            Logger.error('Cədvəl işlənmə xətası:', error);
            if (table && table.removeAttribute) {
                table.removeAttribute('data-utf-processed');
            }
        }
    }

    function addFilterButtons(table) {
        let buttonsAdded = 0;

        try {
            let headers = table.querySelectorAll('th');

            if (headers.length === 0 && table.rows.length > 0) {
                headers = Array.from(table.rows[0].cells);
            } else {
                headers = Array.from(headers);
            }

            headers.forEach((header, columnIndex) => {
                const headerText = header.textContent.trim();

                if (!headerText || headerText === '&nbsp;' || headerText.length < 1) {
                    return;
                }

                if (header.querySelector('.utf-filter-btn')) {
                    return;
                }

                const button = createFilterButton(header, columnIndex, headerText, table);
                if (button) {
                    header.appendChild(button);
                    buttonsAdded++;
                }
            });

        } catch (error) {
            Logger.error('Filter button əlavə xətası:', error);
        }

        return buttonsAdded;
    }

    function createFilterButton(header, columnIndex, columnName, table) {
        const button = document.createElement('span');
        button.className = 'utf-filter-btn';
        button.innerHTML = '⯆';
        button.title = `${cleanHeaderText(columnName)} - Filter və sıralama`;
        button.setAttribute('data-column-index', columnIndex);
        button.setAttribute('data-table-id', table.id);
        button.setAttribute('data-column-name', columnName);

        const savedFilters = loadFilterState(table.id, columnIndex);
        if (savedFilters && savedFilters.length > 0) {
            button.classList.add('active');
            const badge = document.createElement('span');
            badge.className = 'utf-counter-badge';
            badge.textContent = savedFilters.length;
            button.appendChild(badge);
        }

        button.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            showFilterDropdown(this, columnIndex, columnName, table);
        });

        return button;
    }

    // ====================================================
    // FILTER DROPDOWN
    // ====================================================
    function showFilterDropdown(button, columnIndex, columnName, table) {
        closeDropdown();

        try {
            const uniqueValues = getColumnValues(table, columnIndex);
            if (uniqueValues.length === 0) {
                showNotification('Bu sütunda filterləmə üçün dəyər yoxdur', 'warning');
                return;
            }

            const dropdown = createDropdown(table, columnIndex, columnName, uniqueValues);
            document.body.appendChild(dropdown);
            positionDropdown(dropdown, button);

            activeDropdown = {
                element: dropdown,
                tableId: table.id,
                columnIndex: columnIndex,
                trigger: button
            };

            setupDropdownEventHandlers(dropdown, table, columnIndex);

            Logger.debug(`Dropdown açıldı: ${columnName} (${uniqueValues.length} dəyər)`);

        } catch (error) {
            Logger.error('Dropdown yaratma xətası:', error);
        }
    }

    function createDropdown(table, columnIndex, columnName, values) {
        const dropdown = document.createElement('div');
        dropdown.className = 'utf-dropdown';
        dropdown.setAttribute('data-table-id', table.id);
        dropdown.setAttribute('data-column-index', columnIndex);

        const savedFilters = loadFilterState(table.id, columnIndex) || [];
        const isNumeric = isNumericColumn(table, columnIndex);
        const cleanName = cleanHeaderText(columnName);

        const sortButtonsHTML = `
            <button class="utf-sort-btn asc" data-action="sort" data-type="asc">
                <span>▲</span> A-Z
            </button>
            <button class="utf-sort-btn desc" data-action="sort" data-type="desc">
                <span>▼</span> Z-A
            </button>
            ${isNumeric ? `
            <button class="utf-sort-btn numeric" data-action="sort" data-type="num-asc">
                <span>↑</span> 1-9
            </button>
            <button class="utf-sort-btn numeric" data-action="sort" data-type="num-desc">
                <span>↓</span> 9-1
            </button>
            ` : ''}
        `;

        let optionsHTML = '';
        values.slice(0, CONFIG.maxValues).forEach(value => {
            const isChecked = savedFilters.includes(value);
            const safeValue = escapeHtml(value);
            optionsHTML += `
                <label class="utf-option">
                    <input type="checkbox" value="${safeValue}" ${isChecked ? 'checked' : ''}>
                    <span class="utf-option-text">${safeValue}</span>
                </label>
            `;
        });

        dropdown.innerHTML = `
            <div class="utf-dropdown-header">
                <div>
                    <strong>${escapeHtml(cleanName)}</strong>
                    <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">
                        ${values.length} dəyər
                    </div>
                </div>
                ${savedFilters.length > 0 ? `
                <div style="font-size: 11px; background: rgba(255,255,255,0.3); padding: 2px 8px; border-radius: 10px;">
                    ${savedFilters.length} filter
                </div>
                ` : ''}
            </div>

            <div class="utf-dropdown-content">
                <div class="utf-dropdown-section">
                    <div class="utf-section-title">
                        <span>📊 Sıralama</span>
                        <small style="font-weight: normal; opacity: 0.7;">(Frontend only)</small>
                    </div>
                    <div class="utf-sort-buttons">
                        ${sortButtonsHTML}
                    </div>
                </div>

                <div class="utf-dropdown-section">
                    <div class="utf-section-title">
                        <span>🔍 Filtrləmə</span>
                        <button class="utf-clear-btn" data-action="clear-filter"
                                style="background: none; border: none; color: #dc3545; cursor: pointer; font-size: 12px;">
                            🗑️ Təmizlə
                        </button>
                    </div>

                    <div class="utf-filter-section-content">
                        ${CONFIG.enableSearch ? `
                        <input type="text" class="utf-search-input"
                               placeholder="Dəyər axtar..."
                               data-action="search">
                        ` : ''}

                        <div class="utf-options-container">
                            ${optionsHTML}
                        </div>

                        <div class="utf-scroll-counter">
                            ${values.length > CONFIG.maxValues ?
                              `Göstərilir: ${CONFIG.maxValues} / ${values.length}` :
                              `${values.length} dəyər`}
                        </div>

                        <div class="utf-bulk-actions">
                            <button class="utf-bulk-btn select-all" data-action="select-all">
                                ✓ Hamısı
                            </button>
                            <button class="utf-bulk-btn deselect-all" data-action="deselect-all">
                                ✗ Heç biri
                            </button>
                        </div>
                    </div>
                </div>

                <div class="utf-dropdown-section">
                    <div class="utf-section-title">⚡ Sürətli Əməllər</div>
                    <div class="utf-quick-actions">
                        <button class="utf-quick-btn show-all" data-action="show-all">
                            <span>📋</span> Bütün sətirləri göstər
                        </button>
                        <button class="utf-quick-btn clear-filters" data-action="clear-all-filters">
                            <span>🗑️</span> Bütün filterləri sil
                        </button>
                        ${CONFIG.enableExport ? `
                        <button class="utf-quick-btn export" data-action="export">
                            <span>📥</span> Export et (CSV)
                        </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

        return dropdown;
    }

    function positionDropdown(dropdown, trigger) {
        const rect = trigger.getBoundingClientRect();
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };

        let top = rect.bottom + window.scrollY + 5;
        let left = rect.left + window.scrollX;

        if (top + dropdown.offsetHeight > viewport.height + window.scrollY) {
            top = rect.top + window.scrollY - dropdown.offsetHeight - 5;
        }

        if (left + dropdown.offsetWidth > viewport.width + window.scrollX) {
            left = viewport.width + window.scrollX - dropdown.offsetWidth - 10;
        }

        if (left < 10) left = 10;
        if (top < 10) top = 10;

        dropdown.style.top = top + 'px';
        dropdown.style.left = left + 'px';
    }

    // ====================================================
    // DROPDOWN EVENT HANDLERS
    // ====================================================
    function setupDropdownEventHandlers(dropdown, table, columnIndex) {
        const tableId = table.id;

        const searchInput = dropdown.querySelector('.utf-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', function(e) {
                e.stopPropagation();
                const searchValue = this.value.toLowerCase();
                filterOptionsInDropdown(dropdown, searchValue);
            });
        }

        dropdown.addEventListener('click', function(e) {
            e.stopPropagation();

            if (e.target.type === 'checkbox') {
                handleCheckboxChange(e.target);
                return;
            }

            if (e.target.classList.contains('utf-option-text') ||
                e.target.classList.contains('utf-option')) {
                const label = e.target.closest('.utf-option');
                if (label) {
                    const checkbox = label.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        handleCheckboxChange(checkbox);
                    }
                }
                return;
            }

            let actionElement = e.target.closest('[data-action]');
            if (actionElement) {
                const action = actionElement.getAttribute('data-action');
                handleDropdownAction(action, actionElement, tableId, columnIndex);
            }
        });

        dropdown.addEventListener('change', function(e) {
            if (e.target.type === 'checkbox') {
                handleCheckboxChange(e.target);
            }
        });

        setTimeout(() => {
            const closeHandler = (e) => {
                if (!dropdown.contains(e.target) && e.target !== activeDropdown?.trigger) {
                    closeDropdown();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 10);
    }

    function handleCheckboxChange(checkbox) {
        const dropdown = checkbox.closest('.utf-dropdown');
        if (!dropdown) return;

        const tableId = dropdown.getAttribute('data-table-id');
        const columnIndex = parseInt(dropdown.getAttribute('data-column-index'));

        updateFilterState(tableId, columnIndex);
    }

    function handleDropdownAction(action, element, tableId, columnIndex) {
        const dropdown = element.closest('.utf-dropdown');

        switch (action) {
            case 'sort':
                const sortType = element.getAttribute('data-type');
                sortTableColumn(tableId, columnIndex, sortType);
                break;
            case 'clear-filter':
                clearSingleFilter(tableId, columnIndex);
                closeDropdown();
                break;
            case 'select-all':
                selectAllValues(dropdown);
                break;
            case 'deselect-all':
                deselectAllValues(dropdown);
                break;
            case 'show-all':
                showAllRows(tableId);
                closeDropdown();
                break;
            case 'clear-all-filters':
                clearAllFilters(tableId);
                closeDropdown();
                break;
            case 'export':
                exportTable(tableId);
                closeDropdown();
                break;
        }
    }

    function filterOptionsInDropdown(dropdown, searchText) {
        const optionsContainer = dropdown.querySelector('.utf-options-container');
        if (!optionsContainer) return;

        const options = optionsContainer.querySelectorAll('.utf-option');
        let visibleCount = 0;

        options.forEach((option) => {
            const optionText = option.querySelector('.utf-option-text');
            if (!optionText) return;

            const text = optionText.textContent.toLowerCase();
            const isMatch = text.includes(searchText);

            option.style.display = isMatch ? 'flex' : 'none';
            if (isMatch) visibleCount++;
        });

        const counter = dropdown.querySelector('.utf-scroll-counter');
        if (counter) {
            if (searchText && searchText.trim() !== '') {
                counter.textContent = `${visibleCount} nəticə`;
            } else {
                const totalOptions = options.length;
                counter.textContent = `${totalOptions} dəyər`;
            }
        }
    }

    function selectAllValues(dropdown) {
        const checkboxes = dropdown.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = true);
        checkboxes.forEach(cb => {
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
        showNotification('Bütün dəyərlər seçildi', 'success');
    }

    function deselectAllValues(dropdown) {
        const checkboxes = dropdown.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = false);
        checkboxes.forEach(cb => {
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
        showNotification('Bütün dəyərlər silindi', 'success');
    }

    // ====================================================
    // SIRALAMA
    // ====================================================
    function sortTableColumn(tableId, columnIndex, sortType) {
        const table = document.getElementById(tableId);
        if (!table) return;

        try {
            const rows = Array.from(table.rows);
            if (rows.length < 2) return;

            const headerRow = rows.shift();
            const tbody = table.querySelector('tbody') || table;

            rows.sort((a, b) => {
                const aVal = extractCellValue(a.cells[columnIndex]) || '';
                const bVal = extractCellValue(b.cells[columnIndex]) || '';

                switch (sortType) {
                    case 'num-asc':
                        const aNum = parseFloat(aVal.replace(',', '.')) || 0;
                        const bNum = parseFloat(bVal.replace(',', '.')) || 0;
                        return aNum - bNum;
                    case 'num-desc':
                        const aNum2 = parseFloat(aVal.replace(',', '.')) || 0;
                        const bNum2 = parseFloat(bVal.replace(',', '.')) || 0;
                        return bNum2 - aNum2;
                    case 'desc':
                        return bVal.localeCompare(aVal);
                    case 'asc':
                    default:
                        return aVal.localeCompare(bVal);
                }
            });

            while (tbody.rows.length > 1) {
                tbody.deleteRow(1);
            }

            rows.forEach(row => tbody.appendChild(row));
            highlightSortedColumn(table, columnIndex, sortType);
            showNotification(`Sütun sıralandı: ${getSortTypeName(sortType)}`, 'success');
            Logger.debug(`Sıralama: ${tableId} sütun ${columnIndex}, tip: ${sortType}`);

        } catch (error) {
            Logger.error('Sıralama xətası:', error);
            showNotification('Sıralama xətası', 'error');
        }
    }

    function highlightSortedColumn(table, columnIndex, sortType) {
        table.querySelectorAll('.utf-sorted').forEach(el => {
            el.classList.remove('utf-sorted', 'utf-sorted-asc', 'utf-sorted-desc');
        });

        const headerCell = table.rows[0].cells[columnIndex];
        if (headerCell) {
            headerCell.classList.add('utf-sorted');
            headerCell.classList.add(sortType.includes('desc') ? 'utf-sorted-desc' : 'utf-sorted-asc');

            const button = headerCell.querySelector('.utf-filter-btn');
            if (button) {
                button.innerHTML = sortType.includes('desc') ? '▼' : '▲';
                setTimeout(() => {
                    button.innerHTML = '⯆';
                }, 2000);
            }
        }
    }

    function getSortTypeName(sortType) {
        const names = {
            'asc': 'A-Z (artan)',
            'desc': 'Z-A (azalan)',
            'num-asc': '1-9 (kiçikdən böyüyə)',
            'num-desc': '9-1 (böyükdən kiçiyə)'
        };
        return names[sortType] || 'Sıralama';
    }

    // ====================================================
    // FILTER
    // ====================================================
    function updateFilterState(tableId, columnIndex) {
        const dropdown = document.querySelector('.utf-dropdown');
        if (!dropdown) return;

        const checkboxes = dropdown.querySelectorAll('input[type="checkbox"]:checked');
        const selectedValues = Array.from(checkboxes).map(cb => cb.value);

        if (!currentFilters.has(tableId)) {
            currentFilters.set(tableId, new Map());
        }
        currentFilters.get(tableId).set(columnIndex, selectedValues);

        applyFilter(tableId, columnIndex, selectedValues);

        if (CONFIG.saveFilters) {
            saveFilterState(tableId, columnIndex, selectedValues);
        }

        updateFilterButton(tableId, columnIndex, selectedValues.length > 0, selectedValues.length);

        if (selectedValues.length > 0) {
            showNotification(`${selectedValues.length} filter tətbiq edildi`, 'success');
        }
    }

    function applyFilter(tableId, columnIndex, selectedValues) {
        const table = document.getElementById(tableId);
        if (!table) return;

        let visibleCount = 0;
        const rows = Array.from(table.rows).slice(1);

        Logger.debug(`🔍 Filter tətbiq edilir: sütun ${columnIndex}, seçilmiş dəyərlər:`, selectedValues);

        rows.forEach((row, index) => {
            const cell = row.cells[columnIndex];
            const value = cell ? extractCellValue(cell) : '';

            if (index < 5) {
                Logger.debug(`  Sətir ${index}: "${value}"`);
            }

            if (selectedValues.length === 0 || selectedValues.includes(value)) {
                row.style.display = '';
                row.classList.remove('utf-hidden-row');
                visibleCount++;
            } else {
                row.style.display = 'none';
                row.classList.add('utf-hidden-row');
            }
        });

        updateTableFooter(table, visibleCount, rows.length);
        Logger.debug(`✅ Filter tətbiq edildi: ${visibleCount}/${rows.length} sətir görünür`);

        if (visibleCount === 0 && selectedValues.length > 0) {
            showNotification('Heç bir uyğun sətir tapılmadı', 'warning');
        }
    }

    function updateTableFooter(table, visibleCount, totalCount) {
        const oldFooter = table.querySelector('.utf-table-footer');
        if (oldFooter) oldFooter.remove();

        if (visibleCount !== totalCount) {
            let tfoot = table.querySelector('tfoot');
            if (!tfoot) {
                tfoot = document.createElement('tfoot');
                table.appendChild(tfoot);
            }

            const footerRow = tfoot.insertRow();
            footerRow.className = 'utf-table-footer';
            footerRow.innerHTML = `
                <td colspan="${table.rows[0].cells.length}"
                    style="background: #e9ecef; padding: 8px; font-size: 12px; text-align: center; color: #495057; border-top: 2px solid #007bff;">
                    <strong>${visibleCount}</strong> sətir görünür (cəmi: ${totalCount})
                    ${visibleCount < totalCount ?
                      `<span style="margin-left: 10px; color: #dc3545; font-weight: bold;">
                        ⚠️ ${totalCount - visibleCount} sətir gizlidir
                      </span>` : ''}
                </td>
            `;
        }
    }

    // ====================================================
    // STORAGE
    // ====================================================
    function getStorageKey(tableId, columnIndex = null) {
        const pageKey = btoa(window.location.pathname).replace(/[^a-zA-Z0-9]/g, '').substr(0, 20);
        const baseKey = `utf_${pageKey}_${tableId}`;
        return columnIndex !== null ? `${baseKey}_col_${columnIndex}` : baseKey;
    }

    function saveFilterState(tableId, columnIndex, values) {
        try {
            const key = getStorageKey(tableId, columnIndex);
            const data = {
                values: values,
                timestamp: Date.now(),
                tableId: tableId,
                columnIndex: columnIndex,
                url: window.location.href
            };

            if (typeof GM_setValue !== 'undefined') {
                GM_setValue(key, JSON.stringify(data));
            } else {
                localStorage.setItem(key, JSON.stringify(data));
            }

            Logger.debug(`Filter saxlandı: ${key} (${values.length} dəyər)`);

        } catch (error) {
            Logger.error('Filter save xətası:', error);
        }
    }

    function loadFilterState(tableId, columnIndex) {
        try {
            const key = getStorageKey(tableId, columnIndex);
            let stored;

            if (typeof GM_getValue !== 'undefined') {
                stored = GM_getValue(key);
            } else {
                stored = localStorage.getItem(key);
            }

            if (!stored) return null;

            const data = JSON.parse(stored);

            if (Date.now() - data.timestamp > 30 * 24 * 60 * 60 * 1000) {
                deleteFilterState(tableId, columnIndex);
                return null;
            }

            return data.values || null;

        } catch (error) {
            Logger.error('Filter load xətası:', error);
            return null;
        }
    }

    function deleteFilterState(tableId, columnIndex) {
        try {
            const key = getStorageKey(tableId, columnIndex);

            if (typeof GM_deleteValue !== 'undefined') {
                GM_deleteValue(key);
            } else {
                localStorage.removeItem(key);
            }

            Logger.debug(`Filter silindi: ${key}`);

        } catch (error) {
            Logger.error('Filter delete xətası:', error);
        }
    }

    // ====================================================
    // KÖMƏKÇİ FUNKSİYALAR
    // ====================================================
    function getColumnValues(table, columnIndex) {
        const values = new Set();
        const rows = Array.from(table.rows).slice(1);

        rows.forEach(row => {
            const cell = row.cells[columnIndex];
            if (cell) {
                const value = extractCellValue(cell);
                if (value && value !== 'Boş' && value.trim().length > 0) {
                    values.add(value);
                }
            }
        });

        return Array.from(values).sort((a, b) => {
            const aNum = parseFloat(a.replace(',', '.'));
            const bNum = parseFloat(b.replace(',', '.'));

            if (!isNaN(aNum) && !isNaN(bNum)) {
                return aNum - bNum;
            }

            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });
    }

    function isNumericColumn(table, columnIndex) {
        const sampleSize = Math.min(5, table.rows.length - 1);
        let numericCount = 0;

        for (let i = 1; i <= sampleSize; i++) {
            const cell = table.rows[i]?.cells[columnIndex];
            if (cell) {
                const value = extractCellValue(cell);
                const num = parseFloat(value.replace(',', '.'));
                if (!isNaN(num) && isFinite(num)) {
                    numericCount++;
                }
            }
        }

        return numericCount >= sampleSize * 0.6;
    }

    function getTableName(table) {
        if (table.id && table.id.trim() !== '') {
            return table.id;
        }

        if (table.className && table.className.trim() !== '') {
            const classes = table.className.split(' ').filter(c => c.length > 0);
            return classes[0] || 'Table';
        }

        return `Table_${table.rows.length}x${table.rows[0]?.cells.length || 0}`;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ====================================================
    // FILTER MANAGEMENT
    // ====================================================
    function clearSingleFilter(tableId, columnIndex) {
        deleteFilterState(tableId, columnIndex);

        if (currentFilters.has(tableId)) {
            currentFilters.get(tableId).delete(columnIndex);
        }

        showAllRows(tableId);
        updateFilterButton(tableId, columnIndex, false, 0);
        showNotification('Filter təmizləndi', 'success');
    }

    function clearAllFilters(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;

        const headers = table.querySelectorAll('th');
        headers.forEach((header, index) => {
            deleteFilterState(tableId, index);
            updateFilterButton(tableId, index, false, 0);
        });

        currentFilters.delete(tableId);
        showAllRows(tableId);
        showNotification('Bütün filterlər təmizləndi', 'success');
        Logger.debug(`Bütün filterlər silindi: ${tableId}`);
    }

function showAllRows(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;

    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
        row.style.display = '';
        row.style.visibility = '';
        row.classList.remove('utf-hidden-row', 'utf-visible-row');
    });

    // Footer-i sil
    const footer = table.querySelector('.utf-table-footer');
    if (footer) footer.remove();

    Logger.debug(`Bütün sətirlər göstərildi: ${tableId}`);
}

    function updateFilterButton(tableId, columnIndex, isActive, count = 0) {
        const table = document.getElementById(tableId);
        if (!table) return;

        const header = table.rows[0].cells[columnIndex];
        if (!header) return;

        const button = header.querySelector('.utf-filter-btn');
        if (!button) return;

        button.classList.toggle('active', isActive);

        let badge = button.querySelector('.utf-counter-badge');

        if (isActive && count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'utf-counter-badge';
                button.appendChild(badge);
            }
            badge.textContent = count;
        } else if (badge) {
            badge.remove();
        }

        const columnName = button.getAttribute('data-column-name') || 'Column';
        button.title = isActive ?
            `${cleanHeaderText(columnName)} - ${count} filter aktiv` :
            `${cleanHeaderText(columnName)} - Filter və sıralama`;
    }

    // ====================================================
    // RESTORE FUNCTIONS
    // ====================================================
    function restoreTableFilters(table) {
        if (!table.id) return;

        let restoredCount = 0;
        const headers = table.querySelectorAll('th');

        headers.forEach((header, columnIndex) => {
            const savedValues = loadFilterState(table.id, columnIndex);
            if (savedValues && savedValues.length > 0) {
                applyFilter(table.id, columnIndex, savedValues);
                updateFilterButton(table.id, columnIndex, true, savedValues.length);

                if (!currentFilters.has(table.id)) {
                    currentFilters.set(table.id, new Map());
                }
                currentFilters.get(table.id).set(columnIndex, savedValues);

                restoredCount++;
            }
        });

        if (restoredCount > 0) {
            Logger.info(`${restoredCount} filter bərpa edildi: ${table.id}`);
        }
    }

    function restoreAllFilters() {
        processedTables.forEach((data, table) => {
            if (table.id) {
                restoreTableFilters(table);
            }
        });
    }

    // ====================================================
    // EXPORT
    // ====================================================
 function exportTable(tableId) {
    try {
        const table = document.getElementById(tableId);
        if (!table) {
            showNotification('Cədvəl tapılmadı!', 'error');
            Logger.error(`Cədvəl tapılmadı: ${tableId}`);
            return;
        }

        // Bütün sətirləri götür
        const allRows = Array.from(table.querySelectorAll('tr'));

        // Görünən sətirləri filtrlə (display: none olmayanlar)
        const visibleRows = allRows.filter(row => {
            const style = window.getComputedStyle(row);
            return style.display !== 'none' &&
                   style.visibility !== 'hidden' &&
                   row.style.display !== 'none';
        });

        if (visibleRows.length === 0) {
            showNotification('Export üçün sətir yoxdur', 'warning');
            return;
        }

        // Başlıq sətrini tap
        let headerRow = table.querySelector('thead tr') || table.rows[0];
        if (!headerRow) {
            showNotification('Başlıq sətri tapılmadı', 'error');
            return;
        }

        // Bütün sütunlar
        const headerCells = Array.from(headerRow.cells);
        const totalColumns = headerCells.length;
        if (totalColumns === 0) {
            showNotification('Sütun tapılmadı', 'error');
            return;
        }

        // CSV məlumatlarını yığ
        const csvRows = [];

        // Başlıq sətri
        const headerRowData = headerCells.map(cell => {
            const text = cell.textContent.trim();
            return escapeCsvValue(text);
        });
        csvRows.push(headerRowData.join(','));

        // Məlumat sətirləri - başlıq sətrini və thead-dakıları keç
        const dataRows = visibleRows.filter(row =>
            row !== headerRow &&
            !row.closest('thead') &&
            !row.closest('tfoot') // tfoot-u da keç
        );

        // Boş sətirləri sil - bütün xanaları boş olanları
        const nonEmptyRows = dataRows.filter(row => {
            // Row-un cells-lərinin hamısı boşdursa, keç
            for (let i = 0; i < totalColumns; i++) {
                const cell = row.cells[i];
                if (cell) {
                    const value = extractCellValue(cell).trim();
                    if (value !== '') {
                        return true; // heç olmasa bir xana dolu
                    }
                }
            }
            return false;
        });

        if (nonEmptyRows.length === 0) {
            showNotification('Məlumat sətiri tapılmadı', 'warning');
            return;
        }

        nonEmptyRows.forEach(row => {
            const rowData = [];
            for (let i = 0; i < totalColumns; i++) {
                const cell = row.cells[i];
                const value = cell ? extractCellValue(cell) : '';
                rowData.push(escapeCsvValue(value));
            }
            csvRows.push(rowData.join(','));
        });

        // CSV yarat
        const csvString = csvRows.join('\n');
        const blob = new Blob(['\uFEFF' + csvString], {
            type: 'text/csv;charset=utf-8;'
        });

        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        link.download = `export_${tableId}_${timestamp}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showNotification(`✅ Export tamamlandı! (${nonEmptyRows.length} sətir, ${totalColumns} sütun)`, 'success');
        Logger.debug(`Export: ${nonEmptyRows.length} sətir, ${totalColumns} sütun`);

    } catch (error) {
        Logger.error('Export xətası:', error);
        showNotification('❌ Export zamanı xəta baş verdi', 'error');
    }
}

    // ====================================================
    // UTILITY
    // ====================================================
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function showNotification(message, type = 'info') {
        if (!CONFIG.debug) return;

        const types = {
            success: { bg: '#28a745', icon: '✅' },
            error: { bg: '#dc3545', icon: '❌' },
            warning: { bg: '#ffc107', icon: '⚠️' },
            info: { bg: '#17a2b8', icon: 'ℹ️' }
        };

        const config = types[type] || types.info;

        const oldNotif = document.getElementById('utf-notification');
        if (oldNotif) oldNotif.remove();

        const notif = document.createElement('div');
        notif.id = 'utf-notification';
        notif.innerHTML = `
            <div style="
                position: fixed;
                top: 20px;
                right: 20px;
                background: ${config.bg};
                color: white;
                padding: 12px 20px;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 2147483646;
                font-family: 'Segoe UI', Arial, sans-serif;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 10px;
                animation: slideInRight 0.3s ease-out;
                max-width: 350px;
                word-break: break-word;
            ">
                <span style="font-size: 16px;">${config.icon}</span>
                <span>${message}</span>
            </div>
        `;

        document.body.appendChild(notif);

        setTimeout(() => {
            if (notif.parentNode) {
                notif.style.opacity = '0';
                setTimeout(() => notif.remove(), 300);
            }
        }, 3000);
    }

    function closeDropdown() {
        if (activeDropdown && activeDropdown.element) {
            activeDropdown.element.remove();
            activeDropdown = null;
        }
    }

    // ====================================================
    // GLOBAL EVENTS
    // ====================================================
    function setupGlobalEvents() {
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && activeDropdown) {
                closeDropdown();
            }

            if (e.ctrlKey && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                scanAndProcessTables();
                showNotification('Cədvəllər yenidən skan edildi', 'info');
            }
        });

        window.addEventListener('popstate', function() {
            setTimeout(scanAndProcessTables, 500);
        });

        window.addEventListener('beforeunload', function() {
            if (CONFIG.saveFilters) {
                saveAllFilters();
            }
        });
    }

    function setupMutationObserver() {
        const observer = new MutationObserver(debounce(function(mutations) {
            let tablesChanged = false;

            mutations.forEach(function(mutation) {
                if (mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1) {
                            if (node.tagName === 'TABLE' ||
                                (node.querySelector && node.querySelector('table'))) {
                                tablesChanged = true;
                            }
                        }
                    });
                }
            });

            if (tablesChanged) {
                setTimeout(scanAndProcessTables, 300);
            }
        }, CONFIG.debounceDelay));

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        Logger.debug('Mutation Observer quruldu');
    }

    function saveAllFilters() {
        if (!CONFIG.saveFilters) return;

        currentFilters.forEach((columnFilters, tableId) => {
            columnFilters.forEach((values, columnIndex) => {
                saveFilterState(tableId, columnIndex, values);
            });
        });

        Logger.debug('Bütün filterlər saxlandı');
    }

    // ====================================================
    // INITIALIZATION
    // ====================================================
    function init() {
        if (isInitialized) return;

        Logger.info('Script başladı - v6.6 COMPLETE');

        try {
            if (shouldSkipPage()) {
                Logger.warn('Bu səhifədə script dayandırıldı');
                return;
            }

            injectStyles();

            setTimeout(() => {
                scanAndProcessTables();
                setupMutationObserver();
            }, 1000);

            if (CONFIG.autoDetectTables) {
                setInterval(scanAndProcessTables, CONFIG.checkInterval);
            }

            setupGlobalEvents();

            if (CONFIG.autoRestore) {
                setTimeout(restoreAllFilters, 1500);
            }

            isInitialized = true;
            Logger.info('Script tam yükləndi');

        } catch (error) {
            Logger.error('Init xətası:', error);
        }
    }

    function startScript() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
        setTimeout(init, 2000);
    }

    startScript();
})();
