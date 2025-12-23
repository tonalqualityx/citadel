#!/usr/bin/env python3
import os
import glob

# Mapping of common mojibake patterns to correct UTF-8
replacements = {
    # Emojis
    'ðŸ"š': '\U0001F4DA',  # 📚
    'ðŸŽ¯': '\U0001F3AF',  # 🎯
    'ðŸš€': '\U0001F680',  # 🚀
    'ðŸ"‹': '\U0001F4CB',  # 📋
    'ðŸ"„': '\U0001F504',  # 🔄
    'ðŸ"'': '\U0001F511',  # 🔑
    'ðŸ"': '\U0001F4C2',  # 📂
    'ðŸ§±': '\U0001F9F1',  # 🧱
    'ðŸ—ï¸': '\U0001F5C2\uFE0F',  # 🗂️
    'ðŸ"²': '\U0001F4F2',  # 📲
    'ðŸŽ¨': '\U0001F3A8',  # 🎨
    # Checkmarks and symbols
    '\xe2\x9c\x85': '\u2705',  # ✅
    'âœ…': '\u2705',  # ✅
    'â›"': '\u26D4',  # ⛔
    'âš ï¸': '\u26A0\uFE0F',  # ⚠️
    # Box drawing characters
    'â"œâ"€â"€': '\u251C\u2500\u2500',  # ├──
    'â""â"€â"€': '\u2514\u2500\u2500',  # └──
    'â"‚': '\u2502',  # │
    'â"Œâ"€': '\u250C\u2500',  # ┌─
    'â"€â"€â"€': '\u2500\u2500\u2500',  # ───
    'â"€â"': '\u2500\u2510',  # ─┐
    'â"˜': '\u2518',  # ┘
    'â"€': '\u2500',  # ─
    'â"Œ': '\u250C',  # ┌
    'â"': '\u2510',  # ┐
    'â"¬': '\u252C',  # ┬
    'â"¤': '\u2524',  # ┤
    'â"´': '\u2534',  # ┴
    'â"¼': '\u253C',  # ┼
    'â••': '\u2555',  # ╕
    'â•"': '\u2553',  # ╓
    # Arrows
    'â†"': '\u2193',  # ↓
    'â†'': '\u2192',  # →
    'â†': '\u2190',  # ←
    'â†'': '\u2191',  # ↑
    'â–¼': '\u25BC',  # ▼
    'â–²': '\u25B2',  # ▲
    # Dashes and quotes
    'â€"': '\u2014',  # —
    'â€"': '\u2013',  # –
    'â€œ': '\u201C',  # "
    'â€\x9d': '\u201D',  # "
    'â€™': '\u2019',  # '
    'â€˜': '\u2018',  # '
    # Other common patterns
    'â€¢': '\u2022',  # •
    'â€¦': '\u2026',  # …
}

doc_dir = '/home/mike/projects/citadel/implementation/documentation'
files = glob.glob(f'{doc_dir}/**/*.md', recursive=True)

for filepath in files:
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    for bad, good in replacements.items():
        content = content.replace(bad, good)

    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed: {filepath}")
    else:
        print(f"No changes: {filepath}")

print("\nDone!")
