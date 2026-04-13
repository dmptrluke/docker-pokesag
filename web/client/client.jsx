/**
 * PokeSAG client.
 *
 * The URL query string is the source of truth for filters. Component state
 * and API requests both derive from it. See applyFilters() for the mutator,
 * and filtersFromUrl() / urlFromFilters() / apiParamsFromFilters() for the
 * three transforms that keep URL, state, and API in sync.
 */

import React from 'react';
import { DateTime } from 'luxon';
import {
    XLg, ChevronLeft, ChevronRight, Arrow90degUp, ArrowClockwise,
    GearFill, X, Plus,
} from 'react-bootstrap-icons';
import { recipientColor, annotateMessage } from './utilities';
import { SETTINGS_DEFS, loadSettings, saveSetting } from './settings';

const AUTO_REFRESH_INTERVAL_MS = 10000;
const PAGE_SIZE = 100;

// =============================================================================
// Filter model
// =============================================================================

// Filter schema. Drives URL parse/serialize, API params, and chip labels.
// label === null means no chip - baud renders inside the protocol chip.
const FILTERS = {
    q:         { type: 'string', default: '',   label: 'Contains'  },
    channel:   { type: 'string', default: null, label: 'Channel'   },
    // "POCSAG" or "POCSAG 1200". Split to protocol+baud when hitting the API.
    protocol:  { type: 'string', default: null, label: 'Protocol'  },
    recipient: { type: 'string', default: null, label: 'Recipient' },
};

const EMPTY_FILTERS = Object.fromEntries(
    Object.entries(FILTERS).map(([k, d]) => [k, d.default]),
);

// Chip render order for the filter bar. Types not listed here get no chip.
const CHIP_ORDER = ['q', 'channel', 'protocol', 'recipient'];

// Types the user can add via the "+ Name" buttons in the filter bar.
const PICKABLE_TYPES = ['channel', 'protocol', 'recipient'];

const isActive = (value) => value != null && value !== '';

function parseFilterValue(type, raw) {
    if (type === 'integer') {
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : null;
    }
    return raw || '';
}

/**
 * Parse filters out of the current URL query string. Missing keys fall back
 * to their FILTERS default. Runs on mount, on popstate, and for deep links.
 */
function filtersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const out = {};
    for (const [key, def] of Object.entries(FILTERS)) {
        out[key] = params.has(key) ? parseFilterValue(def.type, params.get(key)) : def.default;
    }
    return out;
}

function pageFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const p = parseInt(params.get('page') || '1', 10);
    return Number.isFinite(p) && p > 0 ? p : 1;
}

function writeFilterParams(params, filters) {
    for (const key of Object.keys(FILTERS)) {
        if (isActive(filters[key])) params.set(key, String(filters[key]));
    }
}

/**
 * Serialize filters and the current page back into a query string for
 * history.pushState. Returns "?..." or the bare pathname when empty.
 */
function urlFromFilters(filters, page) {
    const params = new URLSearchParams();
    writeFilterParams(params, filters);
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    return qs ? `?${qs}` : window.location.pathname;
}

/**
 * Build query params for a GET /pages request. The filter model uses a
 * composite "protocol" like "POCSAG 1200", but the API takes protocol and
 * baud as separate params - they're split out at this boundary.
 */
function apiParamsFromFilters(filters, page) {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String((page - 1) * PAGE_SIZE));
    writeFilterParams(params, filters);
    if (filters.protocol) {
        const [name, baud] = filters.protocol.split(' ');
        params.set('protocol', name);
        if (baud) params.set('baud', baud);
    }
    return params;
}

// =============================================================================
// Client component
// =============================================================================

export default class Client extends React.Component {
    constructor() {
        super();

        const filters = filtersFromUrl();
        this.state = {
            pages: [],
            hasMore: false,
            searchString: filters.q || '',
            filters,
            page: pageFromUrl(),
            settingsOpen: false,
            settings: loadSettings(),
            error: null,
        };

        this._refreshTimer = null;
    }

