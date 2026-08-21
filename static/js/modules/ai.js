// ==========================================================================
// CineLog - AI Assistant Module (OpenAI-compatible Multi-Turn Streaming BYOK)
// ==========================================================================

import { state, getGradientForTitle } from './state.js';
import { showToastNotification } from './ui.js';

const STORAGE_KEY = "cinelog_ai_config";

export const AI_PRESETS = {
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo", "o3-mini"],
    placeholder: "sk-proj-...",
    requiresKey: true
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    placeholder: "sk-...",
    requiresKey: true
  },
  groq: {
    name: "Groq (Szybki & Darmowy)",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    placeholder: "gsk_...",
    requiresKey: true
  },
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-chat",
    models: ["deepseek/deepseek-chat", "deepseek/deepseek-r1", "anthropic/claude-3.5-sonnet", "meta-llama/llama-3.3-70b-instruct"],
    placeholder: "sk-or-v1-...",
    requiresKey: true
  },
  ollama: {
    name: "Ollama / Lokalne AI",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    models: ["llama3.2", "deepseek-r1", "mistral", "qwen2.5"],
    placeholder: "Opcjonalny klucz (np. ollama)",
    requiresKey: false
  },
  custom: {
    name: "Własne API (OpenAI)",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini"],
    placeholder: "Wpisz swój klucz API",
    requiresKey: true
  }
};

export function getAiConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {}

  return {
    provider: "openai",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    enabled: false
  };
}

export function saveAiConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    return true;
  } catch (e) {
    console.error("Failed to save AI config:", e);
    return false;
  }
}

export function isAiConfigured() {
  const cfg = getAiConfig();
  if (cfg.provider === "ollama") return true;
  return Boolean(cfg.apiKey && cfg.apiKey.trim().length > 5);
}

export function getAiLanguagePrompt() {
  const country = (state.userVodCountry || "PL").toUpperCase();
  const langMap = {
    "PL": { lang: "języku polskim (Polish)", vod: "w Polsce (np. Netflix, HBO Max, SkyShowtime, Disney+, Prime Video, Canal+, Player, Polsat Box Go, TVP VOD)" },
    "US": { lang: "języku angielskim (English)", vod: "w USA (np. Netflix, Max, Disney+, Hulu, Prime Video, Apple TV+)" },
    "GB": { lang: "języku angielskim (English)", vod: "w Wielkiej Brytanii (np. BBC iPlayer, Netflix, NOW, Prime Video, Disney+)" },
    "DE": { lang: "języku niemieckim (German)", vod: "w Niemczech (np. Netflix, WOW/Sky, Prime Video, Disney+)" },
    "FR": { lang: "języku francuskim (French)", vod: "we Francji (np. Netflix, Canal+, Prime Video, Disney+)" },
    "ES": { lang: "języku hiszpańskim (Spanish)", vod: "w Hiszpanii (np. Netflix, Movistar+, Prime Video, HBO Max)" },
    "IT": { lang: "języku włoskim (Italian)", vod: "we Włoszech (np. Netflix, NOW/Sky, Prime Video, Disney+)" }
  };

  const selected = langMap[country] || { lang: "języku angielskim (English)", vod: `dla wybranego kraju (${country})` };
  return `ZASADA JĘZYKA I VOD:
- Odpowiadaj WYŁĄCZNIE w ${selected.lang}.
- Proponowane platformy streamingowe dostosuj do dostępności ${selected.vod}.
- Nie wypisuj swojego toku myślenia ani meta-analizy zadania w treści odpowiedzi. Odpowiadaj od razu konkretnie do użytkownika.`;
}

