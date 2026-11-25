"""把程式產生的內容寫進合併後文件中的指定區段（<!-- BEGIN 名稱 --> 與 <!-- END 名稱 --> 之間）。"""
import re


def demote(text: str) -> str:
    """標題降一級（# → ##），程式碼區塊內不處理。"""
    out, code = [], False
    for line in text.split("\n"):
        if line.startswith("```"):
            code = not code
        out.append("#" + line if (not code and re.match(r"^#{1,5} ", line)) else line)
    return "\n".join(out).strip() + "\n"


def write_section(path: str, marker: str, title: str, text: str) -> None:
    """text 為完整的 Markdown（以 # 標題開頭）；第一個標題換成 title，其餘標題降一級。"""
    content = re.sub(r"^## .*$", f"## {title}", demote(text), count=1, flags=re.M)
    with open(path, encoding="utf-8") as f:
        doc = f.read()
    begin = doc.index(f"<!-- BEGIN {marker}")
    begin = doc.index("\n", begin) + 1
    end = doc.index(f"<!-- END {marker} -->")
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc[:begin] + content + doc[end:])
