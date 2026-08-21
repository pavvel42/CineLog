// ==========================================================================
// CineLog - VOD Watch Providers & Region Settings Module
// ==========================================================================

import { state, syncWindowAliases } from './state.js';
import { showToastNotification } from './ui.js';

export const TMDB_GLOBAL_VOD_MAP = {
  "Netflix": "8",
  "HBO Max": "1899|384",
  "Disney Plus": "337",
  "Amazon Prime Video": "119|9",
  "SkyShowtime": "1773",
  "Apple TV": "350|2",
  "Google Play Movies": "3",
  "YouTube Premium": "188",
  "Hulu": "15",
  "Peacock": "386|387",
  "Paramount+": "531",
  "Starz": "43",
  "MGM+": "633|34",
  "AMC+": "528",
  "CANAL+": "645|381",
  "Player": "509",
  "Polsat Box Go": "512",
  "TVP VOD": "510",
  "CDA Premium": "470",
  "Viaplay": "76",
  "Megogo": "444",
  "Cineman": "503",
  "Crunchyroll": "283",
  "MUBI": "11",
  "Curiosity Stream": "190",
  "Rakuten TV": "35",
  "BBC iPlayer": "38",
  "ITVX": "41",
  "NOW": "39",
  "Channel 4": "103",
  "My5": "333",
  "BFI Player": "445",
  "BritBox": "380",
  "RTL+": "538",
  "Joyn": "304",
  "ZDFmediathek": "532",
  "ARD Mediathek": "540",
  "MagentaTV": "486",
  "France TV": "533",
  "TF1+": "534",
  "OCS": "56",
  "Molotov": "236",
  "Arte": "234",
  "Movistar Plus+": "149",
  "Filmin": "63",
  "Atresplayer": "296",
  "RTVE Play": "548",
  "Mitele": "300",
  "RaiPlay": "222",
  "Mediaset Infinity": "553",
  "TIMVISION": "109",
  "Discovery+": "520",
  "Videoland": "72",
  "NPO Start": "544",
  "NLZIET": "550",
  "Pathé Thuis": "71",
  "SVT Play": "426",
  "TV4 Play": "428",
  "NRK TV": "429",
  "TV 2 Play": "430",
  "DR TV": "424",
  "Filmstriben": "427",
  "Yle Areena": "431",
  "Ruutu": "432",
  "MTV Katsomo": "433",
  "Voyo": "395|400",
  "iVysílání": "488",
  "Prima+": "1888",
  "KVIFF.TV": "1782",
  "JOJ Play": "1840",
  "RTVS": "1841",
  "Sweet.tv": "575",
  "Kyivstar TV": "576",
  "Takflix": "577",
  "Crave": "230",
  "CBC Gem": "314",
  "Global TV": "326",
  "CTV": "327",
  "Tubi TV": "73",
  "Pluto TV": "300",
  "Globoplay": "307",
  "Claro video": "167",
  "Telecine": "227",
  "Stan": "21",
  "BINGE": "385",
  "ABC iview": "368",
  "SBS On Demand": "369",
  "7plus": "370",
  "9Now": "371",
  "10 play": "372",
  "Foxtel Now": "134",
  "Kayo Sports": "389",
  "U-NEXT": "84",
  "Lemino": "1883",
  "ABEMA": "559",
  "TELASA": "489",
  "FOD": "560",
  "DMM TV": "1884",
  "TVING": "97",
  "Wavve": "356",
  "Coupang Play": "524",
  "Watcha": "96",
  "Series On": "434"
};

