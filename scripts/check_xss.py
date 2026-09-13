#!/usr/bin/env python3
"""Statyczny check wstrzyknięć HTML w frontendzie (szukanie luk XSS).

Audyt zostawił to jako PODEJRZENIE: helpery ``escapeHtml``/``safeUrl`` istnieją
i są używane, ale nikt nie obszedł wszystkich miejsc wstrzykiwania HTML. Ten
skrypt robi ten obchód maszynowo i pilnuje, żeby nowe `${...}` w HTML było
świadomą decyzją.

Sprawdza wstrzyknięcia (``innerHTML``/``outerHTML``/``insertAdjacentHTML``/
``document.write``) i wyciąga z nich każdą interpolację `${...}` w template
literal, która **nie** jest opakowana helperem escapującym. Wartości z API,
importu CSV i bazy użytkownika są danymi niezaufanymi — wstawione wprost mogą
wykonać skrypt (tytuł filmu z importu to wystarczający wektor).

Użycie:
    python3 scripts/check_xss.py            # exit 1 gdy są niezaakceptowane
    python3 scripts/check_xss.py --verbose  # wypisz też allowlistę i miejsca uznane za bezpieczne
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SKIP_DIRS = {"dist", "node_modules", "vendor", "icons"}

# Miejsca, w których łańcuch trafia do parsera HTML przeglądarki.
SINK_RE = re.compile(r"\b(innerHTML|outerHTML)\s*=|\.insertAdjacentHTML\s*\(|document\.write\s*\(")

# Nazwy pól, które w tym projekcie niosą dane z zewnątrz (TMDb/OMDb, import CSV,
# baza użytkownika, odpowiedź API). Wstawione wprost do HTML mogą wykonać skrypt.
TEXT_PROPS = {
    "title", "title_pl", "original_title", "original_name", "name", "full_name",
    "label", "plot", "overview", "description", "bio", "biography", "text",
    "message", "msg", "query", "q", "note", "notes", "comment", "tagline",
    "poster", "poster_url", "poster_path", "backdrop", "backdrop_url", "profile_url",
    "profile_path", "url", "href", "src", "image", "thumb", "logo", "logo_path",
    "path", "slug", "username", "email", "author", "genre", "genres", "status",
    "role", "character", "job", "department", "company", "network", "country_name",
    "provider_name", "vod_name", "season_name", "episode_name", "raw", "input",
}
PROP_RE = re.compile(r"[.\[]\s*[\"']?(?:" + "|".join(sorted(TEXT_PROPS)) + r")[\"']?\s*\]?")

# Wyrażenia uznawane za bezpieczne niezależnie od treści (escapują albo produkują liczbę).
SAFE_CALL_RE = re.compile(
    r"^(?:escapeHtml|safeUrl|safeHref|Number|parseInt|parseFloat|encodeURIComponent|"
    r"decodeURIComponent|String|Boolean|Math\.\w+|getGradientForTitle)\s*\("
)
# Literały: liczby, boolean, puste/pustobezpieczne literały znakowe.
SAFE_LITERAL_RE = re.compile(r"^(?:-?\d+(?:\.\d+)?|true|false|null|undefined|''|\"\"|``)$")

ALLOWLIST_PATH = Path(__file__).resolve().parent / "xss_allowlist.txt"


def iter_frontend_files(repo_root: Path):
    for path in sorted(repo_root.glob("static/js/**/*.js")):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        yield path


def _wysun_template(text: str, start: int) -> tuple[str, int]:
    """Zwraca treść template literal zaczynającego się w ``start`` (indeks `) i pozycję końca.

    Template literal może zawierać zagnieżdżone `${ ... }` z własnymi backtickami.
    """
    assert text[start] == "`"
    i = start + 1
    bufor = []
    glebokosc = 0
    while i < len(text):
        znak = text[i]
        if znak == "\\":
            bufor.append(text[i : i + 2])
            i += 2
            continue
        if znak == "`" and glebokosc == 0:
            return "".join(bufor), i
        if znak == "$" and i + 1 < len(text) and text[i + 1] == "{":
            glebokosc += 1
            bufor.append("${")
            i += 2
            continue
        if znak == "}" and glebokosc > 0:
            glebokosc -= 1
        elif znak == "`" and glebokosc > 0:
            # zagnieżdżony template w interpolacji — przepuszczamy z licznikiem
            pass
        bufor.append(znak)
        i += 1
    return "".join(bufor), len(text)


def _wyrazenia(tresc_template: str) -> list[str]:
    """Wyciąga wyrażenia z `${...}` (z zagnieżdżaniem nawiasów klamrowych)."""
    wynik = []
    i = 0
    while i < len(tresc_template):
        if tresc_template.startswith("${", i):
            glebokosc = 1
            j = i + 2
            while j < len(tresc_template) and glebokosc > 0:
                if tresc_template[j] == "{":
                    glebokosc += 1
                elif tresc_template[j] == "}":
                    glebokosc -= 1
                j += 1
            wynik.append(tresc_template[i + 2 : j - 1].strip())
            i = j
            continue
        i += 1
    return wynik


def _kontekst_linii(text: str, pozycja: int) -> str:
    """Krótki opis miejsca: od początku linii sink do ~60 znaków dalej."""
    poczatek = text.rfind("\n", 0, pozycja) + 1
    return " ".join(text[poczatek : pozycja + 60].split())


def _bezpieczne(wyrazenie: str) -> bool:
    czyste = wyrazenie.strip()
    while czyste.startswith("(") and czyste.endswith(")"):
        czyste = czyste[1:-1].strip()
    if SAFE_LITERAL_RE.match(czyste):
        return True
    if SAFE_CALL_RE.match(czyste):
        return True
    # `warunek ? a : b` — bezpieczne tylko gdy obie gałęzie bezpieczne.
    if "?" in czyste and ":" in czyste:
        warunek, _, reszta = czyste.partition("?")
        tak, _, nie = reszta.rpartition(":")
        if _bezpieczne(tak) and _bezpieczne(nie):
            return True
    # Sklejanie bezpiecznych kawałków: escapeHtml(x) + " " + escapeHtml(y)
    if "+" in czyste:
        czesci = [c for c in czyste.split("+") if c.strip()]
        if czesci and all(_bezpieczne(c) for c in czesci):
            return True
    return False


def load_allowlist(path: Path = ALLOWLIST_PATH) -> set[str]:
    if not path.is_file():
        return set()
    wpisy = set()
    for linia in path.read_text(encoding="utf-8").splitlines():
        czysta = linia.strip()
        if czysta and not czysta.startswith("#"):
            wpisy.add(czysta)
    return wpisy


def _klucz(rel: str, wyrazenie: str) -> str:
    return f"xss:{rel}:{wyrazenie}"


def _podejrzane(wyrazenie: str) -> bool:
    """Czy interpolacja dotyka pola z danymi zewnętrznymi (tytuł, opis, URL...)."""
    czyste = wyrazenie.strip()
    while czyste.startswith("(") and czyste.endswith(")"):
        czyste = czyste[1:-1].strip()
    if "+" in czyste:
        return any(_podejrzane(czesc) for czesc in czyste.split("+"))
    if "?" in czyste and ":" in czyste:
        _, _, reszta = czyste.partition("?")
        tak, _, nie = reszta.rpartition(":")
        return _podejrzane(tak) or _podejrzane(nie)
    return bool(PROP_RE.search(czyste))


def _wszystkie_interpolacje(wyrazenie: str) -> list[str]:
    """Interpolacje z wyrażenia, wraz z tymi w zagnieżdżonych template literalach.

    ``${cond ? `<img src="${x.title}">` : ""}`` ma dwa poziomy — oba trzeba obejrzeć.
    """
    wynik = [wyrazenie]
    tresc = wyrazenie
    i = 0
    while i < len(tresc):
        if tresc[i] == "`":
            wewnatrz, koniec = _wysun_template(tresc, i)
            for zagniezdzone in _wyrazenia(wewnatrz):
                wynik.extend(_wszystkie_interpolacje(zagniezdzone))
            i = koniec + 1
            continue
        i += 1
    return wynik


def check_innerhtml(repo_root: Path, allowlist: set[str]) -> tuple[list[str], list[str]]:
    """Znaleziska + miejsca z danymi zewnętrznymi, które są już escapowane."""
    znaleziska: list[str] = []
    bezpieczne: list[str] = []
    for path in iter_frontend_files(repo_root):
        rel = str(path.relative_to(repo_root))
        text = path.read_text(encoding="utf-8")
        for sink in SINK_RE.finditer(text):
            pozycja = sink.end()
            okno = text[pozycja : pozycja + 4000]
            if "`" not in okno:
                continue
            start = pozycja + okno.index("`")
            # Template musi należeć do TEGO przypisania — inaczej łapiemy literał
            # z następnej instrukcji (np. `el.innerHTML = "";` + osobny szablon).
            if ";" in text[pozycja:start]:
                continue
            tresc, _ = _wysun_template(text, start)
            for wyjscie in _wyrazenia(tresc):
                for wyrazenie in _wszystkie_interpolacje(wyjscie):
                    # Zagnieżdżony template oceniamy przez jego interpolacje (niżej),
                    # a nie jako całość — inaczej `cond ? \`...${escapeHtml(x)}\`` kłamie.
                    if "`" in wyrazenie:
                        continue
                    if not _podejrzane(wyrazenie):
                        continue
                    if _bezpieczne(wyrazenie):
                        bezpieczne.append(f"{rel}  ${{{wyrazenie}}}  (helper)")
                        continue
                    if _klucz(rel, wyrazenie) in allowlist:
                        bezpieczne.append(f"{rel}  ${{{wyrazenie}}}  (allowlist)")
                        continue
                    linia = text.count("\n", 0, start) + 1
                    znaleziska.append(
                        f"unescaped_html  {rel}:{linia}  ${{{wyrazenie}}} — "
                        f"owinąć w escapeHtml()/safeUrl(); kontekst: {_kontekst_linii(text, sink.start())[:70]!r}"
                    )
    return znaleziska, bezpieczne


def run(repo_root: Path, allowlist: set[str] | None = None) -> list[str]:
    wpisy = load_allowlist() if allowlist is None else allowlist
    znaleziska, _ = check_innerhtml(repo_root, wpisy)
    return znaleziska


def main(argv: list[str] | None = None) -> int:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Statyczny check wstrzyknięć HTML (XSS)")
    parser.add_argument("--root", type=Path, default=repo_root)
    parser.add_argument("--verbose", action="store_true", help="wypisz też allowlistę i miejsca bezpieczne")
    args = parser.parse_args(argv)

    znaleziska, bezpieczne = check_innerhtml(args.root, load_allowlist())
    if args.verbose:
        for wpis in sorted(load_allowlist()):
            print(f"allowlist: {wpis}")
        for wpis in bezpieczne:
            print(f"bezpieczne: {wpis}")
    if znaleziska:
        print(f"Niezabezpieczone wstrzyknięcia HTML ({len(znaleziska)}):")
        for wpis in znaleziska:
            print(f"  {wpis}")
        return 1
    print(f"Wstrzyknięcia HTML bez zastrzeżeń ({len(bezpieczne)} sprawdzonych interpolacji).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
