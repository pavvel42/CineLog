# DECISIONS.md — CineLog

Rejestr decyzji: co wybrano, co odrzucono i dlaczego. Wpisy dopisuje się na końcu; starych się nie
przepisuje — zmiana decyzji to nowy wpis, który wskazuje poprzedni.

Decyzje sprzed założenia rejestru opisują wiadomości commitów (`git log`).

---

## 2026-10-09 — Jeden plik projektu dla agentów: `AGENTS.md`
- **Wybrano:** fakty i konwencje projektu w `AGENTS.md` w repo; procedury w skillu `cinelog-verify`.
- **Odrzucono:** trzymanie ich w globalnej pamięci agenta (`MEMORY.md`).
- **Dlaczego:** pamięć trafia do każdej sesji, także niezwiązanej z projektem, i była prawie pełna.
  `AGENTS.md` ładuje się tylko w tym repo i jest wersjonowany razem z kodem.
- **Źródło:** commit `d65ad27`.
