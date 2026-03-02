import React from 'react';
import { DateTime } from 'luxon';
import {  XLg, ChevronLeft, ChevronRight, Arrow90degUp, ArrowClockwise, GearFill, X } from 'react-bootstrap-icons';
import { recipientColor, annotateMessage } from './utilities';
import { SETTINGS_DEFS, loadSettings, saveSetting } from './settings';

const AUTO_REFRESH_INTERVAL_MS = 10000;

export default class Client extends React.Component
{
    constructor ()
    {
        super ();

        this.state = {
            mode: "normal",
            pages_database: [],
            search_string: "",
            page: 1,

            settings_open: false,
            settings: loadSettings(),

            error: null,

            refresh_timer: null,
        };
    }

    // -- settings ---------------------------------------------------------

    handleSettingChange = (key, value) =>
    {
        saveSetting(key, value);
        const settings = { ...this.state.settings, [key]: value };
        this.setState({ settings });

        // initiate or clear auto-refresh timer
        if (key === 'autoRefresh') {
            if (value) {
                this.setState({ refresh_timer: setInterval(() => this.refresh(), AUTO_REFRESH_INTERVAL_MS) });
            } else {
                clearInterval(this.state.refresh_timer);
                this.setState({ refresh_timer: null });
            }
        }
    }

    // -- search -----------------------------------------------------------

    updateSearchString = (e) =>
    {
        this.setState ( { search_string: e.target.value } );

        if (e.target.value == '')
        {
            this.state.mode = 'normal';
            this.refresh_clean ();
        }
    }

    handleSearch = (e) =>
    {
        if (e.key === 'Enter' && this.state.search_string != '')
        {
            this.state.mode = 'search';
            this.refresh_clean ();
        }
    }

    clearSearch = () =>
    {
        this.setState ({ search_string: '', mode: 'normal' }, () => {
            this.refresh_clean ();
        });
    }

    // -- data fetching ----------------------------------------------------

    refresh = () =>
    {
        const page = this.state.page;
        switch (this.state.mode)
        {
            case 'search':
                const type = this.state.settings.fullTextSearch ? 'ft' : 'basic';
                const query = encodeURIComponent (this.state.search_string);
                var url = `/pages/search/${type}/${query}/${page}/`;
                break;

            case 'source':
                var url = `/pages/search/source/${encodeURIComponent(this.state.search_string)}/${page}/`;
                break;

            case 'normal':
            default:
                var url = `/pages/${page}/`;
        }

        fetch (url)
            .then (result => result.json ())
            .then (json => {
                if (!json.success) {
                    throw Error (json.error);
                }
                this.setState ({pages_database: json.data, error: null});
            })
            .catch (error => {
                console.error ('Unable to fetch pages:', error);
                this.setState ({error: error.message || 'Failed to load pages'});
            });
    }

    refresh_clean = () =>
    {
        this.setState ({page: 1}, () => {
            this.refresh ();
        });
    }

    // -- navigation -------------------------------------------------------

    handleSettingsToggle = () =>
    {
        this.setState ({ settings_open: !this.state.settings_open });
    }

    handleRecipientClick = (r) => {
        this.setState({mode: "search", search_string: r}, () => {
            this.refresh_clean ();
        });
    }

    handleSourceClick = (s) => {
        this.setState({mode: "source", search_string: s}, () => {
            this.refresh_clean ();
        });
    }

    handlePageChange = (page) =>
    {
        this.setState ({page: page}, () => {
            this.refresh ();
        });
    }

    componentDidMount ()
    {
        this.refresh ();

        // Apply initial auto-refresh if persisted
        if (this.state.settings.autoRefresh) {
            this.setState({ refresh_timer: setInterval(() => this.refresh(), AUTO_REFRESH_INTERVAL_MS) });
        }
    }

    render ()
    {
        // settings alias for easier access in JSX
        const { settings } = this.state;
        const dateFormat = settings.use24hTime ? 'D TT' : 'D tt';

        let pages = this.state.pages_database.map ( page => {
            const formatted_date = DateTime.fromISO(page.rx_date).toFormat(dateFormat);
            const color = settings.recipientColors ? recipientColor(page.recipient) : undefined;
            const recipientStyle = color ? { borderLeft: `3px solid ${color}`, color } : {};
            return <tr key={page.id}>
                    <td className="page_rx_date">{formatted_date}</td>
                    <td className="page_source" onClick={() => this.handleSourceClick(page.source)}>{page.source}</td>
                    <td className="page_recipient" onClick={() => this.handleRecipientClick(page.recipient)}
                        style={recipientStyle}>{page.recipient}</td>
                    <td className="page_content">{annotateMessage(page.content)}</td>
                </tr>
        });

        return <main>
                <nav id="toolbar">
                    <span id="brand">PokèSAG</span>
                    <button onClick={this.handleSettingsToggle} title="Settings"><GearFill /></button>
                    <input className="search_box" type="text" placeholder="Search…" value={this.state.search_string}
                           onChange={this.updateSearchString} onKeyDown={this.handleSearch} aria-label="Search Box" />
                    {this.state.search_string !== '' &&
                        <button className="clear_search" onClick={this.clearSearch} title="Clear search"><XLg /></button>
                    }
                    <div className="spacer"></div>
                    <Transporter onChange={this.handlePageChange} page={this.state.page} containerId="transporter" />
                </nav>

                {this.state.settings_open &&
                    <SettingsModal
                        settings={settings}
                        onSettingChange={this.handleSettingChange}
                        onClose={this.handleSettingsToggle}
                    />
                }

                {this.state.error &&
                    <div className="error-banner" role="alert">
                        <span>Unable to load pages: {this.state.error}</span>
                        <button onClick={() => this.refresh()} title="Retry">Retry</button>
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
                            {pages}
                        </tbody>
                    </table>
                </div>
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
            <div className="modal-backdrop" ref={this._backdropRef} onClick={this.handleBackdropClick}>
                <div className="modal-dialog">
                    <div className="modal-header">
                        <h3>Settings</h3>
                        <button className="modal-close" onClick={onClose}><X /></button>
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
        <div className="setting-row" onClick={onToggle}>
            <span className="setting-label">{label}</span>
            <span className={active ? 'setting-toggle on' : 'setting-toggle off'}>
                <span className="setting-toggle-knob"></span>
            </span>
        </div>
    );
}

class Transporter extends React.Component {
    constructor (props) {
        super (props);
    }

    clear = () => {
        const page = 1;
        this.props.onChange(page);
    }

    previous = () => {
        const page = (this.props.page - 1) > 0 ? (this.props.page - 1) : 1;
        this.props.onChange(page);
    }

    next = () => {
        const page = this.props.page + 1;
        this.props.onChange(page);
    }

    render () {
        return (
            <nav id={this.props.containerId || 'transporter'}>
                {this.props.page > 1 &&
                    <button onClick={this.previous} title="Previous Page"><ChevronLeft /></button>
                }
                {this.props.page > 1 &&
                    <button id="page_num" onClick={this.clear}>
                        {this.props.page}
                    </button>
                }
                <button onClick={this.next} title="Next Page"><ChevronRight /></button>
                <button onClick={this.clear} title="Refresh">
                {this.props.page > 1
                    ? <Arrow90degUp />
                    : <ArrowClockwise />
                }
                </button>
            </nav>
        )
    }
}
