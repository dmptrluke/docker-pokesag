"""FLEX parsing for multimon-ng JSON and text output."""

import re

from decoding.page import ParsedPage
from util import clean

_RE_FLEX_PIPE = re.compile(r'^FLEX\|[^|]*\|[^|]*\|[^|]*\|(\d+)\|([A-Z]+)\|(.*)')
_RE_FLEX_SPACE = re.compile(r'^FLEX(?:_NEXT)?:\s+.*\[(\d+)\]\s+(\w+)\s+(.*)')


def parse_json(msg: dict) -> ParsedPage | None:
    demod = msg.get('demod_name', '')
    if not demod.startswith('flex'):
        return None

    baud = int(msg.get('sync_baud') or 0) or None
    recipient = str(msg.get('capcode', ''))
    content = clean(msg.get('message', '') or '')

    if demod == 'flex_numeric':
        content_type = 'numeric'
    elif demod == 'flex_tone_only':
        content_type = 'tone'
    else:
        content_type = 'alpha'

    metadata = {k: v for k, v in msg.items() if k not in {'demod_name', 'capcode', 'message', 'sync_baud', 'timestamp'}}

    if content or content_type == 'tone':
        return ParsedPage(
            protocol='FLEX',
            baud=baud,
            recipient=recipient,
            content=content,
            content_type=content_type,
            metadata=metadata,
        )
    return None


def _parse_text_match(m: 're.Match[str]') -> ParsedPage | None:
    recipient, msg_type, content = m.group(1), m.group(2), m.group(3)
    content = clean(content)
    if not content or msg_type not in ('ALN', 'NUM'):
        return None

    return ParsedPage(
        protocol='FLEX',
        baud=None,
        recipient=recipient,
        content=content,
        content_type='alpha' if msg_type == 'ALN' else 'numeric',
        metadata={},
    )


def parse_text(line: str) -> ParsedPage | None:
    m = _RE_FLEX_PIPE.match(line)
    if m:
        return _parse_text_match(m)

    m = _RE_FLEX_SPACE.match(line)
    if m:
        return _parse_text_match(m)

    return None
