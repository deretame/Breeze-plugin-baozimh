import type {
  ActionItem,
  ChapterContentContract,
  ChapterPage,
  ChapterPayload,
  ChapterSummary,
  ComicDetailContract,
  ComicInfoPageAction,
  ComicListItem,
  FetchImageBytesPayload,
  FetchImageBytesResult,
  ReadSnapshotContract,
  ReadSnapshotPayload,
  SearchComicPayload,
  SearchResultContract,
  StringMap,
} from "breeze-plugin-kit";
import { CheerioAPI } from "breeze-plugin-kit";
import { PLUGIN_ID } from "./common";
import { decodeChapterImages } from "./decoder";

// 旧站 www.baozimh.com 已全站 Gatekeeper 拦截（search/detail/API 均 403 challenge_required），
// 切到新站 baozimh.org（Cloudflare 后 Astro 站点），章节数据走 v2.apikk.top JSON API。
const SITE = process.env.BAOZIMH_DOMAIN || "https://baozimh.org";
const API_HOST = process.env.BAOZIMH_API || "https://v2.apikk.top";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
// 图片线路：站内 getChapter bundle 的 route 表，默认 c 线；line === 2 切 nd2 主机。
const IMAGE_HOST_DEFAULT = "https://c-nd3-1.6wm.top";
const IMAGE_HOST_LINE2 = "https://c-nd2-1.6wm.top";
const SEARCH_PAGE_SIZE = 30;

type SearchHit = {
  slug: string;
  title: string;
  cover: string | null;
};

type MangaStatus = "ongoing" | "completed" | "unknown";

type DetailMeta = {
  mid: string;
  slug: string;
  title: string;
  cover: string | null;
  author: string | null;
  tags: string[];
  description: string | null;
  status: MangaStatus;
  statusBadge: string;
};

type MangaApiChapter = {
  id: string;
  title: string;
  slug: string;
  order: number;
  updatedAt: string;
};

type MangaApiDetail = {
  title: string;
  slug: string;
  apiStatus: string;
  cover: string | null;
  desc: string | null;
  tags: string[];
  chapters: MangaApiChapter[];
};

type ChapterInfo = {
  mid: string;
  cid: string;
  title: string;
  line: number;
  enc: string;
  pre: string | null;
  next: string | null;
};

function normalizeUrl(
  pathOrUrl: string,
  base: string = SITE,
): string {
  return new URL(pathOrUrl, base).toString();
}

function readString(value: unknown): string {
  return String(value ?? "").trim();
}

function readMapString(map: StringMap | null | undefined, key: string): string {
  return readString(map?.[key]);
}

