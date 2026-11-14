/*
 * Open sketches from GitHub: a repository, a folder in one, a .ino file, or a raw file link.
 * Public repositories only; it uses GitHub's API without signing in (60 requests an hour).
 *
 * Arduino sketches are folders: the .ino named after the folder comes first, then the folder's
 * other .ino files in name order, and `#include "x.h"` pulls in local headers. A sketch of just
 * those is combined into one file in that order, with headers inlined, so the block editor can
 * show it. A sketch with .cpp files, a src/ folder (git submodules included) or a config/ folder
 * opens as all its files, which the playground builds the way the Arduino IDE does.
 */

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export class GitHubError extends Error {}

// "owner/repo", github.com/owner/repo[/tree|blob/ref/path], or raw.githubusercontent.com/owner/repo/ref/path
export function parseGitHub(input) {
  let s = String(input || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  if (!s) return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = 'github.com/' + s;
  const m = /^(?:https?:\/\/)?(?:www\.)?(github\.com|raw\.githubusercontent\.com)\/([\w.-]+)\/([\w.-]+)(?:\/(.*))?$/i.exec(s);
  if (!m) return null;
  const [, host, owner, repo, rest = ''] = m;
  const parts = rest ? rest.split('/').map(decodeURIComponent) : [];
  if (/^raw\./i.test(host)) {
    if (parts.length < 2) return null;
    return { owner, repo, ref: parts[0], path: parts.slice(1).join('/'), file: true };
  }
  if (!parts.length) return { owner, repo, ref: null, path: '' };
  if ((parts[0] === 'blob' || parts[0] === 'tree') && parts.length >= 2) {
    const path = parts.slice(2).join('/');
    return { owner, repo, ref: parts[1], path, file: parts[0] === 'blob' || /\.ino$/i.test(path) };
  }
  return null;
}

async function get(url, what) {
  let res;
  try {
    res = await fetch(url, { headers: url.startsWith(API) ? { Accept: 'application/vnd.github+json' } : {} });
  } catch (e) {
    throw new GitHubError('Couldn’t reach GitHub. Check your internet connection and try again.');
  }
  if (res.status === 404) throw new GitHubError(`Couldn’t find ${what}. Check the address, and that the repository is public.`);
  if (res.status === 403 || res.status === 429) {
    throw new GitHubError('GitHub is limiting requests from this network for a while (about 60 an hour without signing in). Try again later.');
  }
  if (!res.ok) throw new GitHubError(`GitHub answered ${res.status} for ${what}.`);
  return res;
}

const rawUrl = (g, path) => `${RAW}/${g.owner}/${g.repo}/${encodeURIComponent(g.ref)}/${path.split('/').map(encodeURIComponent).join('/')}`;

// Every file in the repository (at g.ref, or the default branch), and the ref used
export async function repoFiles(g) {
  let ref = g.ref;
  if (!ref) ref = (await (await get(`${API}/repos/${g.owner}/${g.repo}`, 'that repository')).json()).default_branch;
  const tree = await (await get(`${API}/repos/${g.owner}/${g.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, 'that branch')).json();
  return {
    ref,
    paths: (tree.tree || []).filter(t => t.type === 'blob').map(t => t.path),
    submodules: (tree.tree || []).filter(t => t.type === 'commit').map(t => ({ path: t.path, sha: t.sha })),
    truncated: !!tree.truncated,
  };
}

const SOURCE = /\.(ino|h|hh|hpp|c|cc|cpp)$/i;
const MAX_FILES = 200;

// Does the sketch in `dir` need its files kept apart (see the top of this file)?
function needsFiles(rel, subs) {
  if (subs.length) return true;
  return rel.some(p => (/\.(c|cc|cpp)$/i.test(p) && (!p.includes('/') || p.startsWith('src/'))) || (p.startsWith('config/') && /\.h$/i.test(p)));
}

// `[submodule "x"] path = a/b url = https://github.com/o/r(.git)` -> Map(path -> { owner, repo })
function parseGitmodules(text) {
  const out = new Map();
  for (const block of text.split(/^\s*\[submodule/m).slice(1)) {
    const path = /^\s*path\s*=\s*(.+?)\s*$/m.exec(block), url = /^\s*url\s*=\s*(.+?)\s*$/m.exec(block);
    const m = url && /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url[1]);
    if (path && m) out.set(path[1], { owner: m[1], repo: m[2] });
  }
  return out;
}

// The sketches under `under`: each folder's main .ino (named after the folder; at the top, after
// the repository), or every .ino in a folder that has no main one
export function sketchesIn(paths, under = '', repo = '') {
  const prefix = under ? under.replace(/\/$/, '') + '/' : '';
  const inos = paths.filter(p => /\.ino$/i.test(p) && p.startsWith(prefix));
  const isMain = p => isMainSketch(p, repo);
  // in a folder with a main sketch, the other .ino files are its tabs, not sketches of their own
  const folder = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const mains = new Set(inos.filter(isMain).map(folder));
  return inos.filter(p => isMain(p) || !mains.has(folder(p))).sort((a, b) => a.localeCompare(b));
}

function isMainSketch(path, repo) {
  const parts = path.split('/');
  const folder = parts.length > 1 ? parts[parts.length - 2] : repo;
  return !!folder && parts[parts.length - 1].toLowerCase() === folder.toLowerCase() + '.ino';
}

// Load one sketch: its .ino plus the folder's other .ino files and the local headers it includes.
// `paths` (all files in the repo) is optional; without it only the one file is loaded. Returns
// { code } for a sketch combined into one file, or { files, main } for one kept as its files
// (see the top of this file), with `name` and `url`.
export async function loadSketch(g, path, paths, submodules = []) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const base = path.slice(dir.length);
  const inFolder = paths ? paths.filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/')) : [path];
  const isMain = isMainSketch(path, g.repo);
  if (isMain && paths) {
    const subs = submodules.filter(m => m.path.startsWith(dir));
    const rel = paths.filter(p => p.startsWith(dir)).map(p => p.slice(dir.length));
    if (needsFiles(rel, subs)) return loadFiles(g, dir, base, rel, subs);
  }
  const tabs = isMain ? inFolder.filter(p => /\.ino$/i.test(p) && p !== path).sort((a, b) => a.localeCompare(b)) : [];
  const text = async p => (await get(rawUrl(g, p), p.slice(dir.length))).text();
  const files = [path, ...tabs];
  const sources = await Promise.all(files.map(text));
  const used = [];
  const headers = new Map();
  // inline `#include "x.h"` for headers in the folder, each once
  const inline = async (src, seen) => {
    const out = [];
    for (const line of src.split('\n')) {
      const m = /^\s*#\s*include\s*"([^"]+)"/.exec(line);
      const hp = m && dir + m[1].replace(/^\.\//, '');
      if (!m || !inFolder.includes(hp)) { out.push(line); continue; }
      if (seen.has(hp)) { out.push('// ' + line.trim() + '  (already included above)'); continue; }
      seen.add(hp);
      if (!headers.has(hp)) headers.set(hp, await text(hp));
      used.push(hp.slice(dir.length));
      out.push(`// ---- ${m[1]} ----`, await inline(headers.get(hp).replace(/^\s*#\s*pragma\s+once\s*$/m, ''), seen), `// ---- end of ${m[1]} ----`);
    }
    return out.join('\n');
  };
  const seen = new Set();
  const parts = [];
  for (let i = 0; i < files.length; i++) {
    const body = await inline(sources[i].replace(/\r\n?/g, '\n'), seen);
    parts.push(i ? `\n// ---- ${files[i].slice(dir.length)} ----\n${body}` : body);
  }
  return {
    code: parts.join('\n'),
    name: base.replace(/\.ino$/i, ''),
    combined: [...tabs.map(p => p.slice(dir.length)), ...used],
    url: `https://github.com/${g.owner}/${g.repo}/blob/${g.ref}/${path}`,
  };
}

// A sketch kept as its files: everything in its folder but other sketches' folders, and its
// git submodules' files, fetched at the commits the repository pins them to
async function loadFiles(g, dir, base, rel, subs) {
  // a subfolder with an .ino of its own is another sketch (an example, say), not part of this one
  const sketchDirs = rel.filter(p => p.includes('/') && /\.ino$/i.test(p)).map(p => p.slice(0, p.lastIndexOf('/') + 1));
  const wanted = rel.filter(p => SOURCE.test(p) && !sketchDirs.some(d => p.startsWith(d)));
  const fetches = wanted.map(p => ({ g, path: dir + p, as: p }));
  const modules = [];
  if (subs.length) {
    const urls = parseGitmodules(await (await get(rawUrl(g, '.gitmodules'), '.gitmodules')).text());
    for (const sub of subs) {
      const at = urls.get(sub.path);
      if (!at) continue;
      const sg = { ...at, ref: sub.sha };
      const tree = await (await get(`${API}/repos/${at.owner}/${at.repo}/git/trees/${sub.sha}?recursive=1`, `the ${sub.path} submodule`)).json();
      const as = sub.path.slice(dir.length);
      for (const t of tree.tree || []) if (t.type === 'blob' && SOURCE.test(t.path) && !/\.ino$/i.test(t.path)) fetches.push({ g: sg, path: t.path, as: as + '/' + t.path });
      modules.push(`${as} (${at.owner}/${at.repo})`);
    }
  }
  if (fetches.length > MAX_FILES) throw new GitHubError(`That sketch has ${fetches.length} source files, more than the playground opens (${MAX_FILES}).`);
  const files = {};
  const texts = await Promise.all(fetches.map(f => get(rawUrl(f.g, f.path), f.as).then(r => r.text())));
  fetches.forEach((f, i) => { files[f.as] = texts[i].replace(/\r\n?/g, '\n'); });
  return {
    files,
    main: base,
    name: base.replace(/\.ino$/i, ''),
    submodules: modules,
    url: `https://github.com/${g.owner}/${g.repo}/blob/${g.ref}/${dir}${base}`,
  };
}