export async function testAiConnection(config) {
  const cfg = config || getAiConfig();
  const baseUrl = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const apiKey = cfg.apiKey ? cfg.apiKey.trim() : "";
  const model = cfg.model || "gpt-4o-mini";

  const startTime = Date.now();

  try {
    const headers = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    if (cfg.provider === "openrouter") {
      headers["HTTP-Referer"] = window.location.origin;
      headers["X-Title"] = "CineLog";
    }

    const payload = {
      model: model,
      messages: [
        { role: "system", content: "You are CineLog assistant. Reply with only one word: OK." },
        { role: "user", content: "Test." }
      ],
      max_tokens: 10,
      temperature: 0.1
    };

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    const elapsed = Date.now() - startTime;

    if (!res.ok) {
      let errDetail = `Błąd HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson.error && errJson.error.message) {
          errDetail = errJson.error.message;
        }
      } catch (e) {}
      return { success: false, error: errDetail, elapsed };
    }

    const data = await res.json();
    if (data.choices && data.choices.length > 0) {
      return { success: true, model: model, elapsed };
    } else {
      return { success: false, error: "Pusta odpowiedź z modelu.", elapsed };
    }
  } catch (err) {
    const elapsed = Date.now() - startTime;
    return { success: false, error: err.message || "Błąd połączenia sieciowego (sprawdź CORS lub adres API).", elapsed };
  }
}

// --------------------------------------------------------------------------
// Real-time Streaming Engine with <think> Tag Separation & SSE Parsing
// --------------------------------------------------------------------------
export async function streamAiChat({ messages, temperature = 0.7, max_tokens = 2000, onToken, onThought }) {
  const cfg = getAiConfig();
  if (!isAiConfigured()) {
    throw new Error("Asystent AI nie został jeszcze skonfigurowany. Otwórz 'Chmura & Asystent AI', aby podać klucz API.");
  }

  const baseUrl = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const headers = {
    "Content-Type": "application/json"
  };
  if (cfg.apiKey) {
    headers["Authorization"] = `Bearer ${cfg.apiKey.trim()}`;
  }
  if (cfg.provider === "openrouter") {
    headers["HTTP-Referer"] = window.location.origin;
    headers["X-Title"] = "CineLog";
  }

  const payload = {
    model: cfg.model || "gpt-4o-mini",
    messages: messages,
    temperature: temperature,
    max_tokens: max_tokens,
    stream: true
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    let msg = `Błąd API (${res.status})`;
    try {
      const err = await res.json();
      if (err.error && err.error.message) msg = err.error.message;
    } catch (e) {}
    throw new Error(msg);
  }

  if (!res.body) {
    throw new Error("Przeglądarka nie obsługuje strumieniowania odpowiedzi.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let sseBuffer = "";
  let rawAccumulatedContent = "";
  let fullThought = "";
  let fullContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      if (trimmed === "data: [DONE]") continue;

      if (trimmed.startsWith("data: ")) {
        try {
          const jsonStr = trimmed.slice(6);
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta;
          if (delta) {
            // 1. Explicit reasoning_content delta (DeepSeek API, OpenRouter, Groq)
            const explicitThought = delta.reasoning_content || delta.reasoning || delta.thought || "";
            if (explicitThought) {
              fullThought += explicitThought;
              if (onThought) onThought(explicitThought, fullThought);
            }

            // 2. Main content delta (may contain <think>...</think> tags)
            if (delta.content) {
              rawAccumulatedContent += delta.content;

              if (rawAccumulatedContent.includes("<think>")) {
                const thinkStart = rawAccumulatedContent.indexOf("<think>");
                const thinkEnd = rawAccumulatedContent.indexOf("</think>");

                if (thinkEnd !== -1) {
                  // Completed <think> tag
                  const tagThought = rawAccumulatedContent.substring(thinkStart + 7, thinkEnd).trim();
                  const afterContent = rawAccumulatedContent.substring(thinkEnd + 8).trimStart();
                  
                  if (tagThought) {
                    fullThought = tagThought;
                    if (onThought) onThought("", fullThought);
                  }
                  fullContent = afterContent;
                  if (onToken) onToken(delta.content, fullContent);
                } else {
                  // Inside ongoing <think> tag
                  const ongoingThought = rawAccumulatedContent.substring(thinkStart + 7);
                  fullThought = ongoingThought;
                  if (onThought) onThought(delta.content, fullThought);
                }
              } else {
                fullContent += delta.content;
                if (onToken) onToken(delta.content, fullContent);
              }
            }
          }
        } catch (err) {
          // ignore partial chunk json parse errors
        }
      }
    }
  }

  // Fallback if model put everything in thought
  if (!fullContent.trim() && fullThought.trim()) {
    fullContent = fullThought;
    if (onToken) onToken(fullThought, fullContent);
  }

  if (!fullContent && !fullThought) {
    throw new Error("Otrzymano pustą odpowiedź od modelu AI.");
  }

  return fullContent.trim();
}

// --------------------------------------------------------------------------
// Clean Real-Time Markdown Formatter
// --------------------------------------------------------------------------
export function formatAiMarkdown(text) {
  if (!text) return "";
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  let html = clean
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^### (.*$)/gim, '<h4 style="margin: 12px 0 6px 0; color: #a855f7; font-size: 0.95rem; font-weight: 700;">$1</h4>')
    .replace(/^## (.*$)/gim, '<h3 style="margin: 14px 0 8px 0; color: #a855f7; font-size: 1.05rem; font-weight: 800;">$1</h3>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n- /g, '<br>• ')
    .replace(/\n\d+\. /g, (match) => `<br>${match.trim()} `);

  return html;
}

export function cleanTitleCandidate(str) {
  if (!str) return "";
  return str
    .replace(/<[^>]*>/g, '') // remove html
    .replace(/["„”«»*`_~]/g, '') // remove all quotes, stars, backticks
    .replace(/\(\d{4}[^)]*\)/g, '') // remove (2016), (2014, sezon 1), etc.
    .replace(/[:\-–—].*$/, '') // remove trailing colon or dash
    .trim();
}