    // -- settings ---------------------------------------------------------

    handleSettingChange = (key, value) => {
        saveSetting(key, value);
        const settings = { ...this.state.settings, [key]: value };
        this.setState({ settings });

        if (key === 'autoRefresh') {
            this._clearAutoRefresh();
            if (value) {
                this._refreshTimer = setInterval(() => this.refresh(), AUTO_REFRESH_INTERVAL_MS);
            }
        }
    }

    _clearAutoRefresh() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
    }

    // -- filters & URL sync -----------------------------------------------

    /**
     * The only way filters change. Shallow-merges patch into the current
     * filters, resets to page 1, pushes the new URL, and refetches. Clear a
     * filter by setting it to '' (for q) or null (for everything else).
     *
     *   applyFilters({ channel: 'Wellington' })
     *   applyFilters({ protocol: null })
     *   applyFilters(EMPTY_FILTERS)                // clear all
     */
    applyFilters = (patch) => {
        const next = { ...this.state.filters, ...patch };
        this.setState(
            { filters: next, searchString: next.q || '', page: 1 },
            () => {
                window.history.pushState(null, '', urlFromFilters(next, 1));
                this.refresh();
            },
        );
    }

    clearFilter = (key) => {
        this.applyFilters({ [key]: key === 'q' ? '' : null });
    }

    // Toggle a filter from a row cell click: set if not matching, clear if matching.
    toggleRowFilter = (key, value) => {
        const match = this.state.filters[key] === value;
        this.applyFilters({ [key]: match ? (key === 'q' ? '' : null) : value });
    }

    // -- search box --------------------------------------------------------

    /**
     * Track the live text box content. Deliberately separate from filters.q
     * so typing doesn't fire a query per keystroke - the committed filter
     * only updates on Enter (handleSearch) or on clearing the box.
     */
    updateSearchString = (e) => {
        const value = e.target.value;
        this.setState({ searchString: value });
        // clearing the box immediately clears the q filter
        if (value === '' && this.state.filters.q) {
            this.applyFilters({ q: '' });
        }
    }

    handleSearch = (e) => {
        if (e.key === 'Enter') {
            const value = this.state.searchString;
            if (value !== this.state.filters.q) {
                this.applyFilters({ q: value });
            }
        }
    }

    clearSearch = () => {
        this.setState({ searchString: '' });
        if (this.state.filters.q) {
            this.applyFilters({ q: '' });
        }
    }

    // -- data fetching ----------------------------------------------------

    refresh = () => {
        const { filters, page } = this.state;
        const params = apiParamsFromFilters(filters, page);

        fetch(`/pages?${params}`)
            .then(result => result.json())
            .then(json => {
                if (!json.success) {
                    throw Error(json.error);
                }
                const { items, has_more } = json.data;
                this.setState({ pages: items, hasMore: has_more, error: null });
            })
            .catch(error => {
                console.error('Unable to fetch pages:', error);
                this.setState({ error: error.message || 'Failed to load pages' });
            });
    }

    handlePageChange = (page) => {
        this.setState({ page }, () => {
            window.history.pushState(null, '', urlFromFilters(this.state.filters, page));
            this.refresh();
        });
    }

    handlePopState = () => {
        const filters = filtersFromUrl();
        this.setState(
            { filters, page: pageFromUrl(), searchString: filters.q || '' },
            () => this.refresh(),
        );
    }

    // -- lifecycle --------------------------------------------------------

    handleSettingsToggle = () => {
        this.setState(prev => ({ settingsOpen: !prev.settingsOpen }));
    }

    componentDidMount() {
        this.refresh();
        window.addEventListener('popstate', this.handlePopState);

        if (this.state.settings.autoRefresh) {
            this._refreshTimer = setInterval(() => this.refresh(), AUTO_REFRESH_INTERVAL_MS);
        }
    }

    componentWillUnmount() {
        this._clearAutoRefresh();
        window.removeEventListener('popstate', this.handlePopState);
    }

    render() {
        const { settings, settingsOpen, searchString, filters, error } = this.state;
        const dateFormat = settings.use24hTime ? 'D TT' : 'D tt';

        const rows = this.state.pages.map(page => {
            const formattedDate = DateTime.fromISO(page.rx_date).toFormat(dateFormat);
            const color = settings.recipientColors ? recipientColor(page.recipient) : undefined;
            const recipientStyle = color ? { borderLeft: `3px solid ${color}`, color } : {};
            const protocolValue = page.baud != null ? `${page.protocol} ${page.baud}` : page.protocol;
            const chipClass = `proto-chip ${page.protocol.toLowerCase()}`;
            const chipLabel = page.baud != null ? `${page.protocol[0]}${page.baud}` : page.protocol[0];
            return <tr key={page.id}>
                    <td className="date">{formattedDate}</td>
                    <td className="protocol">
                        <button type="button" className="cell-action"
                                onClick={() => this.toggleRowFilter('protocol', protocolValue)}
                                title={protocolValue}>
                            <span className={chipClass}>{chipLabel}</span>
                        </button>
                    </td>
                    <td className="channel">
                        <button type="button" className="cell-action"
                                onClick={() => this.toggleRowFilter('channel', page.channel)}
                                title={page.channel}>
                            <span className="name">{page.channel}</span>
                        </button>
                    </td>
                    <td className="recipient" style={recipientStyle}>
                        <button type="button" className="cell-action"
                                onClick={() => this.toggleRowFilter('recipient', page.recipient)}>
                            {page.recipient}
                        </button>
                    </td>
                    <td className="message">{annotateMessage(page.content)}</td>
                </tr>
        });

        return <main>
                <nav id="toolbar">
                    <span id="brand">PokeSAG</span>
                    <button type="button" onClick={this.handleSettingsToggle} title="Settings" aria-label="Settings"><GearFill /></button>
                    <input className="search-box" type="text" placeholder="Search..." value={searchString}
                           onChange={this.updateSearchString} onKeyDown={this.handleSearch} aria-label="Search Box" />
                    {searchString !== '' &&
                        <button type="button" className="clear-search" onClick={this.clearSearch} title="Clear search" aria-label="Clear search"><XLg /></button>
                    }
                    <div className="spacer"></div>
                    <Transporter onChange={this.handlePageChange} page={this.state.page} hasMore={this.state.hasMore} containerId="transporter" />
                </nav>

                <FilterBar filters={filters}
                           onApply={this.applyFilters}
                           onClearFilter={this.clearFilter} />

                {settingsOpen &&
                    <SettingsModal
                        settings={settings}
                        onSettingChange={this.handleSettingChange}
                        onClose={this.handleSettingsToggle}
                    />
                }

                {error &&
                    <div className="error-banner" role="alert">
                        <span>Unable to load pages: {error}</span>
                        <button type="button" onClick={() => this.refresh()} title="Retry">Retry</button>
                    </div>
                }

                <div id="page-table">
                    <table>
                        <colgroup>
                            <col className="date" />
                            <col className="protocol" />
                            <col className="channel" />
                            <col className="recipient" />
                            <col className="message" />
                        </colgroup>
                        <thead>
                            <tr>
                                <th scope="col">Received</th>
                                <th scope="col">Proto</th>
                                <th scope="col">Channel</th>
                                <th scope="col">Recipient</th>
                                <th scope="col">Message</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows}
                        </tbody>
                    </table>
                </div>

                <Transporter onChange={this.handlePageChange} page={this.state.page} hasMore={this.state.hasMore} containerId="bottom-transporter" />
            </main>
    }
}

