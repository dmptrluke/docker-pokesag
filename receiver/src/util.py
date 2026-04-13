"""Text normalization and content-based spam filter."""

import re

_RE_CONTROL_MARKER = re.compile(
    r'<(?:NUL|SOH|STX|ETX|EOT|ENQ|ACK|BEL|BS|HT|LF|VT|FF|CR|SO|SI|DLE|NAK|SYN|ETB|CAN|EM|SUB|ESC|DEL)>'
)


def clean(s: str) -> str:
    """Normalize multimon-ng decoded text.

    Pager dispatch messages often use control characters (STX/ETX/US/RS)
    as structured field separators. multimon-ng emits these either as
    literal tag strings like '<ETX>' or as raw bytes. Replace both with a
    single space so field boundaries are preserved, then collapse runs of
    whitespace so multiple adjacent markers don't leave ugly gaps.
    """
    s = _RE_CONTROL_MARKER.sub(' ', s)
    s = ''.join(c if 32 <= ord(c) < 127 else ' ' for c in s)
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def is_spam(content: str, content_type: str | None) -> bool:
    t = content.lower().strip()
    if content_type == 'alpha' and len(t) < 4:
        return True
    if 'ha/modica' in t or 'this is a test periodic' in t:
        return True
    return False