// --------------------------------------------------------------------------
// Resolve Mentioned Media Items with Auto TMDb Enrichment (Full Cards)
// --------------------------------------------------------------------------
export async function resolveMentionedMediaItems(text) {
  if (!text) return [];

  const cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const lines = cleanText.split('\n');

  const primaryCandidates = [];
  const secondaryCandidates = [];

  const forbiddenWords = [
    "analyze", "brainstorm", "request", "profile", "constraints", "idea", "selection",
    "archetyp", "kluczowe", "wzorce", "rekomendacja", "rekomendacje", "propozycje", "gustu", "kinomana", "fascynacj",
    "zasady", "platforma", "vod", "netflix", "hbo", "prime", "disney", "canal+", "film", "serial", "filmy", "seriale",
    "odpowiedź", "asystent", "użytkownik", "status", "ocena", "opinia", "masz na liście", "do obejrzenia", "watchlist",
    "obejrzane", "planowane", "biblioteka", "kontekst", "tytuł", "tytuły", "ulubione", "dla ciebie", "polska",
    "tok myślenia", "złota rekomendacja", "wybór", "minut", "godzin"
  ];

  const isForbidden = (str) => {
    const l = str.toLowerCase().trim();
    return forbiddenWords.some(fw => l === fw || l.includes(fw)) || /^\d+[\.\)]/.test(str);
  };

  // 1. First pass: Check each line for Primary Recommendation at the start (e.g. 1. "Coherence" (2013))
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isNumberedOrBullet = /^(?:\d+[\.\)]|[-*•])\s+/.test(trimmed);
    if (isNumberedOrBullet) {
      // Find the first quoted or bold title in this line
      const firstQuoteMatch = trimmed.match(/^[^"„”«»]*["„”«»]([^"„”«»\n\r]{2,50})["„”«»]/);
      const firstBoldMatch = trimmed.match(/^[^**]*\*\*([^*:\n\r]{2,50})\*\*/);

      let lineTitle = "";
      if (firstQuoteMatch) {
        lineTitle = cleanTitleCandidate(firstQuoteMatch[1]);
      } else if (firstBoldMatch) {
        lineTitle = cleanTitleCandidate(firstBoldMatch[1]);
      }

      const yearMatch = trimmed.match(/\b(19\d\d|20\d\d)\b/);
      const year = yearMatch ? yearMatch[1] : "";

      if (lineTitle && lineTitle.length >= 2 && !isForbidden(lineTitle)) {
        if (!primaryCandidates.some(c => c.name.toLowerCase() === lineTitle.toLowerCase())) {
          primaryCandidates.push({ name: lineTitle, year: year });
        }
      }
    }
  }

  // 2. Second pass: Collect all other quoted titles
  const quotedRegex = /["„”«»]([^"„”«»\n\r]{2,50})["„”«»]/g;
  let match;
  while ((match = quotedRegex.exec(cleanText)) !== null) {
    const cleaned = cleanTitleCandidate(match[1]);
    if (cleaned.length >= 2 && cleaned.length <= 45 && !isForbidden(cleaned)) {
      if (!primaryCandidates.some(c => c.name.toLowerCase() === cleaned.toLowerCase()) && 
          !secondaryCandidates.some(c => c.name.toLowerCase() === cleaned.toLowerCase())) {
        secondaryCandidates.push({ name: cleaned, year: "" });
      }
    }
  }

  // If we found primary recommendations, prioritize them!
  const orderedCandidates = primaryCandidates.length > 0 ? primaryCandidates : secondaryCandidates;

  const results = [];
  const seenKeys = new Set();

  for (const { name, year: targetYear } of orderedCandidates) {
    const lower = name.toLowerCase();

    // 1. Check in user's movies
    const m = (state.movies || []).find(it => {
      const t = (it.title || "").toLowerCase();
      const orig = (it.original_title || "").toLowerCase();
      return t === lower || orig === lower || t.startsWith(lower) || lower.startsWith(t);
    });

    if (m) {
      const key = `m-${m.uuid || m.id || m.title}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        results.push({ item: m, type: "movie", inLibrary: true });
      }
      continue;
    }

    // 2. Check in user's shows
    const s = (state.shows || []).find(it => {
      const t = (it.title || "").toLowerCase();
      const orig = (it.original_title || "").toLowerCase();
      return t === lower || orig === lower || t.startsWith(lower) || lower.startsWith(t);
    });

    if (s) {
      const key = `s-${s.uuid || s.id || s.title}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        results.push({ item: s, type: "series", inLibrary: true });
      }
      continue;
    }

    // 3. Not in library by exact string: Fetch TMDb metadata dynamically via /api/search_preview!
    try {
      let searchRes = await fetch(`/api/search_preview?q=${encodeURIComponent(name)}&type=movie`);
      let searchData = searchRes.ok ? await searchRes.json() : null;
      let rawList = (searchData && searchData.results) || [];

      // Find best match in movie results considering targetYear and popularity
      let bestMatch = null;
      if (rawList.length > 0) {
        if (targetYear) {
          bestMatch = rawList.find(it => it.year === targetYear || (it.release_date && it.release_date.startsWith(targetYear)));
          if (!bestMatch) {
            bestMatch = rawList.find(it => it.year && Math.abs(parseInt(it.year) - parseInt(targetYear)) <= 1);
          }
        }
        if (!bestMatch) {
          const sorted = [...rawList].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
          bestMatch = sorted[0];
        }
      }

      // If no movie found or matched, try series
      if (!bestMatch) {
        searchRes = await fetch(`/api/search_preview?q=${encodeURIComponent(name)}&type=series`);
        searchData = searchRes.ok ? await searchRes.json() : null;
        rawList = (searchData && searchData.results) || [];
        if (rawList.length > 0) {
          if (targetYear) {
            bestMatch = rawList.find(it => it.year === targetYear || (it.release_date && it.release_date.startsWith(targetYear)));
          }
          if (!bestMatch) {
            const sorted = [...rawList].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
            bestMatch = sorted[0];
          }
        }
      }

      if (bestMatch) {
        const isTv = bestMatch.type === "series" || bestMatch.media_type === "tv";
        const tmdbId = bestMatch.tmdb_id || bestMatch.id;
        const bestTitleLower = (bestMatch.title || "").toLowerCase();
        const bestOrigLower = (bestMatch.original_title || "").toLowerCase();

        // Cross-reference with existing library by TMDb ID, Polish title or Original title!
        let existingInLibrary = null;
        if (!isTv) {
          existingInLibrary = (state.movies || []).find(it => {
            const itTitle = (it.title || "").toLowerCase();
            const itOrig = (it.original_title || "").toLowerCase();
            const itTmdb = it.tmdb_id || it.id;
            return (tmdbId && itTmdb && String(itTmdb) === String(tmdbId)) ||
                   (itTitle && (itTitle === bestTitleLower || itTitle === bestOrigLower)) ||
                   (itOrig && (itOrig === bestOrigLower || itOrig === bestTitleLower));
          });
        } else {
          existingInLibrary = (state.shows || []).find(it => {
            const itTitle = (it.title || "").toLowerCase();
            const itOrig = (it.original_title || "").toLowerCase();
            const itTmdb = it.tmdb_id || it.id;
            return (tmdbId && itTmdb && String(itTmdb) === String(tmdbId)) ||
                   (itTitle && (itTitle === bestTitleLower || itTitle === bestOrigLower)) ||
                   (itOrig && (itOrig === bestOrigLower || itOrig === bestTitleLower));
          });
        }

        if (existingInLibrary) {
          const key = `${isTv ? 's' : 'm'}-${existingInLibrary.uuid || existingInLibrary.id || existingInLibrary.title}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push({ item: existingInLibrary, type: isTv ? "series" : "movie", inLibrary: true });
          }
        } else {
          const itemObj = {
            id: tmdbId,
            tmdb_id: tmdbId,
            title: bestMatch.title || bestMatch.original_title || name,
            original_title: bestMatch.original_title || "",
            poster_url: bestMatch.poster_url || "",
            release_date: bestMatch.release_date || "",
            year: bestMatch.year || (bestMatch.release_date ? bestMatch.release_date.substring(0, 4) : targetYear),
            vote_average: bestMatch.vote_average ? Math.round(bestMatch.vote_average * 10) / 10 : null,
            overview: bestMatch.overview || "",
            media_type: isTv ? "tv" : "movie",
            type: isTv ? "series" : "movie"
          };
          const key = `tmdb-${itemObj.id || itemObj.title}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push({ item: itemObj, type: isTv ? "series" : "movie", inLibrary: false });
          }
        }
      }
    } catch (err) {
      console.warn("Could not fetch TMDb item for", name, err);
    }
  }

  return results;
}

