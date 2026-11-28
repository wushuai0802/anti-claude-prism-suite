/**
 * Anti-Claude — core/ms-lnk.mjs
 * Clean-Room MIT pure-Node binary codec for Windows Shell Link (.lnk) files,
 * implemented directly from Microsoft's open [MS-SHLLINK] Binary File Format specification.
 *
 * Eliminates PowerShell / legacy script-host COM spawning when inspecting or
 * updating shortcut arguments, avoiding EDR/AV false-positive heuristics on Windows.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const LNK_HEADER_SIZE = 0x0000004c; // 76 bytes

// LinkCLSID = 00021401-0000-0000-C000-000000000046 (little-endian GUID layout)
export const LNK_CLSID_BYTES = Buffer.from([
  0x01, 0x14, 0x02, 0x00,
  0x00, 0x00,
  0x00, 0x00,
  0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46
]);

export const LNK_FLAGS = Object.freeze({
  HasLinkTargetIDList: 0x00000001,
  HasLinkInfo: 0x00000002,
  HasName: 0x00000004,
  HasRelativePath: 0x00000008,
  HasWorkingDir: 0x00000010,
  HasArguments: 0x00000020,
  HasIconLocation: 0x00000040,
  IsUnicode: 0x00000080,
  HasExpString: 0x00000200
});

const LINK_INFO_VOLUME_AND_LOCAL_BASE_PATH = 0x00000001;
const EXTRA_ENVIRONMENT_PROPS_SIG = 0xa0000001;

function lookupEnvCaseInsensitive(env, name) {
  if (!env || typeof env !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(env, name) && env[name] !== undefined) {
    return String(env[name]);
  }
  const upper = name.toUpperCase();
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === upper && env[key] !== undefined) {
      return String(env[key]);
    }
  }
  return undefined;
}

export function expandWindowsEnvVars(input, env = process.env) {
  const raw = String(input ?? '');
  if (!raw.includes('%')) return raw;
  return raw.replace(/%([A-Za-z0-9_()-]+)%/g, (full, varName) => {
    const val = lookupEnvCaseInsensitive(env, varName);
    if (val !== undefined && val !== '') return val;
    if (varName.toUpperCase() === 'USERPROFILE') {
      try {
        return os.homedir();
      } catch {}
    }
    return full;
  });
}

function readNullTermUtf16LE(buf, startOffset) {
  if (startOffset < 0 || startOffset + 1 >= buf.length) return '';
  let end = startOffset;
  while (end + 1 < buf.length) {
    if (buf[end] === 0 && buf[end + 1] === 0) break;
    end += 2;
  }
  return buf.subarray(startOffset, end).toString('utf16le');
}

function readNullTermAnsi(buf, startOffset) {
  if (startOffset < 0 || startOffset >= buf.length) return '';
  let end = startOffset;
  while (end < buf.length && buf[end] !== 0) {
    end += 1;
  }
  return buf.subarray(startOffset, end).toString('latin1');
}

function encodeCountedString(value, isUnicode) {
  const str = String(value ?? '');
  if (isUnicode) {
    const body = Buffer.from(str, 'utf16le');
    const charCount = body.length >>> 1;
    if (charCount > 0xffff) {
      throw new RangeError('Shortcut StringData exceeds uint16 character limit');
    }
    const hdr = Buffer.allocUnsafe(2);
    hdr.writeUInt16LE(charCount, 0);
    return Buffer.concat([hdr, body]);
  }
  const body = Buffer.from(str, 'latin1');
  if (body.length > 0xffff) {
    throw new RangeError('Shortcut ANSI StringData exceeds uint16 character limit');
  }
  const hdr = Buffer.allocUnsafe(2);
  hdr.writeUInt16LE(body.length, 0);
  return Buffer.concat([hdr, body]);
}

/**
 * Parse a Windows .lnk binary buffer per [MS-SHLLINK] Sections 2.1 - 2.5.
 */