// =============================================================================
// Pagination
// =============================================================================

function Transporter({ onChange, page, hasMore, containerId }) {
    return (
        <nav id={containerId || 'transporter'}>
            {page > 1 &&
                <button type="button" onClick={() => onChange(page - 1)} title="Previous Page" aria-label="Previous page"><ChevronLeft /></button>
            }
            <button type="button" onClick={() => onChange(page + 1)} disabled={!hasMore} title={hasMore ? 'Next Page' : 'No more pages'} aria-label="Next page"><ChevronRight /></button>
            <button type="button" onClick={() => onChange(1)} title="Refresh" aria-label="Refresh">
                {page > 1 ? <Arrow90degUp /> : <ArrowClockwise />}
            </button>
        </nav>
    );
}

// =============================================================================
// Filter bar
// =============================================================================

function FilterBar({ filters, onApply, onClearFilter }) {
    const [openPicker, setOpenPicker] = React.useState(null);
    const containerRef = React.useRef(null);

    React.useEffect(() => {
        if (!openPicker) return undefined;
        const onDocClick = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpenPicker(null);
            }
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setOpenPicker(null);
        };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [openPicker]);

    const activeChips = CHIP_ORDER.filter(k => filters[k]).map(k => (
        <FilterChip key={k} type={k} label={FILTERS[k].label} value={filters[k]}
                    onRemove={() => onClearFilter(k)} />
    ));

    const inactiveTypes = PICKABLE_TYPES.filter(k => !filters[k]);
    const activeCount = activeChips.length;

    const showBar = activeCount > 0 || openPicker !== null;

    const togglePicker = (type) => setOpenPicker(prev => prev === type ? null : type);

    return (
        <div className={`filter-bar${showBar ? '' : ' empty'}`} ref={containerRef}>
            {!showBar && inactiveTypes.map(type => (
                <button key={type} type="button" className="add" onClick={() => togglePicker(type)}>
                    <Plus /> {FILTERS[type].label}
                </button>
            ))}

            {showBar && <>
                {activeChips}
                {inactiveTypes.map(type => (
                    <div className="add-wrap" key={type}>
                        <button type="button" className="add" onClick={() => togglePicker(type)}>
                            <Plus /> {FILTERS[type].label}
                        </button>
                        {openPicker === type &&
                            <FilterPopover type={type}
                                           onSelect={patch => { onApply(patch); setOpenPicker(null); }}
                                           onClose={() => setOpenPicker(null)} />
                        }
                    </div>
                ))}
                {activeCount >= 2 &&
                    <button type="button" className="clear" onClick={() => onApply(EMPTY_FILTERS)} title="Clear all filters">
                        Clear all
                    </button>
                }
            </>}

            {!showBar && openPicker && (
                <FilterPopover type={openPicker}
                               onSelect={patch => { onApply(patch); setOpenPicker(null); }}
                               onClose={() => setOpenPicker(null)} />
            )}
        </div>
    );
}