// --------------------------------------------------------------------------
// Multi-turn Conversational Series Assistant
// --------------------------------------------------------------------------
export function buildSeriesSystemPrompt(showTitle, currentProgress) {
  const langRule = getAiLanguagePrompt();
  return `Jesteś ekspertem i asystentem serialowym w aplikacji CineLog. 
Użytkownik ogląda serial: "${showTitle}".
Bieżący postęp użytkownika to dokładnie: "${currentProgress || 'Początek serialu'}".

${langRule}

BEZWZGLĘDNY ZAKAZ SPOILERÓW:
- Odpowiadaj WYŁĄCZNIE opierając się na wydarzeniach, które miały miejsce DO ODCINKA ${currentProgress}.
- Pod żadnym pozorem nie wspominaj, nie sugeruj ani nie zdradzaj żadnych wydarzeń, zwrotów akcji ani losów bohaterów z PÓŹNIEJSZYCH odcinków lub kolejnych sezonów!
- Odpowiadaj zwięźle, konkretnie, w 2-3 punktach, bez długich wstępów. Wyróżniaj tytuły i postacie w cudzysłowach np. "Tytuł".`;
}

// --------------------------------------------------------------------------
// Multi-turn Conversational Film/Series Curator with Smart Context & @Mentions
// --------------------------------------------------------------------------
export function resolveMentionTags(userText = "") {
  if (!userText) return { cleanText: userText, injectedContext: "" };

  const injectedLines = [];
  const lowerText = userText.toLowerCase();

  // 1. Predefined Special Mentions
  if (/@(?:ulubione_filmy|fav_movies)\b/i.test(userText)) {
    const favs = (state.movies || []).filter(m => m.is_favorite || m.rating >= 4).map(m => `"${m.title}" (${m.rating ? m.rating + '/5★' : 'Ulubiony'})`);
    injectedLines.push(`[Kontekst @ulubione_filmy (${favs.length})]: ${favs.join(", ") || "Brak"}`);
  }
  if (/@(?:planowane_filmy|do_obejrzenia_filmy|watchlist_movies)\b/i.test(userText)) {
    const wl = (state.movies || []).filter(m => m.status === 'watchlist').map(m => `"${m.title}"`);
    injectedLines.push(`[Kontekst @planowane_filmy (${wl.length})]: ${wl.join(", ") || "Brak"}`);
  }
  if (/@(?:obejrzane_filmy|watched_movies)\b/i.test(userText)) {
    const wm = (state.movies || []).filter(m => m.status === 'watched').map(m => `"${m.title}" (${m.rating ? m.rating + '★' : 'obejrzany'})`);
    injectedLines.push(`[Kontekst @obejrzane_filmy (${wm.length})]: ${wm.join(", ") || "Brak"}`);
  }
  if (/@(?:ulubione_seriale|fav_shows)\b/i.test(userText)) {
    const favs = (state.shows || []).filter(s => s.is_favorite || s.rating >= 4).map(s => `"${s.title}" (${s.rating ? s.rating + '/5★' : 'Ulubiony'})`);
    injectedLines.push(`[Kontekst @ulubione_seriale (${favs.length})]: ${favs.join(", ") || "Brak"}`);
  }
  if (/@(?:planowane_seriale|do_obejrzenia_seriale|watchlist_shows)\b/i.test(userText)) {
    const wl = (state.shows || []).filter(s => s.status === 'watchlist').map(s => `"${s.title}"`);
    injectedLines.push(`[Kontekst @planowane_seriale (${wl.length})]: ${wl.join(", ") || "Brak"}`);
  }
  if (/@(?:obejrzane_seriale|watched_shows)\b/i.test(userText)) {
    const ws = (state.shows || []).filter(s => s.status === 'watched').map(s => `"${s.title}" (${s.rating ? s.rating + '★' : 'obejrzany'})`);
    injectedLines.push(`[Kontekst @obejrzane_seriale (${ws.length})]: ${ws.join(", ") || "Brak"}`);
  }

  // 2. Specific Item Mentions: @"Tytuł ze spacjami" or @Tytuł
  const itemMentionRegex = /@(?:"([^"]+)"|([a-zA-Z0-9_\u00C0-\u017E\-]+))/g;
  let m;
  const knownTags = ["ulubione_filmy", "planowane_filmy", "obejrzane_filmy", "ulubione_seriale", "planowane_seriale", "obejrzane_seriale", "do_obejrzenia", "wszystko", "film_serial"];
  
  while ((m = itemMentionRegex.exec(userText)) !== null) {
    const rawTag = (m[1] || m[2] || "").trim();
    if (!rawTag) continue;
    const normalized = rawTag.toLowerCase().replace(/_/g, " ");

    if (knownTags.includes(rawTag.toLowerCase())) continue;

    // Search in movies
    const foundMovie = (state.movies || []).find(it => {
      const t = (it.title || "").toLowerCase();
      return t === normalized || t.startsWith(normalized) || normalized.startsWith(t);
    });

    if (foundMovie) {
      injectedLines.push(`[Wskazany przez użytkownika film @${foundMovie.title}]: Rok: ${foundMovie.year || ''} | Status: ${foundMovie.status === 'watched' ? 'Obejrzany' : 'Planowany (Watchlist)'} | Ocena: ${foundMovie.rating ? foundMovie.rating + '/5★' : 'Brak oceny'} | Gatunek: ${foundMovie.genre || 'brak'} | Opis: ${foundMovie.plot || foundMovie.overview || ''}`);
      continue;
    }

    // Search in shows
    const foundShow = (state.shows || []).find(it => {
      const t = (it.title || "").toLowerCase();
      return t === normalized || t.startsWith(normalized) || normalized.startsWith(t);
    });

    if (foundShow) {
      injectedLines.push(`[Wskazany przez użytkownika serial @${foundShow.title}]: Rok: ${foundShow.year || ''} | Status: ${foundShow.status === 'watched' ? 'Ukończony' : 'W trakcie / Planowany'} | Postęp: ${foundShow.progress || foundShow.total_episodes || ''} | Ocena: ${foundShow.rating ? foundShow.rating + '/5★' : 'Brak oceny'} | Gatunek: ${foundShow.genre || 'brak'} | Opis: ${foundShow.plot || foundShow.overview || ''}`);
    }
  }

  return {
    injectedContext: injectedLines.join("\n")
  };
}