export function parseWindowsLnkBuffer(rawBuf, { filePath = '' } = {}) {
  const emptyFail = (error) => ({
    ok: false,
    error,
    targetPath: '',
    workingDir: '',
    arguments: '',
    iconLocation: '',
    name: '',
    relativePath: ''
  });

  if (!rawBuf || (!Buffer.isBuffer(rawBuf) && !(rawBuf instanceof Uint8Array))) {
    return emptyFail('invalid_buffer');
  }
  const buf = Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf);
  if (buf.length < LNK_HEADER_SIZE) {
    return emptyFail('header_too_short');
  }

  const headerSize = buf.readUInt32LE(0);
  if (headerSize !== LNK_HEADER_SIZE) {
    return emptyFail('invalid_header_size');
  }
  if (!buf.subarray(4, 20).equals(LNK_CLSID_BYTES)) {
    return emptyFail('invalid_clsid');
  }

  const flags = buf.readUInt32LE(20);
  const isUnicode = Boolean(flags & LNK_FLAGS.IsUnicode);
  let pos = LNK_HEADER_SIZE;

  // Section 2.2: LinkTargetIDList
  if (flags & LNK_FLAGS.HasLinkTargetIDList) {
    if (pos + 2 > buf.length) return emptyFail('truncated_idlist_header');
    const idListSize = buf.readUInt16LE(pos);
    if (pos + 2 + idListSize > buf.length) return emptyFail('truncated_idlist_body');
    pos += 2 + idListSize;
  }

  // Section 2.3: LinkInfo
  let targetPath = '';
  if (flags & LNK_FLAGS.HasLinkInfo) {
    if (pos + 4 > buf.length) return emptyFail('truncated_linkinfo_size');
    const linkInfoSize = buf.readUInt32LE(pos);
    if (linkInfoSize < 0x1c || pos + linkInfoSize > buf.length) {
      return emptyFail('truncated_linkinfo_body');
    }
    const infoBuf = buf.subarray(pos, pos + linkInfoSize);
    const linkInfoHeaderSize = infoBuf.readUInt32LE(4);
    const linkInfoFlags = infoBuf.readUInt32LE(8);

    if (linkInfoFlags & LINK_INFO_VOLUME_AND_LOCAL_BASE_PATH) {
      let basePath = '';
      let suffix = '';
      if (linkInfoHeaderSize >= 0x24 && infoBuf.length >= 0x24) {
        const localBaseOffsetUni = infoBuf.readUInt32LE(28);
        const suffixOffsetUni = infoBuf.readUInt32LE(32);
        if (localBaseOffsetUni >= 0x24 && localBaseOffsetUni < infoBuf.length) {
          basePath = readNullTermUtf16LE(infoBuf, localBaseOffsetUni);
        }
        if (suffixOffsetUni >= 0x24 && suffixOffsetUni < infoBuf.length) {
          suffix = readNullTermUtf16LE(infoBuf, suffixOffsetUni);
        }
      }
      if (!basePath) {
        const localBaseOffset = infoBuf.readUInt32LE(16);
        const suffixOffset = infoBuf.readUInt32LE(24);
        if (localBaseOffset >= 0x1c && localBaseOffset < infoBuf.length) {
          basePath = readNullTermAnsi(infoBuf, localBaseOffset);
        }
        if (!suffix && suffixOffset >= 0x1c && suffixOffset < infoBuf.length) {
          suffix = readNullTermAnsi(infoBuf, suffixOffset);
        }
      }
      if (basePath) {
        targetPath = `${basePath}${suffix}`;
      }
    }
    pos += linkInfoSize;
  }

  // Section 2.4: StringData (strict specification order)
  const stringDataStart = pos;
  const readStringField = () => {
    if (pos + 2 > buf.length) return null;
    const countChars = buf.readUInt16LE(pos);
    pos += 2;
    const byteLen = isUnicode ? countChars * 2 : countChars;
    if (pos + byteLen > buf.length) return null;
    const text = buf.subarray(pos, pos + byteLen).toString(isUnicode ? 'utf16le' : 'latin1').replace(/\0+$/, '');
    pos += byteLen;
    return text;
  };

  let name = '';
  let relativePath = '';
  let workingDir = '';
  let args = '';
  let iconLocation = '';

  if (flags & LNK_FLAGS.HasName) {
    const v = readStringField();
    if (v === null) return emptyFail('truncated_string_name');
    name = v;
  }
  if (flags & LNK_FLAGS.HasRelativePath) {
    const v = readStringField();
    if (v === null) return emptyFail('truncated_string_relative_path');
    relativePath = v;
  }
  if (flags & LNK_FLAGS.HasWorkingDir) {
    const v = readStringField();
    if (v === null) return emptyFail('truncated_string_working_dir');
    workingDir = v;
  }
  const argsOffsetStart = pos;
  if (flags & LNK_FLAGS.HasArguments) {
    const v = readStringField();
    if (v === null) return emptyFail('truncated_string_arguments');
    args = v;
  }
  const argsOffsetEnd = pos;
  if (flags & LNK_FLAGS.HasIconLocation) {
    const v = readStringField();
    if (v === null) return emptyFail('truncated_string_icon_location');
    iconLocation = v;
  }
  const stringDataEnd = pos;

  // Section 2.5: ExtraData — inspect EnvironmentVariableDataBlock (0xA0000001) if targetPath not in LinkInfo
  if (!targetPath) {
    let extraPos = pos;
    while (extraPos + 4 <= buf.length) {
      const blockSize = buf.readUInt32LE(extraPos);
      if (blockSize < 4 || extraPos + blockSize > buf.length) break;
      if (blockSize >= 0x00000314 && extraPos + 8 <= buf.length) {
        const sig = buf.readUInt32LE(extraPos + 4);
        if (sig === EXTRA_ENVIRONMENT_PROPS_SIG) {
          const blockSlice = buf.subarray(extraPos, extraPos + blockSize);
          const uniTarget = readNullTermUtf16LE(blockSlice, 268);
          const ansiTarget = uniTarget ? '' : readNullTermAnsi(blockSlice.subarray(0, Math.min(blockSlice.length, 268)), 8);
          if (uniTarget || ansiTarget) {
            targetPath = uniTarget || ansiTarget;
            break;
          }
        }
      }
      extraPos += blockSize;
    }
  }

  if (!targetPath && relativePath) {
    const cleanFilePath = typeof filePath === 'string' ? filePath.trim() : '';
    if (cleanFilePath) {
      targetPath = path.win32.resolve(path.win32.dirname(cleanFilePath), relativePath);
    } else if (workingDir) {
      targetPath = path.win32.resolve(workingDir, relativePath);
    }
  }

  return {
    ok: true,
    targetPath,
    workingDir,
    arguments: args,
    iconLocation,
    name,
    relativePath,
    flags,
    isUnicode,
    _spans: {
      stringDataStart,
      stringDataEnd,
      argsOffsetStart,
      argsOffsetEnd
    }
  };
}

