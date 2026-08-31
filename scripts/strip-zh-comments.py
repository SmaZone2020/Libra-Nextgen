#!/usr/bin/env python3
# 移除 C# / Rust / CSS / XML(.csproj) 源码文件中的中文注释。
# 语法感知扫描：正确跳过字符串字面量（含 verbatim/interpolated/raw 字符串、
# 字符字面量、转义），仅删除注释区间；整行注释连换行删除，行内注释只删注释文本。
# 注意：不压缩空行（避免破坏 verbatim/raw 字符串内的多行内容）。
# 用法: python strip-zh-comments.py <file...>
import re
import sys

CJK = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]')


def csharp_spans(text):
    """返回含中文的注释区间 [(start, end), ...]。"""
    spans = []
    i = 0
    n = len(text)

    def line_comment_end(pos):
        e = text.find('\n', pos)
        return n if e == -1 else e

    def block_comment_end(pos):
        e = text.find('*/', pos)
        return n if e == -1 else e + 2

    def char_end(pos):
        # pos 指向开引号 ' 后的字符；返回字面量结束后的索引（不含）。
        j = pos
        if j >= n:
            return pos
        if text[j] == '\\':
            j += 2
        else:
            j += 1
        if j < n and text[j] == '\'':
            return j + 1
        return pos

    def string_end(pos, verbatim, interp):
        # pos 指向开引号后的第一个字符；verbatim: @"..."; interp: $"..."
        # interp 需跟踪 {expr} 内的嵌套字符串/字符/注释/括号。
        depth = 0
        j = pos
        while j < n:
            c = text[j]
            if interp and depth > 0:
                # 在 {expr} 内部
                if c == '@' and j + 1 < n and text[j + 1] == '"':
                    j = string_end(j + 2, True, False)
                    continue
                if c == '$' and j + 1 < n and text[j + 1] == '"':
                    j = string_end(j + 2, False, True)
                    continue
                if c == '"':
                    j = string_end(j + 1, False, False)
                    continue
                if c == '\'':
                    e2 = char_end(j + 1)
                    j = e2 if e2 > j else j + 1
                    continue
                if c == '/' and j + 1 < n and text[j + 1] == '/':
                    j = line_comment_end(j)
                    continue
                if c == '/' and j + 1 < n and text[j + 1] == '*':
                    j = block_comment_end(j + 2)
                    continue
                if c == '{':
                    depth += 1
                elif c == '}':
                    depth -= 1
                j += 1
                continue
            if interp and depth == 0:
                if verbatim:
                    if c == '"':
                        if j + 1 < n and text[j + 1] == '"':
                            j += 2
                            continue
                        return j + 1
                    if c == '{':
                        if j + 1 < n and text[j + 1] == '{':
                            j += 2
                            continue
                        depth = 1
                        j += 1
                        continue
                    j += 1
                    continue
                # 普通插值字符串 $"..."
                if c == '\\':
                    j += 2
                    continue
                if c == '"':
                    return j + 1
                if c == '{':
                    if j + 1 < n and text[j + 1] == '{':
                        j += 2
                        continue
                    depth = 1
                    j += 1
                    continue
                j += 1
                continue
            if verbatim:
                if c == '"':
                    if j + 1 < n and text[j + 1] == '"':
                        j += 2
                        continue
                    return j + 1
                j += 1
                continue
            if c == '\\':
                j += 2
                continue
            if c == '"':
                return j + 1
            j += 1
        return n

    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            e = line_comment_end(i)
            if CJK.search(text[i:e]):
                spans.append((i, e))
            i = e
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            e = block_comment_end(i + 2)
            if CJK.search(text[i:e]):
                spans.append((i, e))
            i = e
            continue
        if c == '"':
            verbatim = False
            interp = False
            k = i - 1
            if k >= 0 and text[k] in ('$', '@'):
                if text[k] == '@':
                    verbatim = True
                else:
                    interp = True
                k -= 1
                if k >= 0 and text[k] in ('$', '@'):
                    if text[k] == '@':
                        verbatim = True
                    else:
                        interp = True
            i = string_end(i + 1, verbatim, interp)
            continue
        if c == '\'':
            e2 = char_end(i + 1)
            i = e2 if e2 > i else i + 1
            continue
        i += 1
    return spans


