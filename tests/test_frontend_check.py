"""Testy lekkiego lintera frontendu (scripts/check_frontend.py).

Linter zastępuje ręczne szukanie trzech klas błędów, które audyt znalazł w tym
repozytorium: atrybutów zdarzeń blokowanych przez CSP, odwołań do nieistniejących
identyfikatorów i nieużywanych importów.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "check_frontend.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("check_frontend", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


check_frontend = _load_module()


@pytest.fixture()
def repo(tmp_path):
    (tmp_path / "static" / "js" / "modules").mkdir(parents=True)
    (tmp_path / "index.html").write_text(
        '<div id="m3-istniejacy-element"></div>', encoding="utf-8"
    )
    return tmp_path


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_wykrywa_atrybut_zdarzenia_w_html_z_js(repo):
    _write(repo / "static/js/modules/a.js", 'const html = `<button onclick="foo()">X</button>`;\n')
    findings = check_frontend.run(repo, allowlist=set())
    assert len(findings) == 1
    assert "inline_handler" in findings[0]


def test_wykrywa_odwolanie_do_nieistniejacego_id(repo):
    _write(repo / "static/js/modules/a.js", 'document.getElementById("m3-nie-ma-takiego").innerText = "x";\n')
    findings = check_frontend.run(repo, allowlist=set())
    assert len(findings) == 1
    assert "dead_id" in findings[0]


def test_nie_zglasza_istniejacego_id(repo):
    _write(repo / "static/js/modules/a.js", 'document.getElementById("m3-istniejacy-element").innerText = "x";\n')
    assert check_frontend.run(repo, allowlist=set()) == []


def test_nie_zglasza_id_tworzonego_dynamicznie(repo):
    _write(repo / "static/js/modules/a.js", 'const html = `<div id="m3-dynamiczny"></div>`;\nconst el = document.getElementById("m3-dynamiczny");\n')
    assert check_frontend.run(repo, allowlist=set()) == []


def test_wykrywa_nieuzywany_import(repo):
    _write(repo / "static/js/modules/a.js", 'import { uzywana, nieuzywana } from "./b.js";\nconsole.log(uzywana);\n')
    findings = check_frontend.run(repo, allowlist=set())
    assert len(findings) == 1
    assert "unused_import" in findings[0]
    assert "nieuzywana" in findings[0]


def test_allowlista_wycisza_zglaszany_problem(repo):
    _write(repo / "static/js/modules/a.js", 'document.getElementById("m3-swiadomie-brak").innerText = "x";\n')
    findings = check_frontend.run(repo, allowlist={"dead_id:m3-swiadomie-brak"})
    assert findings == []


def test_pomija_bundle_w_static_dist(repo):
    _write(repo / "static/dist/app.min.js", 'document.getElementById("m3-nie-ma-takiego")')
    assert check_frontend.run(repo, allowlist=set()) == []


def test_main_zwraca_kod_bledu_gdy_sa_problemy(repo, capsys):
    _write(repo / "static/js/modules/a.js", 'document.getElementById("m3-brak").innerText = "x";\n')
    exit_code = check_frontend.main(["--root", str(repo)])
    assert exit_code == 1
    assert "Problemy frontendu" in capsys.readouterr().out