/**
 * Losslessly splice COMMAND_LINE_ARGUMENTS inside an existing [MS-SHLLINK] .lnk buffer
 * while preserving IDList, LinkInfo, IconLocation, and all ExtraData blocks intact.
 */
export function updateWindowsLnkArguments(rawBuf, nextArguments = '') {
  const buf = Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf);
  const parsed = parseWindowsLnkBuffer(buf);
  if (!parsed.ok) {
    throw new Error(`Invalid .lnk file (${parsed.error})`);
  }

  const nextArgs = String(nextArguments ?? '');
  if (nextArgs.length > 32767) {
    throw new RangeError('Shortcut arguments exceed maximum safe length');
  }

  const needsUnicodeUpgrade = !parsed.isUnicode && /[^\x20-\x7e]/.test(nextArgs);
  if (!needsUnicodeUpgrade) {
    const prefix = Buffer.from(buf.subarray(0, parsed._spans.argsOffsetStart));
    const suffix = buf.subarray(parsed._spans.argsOffsetEnd);
    const nextFlags = nextArgs.length > 0
      ? ((parsed.flags | LNK_FLAGS.HasArguments) >>> 0)
      : ((parsed.flags & ~LNK_FLAGS.HasArguments) >>> 0);
    prefix.writeUInt32LE(nextFlags, 20);
    if (nextArgs.length === 0) {
      return Buffer.concat([prefix, suffix]);
    }
    const encodedArg = encodeCountedString(nextArgs, parsed.isUnicode);
    return Buffer.concat([prefix, encodedArg, suffix]);
  }

  // Rare legacy ANSI .lnk receiving Unicode arguments: refuse if existing ANSI fields hold non-ASCII codepage bytes
  if ([parsed.name, parsed.relativePath, parsed.workingDir, parsed.iconLocation].some((s) => /[\x80-\xff]/.test(s))) {
    throw new Error('Refusing lossy ANSI-to-Unicode shortcut upgrade on non-ASCII codepage fields');
  }
  const prefix = Buffer.from(buf.subarray(0, parsed._spans.stringDataStart));
  const suffix = buf.subarray(parsed._spans.stringDataEnd);
  let nextFlags = (parsed.flags | LNK_FLAGS.IsUnicode) >>> 0;
  nextFlags = nextArgs.length > 0
    ? ((nextFlags | LNK_FLAGS.HasArguments) >>> 0)
    : ((nextFlags & ~LNK_FLAGS.HasArguments) >>> 0);
  prefix.writeUInt32LE(nextFlags, 20);

  const chunks = [prefix];
  if (nextFlags & LNK_FLAGS.HasName) chunks.push(encodeCountedString(parsed.name, true));
  if (nextFlags & LNK_FLAGS.HasRelativePath) chunks.push(encodeCountedString(parsed.relativePath, true));
  if (nextFlags & LNK_FLAGS.HasWorkingDir) chunks.push(encodeCountedString(parsed.workingDir, true));
  if (nextFlags & LNK_FLAGS.HasArguments) chunks.push(encodeCountedString(nextArgs, true));
  if (nextFlags & LNK_FLAGS.HasIconLocation) chunks.push(encodeCountedString(parsed.iconLocation, true));
  chunks.push(suffix);
  return Buffer.concat(chunks);
}

