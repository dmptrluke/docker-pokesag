import React from 'react';
import { DateTime } from 'luxon';

/**
 * Hash a string to a consistent HSL color using FNV-1a.
 * FNV-1a has good avalanche properties — even very similar strings
 * (e.g. "1140792" vs "1140587") produce wildly different hashes.
 * Saturation and lightness are also varied using different hash bits.
 */
function recipientColor(str) {
    let h = 0x811c9dc5; // FNV-1a offset basis
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193); // FNV-1a prime
    }
    h = h >>> 0; // unsigned 32-bit

    const hue = h % 360;
    const sat = 55 + ((h >>> 16) % 4) * 10; // 55, 65, 75, or 85%
    const lit = 55 + ((h >>> 24) % 3) * 8;  // 55, 63, or 71%

    return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

/**
 * Hover tooltip system.
 *
 * Load a mapping of tokens -> tooltip text from `public/hoverCodes.json`.
 * The JSON file should be either a mapping object or contain a top-level
 * `codes` object. Example:
 *   { "codes": { "HAPPY": "The User is Happy", "LOLX": "Lots of Love for my Ex" } }
 *
 * Any token in the mapping will be matched as a whole word and wrapped with
 * a <span> carrying the tooltip in `data-tooltip`.
 */

let TOOLTIP_REGEX = null;
let TOOLTIP_MAP = {};

fetch('/hoverCodes.json')
    .then(res => (res.ok ? res.json() : null))
    .then(data => {
        if (!data) return;
        const map = data.codes || data;
        TOOLTIP_MAP = map || {};
        const keys = Object.keys(TOOLTIP_MAP || {}).filter(Boolean);
        if (keys.length) {
            const escaped = keys.map(k => k.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'));
            // match keys (with optional trailing alphabetic suffix (e.g. 21D05M)
            TOOLTIP_REGEX = new RegExp(`\\b(${escaped.join('|')})(?:[A-Z]+)?\\b`, 'g');
        }
    })
    .catch(() => {
        // If fetch fails, TOOLTIP_REGEX remains empty and no annotations occur
    });

/**
 * Annotate message text by replacing recognised tokens with tooltip spans.
 *
 * - Uses the pre-built `TOOLTIP_REGEX` to find tokens (with optional trailing
 *   alphabetic suffixes, e.g. `21D05M`).
 * - Looks up the tooltip in `TOOLTIP_MAP` by exact token, falling back to the
 *   base token with trailing letters removed.
 * - Returns either the original `text` or an array of strings and React
 *   elements (<span className="code-badge" data-tooltip=...>) suitable for
 *   rendering inside JSX.
 */
function annotateMessage(text) {
    if (!text || !TOOLTIP_REGEX) return text;
    const out = [], re = TOOLTIP_REGEX;
    re.lastIndex = 0; let m, i = 0, last = 0;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const token = m[0];
        const tip = TOOLTIP_MAP[token] || TOOLTIP_MAP[token.replace(/[A-Z]+$/, '')];
        out.push(tip ? <span key={`hc${i++}`} className="code-badge" data-tooltip={tip}>{token}</span> : token);
        last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out.length ? out : text;
}

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
        /* Get the list of messages */
        let pages = this.state.pages_database.map ( page => {
            const formatted_date = DateTime.fromISO(page.rx_date).toFormat(this.state.date_format);
            const color = recipientColor(page.recipient);
            return <tr key={page.id}>
                    <td className="page_rx_date">{formatted_date}</td>
                    <td className="page_source">{page.source}</td>
                    <td className="page_recipient" onClick={() => this.handle_recipient_click (page.recipient)}
                        style={{ borderLeft: `3px solid ${color}`, color: color }}>{page.recipient}</td>
                    <td className="page_content">{annotateMessage(page.content)}</td>
                </tr>
        });

        /* Generate page */
        return <main>
                <nav id="toolbar">
                    <button className={this.state.settings_open ? 'green' : ''} onClick={this.handle_settings_toggle} title="Settings">
                        <i className="bi-list"></i>
                    </button>
                    <input className="search_box" type="text" placeholder="Search…" value={this.state.search_string}
                           onChange={this.update_search_string} onKeyPress={this.handle_search} aria-label="Search Box" />
                    <div className="spacer"></div>
                    <Transporter on_change={this.handle_page_change} page={this.state.page}/>
                </nav>

                <div id="settings" className={this.state.settings_open ? 'visible' : 'hidden'}>
                    <h4>Settings</h4>
                    <SettingButton value="Auto Refresh" default_state={false} action={this.handle_refresh_toggle} />
                    <SettingButton value="Full Text Search" default_state={true} action={this.handle_search_toggle} />
                    <SettingButton value="24 Hour Time" default_state={false} action={this.handle_24h_toggle} />
                </div>

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

class SettingButton extends React.Component {
    constructor(props) {
        super(props);
        let stored_state = localStorage.getItem(props.value);
        this.state = {
            is_active: stored_state ? JSON.parse(stored_state) : props.default_state
        };
        this.props.action(this.state.is_active);
    }

    handle_click = () => {
        /* we use a callback here, since setState is asynchronous */
        this.setState({is_active: !this.state.is_active}, () => {
            this.props.action(this.state.is_active);   
            localStorage.setItem(this.props.value, this.state.is_active);
        });
    }

    render() {
        return (
            <input className={this.state.is_active ? 'setting green' : 'setting red'}
            type="button" value={this.props.value} onClick={this.handle_click}  />
        )
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
            <nav id="transporter">
                {this.props.page > 1 &&
                    <button onClick={this.previous} title="Previous Page">
                        <i className="bi-chevron-left"></i>
                    </button>
                }
                {this.props.page > 1 &&
                    <button id="page_num" onClick={this.clear}>
                        {this.props.page}
                    </button>
                }
                <button onClick={this.next} title="Next Page">
                    <i className="bi-chevron-right"></i>
                </button>
                <button onClick={this.clear} title="Refresh">
                {this.props.page > 1
                    ? <i className="bi-arrow-90deg-up"></i>
                    : <i className="bi-arrow-clockwise"></i>
                }
                </button>
            </nav>
        )
    }
}