function FilterChip({ type, label, value, onRemove }) {
    return (
        <span className={`chip ${type}`}>
            <span className="text">
                <span className="label">{label}:</span>
                <span className="value">{value}</span>
            </span>
            <button type="button" className="remove" onClick={onRemove} title={`Remove ${label} filter`} aria-label={`Remove ${label} filter`}>
                <X />
            </button>
        </span>
    );
}

function FilterPopover({ type, onSelect, onClose }) {
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState(null);
    const inputRef = React.useRef(null);

    React.useEffect(() => {
        if (type === 'recipient') {
            // recipient has too many values for a list; use a text input instead
            setData([]);
            return;
        }
        let alive = true;
        const url = type === 'channel' ? '/channels' : '/protocols';
        fetch(url)
            .then(r => r.json())
            .then(json => {
                if (!alive) return;
                if (!json.success) throw Error(json.error);
                setData(json.data);
            })
            .catch(e => { if (alive) setError(e.message || 'Failed to load'); });
        return () => { alive = false; };
    }, [type]);

    React.useEffect(() => {
        if (inputRef.current) inputRef.current.focus();
    }, []);

    let body;
    if (type === 'recipient') {
        const submit = (e) => {
            e.preventDefault();
            const v = (inputRef.current?.value || '').trim();
            if (v) onSelect({ recipient: v });
        };
        body = (
            <form className="form" onSubmit={submit}>
                <input ref={inputRef} type="text" placeholder="Capcode..." className="input" />
                <button type="submit" className="submit">Apply</button>
            </form>
        );
    } else if (error) {
        body = <div className="status error">{error}</div>;
    } else if (data === null) {
        body = <div className="status loading">Loading...</div>;
    } else if (type === 'channel') {
        body = (
            <div className="list">
                {data.length === 0 && <div className="status empty">No channels yet.</div>}
                {data.map(row => (
                    <button key={row.channel} type="button" className="item"
                            onClick={() => onSelect({ channel: row.channel })}>
                        <span className="label">{row.channel}</span>
                        <span className="count">{row.count}</span>
                    </button>
                ))}
            </div>
        );
    } else if (type === 'protocol') {
        // group by protocol: show "all <protocol>" then per-baud rows
        const groups = {};
        for (const row of data) {
            if (!groups[row.protocol]) groups[row.protocol] = { total: 0, items: [] };
            groups[row.protocol].total += Number(row.count);
            groups[row.protocol].items.push(row);
        }
        body = (
            <div className="list">
                {Object.entries(groups).map(([name, group]) => (
                    <React.Fragment key={name}>
                        <button type="button" className="item group"
                                onClick={() => onSelect({ protocol: name })}>
                            <span className="label">{name} <span className="hint">(all bauds)</span></span>
                            <span className="count">{group.total}</span>
                        </button>
                        {group.items.map(row => (
                            <button key={`${name}-${row.baud}`} type="button" className="item sub"
                                    onClick={() => onSelect({ protocol: `${name} ${row.baud}` })}>
                                <span className="label">{name} {row.baud}</span>
                                <span className="count">{row.count}</span>
                            </button>
                        ))}
                    </React.Fragment>
                ))}
            </div>
        );
    }

    return (
        <div className="filter-popover" role="dialog" aria-label={`${FILTERS[type].label} filter`}>
            <div className="header">
                <span>Filter by {FILTERS[type].label.toLowerCase()}</span>
                <button type="button" className="close" onClick={onClose} aria-label="Close"><X /></button>
            </div>
            {body}
        </div>
    );
}