export function readWindowsShortcutInfo(filePath, { env = process.env } = {}) {
  try {
    const raw = fs.readFileSync(filePath);
    const parsed = parseWindowsLnkBuffer(raw, { filePath });
    if (!parsed.ok) {
      return { ...parsed, filePath };
    }
    return {
      ok: true,
      filePath,
      targetPath: expandWindowsEnvVars(parsed.targetPath, env),
      workingDir: expandWindowsEnvVars(parsed.workingDir, env),
      arguments: parsed.arguments,
      iconLocation: expandWindowsEnvVars(parsed.iconLocation, env),
      name: parsed.name,
      relativePath: parsed.relativePath
    };
  } catch (err) {
    return {
      ok: false,
      filePath,
      error: String(err?.code || err?.message || 'read_failed'),
      targetPath: '',
      workingDir: '',
      arguments: '',
      iconLocation: '',
      name: '',
      relativePath: ''
    };
  }
}

export function writeWindowsShortcutArguments(filePath, nextArguments = '') {
  const lst = fs.lstatSync(filePath);
  if (lst.isSymbolicLink() || !lst.isFile()) {
    throw new Error(`Refusing to modify non-regular shortcut file: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath);
  const updated = updateWindowsLnkArguments(raw, nextArguments);
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.lnk-tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.writeFileSync(tmpPath, updated, { flag: 'wx' });
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {}
    throw err;
  }
}

function queryRegShellFolderValue(valueName, env, execRegFn) {
  const runReg = execRegFn || ((args) => execFileSync('reg.exe', args, {
    encoding: 'utf8',
    timeout: 2500,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore']
  }));
  if (!execRegFn && process.platform !== 'win32') return '';
  try {
    const out = String(
      runReg([
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
        '/v',
        valueName
      ]) || ''
    );
    for (const rawLine of out.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const m = line.match(new RegExp(`^${valueName}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)$`, 'i'));
      if (m && m[1]) {
        return expandWindowsEnvVars(m[1].trim(), env);
      }
    }
  } catch {}
  return '';
}

/**
 * Resolve Windows user Desktop (including relocated D:\Desktop or OneDrive Desktop via
 * HKCU\...\User Shell Folders) and Start Menu Programs directories.
 */
export function resolveWindowsShortcutRoots(
  env = process.env,
  { includeCommon = false, execRegFn = null, existsFn = fs.existsSync } = {}
) {
  const candidates = [];
  const userProfile = lookupEnvCaseInsensitive(env, 'USERPROFILE') || os.homedir();
  const appData = lookupEnvCaseInsensitive(env, 'APPDATA') || (userProfile ? path.win32.join(userProfile, 'AppData', 'Roaming') : '');
  const oneDrive = lookupEnvCaseInsensitive(env, 'OneDriveConsumer') || lookupEnvCaseInsensitive(env, 'OneDrive') || '';

  const regDesktop = queryRegShellFolderValue('Desktop', env, execRegFn);
  if (regDesktop) candidates.push(regDesktop);
  const regPrograms = queryRegShellFolderValue('Programs', env, execRegFn);
  if (regPrograms) candidates.push(regPrograms);

  if (userProfile) {
    candidates.push(path.win32.join(userProfile, 'Desktop'));
  }
  if (oneDrive) {
    candidates.push(path.win32.join(oneDrive, 'Desktop'));
  }
  if (appData) {
    candidates.push(path.win32.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  }

  if (includeCommon) {
    const pub = lookupEnvCaseInsensitive(env, 'PUBLIC') || 'C:\\Users\\Public';
    const progData = lookupEnvCaseInsensitive(env, 'PROGRAMDATA') || 'C:\\ProgramData';
    if (pub) candidates.push(path.win32.join(pub, 'Desktop'));
    if (progData) candidates.push(path.win32.join(progData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  }

  const out = [];
  const seen = new Set();
  for (const raw of candidates) {
    const cleaned = String(raw || '').trim();
    if (!cleaned) continue;
    const key = cleaned.replace(/[\\/]+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    try {
      if (existsFn(cleaned)) {
        seen.add(key);
        out.push(cleaned);
      }
    } catch {}
  }
  return out;
}