async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const headers = new Headers(init.headers);
  headers.set("user-agent", USER_AGENT);
  headers.set("referer", `${SITE}/`);
  const res = await fetch(url, {
    ...init,
    redirect: "follow",
    headers,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return await res.text();
}

async function fetchJson(url: string): Promise<unknown> {
  return JSON.parse(await fetchText(url));
}

async function fetchBytes(
  url: string,
  init: RequestInit = {},
): Promise<Uint8Array<ArrayBufferLike>> {
  const headers = new Headers(init.headers);
  headers.set("user-agent", USER_AGENT);
  headers.set("referer", `${SITE}/`);
  const res = await fetch(url, {
    ...init,
    redirect: "follow",
    headers,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function searchLink(query: string, page = 1): string {
  const u = new URL("/s", SITE);
  u.searchParams.set("q", query);
  u.searchParams.set("page", String(page));
  return u.toString();
}

function detailLink(slug: string): string {
  return normalizeUrl(`/manga/${slug}`);
}

function mangaApiUrl(mid: string): string {
  const u = new URL("/api/manga/get", API_HOST);
  u.searchParams.set("mid", mid);
  u.searchParams.set("mode", "all");
  return u.toString();
}

function chapterInfoUrl(mid: string, cid: string): string {
  const u = new URL("/api/v2/chapter/getinfo", API_HOST);
  u.searchParams.set("m", mid);
  u.searchParams.set("c", cid);
  return u.toString();
}

/** comicId 归一化为新站 manga slug；旧站 /comic/xxx 与新站 /manga/xxx 同形，可直接沿用。 */
function normalizeComicId(comicId: string): string {
  let s = readString(comicId);
  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname;
    } catch {
      // 保持原样走下面的清洗
    }
  }
  s = s.replace(/^\/+/, "").split("?")[0].split("#")[0];
  s = s.replace(/^(manga|comic)\//, "").replace(/\/+$/, "");
  return s;
}

function parseSearchHtml(html: string): SearchHit[] {
  const $ = BreezeHtml.load(html);
  const rows: SearchHit[] = [];
  $('a[href^="/manga/"]').each((_, el) => {
    const href = readString($(el).attr("href"));
    const m = href.match(/^\/manga\/([A-Za-z0-9_.\-]+)\/?$/);
    if (!m) return;
    const title =
      readString($(el).find("h3.cardtitle").first().text()) ||
      readString($(el).find("img").first().attr("alt"));
    if (!title) return;
    const cover = readString($(el).find("img").first().attr("src")) || null;
    rows.push({ slug: m[1], title, cover });
  });
  const uniq = new Map<string, SearchHit>();
  for (const row of rows) {
    if (!uniq.has(row.slug)) uniq.set(row.slug, row);
  }
  return Array.from(uniq.values());
}

function parseSearchMaxPage(html: string): number {
  const $ = BreezeHtml.load(html);
  let max = 1;
  $('a[href*="page="]').each((_, el) => {
    const href = readString($(el).attr("href"));
    const m = href.match(/[?&]page=(\d+)/);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  });
  return max;
}

function getMetaContent($: CheerioAPI, selector: string): string {
  return readString($(selector).first().attr("content"));
}

type LdComicSeries = {
  "@type"?: string;
  name?: string;
  description?: string;
  genre?: string[];
  image?: string;
};

function readLdComicSeries($: CheerioAPI): LdComicSeries | null {
  let found: LdComicSeries | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    try {
      const obj = JSON.parse($(el).text()) as LdComicSeries;
      if (obj && obj["@type"] === "ComicSeries") found = obj;
    } catch {
      return;
    }
  });
  return found;
}

function mapStatusText(text: string): MangaStatus {
  if (/連載|连载/.test(text)) return "ongoing";
  if (/完結|完结/.test(text)) return "completed";
  return "unknown";
}

function parseDetailHtml(html: string, slug: string): DetailMeta {
  const $ = BreezeHtml.load(html);
  const mid = readString($("[data-mid]").first().attr("data-mid"));
  if (!mid) throw new Error(`未找到漫画 mid: ${slug}`);
  const ld = readLdComicSeries($);
  const badge = readString($("h1 span").first().text());
  const h1Title = readString(
    $("h1").first().text().replace(badge, "").replace(/章節下架/g, ""),
  );
  const title =
    readString(ld?.name) ||
    h1Title ||
    getMetaContent($, 'meta[property="og:title"]');
  const author =
    readString($('a[href^="/manga-author/"]').first().text()) || null;
  const tags: string[] = [];
  $('a[href^="/manga-genre/"]').each((_, el) => {
    const tag = readString($(el).text()).replace(/,/g, "").trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  });
  for (const g of ld?.genre ?? []) {
    const tag = readString(g);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  const description =
    readString(ld?.description) ||
    getMetaContent($, 'meta[property="og:description"]') ||
    null;
  const cover =
    readString(ld?.image) || getMetaContent($, 'meta[property="og:image"]') || null;
  // 章節下架等未知徽标落 unknown，不强行映射。
  const statusBadge = badge || getMetaContent($, 'meta[property="og:updated_time"]');
  const status = mapStatusText(statusBadge);
  return { mid, slug, title, cover, author, tags, description, status, statusBadge };
}

function readApiChapters(data: unknown): MangaApiChapter[] {
  const obj = data as { chapters?: unknown };
  if (!Array.isArray(obj.chapters)) return [];
  const out: MangaApiChapter[] = [];
  for (const c of obj.chapters as Array<{
    id?: unknown;
    attributes?: {
      title?: unknown;
      slug?: unknown;
      order?: unknown;
      updatedAt?: unknown;
    };
  }>) {
    const id = readString(c.id);
    if (!id) continue;
    out.push({
      id,
      title: readString(c.attributes?.title),
      slug: readString(c.attributes?.slug),
      order: Number(c.attributes?.order ?? 0) || 0,
      updatedAt: readString(c.attributes?.updatedAt),
    });
  }
  out.sort((a, b) => a.order - b.order);
  return out;
}

async function fetchMangaApi(mid: string): Promise<MangaApiDetail> {
  const json = (await fetchJson(mangaApiUrl(mid))) as {
    code?: number;
    data?: {
      title?: unknown;
      slug?: unknown;
      status?: unknown;
      cover?: unknown;
      desc?: unknown;
      tagsM?: { data?: Array<{ attributes?: { name?: unknown } }> };
    };
  };
  if (json.code !== 200 || !json.data) {
    throw new Error(`漫画 API 返回异常 mid=${mid}`);
  }
  const tags: string[] = [];
  for (const t of json.data.tagsM?.data ?? []) {
    const name = readString(t.attributes?.name);
    if (name && !tags.includes(name)) tags.push(name);
  }
  return {
    title: readString(json.data.title),
    slug: readString(json.data.slug),
    apiStatus: readString(json.data.status),
    cover: readString(json.data.cover) || null,
    desc: readString(json.data.desc) || null,
    tags,
    chapters: readApiChapters(json.data),
  };
}

async function fetchChapterInfo(mid: string, cid: string): Promise<ChapterInfo> {
  const json = (await fetchJson(chapterInfoUrl(mid, cid))) as {
    code?: number;
    msg?: unknown;
    data?: {
      info?: {
        mid?: unknown;
        title?: unknown;
        pre?: unknown;
        next?: unknown;
        images?: { images?: unknown; line?: unknown };
      };
    };
  };
  if (json.code !== 200 || !json.data?.info) {
    throw new Error(
      `章节 API 返回异常 mid=${mid} cid=${cid}: ${readString(json.msg) || json.code}`,
    );
  }
  const info = json.data.info;
  const enc = readString(info.images?.images);
  if (!enc) throw new Error(`章节图片数据为空 mid=${mid} cid=${cid}`);
  return {
    mid: readString(info.mid) || mid,
    cid,
    title: readString(info.title),
    line: Number(info.images?.line ?? 0) || 0,
    enc,
    pre: readString(info.pre) || null,
    next: readString(info.next) || null,
  };
}

function imageHost(line: number): string {
  return line === 2 ? IMAGE_HOST_LINE2 : IMAGE_HOST_DEFAULT;
}

async function getPageUrls(mid: string, cid: string): Promise<string[]> {
  const info = await fetchChapterInfo(mid, cid);
  const host = imageHost(info.line);
  const decoded = decodeChapterImages(info.enc);
  decoded.sort((a, b) => a.order - b.order);
  return decoded.map((item) => `${host}${item.url}`);
}

function makeActionItem(name: string, onTap: ComicInfoPageAction | null = null): ActionItem {
  return { name, onTap, extern: {} };
}

function makeImage(
  id: string,
  url: string,
  name = "cover",
  path = url,
): ChapterPage["id"] extends string
  ? { id: string; url: string; name: string; path: string; extern: StringMap }
  : never {
  return {
    id,
    url,
    name,
    path: path.split("/").at(-1) || path,
    extern: {},
  };
}

function createComicListItem(
  id: string,
  title: string,
  cover: string | null,
  subtitle = "",
  raw: StringMap = {},
): ComicListItem {
  const coverUrl = cover ?? "";
  return {
    source: PLUGIN_ID,
    id,
    title,
    subtitle,
    finished: false,
    likesCount: 0,
    viewsCount: 0,
    updatedAt: "",
    cover: {
      id,
      url: coverUrl,
      name: "cover",
      path: coverUrl.split("/").at(-1) || coverUrl,
      extern: {},
    },
    metadata: [],
    raw,
    extern: {},
  };
}

function toChapterSummaries(
  mid: string,
  mangaSlug: string,
  list: MangaApiChapter[],
): ChapterSummary[] {
  return list.map((c) => ({
    id: c.id,
    requestId: c.id,
    logicalKey: String(c.order),
    storageChapterId: c.id,
    name: c.title || `第 ${c.order} 话`,
    order: c.order,
    extern: { mid, mangaSlug, slug: c.slug },
  }));
}

function findChapter(
  chapters: ChapterSummary[],
  chapterId: string,
): ChapterSummary {
  return (
    chapters.find(
      (item) =>
        item.requestId === chapterId ||
        item.id === chapterId ||
        readString(item.extern?.["slug"]) === chapterId ||
        item.logicalKey === chapterId,
    ) ?? chapters[0]
  );
}

function toPageItems(urls: string[]): ChapterPage[] {
  return urls.map((url, idx) => ({
    id: `${idx + 1}`,
    name: `${idx + 1}`,
    path: url.split("/").at(-1) || `${idx + 1}`,
    url,
    extern: {},
  }));
}

export async function searchComic(
  payload: SearchComicPayload = {},
): Promise<SearchResultContract> {
  const keyword = readString(
    payload.keyword ?? readMapString(payload.extern, "keyword"),
  );
  const page = Math.max(1, Number(payload.page ?? 1) || 1);
  const html = await fetchText(searchLink(keyword, page));
  const items = parseSearchHtml(html).map((row) =>
    createComicListItem(
      row.slug,
      row.title || row.slug,
      row.cover,
      "",
      row as unknown as StringMap,
    ),
  );
  const pages = Math.max(page, parseSearchMaxPage(html));
  const pageSize = items.length || SEARCH_PAGE_SIZE;
  const total =
    page >= pages ? (pages - 1) * pageSize + items.length : pages * pageSize;
  const paging = { page, pages, total, hasReachedMax: page >= pages };
  return {
    source: PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "searchResult",
      source: PLUGIN_ID,
      list: "comicGrid",
    },
    data: { paging, items },
    paging,
    items,
  };
}

export async function getComicDetail(
  payload: ChapterPayload & { comicId?: string } = {},
): Promise<ComicDetailContract> {
  const comicId = normalizeComicId(readString(payload.comicId));
  if (!comicId) throw new Error("comicId 不能为空");
  const meta = parseDetailHtml(await fetchText(detailLink(comicId)), comicId);
  const api = await fetchMangaApi(meta.mid);
  const tags = [...meta.tags];
  for (const t of api.tags) {
    if (!tags.includes(t)) tags.push(t);
  }
  const title = meta.title || api.title || comicId;
  const thumbnail = api.cover || meta.cover;
  // 详情徽标优先（保留原文如章節下架，不强行映射）；徽标未知时回落 API status。
  const status =
    meta.status !== "unknown"
      ? meta.status
      : api.apiStatus === "0"
        ? ("ongoing" as const)
        : api.apiStatus === "1"
          ? ("completed" as const)
          : ("unknown" as const);
  const statusLabel =
    meta.status !== "unknown"
      ? meta.status === "completed"
        ? "已完結"
        : "連載中"
      : meta.statusBadge || "未知";
  const chapters = toChapterSummaries(meta.mid, meta.slug, api.chapters);
  return {
    source: PLUGIN_ID,
    comicId,
    extern: payload.extern ?? null,
    scheme: { version: "1.0.0", type: "comicDetail", source: PLUGIN_ID },
    data: {
      normal: {
        comicInfo: {
          id: comicId,
          title,
          titleMeta: [
            makeActionItem(statusLabel),
            makeActionItem(`${chapters.length} 章`),
          ],
          creator: {
            id: comicId,
            name: meta.author || "",
            avatar: makeImage(comicId, thumbnail || "", "cover", thumbnail || ""),
            onTap: null,
            extern: {},
          },
          description: meta.description || api.desc || "",
          cover: makeImage(comicId, thumbnail || "", "cover", thumbnail || ""),
          metadata: [
            {
              type: "author",
              name: "作者",
              value: meta.author ? [makeActionItem(meta.author)] : [],
            },
            {
              type: "tags",
              name: "标签",
              value: tags.map((tag) => makeActionItem(tag)),
            },
          ],
          extern: { status, mid: meta.mid },
        },
        eps: chapters,
        recommend: [],
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        isFavourite: false,
        isLiked: false,
        allowComments: false,
        allowLike: false,
        allowCollected: false,
        allowDownload: true,
        extern: {},
      },
      raw: { meta, apiStatus: api.apiStatus, chapterCount: chapters.length },
    },
  };
}

export async function getChapter(
  payload: ChapterPayload = {},
): Promise<ChapterContentContract> {
  const comicId = normalizeComicId(readString(payload.comicId));
  if (!comicId) throw new Error("comicId 不能为空");
  const detail = await getComicDetail({ comicId, extern: payload.extern });
  const chapters = detail.data.normal.eps;
  if (chapters.length === 0) throw new Error(`暂无章节: ${comicId}`);
  const chapterId = readString(payload.chapterId);
  const chapter = chapterId ? findChapter(chapters, chapterId) : chapters[0];
  const mid = readString(chapter.extern?.["mid"]);
  const pages = await getPageUrls(mid, chapter.requestId);
  const pageItems = toPageItems(pages);
  return {
    source: PLUGIN_ID,
    comicId,
    chapterId: chapter.id,
    extern: payload.extern ?? null,
    scheme: { version: "1.0.0", type: "chapterContent", source: PLUGIN_ID },
    data: {
      comic: {
        id: comicId,
        source: PLUGIN_ID,
        title: detail.data.normal.comicInfo.title,
        extern: {},
      },
      chapter: {
        ...chapter,
        pages: pageItems,
      },
      chapters,
    },
  };
}

export async function getReadSnapshot(
  payload: ReadSnapshotPayload = {},
): Promise<ReadSnapshotContract> {
  const comicId = normalizeComicId(readString(payload.comicId));
  if (!comicId) throw new Error("comicId 不能为空");
  const detail = await getComicDetail({ comicId, extern: payload.extern });
  const chapters = detail.data.normal.eps;
  if (chapters.length === 0) throw new Error(`暂无章节: ${comicId}`);
  const chapterId = readString(payload.chapterId);
  const currentChapter = chapterId
    ? findChapter(chapters, chapterId)
    : chapters[0];
  const mid = readString(currentChapter.extern?.["mid"]);
  const pages = await getPageUrls(mid, currentChapter.requestId);
  const pageItems = toPageItems(pages);
  return {
    source: PLUGIN_ID,
    extern: payload.extern ?? null,
    data: {
      comic: {
        id: comicId,
        source: PLUGIN_ID,
        title: detail.data.normal.comicInfo.title,
        extern: {},
      },
      chapter: {
        ...currentChapter,
        pages: pageItems,
      },
      chapters: chapters.map((item) => ({
        id: item.id,
        name: item.name,
        order: item.order,
        extern: item.extern,
      })),
    },
  };
}

export async function fetchImageBytes(
  payload: FetchImageBytesPayload = {},
): Promise<FetchImageBytesResult> {
  const targetUrl = readString(payload.url);
  if (!targetUrl) throw new Error("url 不能为空");
  return await fetchBytes(targetUrl);
}
