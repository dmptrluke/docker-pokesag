import React from 'react';
import { DateTime } from 'luxon';
import { XLg, ChevronLeft, ChevronRight, Arrow90degUp, ArrowClockwise, GearFill, X } from 'react-bootstrap-icons';
import { recipientColor, annotateMessage, parseSource } from './utilities';
import { SETTINGS_DEFS, loadSettings, saveSetting } from './settings';

const AUTO_REFRESH_INTERVAL_MS = 10000;
const PAGE_SIZE = 100;

export default class Client extends React.Component {
    constructor() {
        super();

        this.state = {
            mode: 'normal',
            pages: [],
            hasMore: false,
            searchString: '',
            page: 1,
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

    // -- search -----------------------------------------------------------

    updateSearchString = (e) => {
        this.setState({ searchString: e.target.value });

        if (e.target.value === '') {
            this.setState({ mode: 'normal' }, () => {
                this.refreshClean();
            });
        }
    }

    handleSearch = (e) => {
        if (e.key === 'Enter' && this.state.searchString !== '') {
            this.setState({ mode: 'search' }, () => {
                this.refreshClean();
            });
        }
    }

    clearSearch = () => {
        this.setState({ searchString: '', mode: 'normal' }, () => {
            this.refreshClean();
        });
    }

    // -- data fetching ----------------------------------------------------

    refresh = () => {
        const { page, mode, settings, searchString } = this.state;
        let url;

        switch (mode) {
            case 'search': {
                const type = settings.fullTextSearch ? 'ft' : 'basic';
                const query = encodeURIComponent(searchString);
                url = `/pages/search/${type}/${query}/${page}/`;
                break;
            }
            case 'source':
                url = `/pages/search/source/${encodeURIComponent(searchString)}/${page}/`;
                break;
            case 'normal':
            default:
                url = `/pages/${page}/`;
        }

        fetch(url)
            .then(result => result.json())
            .then(json => {
                if (!json.success) {
                    throw Error(json.error);
                }
                this.setState({ pages: json.data, hasMore: json.data.length === PAGE_SIZE, error: null });
            })
            .catch(error => {
                console.error('Unable to fetch pages:', error);
                this.setState({ error: error.message || 'Failed to load pages' });
            });
    }

    refreshClean = () => {
        this.setState({ page: 1 }, () => {
            this.refresh();
        });
    }

    // -- navigation -------------------------------------------------------

    handleSettingsToggle = () => {
        this.setState(prev => ({ settingsOpen: !prev.settingsOpen }));
    }

    handleRecipientClick = (r) => {
        this.setState({ mode: 'search', searchString: r }, () => {
            this.refreshClean();
        });
    }

    handleSourceClick = (s) => {
        this.setState({ mode: 'source', searchString: s }, () => {
            this.refreshClean();
        });
    }

    handlePageChange = (page) => {
        this.setState({ page }, () => {
            this.refresh();
        });
    }

    componentDidMount() {
        this.refresh();

        if (this.state.settings.autoRefresh) {
            this._refreshTimer = setInterval(() => this.refresh(), AUTO_REFRESH_INTERVAL_MS);
        }
    }

    componentWillUnmount() {
        this._clearAutoRefresh();
    }

    render() {
        const { settings, settingsOpen, searchString, error } = this.state;
        const dateFormat = settings.use24hTime ? 'D TT' : 'D tt';

        const rows = this.state.pages.map(page => {
            const formattedDate = DateTime.fromISO(page.rx_date).toFormat(dateFormat);
            const color = settings.recipientColors ? recipientColor(page.recipient) : undefined;
            const recipientStyle = color ? { borderLeft: `3px solid ${color}`, color } : {};
            const { channel, family, baud } = parseSource(page.source);
            const chipClass = family ? `standard-chip standard-chip-${family.toLowerCase()}` : null;
            const chipLabel = family ? `${family[0]}${baud}` : null;
            return <tr key={page.id}>
                    <td className="page_rx_date">{formattedDate}</td>
                    <td className="page_source">
                        <button type="button" className="cell-action" onClick={() => this.handleSourceClick(page.source)} title={page.source}>
                            {chipLabel && <span className={chipClass} title={`${family} ${baud}`}>{chipLabel}</span>}
                            <span className="source-channel">{channel}</span>
                        </button>
                    </td>
                    <td className="page_recipient" style={recipientStyle}>
                        <button type="button" className="cell-action" onClick={() => this.handleRecipientClick(page.recipient)}>{page.recipient}</button>
                    </td>
                    <td className="page_content">{annotateMessage(page.content)}</td>
                </tr>
        });

        return <main>
                <nav id="toolbar">
                    <span id="brand">PokeSAG</span>
                    <button type="button" onClick={this.handleSettingsToggle} title="Settings" aria-label="Settings"><GearFill /></button>
                    <input className="search_box" type="text" placeholder="Search..." value={searchString}
                           onChange={this.updateSearchString} onKeyDown={this.handleSearch} aria-label="Search Box" />
                    {searchString !== '' &&
                        <button type="button" className="clear_search" onClick={this.clearSearch} title="Clear search" aria-label="Clear search"><XLg /></button>
                    }
                    <div className="spacer"></div>
                    <Transporter onChange={this.handlePageChange} page={this.state.page} hasMore={this.state.hasMore} containerId="transporter" />
                </nav>

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

                <div id="page_table">
                    <table>
                        <thead>
                            <tr>
                                <th className="page_rx_date" scope="col">Received</th>
                                <th className="page_source" scope="col">Source</th>
                                <th className="page_recipient" scope="col">Recipient</th>
                                <th className="page_content" scope="col">Message</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows}
                        </tbody>
                    </table>
                </div>

                <Transporter onChange={this.handlePageChange} page={this.state.page} hasMore={this.state.hasMore} containerId="bottom_transporter" />
            </main>
    }
}

class SettingsModal extends React.Component {
    constructor(props) {
        super(props);
        this._backdropRef = React.createRef();
    }