export function buildCuratorSystemPrompt(userQuery = "") {
  const q = (userQuery || "").toLowerCase();
  
  // Smart Token Routing: Detect if query is purely about movies, purely about series, or general
  const isMovieOnly = /film|filmów|filmie|filmowy|filmy|seans|kino|90 minut|kinomaniak|@film|@filmy|@ulubione_filmy|@obejrzane_filmy|@planowane_filmy/.test(q) &&
                      !/serial|odcinek|sezon|tasiemiec|@serial|@seriale|@ulubione_seriale|@obejrzane_seriale|@planowane_seriale/.test(q);
                      
  const isSeriesOnly = /serial|serialu|seriale|serialowy|odcink|sezon|binge|tasiemiec|odcinek|@serial|@seriale|@ulubione_seriale|@obejrzane_seriale|@planowane_seriale/.test(q) &&
                       !/film|filmów|filmie|filmowy|filmy|seans|kino|90 minut|@film|@filmy|@ulubione_filmy|@obejrzane_filmy|@planowane_filmy/.test(q);

  let libraryContext = "";

  if (isMovieOnly) {
    const favMovies = (state.movies || []).filter(m => m.is_favorite || m.rating >= 4).slice(0, 30).map(m => `"${m.title}" (${m.rating ? m.rating + '/5★' : 'Ulubiony'})`);
    const watchlistMovies = (state.movies || []).filter(m => m.status === 'watchlist').slice(0, 40).map(m => `"${m.title}"`);
    const watchedMovies = (state.movies || []).filter(m => m.status === 'watched').map(m => `"${m.title}"`);

    libraryContext = `
BIBLIOTEKA FILMOWA UŻYTKOWNIKA:
- Ulubione i wysoko ocenione filmy (${favMovies.length}): ${favMovies.join(", ") || "brak"}
- Filmy na liście "Do obejrzenia" (Watchlist) (${watchlistMovies.length}): ${watchlistMovies.join(", ") || "brak"}
- WSZYSTKIE OBEJRZANE JUŻ FILMY (ZAKAZ PONOWNEGO POLECANIA, chyba że użytkownik o to poprosi): ${watchedMovies.join(", ") || "brak"}`;
  } else if (isSeriesOnly) {
    const favShows = (state.shows || []).filter(s => s.is_favorite || s.rating >= 4).slice(0, 30).map(s => `"${s.title}" (${s.rating ? s.rating + '/5★' : 'Ulubiony'})`);
    const watchlistShows = (state.shows || []).filter(s => s.status === 'watchlist').slice(0, 40).map(s => `"${s.title}"`);
    const watchedShows = (state.shows || []).filter(s => s.status === 'watched').map(s => `"${s.title}"`);

    libraryContext = `
BIBLIOTEKA SERIALOWA UŻYTKOWNIKA:
- Ulubione i wysoko ocenione seriale (${favShows.length}): ${favShows.join(", ") || "brak"}
- Seriale na liście "Do obejrzenia" (Watchlist) (${watchlistShows.length}): ${watchlistShows.join(", ") || "brak"}
- WSZYSTKIE OBEJRZANE JUŻ SERIALE (ZAKAZ PONOWNEGO POLECANIA, chyba że użytkownik o to poprosi): ${watchedShows.join(", ") || "brak"}`;
  } else {
    const favMovies = (state.movies || []).filter(m => m.is_favorite || m.rating >= 4).slice(0, 25).map(m => `"${m.title}" (${m.rating ? m.rating + '/5★' : 'Ulubiony'})`);
    const favShows = (state.shows || []).filter(s => s.is_favorite || s.rating >= 4).slice(0, 25).map(s => `"${s.title}" (${s.rating ? s.rating + '/5★' : 'Ulubiony'})`);
    const watchlist = [
      ...(state.movies || []).filter(m => m.status === 'watchlist').slice(0, 30).map(m => `Film: "${m.title}"`),
      ...(state.shows || []).filter(s => s.status === 'watchlist').slice(0, 30).map(s => `Serial: "${s.title}"`)
    ];
    const watchedAll = [
      ...(state.movies || []).filter(m => m.status === 'watched').map(m => `"${m.title}"`),
      ...(state.shows || []).filter(s => s.status === 'watched').map(s => `"${s.title}"`)
    ];

    libraryContext = `
BIBLIOTEKA MULTIMEDIALNA UŻYTKOWNIKA:
- Najwyżej ocenione filmy: ${favMovies.join(", ") || "brak"}
- Ulubione i ukończone seriale: ${favShows.join(", ") || "brak"}
- Lista "Do obejrzenia" (Watchlist): ${watchlist.join(", ") || "brak"}
- WSZYSTKIE OBEJRZANE POZYCJE (ZAKAZ PONOWNEGO POLECANIA, chyba że użytkownik o to poprosi): ${watchedAll.join(", ") || "brak"}`;
  }

  const langRule = getAiLanguagePrompt();

  return `Jesteś osobistym doradcą filmowym i serialowym w aplikacji CineLog. Prowadzisz płynny, inteligentny dialog z użytkownikiem, doskonale znając całą jego bibliotekę.

${langRule}

${libraryContext}

KLUCZOWE ZASADY:
1. BEZWZGLĘDNY ZAKAZ REKOMENDOWANIA OBEJRZANYCH TYTUŁÓW: Użytkownik widział już wszystkie pozycje z sekcji "WSZYSTKIE OBEJRZANE". Pod żadnym pozorem nie polecaj mu tytułów z tej listy (chyba że wprost pyta o opinię lub powtórkę)!
2. Gdy proponujesz pozycję, która znajduje się na jego liście "Do obejrzenia" (Watchlist), koniecznie dodaj oznaczenie (🍿 Masz na liście Do Obejrzenia!).
3. Gdy polecasz tytuły, zaproponuj dokładnie 2-3 wybitne, trafione pozycje.
4. Format punktów rekomendacji:
   1. "Główny Tytuł" (Rok) – dlaczego warto + platforma VOD w Polsce.
   2. "Główny Tytuł" (Rok) – dlaczego warto + platforma VOD w Polsce.
   3. "Główny Tytuł" (Rok) – dlaczego warto + platforma VOD w Polsce.
5. BARDZO WAŻNE DOTYCZĄCE CUDZYSŁOWÓW: W cudzysłowach ("Tytuł") umieszczaj WYŁĄCZNIE 2-3 główne rekomendacje na początku punktów. Jeśli porównujesz film do innych produkcji w treści (np. w stylu Twin Peaks), NIE bierz ich w cudzysłowy (napisz po prostu: klimat jak w Twin Peaks), aby aplikacja wygenerowała kafelki wyłącznie dla Twoich głównych rekomendacji!
6. Pamiętaj poprzednie wiadomości w rozmowie, aby móc swobodnie kontynuować dialog.`;
}

