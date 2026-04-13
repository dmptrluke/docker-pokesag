"""Decoded-page value type shared by the POCSAG and FLEX parsers."""

from dataclasses import dataclass, field


@dataclass
class ParsedPage:
    protocol: str  # 'POCSAG' or 'FLEX'
    baud: int | None
    recipient: str
    content: str
    content_type: str  # 'alpha', 'numeric', or 'tone'
    metadata: dict = field(default_factory=dict)