    handleBackdropClick = (e) => {
        if (e.target === this._backdropRef.current) {
            this.props.onClose();
        }
    }

    componentDidMount() {
        this._onKeyDown = (e) => {
            if (e.key === 'Escape') this.props.onClose();
        };
        document.addEventListener('keydown', this._onKeyDown);
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this._onKeyDown);
    }

    render() {
        const { settings, onSettingChange, onClose } = this.props;
        return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is mouse convenience; keyboard users close via Escape (handled at document level in componentDidMount)
            // biome-ignore lint/a11y/noStaticElementInteractions: see above
            <div className="modal-backdrop" ref={this._backdropRef} onClick={this.handleBackdropClick}>
                <div className="modal-dialog">
                    <div className="modal-header">
                        <h3>Settings</h3>
                        <button type="button" className="modal-close" onClick={onClose} aria-label="Close settings"><X /></button>
                    </div>
                    <div className="modal-body">
                        {SETTINGS_DEFS.map(def => (
                            <SettingToggle
                                key={def.key}
                                label={def.label}
                                active={settings[def.key]}
                                onToggle={() => onSettingChange(def.key, !settings[def.key])}
                            />
                        ))}
                    </div>
                </div>
            </div>
        );
    }
}

function SettingToggle({ label, active, onToggle }) {
    return (
        <button type="button" className="setting-row" onClick={onToggle}>
            <span className="setting-label">{label}</span>
            <span className={active ? 'setting-toggle on' : 'setting-toggle off'}>
                <span className="setting-toggle-knob"></span>
            </span>
        </button>
    );
}

function Transporter({ onChange, page, hasMore, containerId }) {
    return (
        <nav id={containerId || 'transporter'}>
            {page > 1 &&
                <button type="button" onClick={() => onChange(Math.max(1, page - 1))} title="Previous Page" aria-label="Previous page"><ChevronLeft /></button>
            }
            {page > 1 &&
                <button type="button" id="page_num" onClick={() => onChange(1)}>
                    {page}
                </button>
            }
            <button type="button" onClick={() => onChange(page + 1)} disabled={!hasMore} title={hasMore ? 'Next Page' : 'No more pages'} aria-label="Next page"><ChevronRight /></button>
            <button type="button" onClick={() => onChange(1)} title="Refresh" aria-label="Refresh">
            {page > 1
                ? <Arrow90degUp />
                : <ArrowClockwise />
            }
            </button>
        </nav>
    );
}
