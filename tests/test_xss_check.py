"""Testy sprawdzania wstrzyknięć HTML (scripts/check_xss.py).

Audyt zostawił ten obszar jako PODEJRZENIE: helpery `escapeHtml`/`safeUrl`
istniały, ale nikt nie obszedł wszystkich miejsc wstawiania HTML. Testy pilnują
dwóch rzeczy: że sprawdzacz faktycznie łapie dane z zewnątrz wstawiane wprost do
HTML, oraz że samo repozytorium jest czyste (to jest ta sama bramka, którą
uruchamia CI).
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "check_xss.py"
REPO_ROOT = SCRIPT.parent.parent


def _load_module():
    spec = importlib.util.spec_from_file_location("check_xss", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


check_xss = _load_module()


@pytest.fixture()
def repo(tmp_path):
    (tmp_path / "static" / "js" / "modules").mkdir(parents=True)
    return tmp_path


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_wykrywa_tytul_z_danych_wprost_w_html(repo):
    _write(repo / "static/js/modules/a.js", 'el.innerHTML = `<span>${item.title}</span>`;\n')
    findings = check_xss.run(repo, allowlist=set())
    assert len(findings) == 1
    assert "unescaped_html" in findings[0]
    assert "item.title" in findings[0]


def test_wykrywa_url_z_danych_bez_escapowania(repo):
    _write(repo / "static/js/modules/a.js", 'el.innerHTML = `<img src="${p.poster_url}">`;\n')
    findings = check_xss.run(repo, allowlist=set())
    assert len(findings) == 1
    assert "p.poster_url" in findings[0]


def test_wykrywa_interpolacje_z_zagniezdzonego_template(repo):
    _write(
        repo / "static/js/modules/a.js",
        'el.innerHTML = `${ok ? `<img alt="${it.title}">` : ""}`;\n',
    )
    findings = check_xss.run(repo, allowlist=set())
    assert len(findings) == 1
    assert "it.title" in findings[0]


def test_nie_zglasza_danych_escapowanych(repo):
    _write(
        repo / "static/js/modules/a.js",
        'el.innerHTML = `<span>${escapeHtml(item.title)}</span><img src="${escapeHtml(safeUrl(item.poster_url))}">`;\n',
    )
    assert check_xss.run(repo, allowlist=set()) == []


def test_nie_zglasza_liczb_i_identyfikatorow(repo):
    _write(
        repo / "static/js/modules/a.js",
        'el.innerHTML = `<li data-id="${item.id}">${Number(item.vote_average).toFixed(1)}</li>`;\n',
    )
    assert check_xss.run(repo, allowlist=set()) == []


def test_nie_zglasza_literalu_poza_przypisaniem_innerhtml(repo):
    _write(repo / "static/js/modules/a.js", 'el.innerHTML = "";\nconst uid = `cinelog-${it.title}`;\n')
    assert check_xss.run(repo, allowlist=set()) == []


def test_allowlista_wycisza_swiadome_wyjatki(repo):
    _write(repo / "static/js/modules/a.js", 'el.innerHTML = `<b>${item.title}</b>`;\n')
    wpisy = {"xss:static/js/modules/a.js:item.title"}
    assert check_xss.run(repo, allowlist=wpisy) == []


def test_pomija_bundle_w_static_dist(repo):
    _write(repo / "static/dist/app.min.js", 'el.innerHTML=`<b>${item.title}</b>`;\n')
    assert check_xss.run(repo, allowlist=set()) == []


def test_main_zwraca_kod_bledu_gdy_sa_problemy(repo, capsys):
    _write(repo / "static/js/modules/a.js", 'el.innerHTML = `<b>${item.title}</b>`;\n')
    exit_code = check_xss.main(["--root", str(repo)])
    assert exit_code == 1
    assert "Niezabezpieczone wstrzyknięcia HTML" in capsys.readouterr().out


def test_repozytorium_nie_ma_nieescapowanych_wstrzykniec():
    """Bramka: dzisiejsze drzewo frontendu jest czyste."""
    findings = check_xss.run(REPO_ROOT)
    assert findings == [], "\n".join(findings)
