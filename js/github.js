/*
 * Open sketches from GitHub: a repository, a folder in one, a .ino file, or a raw file link.
 * Public repositories only; it uses GitHub's API without signing in (60 requests an hour).
 *
 * Arduino sketches are folders: the .ino named after the folder comes first, then the folder's
 * other .ino files in name order, and `#include "x.h"` pulls in local headers. The playground
 * runs one file, so they're combined into one in that order, with headers inlined.
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
  return { ref, paths: (tree.tree || []).filter(t => t.type === 'blob').map(t => t.path), truncated: !!tree.truncated };
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
// `paths` (all files in the repo) is optional; without it only the one file is loaded.
export async function loadSketch(g, path, paths) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const base = path.slice(dir.length);
  const inFolder = paths ? paths.filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/')) : [path];
  const isMain = isMainSketch(path, g.repo);
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