export const COUNTRY_STREAMING_PROVIDERS = {
  "PL": {
    name: "Polska 🇵🇱",
    categories: [
      {
        name: "Główne & Globalne",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "HBO Max", label: "Max / HBO", color: "#5822b4", logo: "static/icons/vod/max.png" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "static/icons/vod/skyshowtime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Google Play Movies", label: "Google Play / YouTube", color: "#4285F4", logo: "static/icons/vod/googleplay.png" },
          { value: "YouTube Premium", label: "YouTube Premium", color: "#FF0000", logo: "static/icons/vod/youtube.png" }
        ]
      },
      {
        name: "Polskie i Lokalne",
        items: [
          { value: "CANAL+", label: "CANAL+ online", color: "#FFDE00", logo: "static/icons/vod/canalplus.png" },
          { value: "Player", label: "Player", color: "#0076FF", logo: "static/icons/vod/player.png" },
          { value: "Polsat Box Go", label: "Polsat Box Go", color: "#FF6600", logo: "static/icons/vod/polsat.png" },
          { value: "TVP VOD", label: "TVP VOD (Darmowe)", color: "#005A9C", logo: "static/icons/vod/tvp.png" },
          { value: "CDA Premium", label: "CDA Premium", color: "#E2231A", logo: "static/icons/vod/cda.png" },
          { value: "Viaplay", label: "Viaplay", color: "#E0004D", logo: "static/icons/vod/viaplay.jpg" },
          { value: "Megogo", label: "Megogo", color: "#2B2B2B", logo: "static/icons/vod/megogo.png" },
          { value: "Cineman", label: "Cineman", color: "#E50914", logo: "static/icons/vod/cineman.jpg" },
          { value: "Ninateka", label: "Ninateka (Darmowe)", color: "#009688", logo: "static/icons/vod/ninateka.jpg" },
          { value: "Mojeekino", label: "Mojeekino", color: "#E91E63", logo: "static/icons/vod/mojeekino.jpg" }
        ]
      },
      {
        name: "Anime & Kino Autorskie",
        items: [
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" },
          { value: "MUBI", label: "MUBI", color: "#002B49", logo: "static/icons/vod/mubi.png" },
          { value: "Curiosity Stream", label: "Curiosity Stream", color: "#FFBF00", logo: "static/icons/vod/curiosity.png" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "static/icons/vod/rakuten.png" }
        ]
      }
    ]
  },
  "US": {
    name: "Stany Zjednoczone 🇺🇸",
    categories: [
      {
        name: "Główne & Subskrypcyjne (USA)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "HBO Max", label: "Max (HBO)", color: "#5822b4", logo: "static/icons/vod/max.png" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "Hulu", label: "Hulu", color: "#1CE783", logo: "static/icons/vod/hulu.png" },
          { value: "Peacock", label: "Peacock", color: "#000000", logo: "static/icons/vod/peacock.png" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Starz", label: "Starz", color: "#000000", logo: "static/icons/vod/starz.png" },
          { value: "MGM+", label: "MGM+", color: "#C59B27", logo: "https://image.tmdb.org/t/p/original/efu1Cqc63XrPBoreYnf2mn0Nizj.jpg" },
          { value: "AMC+", label: "AMC+", color: "#1A1A1A", logo: "static/icons/vod/amc.png" },
          { value: "Google Play Movies", label: "Google TV", color: "#4285F4", logo: "static/icons/vod/googleplay.png" },
          { value: "YouTube Premium", label: "YouTube Premium", color: "#FF0000", logo: "static/icons/vod/youtube.png" }
        ]
      },
      {
        name: "Darmowe & Niszowe (USA)",
        items: [
          { value: "Tubi TV", label: "Tubi TV (Free)", color: "#FF5A00", logo: "static/icons/vod/tubi.png" },
          { value: "Pluto TV", label: "Pluto TV (Free)", color: "#000000", logo: "static/icons/vod/pluto.png" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" },
          { value: "MUBI", label: "MUBI", color: "#002B49", logo: "static/icons/vod/mubi.png" }
        ]
      }
    ]
  },
  "GB": {
    name: "Wielka Brytania 🇬🇧",
    categories: [
      {
        name: "Główne (UK)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "BBC iPlayer", label: "BBC iPlayer", color: "#FF004E", logo: "static/icons/vod/iplayer.png" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "NOW", label: "NOW (Sky)", color: "#003349", logo: "static/icons/vod/skyshowtime.png" },
          { value: "Channel 4", label: "Channel 4", color: "#00B4B4", logo: "static/icons/vod/channel4.png" },
          { value: "ITVX", label: "ITVX", color: "#10B981", logo: "static/icons/vod/itvx.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "BritBox", label: "BritBox", color: "#001A9C", logo: "https://image.tmdb.org/t/p/original/fj94cKNCHf4LTo31kFkWkGqf3e0.jpg" },
          { value: "Discovery+", label: "Discovery+", color: "#003366", logo: "static/icons/vod/googleplay.png" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "static/icons/vod/rakuten.png" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "DE": {
    name: "Niemcy 🇩🇪",
    categories: [
      {
        name: "Główne & Lokalne (DE)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "NOW", label: "WOW (Sky)", color: "#00FF85", logo: "static/icons/vod/skyshowtime.png" },
          { value: "RTL+", label: "RTL+", color: "#FF004E", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Joyn", label: "Joyn", color: "#00FF00", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "ZDFmediathek", label: "ZDFmediathek", color: "#FA7D00", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "ARD Mediathek", label: "ARD Mediathek", color: "#002D5A", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "MagentaTV", label: "MagentaTV", color: "#E20074", logo: "https://image.tmdb.org/t/p/original/E20074.jpg" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "static/icons/vod/rakuten.png" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "FR": {
    name: "Francja 🇫🇷",
    categories: [
      {
        name: "Główne & Lokalne (FR)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "CANAL+", label: "CANAL+", color: "#1A1A1A", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "static/icons/vod/max.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "France TV", label: "france.tv", color: "#0055A5", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "TF1+", label: "TF1+", color: "#003A70", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "OCS", label: "OCS", color: "#FF5500", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Arte", label: "Arte", color: "#FA5000", logo: "static/icons/vod/arte.png" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "static/icons/vod/rakuten.png" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "ES": {
    name: "Hiszpania 🇪🇸",
    categories: [
      {
        name: "Główne & Lokalne (ES)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Movistar Plus+", label: "Movistar Plus+", color: "#00A9E0", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "static/icons/vod/max.png" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Filmin", label: "Filmin", color: "#00FFA3", logo: "https://image.tmdb.org/t/p/original/fj94cKNCHf4LTo31kFkWkGqf3e0.jpg" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "static/icons/vod/skyshowtime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Atresplayer", label: "Atresplayer", color: "#E20613", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "RTVE Play", label: "RTVE Play", color: "#004488", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "static/icons/vod/rakuten.png" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "IT": {
    name: "Włochy 🇮🇹",
    categories: [
      {
        name: "Główne & Lokalne (IT)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "NOW", label: "NOW (Sky)", color: "#003349", logo: "static/icons/vod/skyshowtime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "RaiPlay", label: "RaiPlay (Darmowe)", color: "#002D62", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "Mediaset Infinity", label: "Mediaset Infinity", color: "#FF9900", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "TIMVISION", label: "TIMVISION", color: "#003399", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Discovery+", label: "Discovery+", color: "#003366", logo: "static/icons/vod/googleplay.png" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "static/icons/vod/rakuten.png" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "NL": {
    name: "Holandia 🇳🇱",
    categories: [
      {
        name: "Główne & Lokalne (NL)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Videoland", label: "Videoland", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "HBO Max", label: "Max / HBO", color: "#5822b4", logo: "static/icons/vod/max.png" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "static/icons/vod/skyshowtime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Viaplay", label: "Viaplay", color: "#E0004D", logo: "static/icons/vod/viaplay.jpg" },
          { value: "NPO Start", label: "NPO Start", color: "#FF5900", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "NLZIET", label: "NLZIET", color: "#00B4D8", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Pathé Thuis", label: "Pathé Thuis", color: "#FFDE00", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "SE": {
    name: "Szwecja 🇸🇪",
    categories: [
      {
        name: "Główne & Lokalne (SE)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Viaplay", label: "Viaplay", color: "#E0004D", logo: "static/icons/vod/viaplay.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "static/icons/vod/max.png" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "static/icons/vod/skyshowtime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "SVT Play", label: "SVT Play (Darmowe)", color: "#00A499", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "TV4 Play", label: "TV4 Play", color: "#E4002B", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Discovery+", label: "Discovery+", color: "#003366", logo: "static/icons/vod/googleplay.png" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "NO": {
    name: "Norwegia 🇳🇴",
    categories: [
      {
        name: "Główne & Lokalne (NO)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Viaplay", label: "Viaplay", color: "#E0004D", logo: "static/icons/vod/viaplay.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "static/icons/vod/max.png" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "static/icons/vod/skyshowtime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "NRK TV", label: "NRK TV (Darmowe)", color: "#0047BA", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "TV 2 Play", label: "TV 2 Play", color: "#D4001A", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Discovery+", label: "Discovery+", color: "#003366", logo: "static/icons/vod/googleplay.png" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "DK": {
    name: "Dania 🇩🇰",
    categories: [
      {
        name: "Główne & Lokalne (DK)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Viaplay", label: "Viaplay", color: "#E0004D", logo: "static/icons/vod/viaplay.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "static/icons/vod/max.png" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "static/icons/vod/skyshowtime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "DR TV", label: "DR TV (Darmowe)", color: "#101010", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "TV 2 Play", label: "TV 2 Play", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Filmstriben", label: "Filmstriben (Darmowe)", color: "#F39200", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "FI": {
    name: "Finlandia 🇫🇮",
    categories: [
      {
        name: "Główne & Lokalne (FI)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Yle Areena", label: "Yle Areena (Darmowe)", color: "#0098A6", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "Ruutu", label: "Ruutu", color: "#E6007E", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "MTV Katsomo", label: "MTV Katsomo", color: "#002B49", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "static/icons/vod/max.png" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "static/icons/vod/skyshowtime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Viaplay", label: "Viaplay", color: "#E0004D", logo: "static/icons/vod/viaplay.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "CZ": {
    name: "Czechy 🇨🇿",
    categories: [
      {
        name: "Główne & Lokalne (CZ)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Voyo", label: "Voyo", color: "#0055FF", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "static/icons/vod/max.png" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "static/icons/vod/skyshowtime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "iVysílání", label: "iVysílání ČT (Darmowe)", color: "#003366", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "Prima+", label: "Prima+", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "CANAL+", label: "CANAL+", color: "#1A1A1A", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "KVIFF.TV", label: "KVIFF.TV", color: "#FF4500", logo: "https://image.tmdb.org/t/p/original/fj94cKNCHf4LTo31kFkWkGqf3e0.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "SK": {
    name: "Słowacja 🇸🇰",
    categories: [
      {
        name: "Główne & Lokalne (SK)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Voyo", label: "Voyo", color: "#0055FF", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "static/icons/vod/max.png" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "static/icons/vod/skyshowtime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "JOJ Play", label: "JOJ Play", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "RTVS", label: "RTVS (Darmowe)", color: "#003366", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "CANAL+", label: "CANAL+", color: "#1A1A1A", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "UA": {
    name: "Ukraina 🇺🇦",
    categories: [
      {
        name: "Główne & Lokalne (UA)",
        items: [
          { value: "Megogo", label: "Megogo", color: "#2B2B2B", logo: "https://image.tmdb.org/t/p/original/yMw8nFjA2vFvWzW9lWfC7fM7k.jpg" },
          { value: "Sweet.tv", label: "Sweet.tv", color: "#FF5500", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Kyivstar TV", label: "Kyivstar TV", color: "#007AFF", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Takflix", label: "Takflix", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/fj94cKNCHf4LTo31kFkWkGqf3e0.jpg" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "static/icons/vod/rakuten.png" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "CA": {
    name: "Kanada 🇨🇦",
    categories: [
      {
        name: "Główne & Lokalne (CA)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Crave", label: "Crave (HBO/Starz)", color: "#0033A0", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "CBC Gem", label: "CBC Gem (Darmowe)", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "Global TV", label: "Global TV", color: "#00A859", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "CTV", label: "CTV", color: "#003399", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Tubi TV", label: "Tubi TV", color: "#FF5A00", logo: "https://image.tmdb.org/t/p/original/7k9s0z1.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "BR": {
    name: "Brazylia 🇧🇷",
    categories: [
      {
        name: "Główne & Lokalne (BR)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Globoplay", label: "Globoplay", color: "#FB0038", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "static/icons/vod/max.png" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "Claro video", label: "Claro video", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Telecine", label: "Telecine", color: "#ED1C24", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Starz", label: "Lionsgate+ (Starz)", color: "#000000", logo: "https://image.tmdb.org/t/p/original/8Z8j1nfg7jU3A1k4sK9Q5vK6f1.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "AU": {
    name: "Australia 🇦🇺",
    categories: [
      {
        name: "Główne & Lokalne (AU)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "Stan", label: "Stan", color: "#0071CE", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "BINGE", label: "BINGE", color: "#FF007A", logo: "static/icons/vod/skyshowtime.png" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "ABC iview", label: "ABC iview (Darmowe)", color: "#009688", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "SBS On Demand", label: "SBS On Demand", color: "#FF4500", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "7plus", label: "7plus", color: "#ED1C24", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "9Now", label: "9Now", color: "#0055FF", logo: "https://image.tmdb.org/t/p/original/9Now.jpg" },
          { value: "10 play", label: "10 play", color: "#00B4D8", logo: "https://image.tmdb.org/t/p/original/10play.jpg" },
          { value: "Foxtel Now", label: "Foxtel Now", color: "#FF6600", logo: "https://image.tmdb.org/t/p/original/Foxtel.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "JP": {
    name: "Japonia 🇯🇵",
    categories: [
      {
        name: "Główne & Lokalne (JP)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "U-NEXT", label: "U-NEXT", color: "#002B49", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "Hulu", label: "Hulu Japan", color: "#1CE783", logo: "https://image.tmdb.org/t/p/original/bxBlRPEPpMVDc4jMhSrTf2339DW.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Lemino", label: "Lemino / dTV", color: "#E4007F", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "ABEMA", label: "ABEMA", color: "#00FF7F", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "TELASA", label: "TELASA", color: "#FF4500", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "FOD", label: "FOD", color: "#003366", logo: "https://image.tmdb.org/t/p/original/FOD.jpg" },
          { value: "DMM TV", label: "DMM TV", color: "#FFD700", logo: "https://image.tmdb.org/t/p/original/DMM.jpg" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "static/icons/vod/rakuten.png" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  },
  "KR": {
    name: "Korea Południowa 🇰🇷",
    categories: [
      {
        name: "Główne & Lokalne (KR)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "static/icons/vod/netflix.png" },
          { value: "TVING", label: "TVING", color: "#FF153C", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Wavve", label: "Wavve", color: "#1351F9", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Coupang Play", label: "Coupang Play", color: "#00A8FF", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "static/icons/vod/disney.png" },
          { value: "Watcha", label: "Watcha", color: "#FF0558", logo: "https://image.tmdb.org/t/p/original/fj94cKNCHf4LTo31kFkWkGqf3e0.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "static/icons/vod/prime.png" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "static/icons/vod/appletv.png" },
          { value: "Series On", label: "Naver Series On", color: "#00C73C", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "static/icons/vod/crunchyroll.png" }
        ]
      }
    ]
  }
};

export function getProvidersForCountry(country) {
  if (COUNTRY_STREAMING_PROVIDERS[country]) {
    return COUNTRY_STREAMING_PROVIDERS[country];
  }
  return COUNTRY_STREAMING_PROVIDERS["PL"];
}

export function getCountryDisplayName(country) {
  const map = {
    "PL": "Polska 🇵🇱",
    "US": "Stany Zjednoczone (USA) 🇺🇸",
    "GB": "Wielka Brytania 🇬🇧",
    "DE": "Niemcy 🇩🇪",
    "FR": "Francja 🇫🇷",
    "ES": "Hiszpania 🇪🇸",
    "IT": "Włochy 🇮🇹",
    "NL": "Holandia 🇳🇱",
    "SE": "Szwecja 🇸🇪",
    "NO": "Norwegia 🇳🇴",
    "DK": "Dania 🇩🇰",
    "FI": "Finlandia 🇫🇮",
    "CZ": "Czechy 🇨🇿",
    "SK": "Słowacja 🇸🇰",
    "UA": "Ukraina 🇺🇦",
    "CA": "Kanada 🇨🇦",
    "BR": "Brazylia 🇧🇷",
    "AU": "Australia 🇦🇺",
    "JP": "Japonia 🇯🇵",
    "KR": "Korea Południowa 🇰🇷"
  };
  return map[country] || country;
}

export function getUserLanguage() {
  const map = {
    "PL": "pl-PL",
    "US": "en-US",
    "GB": "en-GB",
    "DE": "de-DE",
    "FR": "fr-FR",
    "ES": "es-ES",
    "IT": "it-IT",
    "NL": "nl-NL",
    "SE": "sv-SE",
    "NO": "no-NO",
    "DK": "da-DK",
    "FI": "fi-FI",
    "CZ": "cs-CZ",
    "SK": "sk-SK",
    "UA": "uk-UA",
    "CA": "en-CA",
    "BR": "pt-BR",
    "AU": "en-AU",
    "JP": "ja-JP",
    "KR": "ko-KR"
  };
  return map[state.userVodCountry] || "pl-PL";
}

export function renderVodSubscriptionsChecklist(country) {
  const container = document.getElementById("m3-vod-subscriptions-list");
  if (!container) return;
  container.innerHTML = "";

  const config = getProvidersForCountry(country);
  config.categories.forEach(cat => {
    const catBlock = document.createElement("div");
    catBlock.style.marginBottom = "10px";
    catBlock.innerHTML = `
      <div style="font-size: 0.75rem; font-weight: 700; color: var(--md-sys-color-primary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
        <span class="material-symbols-rounded" style="font-size: 16px;">category</span>
        <span>${cat.name}</span>
      </div>
      <div class="m3-vod-cat-grid"></div>
    `;
    const grid = catBlock.querySelector(".m3-vod-cat-grid");
    cat.items.forEach(item => {
      const isChecked = (state.userVodSubscriptions || []).includes(item.value);
      const label = document.createElement("label");
      label.className = `m3-vod-check-item ${isChecked ? 'active' : ''}`;
      
      const monogram = (item.label || item.value || "VOD").replace(/[^a-zA-Z0-9]/g, "").substring(0, 3).toUpperCase();
      const fallbackBadge = `<span class="m3-vod-badge-fallback" style="background-color: ${item.color || 'var(--md-sys-color-primary)'}; color: #fff; font-size: 0.62rem; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px;">${monogram}</span>`;

      const logoHtml = item.logo 
        ? `<img src="${item.logo}" alt="${item.label}" class="m3-vod-item-logo" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-flex';"><span style="display: none;">${fallbackBadge}</span>`
        : fallbackBadge;

      label.innerHTML = `
        <input type="checkbox" value="${item.value}" ${isChecked ? 'checked' : ''} style="display: none;">
        <span class="material-symbols-rounded m3-vod-item-check" style="font-size: 20px; color: ${isChecked ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline-variant)'}; flex-shrink: 0;">
          ${isChecked ? 'check_box' : 'check_box_outline_blank'}
        </span>
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex-grow: 1;">
          ${logoHtml}
          <span style="font-size: 0.82rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.label}</span>
        </div>
      `;

      const input = label.querySelector("input");
      if (input) {
        input.addEventListener("change", () => {
          const isNowChecked = input.checked;
          label.classList.toggle("active", isNowChecked);
          const icon = label.querySelector(".m3-vod-item-check");
          if (icon) {
            icon.innerText = isNowChecked ? 'check_box' : 'check_box_outline_blank';
            icon.style.color = isNowChecked ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline-variant)';
          }
        });
      }

      grid.appendChild(label);
    });
    container.appendChild(catBlock);
  });
}

export async function hydrateVodCache() {
  try {
    const res = await fetch(`/api/vod_cache_all?region=${state.userVodCountry}`);
    if (res.ok) {
      const data = await res.json();
      Object.keys(data).forEach(key => {
        state.vodCache[key] = data[key];
      });
    }
  } catch(e){}
}

export async function getWatchProvidersForTitle(title, mediaType, tmdbId = null) {
  const cleanTitle = (title || "").replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
  const cacheKey = `${mediaType}_${state.userVodCountry}_${cleanTitle}`;
  if (state.vodCache[cacheKey] && state.vodCache[cacheKey].found && !tmdbId) {
    return state.vodCache[cacheKey];
  }

  try {
    let url = `/api/watch_providers?title=${encodeURIComponent(cleanTitle)}&type=${mediaType}&region=${state.userVodCountry}`;
    if (tmdbId) {
      url += `&tmdb_id=${encodeURIComponent(tmdbId)}`;
    }
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.found) {
        state.vodCache[cacheKey] = data;
      }
      return data;
    }
  } catch (e) {
    console.error("VOD Fetch error:", e);
  }

  const empty = { found: false, flatrate: [], rent: [], buy: [], free: [] };
  state.vodCache[cacheKey] = empty;
  return empty;
}

export function matchVodFilter(title, mediaType) {
  if (state.activeVodFilter === "all") return true;

  const cleanTitle = (title || "").replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
  const cacheKey = `${mediaType}_${state.userVodCountry}_${cleanTitle}`;
  const data = state.vodCache[cacheKey];
  if (!data || !data.found) return false;

  const streamingList = [...(data.flatrate || []), ...(data.free || [])];
  const streamNames = streamingList.map(p => (p.name || "").toLowerCase());

  if (state.activeVodFilter === "my_vod") {
    const subList = state.userVodSubscriptions.map(s => s.toLowerCase());
    return streamNames.some(name => subList.some(sub => name.includes(sub) || sub.includes(name)));
  }

  const target = state.activeVodFilter.toLowerCase();
  return streamNames.some(name => name.includes(target) || target.includes(name));
}

export async function ensureVodDataForVisible(items, mediaType, onProgress, onComplete) {
  const missing = items.filter(item => {
    const cleanTitle = (item.title || "").replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
    const cacheKey = `${mediaType}_${state.userVodCountry}_${cleanTitle}`;
    return !state.vodCache[cacheKey];
  });

  if (missing.length === 0) {
    if (onComplete) onComplete();
    return;
  }

  const total = missing.length;
  let processed = 0;

  const banner = document.getElementById("m3-vod-loading-banner");
  const countEl = document.getElementById("m3-vod-loading-count");
  const progressBar = document.getElementById("m3-vod-progress-bar");

  if (banner) banner.style.display = "block";

  const chunkSize = 4;
  for (let i = 0; i < missing.length; i += chunkSize) {
    const chunk = missing.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (item) => {
      await getWatchProvidersForTitle(item.title, mediaType, item.tmdb_id || item.id);
      processed++;
      const pct = Math.round((processed / total) * 100);
      if (countEl) countEl.innerText = `${processed}/${total} (${pct}%)`;
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (onProgress) onProgress(processed, total);
    }));
  }

  if (banner) {
    setTimeout(() => {
      banner.style.display = "none";
    }, 400);
  }

  if (onComplete) onComplete();
}

export function renderTopVodFilterBar(country, onFilterChange) {
  const bar = document.getElementById("m3-vod-filter-bar");
  if (!bar) return;
  bar.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.className = `m3-vod-chip ${state.activeVodFilter === 'all' ? 'active' : ''}`;
  allBtn.setAttribute("data-vod", "all");
  allBtn.title = "Wszystkie pozycje w bibliotece";
  allBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size: 17px;">public</span><span class="m3-desktop-only-text">Wszystkie</span>`;
  bar.appendChild(allBtn);

  const myVodBtn = document.createElement("button");
  myVodBtn.className = `m3-vod-chip icon-only ${state.activeVodFilter === 'my_vod' ? 'active' : ''}`;
  myVodBtn.setAttribute("data-vod", "my_vod");
  myVodBtn.id = "m3-chip-my-vod";
  myVodBtn.title = "Moje VOD (Aktywne subskrypcje)";
  myVodBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px; color: var(--md-sys-color-primary);">star</span>`;
  bar.appendChild(myVodBtn);

  const favBtn = document.createElement("button");
  favBtn.className = `m3-vod-chip icon-only m3-mobile-fav-chip ${state.activeVodFilter === 'fav' ? 'active' : ''}`;
  favBtn.setAttribute("data-vod", "fav");
  favBtn.id = "m3-chip-fav";
  favBtn.title = "Tylko ulubione pozycje (❤️)";
  favBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px; color: var(--md-sys-color-favorite);">favorite</span>`;
  bar.appendChild(favBtn);

  const config = getProvidersForCountry(country);
  const chipsList = [];
  config.categories.forEach(cat => {
    cat.items.forEach(item => chipsList.push(item));
  });

  chipsList.slice(0, 18).forEach(item => {
    const btn = document.createElement("button");
    btn.className = `m3-vod-chip icon-only ${state.activeVodFilter === item.value ? 'active' : ''}`;
    btn.setAttribute("data-vod", item.value);
    btn.title = item.label;

    const monogram = (item.label || item.value || "VOD").replace(/[^a-zA-Z0-9]/g, "").substring(0, 3).toUpperCase();
    const fallbackBadge = `<span class="m3-vod-badge-fallback" style="background-color: ${item.color || 'var(--md-sys-color-primary)'}; color: #fff; font-size: 0.62rem; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px;">${monogram}</span>`;

    const logoHtml = item.logo
      ? `<img src="${item.logo}" alt="${item.label}" class="m3-vod-chip-logo" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-flex';"><span style="display: none;">${fallbackBadge}</span>`
      : fallbackBadge;

    btn.innerHTML = logoHtml;
    bar.appendChild(btn);
  });

  bar.querySelectorAll(".m3-vod-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      bar.querySelectorAll(".m3-vod-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      state.activeVodFilter = chip.getAttribute("data-vod");
      if (onFilterChange) onFilterChange();
    });
  });
}

export function initVodSettingsHandlers(onSettingsSaved) {
  const sheetVodSettings = document.getElementById("m3-sheet-vod-settings");
  const vodCountrySelect = document.getElementById("m3-vod-country-select");

  if (vodCountrySelect) {
    vodCountrySelect.addEventListener("change", (e) => {
      renderVodSubscriptionsChecklist(e.target.value);
    });
  }

  const openVodSettings = () => {
    if (vodCountrySelect) vodCountrySelect.value = state.userVodCountry;
    renderVodSubscriptionsChecklist(state.userVodCountry);
    if (sheetVodSettings) sheetVodSettings.classList.add("active");
  };

  const btnOpen = document.getElementById("m3-btn-open-vod-settings");
  const btnMobile = document.getElementById("m3-mobile-vod-settings");
  const btnClose = document.getElementById("m3-vod-settings-close");
  const btnSave = document.getElementById("m3-btn-save-vod-settings");

  if (btnOpen) btnOpen.addEventListener("click", openVodSettings);
  if (btnMobile) btnMobile.addEventListener("click", openVodSettings);
  if (btnClose && sheetVodSettings) {
    btnClose.addEventListener("click", () => {
      sheetVodSettings.classList.remove("active");
    });
  }

  if (btnSave) {
    btnSave.addEventListener("click", () => {
      const prevCountry = state.userVodCountry;
      state.userVodCountry = vodCountrySelect ? vodCountrySelect.value : "PL";
      localStorage.setItem("vod-country", state.userVodCountry);

      const checked = [];
      document.querySelectorAll("#m3-vod-subscriptions-list input:checked").forEach(chk => {
        checked.push(chk.value);
      });
      state.userVodSubscriptions = checked;
      localStorage.setItem("vod-subscriptions", JSON.stringify(checked));

      if (sheetVodSettings) sheetVodSettings.classList.remove("active");

      if (window.googleDriveSync && window.googleDriveSync.isAuthorized()) {
        window.googleDriveSync.uploadSettingsToDrive(state.userVodCountry, state.userVodSubscriptions);
      }

      renderTopVodFilterBar(state.userVodCountry, onSettingsSaved);

      if (prevCountry !== state.userVodCountry) {
        hydrateVodCache();
      }

      showToastNotification("Zapisano preferencje VOD!");
      if (onSettingsSaved) onSettingsSaved();
    });
  }
}