def rust_spans(text):
    spans = []
    i = 0
    n = len(text)

    def line_comment_end(pos):
        e = text.find('\n', pos)
        return n if e == -1 else e

    def block_comment_end(pos):
        e = text.find('*/', pos)
        return n if e == -1 else e + 2

    def raw_string_end(pos, hashes):
        delim = '"' + '#' * hashes
        e = text.find(delim, pos)
        return n if e == -1 else e + len(delim)

    def string_end(pos):
        j = pos
        while j < n:
            if text[j] == '\\':
                j += 2
                continue
            if text[j] == '"':
                return j + 1
            j += 1
        return n

    def char_or_lifetime(pos):
        # pos 指向 ' 之后；字符字面量返回结束，lifetime（'a）返回 pos。
        j = pos
        if j >= n:
            return pos
        if text[j] == '\\':
            j += 2
        else:
            j += 1
        if j < n and text[j] == '\'':
            return j + 1
        return pos

    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            e = line_comment_end(i)
            if CJK.search(text[i:e]):
                spans.append((i, e))
            i = e
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            e = block_comment_end(i + 2)
            if CJK.search(text[i:e]):
                spans.append((i, e))
            i = e
            continue
        # raw 字符串 r"..." / r#"..."# / br#"..."#
        if c == 'r' and i + 1 < n and text[i + 1] == '"':
            i = raw_string_end(i + 2, 0)
            continue
        if c == 'r' and i + 1 < n and text[i + 1] == '#':
            k = i + 1
            hashes = 0
            while k < n and text[k] == '#':
                hashes += 1
                k += 1
            if k < n and text[k] == '"':
                i = raw_string_end(k + 1, hashes)
                continue
        if c == 'b' and i + 1 < n and text[i + 1] == 'r':
            k = i + 2
            if k < n and text[k] == '"':
                i = raw_string_end(k + 1, 0)
                continue
            if k < n and text[k] == '#':
                hashes = 0
                while k < n and text[k] == '#':
                    hashes += 1
                    k += 1
                if k < n and text[k] == '"':
                    i = raw_string_end(k + 1, hashes)
                    continue
        if c == 'b' and i + 1 < n and text[i + 1] == '"':
            i = string_end(i + 2)
            continue
        if c == 'b' and i + 1 < n and text[i + 1] == '\'':
            e2 = char_or_lifetime(i + 2)
            i = e2 if e2 > i else i + 1
            continue
        if c == '"':
            i = string_end(i + 1)
            continue
        if c == '\'':
            e2 = char_or_lifetime(i + 1)
            i = e2 if e2 > i else i + 1
            continue
        i += 1
    return spans


def css_spans(text):
    spans = []
    i = 0
    n = len(text)

    def block_end(pos):
        e = text.find('*/', pos)
        return n if e == -1 else e + 2

    def string_end(pos):
        j = pos
        while j < n:
            if text[j] == '\\':
                j += 2
                continue
            if text[j] in ('"', "'"):
                return j + 1
            j += 1
        return n

    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            e = block_end(i + 2)
            if CJK.search(text[i:e]):
                spans.append((i, e))
            i = e
            continue
        if c in ('"', "'"):
            i = string_end(i + 1)
            continue
        i += 1
    return spans


def xml_spans(text):
    spans = []
    i = 0
    n = len(text)
    while i < n:
        j = text.find('<!--', i)
        if j == -1:
            break
        e = text.find('-->', j + 4)
        if e == -1:
            break
        if CJK.search(text[j:e]):
            spans.append((j, e + 3))
        i = e + 3
    return spans


def apply_spans(text, spans):
    if not spans:
        return text, 0
    n = len(text)
    removals = []
    for (s, e) in spans:
        ls = text.rfind('\n', 0, s) + 1
        le = text.find('\n', e)
        if le == -1:
            le = n
        before = text[ls:s]
        after = text[e:le]
        if re.fullmatch(r'\s*', before) and re.fullmatch(r'\s*', after):
            removals.append((ls, le + 1 if le < n else le))
        else:
            removals.append((s, e))
    removals.sort()
    merged = [removals[0]]
    for r in removals[1:]:
        if r[0] <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], r[1]))
        else:
            merged.append(r)
    out = []
    cursor = 0
    for (s, e) in merged:
        out.append(text[cursor:s])
        cursor = e
    out.append(text[cursor:])
    return ''.join(out), len(merged)


def main():
    total = 0
    for path in sys.argv[1:]:
        with open(path, 'rb') as f:
            raw = f.read()
        bom = raw.startswith(b'\xef\xbb\xbf')
        text = raw.decode('utf-8-sig')
        ext = path.rsplit('.', 1)[-1].lower()
        if ext == 'cs':
            spans = csharp_spans(text)
        elif ext == 'rs':
            spans = rust_spans(text)
        elif ext == 'css':
            spans = css_spans(text)
        elif ext == 'csproj':
            spans = xml_spans(text)
        else:
            continue
        new_text, cnt = apply_spans(text, spans)
        if cnt > 0:
            out = new_text.encode('utf-8')
            if bom:
                out = b'\xef\xbb\xbf' + out
            with open(path, 'wb') as f:
                f.write(out)
            print(f'{cnt}\t{path}')
            total += cnt
    print(f'TOTAL COMMENT SPANS REMOVED: {total}')


if __name__ == '__main__':
    main()
