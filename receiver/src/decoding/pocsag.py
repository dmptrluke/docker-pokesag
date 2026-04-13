"""POCSAG parsing for multimon-ng JSON and text output."""

import re

from decoding.page import ParsedPage
from util import clean

_RE_POCSAG_TEXT = re.compile(
    r'^(POCSAG\d+):\s+Address:\s+(\d+)\s+Function:\s+\d+\s+'
    r'(?:Alpha|Numeric):\s*(.*)'
)


def _baud_from_demod(demod: str) -> int | None:
    try:
        return int(demod[len('POCSAG') :])
    except ValueError:
        return None


def parse_json(msg: dict) -> ParsedPage | None:
    demod = msg.get('demod_name', '')
    if not demod.startswith('POCSAG'):
        return None

    baud = _baud_from_demod(demod)
    recipient = str(msg.get('address', ''))
    alpha = msg.get('alpha')
    numeric = msg.get('numeric')
    content = clean(alpha or numeric or '')
    content_type = 'alpha' if alpha else ('numeric' if numeric else 'tone')

    metadata = {k: v for k, v in msg.items() if k not in {'demod_name', 'address', 'alpha', 'numeric', 'timestamp'}}

    # Alpha/numeric pages that clean down to '' are noise; tone pages
    # are intentionally stored with empty content.
    if content or content_type == 'tone':
        return ParsedPage(
            protocol='POCSAG',
            baud=baud,
            recipient=recipient,
            content=content,
            content_type=content_type,
            metadata=metadata,
        )
    return None


def parse_text(line: str) -> ParsedPage | None:
    m = _RE_POCSAG_TEXT.match(line)
    if not m:
        return None

    demod, recipient, content = m.group(1), m.group(2), m.group(3)
    content = clean(content)
    if not content:
        return None

    return ParsedPage(
        protocol='POCSAG',
        baud=_baud_from_demod(demod),
        recipient=recipient,
        content=content,
        content_type='alpha',
        metadata={},
    )