// =============================================================================
// Settings modal
// =============================================================================

class SettingsModal extends React.Component {
    constructor(props) {
        super(props);
        this._dialogRef = React.createRef();
    }

    componentDidMount() {
        this._dialogRef.current?.showModal();
    }

    // Clicks on the ::backdrop pseudo land on the <dialog> element itself.
    handleClick = (e) => {
        if (e.target === this._dialogRef.current) {
            this.props.onClose();
        }
    }

    render() {
        const { settings, onSettingChange, onClose } = this.props;
        return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse convenience; Escape is handled natively by <dialog>.
            <dialog ref={this._dialogRef} className="settings" onClose={onClose} onClick={this.handleClick}>
                <div className="header">
                    <h3>Settings</h3>
                    <button type="button" className="close" onClick={onClose} aria-label="Close settings"><X /></button>
                </div>
                <div className="body">
                    {SETTINGS_DEFS.map(def => (
                        <SettingToggle
                            key={def.key}
                            label={def.label}
                            active={settings[def.key]}
                            onToggle={(checked) => onSettingChange(def.key, checked)}
                        />
                    ))}
                </div>
            </dialog>
        );
    }
}

function SettingToggle({ label, active, onToggle }) {
    return (
        <label className="row">
            <span className="label">{label}</span>
            <input type="checkbox" checked={active} onChange={(e) => onToggle(e.target.checked)} />
        </label>
    );
}
