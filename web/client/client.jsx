import React from 'react';
import { DateTime } from 'luxon';
import { List, XLg, ChevronLeft, ChevronRight, Arrow90degUp, ArrowClockwise, GearFill, X } from 'react-bootstrap-icons';
import { recipientColor, annotateMessage } from './utilities';

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

            date_format: "D tt",

            full_text_search: false,
            refresh_timer: null,
        };
    }

    update_search_string = (e) =>
    {
        this.setState ( { search_string: e.target.value } );

        if (e.target.value == '')
        {
            this.state.mode = 'normal';
            this.refresh_clean ();
        }
    }

    handle_search = (e) =>
    {
        if (e.key === 'Enter' && this.state.search_string != '')
        {
            this.state.mode = 'search';
            this.refresh_clean ();
        }
    }

    clear_search = () =>
    {
        this.setState ({ search_string: '', mode: 'normal' }, () => {
            this.refresh_clean ();
        });
    }

    refresh = () =>
    {
        const page = this.state.page;
        switch (this.state.mode)
        {
            case 'search':
                const type = this.state.full_text_search ? 'ft' : 'basic';
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
                this.setState ({pages_database: json.data});
            })
            .catch (error => {
                console.error ('Unable to fetch pages:', error);    
            });
    }

    refresh_clean = () =>
    {
        this.setState ({page: 1}, () => {
            this.refresh ();
        });
    }

    handle_settings_toggle = () =>
    {
        this.setState ({ settings_open: !this.state.settings_open });
    }

    handle_search_toggle = (is_active) =>
    {
        this.setState ({ full_text_search: is_active });
    }

    handle_refresh_toggle = (is_active) =>
    {
        if (is_active)
        {
            this.setState ({ refresh_timer: setInterval (() => this.refresh (null), 10000) });
        } 
        else 
        {
            clearInterval (this.state.refresh_timer);
            this.setState ({ refresh_timer: null });
        }
    }

    handle_24h_toggle = (is_active) =>
    {
        if (is_active)
        {
            this.setState ({date_format: 'D TT'});
        } 
        else 
        {
            this.setState ({date_format: 'D tt'});
        }
    }

    handle_recipient_click = (r) => {
        this.setState({mode: "search", search_string: r}, () => {
            this.refresh_clean ();
        });
    }

    handle_source_click = (s) => {
        this.setState({mode: "source", search_string: s}, () => {
            this.refresh_clean ();
        });
    }

    handle_page_change = (page) =>
    {
        this.setState ({page: page}, () => {
            this.refresh ();
        });
    }

    componentDidMount ()
    {
        this.refresh ();
    }

    render ()
    {
        let pages = this.state.pages_database.map ( page => {
            const formatted_date = DateTime.fromISO(page.rx_date).toFormat(this.state.date_format);
            const color = recipientColor(page.recipient);
            return <tr key={page.id}>
                    <td className="page_rx_date">{formatted_date}</td>
                    <td className="page_source" onClick={() => this.handle_source_click(page.source)}>{page.source}</td>
                    <td className="page_recipient" onClick={() => this.handle_recipient_click (page.recipient)}
                        style={{ borderLeft: `3px solid ${color}`, color: color }}>{page.recipient}</td>
                    <td className="page_content">{annotateMessage(page.content)}</td>
                </tr>
        });

        return <main>
                <nav id="toolbar">
                    <span id="brand">PokèSAG</span>
                    <button onClick={this.handle_settings_toggle} title="Settings"><GearFill /></button>
                    <input className="search_box" type="text" placeholder="Search…" value={this.state.search_string}
                           onChange={this.update_search_string} onKeyDown={this.handle_search} aria-label="Search Box" />
                    {this.state.search_string !== '' &&
                        <button className="clear_search" onClick={this.clear_search} title="Clear search"><XLg /></button>
                    }
                    <div className="spacer"></div>
                    <Transporter on_change={this.handle_page_change} page={this.state.page} containerId="transporter" />
                </nav>

                {this.state.settings_open &&
                    <SettingsModal
                        onClose={this.handle_settings_toggle}
                        onRefreshToggle={this.handle_refresh_toggle}
                        onSearchToggle={this.handle_search_toggle}
                        on24hToggle={this.handle_24h_toggle}
                    />
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
        return (
            <div className="modal-backdrop" ref={this._backdropRef} onClick={this.handleBackdropClick}>
                <div className="modal-dialog">
                    <div className="modal-header">
                        <h3>Settings</h3>
                        <button className="modal-close" onClick={this.props.onClose}><X /></button>
                    </div>
                    <div className="modal-body">
                        <SettingToggle label="Auto Refresh" settingKey="Auto Refresh" defaultState={false} action={this.props.onRefreshToggle} />
                        <SettingToggle label="Full Text Search" settingKey="Full Text Search" defaultState={true} action={this.props.onSearchToggle} />
                        <SettingToggle label="24 Hour Time" settingKey="24 Hour Time" defaultState={false} action={this.props.on24hToggle} />
                    </div>
                </div>
            </div>
        );
    }
}

class SettingToggle extends React.Component {
    constructor(props) {
        super(props);
        let stored_state = localStorage.getItem(props.settingKey);
        this.state = {
            is_active: stored_state ? JSON.parse(stored_state) : props.defaultState
        };
        this.props.action(this.state.is_active);
    }

    handle_click = () => {
        this.setState({is_active: !this.state.is_active}, () => {
            this.props.action(this.state.is_active);   
            localStorage.setItem(this.props.settingKey, this.state.is_active);
        });
    }

    render() {
        return (
            <div className="setting-row" onClick={this.handle_click}>
                <span className="setting-label">{this.props.label}</span>
                <span className={this.state.is_active ? 'setting-toggle on' : 'setting-toggle off'}>
                    <span className="setting-toggle-knob"></span>
                </span>
            </div>
        );
    }
}

class Transporter extends React.Component {
    constructor (props) {
        super (props);
    }

    clear = () => {
        const page = 1;
        this.props.on_change (page);
    }

    previous = () => {
        const page = (this.props.page - 1) > 0 ? (this.props.page - 1) : 1;
        this.props.on_change (page);
    }

    next = () => {
        const page = this.props.page + 1;
        this.props.on_change (page);
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