/**
 * Numeracja odcinków w sezonie — TMDb vs numeracja biblioteki.
 *
 * TMDb scala część odcinków podwójnych w JEDEN wpis, a bazy „telewizyjne" (TVDB,
 * TVmaze, Filmweb — i tak numeruje import z TVTime) liczą je jako DWA. Skutek dla
 * użytkownika: numeracja biblioteki jest dłuższa, numery rozjeżdżają się o liczbę
 * scaleń, a obejrzane odcinki trafiają na cudze wiersze. Przykład („The Office",
 * sezon 5: 28 wpisów w bibliotece, 26 odcinków w TMDb): „Weight Loss" i „Stress
 * Relief" są scalone, więc od 3. odcinka przesunięcie wynosi 1, a od 18. — 2.
 *
 * Rozwiązanie: gdy biblioteka ma więcej odcinków niż TMDb, listę sezonu bierzemy z
 * TVmaze (ta sama numeracja co biblioteka, bez klucza API), a dla każdego odcinka
 * szukamy bliźniaka w TMDb PO NAZWIE (angielskie nazwy z TMDb — polskie są
 * tłumaczone, więc po nich nie dopasujemy), żeby pokazać polską nazwę i polski opis.
 */

/** Nazwa odcinka do porównania: bez interpunkcji, wielkości liter i znaków diakrytycznych. */
function kluczPorownania(nazwa, bezNumeruCzesci) {
  let tekst = String(nazwa || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  if (bezNumeruCzesci) {
    // „Weight Loss (2)" → „weight loss"; „Stress Relief, Part 1" → „stress relief"
    tekst = tekst.replace(/\(?\b(cz[eę]ść|part|pt)\b\.?\s*\d*\)?/g, " ");
    tekst = tekst.replace(/\(\d\)\s*$/, " ");
    tekst = tekst.replace(/,\s*\d\s*$/, " ");
  }
  // TMDb raz pisze „The Michael Scott Paper Company", raz „Michael Scott Paper
  // Company" — przedimek na początku nie może decydować o dopasowaniu odcinka.
  const klucz = tekst.replace(/[^a-z0-9]+/g, " ").trim();
  return klucz.startsWith("the ") ? klucz.slice(4) : klucz;
}

/** Klucz z numerem części: „Lecture Circuit (1)" i „(2)" to dwa różne odcinki. */
export function normalizujNazweOdcinka(nazwa) {
  return kluczPorownania(nazwa, false);
}

/** Klucz bez numeru części: „Weight Loss (1)" i „(2)" to ten sam odcinek TMDb. */
export function nazwaBezCzesci(nazwa) {
  return kluczPorownania(nazwa, true);
}

/** „Stress Relief (2)" → 2; „Weight Loss, Part 1" → 1; brak dopisku → 0. */
export function numerCzesci(nazwa) {
  const dopasowanie = String(nazwa || "").match(/\((\d)\)\s*$|,\s*(?:part|cz[eę]ść)\s*(\d)\s*$/i);
  if (!dopasowanie) return 0;
  return parseInt(dopasowanie[1] || dopasowanie[2], 10) || 0;
}

/**
 * Buduje mapę numerów TVmaze → numery TMDb dla jednego sezonu.
 *
 * Dwa przebiegi, bo TMDb scala tylko część odcinków podwójnych:
 *  1. dopasowanie 1:1 po pełnej nazwie (z numerem części) — „Lecture Circuit (1)"
 *     i „(2)" TMDb trzyma jako dwa osobne odcinki, więc mylenie ich byłoby błędem,
 *  2. dopasowanie po nazwie bez numeru części — dla odcinków scalonych („Weight
 *     Loss (1)/(2)" → „Weight Loss"); tutaj wiele numerów TVmaze może wskazywać
 *     ten sam odcinek TMDb i tak właśnie ma być.
 *
 * `kompletne` mówi, czy KAŻDY odcinek TVmaze dostał bliźniaka — bez tego nie wolno
 * przestawiać numeracji, bo pokazalibyśmy dane innego odcinka.
 * @returns {{mapa: Map<number, number>, kompletne: boolean, dopasowane: number}}
 */
export function zbudujMapeOdcinkow(odcinkiTvmaze, odcinkiTmdbEn) {
  const zTvmaze = (odcinkiTvmaze || []).slice();
  const zTmdb = (odcinkiTmdbEn || []).slice();
  const mapa = new Map();

  const przebieg = (klucz, uzyteTmd, pozwolNaWielokrotne) => {
    const poKluczu = new Map();
    zTmdb.forEach(odc => {
      if (!pozwolNaWielokrotne && uzyteTmd.has(odc.episode_number)) return;
      const k = klucz(odc.name);
      if (k && !poKluczu.has(k)) poKluczu.set(k, odc.episode_number);
    });
    zTvmaze.forEach(odc => {
      if (mapa.has(odc.number)) return;
      const k = klucz(odc.name);
      if (k && poKluczu.has(k)) {
        const nr = poKluczu.get(k);
        mapa.set(odc.number, nr);
        uzyteTmd.add(nr);
      }
    });
  };

  przebieg(normalizujNazweOdcinka, new Set(), false);
  przebieg(nazwaBezCzesci, new Set(), true);

  return {
    mapa,
    dopasowane: mapa.size,
    kompletne: zTvmaze.length > 0 && mapa.size === zTvmaze.length,
  };
}

/** Pobiera odcinki serialu z TVmaze (bez klucza API) i zwraca je per sezon. */
export async function pobierzKolejnoscTvmaze(tytul) {
  try {
    const url = `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(tytul)}&embed=episodes`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const perSezon = new Map();
    for (const ep of (data._embedded && data._embedded.episodes) || []) {
      if (ep.season === null || ep.number === null) continue;
      if (!perSezon.has(ep.season)) perSezon.set(ep.season, []);
      perSezon.get(ep.season).push({
        number: ep.number,
        name: ep.name || `Odcinek ${ep.number}`,
        summary: String(ep.summary || "").replace(/<[^>]+>/g, "").trim(),
        airdate: ep.airdate,
        runtime: ep.runtime,
        image: ep.image ? ep.image.medium : null,
      });
    }
    for (const lista of perSezon.values()) lista.sort((a, b) => a.number - b.number);
    return perSezon;
  } catch (e) {
    return null;
  }
}