// --------------------------------------------------------------------------
// Taste DNA Generator (Prompt Builder)
// --------------------------------------------------------------------------
export function buildTasteDnaPrompt() {
  const topMovies = (state.movies || [])
    .filter(m => m.rating >= 4 || m.is_favorite)
    .slice(0, 25)
    .map(m => `"${m.title}" (${m.rating ? m.rating + '/5★' : 'Ulubiony'})`);

  const topShows = (state.shows || [])
    .filter(s => s.rating >= 4 || s.is_favorite || s.status === 'watched')
    .slice(0, 25)
    .map(s => `"${s.title}" (${s.rating ? s.rating + '/5★' : 'Ukończony'})`);

  const langRule = getAiLanguagePrompt();

  const systemPrompt = `Jesteś błyskotliwym analitykiem kina w aplikacji CineLog.
Na podstawie biblioteki użytkownika stwórz zwięzły profil "DNA Twojego Gustu Filmowego".

${langRule}

BEZWZGLĘDNY ZAKAZ PISANIA PROCESU MYŚLOWEGO:
- Pod żadnym pozorem nie wypisuj w treści odpowiedzi etapów analitycznych (np. "1. Analyze the User's Request", "2. Analyze the Input Data", "3. Synthesize the Profile"). Odpowiedz OD RAZU konkretną treścią dla użytkownika!

ZASADY FORMATOWANIA (BĄDŹ ZWIĘZŁY I TREŚCIWY):
1. **Twój Archetyp Kinomana**: 1 chwytliwa nazwa (np. "Analityczny Koneser Mrocznego Napięcia") + 2 zdania uzasadnienia.
2. **Kluczowe Fascynacje**: 3 zwięzłe punkty z podaniem konkretnych motywów i przykładów tytułów w cudzysłowach np. "Tytuł".
3. **Ukryty Wzorzec**: 2 zdania o zaskakujących wspólnych cechach Twoich ulubionych produkcji.
4. **Złota Rekomendacja AI**: Dokładnie 1 wybitny film lub serial, którego prawdopodobnie nie widział, z 2-zadaniowym trafnym uzasadnieniem i platformą VOD.`;

  const userMessage = `Moje najwyżej ocenione filmy:
${topMovies.join(", ") || "Brak"}

Moje ulubione i ukończone seriale:
${topShows.join(", ") || "Brak"}`;

  return { systemPrompt, userMessage };
}
