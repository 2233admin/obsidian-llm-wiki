#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn2, res, err2) => function __init() {
  if (err2) throw err2[0];
  try {
    return fn2 && (res = (0, fn2[__getOwnPropNames(fn2)[0]])(fn2 = 0)), res;
  } catch (e) {
    throw err2 = [e], e;
  }
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// dist/embedding/profile.js
import { createHash as createHash2 } from "node:crypto";
function resolveEmbeddingProfile(options = {}) {
  const requestedId = options.profileId ?? options.defaultProfileId ?? "ollama/bge-m3";
  const builtIn = isBuiltInEmbeddingProfileId(requestedId) ? BUILT_IN_EMBEDDING_PROFILES[requestedId] : void 0;
  const endpoint = normalizeEmbeddingEndpoint(options.endpoint ?? builtIn?.endpoint ?? DEFAULT_ENDPOINT);
  const model = nonEmpty(options.model ?? builtIn?.model, "embedding model");
  const dimensions = options.dimensions ?? builtIn?.dimensions;
  if (dimensions !== void 0 && (!Number.isInteger(dimensions) || dimensions <= 0)) {
    throw new Error("embedding dimensions must be a positive integer");
  }
  const isUnmodifiedBuiltIn = Boolean(builtIn && model === builtIn.model && endpoint === builtIn.endpoint);
  return {
    schemaVersion: EMBEDDING_PROFILE_SCHEMA_VERSION,
    id: isUnmodifiedBuiltIn ? builtIn.id : requestedId.startsWith("custom/") ? requestedId : "custom/" + (options.provider ?? builtIn?.provider ?? "openai-compatible") + "/" + model,
    provider: options.provider ?? builtIn?.provider ?? "openai-compatible",
    endpoint,
    model,
    ...dimensions === void 0 ? {} : { dimensions },
    adapterSchemaVersion: EMBEDDING_ADAPTER_SCHEMA_VERSION,
    builtIn: isUnmodifiedBuiltIn
  };
}
function embeddingFingerprint(profile) {
  const canonical = {
    schemaVersion: profile.schemaVersion,
    profileId: profile.id,
    provider: profile.provider,
    endpoint: normalizeEmbeddingEndpoint(profile.endpoint),
    model: profile.model,
    ...profile.dimensions === void 0 ? {} : { dimensions: profile.dimensions },
    adapterSchemaVersion: profile.adapterSchemaVersion
  };
  const digest = "sha256:" + createHash2("sha256").update(JSON.stringify(canonical)).digest("hex");
  return { ...canonical, digest };
}
function embeddingFingerprintsMatch(left, right) {
  return left.digest === right.digest;
}
function validateEmbeddingVector(vector, profile) {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("embedding vector must contain only finite numbers");
  }
  if (profile.dimensions !== void 0 && vector.length !== profile.dimensions) {
    throw new Error("embedding vector dimension mismatch: profile " + profile.id + " expects " + profile.dimensions + ", received " + vector.length);
  }
}
function normalizeEmbeddingEndpoint(value) {
  const raw = nonEmpty(value, "embedding endpoint");
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("embedding endpoint must use HTTP(S)");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("embedding endpoint must not contain credentials, query parameters, or fragments");
  }
  url.pathname = normalizeEmbeddingPath(url.pathname);
  return url.toString().replace(/\/$/, "");
}
function isBuiltInEmbeddingProfileId(value) {
  return Object.prototype.hasOwnProperty.call(BUILT_IN_EMBEDDING_PROFILES, value);
}
function normalizeEmbeddingPath(pathname) {
  const trimmed = pathname.replace(/\/+$/, "");
  if (!trimmed || trimmed === "/")
    return "/v1/embeddings";
  if (trimmed === "/v1")
    return "/v1/embeddings";
  return trimmed;
}
function nonEmpty(value, label) {
  const normalized = value?.trim();
  if (!normalized)
    throw new Error(label + " must be non-empty");
  return normalized;
}
var EMBEDDING_PROFILE_SCHEMA_VERSION, EMBEDDING_ADAPTER_SCHEMA_VERSION, DEFAULT_ENDPOINT, BUILT_IN_EMBEDDING_PROFILES;
var init_profile = __esm({
  "dist/embedding/profile.js"() {
    "use strict";
    EMBEDDING_PROFILE_SCHEMA_VERSION = 1;
    EMBEDDING_ADAPTER_SCHEMA_VERSION = "openai-compatible/v1";
    DEFAULT_ENDPOINT = "http://localhost:11434/v1/embeddings";
    BUILT_IN_EMBEDDING_PROFILES = Object.freeze({
      "ollama/bge-m3": Object.freeze({
        schemaVersion: EMBEDDING_PROFILE_SCHEMA_VERSION,
        id: "ollama/bge-m3",
        provider: "ollama",
        endpoint: DEFAULT_ENDPOINT,
        model: "bge-m3",
        dimensions: 1024,
        adapterSchemaVersion: EMBEDDING_ADAPTER_SCHEMA_VERSION,
        builtIn: true
      }),
      "ollama/qwen3-embedding:0.6b": Object.freeze({
        schemaVersion: EMBEDDING_PROFILE_SCHEMA_VERSION,
        id: "ollama/qwen3-embedding:0.6b",
        provider: "ollama",
        endpoint: DEFAULT_ENDPOINT,
        model: "qwen3-embedding:0.6b",
        dimensions: 1024,
        adapterSchemaVersion: EMBEDDING_ADAPTER_SCHEMA_VERSION,
        builtIn: true
      })
    });
  }
});

// node_modules/@electric-sql/pglite/dist/chunk-QY3QWFKW.js
var p, i2, c, f, l, s, a, _, d, D, F, g, L, P, n, h, R, x, T, U, u;
var init_chunk_QY3QWFKW = __esm({
  "node_modules/@electric-sql/pglite/dist/chunk-QY3QWFKW.js"() {
    p = Object.create;
    i2 = Object.defineProperty;
    c = Object.getOwnPropertyDescriptor;
    f = Object.getOwnPropertyNames;
    l = Object.getPrototypeOf;
    s = Object.prototype.hasOwnProperty;
    a = (t3) => {
      throw TypeError(t3);
    };
    _ = (t3, e, o5) => e in t3 ? i2(t3, e, { enumerable: true, configurable: true, writable: true, value: o5 }) : t3[e] = o5;
    d = (t3, e) => () => (t3 && (e = t3(t3 = 0)), e);
    D = (t3, e) => () => (e || t3((e = { exports: {} }).exports, e), e.exports);
    F = (t3, e) => {
      for (var o5 in e) i2(t3, o5, { get: e[o5], enumerable: true });
    };
    g = (t3, e, o5, m5) => {
      if (e && typeof e == "object" || typeof e == "function") for (let r of f(e)) !s.call(t3, r) && r !== o5 && i2(t3, r, { get: () => e[r], enumerable: !(m5 = c(e, r)) || m5.enumerable });
      return t3;
    };
    L = (t3, e, o5) => (o5 = t3 != null ? p(l(t3)) : {}, g(e || !t3 || !t3.__esModule ? i2(o5, "default", { value: t3, enumerable: true }) : o5, t3));
    P = (t3, e, o5) => _(t3, typeof e != "symbol" ? e + "" : e, o5);
    n = (t3, e, o5) => e.has(t3) || a("Cannot " + o5);
    h = (t3, e, o5) => (n(t3, e, "read from private field"), o5 ? o5.call(t3) : e.get(t3));
    R = (t3, e, o5) => e.has(t3) ? a("Cannot add the same private member more than once") : e instanceof WeakSet ? e.add(t3) : e.set(t3, o5);
    x = (t3, e, o5, m5) => (n(t3, e, "write to private field"), m5 ? m5.call(t3, o5) : e.set(t3, o5), o5);
    T = (t3, e, o5) => (n(t3, e, "access private method"), o5);
    U = (t3, e, o5, m5) => ({ set _(r) {
      x(t3, e, r, o5);
    }, get _() {
      return h(t3, e, m5);
    } });
    u = d(() => {
      "use strict";
    });
  }
});

// node_modules/@electric-sql/pglite/dist/chunk-VVBUWNGP.js
function h2() {
  let t3 = process.type;
  return t3 === "renderer" || t3 === "worker" || t3 === "service-worker";
}
async function c2(t3) {
  s2 || a2.has(t3.toString()) || a2.set(t3.toString(), fetch(t3));
}
async function b(t3, e, r) {
  if (r || o.has(e.toString())) {
    let i3 = r || o.get(e.toString());
    return { instance: await WebAssembly.instantiate(i3, t3), module: i3 };
  }
  if (s2) {
    let i3 = await (await import("fs/promises")).readFile(e), { module: n3, instance: l2 } = await WebAssembly.instantiate(i3, t3);
    return o.set(e.toString(), n3), { instance: l2, module: n3 };
  } else {
    a2.has(e.toString()) || c2(e);
    let i3 = await a2.get(e.toString()), { module: n3, instance: l2 } = await WebAssembly.instantiateStreaming(i3.clone(), t3);
    return o.set(e.toString(), n3), { instance: l2, module: n3 };
  }
}
async function w(t3) {
  return s2 ? (await (await import("fs/promises")).readFile(t3)).buffer : (c2(t3), (await a2.get(t3.toString())).clone().arrayBuffer());
}
function v(t3) {
  let e;
  return t3.startsWith('"') && t3.endsWith('"') ? e = t3.substring(1, t3.length - 1) : e = t3.toLowerCase(), e;
}
function u2(t3, e) {
  try {
    let r = t3.readdir(e).filter((i3) => i3 !== "." && i3 !== "..");
    for (let i3 of r) {
      let n3 = e + "/" + i3;
      try {
        t3.readdir(n3), u2(t3, n3);
      } catch {
        t3.unlink(n3);
      }
    }
    t3.rmdir(e);
  } catch {
    try {
      t3.unlink(e);
    } catch {
    }
  }
}
var d2, f2, p2, s2, m, a2, o, y, S;
var init_chunk_VVBUWNGP = __esm({
  "node_modules/@electric-sql/pglite/dist/chunk-VVBUWNGP.js"() {
    init_chunk_QY3QWFKW();
    u();
    d2 = Object.defineProperty;
    f2 = (t3, e) => {
      for (var r in e) d2(t3, r, { get: e[r], enumerable: true });
    };
    p2 = {};
    f2(p2, { IN_NODE: () => s2, WASM_PREFIX: () => m, getFsBundle: () => w, instantiateWasm: () => b, pgliteProc: () => y, rmdirRecursive: () => u2, startArtifactDownload: () => c2, toPostgresName: () => v, uuid: () => S });
    s2 = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string" && !h2();
    m = "/pglite";
    a2 = /* @__PURE__ */ new Map();
    o = /* @__PURE__ */ new Map();
    y = globalThis && typeof globalThis.process < "u" ? globalThis.process : { exitCode: void 0 };
    S = () => {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
      let t3 = new Uint8Array(16);
      if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(t3);
      else for (let r = 0; r < t3.length; r++) t3[r] = Math.floor(Math.random() * 256);
      t3[6] = t3[6] & 15 | 64, t3[8] = t3[8] & 63 | 128;
      let e = [];
      return t3.forEach((r) => {
        e.push(r.toString(16).padStart(2, "0"));
      }), e.slice(0, 4).join("") + "-" + e.slice(4, 6).join("") + "-" + e.slice(6, 8).join("") + "-" + e.slice(8, 10).join("") + "-" + e.slice(10).join("");
    };
  }
});

// node_modules/@electric-sql/pglite/dist/chunk-TDKVRJ2S.js
async function ue(e, r, t3 = "pgdata", n3 = "auto") {
  let o5 = Tr(e, r), [a3, s5] = await Mr(o5, n3), l2 = t3 + (s5 ? ".tar.gz" : ".tar"), u3 = s5 ? "application/x-gzip" : "application/x-tar";
  return typeof File < "u" ? new File([a3], l2, { type: u3 }) : new Blob([a3], { type: u3 });
}
async function at(e, r, t3) {
  let n3 = new Uint8Array(await r.arrayBuffer()), o5 = typeof File < "u" && r instanceof File ? r.name : void 0;
  (Ar.includes(r.type) || o5?.endsWith(".tgz") || o5?.endsWith(".tar.gz")) && (n3 = await De(n3));
  let s5;
  try {
    s5 = (0, D2.untar)(n3);
  } catch (l2) {
    if (l2 instanceof Error && l2.message.includes("File is corrupted")) n3 = await De(n3), s5 = (0, D2.untar)(n3);
    else throw l2;
  }
  for (let l2 of s5) {
    let u3 = `${t3}/${l2.name}`, d3 = u3.split("/").slice(0, -1);
    for (let c4 = 1; c4 <= d3.length; c4++) {
      let p6 = d3.slice(0, c4).join("/");
      e.analyzePath(p6).exists || e.mkdir(p6);
    }
    l2.type === D2.REGTYPE ? (e.writeFile(u3, l2.data), e.utime(u3, Ne(l2.modifyTime), Ne(l2.modifyTime))) : l2.type === D2.DIRTYPE && (e.analyzePath(u3).exists || e.mkdir(u3));
  }
}
function br(e, r) {
  let t3 = [], n3 = (o5) => {
    e.readdir(o5).forEach((s5) => {
      if (s5 === "." || s5 === "..") return;
      let l2 = o5 + "/" + s5, u3 = e.stat(l2), d3 = e.isFile(u3.mode) ? e.readFile(l2, { encoding: "binary" }) : new Uint8Array(0);
      t3.push({ name: l2.substring(r.length), mode: u3.mode, size: u3.size, type: e.isFile(u3.mode) ? D2.REGTYPE : D2.DIRTYPE, modifyTime: u3.mtime, data: d3 }), e.isDir(u3.mode) && n3(l2);
    });
  };
  return n3(r), t3;
}
function Tr(e, r) {
  let t3 = br(e, r);
  return (0, D2.tar)(t3);
}
async function Mr(e, r = "auto") {
  if (r === "none") return [e, false];
  if (typeof CompressionStream < "u") return [await Pr(e), true];
  if (typeof process < "u" && process.versions && process.versions.node) return [await kr(e), true];
  if (r === "auto") return [e, false];
  throw new Error("Compression not supported in this environment");
}
async function Pr(e) {
  let r = new CompressionStream("gzip"), t3 = r.writable.getWriter(), n3 = r.readable.getReader();
  t3.write(e), t3.close();
  let o5 = [];
  for (; ; ) {
    let { value: l2, done: u3 } = await n3.read();
    if (u3) break;
    l2 && o5.push(l2);
  }
  let a3 = new Uint8Array(o5.reduce((l2, u3) => l2 + u3.length, 0)), s5 = 0;
  return o5.forEach((l2) => {
    a3.set(l2, s5), s5 += l2.length;
  }), a3;
}
async function kr(e) {
  let { promisify: r } = await import("util"), { gzip: t3 } = await import("zlib");
  return await r(t3)(e);
}
async function De(e) {
  if (typeof CompressionStream < "u") return await Or(e);
  if (typeof process < "u" && process.versions && process.versions.node) return await Rr(e);
  throw new Error("Unsupported environment for decompression");
}
async function Or(e) {
  let r = new DecompressionStream("gzip"), t3 = r.writable.getWriter(), n3 = r.readable.getReader();
  t3.write(e), t3.close();
  let o5 = [];
  for (; ; ) {
    let { value: l2, done: u3 } = await n3.read();
    if (u3) break;
    l2 && o5.push(l2);
  }
  let a3 = new Uint8Array(o5.reduce((l2, u3) => l2 + u3.length, 0)), s5 = 0;
  return o5.forEach((l2) => {
    a3.set(l2, s5), s5 += l2.length;
  }), a3;
}
async function Rr(e) {
  let { promisify: r } = await import("util"), { gunzip: t3 } = await import("zlib");
  return await r(t3)(e);
}
function Ne(e) {
  return e ? typeof e == "number" ? e : Math.floor(e.getTime() / 1e3) : Math.floor(Date.now() / 1e3);
}
function Lr(e, r) {
  let t3 = r.lastIndex, n3 = [], o5;
  for (; o5 = r.exec(e); ) n3.push(o5), r.lastIndex === o5.index && (r.lastIndex += 1);
  return r.lastIndex = t3, n3;
}
function Cr(e, r, t3) {
  let n3 = typeof e == "function" ? e(t3) : e[t3];
  return typeof n3 > "u" && t3 !== "" ? n3 = "" : typeof n3 > "u" && (n3 = "$"), typeof n3 == "object" ? r + C + JSON.stringify(n3) + C : r + n3;
}
function Br(e, r, t3) {
  t3 || (t3 = {});
  let n3 = t3.escape || "\\", o5 = "(\\" + n3 + `['"` + He + `]|[^\\s'"` + He + "])+", a3 = new RegExp(["(" + Be + ")", "(" + o5 + "|" + Nr + "|" + xr + ")+"].join("|"), "g"), s5 = Lr(e, a3);
  if (s5.length === 0) return [];
  r || (r = {});
  let l2 = false;
  return s5.map(function(u3) {
    let d3 = u3[0];
    if (!d3 || l2) return;
    if (Ue.test(d3)) return { op: d3 };
    let c4 = false, p6 = false, f5 = "", m5 = false, _4;
    function g4() {
      _4 += 1;
      let E3, y5, A3 = d3.charAt(_4);
      if (A3 === "{") {
        if (_4 += 1, d3.charAt(_4) === "}") throw new Error("Bad substitution: " + d3.slice(_4 - 2, _4 + 1));
        if (E3 = d3.indexOf("}", _4), E3 < 0) throw new Error("Bad substitution: " + d3.slice(_4));
        y5 = d3.slice(_4, E3), _4 = E3;
      } else if (/[*@#?$!_-]/.test(A3)) y5 = A3, _4 += 1;
      else {
        let S5 = d3.slice(_4), v5 = S5.match(/[^\w\d_]/);
        v5 ? (y5 = S5.slice(0, v5.index), _4 += v5.index - 1) : (y5 = S5, _4 = d3.length);
      }
      return Cr(r, "", y5);
    }
    for (_4 = 0; _4 < d3.length; _4++) {
      let E3 = d3.charAt(_4);
      if (m5 = m5 || !c4 && (E3 === "*" || E3 === "?"), p6) f5 += E3, p6 = false;
      else if (c4) E3 === c4 ? c4 = false : c4 === Le ? f5 += E3 : E3 === n3 ? (_4 += 1, E3 = d3.charAt(_4), E3 === Ce || E3 === n3 || E3 === de ? f5 += E3 : f5 += n3 + E3) : E3 === de ? f5 += g4() : f5 += E3;
      else if (E3 === Ce || E3 === Le) c4 = E3;
      else {
        if (Ue.test(E3)) return { op: d3 };
        if (Ir.test(E3)) {
          l2 = true;
          let y5 = { comment: e.slice(u3.index + _4 + 1) };
          return f5.length ? [f5, y5] : [y5];
        } else E3 === n3 ? p6 = true : E3 === de ? f5 += g4() : f5 += E3;
      }
    }
    return m5 ? { op: "glob", pattern: f5 } : f5;
  }).reduce(function(u3, d3) {
    return typeof d3 > "u" ? u3 : u3.concat(d3);
  }, []);
}
function ce(e, r, t3) {
  let n3 = Br(e, r, t3);
  return typeof r != "function" ? n3 : n3.reduce(function(o5, a3) {
    if (typeof a3 == "object") return o5.concat(a3);
    let s5 = a3.split(RegExp("(" + C + ".*?" + C + ")", "g"));
    return s5.length === 1 ? o5.concat(s5[0]) : o5.concat(s5.filter(Boolean).map(function(l2) {
      return Hr.test(l2) ? JSON.parse(l2.split(C)[1]) : l2;
    }));
  }, []);
}
function zr(e, r) {
  if (!e) throw new Error(r ?? "Assertion failed");
}
function Y(e, ...r) {
  e && e > 0 && console.log("initdb: ", ...r);
}
async function Wr({ pg: e, debug: r, args: t3, wasmModule: n3 }) {
  let o5, a3, s5, l2 = false, u3 = [], d3 = 0, c4 = -1, p6 = -1, f5 = "", m5 = "", _4 = (S5) => {
    let v5 = S5.shift();
    Y(r, "initdb: firstArg", v5), zr(v5 === "/pglite/bin/postgres", `trying to execute ${v5}`), e.Module.HEAPU8.set(g4), Y(r, "executing pg main with", S5);
    let h3 = e.callMain(S5);
    return Y(r, h3), u3 = [], h3;
  }, g4 = e.Module.HEAPU8.slice(), y5 = await Ie({ arguments: t3, noExitRuntime: false, thisProgram: Yr, stdin: () => null, print: (S5) => {
    m5 += S5, Y(r, "initdbout", S5);
  }, printErr: (S5) => {
    f5 += S5, Y(r, "initdberr", S5);
  }, instantiateWasm: (S5, v5) => {
    let h3 = new URL("./initdb.wasm", import.meta.url);
    return p2.instantiateWasm(S5, h3, n3).then(({ instance: b4, module: F4 }) => {
      v5(b4, F4);
    }), {};
  }, preRun: [(S5) => {
    S5.ENV.PGDATA = B, S5.ENV.HOME = "/home/postgres", S5.ENV.USER = "postgres", S5.ENV.LOGNAME = "postgres", S5.ENV.ICU_DATA = jr;
  }, (S5) => {
    S5.onRuntimeInitialized = () => {
      o5 = S5.addFunction((v5) => (u3 = Ye(S5.UTF8ToString(v5)), _4(u3)), "pi"), S5._pgl_set_system_fn(o5), a3 = S5.addFunction((v5, h3) => {
        let b4 = S5.UTF8ToString(h3);
        if (u3 = Ye(S5.UTF8ToString(v5)), b4 === "r") return d3 = _4(u3), c4;
        if (b4 === "w") return l2 = true, p6;
        throw `Unexpected popen mode value ${b4}`;
      }, "ppi"), S5._pgl_set_popen_fn(a3), s5 = S5.addFunction((v5) => v5 === c4 || v5 === p6 ? (l2 && (l2 = false, d3 = _4(u3)), d3) : S5._pclose(v5), "pi"), S5._pgl_set_pclose_fn(s5);
      {
        let v5 = e.Module.stringToUTF8OnStack(je), h3 = e.Module.stringToUTF8OnStack("r");
        e.Module._pgl_freopen(v5, h3, 0);
        let b4 = e.Module.stringToUTF8OnStack(ze), F4 = e.Module.stringToUTF8OnStack("w");
        e.Module._pgl_freopen(b4, F4, 1);
      }
      {
        let v5 = S5.stringToUTF8OnStack(ze), h3 = S5.stringToUTF8OnStack("r");
        c4 = S5._fopen(v5, h3);
        let b4 = S5.stringToUTF8OnStack(je), F4 = S5.stringToUTF8OnStack("w");
        p6 = S5._fopen(b4, F4);
      }
    };
  }, (S5) => {
    S5.FS.mkdir(I), S5.FS.mount(S5.PROXYFS, { root: I, fs: e.Module.FS }, I);
  }] });
  return Y(r, "calling initdb.main with", t3), { exitCode: y5.callMain(t3), stderr: f5, stdout: m5, dataFolder: B };
}
function Ye(e) {
  let r = [], t3 = ce(e);
  for (let n3 = 0; n3 < t3.length; n3++) {
    let o5 = t3[n3];
    if (typeof o5 == "object" && "op" in o5) break;
    typeof o5 == "string" && r.push(o5);
  }
  return r;
}
async function At({ pg: e, debug: r, args: t3, wasmModule: n3 }) {
  return await Wr({ pg: e, debug: r, args: ["--allow-group-access", "--encoding", "UTF8", "--locale=C.UTF-8", "--locale-provider=libc", "--auth=trust", ...t3 ?? []], wasmModule: n3 });
}
var W, G, ie, Me, ke, Re, D2, Ar, Dr, xe, Ie, Be, Ue, He, Nr, xr, Ir, Le, Ce, de, C, Ur, Hr, I, B, jr, Yr, wt, ze, je, We, Ge, Ve, Gr;
var init_chunk_TDKVRJ2S = __esm({
  "node_modules/@electric-sql/pglite/dist/chunk-TDKVRJ2S.js"() {
    init_chunk_VVBUWNGP();
    init_chunk_QY3QWFKW();
    W = D((Xr, M3) => {
      "use strict";
      u();
      var me3 = 9007199254740991, pe3 = /* @__PURE__ */ (function(e) {
        return e;
      })();
      function $e3(e) {
        return e === pe3;
      }
      function Se2(e) {
        return typeof e == "string" || Object.prototype.toString.call(e) == "[object String]";
      }
      function Ke3(e) {
        return Object.prototype.toString.call(e) == "[object Date]";
      }
      function q2(e) {
        return e !== null && typeof e == "object";
      }
      function $4(e) {
        return typeof e == "function";
      }
      function Je3(e) {
        return typeof e == "number" && e > -1 && e % 1 == 0 && e <= me3;
      }
      function Qe3(e) {
        return Object.prototype.toString.call(e) == "[object Array]";
      }
      function Ee3(e) {
        return q2(e) && !$4(e) && Je3(e.length);
      }
      function te(e) {
        return Object.prototype.toString.call(e) == "[object ArrayBuffer]";
      }
      function Ze3(e, r) {
        return Array.prototype.map.call(e, r);
      }
      function er(e, r) {
        var t3 = pe3;
        return $4(r) && Array.prototype.every.call(e, function(n3, o5, a3) {
          var s5 = r(n3, o5, a3);
          return s5 && (t3 = n3), !s5;
        }), t3;
      }
      function rr(e) {
        return Object.assign.apply(null, arguments);
      }
      function ge3(e) {
        var r, t3, n3;
        if (Se2(e)) {
          for (t3 = e.length, n3 = new Uint8Array(t3), r = 0; r < t3; r++) n3[r] = e.charCodeAt(r) & 255;
          return n3;
        }
        return te(e) ? new Uint8Array(e) : q2(e) && te(e.buffer) ? new Uint8Array(e.buffer) : Ee3(e) ? new Uint8Array(e) : q2(e) && $4(e.toString) ? ge3(e.toString()) : new Uint8Array();
      }
      M3.exports.MAX_SAFE_INTEGER = me3;
      M3.exports.isUndefined = $e3;
      M3.exports.isString = Se2;
      M3.exports.isObject = q2;
      M3.exports.isDateTime = Ke3;
      M3.exports.isFunction = $4;
      M3.exports.isArray = Qe3;
      M3.exports.isArrayLike = Ee3;
      M3.exports.isArrayBuffer = te;
      M3.exports.map = Ze3;
      M3.exports.find = er;
      M3.exports.extend = rr;
      M3.exports.toUint8Array = ge3;
    });
    G = D(($r, ve3) => {
      "use strict";
      u();
      var ne2 = "\0";
      ve3.exports = { NULL_CHAR: ne2, TMAGIC: "ustar" + ne2 + "00", OLDGNU_MAGIC: "ustar  " + ne2, REGTYPE: 0, LNKTYPE: 1, SYMTYPE: 2, CHRTYPE: 3, BLKTYPE: 4, DIRTYPE: 5, FIFOTYPE: 6, CONTTYPE: 7, TSUID: parseInt("4000", 8), TSGID: parseInt("2000", 8), TSVTX: parseInt("1000", 8), TUREAD: parseInt("0400", 8), TUWRITE: parseInt("0200", 8), TUEXEC: parseInt("0100", 8), TGREAD: parseInt("0040", 8), TGWRITE: parseInt("0020", 8), TGEXEC: parseInt("0010", 8), TOREAD: parseInt("0004", 8), TOWRITE: parseInt("0002", 8), TOEXEC: parseInt("0001", 8), TPERMALL: parseInt("0777", 8), TPERMMASK: parseInt("0777", 8) };
    });
    ie = D((Jr, P5) => {
      "use strict";
      u();
      var ye2 = W(), T4 = G(), tr = 512, oe3 = T4.TPERMALL, Fe2 = 0, he3 = 0, ae3 = [["name", 100, 0, function(e, r) {
        return V3(e[r[0]], r[1]);
      }, function(e, r, t3) {
        return L5(e.slice(r, r + t3[1]));
      }], ["mode", 8, 100, function(e, r) {
        var t3 = e[r[0]] || oe3;
        return t3 = t3 & T4.TPERMMASK, j3(t3, r[1], oe3);
      }, function(e, r, t3) {
        var n3 = x4(e.slice(r, r + t3[1]));
        return n3 &= T4.TPERMMASK, n3;
      }], ["uid", 8, 108, function(e, r) {
        return j3(e[r[0]], r[1], Fe2);
      }, function(e, r, t3) {
        return x4(e.slice(r, r + t3[1]));
      }], ["gid", 8, 116, function(e, r) {
        return j3(e[r[0]], r[1], he3);
      }, function(e, r, t3) {
        return x4(e.slice(r, r + t3[1]));
      }], ["size", 12, 124, function(e, r) {
        return j3(e.data.length, r[1]);
      }, function(e, r, t3) {
        return x4(e.slice(r, r + t3[1]));
      }], ["modifyTime", 12, 136, function(e, r) {
        return K2(e[r[0]], r[1]);
      }, function(e, r, t3) {
        return J3(e.slice(r, r + t3[1]));
      }], ["checksum", 8, 148, function(e, r) {
        return "        ";
      }, function(e, r, t3) {
        return x4(e.slice(r, r + t3[1]));
      }], ["type", 1, 156, function(e, r) {
        return "" + (parseInt(e[r[0]], 10) || 0) % 8;
      }, function(e, r, t3) {
        return (parseInt(String.fromCharCode(e[r]), 10) || 0) % 8;
      }], ["linkName", 100, 157, function(e, r) {
        return "";
      }, function(e, r, t3) {
        return L5(e.slice(r, r + t3[1]));
      }], ["ustar", 8, 257, function(e, r) {
        return T4.TMAGIC;
      }, function(e, r, t3) {
        return nr(L5(e.slice(r, r + t3[1]), true));
      }, function(e, r) {
        return e[r[0]] == T4.TMAGIC || e[r[0]] == T4.OLDGNU_MAGIC;
      }], ["owner", 32, 265, function(e, r) {
        return V3(e[r[0]], r[1]);
      }, function(e, r, t3) {
        return L5(e.slice(r, r + t3[1]));
      }], ["group", 32, 297, function(e, r) {
        return V3(e[r[0]], r[1]);
      }, function(e, r, t3) {
        return L5(e.slice(r, r + t3[1]));
      }], ["majorNumber", 8, 329, function(e, r) {
        return "";
      }, function(e, r, t3) {
        return x4(e.slice(r, r + t3[1]));
      }], ["minorNumber", 8, 337, function(e, r) {
        return "";
      }, function(e, r, t3) {
        return x4(e.slice(r, r + t3[1]));
      }], ["prefix", 131, 345, function(e, r) {
        return V3(e[r[0]], r[1]);
      }, function(e, r, t3) {
        return L5(e.slice(r, r + t3[1]));
      }], ["accessTime", 12, 476, function(e, r) {
        return K2(e[r[0]], r[1]);
      }, function(e, r, t3) {
        return J3(e.slice(r, r + t3[1]));
      }], ["createTime", 12, 488, function(e, r) {
        return K2(e[r[0]], r[1]);
      }, function(e, r, t3) {
        return J3(e.slice(r, r + t3[1]));
      }]], we3 = (function(e) {
        var r = e[e.length - 1];
        return r[2] + r[1];
      })(ae3);
      function nr(e) {
        if (e.length == 8) {
          var r = e.split("");
          if (r[5] == T4.NULL_CHAR) return (r[6] == " " || r[6] == T4.NULL_CHAR) && (r[6] = "0"), (r[7] == " " || r[7] == T4.NULL_CHAR) && (r[7] = "0"), r = r.join(""), r == T4.TMAGIC ? r : e;
          if (r[7] == T4.NULL_CHAR) return r[5] == T4.NULL_CHAR && (r[5] = " "), r[6] == T4.NULL_CHAR && (r[6] = " "), r == T4.OLDGNU_MAGIC ? r : e;
        }
        return e;
      }
      function V3(e, r) {
        return r -= 1, ye2.isUndefined(e) && (e = ""), e = ("" + e).substr(0, r), e + T4.NULL_CHAR;
      }
      function j3(e, r, t3) {
        for (t3 = parseInt(t3) || 0, r -= 1, e = (parseInt(e) || t3).toString(8).substr(-r, r); e.length < r; ) e = "0" + e;
        return e + T4.NULL_CHAR;
      }
      function K2(e, r) {
        if (ye2.isDateTime(e)) e = Math.floor(1 * e / 1e3);
        else if (e = parseInt(e, 10), isFinite(e)) {
          if (e <= 0) return "";
        } else e = Math.floor(1 * /* @__PURE__ */ new Date() / 1e3);
        return j3(e, r, 0);
      }
      function L5(e, r) {
        var t3 = String.fromCharCode.apply(null, e);
        if (r) return t3;
        var n3 = t3.indexOf(T4.NULL_CHAR);
        return n3 >= 0 ? t3.substr(0, n3) : t3;
      }
      function x4(e) {
        var r = String.fromCharCode.apply(null, e);
        return parseInt(r.replace(/^0+$/g, ""), 8) || 0;
      }
      function J3(e) {
        return e.length == 0 || e[0] == 0 ? null : new Date(1e3 * x4(e));
      }
      function or(e, r, t3) {
        var n3 = parseInt(r, 10) || 0, o5 = Math.min(n3 + we3, e.length), a3 = 0, s5 = 0, l2 = 0;
        t3 && ae3.every(function(p6) {
          return p6[0] == "checksum" ? (s5 = n3 + p6[2], l2 = s5 + p6[1], false) : true;
        });
        for (var u3 = 32, d3 = n3; d3 < o5; d3++) {
          var c4 = d3 >= s5 && d3 < l2 ? u3 : e[d3];
          a3 = (a3 + c4) % 262144;
        }
        return a3;
      }
      P5.exports.recordSize = tr;
      P5.exports.defaultFileMode = oe3;
      P5.exports.defaultUid = Fe2;
      P5.exports.defaultGid = he3;
      P5.exports.posixHeader = ae3;
      P5.exports.effectiveHeaderSize = we3;
      P5.exports.calculateChecksum = or;
      P5.exports.formatTarString = V3;
      P5.exports.formatTarNumber = j3;
      P5.exports.formatTarDateTime = K2;
      P5.exports.parseTarString = L5;
      P5.exports.parseTarNumber = x4;
      P5.exports.parseTarDateTime = J3;
    });
    Me = D((Zr, Te3) => {
      "use strict";
      u();
      var ar = G(), Q2 = W(), H3 = ie();
      function Ae2(e) {
        return H3.recordSize;
      }
      function be2(e) {
        return Math.ceil(e.data.length / H3.recordSize) * H3.recordSize;
      }
      function ir(e) {
        var r = 0;
        return e.forEach(function(t3) {
          r += Ae2(t3) + be2(t3);
        }), r += H3.recordSize * 2, new Uint8Array(r);
      }
      function sr(e, r, t3) {
        t3 = parseInt(t3) || 0;
        var n3 = t3;
        H3.posixHeader.forEach(function(u3) {
          for (var d3 = u3[3](r, u3), c4 = d3.length, p6 = 0; p6 < c4; p6 += 1) e[n3 + p6] = d3.charCodeAt(p6) & 255;
          n3 += u3[1];
        });
        var o5 = Q2.find(H3.posixHeader, function(u3) {
          return u3[0] == "checksum";
        });
        if (o5) {
          var a3 = H3.calculateChecksum(e, t3, true), s5 = H3.formatTarNumber(a3, o5[1] - 2) + ar.NULL_CHAR + " ";
          n3 = t3 + o5[2];
          for (var l2 = 0; l2 < s5.length; l2 += 1) e[n3] = s5.charCodeAt(l2) & 255, n3++;
        }
        return t3 + Ae2(r);
      }
      function lr(e, r, t3) {
        return t3 = parseInt(t3, 10) || 0, e.set(r.data, t3), t3 + be2(r);
      }
      function ur(e) {
        e = Q2.map(e, function(n3) {
          return Q2.extend({}, n3, { data: Q2.toUint8Array(n3.data) });
        });
        var r = ir(e), t3 = 0;
        return e.forEach(function(n3) {
          t3 = sr(r, n3, t3), t3 = lr(r, n3, t3);
        }), r;
      }
      Te3.exports.tar = ur;
    });
    ke = D((rt3, Pe3) => {
      "use strict";
      u();
      var dr = G(), le3 = W(), N2 = ie(), cr = { extractData: true, checkHeader: true, checkChecksum: true, checkFileSize: true }, _r = { size: true, checksum: true, ustar: true }, se3 = { unexpectedEndOfFile: "Unexpected end of file.", fileCorrupted: "File is corrupted.", checksumCheckFailed: "Checksum check failed." };
      function fr(e) {
        return N2.recordSize;
      }
      function mr(e) {
        return Math.ceil(e / N2.recordSize) * N2.recordSize;
      }
      function pr(e, r) {
        for (var t3 = r, n3 = Math.min(e.length, r + N2.recordSize * 2), o5 = t3; o5 < n3; o5++) if (e[o5] != 0) return false;
        return true;
      }
      function Sr(e, r, t3) {
        if (e.length - r < N2.recordSize) {
          if (t3.checkFileSize) throw new Error(se3.unexpectedEndOfFile);
          return null;
        }
        r = parseInt(r) || 0;
        var n3 = {}, o5 = r;
        if (N2.posixHeader.forEach(function(l2) {
          n3[l2[0]] = l2[4](e, o5, l2), o5 += l2[1];
        }), n3.type != 0 && (n3.size = 0), t3.checkHeader && N2.posixHeader.forEach(function(l2) {
          if (le3.isFunction(l2[5]) && !l2[5](n3, l2)) {
            var u3 = new Error(se3.fileCorrupted);
            throw u3.data = { offset: r + l2[2], field: l2[0] }, u3;
          }
        }), t3.checkChecksum) {
          var a3 = N2.calculateChecksum(e, r, true);
          if (a3 != n3.checksum) {
            var s5 = new Error(se3.checksumCheckFailed);
            throw s5.data = { offset: r, header: n3, checksum: a3 }, s5;
          }
        }
        return n3;
      }
      function Er(e, r, t3, n3) {
        return n3.extractData ? t3.size <= 0 ? new Uint8Array() : e.slice(r, r + t3.size) : null;
      }
      function gr(e, r) {
        var t3 = {};
        return N2.posixHeader.forEach(function(n3) {
          var o5 = n3[0];
          _r[o5] || (t3[o5] = e[o5]);
        }), t3.isOldGNUFormat = e.ustar == dr.OLDGNU_MAGIC, r && (t3.data = r), t3;
      }
      function vr(e, r) {
        r = le3.extend({}, cr, r);
        for (var t3 = [], n3 = 0, o5 = e.length; o5 - n3 >= N2.recordSize; ) {
          e = le3.toUint8Array(e);
          var a3 = Sr(e, n3, r);
          if (!a3) break;
          n3 += fr(a3);
          var s5 = Er(e, n3, a3, r);
          if (t3.push(gr(a3, s5)), n3 += mr(a3.size), pr(e, n3)) break;
        }
        return t3;
      }
      Pe3.exports.untar = vr;
    });
    Re = D((nt2, Oe2) => {
      "use strict";
      u();
      var yr = W(), Fr = G(), hr = Me(), wr = ke();
      yr.extend(Oe2.exports, hr, wr, Fr);
    });
    u();
    u();
    D2 = L(Re(), 1);
    Ar = ["application/x-gtar", "application/x-tar+gzip", "application/x-gzip", "application/gzip"];
    u();
    u();
    u();
    Dr = (() => {
      var _scriptName = import.meta.url;
      return async function(moduleArg = {}) {
        var moduleRtn, Module = moduleArg, readyPromiseResolve, readyPromiseReject, readyPromise = new Promise((e, r) => {
          readyPromiseResolve = e, readyPromiseReject = r;
        }), ENVIRONMENT_IS_WEB = typeof window == "object", ENVIRONMENT_IS_WORKER = typeof WorkerGlobalScope < "u", ENVIRONMENT_IS_NODE = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string" && process.type != "renderer";
        if (ENVIRONMENT_IS_NODE) {
          let { createRequire: e } = await import("module"), r = import.meta.url;
          r.startsWith("data:") && (r = "/");
          var require = e(r);
        }
        var moduleOverrides = Object.assign({}, Module), arguments_ = [], thisProgram = "./this.program", quit_ = (e, r) => {
          throw r;
        }, scriptDirectory = "";
        function locateFile(e) {
          return Module.locateFile ? Module.locateFile(e, scriptDirectory) : scriptDirectory + e;
        }
        var readAsync, readBinary;
        if (ENVIRONMENT_IS_NODE) {
          var fs = require("fs"), nodePath = require("path");
          import.meta.url.startsWith("data:") || (scriptDirectory = nodePath.dirname(require("url").fileURLToPath(import.meta.url)) + "/"), readBinary = (e) => {
            e = isFileURI(e) ? new URL(e) : e;
            var r = fs.readFileSync(e);
            return r;
          }, readAsync = async (e, r = true) => {
            e = isFileURI(e) ? new URL(e) : e;
            var t3 = fs.readFileSync(e, r ? void 0 : "utf8");
            return t3;
          }, !Module.thisProgram && process.argv.length > 1 && (thisProgram = process.argv[1].replace(/\\/g, "/")), arguments_ = process.argv.slice(2), quit_ = (e, r) => {
            throw process.exitCode = e, r;
          };
        } else (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && (ENVIRONMENT_IS_WORKER ? scriptDirectory = self.location.href : typeof document < "u" && document.currentScript && (scriptDirectory = document.currentScript.src), _scriptName && (scriptDirectory = _scriptName), scriptDirectory.startsWith("blob:") ? scriptDirectory = "" : scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1), ENVIRONMENT_IS_WORKER && (readBinary = (e) => {
          var r = new XMLHttpRequest();
          return r.open("GET", e, false), r.responseType = "arraybuffer", r.send(null), new Uint8Array(r.response);
        }), readAsync = async (e) => {
          var r = await fetch(e, { credentials: "same-origin" });
          if (r.ok) return r.arrayBuffer();
          throw new Error(r.status + " : " + r.url);
        });
        var out = Module.print || console.log.bind(console), err = Module.printErr || console.error.bind(console);
        Object.assign(Module, moduleOverrides), moduleOverrides = null, Module.arguments && (arguments_ = Module.arguments), Module.thisProgram && (thisProgram = Module.thisProgram);
        var dynamicLibraries = Module.dynamicLibraries || [], wasmBinary = Module.wasmBinary;
        function intArrayFromBase64(e) {
          if (typeof ENVIRONMENT_IS_NODE < "u" && ENVIRONMENT_IS_NODE) {
            var r = Buffer.from(e, "base64");
            return new Uint8Array(r.buffer, r.byteOffset, r.length);
          }
          for (var t3 = atob(e), n3 = new Uint8Array(t3.length), o5 = 0; o5 < t3.length; ++o5) n3[o5] = t3.charCodeAt(o5);
          return n3;
        }
        var wasmMemory, ABORT = false, EXITSTATUS;
        function assert(e, r) {
          e || abort(r);
        }
        var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAP64, HEAPU64, HEAPF64;
        function updateMemoryViews() {
          var e = wasmMemory.buffer;
          Module.HEAP8 = HEAP8 = new Int8Array(e), Module.HEAP16 = HEAP16 = new Int16Array(e), Module.HEAPU8 = HEAPU8 = new Uint8Array(e), Module.HEAPU16 = HEAPU16 = new Uint16Array(e), Module.HEAP32 = HEAP32 = new Int32Array(e), Module.HEAPU32 = HEAPU32 = new Uint32Array(e), Module.HEAPF32 = HEAPF32 = new Float32Array(e), Module.HEAPF64 = HEAPF64 = new Float64Array(e), Module.HEAP64 = HEAP64 = new BigInt64Array(e), Module.HEAPU64 = HEAPU64 = new BigUint64Array(e);
        }
        if (Module.wasmMemory) wasmMemory = Module.wasmMemory;
        else {
          var INITIAL_MEMORY = Module.INITIAL_MEMORY || 67108864;
          wasmMemory = new WebAssembly.Memory({ initial: INITIAL_MEMORY / 65536, maximum: 32768 });
        }
        updateMemoryViews();
        var __ATPRERUN__ = [], __ATINIT__ = [], __ATMAIN__ = [], __ATEXIT__ = [], __ATPOSTRUN__ = [], __RELOC_FUNCS__ = [], runtimeInitialized = false, runtimeExited = false;
        function preRun() {
          if (Module.preRun) for (typeof Module.preRun == "function" && (Module.preRun = [Module.preRun]); Module.preRun.length; ) addOnPreRun(Module.preRun.shift());
          callRuntimeCallbacks(__ATPRERUN__);
        }
        function initRuntime() {
          runtimeInitialized = true, callRuntimeCallbacks(__RELOC_FUNCS__), !Module.noFSInit && !FS.initialized && FS.init(), FS.ignorePermissions = false, TTY.init(), callRuntimeCallbacks(__ATINIT__);
        }
        function preMain() {
          callRuntimeCallbacks(__ATMAIN__);
        }
        function exitRuntime() {
          ___funcs_on_exit(), callRuntimeCallbacks(__ATEXIT__), FS.quit(), TTY.shutdown(), runtimeExited = true;
        }
        function postRun() {
          if (Module.postRun) for (typeof Module.postRun == "function" && (Module.postRun = [Module.postRun]); Module.postRun.length; ) addOnPostRun(Module.postRun.shift());
          callRuntimeCallbacks(__ATPOSTRUN__);
        }
        function addOnPreRun(e) {
          __ATPRERUN__.unshift(e);
        }
        function addOnInit(e) {
          __ATINIT__.unshift(e);
        }
        function addOnPostRun(e) {
          __ATPOSTRUN__.unshift(e);
        }
        var runDependencies = 0, dependenciesFulfilled = null;
        function getUniqueRunDependency(e) {
          return e;
        }
        function addRunDependency(e) {
          runDependencies++, Module.monitorRunDependencies?.(runDependencies);
        }
        function removeRunDependency(e) {
          if (runDependencies--, Module.monitorRunDependencies?.(runDependencies), runDependencies == 0 && dependenciesFulfilled) {
            var r = dependenciesFulfilled;
            dependenciesFulfilled = null, r();
          }
        }
        function abort(e) {
          Module.onAbort?.(e), e = "Aborted(" + e + ")", err(e), ABORT = true, e += ". Build with -sASSERTIONS for more info.";
          var r = new WebAssembly.RuntimeError(e);
          throw readyPromiseReject(r), r;
        }
        var dataURIPrefix = "data:application/octet-stream;base64,", isDataURI = (e) => e.startsWith(dataURIPrefix), isFileURI = (e) => e.startsWith("file://");
        function findWasmBinary() {
          if (Module.locateFile) {
            var e = "initdb.wasm";
            return isDataURI(e) ? e : locateFile(e);
          }
          return new URL("initdb.wasm", import.meta.url).href;
        }
        var wasmBinaryFile;
        function getBinarySync(e) {
          if (e == wasmBinaryFile && wasmBinary) return new Uint8Array(wasmBinary);
          if (readBinary) return readBinary(e);
          throw "both async and sync fetching of the wasm failed";
        }
        async function getWasmBinary(e) {
          if (!wasmBinary) try {
            var r = await readAsync(e);
            return new Uint8Array(r);
          } catch {
          }
          return getBinarySync(e);
        }
        async function instantiateArrayBuffer(e, r) {
          try {
            var t3 = await getWasmBinary(e), n3 = await WebAssembly.instantiate(t3, r);
            return n3;
          } catch (o5) {
            err(`failed to asynchronously prepare wasm: ${o5}`), abort(o5);
          }
        }
        async function instantiateAsync(e, r, t3) {
          if (!e && typeof WebAssembly.instantiateStreaming == "function" && !isDataURI(r) && !ENVIRONMENT_IS_NODE && typeof fetch == "function") try {
            var n3 = fetch(r, { credentials: "same-origin" }), o5 = await WebAssembly.instantiateStreaming(n3, t3);
            return o5;
          } catch (a3) {
            err(`wasm streaming compile failed: ${a3}`), err("falling back to ArrayBuffer instantiation");
          }
          return instantiateArrayBuffer(r, t3);
        }
        function getWasmImports() {
          return { env: wasmImports, wasi_snapshot_preview1: wasmImports, "GOT.mem": new Proxy(wasmImports, GOTHandler), "GOT.func": new Proxy(wasmImports, GOTHandler) };
        }
        async function createWasm() {
          function e(o5, a3) {
            wasmExports = o5.exports, wasmExports = relocateExports(wasmExports, 1024);
            var s5 = getDylinkMetadata(a3);
            return s5.neededDynlibs && (dynamicLibraries = s5.neededDynlibs.concat(dynamicLibraries)), mergeLibSymbols(wasmExports, "main"), LDSO.init(), loadDylibs(), addOnInit(wasmExports.__wasm_call_ctors), __RELOC_FUNCS__.push(wasmExports.__wasm_apply_data_relocs), removeRunDependency("wasm-instantiate"), wasmExports;
          }
          addRunDependency("wasm-instantiate");
          function r(o5) {
            e(o5.instance, o5.module);
          }
          var t3 = getWasmImports();
          if (Module.instantiateWasm) try {
            return Module.instantiateWasm(t3, e);
          } catch (o5) {
            err(`Module.instantiateWasm callback failed with error: ${o5}`), readyPromiseReject(o5);
          }
          wasmBinaryFile ?? (wasmBinaryFile = findWasmBinary());
          try {
            var n3 = await instantiateAsync(wasmBinary, wasmBinaryFile, t3);
            return r(n3), n3;
          } catch (o5) {
            readyPromiseReject(o5);
            return;
          }
        }
        var ASM_CONSTS = {};
        class ExitStatus {
          constructor(r) {
            P(this, "name", "ExitStatus");
            this.message = `Program terminated with exit(${r})`, this.status = r;
          }
        }
        var GOT = {}, currentModuleWeakSymbols = /* @__PURE__ */ new Set([]), GOTHandler = { get(e, r) {
          var t3 = GOT[r];
          return t3 || (t3 = GOT[r] = new WebAssembly.Global({ value: "i32", mutable: true })), currentModuleWeakSymbols.has(r) || (t3.required = true), t3;
        } }, callRuntimeCallbacks = (e) => {
          for (; e.length > 0; ) e.shift()(Module);
        }, UTF8Decoder = typeof TextDecoder < "u" ? new TextDecoder() : void 0, UTF8ArrayToString = (e, r = 0, t3 = NaN) => {
          for (var n3 = r + t3, o5 = r; e[o5] && !(o5 >= n3); ) ++o5;
          if (o5 - r > 16 && e.buffer && UTF8Decoder) return UTF8Decoder.decode(e.subarray(r, o5));
          for (var a3 = ""; r < o5; ) {
            var s5 = e[r++];
            if (!(s5 & 128)) {
              a3 += String.fromCharCode(s5);
              continue;
            }
            var l2 = e[r++] & 63;
            if ((s5 & 224) == 192) {
              a3 += String.fromCharCode((s5 & 31) << 6 | l2);
              continue;
            }
            var u3 = e[r++] & 63;
            if ((s5 & 240) == 224 ? s5 = (s5 & 15) << 12 | l2 << 6 | u3 : s5 = (s5 & 7) << 18 | l2 << 12 | u3 << 6 | e[r++] & 63, s5 < 65536) a3 += String.fromCharCode(s5);
            else {
              var d3 = s5 - 65536;
              a3 += String.fromCharCode(55296 | d3 >> 10, 56320 | d3 & 1023);
            }
          }
          return a3;
        }, getDylinkMetadata = (e) => {
          var r = 0, t3 = 0;
          function n3() {
            return e[r++];
          }
          function o5() {
            for (var U3 = 0, X2 = 1; ; ) {
              var _e3 = e[r++];
              if (U3 += (_e3 & 127) * X2, X2 *= 128, !(_e3 & 128)) break;
            }
            return U3;
          }
          function a3() {
            var U3 = o5();
            return r += U3, UTF8ArrayToString(e, r - U3, U3);
          }
          function s5(U3, X2) {
            if (U3) throw new Error(X2);
          }
          var l2 = "dylink.0";
          if (e instanceof WebAssembly.Module) {
            var u3 = WebAssembly.Module.customSections(e, l2);
            u3.length === 0 && (l2 = "dylink", u3 = WebAssembly.Module.customSections(e, l2)), s5(u3.length === 0, "need dylink section"), e = new Uint8Array(u3[0]), t3 = e.length;
          } else {
            var d3 = new Uint32Array(new Uint8Array(e.subarray(0, 24)).buffer), c4 = d3[0] == 1836278016;
            s5(!c4, "need to see wasm magic number"), s5(e[8] !== 0, "need the dylink section to be first"), r = 9;
            var p6 = o5();
            t3 = r + p6, l2 = a3();
          }
          var f5 = { neededDynlibs: [], tlsExports: /* @__PURE__ */ new Set(), weakImports: /* @__PURE__ */ new Set() };
          if (l2 == "dylink") {
            f5.memorySize = o5(), f5.memoryAlign = o5(), f5.tableSize = o5(), f5.tableAlign = o5();
            for (var m5 = o5(), _4 = 0; _4 < m5; ++_4) {
              var g4 = a3();
              f5.neededDynlibs.push(g4);
            }
          } else {
            s5(l2 !== "dylink.0");
            for (var E3 = 1, y5 = 2, A3 = 3, S5 = 4, v5 = 256, h3 = 3, b4 = 1; r < t3; ) {
              var F4 = n3(), Xe3 = o5();
              if (F4 === E3) f5.memorySize = o5(), f5.memoryAlign = o5(), f5.tableSize = o5(), f5.tableAlign = o5();
              else if (F4 === y5) for (var m5 = o5(), _4 = 0; _4 < m5; ++_4) g4 = a3(), f5.neededDynlibs.push(g4);
              else if (F4 === A3) for (var Z2 = o5(); Z2--; ) {
                var ee3 = a3(), re = o5();
                re & v5 && f5.tlsExports.add(ee3);
              }
              else if (F4 === S5) for (var Z2 = o5(); Z2--; ) {
                var Vr = a3(), ee3 = a3(), re = o5();
                (re & h3) == b4 && f5.weakImports.add(ee3);
              }
              else r += Xe3;
            }
          }
          return f5;
        }, newDSO = (e, r, t3) => {
          var n3 = { refcount: 1 / 0, name: e, exports: t3, global: true };
          return LDSO.loadedLibsByName[e] = n3, r != null && (LDSO.loadedLibsByHandle[r] = n3), n3;
        }, LDSO = { loadedLibsByName: {}, loadedLibsByHandle: {}, init() {
          newDSO("__main__", 0, wasmImports);
        } }, ___heap_base = 205888, alignMemory = (e, r) => Math.ceil(e / r) * r, getMemory = (e) => {
          if (runtimeInitialized) return _calloc(e, 1);
          var r = ___heap_base, t3 = r + alignMemory(e, 16);
          return ___heap_base = t3, GOT.__heap_base.value = t3, r;
        }, isInternalSym = (e) => ["__cpp_exception", "__c_longjmp", "__wasm_apply_data_relocs", "__dso_handle", "__tls_size", "__tls_align", "__set_stack_limits", "_emscripten_tls_init", "__wasm_init_tls", "__wasm_call_ctors", "__start_em_asm", "__stop_em_asm", "__start_em_js", "__stop_em_js"].includes(e) || e.startsWith("__em_js__"), uleb128Encode = (e, r) => {
          e < 128 ? r.push(e) : r.push(e % 128 | 128, e >> 7);
        }, sigToWasmTypes = (e) => {
          for (var r = { i: "i32", j: "i64", f: "f32", d: "f64", e: "externref", p: "i32" }, t3 = { parameters: [], results: e[0] == "v" ? [] : [r[e[0]]] }, n3 = 1; n3 < e.length; ++n3) t3.parameters.push(r[e[n3]]);
          return t3;
        }, generateFuncType = (e, r) => {
          var t3 = e.slice(0, 1), n3 = e.slice(1), o5 = { i: 127, p: 127, j: 126, f: 125, d: 124, e: 111 };
          r.push(96), uleb128Encode(n3.length, r);
          for (var a3 = 0; a3 < n3.length; ++a3) r.push(o5[n3[a3]]);
          t3 == "v" ? r.push(0) : r.push(1, o5[t3]);
        }, convertJsFunctionToWasm = (e, r) => {
          if (typeof WebAssembly.Function == "function") return new WebAssembly.Function(sigToWasmTypes(r), e);
          var t3 = [1];
          generateFuncType(r, t3);
          var n3 = [0, 97, 115, 109, 1, 0, 0, 0, 1];
          uleb128Encode(t3.length, n3), n3.push(...t3), n3.push(2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0);
          var o5 = new WebAssembly.Module(new Uint8Array(n3)), a3 = new WebAssembly.Instance(o5, { e: { f: e } }), s5 = a3.exports.f;
          return s5;
        }, wasmTableMirror = [], wasmTable = new WebAssembly.Table({ initial: 144, element: "anyfunc" }), getWasmTableEntry = (e) => {
          var r = wasmTableMirror[e];
          return r || (e >= wasmTableMirror.length && (wasmTableMirror.length = e + 1), wasmTableMirror[e] = r = wasmTable.get(e)), r;
        }, updateTableMap = (e, r) => {
          if (functionsInTableMap) for (var t3 = e; t3 < e + r; t3++) {
            var n3 = getWasmTableEntry(t3);
            n3 && functionsInTableMap.set(n3, t3);
          }
        }, functionsInTableMap, getFunctionAddress = (e) => (functionsInTableMap || (functionsInTableMap = /* @__PURE__ */ new WeakMap(), updateTableMap(0, wasmTable.length)), functionsInTableMap.get(e) || 0), freeTableIndexes = [], getEmptyTableSlot = () => {
          if (freeTableIndexes.length) return freeTableIndexes.pop();
          try {
            wasmTable.grow(1);
          } catch (e) {
            throw e instanceof RangeError ? "Unable to grow wasm table. Set ALLOW_TABLE_GROWTH." : e;
          }
          return wasmTable.length - 1;
        }, setWasmTableEntry = (e, r) => {
          wasmTable.set(e, r), wasmTableMirror[e] = wasmTable.get(e);
        }, addFunction = (e, r) => {
          var t3 = getFunctionAddress(e);
          if (t3) return t3;
          var n3 = getEmptyTableSlot();
          try {
            setWasmTableEntry(n3, e);
          } catch (a3) {
            if (!(a3 instanceof TypeError)) throw a3;
            var o5 = convertJsFunctionToWasm(e, r);
            setWasmTableEntry(n3, o5);
          }
          return functionsInTableMap.set(e, n3), n3;
        }, updateGOT = (e, r) => {
          for (var t3 in e) if (!isInternalSym(t3)) {
            var n3 = e[t3];
            GOT[t3] || (GOT[t3] = new WebAssembly.Global({ value: "i32", mutable: true })), (r || GOT[t3].value == 0) && (typeof n3 == "function" ? GOT[t3].value = addFunction(n3) : typeof n3 == "number" ? GOT[t3].value = n3 : err(`unhandled export type for '${t3}': ${typeof n3}`));
          }
        }, relocateExports = (e, r, t3) => {
          var n3 = {};
          for (var o5 in e) {
            var a3 = e[o5];
            typeof a3 == "object" && (a3 = a3.value), typeof a3 == "number" && (a3 += r), n3[o5] = a3;
          }
          return updateGOT(n3, t3), n3;
        }, isSymbolDefined = (e) => {
          var r = wasmImports[e];
          return !(!r || r.stub);
        }, dynCall = (e, r, t3 = []) => {
          var n3 = getWasmTableEntry(r)(...t3);
          return n3;
        }, stackSave = () => _emscripten_stack_get_current(), stackRestore = (e) => __emscripten_stack_restore(e), createInvokeFunction = (e) => (r, ...t3) => {
          var n3 = stackSave();
          try {
            return dynCall(e, r, t3);
          } catch (o5) {
            if (stackRestore(n3), o5 !== o5 + 0) throw o5;
            if (_setThrew(1, 0), e[0] == "j") return 0n;
          }
        }, resolveGlobalSymbol = (e, r = false) => {
          var t3;
          return isSymbolDefined(e) ? t3 = wasmImports[e] : e.startsWith("invoke_") && (t3 = wasmImports[e] = createInvokeFunction(e.split("_")[1])), { sym: t3, name: e };
        }, UTF8ToString = (e, r) => e ? UTF8ArrayToString(HEAPU8, e, r) : "", loadWebAssemblyModule = (binary, flags, libName, localScope, handle) => {
          var metadata = getDylinkMetadata(binary);
          currentModuleWeakSymbols = metadata.weakImports;
          function loadModule() {
            var firstLoad = !handle || !HEAP8[handle + 8];
            if (firstLoad) {
              var memAlign = Math.pow(2, metadata.memoryAlign), memoryBase = metadata.memorySize ? alignMemory(getMemory(metadata.memorySize + memAlign), memAlign) : 0, tableBase = metadata.tableSize ? wasmTable.length : 0;
              handle && (HEAP8[handle + 8] = 1, HEAPU32[handle + 12 >> 2] = memoryBase, HEAP32[handle + 16 >> 2] = metadata.memorySize, HEAPU32[handle + 20 >> 2] = tableBase, HEAP32[handle + 24 >> 2] = metadata.tableSize);
            } else memoryBase = HEAPU32[handle + 12 >> 2], tableBase = HEAPU32[handle + 20 >> 2];
            var tableGrowthNeeded = tableBase + metadata.tableSize - wasmTable.length;
            tableGrowthNeeded > 0 && wasmTable.grow(tableGrowthNeeded);
            var moduleExports;
            function resolveSymbol(e) {
              var r = resolveGlobalSymbol(e).sym;
              return !r && localScope && (r = localScope[e]), r || (r = moduleExports[e]), r;
            }
            var proxyHandler = { get(e, r) {
              switch (r) {
                case "__memory_base":
                  return memoryBase;
                case "__table_base":
                  return tableBase;
              }
              if (r in wasmImports && !wasmImports[r].stub) return wasmImports[r];
              if (!(r in e)) {
                var t3;
                e[r] = (...n3) => (t3 || (t3 = resolveSymbol(r)), t3(...n3));
              }
              return e[r];
            } }, proxy = new Proxy({}, proxyHandler), info = { "GOT.mem": new Proxy({}, GOTHandler), "GOT.func": new Proxy({}, GOTHandler), env: proxy, wasi_snapshot_preview1: proxy };
            function postInstantiation(module, instance) {
              updateTableMap(tableBase, metadata.tableSize), moduleExports = relocateExports(instance.exports, memoryBase), flags.allowUndefined || reportUndefinedSymbols();
              function addEmAsm(addr, body) {
                for (var args = [], arity = 0; arity < 16 && body.indexOf("$" + arity) != -1; arity++) args.push("$" + arity);
                args = args.join(",");
                var func = `(${args}) => { ${body} };`;
                ASM_CONSTS[start] = eval(func);
              }
              if ("__start_em_asm" in moduleExports) for (var start = moduleExports.__start_em_asm, stop = moduleExports.__stop_em_asm; start < stop; ) {
                var jsString = UTF8ToString(start);
                addEmAsm(start, jsString), start = HEAPU8.indexOf(0, start) + 1;
              }
              function addEmJs(name, cSig, body) {
                var jsArgs = [];
                if (cSig = cSig.slice(1, -1), cSig != "void") {
                  cSig = cSig.split(",");
                  for (var i in cSig) {
                    var jsArg = cSig[i].split(" ").pop();
                    jsArgs.push(jsArg.replace("*", ""));
                  }
                }
                var func = `(${jsArgs}) => ${body};`;
                moduleExports[name] = eval(func);
              }
              for (var name in moduleExports) if (name.startsWith("__em_js__")) {
                var start = moduleExports[name], jsString = UTF8ToString(start), parts = jsString.split("<::>");
                addEmJs(name.replace("__em_js__", ""), parts[0], parts[1]), delete moduleExports[name];
              }
              var applyRelocs = moduleExports.__wasm_apply_data_relocs;
              applyRelocs && (runtimeInitialized ? applyRelocs() : __RELOC_FUNCS__.push(applyRelocs));
              var init = moduleExports.__wasm_call_ctors;
              return init && (runtimeInitialized ? init() : __ATINIT__.push(init)), moduleExports;
            }
            if (flags.loadAsync) {
              if (binary instanceof WebAssembly.Module) {
                var instance = new WebAssembly.Instance(binary, info);
                return Promise.resolve(postInstantiation(binary, instance));
              }
              return WebAssembly.instantiate(binary, info).then((e) => postInstantiation(e.module, e.instance));
            }
            var module = binary instanceof WebAssembly.Module ? binary : new WebAssembly.Module(binary), instance = new WebAssembly.Instance(module, info);
            return postInstantiation(module, instance);
          }
          return flags.loadAsync ? metadata.neededDynlibs.reduce((e, r) => e.then(() => loadDynamicLibrary(r, flags, localScope)), Promise.resolve()).then(loadModule) : (metadata.neededDynlibs.forEach((e) => loadDynamicLibrary(e, flags, localScope)), loadModule());
        }, mergeLibSymbols = (e, r) => {
          for (var [t3, n3] of Object.entries(e)) {
            let o5 = (s5) => {
              isSymbolDefined(s5) || (wasmImports[s5] = n3);
            };
            o5(t3);
            let a3 = "__main_argc_argv";
            t3 == "main" && o5(a3), t3 == a3 && o5("main");
          }
        }, asyncLoad = async (e) => {
          var r = await readAsync(e);
          return new Uint8Array(r);
        }, preloadPlugins = Module.preloadPlugins || [], registerWasmPlugin = () => {
          var e = { promiseChainEnd: Promise.resolve(), canHandle: (r) => !Module.noWasmDecoding && r.endsWith(".so"), handle: (r, t3, n3, o5) => {
            e.promiseChainEnd = e.promiseChainEnd.then(() => loadWebAssemblyModule(r, { loadAsync: true, nodelete: true }, t3, {})).then((a3) => {
              preloadedWasm[t3] = a3, n3(r);
            }, (a3) => {
              err(`failed to instantiate wasm: ${t3}: ${a3}`), o5();
            });
          } };
          preloadPlugins.push(e);
        }, preloadedWasm = {};
        function loadDynamicLibrary(e, r = { global: true, nodelete: true }, t3, n3) {
          var o5 = LDSO.loadedLibsByName[e];
          if (o5) return r.global ? o5.global || (o5.global = true, mergeLibSymbols(o5.exports, e)) : t3 && Object.assign(t3, o5.exports), r.nodelete && o5.refcount !== 1 / 0 && (o5.refcount = 1 / 0), o5.refcount++, n3 && (LDSO.loadedLibsByHandle[n3] = o5), r.loadAsync ? Promise.resolve(true) : true;
          o5 = newDSO(e, n3, "loading"), o5.refcount = r.nodelete ? 1 / 0 : 1, o5.global = r.global;
          function a3() {
            if (n3) {
              var u3 = HEAPU32[n3 + 28 >> 2], d3 = HEAPU32[n3 + 32 >> 2];
              if (u3 && d3) {
                var c4 = HEAP8.slice(u3, u3 + d3);
                return r.loadAsync ? Promise.resolve(c4) : c4;
              }
            }
            var p6 = locateFile(e);
            if (r.loadAsync) return asyncLoad(p6);
            if (!readBinary) throw new Error(`${p6}: file not found, and synchronous loading of external files is not available`);
            return readBinary(p6);
          }
          function s5() {
            var u3 = preloadedWasm[e];
            return u3 ? r.loadAsync ? Promise.resolve(u3) : u3 : r.loadAsync ? a3().then((d3) => loadWebAssemblyModule(d3, r, e, t3, n3)) : loadWebAssemblyModule(a3(), r, e, t3, n3);
          }
          function l2(u3) {
            o5.global ? mergeLibSymbols(u3, e) : t3 && Object.assign(t3, u3), o5.exports = u3;
          }
          return r.loadAsync ? s5().then((u3) => (l2(u3), true)) : (l2(s5()), true);
        }
        var reportUndefinedSymbols = () => {
          for (var [e, r] of Object.entries(GOT)) if (r.value == 0) {
            var t3 = resolveGlobalSymbol(e, true).sym;
            if (!t3 && !r.required) continue;
            if (typeof t3 == "function") r.value = addFunction(t3, t3.sig);
            else if (typeof t3 == "number") r.value = t3;
            else throw new Error(`bad export type for '${e}': ${typeof t3}`);
          }
        }, loadDylibs = () => {
          if (!dynamicLibraries.length) {
            reportUndefinedSymbols();
            return;
          }
          addRunDependency("loadDylibs"), dynamicLibraries.reduce((e, r) => e.then(() => loadDynamicLibrary(r, { loadAsync: true, global: true, nodelete: true, allowUndefined: true })), Promise.resolve()).then(() => {
            reportUndefinedSymbols(), removeRunDependency("loadDylibs");
          });
        }, noExitRuntime = Module.noExitRuntime || false, ___call_sighandler = (e, r) => getWasmTableEntry(e)(r);
        ___call_sighandler.sig = "vpi";
        var ___memory_base = new WebAssembly.Global({ value: "i32", mutable: false }, 1024), ___stack_pointer = new WebAssembly.Global({ value: "i32", mutable: true }, 205888), PATH = { isAbs: (e) => e.charAt(0) === "/", splitPath: (e) => {
          var r = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
          return r.exec(e).slice(1);
        }, normalizeArray: (e, r) => {
          for (var t3 = 0, n3 = e.length - 1; n3 >= 0; n3--) {
            var o5 = e[n3];
            o5 === "." ? e.splice(n3, 1) : o5 === ".." ? (e.splice(n3, 1), t3++) : t3 && (e.splice(n3, 1), t3--);
          }
          if (r) for (; t3; t3--) e.unshift("..");
          return e;
        }, normalize: (e) => {
          var r = PATH.isAbs(e), t3 = e.substr(-1) === "/";
          return e = PATH.normalizeArray(e.split("/").filter((n3) => !!n3), !r).join("/"), !e && !r && (e = "."), e && t3 && (e += "/"), (r ? "/" : "") + e;
        }, dirname: (e) => {
          var r = PATH.splitPath(e), t3 = r[0], n3 = r[1];
          return !t3 && !n3 ? "." : (n3 && (n3 = n3.substr(0, n3.length - 1)), t3 + n3);
        }, basename: (e) => {
          if (e === "/") return "/";
          e = PATH.normalize(e), e = e.replace(/\/$/, "");
          var r = e.lastIndexOf("/");
          return r === -1 ? e : e.substr(r + 1);
        }, join: (...e) => PATH.normalize(e.join("/")), join2: (e, r) => PATH.normalize(e + "/" + r) }, initRandomFill = () => {
          if (typeof crypto == "object" && typeof crypto.getRandomValues == "function") return (n3) => crypto.getRandomValues(n3);
          if (ENVIRONMENT_IS_NODE) try {
            var e = require("crypto"), r = e.randomFillSync;
            if (r) return (n3) => e.randomFillSync(n3);
            var t3 = e.randomBytes;
            return (n3) => (n3.set(t3(n3.byteLength)), n3);
          } catch {
          }
          abort("initRandomDevice");
        }, randomFill = (e) => (randomFill = initRandomFill())(e), PATH_FS = { resolve: (...e) => {
          for (var r = "", t3 = false, n3 = e.length - 1; n3 >= -1 && !t3; n3--) {
            var o5 = n3 >= 0 ? e[n3] : FS.cwd();
            if (typeof o5 != "string") throw new TypeError("Arguments to path.resolve must be strings");
            if (!o5) return "";
            r = o5 + "/" + r, t3 = PATH.isAbs(o5);
          }
          return r = PATH.normalizeArray(r.split("/").filter((a3) => !!a3), !t3).join("/"), (t3 ? "/" : "") + r || ".";
        }, relative: (e, r) => {
          e = PATH_FS.resolve(e).substr(1), r = PATH_FS.resolve(r).substr(1);
          function t3(d3) {
            for (var c4 = 0; c4 < d3.length && d3[c4] === ""; c4++) ;
            for (var p6 = d3.length - 1; p6 >= 0 && d3[p6] === ""; p6--) ;
            return c4 > p6 ? [] : d3.slice(c4, p6 - c4 + 1);
          }
          for (var n3 = t3(e.split("/")), o5 = t3(r.split("/")), a3 = Math.min(n3.length, o5.length), s5 = a3, l2 = 0; l2 < a3; l2++) if (n3[l2] !== o5[l2]) {
            s5 = l2;
            break;
          }
          for (var u3 = [], l2 = s5; l2 < n3.length; l2++) u3.push("..");
          return u3 = u3.concat(o5.slice(s5)), u3.join("/");
        } }, FS_stdin_getChar_buffer = [], lengthBytesUTF8 = (e) => {
          for (var r = 0, t3 = 0; t3 < e.length; ++t3) {
            var n3 = e.charCodeAt(t3);
            n3 <= 127 ? r++ : n3 <= 2047 ? r += 2 : n3 >= 55296 && n3 <= 57343 ? (r += 4, ++t3) : r += 3;
          }
          return r;
        }, stringToUTF8Array = (e, r, t3, n3) => {
          if (!(n3 > 0)) return 0;
          for (var o5 = t3, a3 = t3 + n3 - 1, s5 = 0; s5 < e.length; ++s5) {
            var l2 = e.charCodeAt(s5);
            if (l2 >= 55296 && l2 <= 57343) {
              var u3 = e.charCodeAt(++s5);
              l2 = 65536 + ((l2 & 1023) << 10) | u3 & 1023;
            }
            if (l2 <= 127) {
              if (t3 >= a3) break;
              r[t3++] = l2;
            } else if (l2 <= 2047) {
              if (t3 + 1 >= a3) break;
              r[t3++] = 192 | l2 >> 6, r[t3++] = 128 | l2 & 63;
            } else if (l2 <= 65535) {
              if (t3 + 2 >= a3) break;
              r[t3++] = 224 | l2 >> 12, r[t3++] = 128 | l2 >> 6 & 63, r[t3++] = 128 | l2 & 63;
            } else {
              if (t3 + 3 >= a3) break;
              r[t3++] = 240 | l2 >> 18, r[t3++] = 128 | l2 >> 12 & 63, r[t3++] = 128 | l2 >> 6 & 63, r[t3++] = 128 | l2 & 63;
            }
          }
          return r[t3] = 0, t3 - o5;
        };
        function intArrayFromString(e, r, t3) {
          var n3 = t3 > 0 ? t3 : lengthBytesUTF8(e) + 1, o5 = new Array(n3), a3 = stringToUTF8Array(e, o5, 0, o5.length);
          return r && (o5.length = a3), o5;
        }
        var FS_stdin_getChar = () => {
          if (!FS_stdin_getChar_buffer.length) {
            var e = null;
            if (ENVIRONMENT_IS_NODE) {
              var r = 256, t3 = Buffer.alloc(r), n3 = 0, o5 = process.stdin.fd;
              try {
                n3 = fs.readSync(o5, t3, 0, r);
              } catch (a3) {
                if (a3.toString().includes("EOF")) n3 = 0;
                else throw a3;
              }
              n3 > 0 && (e = t3.slice(0, n3).toString("utf-8"));
            } else typeof window < "u" && typeof window.prompt == "function" && (e = window.prompt("Input: "), e !== null && (e += `
`));
            if (!e) return null;
            FS_stdin_getChar_buffer = intArrayFromString(e, true);
          }
          return FS_stdin_getChar_buffer.shift();
        }, TTY = { ttys: [], init() {
        }, shutdown() {
        }, register(e, r) {
          TTY.ttys[e] = { input: [], output: [], ops: r }, FS.registerDevice(e, TTY.stream_ops);
        }, stream_ops: { open(e) {
          var r = TTY.ttys[e.node.rdev];
          if (!r) throw new FS.ErrnoError(43);
          e.tty = r, e.seekable = false;
        }, close(e) {
          e.tty.ops.fsync(e.tty);
        }, fsync(e) {
          e.tty.ops.fsync(e.tty);
        }, read(e, r, t3, n3, o5) {
          if (!e.tty || !e.tty.ops.get_char) throw new FS.ErrnoError(60);
          for (var a3 = 0, s5 = 0; s5 < n3; s5++) {
            var l2;
            try {
              l2 = e.tty.ops.get_char(e.tty);
            } catch {
              throw new FS.ErrnoError(29);
            }
            if (l2 === void 0 && a3 === 0) throw new FS.ErrnoError(6);
            if (l2 == null) break;
            a3++, r[t3 + s5] = l2;
          }
          return a3 && (e.node.atime = Date.now()), a3;
        }, write(e, r, t3, n3, o5) {
          if (!e.tty || !e.tty.ops.put_char) throw new FS.ErrnoError(60);
          try {
            for (var a3 = 0; a3 < n3; a3++) e.tty.ops.put_char(e.tty, r[t3 + a3]);
          } catch {
            throw new FS.ErrnoError(29);
          }
          return n3 && (e.node.mtime = e.node.ctime = Date.now()), a3;
        } }, default_tty_ops: { get_char(e) {
          return FS_stdin_getChar();
        }, put_char(e, r) {
          r === null || r === 10 ? (out(UTF8ArrayToString(e.output)), e.output = []) : r != 0 && e.output.push(r);
        }, fsync(e) {
          e.output && e.output.length > 0 && (out(UTF8ArrayToString(e.output)), e.output = []);
        }, ioctl_tcgets(e) {
          return { c_iflag: 25856, c_oflag: 5, c_cflag: 191, c_lflag: 35387, c_cc: [3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
        }, ioctl_tcsets(e, r, t3) {
          return 0;
        }, ioctl_tiocgwinsz(e) {
          return [24, 80];
        } }, default_tty1_ops: { put_char(e, r) {
          r === null || r === 10 ? (err(UTF8ArrayToString(e.output)), e.output = []) : r != 0 && e.output.push(r);
        }, fsync(e) {
          e.output && e.output.length > 0 && (err(UTF8ArrayToString(e.output)), e.output = []);
        } } }, zeroMemory = (e, r) => {
          HEAPU8.fill(0, e, e + r);
        }, mmapAlloc = (e) => {
          e = alignMemory(e, 65536);
          var r = _emscripten_builtin_memalign(65536, e);
          return r && zeroMemory(r, e), r;
        }, MEMFS = { ops_table: null, mount(e) {
          return MEMFS.createNode(null, "/", 16895, 0);
        }, createNode(e, r, t3, n3) {
          if (FS.isBlkdev(t3) || FS.isFIFO(t3)) throw new FS.ErrnoError(63);
          MEMFS.ops_table || (MEMFS.ops_table = { dir: { node: { getattr: MEMFS.node_ops.getattr, setattr: MEMFS.node_ops.setattr, lookup: MEMFS.node_ops.lookup, mknod: MEMFS.node_ops.mknod, rename: MEMFS.node_ops.rename, unlink: MEMFS.node_ops.unlink, rmdir: MEMFS.node_ops.rmdir, readdir: MEMFS.node_ops.readdir, symlink: MEMFS.node_ops.symlink }, stream: { llseek: MEMFS.stream_ops.llseek } }, file: { node: { getattr: MEMFS.node_ops.getattr, setattr: MEMFS.node_ops.setattr }, stream: { llseek: MEMFS.stream_ops.llseek, read: MEMFS.stream_ops.read, write: MEMFS.stream_ops.write, allocate: MEMFS.stream_ops.allocate, mmap: MEMFS.stream_ops.mmap, msync: MEMFS.stream_ops.msync } }, link: { node: { getattr: MEMFS.node_ops.getattr, setattr: MEMFS.node_ops.setattr, readlink: MEMFS.node_ops.readlink }, stream: {} }, chrdev: { node: { getattr: MEMFS.node_ops.getattr, setattr: MEMFS.node_ops.setattr }, stream: FS.chrdev_stream_ops } });
          var o5 = FS.createNode(e, r, t3, n3);
          return FS.isDir(o5.mode) ? (o5.node_ops = MEMFS.ops_table.dir.node, o5.stream_ops = MEMFS.ops_table.dir.stream, o5.contents = {}) : FS.isFile(o5.mode) ? (o5.node_ops = MEMFS.ops_table.file.node, o5.stream_ops = MEMFS.ops_table.file.stream, o5.usedBytes = 0, o5.contents = null) : FS.isLink(o5.mode) ? (o5.node_ops = MEMFS.ops_table.link.node, o5.stream_ops = MEMFS.ops_table.link.stream) : FS.isChrdev(o5.mode) && (o5.node_ops = MEMFS.ops_table.chrdev.node, o5.stream_ops = MEMFS.ops_table.chrdev.stream), o5.atime = o5.mtime = o5.ctime = Date.now(), e && (e.contents[r] = o5, e.atime = e.mtime = e.ctime = o5.atime), o5;
        }, getFileDataAsTypedArray(e) {
          return e.contents ? e.contents.subarray ? e.contents.subarray(0, e.usedBytes) : new Uint8Array(e.contents) : new Uint8Array(0);
        }, expandFileStorage(e, r) {
          var t3 = e.contents ? e.contents.length : 0;
          if (!(t3 >= r)) {
            var n3 = 1024 * 1024;
            r = Math.max(r, t3 * (t3 < n3 ? 2 : 1.125) >>> 0), t3 != 0 && (r = Math.max(r, 256));
            var o5 = e.contents;
            e.contents = new Uint8Array(r), e.usedBytes > 0 && e.contents.set(o5.subarray(0, e.usedBytes), 0);
          }
        }, resizeFileStorage(e, r) {
          if (e.usedBytes != r) if (r == 0) e.contents = null, e.usedBytes = 0;
          else {
            var t3 = e.contents;
            e.contents = new Uint8Array(r), t3 && e.contents.set(t3.subarray(0, Math.min(r, e.usedBytes))), e.usedBytes = r;
          }
        }, node_ops: { getattr(e) {
          var r = {};
          return r.dev = FS.isChrdev(e.mode) ? e.id : 1, r.ino = e.id, r.mode = e.mode, r.nlink = 1, r.uid = 0, r.gid = 0, r.rdev = e.rdev, FS.isDir(e.mode) ? r.size = 4096 : FS.isFile(e.mode) ? r.size = e.usedBytes : FS.isLink(e.mode) ? r.size = e.link.length : r.size = 0, r.atime = new Date(e.atime), r.mtime = new Date(e.mtime), r.ctime = new Date(e.ctime), r.blksize = 4096, r.blocks = Math.ceil(r.size / r.blksize), r;
        }, setattr(e, r) {
          for (let t3 of ["mode", "atime", "mtime", "ctime"]) r[t3] && (e[t3] = r[t3]);
          r.size !== void 0 && MEMFS.resizeFileStorage(e, r.size);
        }, lookup(e, r) {
          throw MEMFS.doesNotExistError;
        }, mknod(e, r, t3, n3) {
          return MEMFS.createNode(e, r, t3, n3);
        }, rename(e, r, t3) {
          var n3;
          try {
            n3 = FS.lookupNode(r, t3);
          } catch {
          }
          if (n3) {
            if (FS.isDir(e.mode)) for (var o5 in n3.contents) throw new FS.ErrnoError(55);
            FS.hashRemoveNode(n3);
          }
          delete e.parent.contents[e.name], r.contents[t3] = e, e.name = t3, r.ctime = r.mtime = e.parent.ctime = e.parent.mtime = Date.now();
        }, unlink(e, r) {
          delete e.contents[r], e.ctime = e.mtime = Date.now();
        }, rmdir(e, r) {
          var t3 = FS.lookupNode(e, r);
          for (var n3 in t3.contents) throw new FS.ErrnoError(55);
          delete e.contents[r], e.ctime = e.mtime = Date.now();
        }, readdir(e) {
          return [".", "..", ...Object.keys(e.contents)];
        }, symlink(e, r, t3) {
          var n3 = MEMFS.createNode(e, r, 41471, 0);
          return n3.link = t3, n3;
        }, readlink(e) {
          if (!FS.isLink(e.mode)) throw new FS.ErrnoError(28);
          return e.link;
        } }, stream_ops: { read(e, r, t3, n3, o5) {
          var a3 = e.node.contents;
          if (o5 >= e.node.usedBytes) return 0;
          var s5 = Math.min(e.node.usedBytes - o5, n3);
          if (s5 > 8 && a3.subarray) r.set(a3.subarray(o5, o5 + s5), t3);
          else for (var l2 = 0; l2 < s5; l2++) r[t3 + l2] = a3[o5 + l2];
          return s5;
        }, write(e, r, t3, n3, o5, a3) {
          if (r.buffer === HEAP8.buffer && (a3 = false), !n3) return 0;
          var s5 = e.node;
          if (s5.mtime = s5.ctime = Date.now(), r.subarray && (!s5.contents || s5.contents.subarray)) {
            if (a3) return s5.contents = r.subarray(t3, t3 + n3), s5.usedBytes = n3, n3;
            if (s5.usedBytes === 0 && o5 === 0) return s5.contents = r.slice(t3, t3 + n3), s5.usedBytes = n3, n3;
            if (o5 + n3 <= s5.usedBytes) return s5.contents.set(r.subarray(t3, t3 + n3), o5), n3;
          }
          if (MEMFS.expandFileStorage(s5, o5 + n3), s5.contents.subarray && r.subarray) s5.contents.set(r.subarray(t3, t3 + n3), o5);
          else for (var l2 = 0; l2 < n3; l2++) s5.contents[o5 + l2] = r[t3 + l2];
          return s5.usedBytes = Math.max(s5.usedBytes, o5 + n3), n3;
        }, llseek(e, r, t3) {
          var n3 = r;
          if (t3 === 1 ? n3 += e.position : t3 === 2 && FS.isFile(e.node.mode) && (n3 += e.node.usedBytes), n3 < 0) throw new FS.ErrnoError(28);
          return n3;
        }, allocate(e, r, t3) {
          MEMFS.expandFileStorage(e.node, r + t3), e.node.usedBytes = Math.max(e.node.usedBytes, r + t3);
        }, mmap(e, r, t3, n3, o5) {
          if (!FS.isFile(e.node.mode)) throw new FS.ErrnoError(43);
          var a3, s5, l2 = e.node.contents;
          if (!(o5 & 2) && l2 && l2.buffer === HEAP8.buffer) s5 = false, a3 = l2.byteOffset;
          else {
            if (s5 = true, a3 = mmapAlloc(r), !a3) throw new FS.ErrnoError(48);
            l2 && ((t3 > 0 || t3 + r < l2.length) && (l2.subarray ? l2 = l2.subarray(t3, t3 + r) : l2 = Array.prototype.slice.call(l2, t3, t3 + r)), HEAP8.set(l2, a3));
          }
          return { ptr: a3, allocated: s5 };
        }, msync(e, r, t3, n3, o5) {
          return MEMFS.stream_ops.write(e, r, 0, n3, t3, false), 0;
        } } }, FS_createDataFile = (e, r, t3, n3, o5, a3) => {
          FS.createDataFile(e, r, t3, n3, o5, a3);
        }, FS_handledByPreloadPlugin = (e, r, t3, n3) => {
          typeof Browser < "u" && Browser.init();
          var o5 = false;
          return preloadPlugins.forEach((a3) => {
            o5 || a3.canHandle(r) && (a3.handle(e, r, t3, n3), o5 = true);
          }), o5;
        }, FS_createPreloadedFile = (e, r, t3, n3, o5, a3, s5, l2, u3, d3) => {
          var c4 = r ? PATH_FS.resolve(PATH.join2(e, r)) : e, p6 = `cp ${c4}`;
          function f5(m5) {
            function _4(g4) {
              d3?.(), l2 || FS_createDataFile(e, r, g4, n3, o5, u3), a3?.(), removeRunDependency(p6);
            }
            FS_handledByPreloadPlugin(m5, c4, _4, () => {
              s5?.(), removeRunDependency(p6);
            }) || _4(m5);
          }
          addRunDependency(p6), typeof t3 == "string" ? asyncLoad(t3).then(f5, s5) : f5(t3);
        }, FS_modeStringToFlags = (e) => {
          var r = { r: 0, "r+": 2, w: 577, "w+": 578, a: 1089, "a+": 1090 }, t3 = r[e];
          if (typeof t3 > "u") throw new Error(`Unknown file open mode: ${e}`);
          return t3;
        }, FS_getMode = (e, r) => {
          var t3 = 0;
          return e && (t3 |= 365), r && (t3 |= 146), t3;
        }, ERRNO_CODES = { EPERM: 63, ENOENT: 44, ESRCH: 71, EINTR: 27, EIO: 29, ENXIO: 60, E2BIG: 1, ENOEXEC: 45, EBADF: 8, ECHILD: 12, EAGAIN: 6, EWOULDBLOCK: 6, ENOMEM: 48, EACCES: 2, EFAULT: 21, ENOTBLK: 105, EBUSY: 10, EEXIST: 20, EXDEV: 75, ENODEV: 43, ENOTDIR: 54, EISDIR: 31, EINVAL: 28, ENFILE: 41, EMFILE: 33, ENOTTY: 59, ETXTBSY: 74, EFBIG: 22, ENOSPC: 51, ESPIPE: 70, EROFS: 69, EMLINK: 34, EPIPE: 64, EDOM: 18, ERANGE: 68, ENOMSG: 49, EIDRM: 24, ECHRNG: 106, EL2NSYNC: 156, EL3HLT: 107, EL3RST: 108, ELNRNG: 109, EUNATCH: 110, ENOCSI: 111, EL2HLT: 112, EDEADLK: 16, ENOLCK: 46, EBADE: 113, EBADR: 114, EXFULL: 115, ENOANO: 104, EBADRQC: 103, EBADSLT: 102, EDEADLOCK: 16, EBFONT: 101, ENOSTR: 100, ENODATA: 116, ETIME: 117, ENOSR: 118, ENONET: 119, ENOPKG: 120, EREMOTE: 121, ENOLINK: 47, EADV: 122, ESRMNT: 123, ECOMM: 124, EPROTO: 65, EMULTIHOP: 36, EDOTDOT: 125, EBADMSG: 9, ENOTUNIQ: 126, EBADFD: 127, EREMCHG: 128, ELIBACC: 129, ELIBBAD: 130, ELIBSCN: 131, ELIBMAX: 132, ELIBEXEC: 133, ENOSYS: 52, ENOTEMPTY: 55, ENAMETOOLONG: 37, ELOOP: 32, EOPNOTSUPP: 138, EPFNOSUPPORT: 139, ECONNRESET: 15, ENOBUFS: 42, EAFNOSUPPORT: 5, EPROTOTYPE: 67, ENOTSOCK: 57, ENOPROTOOPT: 50, ESHUTDOWN: 140, ECONNREFUSED: 14, EADDRINUSE: 3, ECONNABORTED: 13, ENETUNREACH: 40, ENETDOWN: 38, ETIMEDOUT: 73, EHOSTDOWN: 142, EHOSTUNREACH: 23, EINPROGRESS: 26, EALREADY: 7, EDESTADDRREQ: 17, EMSGSIZE: 35, EPROTONOSUPPORT: 66, ESOCKTNOSUPPORT: 137, EADDRNOTAVAIL: 4, ENETRESET: 39, EISCONN: 30, ENOTCONN: 53, ETOOMANYREFS: 141, EUSERS: 136, EDQUOT: 19, ESTALE: 72, ENOTSUP: 138, ENOMEDIUM: 148, EILSEQ: 25, EOVERFLOW: 61, ECANCELED: 11, ENOTRECOVERABLE: 56, EOWNERDEAD: 62, ESTRPIPE: 135 }, PROXYFS = { mount(e) {
          return PROXYFS.createNode(null, "/", e.opts.fs.lstat(e.opts.root).mode, 0);
        }, createNode(e, r, t3, n3) {
          if (!FS.isDir(t3) && !FS.isFile(t3) && !FS.isLink(t3)) throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          var o5 = FS.createNode(e, r, t3);
          return o5.node_ops = PROXYFS.node_ops, o5.stream_ops = PROXYFS.stream_ops, o5;
        }, realPath(e) {
          for (var r = []; e.parent !== e; ) r.push(e.name), e = e.parent;
          return r.push(e.mount.opts.root), r.reverse(), PATH.join(...r);
        }, node_ops: { getattr(e) {
          var r = PROXYFS.realPath(e), t3;
          try {
            t3 = e.mount.opts.fs.lstat(r);
          } catch (n3) {
            throw n3.code ? new FS.ErrnoError(ERRNO_CODES[n3.code]) : n3;
          }
          return { dev: t3.dev, ino: t3.ino, mode: t3.mode, nlink: t3.nlink, uid: t3.uid, gid: t3.gid, rdev: t3.rdev, size: t3.size, atime: t3.atime, mtime: t3.mtime, ctime: t3.ctime, blksize: t3.blksize, blocks: t3.blocks };
        }, setattr(e, r) {
          var t3 = PROXYFS.realPath(e);
          try {
            if (r.mode !== void 0 && (e.mount.opts.fs.chmod(t3, r.mode), e.mode = r.mode), r.atime || r.mtime) {
              var n3 = new Date(r.atime || r.mtime), o5 = new Date(r.mtime || r.atime);
              e.mount.opts.fs.utime(t3, n3, o5);
            }
            r.size !== void 0 && e.mount.opts.fs.truncate(t3, r.size);
          } catch (a3) {
            throw a3.code ? new FS.ErrnoError(ERRNO_CODES[a3.code]) : a3;
          }
        }, lookup(e, r) {
          try {
            var t3 = PATH.join2(PROXYFS.realPath(e), r), n3 = e.mount.opts.fs.lstat(t3).mode, o5 = PROXYFS.createNode(e, r, n3);
            return o5;
          } catch (a3) {
            throw a3.code ? new FS.ErrnoError(ERRNO_CODES[a3.code]) : a3;
          }
        }, mknod(e, r, t3, n3) {
          var o5 = PROXYFS.createNode(e, r, t3, n3), a3 = PROXYFS.realPath(o5);
          try {
            FS.isDir(o5.mode) ? o5.mount.opts.fs.mkdir(a3, o5.mode) : o5.mount.opts.fs.writeFile(a3, "", { mode: o5.mode });
          } catch (s5) {
            throw s5.code ? new FS.ErrnoError(ERRNO_CODES[s5.code]) : s5;
          }
          return o5;
        }, rename(e, r, t3) {
          var n3 = PROXYFS.realPath(e), o5 = PATH.join2(PROXYFS.realPath(r), t3);
          try {
            e.mount.opts.fs.rename(n3, o5), e.name = t3;
          } catch (a3) {
            throw a3.code ? new FS.ErrnoError(ERRNO_CODES[a3.code]) : a3;
          }
        }, unlink(e, r) {
          var t3 = PATH.join2(PROXYFS.realPath(e), r);
          try {
            e.mount.opts.fs.unlink(t3);
          } catch (n3) {
            throw n3.code ? new FS.ErrnoError(ERRNO_CODES[n3.code]) : n3;
          }
        }, rmdir(e, r) {
          var t3 = PATH.join2(PROXYFS.realPath(e), r);
          try {
            e.mount.opts.fs.rmdir(t3);
          } catch (n3) {
            throw n3.code ? new FS.ErrnoError(ERRNO_CODES[n3.code]) : n3;
          }
        }, readdir(e) {
          var r = PROXYFS.realPath(e);
          try {
            return e.mount.opts.fs.readdir(r);
          } catch (t3) {
            throw t3.code ? new FS.ErrnoError(ERRNO_CODES[t3.code]) : t3;
          }
        }, symlink(e, r, t3) {
          var n3 = PATH.join2(PROXYFS.realPath(e), r);
          try {
            e.mount.opts.fs.symlink(t3, n3);
          } catch (o5) {
            throw o5.code ? new FS.ErrnoError(ERRNO_CODES[o5.code]) : o5;
          }
        }, readlink(e) {
          var r = PROXYFS.realPath(e);
          try {
            return e.mount.opts.fs.readlink(r);
          } catch (t3) {
            throw t3.code ? new FS.ErrnoError(ERRNO_CODES[t3.code]) : t3;
          }
        } }, stream_ops: { open(e) {
          var r = PROXYFS.realPath(e.node);
          try {
            e.nfd = e.node.mount.opts.fs.open(r, e.flags);
          } catch (t3) {
            throw t3.code ? new FS.ErrnoError(ERRNO_CODES[t3.code]) : t3;
          }
        }, close(e) {
          try {
            e.node.mount.opts.fs.close(e.nfd);
          } catch (r) {
            throw r.code ? new FS.ErrnoError(ERRNO_CODES[r.code]) : r;
          }
        }, read(e, r, t3, n3, o5) {
          try {
            return e.node.mount.opts.fs.read(e.nfd, r, t3, n3, o5);
          } catch (a3) {
            throw a3.code ? new FS.ErrnoError(ERRNO_CODES[a3.code]) : a3;
          }
        }, write(e, r, t3, n3, o5) {
          try {
            return e.node.mount.opts.fs.write(e.nfd, r, t3, n3, o5);
          } catch (a3) {
            throw a3.code ? new FS.ErrnoError(ERRNO_CODES[a3.code]) : a3;
          }
        }, llseek(e, r, t3) {
          var n3 = r;
          if (t3 === 1) n3 += e.position;
          else if (t3 === 2 && FS.isFile(e.node.mode)) try {
            var o5 = e.node.node_ops.getattr(e.node);
            n3 += o5.size;
          } catch (a3) {
            throw new FS.ErrnoError(ERRNO_CODES[a3.code]);
          }
          if (n3 < 0) throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          return n3;
        } } }, FS = { root: null, mounts: [], devices: {}, streams: [], nextInode: 1, nameTable: null, currentPath: "/", initialized: false, ignorePermissions: true, ErrnoError: class {
          constructor(e) {
            P(this, "name", "ErrnoError");
            this.errno = e;
          }
        }, filesystems: null, syncFSRequests: 0, readFiles: {}, FSStream: class {
          constructor() {
            P(this, "shared", {});
          }
          get object() {
            return this.node;
          }
          set object(e) {
            this.node = e;
          }
          get isRead() {
            return (this.flags & 2097155) !== 1;
          }
          get isWrite() {
            return (this.flags & 2097155) !== 0;
          }
          get isAppend() {
            return this.flags & 1024;
          }
          get flags() {
            return this.shared.flags;
          }
          set flags(e) {
            this.shared.flags = e;
          }
          get position() {
            return this.shared.position;
          }
          set position(e) {
            this.shared.position = e;
          }
        }, FSNode: class {
          constructor(e, r, t3, n3) {
            P(this, "node_ops", {});
            P(this, "stream_ops", {});
            P(this, "readMode", 365);
            P(this, "writeMode", 146);
            P(this, "mounted", null);
            e || (e = this), this.parent = e, this.mount = e.mount, this.id = FS.nextInode++, this.name = r, this.mode = t3, this.rdev = n3, this.atime = this.mtime = this.ctime = Date.now();
          }
          get read() {
            return (this.mode & this.readMode) === this.readMode;
          }
          set read(e) {
            e ? this.mode |= this.readMode : this.mode &= ~this.readMode;
          }
          get write() {
            return (this.mode & this.writeMode) === this.writeMode;
          }
          set write(e) {
            e ? this.mode |= this.writeMode : this.mode &= ~this.writeMode;
          }
          get isFolder() {
            return FS.isDir(this.mode);
          }
          get isDevice() {
            return FS.isChrdev(this.mode);
          }
        }, lookupPath(e, r = {}) {
          if (!e) return { path: "", node: null };
          r.follow_mount ?? (r.follow_mount = true), PATH.isAbs(e) || (e = FS.cwd() + "/" + e);
          e: for (var t3 = 0; t3 < 40; t3++) {
            for (var n3 = e.split("/").filter((d3) => !!d3 && d3 !== "."), o5 = FS.root, a3 = "/", s5 = 0; s5 < n3.length; s5++) {
              var l2 = s5 === n3.length - 1;
              if (l2 && r.parent) break;
              if (n3[s5] === "..") {
                a3 = PATH.dirname(a3), o5 = o5.parent;
                continue;
              }
              a3 = PATH.join2(a3, n3[s5]);
              try {
                o5 = FS.lookupNode(o5, n3[s5]);
              } catch (d3) {
                if (d3?.errno === 44 && l2 && r.noent_okay) return { path: a3 };
                throw d3;
              }
              if (FS.isMountpoint(o5) && (!l2 || r.follow_mount) && (o5 = o5.mounted.root), FS.isLink(o5.mode) && (!l2 || r.follow)) {
                if (!o5.node_ops.readlink) throw new FS.ErrnoError(52);
                var u3 = o5.node_ops.readlink(o5);
                PATH.isAbs(u3) || (u3 = PATH.dirname(a3) + "/" + u3), e = u3 + "/" + n3.slice(s5 + 1).join("/");
                continue e;
              }
            }
            return { path: a3, node: o5 };
          }
          throw new FS.ErrnoError(32);
        }, getPath(e) {
          for (var r; ; ) {
            if (FS.isRoot(e)) {
              var t3 = e.mount.mountpoint;
              return r ? t3[t3.length - 1] !== "/" ? `${t3}/${r}` : t3 + r : t3;
            }
            r = r ? `${e.name}/${r}` : e.name, e = e.parent;
          }
        }, hashName(e, r) {
          for (var t3 = 0, n3 = 0; n3 < r.length; n3++) t3 = (t3 << 5) - t3 + r.charCodeAt(n3) | 0;
          return (e + t3 >>> 0) % FS.nameTable.length;
        }, hashAddNode(e) {
          var r = FS.hashName(e.parent.id, e.name);
          e.name_next = FS.nameTable[r], FS.nameTable[r] = e;
        }, hashRemoveNode(e) {
          var r = FS.hashName(e.parent.id, e.name);
          if (FS.nameTable[r] === e) FS.nameTable[r] = e.name_next;
          else for (var t3 = FS.nameTable[r]; t3; ) {
            if (t3.name_next === e) {
              t3.name_next = e.name_next;
              break;
            }
            t3 = t3.name_next;
          }
        }, lookupNode(e, r) {
          var t3 = FS.mayLookup(e);
          if (t3) throw new FS.ErrnoError(t3);
          for (var n3 = FS.hashName(e.id, r), o5 = FS.nameTable[n3]; o5; o5 = o5.name_next) {
            var a3 = o5.name;
            if (o5.parent.id === e.id && a3 === r) return o5;
          }
          return FS.lookup(e, r);
        }, createNode(e, r, t3, n3) {
          var o5 = new FS.FSNode(e, r, t3, n3);
          return FS.hashAddNode(o5), o5;
        }, destroyNode(e) {
          FS.hashRemoveNode(e);
        }, isRoot(e) {
          return e === e.parent;
        }, isMountpoint(e) {
          return !!e.mounted;
        }, isFile(e) {
          return (e & 61440) === 32768;
        }, isDir(e) {
          return (e & 61440) === 16384;
        }, isLink(e) {
          return (e & 61440) === 40960;
        }, isChrdev(e) {
          return (e & 61440) === 8192;
        }, isBlkdev(e) {
          return (e & 61440) === 24576;
        }, isFIFO(e) {
          return (e & 61440) === 4096;
        }, isSocket(e) {
          return (e & 49152) === 49152;
        }, flagsToPermissionString(e) {
          var r = ["r", "w", "rw"][e & 3];
          return e & 512 && (r += "w"), r;
        }, nodePermissions(e, r) {
          return FS.ignorePermissions ? 0 : r.includes("r") && !(e.mode & 292) || r.includes("w") && !(e.mode & 146) || r.includes("x") && !(e.mode & 73) ? 2 : 0;
        }, mayLookup(e) {
          if (!FS.isDir(e.mode)) return 54;
          var r = FS.nodePermissions(e, "x");
          return r || (e.node_ops.lookup ? 0 : 2);
        }, mayCreate(e, r) {
          if (!FS.isDir(e.mode)) return 54;
          try {
            var t3 = FS.lookupNode(e, r);
            return 20;
          } catch {
          }
          return FS.nodePermissions(e, "wx");
        }, mayDelete(e, r, t3) {
          var n3;
          try {
            n3 = FS.lookupNode(e, r);
          } catch (a3) {
            return a3.errno;
          }
          var o5 = FS.nodePermissions(e, "wx");
          if (o5) return o5;
          if (t3) {
            if (!FS.isDir(n3.mode)) return 54;
            if (FS.isRoot(n3) || FS.getPath(n3) === FS.cwd()) return 10;
          } else if (FS.isDir(n3.mode)) return 31;
          return 0;
        }, mayOpen(e, r) {
          return e ? FS.isLink(e.mode) ? 32 : FS.isDir(e.mode) && (FS.flagsToPermissionString(r) !== "r" || r & 512) ? 31 : FS.nodePermissions(e, FS.flagsToPermissionString(r)) : 44;
        }, MAX_OPEN_FDS: 4096, nextfd() {
          for (var e = 0; e <= FS.MAX_OPEN_FDS; e++) if (!FS.streams[e]) return e;
          throw new FS.ErrnoError(33);
        }, getStreamChecked(e) {
          var r = FS.getStream(e);
          if (!r) throw new FS.ErrnoError(8);
          return r;
        }, getStream: (e) => FS.streams[e], createStream(e, r = -1) {
          return e = Object.assign(new FS.FSStream(), e), r == -1 && (r = FS.nextfd()), e.fd = r, FS.streams[r] = e, e;
        }, closeStream(e) {
          FS.streams[e] = null;
        }, dupStream(e, r = -1) {
          var t3 = FS.createStream(e, r);
          return t3.stream_ops?.dup?.(t3), t3;
        }, chrdev_stream_ops: { open(e) {
          var r = FS.getDevice(e.node.rdev);
          e.stream_ops = r.stream_ops, e.stream_ops.open?.(e);
        }, llseek() {
          throw new FS.ErrnoError(70);
        } }, major: (e) => e >> 8, minor: (e) => e & 255, makedev: (e, r) => e << 8 | r, registerDevice(e, r) {
          FS.devices[e] = { stream_ops: r };
        }, getDevice: (e) => FS.devices[e], getMounts(e) {
          for (var r = [], t3 = [e]; t3.length; ) {
            var n3 = t3.pop();
            r.push(n3), t3.push(...n3.mounts);
          }
          return r;
        }, syncfs(e, r) {
          typeof e == "function" && (r = e, e = false), FS.syncFSRequests++, FS.syncFSRequests > 1 && err(`warning: ${FS.syncFSRequests} FS.syncfs operations in flight at once, probably just doing extra work`);
          var t3 = FS.getMounts(FS.root.mount), n3 = 0;
          function o5(s5) {
            return FS.syncFSRequests--, r(s5);
          }
          function a3(s5) {
            if (s5) return a3.errored ? void 0 : (a3.errored = true, o5(s5));
            ++n3 >= t3.length && o5(null);
          }
          t3.forEach((s5) => {
            if (!s5.type.syncfs) return a3(null);
            s5.type.syncfs(s5, e, a3);
          });
        }, mount(e, r, t3) {
          var n3 = t3 === "/", o5 = !t3, a3;
          if (n3 && FS.root) throw new FS.ErrnoError(10);
          if (!n3 && !o5) {
            var s5 = FS.lookupPath(t3, { follow_mount: false });
            if (t3 = s5.path, a3 = s5.node, FS.isMountpoint(a3)) throw new FS.ErrnoError(10);
            if (!FS.isDir(a3.mode)) throw new FS.ErrnoError(54);
          }
          var l2 = { type: e, opts: r, mountpoint: t3, mounts: [] }, u3 = e.mount(l2);
          return u3.mount = l2, l2.root = u3, n3 ? FS.root = u3 : a3 && (a3.mounted = l2, a3.mount && a3.mount.mounts.push(l2)), u3;
        }, unmount(e) {
          var r = FS.lookupPath(e, { follow_mount: false });
          if (!FS.isMountpoint(r.node)) throw new FS.ErrnoError(28);
          var t3 = r.node, n3 = t3.mounted, o5 = FS.getMounts(n3);
          Object.keys(FS.nameTable).forEach((s5) => {
            for (var l2 = FS.nameTable[s5]; l2; ) {
              var u3 = l2.name_next;
              o5.includes(l2.mount) && FS.destroyNode(l2), l2 = u3;
            }
          }), t3.mounted = null;
          var a3 = t3.mount.mounts.indexOf(n3);
          t3.mount.mounts.splice(a3, 1);
        }, lookup(e, r) {
          return e.node_ops.lookup(e, r);
        }, mknod(e, r, t3) {
          var n3 = FS.lookupPath(e, { parent: true }), o5 = n3.node, a3 = PATH.basename(e);
          if (!a3 || a3 === "." || a3 === "..") throw new FS.ErrnoError(28);
          var s5 = FS.mayCreate(o5, a3);
          if (s5) throw new FS.ErrnoError(s5);
          if (!o5.node_ops.mknod) throw new FS.ErrnoError(63);
          return o5.node_ops.mknod(o5, a3, r, t3);
        }, statfs(e) {
          var r = { bsize: 4096, frsize: 4096, blocks: 1e6, bfree: 5e5, bavail: 5e5, files: FS.nextInode, ffree: FS.nextInode - 1, fsid: 42, flags: 2, namelen: 255 }, t3 = FS.lookupPath(e, { follow: true }).node;
          return t3?.node_ops.statfs && Object.assign(r, t3.node_ops.statfs(t3.mount.opts.root)), r;
        }, create(e, r = 438) {
          return r &= 4095, r |= 32768, FS.mknod(e, r, 0);
        }, mkdir(e, r = 511) {
          return r &= 1023, r |= 16384, FS.mknod(e, r, 0);
        }, mkdirTree(e, r) {
          for (var t3 = e.split("/"), n3 = "", o5 = 0; o5 < t3.length; ++o5) if (t3[o5]) {
            n3 += "/" + t3[o5];
            try {
              FS.mkdir(n3, r);
            } catch (a3) {
              if (a3.errno != 20) throw a3;
            }
          }
        }, mkdev(e, r, t3) {
          return typeof t3 > "u" && (t3 = r, r = 438), r |= 8192, FS.mknod(e, r, t3);
        }, symlink(e, r) {
          if (!PATH_FS.resolve(e)) throw new FS.ErrnoError(44);
          var t3 = FS.lookupPath(r, { parent: true }), n3 = t3.node;
          if (!n3) throw new FS.ErrnoError(44);
          var o5 = PATH.basename(r), a3 = FS.mayCreate(n3, o5);
          if (a3) throw new FS.ErrnoError(a3);
          if (!n3.node_ops.symlink) throw new FS.ErrnoError(63);
          return n3.node_ops.symlink(n3, o5, e);
        }, rename(e, r) {
          var t3 = PATH.dirname(e), n3 = PATH.dirname(r), o5 = PATH.basename(e), a3 = PATH.basename(r), s5, l2, u3;
          if (s5 = FS.lookupPath(e, { parent: true }), l2 = s5.node, s5 = FS.lookupPath(r, { parent: true }), u3 = s5.node, !l2 || !u3) throw new FS.ErrnoError(44);
          if (l2.mount !== u3.mount) throw new FS.ErrnoError(75);
          var d3 = FS.lookupNode(l2, o5), c4 = PATH_FS.relative(e, n3);
          if (c4.charAt(0) !== ".") throw new FS.ErrnoError(28);
          if (c4 = PATH_FS.relative(r, t3), c4.charAt(0) !== ".") throw new FS.ErrnoError(55);
          var p6;
          try {
            p6 = FS.lookupNode(u3, a3);
          } catch {
          }
          if (d3 !== p6) {
            var f5 = FS.isDir(d3.mode), m5 = FS.mayDelete(l2, o5, f5);
            if (m5) throw new FS.ErrnoError(m5);
            if (m5 = p6 ? FS.mayDelete(u3, a3, f5) : FS.mayCreate(u3, a3), m5) throw new FS.ErrnoError(m5);
            if (!l2.node_ops.rename) throw new FS.ErrnoError(63);
            if (FS.isMountpoint(d3) || p6 && FS.isMountpoint(p6)) throw new FS.ErrnoError(10);
            if (u3 !== l2 && (m5 = FS.nodePermissions(l2, "w"), m5)) throw new FS.ErrnoError(m5);
            FS.hashRemoveNode(d3);
            try {
              l2.node_ops.rename(d3, u3, a3), d3.parent = u3;
            } catch (_4) {
              throw _4;
            } finally {
              FS.hashAddNode(d3);
            }
          }
        }, rmdir(e) {
          var r = FS.lookupPath(e, { parent: true }), t3 = r.node, n3 = PATH.basename(e), o5 = FS.lookupNode(t3, n3), a3 = FS.mayDelete(t3, n3, true);
          if (a3) throw new FS.ErrnoError(a3);
          if (!t3.node_ops.rmdir) throw new FS.ErrnoError(63);
          if (FS.isMountpoint(o5)) throw new FS.ErrnoError(10);
          t3.node_ops.rmdir(t3, n3), FS.destroyNode(o5);
        }, readdir(e) {
          var r = FS.lookupPath(e, { follow: true }), t3 = r.node;
          if (!t3.node_ops.readdir) throw new FS.ErrnoError(54);
          return t3.node_ops.readdir(t3);
        }, unlink(e) {
          var r = FS.lookupPath(e, { parent: true }), t3 = r.node;
          if (!t3) throw new FS.ErrnoError(44);
          var n3 = PATH.basename(e), o5 = FS.lookupNode(t3, n3), a3 = FS.mayDelete(t3, n3, false);
          if (a3) throw new FS.ErrnoError(a3);
          if (!t3.node_ops.unlink) throw new FS.ErrnoError(63);
          if (FS.isMountpoint(o5)) throw new FS.ErrnoError(10);
          t3.node_ops.unlink(t3, n3), FS.destroyNode(o5);
        }, readlink(e) {
          var r = FS.lookupPath(e), t3 = r.node;
          if (!t3) throw new FS.ErrnoError(44);
          if (!t3.node_ops.readlink) throw new FS.ErrnoError(28);
          return t3.node_ops.readlink(t3);
        }, stat(e, r) {
          var t3 = FS.lookupPath(e, { follow: !r }), n3 = t3.node;
          if (!n3) throw new FS.ErrnoError(44);
          if (!n3.node_ops.getattr) throw new FS.ErrnoError(63);
          return n3.node_ops.getattr(n3);
        }, lstat(e) {
          return FS.stat(e, true);
        }, chmod(e, r, t3) {
          var n3;
          if (typeof e == "string") {
            var o5 = FS.lookupPath(e, { follow: !t3 });
            n3 = o5.node;
          } else n3 = e;
          if (!n3.node_ops.setattr) throw new FS.ErrnoError(63);
          n3.node_ops.setattr(n3, { mode: r & 4095 | n3.mode & -4096, ctime: Date.now() });
        }, lchmod(e, r) {
          FS.chmod(e, r, true);
        }, fchmod(e, r) {
          var t3 = FS.getStreamChecked(e);
          FS.chmod(t3.node, r);
        }, chown(e, r, t3, n3) {
          var o5;
          if (typeof e == "string") {
            var a3 = FS.lookupPath(e, { follow: !n3 });
            o5 = a3.node;
          } else o5 = e;
          if (!o5.node_ops.setattr) throw new FS.ErrnoError(63);
          o5.node_ops.setattr(o5, { timestamp: Date.now() });
        }, lchown(e, r, t3) {
          FS.chown(e, r, t3, true);
        }, fchown(e, r, t3) {
          var n3 = FS.getStreamChecked(e);
          FS.chown(n3.node, r, t3);
        }, truncate(e, r) {
          if (r < 0) throw new FS.ErrnoError(28);
          var t3;
          if (typeof e == "string") {
            var n3 = FS.lookupPath(e, { follow: true });
            t3 = n3.node;
          } else t3 = e;
          if (!t3.node_ops.setattr) throw new FS.ErrnoError(63);
          if (FS.isDir(t3.mode)) throw new FS.ErrnoError(31);
          if (!FS.isFile(t3.mode)) throw new FS.ErrnoError(28);
          var o5 = FS.nodePermissions(t3, "w");
          if (o5) throw new FS.ErrnoError(o5);
          t3.node_ops.setattr(t3, { size: r, timestamp: Date.now() });
        }, ftruncate(e, r) {
          var t3 = FS.getStreamChecked(e);
          if (!(t3.flags & 2097155)) throw new FS.ErrnoError(28);
          FS.truncate(t3.node, r);
        }, utime(e, r, t3) {
          var n3 = FS.lookupPath(e, { follow: true }), o5 = n3.node;
          o5.node_ops.setattr(o5, { atime: r, mtime: t3 });
        }, open(e, r, t3 = 438) {
          if (e === "") throw new FS.ErrnoError(44);
          r = typeof r == "string" ? FS_modeStringToFlags(r) : r, r & 64 ? t3 = t3 & 4095 | 32768 : t3 = 0;
          var n3;
          if (typeof e == "object") n3 = e;
          else {
            var o5 = FS.lookupPath(e, { follow: !(r & 131072), noent_okay: true });
            n3 = o5.node, e = o5.path;
          }
          var a3 = false;
          if (r & 64) if (n3) {
            if (r & 128) throw new FS.ErrnoError(20);
          } else n3 = FS.mknod(e, t3, 0), a3 = true;
          if (!n3) throw new FS.ErrnoError(44);
          if (FS.isChrdev(n3.mode) && (r &= -513), r & 65536 && !FS.isDir(n3.mode)) throw new FS.ErrnoError(54);
          if (!a3) {
            var s5 = FS.mayOpen(n3, r);
            if (s5) throw new FS.ErrnoError(s5);
          }
          r & 512 && !a3 && FS.truncate(n3, 0), r &= -131713;
          var l2 = FS.createStream({ node: n3, path: FS.getPath(n3), flags: r, seekable: true, position: 0, stream_ops: n3.stream_ops, ungotten: [], error: false });
          return l2.stream_ops.open && l2.stream_ops.open(l2), Module.logReadFiles && !(r & 1) && (e in FS.readFiles || (FS.readFiles[e] = 1)), l2;
        }, close(e) {
          if (FS.isClosed(e)) throw new FS.ErrnoError(8);
          e.getdents && (e.getdents = null);
          try {
            e.stream_ops.close && e.stream_ops.close(e);
          } catch (r) {
            throw r;
          } finally {
            FS.closeStream(e.fd);
          }
          e.fd = null;
        }, isClosed(e) {
          return e.fd === null;
        }, llseek(e, r, t3) {
          if (FS.isClosed(e)) throw new FS.ErrnoError(8);
          if (!e.seekable || !e.stream_ops.llseek) throw new FS.ErrnoError(70);
          if (t3 != 0 && t3 != 1 && t3 != 2) throw new FS.ErrnoError(28);
          return e.position = e.stream_ops.llseek(e, r, t3), e.ungotten = [], e.position;
        }, read(e, r, t3, n3, o5) {
          if (n3 < 0 || o5 < 0) throw new FS.ErrnoError(28);
          if (FS.isClosed(e)) throw new FS.ErrnoError(8);
          if ((e.flags & 2097155) === 1) throw new FS.ErrnoError(8);
          if (FS.isDir(e.node.mode)) throw new FS.ErrnoError(31);
          if (!e.stream_ops.read) throw new FS.ErrnoError(28);
          var a3 = typeof o5 < "u";
          if (!a3) o5 = e.position;
          else if (!e.seekable) throw new FS.ErrnoError(70);
          var s5 = e.stream_ops.read(e, r, t3, n3, o5);
          return a3 || (e.position += s5), s5;
        }, write(e, r, t3, n3, o5, a3) {
          if (n3 < 0 || o5 < 0) throw new FS.ErrnoError(28);
          if (FS.isClosed(e)) throw new FS.ErrnoError(8);
          if (!(e.flags & 2097155)) throw new FS.ErrnoError(8);
          if (FS.isDir(e.node.mode)) throw new FS.ErrnoError(31);
          if (!e.stream_ops.write) throw new FS.ErrnoError(28);
          e.seekable && e.flags & 1024 && FS.llseek(e, 0, 2);
          var s5 = typeof o5 < "u";
          if (!s5) o5 = e.position;
          else if (!e.seekable) throw new FS.ErrnoError(70);
          var l2 = e.stream_ops.write(e, r, t3, n3, o5, a3);
          return s5 || (e.position += l2), l2;
        }, allocate(e, r, t3) {
          if (FS.isClosed(e)) throw new FS.ErrnoError(8);
          if (r < 0 || t3 <= 0) throw new FS.ErrnoError(28);
          if (!(e.flags & 2097155)) throw new FS.ErrnoError(8);
          if (!FS.isFile(e.node.mode) && !FS.isDir(e.node.mode)) throw new FS.ErrnoError(43);
          if (!e.stream_ops.allocate) throw new FS.ErrnoError(138);
          e.stream_ops.allocate(e, r, t3);
        }, mmap(e, r, t3, n3, o5) {
          if (n3 & 2 && !(o5 & 2) && (e.flags & 2097155) !== 2) throw new FS.ErrnoError(2);
          if ((e.flags & 2097155) === 1) throw new FS.ErrnoError(2);
          if (!e.stream_ops.mmap) throw new FS.ErrnoError(43);
          if (!r) throw new FS.ErrnoError(28);
          return e.stream_ops.mmap(e, r, t3, n3, o5);
        }, msync(e, r, t3, n3, o5) {
          return e.stream_ops.msync ? e.stream_ops.msync(e, r, t3, n3, o5) : 0;
        }, ioctl(e, r, t3) {
          if (!e.stream_ops.ioctl) throw new FS.ErrnoError(59);
          return e.stream_ops.ioctl(e, r, t3);
        }, readFile(e, r = {}) {
          if (r.flags = r.flags || 0, r.encoding = r.encoding || "binary", r.encoding !== "utf8" && r.encoding !== "binary") throw new Error(`Invalid encoding type "${r.encoding}"`);
          var t3, n3 = FS.open(e, r.flags), o5 = FS.stat(e), a3 = o5.size, s5 = new Uint8Array(a3);
          return FS.read(n3, s5, 0, a3, 0), r.encoding === "utf8" ? t3 = UTF8ArrayToString(s5) : r.encoding === "binary" && (t3 = s5), FS.close(n3), t3;
        }, writeFile(e, r, t3 = {}) {
          t3.flags = t3.flags || 577;
          var n3 = FS.open(e, t3.flags, t3.mode);
          if (typeof r == "string") {
            var o5 = new Uint8Array(lengthBytesUTF8(r) + 1), a3 = stringToUTF8Array(r, o5, 0, o5.length);
            FS.write(n3, o5, 0, a3, void 0, t3.canOwn);
          } else if (ArrayBuffer.isView(r)) FS.write(n3, r, 0, r.byteLength, void 0, t3.canOwn);
          else throw new Error("Unsupported data type");
          FS.close(n3);
        }, cwd: () => FS.currentPath, chdir(e) {
          var r = FS.lookupPath(e, { follow: true });
          if (r.node === null) throw new FS.ErrnoError(44);
          if (!FS.isDir(r.node.mode)) throw new FS.ErrnoError(54);
          var t3 = FS.nodePermissions(r.node, "x");
          if (t3) throw new FS.ErrnoError(t3);
          FS.currentPath = r.path;
        }, createDefaultDirectories() {
          FS.mkdir("/tmp"), FS.mkdir("/home"), FS.mkdir("/home/web_user");
        }, createDefaultDevices() {
          FS.mkdir("/dev"), FS.registerDevice(FS.makedev(1, 3), { read: () => 0, write: (n3, o5, a3, s5, l2) => s5, llseek: () => 0 }), FS.mkdev("/dev/null", FS.makedev(1, 3)), TTY.register(FS.makedev(5, 0), TTY.default_tty_ops), TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops), FS.mkdev("/dev/tty", FS.makedev(5, 0)), FS.mkdev("/dev/tty1", FS.makedev(6, 0));
          var e = new Uint8Array(1024), r = 0, t3 = () => (r === 0 && (r = randomFill(e).byteLength), e[--r]);
          FS.createDevice("/dev", "random", t3), FS.createDevice("/dev", "urandom", t3), FS.mkdir("/dev/shm"), FS.mkdir("/dev/shm/tmp");
        }, createSpecialDirectories() {
          FS.mkdir("/proc");
          var e = FS.mkdir("/proc/self");
          FS.mkdir("/proc/self/fd"), FS.mount({ mount() {
            var r = FS.createNode(e, "fd", 16895, 73);
            return r.stream_ops = { llseek: MEMFS.stream_ops.llseek }, r.node_ops = { lookup(t3, n3) {
              var o5 = +n3, a3 = FS.getStreamChecked(o5), s5 = { parent: null, mount: { mountpoint: "fake" }, node_ops: { readlink: () => a3.path }, id: o5 + 1 };
              return s5.parent = s5, s5;
            }, readdir() {
              return Array.from(FS.streams.entries()).filter(([t3, n3]) => n3).map(([t3, n3]) => t3.toString());
            } }, r;
          } }, {}, "/proc/self/fd");
        }, createStandardStreams(e, r, t3) {
          e ? FS.createDevice("/dev", "stdin", e) : FS.symlink("/dev/tty", "/dev/stdin"), r ? FS.createDevice("/dev", "stdout", null, r) : FS.symlink("/dev/tty", "/dev/stdout"), t3 ? FS.createDevice("/dev", "stderr", null, t3) : FS.symlink("/dev/tty1", "/dev/stderr");
          var n3 = FS.open("/dev/stdin", 0), o5 = FS.open("/dev/stdout", 1), a3 = FS.open("/dev/stderr", 1);
        }, staticInit() {
          FS.nameTable = new Array(4096), FS.mount(MEMFS, {}, "/"), FS.createDefaultDirectories(), FS.createDefaultDevices(), FS.createSpecialDirectories(), FS.filesystems = { MEMFS, PROXYFS };
        }, init(e, r, t3) {
          FS.initialized = true, e ?? (e = Module.stdin), r ?? (r = Module.stdout), t3 ?? (t3 = Module.stderr), FS.createStandardStreams(e, r, t3);
        }, quit() {
          FS.initialized = false, _fflush(0);
          for (var e = 0; e < FS.streams.length; e++) {
            var r = FS.streams[e];
            r && FS.close(r);
          }
        }, findObject(e, r) {
          var t3 = FS.analyzePath(e, r);
          return t3.exists ? t3.object : null;
        }, analyzePath(e, r) {
          try {
            var t3 = FS.lookupPath(e, { follow: !r });
            e = t3.path;
          } catch {
          }
          var n3 = { isRoot: false, exists: false, error: 0, name: null, path: null, object: null, parentExists: false, parentPath: null, parentObject: null };
          try {
            var t3 = FS.lookupPath(e, { parent: true });
            n3.parentExists = true, n3.parentPath = t3.path, n3.parentObject = t3.node, n3.name = PATH.basename(e), t3 = FS.lookupPath(e, { follow: !r }), n3.exists = true, n3.path = t3.path, n3.object = t3.node, n3.name = t3.node.name, n3.isRoot = t3.path === "/";
          } catch (o5) {
            n3.error = o5.errno;
          }
          return n3;
        }, createPath(e, r, t3, n3) {
          e = typeof e == "string" ? e : FS.getPath(e);
          for (var o5 = r.split("/").reverse(); o5.length; ) {
            var a3 = o5.pop();
            if (a3) {
              var s5 = PATH.join2(e, a3);
              try {
                FS.mkdir(s5);
              } catch {
              }
              e = s5;
            }
          }
          return s5;
        }, createFile(e, r, t3, n3, o5) {
          var a3 = PATH.join2(typeof e == "string" ? e : FS.getPath(e), r), s5 = FS_getMode(n3, o5);
          return FS.create(a3, s5);
        }, createDataFile(e, r, t3, n3, o5, a3) {
          var s5 = r;
          e && (e = typeof e == "string" ? e : FS.getPath(e), s5 = r ? PATH.join2(e, r) : e);
          var l2 = FS_getMode(n3, o5), u3 = FS.create(s5, l2);
          if (t3) {
            if (typeof t3 == "string") {
              for (var d3 = new Array(t3.length), c4 = 0, p6 = t3.length; c4 < p6; ++c4) d3[c4] = t3.charCodeAt(c4);
              t3 = d3;
            }
            FS.chmod(u3, l2 | 146);
            var f5 = FS.open(u3, 577);
            FS.write(f5, t3, 0, t3.length, 0, a3), FS.close(f5), FS.chmod(u3, l2);
          }
        }, createDevice(e, r, t3, n3) {
          var l2;
          var o5 = PATH.join2(typeof e == "string" ? e : FS.getPath(e), r), a3 = FS_getMode(!!t3, !!n3);
          (l2 = FS.createDevice).major ?? (l2.major = 64);
          var s5 = FS.makedev(FS.createDevice.major++, 0);
          return FS.registerDevice(s5, { open(u3) {
            u3.seekable = false;
          }, close(u3) {
            n3?.buffer?.length && n3(10);
          }, read(u3, d3, c4, p6, f5) {
            for (var m5 = 0, _4 = 0; _4 < p6; _4++) {
              var g4;
              try {
                g4 = t3();
              } catch {
                throw new FS.ErrnoError(29);
              }
              if (g4 === void 0 && m5 === 0) throw new FS.ErrnoError(6);
              if (g4 == null) break;
              m5++, d3[c4 + _4] = g4;
            }
            return m5 && (u3.node.atime = Date.now()), m5;
          }, write(u3, d3, c4, p6, f5) {
            for (var m5 = 0; m5 < p6; m5++) try {
              n3(d3[c4 + m5]);
            } catch {
              throw new FS.ErrnoError(29);
            }
            return p6 && (u3.node.mtime = u3.node.ctime = Date.now()), m5;
          } }), FS.mkdev(o5, a3, s5);
        }, forceLoadFile(e) {
          if (e.isDevice || e.isFolder || e.link || e.contents) return true;
          if (typeof XMLHttpRequest < "u") throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
          try {
            e.contents = readBinary(e.url), e.usedBytes = e.contents.length;
          } catch {
            throw new FS.ErrnoError(29);
          }
        }, createLazyFile(e, r, t3, n3, o5) {
          class a3 {
            constructor() {
              P(this, "lengthKnown", false);
              P(this, "chunks", []);
            }
            get(m5) {
              if (!(m5 > this.length - 1 || m5 < 0)) {
                var _4 = m5 % this.chunkSize, g4 = m5 / this.chunkSize | 0;
                return this.getter(g4)[_4];
              }
            }
            setDataGetter(m5) {
              this.getter = m5;
            }
            cacheLength() {
              var m5 = new XMLHttpRequest();
              if (m5.open("HEAD", t3, false), m5.send(null), !(m5.status >= 200 && m5.status < 300 || m5.status === 304)) throw new Error("Couldn't load " + t3 + ". Status: " + m5.status);
              var _4 = Number(m5.getResponseHeader("Content-length")), g4, E3 = (g4 = m5.getResponseHeader("Accept-Ranges")) && g4 === "bytes", y5 = (g4 = m5.getResponseHeader("Content-Encoding")) && g4 === "gzip", A3 = 1024 * 1024;
              E3 || (A3 = _4);
              var S5 = (h3, b4) => {
                if (h3 > b4) throw new Error("invalid range (" + h3 + ", " + b4 + ") or no bytes requested!");
                if (b4 > _4 - 1) throw new Error("only " + _4 + " bytes available! programmer error!");
                var F4 = new XMLHttpRequest();
                if (F4.open("GET", t3, false), _4 !== A3 && F4.setRequestHeader("Range", "bytes=" + h3 + "-" + b4), F4.responseType = "arraybuffer", F4.overrideMimeType && F4.overrideMimeType("text/plain; charset=x-user-defined"), F4.send(null), !(F4.status >= 200 && F4.status < 300 || F4.status === 304)) throw new Error("Couldn't load " + t3 + ". Status: " + F4.status);
                return F4.response !== void 0 ? new Uint8Array(F4.response || []) : intArrayFromString(F4.responseText || "", true);
              }, v5 = this;
              v5.setDataGetter((h3) => {
                var b4 = h3 * A3, F4 = (h3 + 1) * A3 - 1;
                if (F4 = Math.min(F4, _4 - 1), typeof v5.chunks[h3] > "u" && (v5.chunks[h3] = S5(b4, F4)), typeof v5.chunks[h3] > "u") throw new Error("doXHR failed!");
                return v5.chunks[h3];
              }), (y5 || !_4) && (A3 = _4 = 1, _4 = this.getter(0).length, A3 = _4, out("LazyFiles on gzip forces download of the whole file when length is accessed")), this._length = _4, this._chunkSize = A3, this.lengthKnown = true;
            }
            get length() {
              return this.lengthKnown || this.cacheLength(), this._length;
            }
            get chunkSize() {
              return this.lengthKnown || this.cacheLength(), this._chunkSize;
            }
          }
          if (typeof XMLHttpRequest < "u") {
            if (!ENVIRONMENT_IS_WORKER) throw "Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";
            var s5 = new a3(), l2 = { isDevice: false, contents: s5 };
          } else var l2 = { isDevice: false, url: t3 };
          var u3 = FS.createFile(e, r, l2, n3, o5);
          l2.contents ? u3.contents = l2.contents : l2.url && (u3.contents = null, u3.url = l2.url), Object.defineProperties(u3, { usedBytes: { get: function() {
            return this.contents.length;
          } } });
          var d3 = {}, c4 = Object.keys(u3.stream_ops);
          c4.forEach((f5) => {
            var m5 = u3.stream_ops[f5];
            d3[f5] = (..._4) => (FS.forceLoadFile(u3), m5(..._4));
          });
          function p6(f5, m5, _4, g4, E3) {
            var y5 = f5.node.contents;
            if (E3 >= y5.length) return 0;
            var A3 = Math.min(y5.length - E3, g4);
            if (y5.slice) for (var S5 = 0; S5 < A3; S5++) m5[_4 + S5] = y5[E3 + S5];
            else for (var S5 = 0; S5 < A3; S5++) m5[_4 + S5] = y5.get(E3 + S5);
            return A3;
          }
          return d3.read = (f5, m5, _4, g4, E3) => (FS.forceLoadFile(u3), p6(f5, m5, _4, g4, E3)), d3.mmap = (f5, m5, _4, g4, E3) => {
            FS.forceLoadFile(u3);
            var y5 = mmapAlloc(m5);
            if (!y5) throw new FS.ErrnoError(48);
            return p6(f5, HEAP8, y5, m5, _4), { ptr: y5, allocated: true };
          }, u3.stream_ops = d3, u3;
        } }, SYSCALLS = { DEFAULT_POLLMASK: 5, calculateAt(e, r, t3) {
          if (PATH.isAbs(r)) return r;
          var n3;
          if (e === -100) n3 = FS.cwd();
          else {
            var o5 = SYSCALLS.getStreamFromFD(e);
            n3 = o5.path;
          }
          if (r.length == 0) {
            if (!t3) throw new FS.ErrnoError(44);
            return n3;
          }
          return n3 + "/" + r;
        }, doStat(e, r, t3) {
          var n3 = e(r);
          HEAP32[t3 >> 2] = n3.dev, HEAP32[t3 + 4 >> 2] = n3.mode, HEAPU32[t3 + 8 >> 2] = n3.nlink, HEAP32[t3 + 12 >> 2] = n3.uid, HEAP32[t3 + 16 >> 2] = n3.gid, HEAP32[t3 + 20 >> 2] = n3.rdev, HEAP64[t3 + 24 >> 3] = BigInt(n3.size), HEAP32[t3 + 32 >> 2] = 4096, HEAP32[t3 + 36 >> 2] = n3.blocks;
          var o5 = n3.atime.getTime(), a3 = n3.mtime.getTime(), s5 = n3.ctime.getTime();
          return HEAP64[t3 + 40 >> 3] = BigInt(Math.floor(o5 / 1e3)), HEAPU32[t3 + 48 >> 2] = o5 % 1e3 * 1e3 * 1e3, HEAP64[t3 + 56 >> 3] = BigInt(Math.floor(a3 / 1e3)), HEAPU32[t3 + 64 >> 2] = a3 % 1e3 * 1e3 * 1e3, HEAP64[t3 + 72 >> 3] = BigInt(Math.floor(s5 / 1e3)), HEAPU32[t3 + 80 >> 2] = s5 % 1e3 * 1e3 * 1e3, HEAP64[t3 + 88 >> 3] = BigInt(n3.ino), 0;
        }, doMsync(e, r, t3, n3, o5) {
          if (!FS.isFile(r.node.mode)) throw new FS.ErrnoError(43);
          if (n3 & 2) return 0;
          var a3 = HEAPU8.slice(e, e + t3);
          FS.msync(r, a3, o5, t3, n3);
        }, getStreamFromFD(e) {
          var r = FS.getStreamChecked(e);
          return r;
        }, varargs: void 0, getStr(e) {
          var r = UTF8ToString(e);
          return r;
        } };
        function ___syscall_chmod(e, r) {
          try {
            return e = SYSCALLS.getStr(e), FS.chmod(e, r), 0;
          } catch (t3) {
            if (typeof FS > "u" || t3.name !== "ErrnoError") throw t3;
            return -t3.errno;
          }
        }
        ___syscall_chmod.sig = "ipi";
        function ___syscall_dup3(e, r, t3) {
          try {
            var n3 = SYSCALLS.getStreamFromFD(e);
            if (n3.fd === r) return -28;
            if (r < 0 || r >= FS.MAX_OPEN_FDS) return -8;
            var o5 = FS.getStream(r);
            return o5 && FS.close(o5), FS.dupStream(n3, r).fd;
          } catch (a3) {
            if (typeof FS > "u" || a3.name !== "ErrnoError") throw a3;
            return -a3.errno;
          }
        }
        ___syscall_dup3.sig = "iiii";
        function ___syscall_faccessat(e, r, t3, n3) {
          try {
            if (r = SYSCALLS.getStr(r), r = SYSCALLS.calculateAt(e, r), t3 & -8) return -28;
            var o5 = FS.lookupPath(r, { follow: true }), a3 = o5.node;
            if (!a3) return -44;
            var s5 = "";
            return t3 & 4 && (s5 += "r"), t3 & 2 && (s5 += "w"), t3 & 1 && (s5 += "x"), s5 && FS.nodePermissions(a3, s5) ? -2 : 0;
          } catch (l2) {
            if (typeof FS > "u" || l2.name !== "ErrnoError") throw l2;
            return -l2.errno;
          }
        }
        ___syscall_faccessat.sig = "iipii";
        var ___syscall_fadvise64 = (e, r, t3, n3) => 0;
        ___syscall_fadvise64.sig = "iijji";
        var syscallGetVarargI = () => {
          var e = HEAP32[+SYSCALLS.varargs >> 2];
          return SYSCALLS.varargs += 4, e;
        }, syscallGetVarargP = syscallGetVarargI;
        function ___syscall_fcntl64(e, r, t3) {
          SYSCALLS.varargs = t3;
          try {
            var n3 = SYSCALLS.getStreamFromFD(e);
            switch (r) {
              case 0: {
                var o5 = syscallGetVarargI();
                if (o5 < 0) return -28;
                for (; FS.streams[o5]; ) o5++;
                var a3;
                return a3 = FS.dupStream(n3, o5), a3.fd;
              }
              case 1:
              case 2:
                return 0;
              case 3:
                return n3.flags;
              case 4: {
                var o5 = syscallGetVarargI();
                return n3.flags |= o5, 0;
              }
              case 12: {
                var o5 = syscallGetVarargP(), s5 = 0;
                return HEAP16[o5 + s5 >> 1] = 2, 0;
              }
              case 13:
              case 14:
                return 0;
            }
            return -28;
          } catch (l2) {
            if (typeof FS > "u" || l2.name !== "ErrnoError") throw l2;
            return -l2.errno;
          }
        }
        ___syscall_fcntl64.sig = "iiip";
        function ___syscall_fstat64(e, r) {
          try {
            var t3 = SYSCALLS.getStreamFromFD(e);
            return SYSCALLS.doStat(FS.stat, t3.path, r);
          } catch (n3) {
            if (typeof FS > "u" || n3.name !== "ErrnoError") throw n3;
            return -n3.errno;
          }
        }
        ___syscall_fstat64.sig = "iip";
        var stringToUTF8 = (e, r, t3) => stringToUTF8Array(e, HEAPU8, r, t3);
        function ___syscall_getcwd(e, r) {
          try {
            if (r === 0) return -28;
            var t3 = FS.cwd(), n3 = lengthBytesUTF8(t3) + 1;
            return r < n3 ? -68 : (stringToUTF8(t3, e, r), n3);
          } catch (o5) {
            if (typeof FS > "u" || o5.name !== "ErrnoError") throw o5;
            return -o5.errno;
          }
        }
        ___syscall_getcwd.sig = "ipp";
        function ___syscall_getdents64(e, r, t3) {
          try {
            var n3 = SYSCALLS.getStreamFromFD(e);
            n3.getdents || (n3.getdents = FS.readdir(n3.path));
            for (var o5 = 280, a3 = 0, s5 = FS.llseek(n3, 0, 1), l2 = Math.floor(s5 / o5), u3 = Math.min(n3.getdents.length, l2 + Math.floor(t3 / o5)), d3 = l2; d3 < u3; d3++) {
              var c4, p6, f5 = n3.getdents[d3];
              if (f5 === ".") c4 = n3.node.id, p6 = 4;
              else if (f5 === "..") {
                var m5 = FS.lookupPath(n3.path, { parent: true });
                c4 = m5.node.id, p6 = 4;
              } else {
                var _4;
                try {
                  _4 = FS.lookupNode(n3.node, f5);
                } catch (g4) {
                  if (g4?.errno === 28) continue;
                  throw g4;
                }
                c4 = _4.id, p6 = FS.isChrdev(_4.mode) ? 2 : FS.isDir(_4.mode) ? 4 : FS.isLink(_4.mode) ? 10 : 8;
              }
              HEAP64[r + a3 >> 3] = BigInt(c4), HEAP64[r + a3 + 8 >> 3] = BigInt((d3 + 1) * o5), HEAP16[r + a3 + 16 >> 1] = 280, HEAP8[r + a3 + 18] = p6, stringToUTF8(f5, r + a3 + 19, 256), a3 += o5;
            }
            return FS.llseek(n3, d3 * o5, 0), a3;
          } catch (g4) {
            if (typeof FS > "u" || g4.name !== "ErrnoError") throw g4;
            return -g4.errno;
          }
        }
        ___syscall_getdents64.sig = "iipp";
        function ___syscall_ioctl(e, r, t3) {
          SYSCALLS.varargs = t3;
          try {
            var n3 = SYSCALLS.getStreamFromFD(e);
            switch (r) {
              case 21509:
                return n3.tty ? 0 : -59;
              case 21505: {
                if (!n3.tty) return -59;
                if (n3.tty.ops.ioctl_tcgets) {
                  var o5 = n3.tty.ops.ioctl_tcgets(n3), a3 = syscallGetVarargP();
                  HEAP32[a3 >> 2] = o5.c_iflag || 0, HEAP32[a3 + 4 >> 2] = o5.c_oflag || 0, HEAP32[a3 + 8 >> 2] = o5.c_cflag || 0, HEAP32[a3 + 12 >> 2] = o5.c_lflag || 0;
                  for (var s5 = 0; s5 < 32; s5++) HEAP8[a3 + s5 + 17] = o5.c_cc[s5] || 0;
                  return 0;
                }
                return 0;
              }
              case 21510:
              case 21511:
              case 21512:
                return n3.tty ? 0 : -59;
              case 21506:
              case 21507:
              case 21508: {
                if (!n3.tty) return -59;
                if (n3.tty.ops.ioctl_tcsets) {
                  for (var a3 = syscallGetVarargP(), l2 = HEAP32[a3 >> 2], u3 = HEAP32[a3 + 4 >> 2], d3 = HEAP32[a3 + 8 >> 2], c4 = HEAP32[a3 + 12 >> 2], p6 = [], s5 = 0; s5 < 32; s5++) p6.push(HEAP8[a3 + s5 + 17]);
                  return n3.tty.ops.ioctl_tcsets(n3.tty, r, { c_iflag: l2, c_oflag: u3, c_cflag: d3, c_lflag: c4, c_cc: p6 });
                }
                return 0;
              }
              case 21519: {
                if (!n3.tty) return -59;
                var a3 = syscallGetVarargP();
                return HEAP32[a3 >> 2] = 0, 0;
              }
              case 21520:
                return n3.tty ? -28 : -59;
              case 21531: {
                var a3 = syscallGetVarargP();
                return FS.ioctl(n3, r, a3);
              }
              case 21523: {
                if (!n3.tty) return -59;
                if (n3.tty.ops.ioctl_tiocgwinsz) {
                  var f5 = n3.tty.ops.ioctl_tiocgwinsz(n3.tty), a3 = syscallGetVarargP();
                  HEAP16[a3 >> 1] = f5[0], HEAP16[a3 + 2 >> 1] = f5[1];
                }
                return 0;
              }
              case 21524:
                return n3.tty ? 0 : -59;
              case 21515:
                return n3.tty ? 0 : -59;
              default:
                return -28;
            }
          } catch (m5) {
            if (typeof FS > "u" || m5.name !== "ErrnoError") throw m5;
            return -m5.errno;
          }
        }
        ___syscall_ioctl.sig = "iiip";
        function ___syscall_lstat64(e, r) {
          try {
            return e = SYSCALLS.getStr(e), SYSCALLS.doStat(FS.lstat, e, r);
          } catch (t3) {
            if (typeof FS > "u" || t3.name !== "ErrnoError") throw t3;
            return -t3.errno;
          }
        }
        ___syscall_lstat64.sig = "ipp";
        function ___syscall_mkdirat(e, r, t3) {
          try {
            return r = SYSCALLS.getStr(r), r = SYSCALLS.calculateAt(e, r), FS.mkdir(r, t3, 0), 0;
          } catch (n3) {
            if (typeof FS > "u" || n3.name !== "ErrnoError") throw n3;
            return -n3.errno;
          }
        }
        ___syscall_mkdirat.sig = "iipi";
        function ___syscall_newfstatat(e, r, t3, n3) {
          try {
            r = SYSCALLS.getStr(r);
            var o5 = n3 & 256, a3 = n3 & 4096;
            return n3 = n3 & -6401, r = SYSCALLS.calculateAt(e, r, a3), SYSCALLS.doStat(o5 ? FS.lstat : FS.stat, r, t3);
          } catch (s5) {
            if (typeof FS > "u" || s5.name !== "ErrnoError") throw s5;
            return -s5.errno;
          }
        }
        ___syscall_newfstatat.sig = "iippi";
        function ___syscall_openat(e, r, t3, n3) {
          SYSCALLS.varargs = n3;
          try {
            r = SYSCALLS.getStr(r), r = SYSCALLS.calculateAt(e, r);
            var o5 = n3 ? syscallGetVarargI() : 0;
            return FS.open(r, t3, o5).fd;
          } catch (a3) {
            if (typeof FS > "u" || a3.name !== "ErrnoError") throw a3;
            return -a3.errno;
          }
        }
        ___syscall_openat.sig = "iipip";
        function ___syscall_readlinkat(e, r, t3, n3) {
          try {
            if (r = SYSCALLS.getStr(r), r = SYSCALLS.calculateAt(e, r), n3 <= 0) return -28;
            var o5 = FS.readlink(r), a3 = Math.min(n3, lengthBytesUTF8(o5)), s5 = HEAP8[t3 + a3];
            return stringToUTF8(o5, t3, n3 + 1), HEAP8[t3 + a3] = s5, a3;
          } catch (l2) {
            if (typeof FS > "u" || l2.name !== "ErrnoError") throw l2;
            return -l2.errno;
          }
        }
        ___syscall_readlinkat.sig = "iippp";
        function ___syscall_rmdir(e) {
          try {
            return e = SYSCALLS.getStr(e), FS.rmdir(e), 0;
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return -r.errno;
          }
        }
        ___syscall_rmdir.sig = "ip";
        function ___syscall_stat64(e, r) {
          try {
            return e = SYSCALLS.getStr(e), SYSCALLS.doStat(FS.stat, e, r);
          } catch (t3) {
            if (typeof FS > "u" || t3.name !== "ErrnoError") throw t3;
            return -t3.errno;
          }
        }
        ___syscall_stat64.sig = "ipp";
        function ___syscall_symlinkat(e, r, t3) {
          try {
            return e = SYSCALLS.getStr(e), t3 = SYSCALLS.getStr(t3), t3 = SYSCALLS.calculateAt(r, t3), FS.symlink(e, t3), 0;
          } catch (n3) {
            if (typeof FS > "u" || n3.name !== "ErrnoError") throw n3;
            return -n3.errno;
          }
        }
        ___syscall_symlinkat.sig = "ipip";
        function ___syscall_unlinkat(e, r, t3) {
          try {
            return r = SYSCALLS.getStr(r), r = SYSCALLS.calculateAt(e, r), t3 === 0 ? FS.unlink(r) : t3 === 512 ? FS.rmdir(r) : abort("Invalid flags passed to unlinkat"), 0;
          } catch (n3) {
            if (typeof FS > "u" || n3.name !== "ErrnoError") throw n3;
            return -n3.errno;
          }
        }
        ___syscall_unlinkat.sig = "iipi";
        var ___table_base = new WebAssembly.Global({ value: "i32", mutable: false }, 1), __abort_js = () => abort("");
        __abort_js.sig = "v";
        var runtimeKeepaliveCounter = 0, __emscripten_runtime_keepalive_clear = () => {
          noExitRuntime = false, runtimeKeepaliveCounter = 0;
        };
        __emscripten_runtime_keepalive_clear.sig = "v";
        var __emscripten_throw_longjmp = () => {
          throw 1 / 0;
        };
        __emscripten_throw_longjmp.sig = "v";
        var isLeapYear = (e) => e % 4 === 0 && (e % 100 !== 0 || e % 400 === 0), MONTH_DAYS_LEAP_CUMULATIVE = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], MONTH_DAYS_REGULAR_CUMULATIVE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], ydayFromDate = (e) => {
          var r = isLeapYear(e.getFullYear()), t3 = r ? MONTH_DAYS_LEAP_CUMULATIVE : MONTH_DAYS_REGULAR_CUMULATIVE, n3 = t3[e.getMonth()] + e.getDate() - 1;
          return n3;
        }, INT53_MAX = 9007199254740992, INT53_MIN = -9007199254740992, bigintToI53Checked = (e) => e < INT53_MIN || e > INT53_MAX ? NaN : Number(e);
        function __localtime_js(e, r) {
          e = bigintToI53Checked(e);
          var t3 = new Date(e * 1e3);
          HEAP32[r >> 2] = t3.getSeconds(), HEAP32[r + 4 >> 2] = t3.getMinutes(), HEAP32[r + 8 >> 2] = t3.getHours(), HEAP32[r + 12 >> 2] = t3.getDate(), HEAP32[r + 16 >> 2] = t3.getMonth(), HEAP32[r + 20 >> 2] = t3.getFullYear() - 1900, HEAP32[r + 24 >> 2] = t3.getDay();
          var n3 = ydayFromDate(t3) | 0;
          HEAP32[r + 28 >> 2] = n3, HEAP32[r + 36 >> 2] = -(t3.getTimezoneOffset() * 60);
          var o5 = new Date(t3.getFullYear(), 0, 1), a3 = new Date(t3.getFullYear(), 6, 1).getTimezoneOffset(), s5 = o5.getTimezoneOffset(), l2 = (a3 != s5 && t3.getTimezoneOffset() == Math.min(s5, a3)) | 0;
          HEAP32[r + 32 >> 2] = l2;
        }
        __localtime_js.sig = "vjp";
        var __mktime_js = function(e) {
          var r = (() => {
            var t3 = new Date(HEAP32[e + 20 >> 2] + 1900, HEAP32[e + 16 >> 2], HEAP32[e + 12 >> 2], HEAP32[e + 8 >> 2], HEAP32[e + 4 >> 2], HEAP32[e >> 2], 0), n3 = HEAP32[e + 32 >> 2], o5 = t3.getTimezoneOffset(), a3 = new Date(t3.getFullYear(), 0, 1), s5 = new Date(t3.getFullYear(), 6, 1).getTimezoneOffset(), l2 = a3.getTimezoneOffset(), u3 = Math.min(l2, s5);
            if (n3 < 0) HEAP32[e + 32 >> 2] = +(s5 != l2 && u3 == o5);
            else if (n3 > 0 != (u3 == o5)) {
              var d3 = Math.max(l2, s5), c4 = n3 > 0 ? u3 : d3;
              t3.setTime(t3.getTime() + (c4 - o5) * 6e4);
            }
            HEAP32[e + 24 >> 2] = t3.getDay();
            var p6 = ydayFromDate(t3) | 0;
            HEAP32[e + 28 >> 2] = p6, HEAP32[e >> 2] = t3.getSeconds(), HEAP32[e + 4 >> 2] = t3.getMinutes(), HEAP32[e + 8 >> 2] = t3.getHours(), HEAP32[e + 12 >> 2] = t3.getDate(), HEAP32[e + 16 >> 2] = t3.getMonth(), HEAP32[e + 20 >> 2] = t3.getYear();
            var f5 = t3.getTime();
            return isNaN(f5) ? -1 : f5 / 1e3;
          })();
          return BigInt(r);
        };
        __mktime_js.sig = "jp";
        function __mmap_js(e, r, t3, n3, o5, a3, s5) {
          o5 = bigintToI53Checked(o5);
          try {
            if (isNaN(o5)) return 61;
            var l2 = SYSCALLS.getStreamFromFD(n3), u3 = FS.mmap(l2, e, o5, r, t3), d3 = u3.ptr;
            return HEAP32[a3 >> 2] = u3.allocated, HEAPU32[s5 >> 2] = d3, 0;
          } catch (c4) {
            if (typeof FS > "u" || c4.name !== "ErrnoError") throw c4;
            return -c4.errno;
          }
        }
        __mmap_js.sig = "ipiiijpp";
        function __munmap_js(e, r, t3, n3, o5, a3) {
          a3 = bigintToI53Checked(a3);
          try {
            var s5 = SYSCALLS.getStreamFromFD(o5);
            t3 & 2 && SYSCALLS.doMsync(e, s5, r, n3, a3);
          } catch (l2) {
            if (typeof FS > "u" || l2.name !== "ErrnoError") throw l2;
            return -l2.errno;
          }
        }
        __munmap_js.sig = "ippiiij";
        var timers = {}, handleException = (e) => {
          if (e instanceof ExitStatus || e == "unwind") return EXITSTATUS;
          quit_(1, e);
        }, keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0, _proc_exit = (e) => {
          EXITSTATUS = e, keepRuntimeAlive() || (Module.onExit?.(e), ABORT = true), quit_(e, new ExitStatus(e));
        };
        _proc_exit.sig = "vi";
        var exitJS = (e, r) => {
          EXITSTATUS = e, keepRuntimeAlive() || exitRuntime(), _proc_exit(e);
        }, _exit = exitJS;
        _exit.sig = "vi";
        var maybeExit = () => {
          if (!runtimeExited && !keepRuntimeAlive()) try {
            _exit(EXITSTATUS);
          } catch (e) {
            handleException(e);
          }
        }, callUserCallback = (e) => {
          if (!(runtimeExited || ABORT)) try {
            e(), maybeExit();
          } catch (r) {
            handleException(r);
          }
        }, _emscripten_get_now = () => performance.now();
        _emscripten_get_now.sig = "d";
        var __setitimer_js = (e, r) => {
          if (timers[e] && (clearTimeout(timers[e].id), delete timers[e]), !r) return 0;
          var t3 = setTimeout(() => {
            delete timers[e], callUserCallback(() => __emscripten_timeout(e, _emscripten_get_now()));
          }, r);
          return timers[e] = { id: t3, timeout_ms: r }, 0;
        };
        __setitimer_js.sig = "iid";
        var __tzset_js = (e, r, t3, n3) => {
          var o5 = (/* @__PURE__ */ new Date()).getFullYear(), a3 = new Date(o5, 0, 1), s5 = new Date(o5, 6, 1), l2 = a3.getTimezoneOffset(), u3 = s5.getTimezoneOffset(), d3 = Math.max(l2, u3);
          HEAPU32[e >> 2] = d3 * 60, HEAP32[r >> 2] = +(l2 != u3);
          var c4 = (m5) => {
            var _4 = m5 >= 0 ? "-" : "+", g4 = Math.abs(m5), E3 = String(Math.floor(g4 / 60)).padStart(2, "0"), y5 = String(g4 % 60).padStart(2, "0");
            return `UTC${_4}${E3}${y5}`;
          }, p6 = c4(l2), f5 = c4(u3);
          u3 < l2 ? (stringToUTF8(p6, t3, 17), stringToUTF8(f5, n3, 17)) : (stringToUTF8(p6, n3, 17), stringToUTF8(f5, t3, 17));
        };
        __tzset_js.sig = "vpppp";
        var _emscripten_date_now = () => Date.now();
        _emscripten_date_now.sig = "d";
        var getHeapMax = () => 2147483648, growMemory = (e) => {
          var r = wasmMemory.buffer, t3 = (e - r.byteLength + 65535) / 65536 | 0;
          try {
            return wasmMemory.grow(t3), updateMemoryViews(), 1;
          } catch {
          }
        }, _emscripten_resize_heap = (e) => {
          var r = HEAPU8.length;
          e >>>= 0;
          var t3 = getHeapMax();
          if (e > t3) return false;
          for (var n3 = 1; n3 <= 4; n3 *= 2) {
            var o5 = r * (1 + 0.2 / n3);
            o5 = Math.min(o5, e + 100663296);
            var a3 = Math.min(t3, alignMemory(Math.max(e, o5), 65536)), s5 = growMemory(a3);
            if (s5) return true;
          }
          return false;
        };
        _emscripten_resize_heap.sig = "ip";
        var ENV = {}, getExecutableName = () => thisProgram || "./this.program", getEnvStrings = () => {
          if (!getEnvStrings.strings) {
            var e = (typeof navigator == "object" && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8", r = { USER: "web_user", LOGNAME: "web_user", PATH: "/", PWD: "/", HOME: "/home/web_user", LANG: e, _: getExecutableName() };
            for (var t3 in ENV) ENV[t3] === void 0 ? delete r[t3] : r[t3] = ENV[t3];
            var n3 = [];
            for (var t3 in r) n3.push(`${t3}=${r[t3]}`);
            getEnvStrings.strings = n3;
          }
          return getEnvStrings.strings;
        }, stringToAscii = (e, r) => {
          for (var t3 = 0; t3 < e.length; ++t3) HEAP8[r++] = e.charCodeAt(t3);
          HEAP8[r] = 0;
        }, _environ_get = (e, r) => {
          var t3 = 0;
          return getEnvStrings().forEach((n3, o5) => {
            var a3 = r + t3;
            HEAPU32[e + o5 * 4 >> 2] = a3, stringToAscii(n3, a3), t3 += n3.length + 1;
          }), 0;
        };
        _environ_get.sig = "ipp";
        var _environ_sizes_get = (e, r) => {
          var t3 = getEnvStrings();
          HEAPU32[e >> 2] = t3.length;
          var n3 = 0;
          return t3.forEach((o5) => n3 += o5.length + 1), HEAPU32[r >> 2] = n3, 0;
        };
        _environ_sizes_get.sig = "ipp";
        function _fd_close(e) {
          try {
            var r = SYSCALLS.getStreamFromFD(e);
            return FS.close(r), 0;
          } catch (t3) {
            if (typeof FS > "u" || t3.name !== "ErrnoError") throw t3;
            return t3.errno;
          }
        }
        _fd_close.sig = "ii";
        function _fd_fdstat_get(e, r) {
          try {
            var t3 = 0, n3 = 0, o5 = 0, a3 = SYSCALLS.getStreamFromFD(e), s5 = a3.tty ? 2 : FS.isDir(a3.mode) ? 3 : FS.isLink(a3.mode) ? 7 : 4;
            return HEAP8[r] = s5, HEAP16[r + 2 >> 1] = o5, HEAP64[r + 8 >> 3] = BigInt(t3), HEAP64[r + 16 >> 3] = BigInt(n3), 0;
          } catch (l2) {
            if (typeof FS > "u" || l2.name !== "ErrnoError") throw l2;
            return l2.errno;
          }
        }
        _fd_fdstat_get.sig = "iip";
        var doReadv = (e, r, t3, n3) => {
          for (var o5 = 0, a3 = 0; a3 < t3; a3++) {
            var s5 = HEAPU32[r >> 2], l2 = HEAPU32[r + 4 >> 2];
            r += 8;
            var u3 = FS.read(e, HEAP8, s5, l2, n3);
            if (u3 < 0) return -1;
            if (o5 += u3, u3 < l2) break;
            typeof n3 < "u" && (n3 += u3);
          }
          return o5;
        };
        function _fd_read(e, r, t3, n3) {
          try {
            var o5 = SYSCALLS.getStreamFromFD(e), a3 = doReadv(o5, r, t3);
            return HEAPU32[n3 >> 2] = a3, 0;
          } catch (s5) {
            if (typeof FS > "u" || s5.name !== "ErrnoError") throw s5;
            return s5.errno;
          }
        }
        _fd_read.sig = "iippp";
        function _fd_seek(e, r, t3, n3) {
          r = bigintToI53Checked(r);
          try {
            if (isNaN(r)) return 61;
            var o5 = SYSCALLS.getStreamFromFD(e);
            return FS.llseek(o5, r, t3), HEAP64[n3 >> 3] = BigInt(o5.position), o5.getdents && r === 0 && t3 === 0 && (o5.getdents = null), 0;
          } catch (a3) {
            if (typeof FS > "u" || a3.name !== "ErrnoError") throw a3;
            return a3.errno;
          }
        }
        _fd_seek.sig = "iijip";
        function _fd_sync(e) {
          try {
            var r = SYSCALLS.getStreamFromFD(e);
            return r.stream_ops?.fsync ? r.stream_ops.fsync(r) : 0;
          } catch (t3) {
            if (typeof FS > "u" || t3.name !== "ErrnoError") throw t3;
            return t3.errno;
          }
        }
        _fd_sync.sig = "ii";
        var doWritev = (e, r, t3, n3) => {
          for (var o5 = 0, a3 = 0; a3 < t3; a3++) {
            var s5 = HEAPU32[r >> 2], l2 = HEAPU32[r + 4 >> 2];
            r += 8;
            var u3 = FS.write(e, HEAP8, s5, l2, n3);
            if (u3 < 0) return -1;
            if (o5 += u3, u3 < l2) break;
            typeof n3 < "u" && (n3 += u3);
          }
          return o5;
        };
        function _fd_write(e, r, t3, n3) {
          try {
            var o5 = SYSCALLS.getStreamFromFD(e), a3 = doWritev(o5, r, t3);
            return HEAPU32[n3 >> 2] = a3, 0;
          } catch (s5) {
            if (typeof FS > "u" || s5.name !== "ErrnoError") throw s5;
            return s5.errno;
          }
        }
        _fd_write.sig = "iippp";
        var inetPton4 = (e) => {
          for (var r = e.split("."), t3 = 0; t3 < 4; t3++) {
            var n3 = Number(r[t3]);
            if (isNaN(n3)) return null;
            r[t3] = n3;
          }
          return (r[0] | r[1] << 8 | r[2] << 16 | r[3] << 24) >>> 0;
        }, jstoi_q = (e) => parseInt(e), inetPton6 = (e) => {
          var r, t3, n3, o5, a3 = /^((?=.*::)(?!.*::.+::)(::)?([\dA-F]{1,4}:(:|\b)|){5}|([\dA-F]{1,4}:){6})((([\dA-F]{1,4}((?!\3)::|:\b|$))|(?!\2\3)){2}|(((2[0-4]|1\d|[1-9])?\d|25[0-5])\.?\b){4})$/i, s5 = [];
          if (!a3.test(e)) return null;
          if (e === "::") return [0, 0, 0, 0, 0, 0, 0, 0];
          for (e.startsWith("::") ? e = e.replace("::", "Z:") : e = e.replace("::", ":Z:"), e.indexOf(".") > 0 ? (e = e.replace(new RegExp("[.]", "g"), ":"), r = e.split(":"), r[r.length - 4] = jstoi_q(r[r.length - 4]) + jstoi_q(r[r.length - 3]) * 256, r[r.length - 3] = jstoi_q(r[r.length - 2]) + jstoi_q(r[r.length - 1]) * 256, r = r.slice(0, r.length - 2)) : r = e.split(":"), n3 = 0, o5 = 0, t3 = 0; t3 < r.length; t3++) if (typeof r[t3] == "string") if (r[t3] === "Z") {
            for (o5 = 0; o5 < 8 - r.length + 1; o5++) s5[t3 + o5] = 0;
            n3 = o5 - 1;
          } else s5[t3 + n3] = _htons(parseInt(r[t3], 16));
          else s5[t3 + n3] = r[t3];
          return [s5[1] << 16 | s5[0], s5[3] << 16 | s5[2], s5[5] << 16 | s5[4], s5[7] << 16 | s5[6]];
        }, DNS = { address_map: { id: 1, addrs: {}, names: {} }, lookup_name(e) {
          var r = inetPton4(e);
          if (r !== null || (r = inetPton6(e), r !== null)) return e;
          var t3;
          if (DNS.address_map.addrs[e]) t3 = DNS.address_map.addrs[e];
          else {
            var n3 = DNS.address_map.id++;
            assert(n3 < 65535, "exceeded max address mappings of 65535"), t3 = "172.29." + (n3 & 255) + "." + (n3 & 65280), DNS.address_map.names[t3] = e, DNS.address_map.addrs[e] = t3;
          }
          return t3;
        }, lookup_addr(e) {
          return DNS.address_map.names[e] ? DNS.address_map.names[e] : null;
        } }, inetNtop4 = (e) => (e & 255) + "." + (e >> 8 & 255) + "." + (e >> 16 & 255) + "." + (e >> 24 & 255), inetNtop6 = (e) => {
          var r = "", t3 = 0, n3 = 0, o5 = 0, a3 = 0, s5 = 0, l2 = 0, u3 = [e[0] & 65535, e[0] >> 16, e[1] & 65535, e[1] >> 16, e[2] & 65535, e[2] >> 16, e[3] & 65535, e[3] >> 16], d3 = true, c4 = "";
          for (l2 = 0; l2 < 5; l2++) if (u3[l2] !== 0) {
            d3 = false;
            break;
          }
          if (d3) {
            if (c4 = inetNtop4(u3[6] | u3[7] << 16), u3[5] === -1) return r = "::ffff:", r += c4, r;
            if (u3[5] === 0) return r = "::", c4 === "0.0.0.0" && (c4 = ""), c4 === "0.0.0.1" && (c4 = "1"), r += c4, r;
          }
          for (t3 = 0; t3 < 8; t3++) u3[t3] === 0 && (t3 - o5 > 1 && (s5 = 0), o5 = t3, s5++), s5 > n3 && (n3 = s5, a3 = t3 - n3 + 1);
          for (t3 = 0; t3 < 8; t3++) {
            if (n3 > 1 && u3[t3] === 0 && t3 >= a3 && t3 < a3 + n3) {
              t3 === a3 && (r += ":", a3 === 0 && (r += ":"));
              continue;
            }
            r += Number(_ntohs(u3[t3] & 65535)).toString(16), r += t3 < 7 ? ":" : "";
          }
          return r;
        }, writeSockaddr = (e, r, t3, n3, o5) => {
          switch (r) {
            case 2:
              t3 = inetPton4(t3), zeroMemory(e, 16), o5 && (HEAP32[o5 >> 2] = 16), HEAP16[e >> 1] = r, HEAP32[e + 4 >> 2] = t3, HEAP16[e + 2 >> 1] = _htons(n3);
              break;
            case 10:
              t3 = inetPton6(t3), zeroMemory(e, 28), o5 && (HEAP32[o5 >> 2] = 28), HEAP32[e >> 2] = r, HEAP32[e + 8 >> 2] = t3[0], HEAP32[e + 12 >> 2] = t3[1], HEAP32[e + 16 >> 2] = t3[2], HEAP32[e + 20 >> 2] = t3[3], HEAP16[e + 2 >> 1] = _htons(n3);
              break;
            default:
              return 5;
          }
          return 0;
        }, _getaddrinfo = (e, r, t3, n3) => {
          var o5 = 0, a3 = 0, s5 = 0, l2 = 0, u3 = 0, d3 = 0, c4;
          function p6(f5, m5, _4, g4, E3, y5) {
            var A3, S5, v5, h3;
            return S5 = f5 === 10 ? 28 : 16, E3 = f5 === 10 ? inetNtop6(E3) : inetNtop4(E3), A3 = _malloc(S5), h3 = writeSockaddr(A3, f5, E3, y5), assert(!h3), v5 = _malloc(32), HEAP32[v5 + 4 >> 2] = f5, HEAP32[v5 + 8 >> 2] = m5, HEAP32[v5 + 12 >> 2] = _4, HEAPU32[v5 + 24 >> 2] = g4, HEAPU32[v5 + 20 >> 2] = A3, f5 === 10 ? HEAP32[v5 + 16 >> 2] = 28 : HEAP32[v5 + 16 >> 2] = 16, HEAP32[v5 + 28 >> 2] = 0, v5;
          }
          if (t3 && (s5 = HEAP32[t3 >> 2], l2 = HEAP32[t3 + 4 >> 2], u3 = HEAP32[t3 + 8 >> 2], d3 = HEAP32[t3 + 12 >> 2]), u3 && !d3 && (d3 = u3 === 2 ? 17 : 6), !u3 && d3 && (u3 = d3 === 17 ? 2 : 1), d3 === 0 && (d3 = 6), u3 === 0 && (u3 = 1), !e && !r) return -2;
          if (s5 & -1088 || t3 !== 0 && HEAP32[t3 >> 2] & 2 && !e) return -1;
          if (s5 & 32) return -2;
          if (u3 !== 0 && u3 !== 1 && u3 !== 2) return -7;
          if (l2 !== 0 && l2 !== 2 && l2 !== 10) return -6;
          if (r && (r = UTF8ToString(r), a3 = parseInt(r, 10), isNaN(a3))) return s5 & 1024 ? -2 : -8;
          if (!e) return l2 === 0 && (l2 = 2), s5 & 1 || (l2 === 2 ? o5 = _htonl(2130706433) : o5 = [0, 0, 0, _htonl(1)]), c4 = p6(l2, u3, d3, null, o5, a3), HEAPU32[n3 >> 2] = c4, 0;
          if (e = UTF8ToString(e), o5 = inetPton4(e), o5 !== null) if (l2 === 0 || l2 === 2) l2 = 2;
          else if (l2 === 10 && s5 & 8) o5 = [0, 0, _htonl(65535), o5], l2 = 10;
          else return -2;
          else if (o5 = inetPton6(e), o5 !== null) if (l2 === 0 || l2 === 10) l2 = 10;
          else return -2;
          return o5 != null ? (c4 = p6(l2, u3, d3, e, o5, a3), HEAPU32[n3 >> 2] = c4, 0) : s5 & 4 ? -2 : (e = DNS.lookup_name(e), o5 = inetPton4(e), l2 === 0 ? l2 = 2 : l2 === 10 && (o5 = [0, 0, _htonl(65535), o5]), c4 = p6(l2, u3, d3, null, o5, a3), HEAPU32[n3 >> 2] = c4, 0);
        };
        _getaddrinfo.sig = "ipppp";
        var stackAlloc = (e) => __emscripten_stack_alloc(e), stringToUTF8OnStack = (e) => {
          var r = lengthBytesUTF8(e) + 1, t3 = stackAlloc(r);
          return stringToUTF8(e, t3, r), t3;
        }, removeFunction = (e) => {
          functionsInTableMap.delete(getWasmTableEntry(e)), setWasmTableEntry(e, null), freeTableIndexes.push(e);
        }, stringToNewUTF8 = (e) => {
          var r = lengthBytesUTF8(e) + 1, t3 = _malloc(r);
          return t3 && stringToUTF8(e, t3, r), t3;
        }, FS_createPath = FS.createPath, FS_unlink = (e) => FS.unlink(e), FS_createLazyFile = FS.createLazyFile, FS_createDevice = FS.createDevice;
        registerWasmPlugin(), FS.createPreloadedFile = FS_createPreloadedFile, FS.staticInit(), Module.FS_createPath = FS.createPath, Module.FS_createDataFile = FS.createDataFile, Module.FS_createPreloadedFile = FS.createPreloadedFile, Module.FS_unlink = FS.unlink, Module.FS_createLazyFile = FS.createLazyFile, Module.FS_createDevice = FS.createDevice, MEMFS.doesNotExistError = new FS.ErrnoError(44), MEMFS.doesNotExistError.stack = "<generic error, no stack>";
        var wasmImports = { __call_sighandler: ___call_sighandler, __heap_base: ___heap_base, __indirect_function_table: wasmTable, __memory_base: ___memory_base, __stack_pointer: ___stack_pointer, __syscall_chmod: ___syscall_chmod, __syscall_dup3: ___syscall_dup3, __syscall_faccessat: ___syscall_faccessat, __syscall_fadvise64: ___syscall_fadvise64, __syscall_fcntl64: ___syscall_fcntl64, __syscall_fstat64: ___syscall_fstat64, __syscall_getcwd: ___syscall_getcwd, __syscall_getdents64: ___syscall_getdents64, __syscall_ioctl: ___syscall_ioctl, __syscall_lstat64: ___syscall_lstat64, __syscall_mkdirat: ___syscall_mkdirat, __syscall_newfstatat: ___syscall_newfstatat, __syscall_openat: ___syscall_openat, __syscall_readlinkat: ___syscall_readlinkat, __syscall_rmdir: ___syscall_rmdir, __syscall_stat64: ___syscall_stat64, __syscall_symlinkat: ___syscall_symlinkat, __syscall_unlinkat: ___syscall_unlinkat, __table_base: ___table_base, _abort_js: __abort_js, _emscripten_runtime_keepalive_clear: __emscripten_runtime_keepalive_clear, _emscripten_throw_longjmp: __emscripten_throw_longjmp, _localtime_js: __localtime_js, _mktime_js: __mktime_js, _mmap_js: __mmap_js, _munmap_js: __munmap_js, _setitimer_js: __setitimer_js, _tzset_js: __tzset_js, emscripten_date_now: _emscripten_date_now, emscripten_get_now: _emscripten_get_now, emscripten_resize_heap: _emscripten_resize_heap, environ_get: _environ_get, environ_sizes_get: _environ_sizes_get, exit: _exit, fd_close: _fd_close, fd_fdstat_get: _fd_fdstat_get, fd_read: _fd_read, fd_seek: _fd_seek, fd_sync: _fd_sync, fd_write: _fd_write, getaddrinfo: _getaddrinfo, invoke_ii, invoke_iiii, invoke_vii, memory: wasmMemory, proc_exit: _proc_exit }, wasmExports;
        createWasm();
        var ___wasm_call_ctors = () => (___wasm_call_ctors = wasmExports.__wasm_call_ctors)(), _pgl_exit = Module._pgl_exit = (e) => (_pgl_exit = Module._pgl_exit = wasmExports.pgl_exit)(e), ___errno_location = Module.___errno_location = () => (___errno_location = Module.___errno_location = wasmExports.__errno_location)(), _fflush = Module._fflush = (e) => (_fflush = Module._fflush = wasmExports.fflush)(e), _fopen = Module._fopen = (e, r) => (_fopen = Module._fopen = wasmExports.fopen)(e, r), _fclose = Module._fclose = (e) => (_fclose = Module._fclose = wasmExports.fclose)(e), _pgl_popen = Module._pgl_popen = (e, r) => (_pgl_popen = Module._pgl_popen = wasmExports.pgl_popen)(e, r), _fputs = Module._fputs = (e, r) => (_fputs = Module._fputs = wasmExports.fputs)(e, r), _main = Module._main = (e, r) => (_main = Module._main = wasmExports.__main_argc_argv)(e, r), _pgl_atexit = Module._pgl_atexit = (e) => (_pgl_atexit = Module._pgl_atexit = wasmExports.pgl_atexit)(e), _pgl_geteuid = Module._pgl_geteuid = () => (_pgl_geteuid = Module._pgl_geteuid = wasmExports.pgl_geteuid)(), _pgl_system = Module._pgl_system = (e) => (_pgl_system = Module._pgl_system = wasmExports.pgl_system)(e), _malloc = (e) => (_malloc = wasmExports.malloc)(e), _calloc = (e, r) => (_calloc = wasmExports.calloc)(e, r), _pgl_setsockopt = Module._pgl_setsockopt = (e, r, t3, n3, o5) => (_pgl_setsockopt = Module._pgl_setsockopt = wasmExports.pgl_setsockopt)(e, r, t3, n3, o5), _pgl_connect = Module._pgl_connect = (e, r, t3) => (_pgl_connect = Module._pgl_connect = wasmExports.pgl_connect)(e, r, t3), _pgl_send = Module._pgl_send = (e, r, t3, n3) => (_pgl_send = Module._pgl_send = wasmExports.pgl_send)(e, r, t3, n3), _pgl_recv = Module._pgl_recv = (e, r, t3, n3) => (_pgl_recv = Module._pgl_recv = wasmExports.pgl_recv)(e, r, t3, n3), _fgets = Module._fgets = (e, r, t3) => (_fgets = Module._fgets = wasmExports.fgets)(e, r, t3), _pgl_getsockopt = Module._pgl_getsockopt = (e, r, t3, n3, o5) => (_pgl_getsockopt = Module._pgl_getsockopt = wasmExports.pgl_getsockopt)(e, r, t3, n3, o5), _pgl_getsockname = Module._pgl_getsockname = (e, r, t3) => (_pgl_getsockname = Module._pgl_getsockname = wasmExports.pgl_getsockname)(e, r, t3), _pgl_poll = Module._pgl_poll = (e, r, t3) => (_pgl_poll = Module._pgl_poll = wasmExports.pgl_poll)(e, r, t3), _clear_setitimer = Module._clear_setitimer = () => (_clear_setitimer = Module._clear_setitimer = wasmExports.clear_setitimer)(), _pgl_longjmp = Module._pgl_longjmp = (e, r) => (_pgl_longjmp = Module._pgl_longjmp = wasmExports.pgl_longjmp)(e, r), _pgl_siglongjmp = Module._pgl_siglongjmp = (e, r) => (_pgl_siglongjmp = Module._pgl_siglongjmp = wasmExports.pgl_siglongjmp)(e, r), _pgl_set_system_fn = Module._pgl_set_system_fn = (e) => (_pgl_set_system_fn = Module._pgl_set_system_fn = wasmExports.pgl_set_system_fn)(e), _pgl_set_popen_fn = Module._pgl_set_popen_fn = (e) => (_pgl_set_popen_fn = Module._pgl_set_popen_fn = wasmExports.pgl_set_popen_fn)(e), _pgl_set_pclose_fn = Module._pgl_set_pclose_fn = (e) => (_pgl_set_pclose_fn = Module._pgl_set_pclose_fn = wasmExports.pgl_set_pclose_fn)(e), _pgl_pclose = Module._pgl_pclose = (e) => (_pgl_pclose = Module._pgl_pclose = wasmExports.pgl_pclose)(e), _pclose = Module._pclose = (e) => (_pclose = Module._pclose = wasmExports.pclose)(e), _pgl_getuid = Module._pgl_getuid = () => (_pgl_getuid = Module._pgl_getuid = wasmExports.pgl_getuid)(), _pgl_getpwuid = Module._pgl_getpwuid = (e) => (_pgl_getpwuid = Module._pgl_getpwuid = wasmExports.pgl_getpwuid)(e), _pgl_run_atexit_funcs = Module._pgl_run_atexit_funcs = () => (_pgl_run_atexit_funcs = Module._pgl_run_atexit_funcs = wasmExports.pgl_run_atexit_funcs)(), _pgl_freopen = Module._pgl_freopen = (e, r, t3) => (_pgl_freopen = Module._pgl_freopen = wasmExports.pgl_freopen)(e, r, t3), _pgl_shmget = Module._pgl_shmget = (e, r, t3) => (_pgl_shmget = Module._pgl_shmget = wasmExports.pgl_shmget)(e, r, t3), _pgl_shmat = Module._pgl_shmat = (e, r, t3) => (_pgl_shmat = Module._pgl_shmat = wasmExports.pgl_shmat)(e, r, t3), _pgl_shmdt = Module._pgl_shmdt = (e) => (_pgl_shmdt = Module._pgl_shmdt = wasmExports.pgl_shmdt)(e), _pgl_shmctl = Module._pgl_shmctl = (e, r, t3) => (_pgl_shmctl = Module._pgl_shmctl = wasmExports.pgl_shmctl)(e, r, t3), _pgl_munmap = Module._pgl_munmap = (e, r) => (_pgl_munmap = Module._pgl_munmap = wasmExports.pgl_munmap)(e, r), _pgl_set_rw_cbs = Module._pgl_set_rw_cbs = (e, r) => (_pgl_set_rw_cbs = Module._pgl_set_rw_cbs = wasmExports.pgl_set_rw_cbs)(e, r), _pgl_fcntl = Module._pgl_fcntl = (e, r, t3) => (_pgl_fcntl = Module._pgl_fcntl = wasmExports.pgl_fcntl)(e, r, t3), _strerror = Module._strerror = (e) => (_strerror = Module._strerror = wasmExports.strerror)(e), ___funcs_on_exit = () => (___funcs_on_exit = wasmExports.__funcs_on_exit)(), ___dl_seterr = (e, r) => (___dl_seterr = wasmExports.__dl_seterr)(e, r), _htonl = (e) => (_htonl = wasmExports.htonl)(e), _htons = (e) => (_htons = wasmExports.htons)(e), _emscripten_builtin_memalign = (e, r) => (_emscripten_builtin_memalign = wasmExports.emscripten_builtin_memalign)(e, r), _ntohs = (e) => (_ntohs = wasmExports.ntohs)(e), __emscripten_timeout = (e, r) => (__emscripten_timeout = wasmExports._emscripten_timeout)(e, r), _setThrew = (e, r) => (_setThrew = wasmExports.setThrew)(e, r), __emscripten_stack_restore = (e) => (__emscripten_stack_restore = wasmExports._emscripten_stack_restore)(e), __emscripten_stack_alloc = (e) => (__emscripten_stack_alloc = wasmExports._emscripten_stack_alloc)(e), _emscripten_stack_get_current = () => (_emscripten_stack_get_current = wasmExports.emscripten_stack_get_current)(), ___wasm_apply_data_relocs = () => (___wasm_apply_data_relocs = wasmExports.__wasm_apply_data_relocs)();
        function invoke_iiii(e, r, t3, n3) {
          var o5 = stackSave();
          try {
            return getWasmTableEntry(e)(r, t3, n3);
          } catch (a3) {
            if (stackRestore(o5), a3 !== a3 + 0) throw a3;
            _setThrew(1, 0);
          }
        }
        function invoke_ii(e, r) {
          var t3 = stackSave();
          try {
            return getWasmTableEntry(e)(r);
          } catch (n3) {
            if (stackRestore(t3), n3 !== n3 + 0) throw n3;
            _setThrew(1, 0);
          }
        }
        function invoke_vii(e, r, t3) {
          var n3 = stackSave();
          try {
            getWasmTableEntry(e)(r, t3);
          } catch (o5) {
            if (stackRestore(n3), o5 !== o5 + 0) throw o5;
            _setThrew(1, 0);
          }
        }
        Module.addRunDependency = addRunDependency, Module.removeRunDependency = removeRunDependency, Module.callMain = callMain, Module.ENV = ENV, Module.addFunction = addFunction, Module.removeFunction = removeFunction, Module.UTF8ToString = UTF8ToString, Module.stringToNewUTF8 = stringToNewUTF8, Module.stringToUTF8OnStack = stringToUTF8OnStack, Module.FS_createPreloadedFile = FS_createPreloadedFile, Module.FS_unlink = FS_unlink, Module.FS_createPath = FS_createPath, Module.FS_createDevice = FS_createDevice, Module.FS = FS, Module.FS_createDataFile = FS_createDataFile, Module.FS_createLazyFile = FS_createLazyFile, Module.MEMFS = MEMFS, Module.PROXYFS = PROXYFS;
        var calledRun;
        dependenciesFulfilled = function e() {
          calledRun || run(), calledRun || (dependenciesFulfilled = e);
        };
        function callMain(e = []) {
          var r = resolveGlobalSymbol("main").sym;
          if (r) {
            e.unshift(thisProgram);
            var t3 = e.length, n3 = stackAlloc((t3 + 1) * 4), o5 = n3;
            e.forEach((s5) => {
              HEAPU32[o5 >> 2] = stringToUTF8OnStack(s5), o5 += 4;
            }), HEAPU32[o5 >> 2] = 0;
            try {
              var a3 = r(t3, n3);
              return exitJS(a3, true), a3;
            } catch (s5) {
              return handleException(s5);
            }
          }
        }
        function run(e = arguments_) {
          if (runDependencies > 0 || (preRun(), runDependencies > 0)) return;
          function r() {
            calledRun || (calledRun = true, Module.calledRun = true, !ABORT && (initRuntime(), preMain(), readyPromiseResolve(Module), Module.onRuntimeInitialized?.(), shouldRunNow && callMain(e), postRun()));
          }
          Module.setStatus ? (Module.setStatus("Running..."), setTimeout(() => {
            setTimeout(() => Module.setStatus(""), 1), r();
          }, 1)) : r();
        }
        if (Module.preInit) for (typeof Module.preInit == "function" && (Module.preInit = [Module.preInit]); Module.preInit.length > 0; ) Module.preInit.pop()();
        var shouldRunNow = false;
        return Module.noInitialRun && (shouldRunNow = false), run(), moduleRtn = readyPromise, moduleRtn;
      };
    })();
    xe = Dr;
    Ie = xe;
    u();
    Be = "(?:" + ["\\|\\|", "\\&\\&", ";;", "\\|\\&", "\\<\\(", "\\<\\<\\<", ">>", ">\\&", "<\\&", "[&;()|<>]"].join("|") + ")";
    Ue = new RegExp("^" + Be + "$");
    He = "|&;()<> \\t";
    Nr = '"((\\\\"|[^"])*?)"';
    xr = "'((\\\\'|[^'])*?)'";
    Ir = /^#$/;
    Le = "'";
    Ce = '"';
    de = "$";
    C = "";
    Ur = 4294967296;
    for (let e = 0; e < 4; e++) C += (Ur * Math.random()).toString(16);
    Hr = new RegExp("^" + C);
    I = "/pglite";
    B = I + "/data";
    jr = I + "/icu";
    Yr = I + "/bin/initdb";
    wt = I + "/bin/postgres";
    ze = I + "/pgstdout";
    je = I + "/pgstdin";
    We = class {
      constructor(r) {
        this.dataDir = r;
      }
      async init(r, t3) {
        return this.pg = r, { emscriptenOpts: t3 };
      }
      async syncToFs(r) {
      }
      async initialSyncFs() {
      }
      async closeFs() {
      }
      async dumpTar(r, t3) {
        return ue(this.pg.Module.FS, B, r, t3);
      }
    };
    Ge = class {
      constructor(r, { debug: t3 = false } = {}) {
        this.dataDir = r, this.debug = t3;
      }
      async syncToFs(r) {
      }
      async initialSyncFs() {
      }
      async closeFs() {
      }
      async dumpTar(r, t3) {
        return ue(this.pg.Module.FS, B, r, t3);
      }
      async init(r, t3) {
        return this.pg = r, { emscriptenOpts: { ...t3, preRun: [...t3.preRun || [], (o5) => {
          let a3 = Gr(o5, this);
          o5.FS.mkdir(B), o5.FS.mount(a3, {}, B);
        }] } };
      }
    };
    Ve = { EBADF: 8, EBADFD: 127, EEXIST: 20, EINVAL: 28, EISDIR: 31, ENODEV: 43, ENOENT: 44, ENOTDIR: 54, ENOTEMPTY: 55 };
    Gr = (e, r) => {
      let t3 = e.FS, n3 = r.debug ? console.log : null, o5 = { tryFSOperation(a3) {
        try {
          return a3();
        } catch (s5) {
          throw s5.code ? s5.code === "UNKNOWN" ? new t3.ErrnoError(Ve.EINVAL) : new t3.ErrnoError(s5.code) : s5;
        }
      }, mount(a3) {
        return o5.createNode(null, "/", 16895, 0);
      }, syncfs(a3, s5, l2) {
      }, createNode(a3, s5, l2, u3) {
        if (!t3.isDir(l2) && !t3.isFile(l2)) throw new t3.ErrnoError(28);
        let d3 = t3.createNode(a3, s5, l2);
        return d3.node_ops = o5.node_ops, d3.stream_ops = o5.stream_ops, d3;
      }, getMode: function(a3) {
        return n3?.("getMode", a3), o5.tryFSOperation(() => r.lstat(a3).mode);
      }, realPath: function(a3) {
        let s5 = [];
        for (; a3.parent !== a3; ) s5.push(a3.name), a3 = a3.parent;
        return s5.push(a3.mount.opts.root), s5.reverse(), s5.join("/");
      }, node_ops: { getattr(a3) {
        n3?.("getattr", o5.realPath(a3));
        let s5 = o5.realPath(a3);
        return o5.tryFSOperation(() => {
          let l2 = r.lstat(s5);
          return { ...l2, dev: 0, ino: a3.id, nlink: 1, rdev: a3.rdev, atime: new Date(l2.atime), mtime: new Date(l2.mtime), ctime: new Date(l2.ctime) };
        });
      }, setattr(a3, s5) {
        n3?.("setattr", o5.realPath(a3), s5);
        let l2 = o5.realPath(a3);
        o5.tryFSOperation(() => {
          s5.mode !== void 0 && r.chmod(l2, s5.mode), s5.size !== void 0 && r.truncate(l2, s5.size), s5.timestamp !== void 0 && r.utimes(l2, s5.timestamp, s5.timestamp), s5.size !== void 0 && r.truncate(l2, s5.size);
        });
      }, lookup(a3, s5) {
        n3?.("lookup", o5.realPath(a3), s5);
        let l2 = [o5.realPath(a3), s5].join("/"), u3 = o5.getMode(l2);
        return o5.createNode(a3, s5, u3);
      }, mknod(a3, s5, l2, u3) {
        n3?.("mknod", o5.realPath(a3), s5, l2, u3);
        let d3 = o5.createNode(a3, s5, l2, u3), c4 = o5.realPath(d3);
        return o5.tryFSOperation(() => (t3.isDir(d3.mode) ? r.mkdir(c4, { mode: l2 }) : r.writeFile(c4, "", { mode: l2 }), d3));
      }, rename(a3, s5, l2) {
        n3?.("rename", o5.realPath(a3), o5.realPath(s5), l2);
        let u3 = o5.realPath(a3), d3 = [o5.realPath(s5), l2].join("/");
        o5.tryFSOperation(() => {
          r.rename(u3, d3);
        }), a3.name = l2;
      }, unlink(a3, s5) {
        n3?.("unlink", o5.realPath(a3), s5);
        let l2 = [o5.realPath(a3), s5].join("/");
        try {
          r.unlink(l2);
        } catch {
        }
      }, rmdir(a3, s5) {
        n3?.("rmdir", o5.realPath(a3), s5);
        let l2 = [o5.realPath(a3), s5].join("/");
        return o5.tryFSOperation(() => {
          r.rmdir(l2);
        });
      }, readdir(a3) {
        n3?.("readdir", o5.realPath(a3));
        let s5 = o5.realPath(a3);
        return o5.tryFSOperation(() => r.readdir(s5));
      }, symlink(a3, s5, l2) {
        throw n3?.("symlink", o5.realPath(a3), s5, l2), new t3.ErrnoError(63);
      }, readlink(a3) {
        throw n3?.("readlink", o5.realPath(a3)), new t3.ErrnoError(63);
      } }, stream_ops: { open(a3) {
        n3?.("open stream", o5.realPath(a3.node));
        let s5 = o5.realPath(a3.node);
        return o5.tryFSOperation(() => {
          t3.isFile(a3.node.mode) && (a3.shared.refcount = 1, a3.nfd = r.open(s5));
        });
      }, close(a3) {
        return n3?.("close stream", o5.realPath(a3.node)), o5.tryFSOperation(() => {
          t3.isFile(a3.node.mode) && a3.nfd && --a3.shared.refcount === 0 && r.close(a3.nfd);
        });
      }, dup(a3) {
        n3?.("dup stream", o5.realPath(a3.node)), a3.shared.refcount++;
      }, read(a3, s5, l2, u3, d3) {
        return n3?.("read stream", o5.realPath(a3.node), l2, u3, d3), u3 === 0 ? 0 : o5.tryFSOperation(() => r.read(a3.nfd, s5, l2, u3, d3));
      }, write(a3, s5, l2, u3, d3) {
        return n3?.("write stream", o5.realPath(a3.node), l2, u3, d3), o5.tryFSOperation(() => r.write(a3.nfd, s5.buffer, l2, u3, d3));
      }, llseek(a3, s5, l2) {
        n3?.("llseek stream", o5.realPath(a3.node), s5, l2);
        let u3 = s5;
        if (l2 === 1 ? u3 += a3.position : l2 === 2 && t3.isFile(a3.node.mode) && o5.tryFSOperation(() => {
          let d3 = r.fstat(a3.nfd);
          u3 += d3.size;
        }), u3 < 0) throw new t3.ErrnoError(28);
        return u3;
      }, mmap(a3, s5, l2, u3, d3) {
        if (n3?.("mmap stream", o5.realPath(a3.node), s5, l2, u3, d3), !t3.isFile(a3.node.mode)) throw new t3.ErrnoError(Ve.ENODEV);
        let c4 = e.mmapAlloc(s5);
        return o5.stream_ops.read(a3, e.HEAP8, c4, s5, l2), { ptr: c4, allocated: true };
      }, msync(a3, s5, l2, u3, d3) {
        return n3?.("msync stream", o5.realPath(a3.node), l2, u3, d3), o5.stream_ops.write(a3, s5, 0, u3, l2), 0;
      } } };
      return o5;
    };
  }
});

// node_modules/@electric-sql/pglite/dist/chunk-2B24BK54.js
function se(t3, e, n3) {
  if (t3 === null) return null;
  let s5 = n3?.[e] ?? we.parsers[e];
  return s5 ? s5(t3, e) : t3;
}
function on(t3) {
  return Object.keys(t3).reduce(({ parsers: e, serializers: n3 }, s5) => {
    let { to: i3, from: a3, serialize: u3, parse: m5 } = t3[s5];
    return n3[i3] = u3, n3[s5] = u3, e[s5] = m5, Array.isArray(a3) ? a3.forEach((l2) => {
      e[l2] = m5, n3[l2] = u3;
    }) : (e[a3] = m5, n3[a3] = u3), { parsers: e, serializers: n3 };
  }, { parsers: {}, serializers: {} });
}
function ln(t3) {
  return t3.replace(un, "\\\\").replace(cn, '\\"');
}
function qe(t3, e, n3) {
  if (Array.isArray(t3) === false) return t3;
  if (!t3.length) return "{}";
  let s5 = t3[0], i3 = n3 === 1020 ? ";" : ",";
  return Array.isArray(s5) ? `{${t3.map((a3) => qe(a3, e, n3)).join(i3)}}` : `{${t3.map((a3) => (a3 === void 0 && (a3 = null), a3 === null ? "null" : '"' + ln(e ? e(a3) : a3.toString()) + '"')).join(i3)}}`;
}
function pn(t3, e, n3) {
  return de2.i = de2.last = 0, Ye2(de2, t3, e, n3)[0];
}
function Ye2(t3, e, n3, s5) {
  let i3 = [], a3 = s5 === 1020 ? ";" : ",";
  for (; t3.i < e.length; t3.i++) {
    if (t3.char = e[t3.i], t3.quoted) t3.char === "\\" ? t3.str += e[++t3.i] : t3.char === '"' ? (i3.push(n3 ? n3(t3.str) : t3.str), t3.str = "", t3.quoted = e[t3.i + 1] === '"', t3.last = t3.i + 2) : t3.str += t3.char;
    else if (t3.char === '"') t3.quoted = true;
    else if (t3.char === "{") t3.last = ++t3.i, i3.push(Ye2(t3, e, n3, s5));
    else if (t3.char === "}") {
      if (t3.last < t3.i) {
        let u3 = e.slice(t3.last, t3.i);
        u3 === "NULL" && !t3.quoted ? i3.push(null) : i3.push(n3 ? n3(u3) : u3);
      }
      t3.quoted = false, t3.last = t3.i + 1;
      break;
    } else if (t3.char === a3 && t3.p !== "}" && t3.p !== '"') {
      let u3 = e.slice(t3.last, t3.i);
      u3 === "NULL" && !t3.quoted ? i3.push(null) : i3.push(n3 ? n3(u3) : u3), t3.last = t3.i + 1;
    }
    t3.p = t3.char;
  }
  return t3.last < t3.i && i3.push(n3 ? n3(e.slice(t3.last, t3.i + 1)) : e.slice(t3.last, t3.i + 1)), i3;
}
function fn(t3, e, n3, s5) {
  let i3 = [], a3 = { rows: [], fields: [] }, u3 = 0, m5 = { ...e, ...n3?.parsers };
  return t3.forEach((l2) => {
    switch (l2.name) {
      case "rowDescription": {
        let U3 = l2;
        a3.fields = U3.fields.map((C3) => ({ name: C3.name, dataTypeID: C3.dataTypeID }));
        break;
      }
      case "dataRow": {
        if (!a3) break;
        let U3 = l2;
        n3?.rowMode === "array" ? a3.rows.push(U3.fields.map((C3, te) => se(C3, a3.fields[te].dataTypeID, m5))) : a3.rows.push(Object.fromEntries(U3.fields.map((C3, te) => [a3.fields[te].name, se(C3, a3.fields[te].dataTypeID, m5)])));
        break;
      }
      case "commandComplete": {
        u3 += mn(l2), i3.push({ ...a3, affectedRows: u3, ...s5 ? { blob: s5 } : {} }), a3 = { rows: [], fields: [] };
        break;
      }
    }
  }), i3.length === 0 && i3.push({ affectedRows: 0, rows: [], fields: [] }), i3;
}
function mn(t3) {
  let e = t3.text.split(" ");
  switch (e[0]) {
    case "INSERT":
      return parseInt(e[2], 10);
    case "UPDATE":
    case "DELETE":
    case "COPY":
    case "MERGE":
      return parseInt(e[1], 10);
    default:
      return 0;
  }
}
function yn(t3) {
  let e = t3.find((n3) => n3.name === "parameterDescription");
  return e ? e.dataTypeIDs : [];
}
function T2(t3) {
  let e = t3.length;
  for (let n3 = t3.length - 1; n3 >= 0; n3--) {
    let s5 = t3.charCodeAt(n3);
    s5 > 127 && s5 <= 2047 ? e++ : s5 > 2047 && s5 <= 65535 && (e += 2), s5 >= 56320 && s5 <= 57343 && n3--;
  }
  return e;
}
var dn, dt, ft, fe, me, mt, ye, Oe, Ue2, yt, he, ke2, ht, bt, gt, be, wt2, At2, St, Bt, Dt, It, Ve2, Fe, xt, Mt, Rt, Ct, Et, Tt, Nt, Pt, Lt, Ge2, Qe, _e, Ot, ve, ge, Ut, kt, Vt, Ft, Gt, Qt, _t, vt, Ht, zt, qt, Yt, jt, Wt, Kt, Jt, $t, Xt, Zt, en, tn, He2, nn, rn, ze2, we, sn, an, un, cn, de2, hn, Ce2, Ae, Se, Be2, De2, Ie2, xe2, Me2, Re2, k, V, F2, G2, Q, _2, E, v2, H, z, q, Y2, j, W2, K, J, $, X, Z, vn, b2, g2, P2, ae, L2, S2, ie2, N, je2, R2, f3, bn, gn, wn, An, Sn, Bn, Dn, In, O, xn, Mn, Rn, Cn, En, Ee, Tn, Nn, Pn, Ln, On, Un, oe, kn, Vn, Fn, Gn, We2, Te, Qn, M, w2, ce2, le, ee, ue2, Ne2, _n, Ke, Je, A, B2, D3, o2, c3, $e, Xe, Ze, et, tt, nt, rt, Pe, st, it, at2, ot, ut, ct, lt, pt, Le2, pe;
var init_chunk_2B24BK54 = __esm({
  "node_modules/@electric-sql/pglite/dist/chunk-2B24BK54.js"() {
    init_chunk_QY3QWFKW();
    dn = {};
    F(dn, { ABSTIME: () => xt, ACLITEM: () => Lt, BIT: () => Vt, BOOL: () => fe, BPCHAR: () => Ge2, BYTEA: () => me, CHAR: () => mt, CID: () => gt, CIDR: () => It, CIRCLE: () => Ct, DATE: () => _e, FLOAT4: () => Ve2, FLOAT8: () => Fe, GTSVECTOR: () => Zt, INET: () => Pt, INT2: () => Oe, INT4: () => Ue2, INT8: () => ye, INTERVAL: () => Ut, JSON: () => be, JSONB: () => He2, MACADDR: () => Nt, MACADDR8: () => Et, MONEY: () => Tt, NUMERIC: () => Gt, OID: () => ke2, PATH: () => Bt, PG_DEPENDENCIES: () => Jt, PG_LSN: () => Wt, PG_NDISTINCT: () => Kt, PG_NODE_TREE: () => At2, POLYGON: () => Dt, REFCURSOR: () => Qt, REGCLASS: () => zt, REGCONFIG: () => en, REGDICTIONARY: () => tn, REGNAMESPACE: () => nn, REGOPER: () => vt, REGOPERATOR: () => Ht, REGPROC: () => yt, REGPROCEDURE: () => _t, REGROLE: () => rn, REGTYPE: () => qt, RELTIME: () => Mt, SMGR: () => St, TEXT: () => he, TID: () => ht, TIME: () => Ot, TIMESTAMP: () => ve, TIMESTAMPTZ: () => ge, TIMETZ: () => kt, TINTERVAL: () => Rt, TSQUERY: () => Xt, TSVECTOR: () => $t, TXID_SNAPSHOT: () => jt, UUID: () => Yt, VARBIT: () => Ft, VARCHAR: () => Qe, XID: () => bt, XML: () => wt2, arrayParser: () => pn, arraySerializer: () => qe, parseType: () => se, parsers: () => sn, serializers: () => an, types: () => ze2 });
    u();
    dt = globalThis.JSON.parse;
    ft = globalThis.JSON.stringify;
    fe = 16;
    me = 17;
    mt = 18;
    ye = 20;
    Oe = 21;
    Ue2 = 23;
    yt = 24;
    he = 25;
    ke2 = 26;
    ht = 27;
    bt = 28;
    gt = 29;
    be = 114;
    wt2 = 142;
    At2 = 194;
    St = 210;
    Bt = 602;
    Dt = 604;
    It = 650;
    Ve2 = 700;
    Fe = 701;
    xt = 702;
    Mt = 703;
    Rt = 704;
    Ct = 718;
    Et = 774;
    Tt = 790;
    Nt = 829;
    Pt = 869;
    Lt = 1033;
    Ge2 = 1042;
    Qe = 1043;
    _e = 1082;
    Ot = 1083;
    ve = 1114;
    ge = 1184;
    Ut = 1186;
    kt = 1266;
    Vt = 1560;
    Ft = 1562;
    Gt = 1700;
    Qt = 1790;
    _t = 2202;
    vt = 2203;
    Ht = 2204;
    zt = 2205;
    qt = 2206;
    Yt = 2950;
    jt = 2970;
    Wt = 3220;
    Kt = 3361;
    Jt = 3402;
    $t = 3614;
    Xt = 3615;
    Zt = 3642;
    en = 3734;
    tn = 3769;
    He2 = 3802;
    nn = 4089;
    rn = 4096;
    ze2 = { string: { to: he, from: [he, Qe, Ge2], serialize: (t3) => t3 instanceof Date ? t3.toISOString() : t3.toString(), parse: (t3) => t3 }, number: { to: 0, from: [Oe, Ue2, ke2, Ve2, Fe], serialize: (t3) => t3.toString(), parse: (t3) => +t3 }, bigint: { to: ye, from: [ye], serialize: (t3) => t3.toString(), parse: (t3) => {
      let e = BigInt(t3);
      return e < Number.MIN_SAFE_INTEGER || e > Number.MAX_SAFE_INTEGER ? e : Number(e);
    } }, json: { to: be, from: [be, He2], serialize: (t3) => typeof t3 == "string" ? t3 : ft(t3, (e, n3) => typeof n3 == "bigint" ? n3.toString() : n3), parse: (t3) => dt(t3) }, boolean: { to: fe, from: [fe], serialize: (t3) => {
      if (typeof t3 == "boolean") return t3 ? "t" : "f";
      if (typeof t3 == "number") {
        if (t3 === 1) return "t";
        if (t3 === 0) return "f";
      } else if (typeof t3 == "string") {
        let e = t3.trim().toLowerCase();
        if (["true", "t", "yes", "y", "on", "1"].includes(e)) return "t";
        if (["false", "f", "no", "n", "off", "0"].includes(e)) return "f";
      }
      throw new Error("Invalid input for boolean type");
    }, parse: (t3) => t3 === "t" }, date: { to: ge, from: [_e, ve, ge], serialize: (t3) => {
      if (typeof t3 == "string") return t3;
      if (typeof t3 == "number") return new Date(t3).toISOString();
      if (t3 instanceof Date) return t3.toISOString();
      throw new Error("Invalid input for date type");
    }, parse: (t3) => new Date(t3) }, bytea: { to: me, from: [me], serialize: (t3) => {
      if (!(t3 instanceof Uint8Array)) throw new Error("Invalid input for bytea type");
      return "\\x" + Array.from(t3).map((e) => e.toString(16).padStart(2, "0")).join("");
    }, parse: (t3) => {
      let e = t3.slice(2);
      return Uint8Array.from({ length: e.length / 2 }, (n3, s5) => parseInt(e.substring(s5 * 2, (s5 + 1) * 2), 16));
    } } };
    we = on(ze2);
    sn = we.parsers;
    an = we.serializers;
    un = /\\/g;
    cn = /"/g;
    de2 = { i: 0, char: null, str: "", quoted: false, last: 0, p: null };
    hn = {};
    F(hn, { parseDescribeStatementResults: () => yn, parseResults: () => fn });
    u();
    Ce2 = {};
    F(Ce2, { AuthenticationCleartextPassword: () => V, AuthenticationMD5Password: () => F2, AuthenticationOk: () => k, AuthenticationSASL: () => G2, AuthenticationSASLContinue: () => Q, AuthenticationSASLFinal: () => _2, BackendKeyDataMessage: () => W2, CommandCompleteMessage: () => $, CopyDataMessage: () => v2, CopyResponse: () => H, DataRowMessage: () => X, DatabaseError: () => E, Field: () => z, NoticeMessage: () => Z, NotificationResponseMessage: () => K, ParameterDescriptionMessage: () => Y2, ParameterStatusMessage: () => j, ReadyForQueryMessage: () => J, RowDescriptionMessage: () => q, bindComplete: () => Se, closeComplete: () => Be2, copyDone: () => Re2, emptyQuery: () => Me2, noData: () => De2, parseComplete: () => Ae, portalSuspended: () => Ie2, replicationStart: () => xe2 });
    u();
    Ae = { name: "parseComplete", length: 5 };
    Se = { name: "bindComplete", length: 5 };
    Be2 = { name: "closeComplete", length: 5 };
    De2 = { name: "noData", length: 5 };
    Ie2 = { name: "portalSuspended", length: 5 };
    xe2 = { name: "replicationStart", length: 4 };
    Me2 = { name: "emptyQuery", length: 4 };
    Re2 = { name: "copyDone", length: 4 };
    k = class {
      constructor(e) {
        this.length = e;
        this.name = "authenticationOk";
      }
    };
    V = class {
      constructor(e) {
        this.length = e;
        this.name = "authenticationCleartextPassword";
      }
    };
    F2 = class {
      constructor(e, n3) {
        this.length = e;
        this.salt = n3;
        this.name = "authenticationMD5Password";
      }
    };
    G2 = class {
      constructor(e, n3) {
        this.length = e;
        this.mechanisms = n3;
        this.name = "authenticationSASL";
      }
    };
    Q = class {
      constructor(e, n3) {
        this.length = e;
        this.data = n3;
        this.name = "authenticationSASLContinue";
      }
    };
    _2 = class {
      constructor(e, n3) {
        this.length = e;
        this.data = n3;
        this.name = "authenticationSASLFinal";
      }
    };
    E = class extends Error {
      constructor(n3, s5, i3) {
        super(n3);
        this.length = s5;
        this.name = i3;
      }
    };
    v2 = class {
      constructor(e, n3) {
        this.length = e;
        this.chunk = n3;
        this.name = "copyData";
      }
    };
    H = class {
      constructor(e, n3, s5, i3) {
        this.length = e;
        this.name = n3;
        this.binary = s5;
        this.columnTypes = new Array(i3);
      }
    };
    z = class {
      constructor(e, n3, s5, i3, a3, u3, m5) {
        this.name = e;
        this.tableID = n3;
        this.columnID = s5;
        this.dataTypeID = i3;
        this.dataTypeSize = a3;
        this.dataTypeModifier = u3;
        this.format = m5;
      }
    };
    q = class {
      constructor(e, n3) {
        this.length = e;
        this.fieldCount = n3;
        this.name = "rowDescription";
        this.fields = new Array(this.fieldCount);
      }
    };
    Y2 = class {
      constructor(e, n3) {
        this.length = e;
        this.parameterCount = n3;
        this.name = "parameterDescription";
        this.dataTypeIDs = new Array(this.parameterCount);
      }
    };
    j = class {
      constructor(e, n3, s5) {
        this.length = e;
        this.parameterName = n3;
        this.parameterValue = s5;
        this.name = "parameterStatus";
      }
    };
    W2 = class {
      constructor(e, n3, s5) {
        this.length = e;
        this.processID = n3;
        this.secretKey = s5;
        this.name = "backendKeyData";
      }
    };
    K = class {
      constructor(e, n3, s5, i3) {
        this.length = e;
        this.processId = n3;
        this.channel = s5;
        this.payload = i3;
        this.name = "notification";
      }
    };
    J = class {
      constructor(e, n3) {
        this.length = e;
        this.status = n3;
        this.name = "readyForQuery";
      }
    };
    $ = class {
      constructor(e, n3) {
        this.length = e;
        this.text = n3;
        this.name = "commandComplete";
      }
    };
    X = class {
      constructor(e, n3) {
        this.length = e;
        this.fields = n3;
        this.name = "dataRow";
        this.fieldCount = n3.length;
      }
    };
    Z = class {
      constructor(e, n3) {
        this.length = e;
        this.message = n3;
        this.name = "notice";
      }
    };
    vn = {};
    F(vn, { Parser: () => pe, messages: () => Ce2, serialize: () => We2 });
    u();
    u();
    u();
    u();
    R2 = class {
      constructor(e = 256) {
        this.size = e;
        R(this, S2);
        R(this, b2);
        R(this, g2, 5);
        R(this, P2, false);
        R(this, ae, new TextEncoder());
        R(this, L2, 0);
        x(this, b2, T(this, S2, ie2).call(this, e));
      }
      addInt32(e) {
        return T(this, S2, N).call(this, 4), h(this, b2).setInt32(h(this, g2), e, h(this, P2)), x(this, g2, h(this, g2) + 4), this;
      }
      addInt16(e) {
        return T(this, S2, N).call(this, 2), h(this, b2).setInt16(h(this, g2), e, h(this, P2)), x(this, g2, h(this, g2) + 2), this;
      }
      addCString(e) {
        return e && this.addString(e), T(this, S2, N).call(this, 1), h(this, b2).setUint8(h(this, g2), 0), U(this, g2)._++, this;
      }
      addString(e = "") {
        let n3 = T2(e);
        return T(this, S2, N).call(this, n3), h(this, ae).encodeInto(e, new Uint8Array(h(this, b2).buffer, h(this, g2))), x(this, g2, h(this, g2) + n3), this;
      }
      add(e) {
        return T(this, S2, N).call(this, e.byteLength), new Uint8Array(h(this, b2).buffer).set(new Uint8Array(e), h(this, g2)), x(this, g2, h(this, g2) + e.byteLength), this;
      }
      flush(e) {
        let n3 = T(this, S2, je2).call(this, e);
        return x(this, g2, 5), x(this, b2, T(this, S2, ie2).call(this, this.size)), new Uint8Array(n3);
      }
    };
    b2 = /* @__PURE__ */ new WeakMap(), g2 = /* @__PURE__ */ new WeakMap(), P2 = /* @__PURE__ */ new WeakMap(), ae = /* @__PURE__ */ new WeakMap(), L2 = /* @__PURE__ */ new WeakMap(), S2 = /* @__PURE__ */ new WeakSet(), ie2 = function(e) {
      return new DataView(new ArrayBuffer(e));
    }, N = function(e) {
      if (h(this, b2).byteLength - h(this, g2) < e) {
        let s5 = h(this, b2).buffer, i3 = s5.byteLength + (s5.byteLength >> 1) + e;
        x(this, b2, T(this, S2, ie2).call(this, i3)), new Uint8Array(h(this, b2).buffer).set(new Uint8Array(s5));
      }
    }, je2 = function(e) {
      if (e) {
        h(this, b2).setUint8(h(this, L2), e);
        let n3 = h(this, g2) - (h(this, L2) + 1);
        h(this, b2).setInt32(h(this, L2) + 1, n3, h(this, P2));
      }
      return h(this, b2).buffer.slice(e ? 0 : 5, h(this, g2));
    };
    f3 = new R2();
    bn = (t3) => {
      f3.addInt16(3).addInt16(0);
      for (let s5 of Object.keys(t3)) f3.addCString(s5).addCString(t3[s5]);
      f3.addCString("client_encoding").addCString("UTF8");
      let e = f3.addCString("").flush(), n3 = e.byteLength + 4;
      return new R2().addInt32(n3).add(e).flush();
    };
    gn = () => {
      let t3 = new DataView(new ArrayBuffer(8));
      return t3.setInt32(0, 8, false), t3.setInt32(4, 80877103, false), new Uint8Array(t3.buffer);
    };
    wn = (t3) => f3.addCString(t3).flush(112);
    An = (t3, e) => (f3.addCString(t3).addInt32(T2(e)).addString(e), f3.flush(112));
    Sn = (t3) => f3.addString(t3).flush(112);
    Bn = (t3) => f3.addCString(t3).flush(81);
    Dn = [];
    In = (t3) => {
      let e = t3.name ?? "";
      e.length > 63 && (console.error("Warning! Postgres only supports 63 characters for query names."), console.error("You supplied %s (%s)", e, e.length), console.error("This can cause conflicts and silent errors executing queries"));
      let n3 = f3.addCString(e).addCString(t3.text).addInt16(t3.types?.length ?? 0);
      return t3.types?.forEach((s5) => n3.addInt32(s5)), f3.flush(80);
    };
    O = new R2();
    xn = (t3, e) => {
      for (let n3 = 0; n3 < t3.length; n3++) {
        let s5 = e ? e(t3[n3], n3) : t3[n3];
        if (s5 === null) f3.addInt16(0), O.addInt32(-1);
        else if (s5 instanceof ArrayBuffer || ArrayBuffer.isView(s5)) {
          let i3 = ArrayBuffer.isView(s5) ? s5.buffer.slice(s5.byteOffset, s5.byteOffset + s5.byteLength) : s5;
          f3.addInt16(1), O.addInt32(i3.byteLength), O.add(i3);
        } else f3.addInt16(0), O.addInt32(T2(s5)), O.addString(s5);
      }
    };
    Mn = (t3 = {}) => {
      let e = t3.portal ?? "", n3 = t3.statement ?? "", s5 = t3.binary ?? false, i3 = t3.values ?? Dn, a3 = i3.length;
      return f3.addCString(e).addCString(n3), f3.addInt16(a3), xn(i3, t3.valueMapper), f3.addInt16(a3), f3.add(O.flush()), f3.addInt16(s5 ? 1 : 0), f3.flush(66);
    };
    Rn = new Uint8Array([69, 0, 0, 0, 9, 0, 0, 0, 0, 0]);
    Cn = (t3) => {
      if (!t3 || !t3.portal && !t3.rows) return Rn;
      let e = t3.portal ?? "", n3 = t3.rows ?? 0, s5 = T2(e), i3 = 4 + s5 + 1 + 4, a3 = new DataView(new ArrayBuffer(1 + i3));
      return a3.setUint8(0, 69), a3.setInt32(1, i3, false), new TextEncoder().encodeInto(e, new Uint8Array(a3.buffer, 5)), a3.setUint8(s5 + 5, 0), a3.setUint32(a3.byteLength - 4, n3, false), new Uint8Array(a3.buffer);
    };
    En = (t3, e) => {
      let n3 = new DataView(new ArrayBuffer(16));
      return n3.setInt32(0, 16, false), n3.setInt16(4, 1234, false), n3.setInt16(6, 5678, false), n3.setInt32(8, t3, false), n3.setInt32(12, e, false), new Uint8Array(n3.buffer);
    };
    Ee = (t3, e) => {
      let n3 = new R2();
      return n3.addCString(e), n3.flush(t3);
    };
    Tn = f3.addCString("P").flush(68);
    Nn = f3.addCString("S").flush(68);
    Pn = (t3) => t3.name ? Ee(68, `${t3.type}${t3.name ?? ""}`) : t3.type === "P" ? Tn : Nn;
    Ln = (t3) => {
      let e = `${t3.type}${t3.name ?? ""}`;
      return Ee(67, e);
    };
    On = (t3) => f3.add(t3).flush(100);
    Un = (t3) => Ee(102, t3);
    oe = (t3) => new Uint8Array([t3, 0, 0, 0, 4]);
    kn = oe(72);
    Vn = oe(83);
    Fn = oe(88);
    Gn = oe(99);
    We2 = { startup: bn, password: wn, requestSsl: gn, sendSASLInitialResponseMessage: An, sendSCRAMClientFinalMessage: Sn, query: Bn, parse: In, bind: Mn, execute: Cn, describe: Pn, close: Ln, flush: () => kn, sync: () => Vn, end: () => Fn, copyData: On, copyDone: () => Gn, copyFail: Un, cancel: En };
    u();
    u();
    Te = { text: 0, binary: 1 };
    u();
    Qn = new ArrayBuffer(0);
    ue2 = class {
      constructor(e = 0) {
        R(this, M, new DataView(Qn));
        R(this, w2);
        R(this, ce2, "utf-8");
        R(this, le, new TextDecoder(h(this, ce2)));
        R(this, ee, false);
        x(this, w2, e);
      }
      setBuffer(e, n3) {
        x(this, w2, e), x(this, M, new DataView(n3));
      }
      int16() {
        let e = h(this, M).getInt16(h(this, w2), h(this, ee));
        return x(this, w2, h(this, w2) + 2), e;
      }
      byte() {
        let e = h(this, M).getUint8(h(this, w2));
        return U(this, w2)._++, e;
      }
      int32() {
        let e = h(this, M).getInt32(h(this, w2), h(this, ee));
        return x(this, w2, h(this, w2) + 4), e;
      }
      string(e) {
        return h(this, le).decode(this.bytes(e));
      }
      cstring() {
        let e = h(this, w2), n3 = e;
        for (; h(this, M).getUint8(n3++) !== 0; ) ;
        let s5 = this.string(n3 - e - 1);
        return x(this, w2, n3), s5;
      }
      bytes(e) {
        let n3 = h(this, M).buffer.slice(h(this, w2), h(this, w2) + e);
        return x(this, w2, h(this, w2) + e), new Uint8Array(n3);
      }
    };
    M = /* @__PURE__ */ new WeakMap(), w2 = /* @__PURE__ */ new WeakMap(), ce2 = /* @__PURE__ */ new WeakMap(), le = /* @__PURE__ */ new WeakMap(), ee = /* @__PURE__ */ new WeakMap();
    Ne2 = 1;
    _n = 4;
    Ke = Ne2 + _n;
    Je = new ArrayBuffer(0);
    pe = class {
      constructor() {
        R(this, c3);
        R(this, A, new DataView(Je));
        R(this, B2, 0);
        R(this, D3, 0);
        R(this, o2, new ue2());
      }
      parse(e, n3) {
        T(this, c3, $e).call(this, ArrayBuffer.isView(e) ? e.buffer.slice(e.byteOffset, e.byteOffset + e.byteLength) : e);
        let s5 = h(this, D3) + h(this, B2), i3 = h(this, D3);
        for (; i3 + Ke <= s5; ) {
          let a3 = h(this, A).getUint8(i3), u3 = h(this, A).getUint32(i3 + Ne2, false), m5 = Ne2 + u3;
          if (m5 + i3 <= s5 && u3 > 0) {
            let l2 = T(this, c3, Xe).call(this, i3 + Ke, a3, u3, h(this, A).buffer);
            n3(l2), i3 += m5;
          } else break;
        }
        i3 === s5 ? (x(this, A, new DataView(Je)), x(this, B2, 0), x(this, D3, 0)) : (x(this, B2, s5 - i3), x(this, D3, i3));
      }
    };
    A = /* @__PURE__ */ new WeakMap(), B2 = /* @__PURE__ */ new WeakMap(), D3 = /* @__PURE__ */ new WeakMap(), o2 = /* @__PURE__ */ new WeakMap(), c3 = /* @__PURE__ */ new WeakSet(), $e = function(e) {
      if (h(this, B2) > 0) {
        let n3 = h(this, B2) + e.byteLength;
        if (n3 + h(this, D3) > h(this, A).byteLength) {
          let i3;
          if (n3 <= h(this, A).byteLength && h(this, D3) >= h(this, B2)) i3 = h(this, A).buffer;
          else {
            let a3 = h(this, A).byteLength * 2;
            for (; n3 >= a3; ) a3 *= 2;
            i3 = new ArrayBuffer(a3);
          }
          new Uint8Array(i3).set(new Uint8Array(h(this, A).buffer, h(this, D3), h(this, B2))), x(this, A, new DataView(i3)), x(this, D3, 0);
        }
        new Uint8Array(h(this, A).buffer).set(new Uint8Array(e), h(this, D3) + h(this, B2)), x(this, B2, n3);
      } else x(this, A, new DataView(e)), x(this, D3, 0), x(this, B2, e.byteLength);
    }, Xe = function(e, n3, s5, i3) {
      switch (n3) {
        case 50:
          return Se;
        case 49:
          return Ae;
        case 51:
          return Be2;
        case 110:
          return De2;
        case 115:
          return Ie2;
        case 99:
          return Re2;
        case 87:
          return xe2;
        case 73:
          return Me2;
        case 68:
          return T(this, c3, ut).call(this, e, s5, i3);
        case 67:
          return T(this, c3, et).call(this, e, s5, i3);
        case 90:
          return T(this, c3, Ze).call(this, e, s5, i3);
        case 65:
          return T(this, c3, st).call(this, e, s5, i3);
        case 82:
          return T(this, c3, pt).call(this, e, s5, i3);
        case 83:
          return T(this, c3, ct).call(this, e, s5, i3);
        case 75:
          return T(this, c3, lt).call(this, e, s5, i3);
        case 69:
          return T(this, c3, Le2).call(this, e, s5, i3, "error");
        case 78:
          return T(this, c3, Le2).call(this, e, s5, i3, "notice");
        case 84:
          return T(this, c3, it).call(this, e, s5, i3);
        case 116:
          return T(this, c3, ot).call(this, e, s5, i3);
        case 71:
          return T(this, c3, nt).call(this, e, s5, i3);
        case 72:
          return T(this, c3, rt).call(this, e, s5, i3);
        case 100:
          return T(this, c3, tt).call(this, e, s5, i3);
        default:
          return new E("received invalid response: " + n3.toString(16), s5, "error");
      }
    }, Ze = function(e, n3, s5) {
      h(this, o2).setBuffer(e, s5);
      let i3 = h(this, o2).string(1);
      return new J(n3, i3);
    }, et = function(e, n3, s5) {
      h(this, o2).setBuffer(e, s5);
      let i3 = h(this, o2).cstring();
      return new $(n3, i3);
    }, tt = function(e, n3, s5) {
      let i3 = s5.slice(e, e + (n3 - 4));
      return new v2(n3, new Uint8Array(i3));
    }, nt = function(e, n3, s5) {
      return T(this, c3, Pe).call(this, e, n3, s5, "copyInResponse");
    }, rt = function(e, n3, s5) {
      return T(this, c3, Pe).call(this, e, n3, s5, "copyOutResponse");
    }, Pe = function(e, n3, s5, i3) {
      h(this, o2).setBuffer(e, s5);
      let a3 = h(this, o2).byte() !== 0, u3 = h(this, o2).int16(), m5 = new H(n3, i3, a3, u3);
      for (let l2 = 0; l2 < u3; l2++) m5.columnTypes[l2] = h(this, o2).int16();
      return m5;
    }, st = function(e, n3, s5) {
      h(this, o2).setBuffer(e, s5);
      let i3 = h(this, o2).int32(), a3 = h(this, o2).cstring(), u3 = h(this, o2).cstring();
      return new K(n3, i3, a3, u3);
    }, it = function(e, n3, s5) {
      h(this, o2).setBuffer(e, s5);
      let i3 = h(this, o2).int16(), a3 = new q(n3, i3);
      for (let u3 = 0; u3 < i3; u3++) a3.fields[u3] = T(this, c3, at2).call(this);
      return a3;
    }, at2 = function() {
      let e = h(this, o2).cstring(), n3 = h(this, o2).int32(), s5 = h(this, o2).int16(), i3 = h(this, o2).int32(), a3 = h(this, o2).int16(), u3 = h(this, o2).int32(), m5 = h(this, o2).int16() === 0 ? Te.text : Te.binary;
      return new z(e, n3, s5, i3, a3, u3, m5);
    }, ot = function(e, n3, s5) {
      h(this, o2).setBuffer(e, s5);
      let i3 = h(this, o2).int16(), a3 = new Y2(n3, i3);
      for (let u3 = 0; u3 < i3; u3++) a3.dataTypeIDs[u3] = h(this, o2).int32();
      return a3;
    }, ut = function(e, n3, s5) {
      h(this, o2).setBuffer(e, s5);
      let i3 = h(this, o2).int16(), a3 = new Array(i3);
      for (let u3 = 0; u3 < i3; u3++) {
        let m5 = h(this, o2).int32();
        a3[u3] = m5 === -1 ? null : h(this, o2).string(m5);
      }
      return new X(n3, a3);
    }, ct = function(e, n3, s5) {
      h(this, o2).setBuffer(e, s5);
      let i3 = h(this, o2).cstring(), a3 = h(this, o2).cstring();
      return new j(n3, i3, a3);
    }, lt = function(e, n3, s5) {
      h(this, o2).setBuffer(e, s5);
      let i3 = h(this, o2).int32(), a3 = h(this, o2).int32();
      return new W2(n3, i3, a3);
    }, pt = function(e, n3, s5) {
      h(this, o2).setBuffer(e, s5);
      let i3 = h(this, o2).int32();
      switch (i3) {
        case 0:
          return new k(n3);
        case 3:
          return new V(n3);
        case 5:
          return new F2(n3, h(this, o2).bytes(4));
        case 10: {
          let a3 = [];
          for (; ; ) {
            let u3 = h(this, o2).cstring();
            if (u3.length === 0) return new G2(n3, a3);
            a3.push(u3);
          }
        }
        case 11:
          return new Q(n3, h(this, o2).string(n3 - 8));
        case 12:
          return new _2(n3, h(this, o2).string(n3 - 8));
        default:
          throw new Error("Unknown authenticationOk message type " + i3);
      }
    }, Le2 = function(e, n3, s5, i3) {
      h(this, o2).setBuffer(e, s5);
      let a3 = {}, u3 = h(this, o2).string(1);
      for (; u3 !== "\0"; ) a3[u3] = h(this, o2).cstring(), u3 = h(this, o2).string(1);
      let m5 = a3.M, l2 = i3 === "notice" ? new Z(n3, m5) : new E(m5, n3, i3);
      return l2.severity = a3.S, l2.code = a3.C, l2.detail = a3.D, l2.hint = a3.H, l2.position = a3.P, l2.internalPosition = a3.p, l2.internalQuery = a3.q, l2.where = a3.W, l2.schema = a3.s, l2.table = a3.t, l2.column = a3.c, l2.dataType = a3.d, l2.constraint = a3.n, l2.file = a3.F, l2.line = a3.L, l2.routine = a3.R, l2;
    };
  }
});

// node_modules/@electric-sql/pglite/dist/chunk-QY575LMP.js
async function v3(s5, e, r, n3) {
  if (!r || r.length === 0) return e;
  n3 = n3 ?? s5;
  let t3 = [];
  try {
    await s5.execProtocol(We2.parse({ text: e }), { syncToFs: false }), t3.push(...(await s5.execProtocol(We2.describe({ type: "S" }), { syncToFs: false })).messages);
  } finally {
    t3.push(...(await s5.execProtocol(We2.sync(), { syncToFs: false })).messages);
  }
  let a3 = yn(t3), i3 = e.replace(/\$([0-9]+)/g, (d3, l2) => "%" + l2 + "L");
  return (await n3.query(`SELECT format($1, ${r.map((d3, l2) => `$${l2 + 2}`).join(", ")}) as query`, [i3, ...r], { paramTypes: [he, ...a3] })).rows[0].query;
}
var init_chunk_QY575LMP = __esm({
  "node_modules/@electric-sql/pglite/dist/chunk-QY575LMP.js"() {
    init_chunk_2B24BK54();
    init_chunk_QY3QWFKW();
    u();
  }
});

// node_modules/@electric-sql/pglite/dist/chunk-F4GETNPB.js
function s3(t3, r, ...e) {
  let a3 = t3.length - 1, p6 = e.length - 1;
  if (p6 !== -1) {
    if (p6 === 0) {
      t3[a3] = t3[a3] + e[0] + r;
      return;
    }
    t3[a3] = t3[a3] + e[0], t3.push(...e.slice(1, p6)), t3.push(e[p6] + r);
  }
}
function y2(t3, ...r) {
  let e = [t3[0]];
  e.raw = [t3.raw[0]];
  let a3 = [];
  for (let p6 = 0; p6 < r.length; p6++) {
    let n3 = r[p6], i3 = p6 + 1;
    if (n3?._templateType === o3.part) {
      s3(e, t3[i3], n3.str), s3(e.raw, t3.raw[i3], n3.str);
      continue;
    }
    if (n3?._templateType === o3.container) {
      s3(e, t3[i3], ...n3.strings), s3(e.raw, t3.raw[i3], ...n3.strings.raw), a3.push(...n3.values);
      continue;
    }
    e.push(t3[i3]), e.raw.push(t3.raw[i3]), a3.push(n3);
  }
  return { _templateType: "container", strings: e, values: a3 };
}
function g3(t3, ...r) {
  let { strings: e, values: a3 } = y2(t3, ...r);
  return { query: [e[0], ...a3.flatMap((p6, n3) => [`$${n3 + 1}`, e[n3 + 1]])].join(""), params: a3 };
}
var o3;
var init_chunk_F4GETNPB = __esm({
  "node_modules/@electric-sql/pglite/dist/chunk-F4GETNPB.js"() {
    init_chunk_QY3QWFKW();
    u();
    o3 = { part: "part", container: "container" };
  }
});

// node_modules/@electric-sql/pglite/dist/chunk-SRXPYZFS.js
function E2(h3) {
  let s5 = h3.e;
  return s5.query = h3.query, s5.params = h3.params, s5.queryOptions = h3.options, s5;
}
var P3, p3, t, y3, x2, m2, _3, z2;
var init_chunk_SRXPYZFS = __esm({
  "node_modules/@electric-sql/pglite/dist/chunk-SRXPYZFS.js"() {
    init_chunk_2B24BK54();
    init_chunk_F4GETNPB();
    init_chunk_QY3QWFKW();
    u();
    u();
    z2 = class {
      constructor() {
        R(this, t);
        this.serializers = { ...an };
        this.parsers = { ...sn };
        R(this, P3, false);
        R(this, p3, false);
      }
      async _initArrayTypes({ force: s5 = false } = {}) {
        if (h(this, P3) && !s5) return;
        x(this, P3, true);
        let e = await this.query(`
      SELECT b.oid, b.typarray
      FROM pg_catalog.pg_type a
      LEFT JOIN pg_catalog.pg_type b ON b.oid = a.typelem
      WHERE a.typcategory = 'A'
      GROUP BY b.oid, b.typarray
      ORDER BY b.oid
    `);
        for (let r of e.rows) this.serializers[r.typarray] = (o5) => qe(o5, this.serializers[r.oid], r.typarray), this.parsers[r.typarray] = (o5) => pn(o5, this.parsers[r.oid], r.typarray);
      }
      async refreshArrayTypes() {
        await this._initArrayTypes({ force: true });
      }
      async query(s5, e, r) {
        return await this._checkReady(), await this._runExclusiveTransaction(async () => await T(this, t, x2).call(this, s5, e, r));
      }
      async sql(s5, ...e) {
        let { query: r, params: o5 } = g3(s5, ...e);
        return await this.query(r, o5);
      }
      async exec(s5, e) {
        return await this._checkReady(), await this._runExclusiveTransaction(async () => await T(this, t, m2).call(this, s5, e));
      }
      async describeQuery(s5, e) {
        let r = [];
        try {
          await T(this, t, y3).call(this, We2.parse({ text: s5, types: e?.paramTypes }), e), r = await T(this, t, y3).call(this, We2.describe({ type: "S" }), e);
        } catch (n3) {
          throw n3 instanceof E ? E2({ e: n3, options: e, params: void 0, query: s5 }) : n3;
        } finally {
          r.push(...await T(this, t, y3).call(this, We2.sync(), e));
        }
        let o5 = r.find((n3) => n3.name === "parameterDescription"), i3 = r.find((n3) => n3.name === "rowDescription"), c4 = o5?.dataTypeIDs.map((n3) => ({ dataTypeID: n3, serializer: this.serializers[n3] })) ?? [], u3 = i3?.fields.map((n3) => ({ name: n3.name, dataTypeID: n3.dataTypeID, parser: this.parsers[n3.dataTypeID] })) ?? [];
        return { queryParams: c4, resultFields: u3 };
      }
      async transaction(s5) {
        return await this._checkReady(), await this._runExclusiveTransaction(async () => {
          await T(this, t, m2).call(this, "BEGIN"), x(this, p3, true);
          let e = false, r = () => {
            if (e) throw new Error("Transaction is closed");
          }, o5 = { query: async (i3, c4, u3) => (r(), await T(this, t, x2).call(this, i3, c4, u3)), sql: async (i3, ...c4) => {
            let { query: u3, params: n3 } = g3(i3, ...c4);
            return await T(this, t, x2).call(this, u3, n3);
          }, exec: async (i3, c4) => (r(), await T(this, t, m2).call(this, i3, c4)), rollback: async () => {
            r(), await T(this, t, m2).call(this, "ROLLBACK"), e = true;
          }, listen: async (i3, c4) => (r(), await this.listen(i3, c4, o5)), get closed() {
            return e;
          } };
          try {
            let i3 = await s5(o5);
            return e || (e = true, await T(this, t, m2).call(this, "COMMIT")), x(this, p3, false), i3;
          } catch (i3) {
            throw e || await T(this, t, m2).call(this, "ROLLBACK"), x(this, p3, false), i3;
          }
        });
      }
      async runExclusive(s5) {
        return await this._runExclusiveQuery(s5);
      }
    };
    P3 = /* @__PURE__ */ new WeakMap(), p3 = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakSet(), y3 = async function(s5, e = {}) {
      return await this.execProtocolStream(s5, { ...e, syncToFs: false });
    }, x2 = async function(s5, e = [], r) {
      return await this._runExclusiveQuery(async () => {
        T(this, t, _3).call(this, "runQuery", s5, e, r), await this._handleBlob(r?.blob);
        let o5 = [];
        try {
          let c4 = await T(this, t, y3).call(this, We2.parse({ text: s5, types: r?.paramTypes }), r), u3 = yn(await T(this, t, y3).call(this, We2.describe({ type: "S" }), r)), n3 = e.map((b4, k3) => {
            let D5 = u3[k3];
            if (b4 == null) return null;
            let v5 = r?.serializers?.[D5] ?? this.serializers[D5];
            return v5 ? v5(b4) : b4.toString();
          });
          o5 = [...c4, ...await T(this, t, y3).call(this, We2.bind({ values: n3 }), r), ...await T(this, t, y3).call(this, We2.describe({ type: "P" }), r), ...await T(this, t, y3).call(this, We2.execute({}), r)];
        } catch (c4) {
          throw c4 instanceof E ? E2({ e: c4, options: r, params: e, query: s5 }) : c4;
        } finally {
          o5.push(...await T(this, t, y3).call(this, We2.sync(), r));
        }
        await this._cleanupBlob(), h(this, p3) || await this.syncToFs();
        let i3 = await this._getWrittenBlob();
        return fn(o5, this.parsers, r, i3)[0];
      });
    }, m2 = async function(s5, e) {
      return await this._runExclusiveQuery(async () => {
        T(this, t, _3).call(this, "runExec", s5, e), await this._handleBlob(e?.blob);
        let r = [];
        try {
          r = await T(this, t, y3).call(this, We2.query(s5), e);
        } catch (i3) {
          throw i3 instanceof E ? E2({ e: i3, options: e, params: void 0, query: s5 }) : i3;
        } finally {
          r.push(...await T(this, t, y3).call(this, We2.sync(), e));
        }
        this._cleanupBlob(), h(this, p3) || await this.syncToFs();
        let o5 = await this._getWrittenBlob();
        return fn(r, this.parsers, e, o5);
      });
    }, _3 = function(...s5) {
      this.debug > 0 && console.log(...s5);
    };
  }
});

// node_modules/@electric-sql/pglite/dist/fs/nodefs.js
var nodefs_exports = {};
__export(nodefs_exports, {
  NodeFS: () => m3
});
import * as s4 from "fs";
import * as o4 from "path";
var m3;
var init_nodefs = __esm({
  "node_modules/@electric-sql/pglite/dist/fs/nodefs.js"() {
    init_chunk_TDKVRJ2S();
    init_chunk_VVBUWNGP();
    init_chunk_QY3QWFKW();
    u();
    m3 = class extends We {
      constructor(t3) {
        super(t3), this.rootDir = o4.resolve(t3), s4.existsSync(o4.join(this.rootDir)) || s4.mkdirSync(this.rootDir);
      }
      async init(t3, e) {
        return this.pg = t3, { emscriptenOpts: { ...e, preRun: [...e.preRun || [], (r) => {
          let c4 = r.FS.filesystems.NODEFS;
          r.FS.mkdir(B), r.FS.mount(c4, { root: this.rootDir }, B);
        }] } };
      }
      async closeFs() {
        this.pg.Module.FS.quit();
      }
    };
  }
});

// node_modules/@electric-sql/pglite/dist/fs/opfs-ahp.js
var opfs_ahp_exports = {};
__export(opfs_ahp_exports, {
  OpfsAhpFS: () => L3
});
var $2, G3, T3, H2, v4, F3, M2, y4, b3, m4, x3, P4, D4, S3, n2, C2, O2, k2, w3, f4, I2, W3, j2, L3, p4;
var init_opfs_ahp = __esm({
  "node_modules/@electric-sql/pglite/dist/fs/opfs-ahp.js"() {
    init_chunk_TDKVRJ2S();
    init_chunk_VVBUWNGP();
    init_chunk_QY3QWFKW();
    u();
    $2 = "state.txt";
    G3 = "data";
    T3 = { DIR: 16384, FILE: 32768 };
    L3 = class extends Ge {
      constructor(e, { initialPoolSize: t3 = 1e3, maintainedPoolSize: o5 = 100, debug: i3 = false } = {}) {
        super(e, { debug: i3 });
        R(this, n2);
        R(this, H2);
        R(this, v4);
        R(this, F3);
        R(this, M2);
        R(this, y4);
        R(this, b3, /* @__PURE__ */ new Map());
        R(this, m4, /* @__PURE__ */ new Map());
        R(this, x3, 0);
        R(this, P4, /* @__PURE__ */ new Map());
        R(this, D4, /* @__PURE__ */ new Map());
        this.lastCheckpoint = 0;
        this.checkpointInterval = 1e3 * 60;
        this.poolCounter = 0;
        R(this, S3, /* @__PURE__ */ new Set());
        this.initialPoolSize = t3, this.maintainedPoolSize = o5;
      }
      async init(e, t3) {
        return await T(this, n2, C2).call(this), super.init(e, t3);
      }
      async syncToFs(e = false) {
        await this.maybeCheckpointState(), await this.maintainPool(), e || this.flush();
      }
      async closeFs() {
        for (let e of h(this, m4).values()) e.close();
        h(this, y4).flush(), h(this, y4).close(), this.pg.Module.FS.quit();
      }
      async maintainPool(e) {
        e = e || this.maintainedPoolSize;
        let t3 = e - this.state.pool.length, o5 = [];
        for (let i3 = 0; i3 < t3; i3++) o5.push(new Promise(async (c4) => {
          ++this.poolCounter;
          let a3 = `${(Date.now() - 1704063600).toString(16).padStart(8, "0")}-${this.poolCounter.toString(16).padStart(8, "0")}`, h3 = await h(this, F3).getFileHandle(a3, { create: true }), d3 = await h3.createSyncAccessHandle();
          h(this, b3).set(a3, h3), h(this, m4).set(a3, d3), T(this, n2, k2).call(this, { opp: "createPoolFile", args: [a3] }), this.state.pool.push(a3), c4();
        }));
        for (let i3 = 0; i3 > t3; i3--) o5.push(new Promise(async (c4) => {
          let a3 = this.state.pool.pop();
          T(this, n2, k2).call(this, { opp: "deletePoolFile", args: [a3] });
          let h3 = h(this, b3).get(a3);
          h(this, m4).get(a3)?.close(), await h(this, F3).removeEntry(h3.name), h(this, b3).delete(a3), h(this, m4).delete(a3), c4();
        }));
        await Promise.all(o5);
      }
      _createPoolFileState(e) {
        this.state.pool.push(e);
      }
      _deletePoolFileState(e) {
        let t3 = this.state.pool.indexOf(e);
        t3 > -1 && this.state.pool.splice(t3, 1);
      }
      async maybeCheckpointState() {
        Date.now() - this.lastCheckpoint > this.checkpointInterval && await this.checkpointState();
      }
      async checkpointState() {
        let e = new TextEncoder().encode(JSON.stringify(this.state));
        h(this, y4).truncate(0), h(this, y4).write(e, { at: 0 }), h(this, y4).flush(), this.lastCheckpoint = Date.now();
      }
      flush() {
        for (let e of h(this, S3)) try {
          e.flush();
        } catch {
        }
        h(this, S3).clear();
      }
      chmod(e, t3) {
        T(this, n2, O2).call(this, { opp: "chmod", args: [e, t3] }, () => {
          this._chmodState(e, t3);
        });
      }
      _chmodState(e, t3) {
        let o5 = T(this, n2, f4).call(this, e);
        o5.mode = t3;
      }
      close(e) {
        let t3 = T(this, n2, I2).call(this, e);
        h(this, P4).delete(e), h(this, D4).delete(t3);
      }
      fstat(e) {
        let t3 = T(this, n2, I2).call(this, e);
        return this.lstat(t3);
      }
      lstat(e) {
        let t3 = T(this, n2, f4).call(this, e), o5 = t3.type === "file" ? h(this, m4).get(t3.backingFilename).getSize() : 0, i3 = 4096;
        return { dev: 0, ino: 0, mode: t3.mode, nlink: 1, uid: 0, gid: 0, rdev: 0, size: o5, blksize: i3, blocks: Math.ceil(o5 / i3), atime: t3.lastModified, mtime: t3.lastModified, ctime: t3.lastModified };
      }
      mkdir(e, t3) {
        T(this, n2, O2).call(this, { opp: "mkdir", args: [e, t3] }, () => {
          this._mkdirState(e, t3);
        });
      }
      _mkdirState(e, t3) {
        let o5 = T(this, n2, w3).call(this, e), i3 = o5.pop(), c4 = [], a3 = this.state.root;
        for (let d3 of o5) {
          if (c4.push(e), !Object.prototype.hasOwnProperty.call(a3.children, d3)) if (t3?.recursive) this.mkdir(c4.join("/"));
          else throw new p4("ENOENT", "No such file or directory");
          if (a3.children[d3].type !== "directory") throw new p4("ENOTDIR", "Not a directory");
          a3 = a3.children[d3];
        }
        if (Object.prototype.hasOwnProperty.call(a3.children, i3)) throw new p4("EEXIST", "File exists");
        let h3 = { type: "directory", lastModified: Date.now(), mode: t3?.mode || T3.DIR, children: {} };
        a3.children[i3] = h3;
      }
      open(e, t3, o5) {
        if (T(this, n2, f4).call(this, e).type !== "file") throw new p4("EISDIR", "Is a directory");
        let c4 = T(this, n2, W3).call(this);
        return h(this, P4).set(c4, e), h(this, D4).set(e, c4), c4;
      }
      readdir(e) {
        let t3 = T(this, n2, f4).call(this, e);
        if (t3.type !== "directory") throw new p4("ENOTDIR", "Not a directory");
        return Object.keys(t3.children);
      }
      read(e, t3, o5, i3, c4) {
        let a3 = T(this, n2, I2).call(this, e), h3 = T(this, n2, f4).call(this, a3);
        if (h3.type !== "file") throw new p4("EISDIR", "Is a directory");
        return h(this, m4).get(h3.backingFilename).read(new Uint8Array(t3.buffer, o5, i3), { at: c4 });
      }
      rename(e, t3) {
        T(this, n2, O2).call(this, { opp: "rename", args: [e, t3] }, () => {
          this._renameState(e, t3, true);
        });
      }
      _renameState(e, t3, o5 = false) {
        let i3 = T(this, n2, w3).call(this, e), c4 = i3.pop(), a3 = T(this, n2, f4).call(this, i3.join("/"));
        if (!Object.prototype.hasOwnProperty.call(a3.children, c4)) throw new p4("ENOENT", "No such file or directory");
        let h3 = T(this, n2, w3).call(this, t3), d3 = h3.pop(), l2 = T(this, n2, f4).call(this, h3.join("/"));
        if (o5 && Object.prototype.hasOwnProperty.call(l2.children, d3)) {
          let u3 = l2.children[d3];
          h(this, m4).get(u3.backingFilename).truncate(0), this.state.pool.push(u3.backingFilename);
        }
        l2.children[d3] = a3.children[c4], delete a3.children[c4];
      }
      rmdir(e) {
        T(this, n2, O2).call(this, { opp: "rmdir", args: [e] }, () => {
          this._rmdirState(e);
        });
      }
      _rmdirState(e) {
        let t3 = T(this, n2, w3).call(this, e), o5 = t3.pop(), i3 = T(this, n2, f4).call(this, t3.join("/"));
        if (!Object.prototype.hasOwnProperty.call(i3.children, o5)) throw new p4("ENOENT", "No such file or directory");
        let c4 = i3.children[o5];
        if (c4.type !== "directory") throw new p4("ENOTDIR", "Not a directory");
        if (Object.keys(c4.children).length > 0) throw new p4("ENOTEMPTY", "Directory not empty");
        delete i3.children[o5];
      }
      truncate(e, t3 = 0) {
        let o5 = T(this, n2, f4).call(this, e);
        if (o5.type !== "file") throw new p4("EISDIR", "Is a directory");
        let i3 = h(this, m4).get(o5.backingFilename);
        if (!i3) throw new p4("ENOENT", "No such file or directory");
        i3.truncate(t3), h(this, S3).add(i3);
      }
      unlink(e) {
        T(this, n2, O2).call(this, { opp: "unlink", args: [e] }, () => {
          this._unlinkState(e, true);
        });
      }
      _unlinkState(e, t3 = false) {
        let o5 = T(this, n2, w3).call(this, e), i3 = o5.pop(), c4 = T(this, n2, f4).call(this, o5.join("/"));
        if (!Object.prototype.hasOwnProperty.call(c4.children, i3)) throw new p4("ENOENT", "No such file or directory");
        let a3 = c4.children[i3];
        if (a3.type !== "file") throw new p4("EISDIR", "Is a directory");
        if (delete c4.children[i3], t3) {
          let h3 = h(this, m4).get(a3.backingFilename);
          h3?.truncate(0), h(this, S3).add(h3), h(this, D4).has(e) && (h(this, P4).delete(h(this, D4).get(e)), h(this, D4).delete(e));
        }
        this.state.pool.push(a3.backingFilename);
      }
      utimes(e, t3, o5) {
        T(this, n2, O2).call(this, { opp: "utimes", args: [e, t3, o5] }, () => {
          this._utimesState(e, t3, o5);
        });
      }
      _utimesState(e, t3, o5) {
        let i3 = T(this, n2, f4).call(this, e);
        i3.lastModified = o5;
      }
      writeFile(e, t3, o5) {
        let i3 = T(this, n2, w3).call(this, e), c4 = i3.pop(), a3 = T(this, n2, f4).call(this, i3.join("/"));
        if (Object.prototype.hasOwnProperty.call(a3.children, c4)) {
          let l2 = a3.children[c4];
          l2.lastModified = Date.now(), T(this, n2, k2).call(this, { opp: "setLastModified", args: [e, l2.lastModified] });
        } else {
          if (this.state.pool.length === 0) throw new Error("No more file handles available in the pool");
          let l2 = { type: "file", lastModified: Date.now(), mode: o5?.mode || T3.FILE, backingFilename: this.state.pool.pop() };
          a3.children[c4] = l2, T(this, n2, k2).call(this, { opp: "createFileNode", args: [e, l2] });
        }
        let h3 = a3.children[c4], d3 = h(this, m4).get(h3.backingFilename);
        t3.length > 0 && (d3.write(typeof t3 == "string" ? new TextEncoder().encode(t3) : new Uint8Array(t3), { at: 0 }), e.startsWith("/pg_wal") && h(this, S3).add(d3));
      }
      _createFileNodeState(e, t3) {
        let o5 = T(this, n2, w3).call(this, e), i3 = o5.pop(), c4 = T(this, n2, f4).call(this, o5.join("/"));
        c4.children[i3] = t3;
        let a3 = this.state.pool.indexOf(t3.backingFilename);
        return a3 > -1 && this.state.pool.splice(a3, 1), t3;
      }
      _setLastModifiedState(e, t3) {
        let o5 = T(this, n2, f4).call(this, e);
        o5.lastModified = t3;
      }
      write(e, t3, o5, i3, c4) {
        let a3 = T(this, n2, I2).call(this, e), h3 = T(this, n2, f4).call(this, a3);
        if (h3.type !== "file") throw new p4("EISDIR", "Is a directory");
        let d3 = h(this, m4).get(h3.backingFilename);
        if (!d3) throw new p4("EBADF", "Bad file descriptor");
        let l2 = d3.write(new Uint8Array(t3, o5, i3), { at: c4 });
        return a3.startsWith("/pg_wal") && h(this, S3).add(d3), l2;
      }
    };
    H2 = /* @__PURE__ */ new WeakMap(), v4 = /* @__PURE__ */ new WeakMap(), F3 = /* @__PURE__ */ new WeakMap(), M2 = /* @__PURE__ */ new WeakMap(), y4 = /* @__PURE__ */ new WeakMap(), b3 = /* @__PURE__ */ new WeakMap(), m4 = /* @__PURE__ */ new WeakMap(), x3 = /* @__PURE__ */ new WeakMap(), P4 = /* @__PURE__ */ new WeakMap(), D4 = /* @__PURE__ */ new WeakMap(), S3 = /* @__PURE__ */ new WeakMap(), n2 = /* @__PURE__ */ new WeakSet(), C2 = async function() {
      x(this, H2, await navigator.storage.getDirectory()), x(this, v4, await T(this, n2, j2).call(this, this.dataDir, { create: true })), x(this, F3, await T(this, n2, j2).call(this, G3, { from: h(this, v4), create: true })), x(this, M2, await h(this, v4).getFileHandle($2, { create: true })), x(this, y4, await h(this, M2).createSyncAccessHandle());
      let e = new ArrayBuffer(h(this, y4).getSize());
      h(this, y4).read(e, { at: 0 });
      let t3, o5 = new TextDecoder().decode(e).split(`
`), i3 = false;
      try {
        t3 = JSON.parse(o5[0]);
      } catch {
        t3 = { root: { type: "directory", lastModified: Date.now(), mode: T3.DIR, children: {} }, pool: [] }, h(this, y4).truncate(0), h(this, y4).write(new TextEncoder().encode(JSON.stringify(t3)), { at: 0 }), i3 = true;
      }
      this.state = t3;
      let c4 = o5.slice(1).filter(Boolean).map((l2) => JSON.parse(l2));
      for (let l2 of c4) {
        let u3 = `_${l2.opp}State`;
        if (typeof this[u3] == "function") try {
          this[u3].bind(this)(...l2.args);
        } catch (N2) {
          console.warn("Error applying OPFS AHP WAL entry", l2, N2);
        }
      }
      let a3 = [], h3 = async (l2) => {
        if (l2.type === "file") try {
          let u3 = await h(this, F3).getFileHandle(l2.backingFilename), N2 = await u3.createSyncAccessHandle();
          h(this, b3).set(l2.backingFilename, u3), h(this, m4).set(l2.backingFilename, N2);
        } catch (u3) {
          console.error("Error opening file handle for node", l2, u3);
        }
        else for (let u3 of Object.values(l2.children)) a3.push(h3(u3));
      };
      await h3(this.state.root);
      let d3 = [];
      for (let l2 of this.state.pool) d3.push(new Promise(async (u3) => {
        h(this, b3).has(l2) && console.warn("File handle already exists for pool file", l2);
        let N2 = await h(this, F3).getFileHandle(l2), U3 = await N2.createSyncAccessHandle();
        h(this, b3).set(l2, N2), h(this, m4).set(l2, U3), u3();
      }));
      await Promise.all([...a3, ...d3]), await this.maintainPool(i3 ? this.initialPoolSize : this.maintainedPoolSize);
    }, O2 = function(e, t3) {
      let o5 = T(this, n2, k2).call(this, e);
      try {
        t3();
      } catch (i3) {
        throw h(this, y4).truncate(o5), i3;
      }
    }, k2 = function(e) {
      let t3 = JSON.stringify(e), o5 = new TextEncoder().encode(`
${t3}`), i3 = h(this, y4).getSize();
      return h(this, y4).write(o5, { at: i3 }), h(this, S3).add(h(this, y4)), i3;
    }, w3 = function(e) {
      return e.split("/").filter(Boolean);
    }, f4 = function(e, t3) {
      let o5 = T(this, n2, w3).call(this, e), i3 = t3 || this.state.root;
      for (let c4 of o5) {
        if (i3.type !== "directory") throw new p4("ENOTDIR", "Not a directory");
        if (!Object.prototype.hasOwnProperty.call(i3.children, c4)) throw new p4("ENOENT", "No such file or directory");
        i3 = i3.children[c4];
      }
      return i3;
    }, I2 = function(e) {
      let t3 = h(this, P4).get(e);
      if (!t3) throw new p4("EBADF", "Bad file descriptor");
      return t3;
    }, W3 = function() {
      let e = ++U(this, x3)._;
      for (; h(this, P4).has(e); ) U(this, x3)._++;
      return e;
    }, j2 = async function(e, t3) {
      let o5 = T(this, n2, w3).call(this, e), i3 = t3?.from || h(this, H2);
      for (let c4 of o5) i3 = await i3.getDirectoryHandle(c4, { create: t3?.create });
      return i3;
    };
    p4 = class extends Error {
      constructor(A3, e) {
        super(e), typeof A3 == "number" ? this.code = A3 : typeof A3 == "string" && (this.code = Ve[A3]);
      }
    };
  }
});

// node_modules/@electric-sql/pglite/dist/index.js
var dist_exports = {};
__export(dist_exports, {
  IdbFs: () => ve2,
  MemoryFS: () => Ee2,
  Mutex: () => J2,
  PGlite: () => Ve3,
  formatQuery: () => v3,
  messages: () => Ce2,
  parse: () => hn,
  protocol: () => vn,
  types: () => dn
});
async function Re3(e) {
  if (p2.IN_NODE) {
    let t3 = await import("fs"), r = await import("zlib"), { Writable: a3 } = await import("stream"), { pipeline: o5 } = await import("stream/promises");
    if (!t3.existsSync(e)) throw new Error(`Extension bundle not found: ${e}`);
    let _4 = r.createGunzip(), s5 = [];
    return await o5(t3.createReadStream(e), _4, new a3({ write(n3, l2, d3) {
      s5.push(n3), d3();
    } })), new Blob(s5);
  } else {
    let t3 = await fetch(e.toString());
    if (!t3.ok || !t3.body) return null;
    if (t3.headers.get("Content-Encoding") === "gzip") return t3.blob();
    {
      let r = new DecompressionStream("gzip");
      return new Response(t3.body.pipeThrough(r)).blob();
    }
  }
}
async function Ue3(e, t3) {
  let r = new Array();
  for (let a3 in e.pg_extensions) {
    let o5;
    try {
      o5 = await e.pg_extensions[a3];
    } catch (_4) {
      console.error("Failed to fetch extension:", a3, _4);
      continue;
    }
    if (o5) {
      let _4 = new Uint8Array(await o5.arrayBuffer());
      r.push(...Et2(e, a3, _4, t3));
    } else console.error("Could not get binary data for extension:", a3);
  }
  return Promise.all(r);
}
function Et2(e, t3, r, a3) {
  let o5 = [];
  return Ge3.default.untar(r).sort((s5, n3) => s5.name > n3.name ? 1 : s5.name < n3.name ? -1 : 0).forEach((s5) => {
    if (s5.name.endsWith("/")) {
      let n3 = `${e.WASM_PREFIX}/${s5.name}`;
      e.FS.analyzePath(n3).exists === false && e.FS.mkdirTree(n3);
    } else if (!s5.name.startsWith(".")) {
      let n3 = e.WASM_PREFIX + "/" + s5.name;
      if (s5.name.endsWith(".so")) {
        a3(`pgfs:ext preloading ${n3}`);
        let l2 = s5.name.split("/").pop(), d3 = Mt2(n3), u3 = new Promise((c4, f5) => {
          let g4 = (...p6) => {
            a3("pgfs:ext OK", n3, p6), c4();
          }, m5 = (...p6) => {
            a3("pgfs:ext FAIL", n3, p6), fe2(e.FS, n3, s5.data), c4();
          };
          e.FS.createPreloadedFile(d3, l2, s5.data, true, true, g4, m5, false);
        });
        o5.push(u3);
      } else fe2(e.FS, n3, s5.data);
    }
  }), o5;
}
function fe2(e, t3, r, a3) {
  try {
    let o5 = t3.substring(0, t3.lastIndexOf("/"));
    e.analyzePath(o5).exists === false && e.mkdirTree(o5), e.writeFile(t3, r), a3 && e.chmod(t3, a3);
  } catch (o5) {
    throw console.error(`Error writing file ${t3}`, o5), o5;
  }
}
function Mt2(e) {
  let t3 = e.lastIndexOf("/");
  return t3 > 0 ? e.slice(0, t3) : e;
}
function Ze2(e) {
  let t3;
  if (e?.startsWith("file://")) {
    if (e = e.slice(7), !e) throw new Error("Invalid dataDir, must be a valid path");
    t3 = "nodefs";
  } else e?.startsWith("idb://") ? (e = e.slice(6), t3 = "idbfs") : e?.startsWith("opfs-ahp://") ? (e = e.slice(11), t3 = "opfs-ahp") : !e || e?.startsWith("memory://") ? t3 = "memoryfs" : t3 = "nodefs";
  return { dataDir: e, fsType: t3 };
}
async function je3(e, t3) {
  let r;
  if (e && t3 === "nodefs") {
    let { NodeFS: a3 } = await Promise.resolve().then(() => (init_nodefs(), nodefs_exports));
    r = new a3(e);
  } else if (e && t3 === "idbfs") r = new ve2(e);
  else if (e && t3 === "opfs-ahp") {
    let { OpfsAhpFS: a3 } = await Promise.resolve().then(() => (init_opfs_ahp(), opfs_ahp_exports));
    r = new a3(e);
  } else r = new Ee2();
  return r;
}
var xt2, wt3, gt2, ft2, Ie3, vt2, J2, Ge3, ve2, Ee2, ht2, He3, We3, ae2, W4, oe2, _e2, se2, ie3, ke3, Te2, Pe2, Ce3, de3, ue3, Me3, pe2, ne, ee2, z3, le2, ce3, A2, me2, $3, V2, L4, B3, he2, xe3, we2, ge2, S4, Xe2, Ke2, Ye3, Qe2, $e2, Je2, et2, qe2, tt2, U2, rt2, at3, ot2, _t2, st2, O3, Ve3;
var init_dist = __esm({
  "node_modules/@electric-sql/pglite/dist/index.js"() {
    init_chunk_TDKVRJ2S();
    init_chunk_QY575LMP();
    init_chunk_SRXPYZFS();
    init_chunk_2B24BK54();
    init_chunk_VVBUWNGP();
    init_chunk_F4GETNPB();
    init_chunk_QY3QWFKW();
    u();
    u();
    u();
    xt2 = new Error("timeout while waiting for mutex to become available");
    wt3 = new Error("mutex already locked");
    gt2 = new Error("request for lock canceled");
    ft2 = function(e, t3, r, a3) {
      function o5(_4) {
        return _4 instanceof r ? _4 : new r(function(s5) {
          s5(_4);
        });
      }
      return new (r || (r = Promise))(function(_4, s5) {
        function n3(u3) {
          try {
            d3(a3.next(u3));
          } catch (c4) {
            s5(c4);
          }
        }
        function l2(u3) {
          try {
            d3(a3.throw(u3));
          } catch (c4) {
            s5(c4);
          }
        }
        function d3(u3) {
          u3.done ? _4(u3.value) : o5(u3.value).then(n3, l2);
        }
        d3((a3 = a3.apply(e, t3 || [])).next());
      });
    };
    Ie3 = class {
      constructor(t3, r = gt2) {
        this._value = t3, this._cancelError = r, this._weightedQueues = [], this._weightedWaiters = [];
      }
      acquire(t3 = 1) {
        if (t3 <= 0) throw new Error(`invalid weight ${t3}: must be positive`);
        return new Promise((r, a3) => {
          this._weightedQueues[t3 - 1] || (this._weightedQueues[t3 - 1] = []), this._weightedQueues[t3 - 1].push({ resolve: r, reject: a3 }), this._dispatch();
        });
      }
      runExclusive(t3, r = 1) {
        return ft2(this, void 0, void 0, function* () {
          let [a3, o5] = yield this.acquire(r);
          try {
            return yield t3(a3);
          } finally {
            o5();
          }
        });
      }
      waitForUnlock(t3 = 1) {
        if (t3 <= 0) throw new Error(`invalid weight ${t3}: must be positive`);
        return new Promise((r) => {
          this._weightedWaiters[t3 - 1] || (this._weightedWaiters[t3 - 1] = []), this._weightedWaiters[t3 - 1].push(r), this._dispatch();
        });
      }
      isLocked() {
        return this._value <= 0;
      }
      getValue() {
        return this._value;
      }
      setValue(t3) {
        this._value = t3, this._dispatch();
      }
      release(t3 = 1) {
        if (t3 <= 0) throw new Error(`invalid weight ${t3}: must be positive`);
        this._value += t3, this._dispatch();
      }
      cancel() {
        this._weightedQueues.forEach((t3) => t3.forEach((r) => r.reject(this._cancelError))), this._weightedQueues = [];
      }
      _dispatch() {
        var t3;
        for (let r = this._value; r > 0; r--) {
          let a3 = (t3 = this._weightedQueues[r - 1]) === null || t3 === void 0 ? void 0 : t3.shift();
          if (!a3) continue;
          let o5 = this._value, _4 = r;
          this._value -= r, r = this._value + 1, a3.resolve([o5, this._newReleaser(_4)]);
        }
        this._drainUnlockWaiters();
      }
      _newReleaser(t3) {
        let r = false;
        return () => {
          r || (r = true, this.release(t3));
        };
      }
      _drainUnlockWaiters() {
        for (let t3 = this._value; t3 > 0; t3--) this._weightedWaiters[t3 - 1] && (this._weightedWaiters[t3 - 1].forEach((r) => r()), this._weightedWaiters[t3 - 1] = []);
      }
    };
    vt2 = function(e, t3, r, a3) {
      function o5(_4) {
        return _4 instanceof r ? _4 : new r(function(s5) {
          s5(_4);
        });
      }
      return new (r || (r = Promise))(function(_4, s5) {
        function n3(u3) {
          try {
            d3(a3.next(u3));
          } catch (c4) {
            s5(c4);
          }
        }
        function l2(u3) {
          try {
            d3(a3.throw(u3));
          } catch (c4) {
            s5(c4);
          }
        }
        function d3(u3) {
          u3.done ? _4(u3.value) : o5(u3.value).then(n3, l2);
        }
        d3((a3 = a3.apply(e, t3 || [])).next());
      });
    };
    J2 = class {
      constructor(t3) {
        this._semaphore = new Ie3(1, t3);
      }
      acquire() {
        return vt2(this, void 0, void 0, function* () {
          let [, t3] = yield this._semaphore.acquire();
          return t3;
        });
      }
      runExclusive(t3) {
        return this._semaphore.runExclusive(() => t3());
      }
      isLocked() {
        return this._semaphore.isLocked();
      }
      waitForUnlock() {
        return this._semaphore.waitForUnlock();
      }
      release() {
        this._semaphore.isLocked() && this._semaphore.release();
      }
      cancel() {
        return this._semaphore.cancel();
      }
    };
    u();
    Ge3 = L(Re(), 1);
    u();
    u();
    ve2 = class extends We {
      async init(t3, r) {
        return this.pg = t3, { emscriptenOpts: { ...r, preRun: [...r.preRun || [], (o5) => {
          let _4 = o5.FS.filesystems.IDBFS;
          o5.FS.analyzePath(I).exists || o5.FS.mkdir(I), o5.FS.analyzePath(`${I}/${this.dataDir}`).exists || o5.FS.mkdir(`${I}/${this.dataDir}`), o5.FS.mount(_4, {}, `${I}/${this.dataDir}`), o5.FS.symlink(`${I}/${this.dataDir}`, B);
        }] } };
      }
      initialSyncFs() {
        return new Promise((t3, r) => {
          this.pg.Module.FS.syncfs(true, (a3) => {
            a3 ? r(a3) : t3();
          });
        });
      }
      syncToFs(t3) {
        return new Promise((r, a3) => {
          this.pg.Module.FS.syncfs(false, (o5) => {
            o5 ? a3(o5) : r();
          });
        });
      }
      async closeFs() {
        let t3 = this.pg.Module.FS.filesystems.IDBFS.dbs[this.dataDir];
        t3 && t3.close(), this.pg.Module.FS.quit();
      }
    };
    u();
    Ee2 = class extends We {
      async closeFs() {
        this.pg.Module.FS.quit();
      }
    };
    u();
    u();
    ht2 = (() => {
      var _scriptName = import.meta.url;
      return async function(moduleArg = {}) {
        var moduleRtn, Module = moduleArg, readyPromiseResolve, readyPromiseReject, readyPromise = new Promise((e, t3) => {
          readyPromiseResolve = e, readyPromiseReject = t3;
        }), ENVIRONMENT_IS_WEB = typeof window == "object", ENVIRONMENT_IS_WORKER = typeof WorkerGlobalScope < "u", ENVIRONMENT_IS_NODE = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string" && process.type != "renderer";
        if (ENVIRONMENT_IS_NODE) {
          let { createRequire: e } = await import("module"), t3 = import.meta.url;
          t3.startsWith("data:") && (t3 = "/");
          var require = e(t3);
        }
        Module.expectedDataFileDownloads ?? (Module.expectedDataFileDownloads = 0), Module.expectedDataFileDownloads++, (() => {
          var e = typeof ENVIRONMENT_IS_PTHREAD < "u" && ENVIRONMENT_IS_PTHREAD, t3 = typeof ENVIRONMENT_IS_WASM_WORKER < "u" && ENVIRONMENT_IS_WASM_WORKER;
          if (e || t3) return;
          var r = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string";
          function a3(o5) {
            var _4 = "";
            typeof window == "object" ? _4 = window.encodeURIComponent(window.location.pathname.substring(0, window.location.pathname.lastIndexOf("/")) + "/") : typeof process > "u" && typeof location < "u" && (_4 = encodeURIComponent(location.pathname.substring(0, location.pathname.lastIndexOf("/")) + "/"));
            var s5 = "pglite.data", n3 = "pglite.data", l2 = Module.locateFile ? Module.locateFile(n3, "") : n3, d3 = o5.remote_package_size;
            function u3(p6, h3, x4, b4) {
              if (r) {
                require("fs").readFile(p6, (M3, y5) => {
                  M3 ? b4(M3) : x4(y5.buffer);
                });
                return;
              }
              Module.dataFileDownloads ?? (Module.dataFileDownloads = {}), fetch(p6).catch((M3) => Promise.reject(new Error(`Network Error: ${p6}`, { cause: M3 }))).then((M3) => {
                if (!M3.ok) return Promise.reject(new Error(`${M3.status}: ${M3.url}`));
                if (!M3.body && M3.arrayBuffer) return M3.arrayBuffer().then(x4);
                let y5 = M3.body.getReader(), E3 = () => y5.read().then(te).catch((H3) => Promise.reject(new Error(`Unexpected error while handling : ${M3.url} ${H3}`, { cause: H3 }))), F4 = [], k3 = M3.headers, R3 = Number(k3.get("Content-Length") ?? h3), D5 = 0, te = ({ done: H3, value: X2 }) => {
                  if (H3) {
                    let I3 = new Uint8Array(F4.map((q2) => q2.length).reduce((q2, nt2) => q2 + nt2, 0)), G4 = 0;
                    for (let q2 of F4) I3.set(q2, G4), G4 += q2.length;
                    x4(I3.buffer);
                  } else {
                    F4.push(X2), D5 += X2.length, Module.dataFileDownloads[p6] = { loaded: D5, total: R3 };
                    let I3 = 0, G4 = 0;
                    for (let q2 of Object.values(Module.dataFileDownloads)) I3 += q2.loaded, G4 += q2.total;
                    return Module.setStatus?.(`Downloading data... (${I3}/${G4})`), E3();
                  }
                };
                return Module.setStatus?.("Downloading data..."), E3();
              });
            }
            function c4(p6) {
              console.error("package error:", p6);
            }
            var f5 = null, g4 = Module.getPreloadedPackage ? Module.getPreloadedPackage(l2, d3) : null;
            g4 || u3(l2, d3, (p6) => {
              f5 ? (f5(p6), f5 = null) : g4 = p6;
            }, c4);
            function m5(p6) {
              function h3(E3, F4) {
                if (!E3) throw F4 + new Error().stack;
              }
              p6.FS_createPath("/", "home", true, true), p6.FS_createPath("/home", "postgres", true, true), p6.FS_createPath("/", "pglite", true, true), p6.FS_createPath("/pglite", "bin", true, true), p6.FS_createPath("/pglite", "icu", true, true), p6.FS_createPath("/pglite/icu", "icudt76l", true, true), p6.FS_createPath("/pglite/icu/icudt76l", "coll", true, true), p6.FS_createPath("/pglite", "lib", true, true), p6.FS_createPath("/pglite/lib", "postgresql", true, true), p6.FS_createPath("/pglite/lib/postgresql", "pgxs", true, true), p6.FS_createPath("/pglite/lib/postgresql/pgxs", "config", true, true), p6.FS_createPath("/pglite/lib/postgresql/pgxs", "src", true, true), p6.FS_createPath("/pglite/lib/postgresql/pgxs/src", "makefiles", true, true), p6.FS_createPath("/pglite/lib/postgresql/pgxs/src", "test", true, true), p6.FS_createPath("/pglite/lib/postgresql/pgxs/src/test", "isolation", true, true), p6.FS_createPath("/pglite/lib/postgresql/pgxs/src/test", "regress", true, true), p6.FS_createPath("/pglite", "share", true, true), p6.FS_createPath("/pglite/share", "postgresql", true, true), p6.FS_createPath("/pglite/share/postgresql", "extension", true, true), p6.FS_createPath("/pglite/share/postgresql", "timezone", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Africa", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "America", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone/America", "Argentina", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone/America", "Indiana", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone/America", "Kentucky", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone/America", "North_Dakota", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Antarctica", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Arctic", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Asia", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Atlantic", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Australia", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Brazil", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Canada", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Chile", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Etc", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Europe", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Indian", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Mexico", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "Pacific", true, true), p6.FS_createPath("/pglite/share/postgresql/timezone", "US", true, true), p6.FS_createPath("/pglite/share/postgresql", "timezonesets", true, true), p6.FS_createPath("/pglite/share/postgresql", "tsearch_data", true, true);
              function x4(E3, F4, k3) {
                this.start = E3, this.end = F4, this.audio = k3;
              }
              x4.prototype = { requests: {}, open: function(E3, F4) {
                this.name = F4, this.requests[F4] = this, p6.addRunDependency(`fp ${this.name}`);
              }, send: function() {
              }, onload: function() {
                var E3 = this.byteArray.subarray(this.start, this.end);
                this.finish(E3);
              }, finish: function(E3) {
                var F4 = this;
                p6.FS_createDataFile(this.name, null, E3, true, true, true), p6.removeRunDependency(`fp ${F4.name}`), this.requests[this.name] = null;
              } };
              for (var b4 = o5.files, M3 = 0; M3 < b4.length; ++M3) new x4(b4[M3].start, b4[M3].end, b4[M3].audio || 0).open("GET", b4[M3].filename);
              function y5(E3) {
                h3(E3, "Loading data file failed."), h3(E3.constructor.name === ArrayBuffer.name, "bad input to processPackageData");
                var F4 = new Uint8Array(E3);
                x4.prototype.byteArray = F4;
                for (var k3 = o5.files, R3 = 0; R3 < k3.length; ++R3) x4.prototype.requests[k3[R3].filename].onload();
                p6.removeRunDependency("datafile_pglite.data");
              }
              p6.addRunDependency("datafile_pglite.data"), p6.preloadResults ?? (p6.preloadResults = {}), p6.preloadResults[s5] = { fromCache: false }, g4 ? (y5(g4), g4 = null) : f5 = y5;
            }
            Module.calledRun ? m5(Module) : (Module.preRun ?? (Module.preRun = [])).push(m5);
          }
          a3({ files: [{ filename: "/home/postgres/.pgpass", start: 0, end: 204 }, { filename: "/pglite/bin/initdb", start: 204, end: 223 }, { filename: "/pglite/bin/pg_dump", start: 223, end: 242 }, { filename: "/pglite/bin/postgres", start: 242, end: 261 }, { filename: "/pglite/icu/LICENSE", start: 261, end: 26748 }, { filename: "/pglite/icu/icudt76l/coll/root.res", start: 26748, end: 365756 }, { filename: "/pglite/icu/icudt76l/coll/ucadata.icu", start: 365756, end: 943260 }, { filename: "/pglite/lib/postgresql/cyrillic_and_mic.so", start: 943260, end: 947838 }, { filename: "/pglite/lib/postgresql/dict_snowball.so", start: 947838, end: 1529830 }, { filename: "/pglite/lib/postgresql/euc2004_sjis2004.so", start: 1529830, end: 1531986 }, { filename: "/pglite/lib/postgresql/euc_cn_and_mic.so", start: 1531986, end: 1533007 }, { filename: "/pglite/lib/postgresql/euc_jp_and_sjis.so", start: 1533007, end: 1540344 }, { filename: "/pglite/lib/postgresql/euc_kr_and_mic.so", start: 1540344, end: 1541375 }, { filename: "/pglite/lib/postgresql/euc_tw_and_big5.so", start: 1541375, end: 1546020 }, { filename: "/pglite/lib/postgresql/latin2_and_win1250.so", start: 1546020, end: 1547507 }, { filename: "/pglite/lib/postgresql/latin_and_mic.so", start: 1547507, end: 1548604 }, { filename: "/pglite/lib/postgresql/libpqwalreceiver.so", start: 1548604, end: 1686859 }, { filename: "/pglite/lib/postgresql/pgoutput.so", start: 1686859, end: 1700882 }, { filename: "/pglite/lib/postgresql/pgxs/config/install-sh", start: 1700882, end: 1714879 }, { filename: "/pglite/lib/postgresql/pgxs/config/missing", start: 1714879, end: 1716227 }, { filename: "/pglite/lib/postgresql/pgxs/src/Makefile.global", start: 1716227, end: 1754133 }, { filename: "/pglite/lib/postgresql/pgxs/src/Makefile.port", start: 1754133, end: 1754979 }, { filename: "/pglite/lib/postgresql/pgxs/src/Makefile.shlib", start: 1754979, end: 1769807 }, { filename: "/pglite/lib/postgresql/pgxs/src/makefiles/pgxs.mk", start: 1769807, end: 1785954 }, { filename: "/pglite/lib/postgresql/pgxs/src/nls-global.mk", start: 1785954, end: 1793018 }, { filename: "/pglite/lib/postgresql/pgxs/src/test/isolation/isolationtester.js", start: 1793018, end: 1908551 }, { filename: "/pglite/lib/postgresql/pgxs/src/test/isolation/pg_isolation_regress.js", start: 1908551, end: 2026521 }, { filename: "/pglite/lib/postgresql/pgxs/src/test/regress/pg_regress.js", start: 2026521, end: 2143977 }, { filename: "/pglite/lib/postgresql/plpgsql.so", start: 2143977, end: 2299447 }, { filename: "/pglite/lib/postgresql/utf8_and_big5.so", start: 2299447, end: 2414259 }, { filename: "/pglite/lib/postgresql/utf8_and_cyrillic.so", start: 2414259, end: 2420292 }, { filename: "/pglite/lib/postgresql/utf8_and_euc2004.so", start: 2420292, end: 2625288 }, { filename: "/pglite/lib/postgresql/utf8_and_euc_cn.so", start: 2625288, end: 2700532 }, { filename: "/pglite/lib/postgresql/utf8_and_euc_jp.so", start: 2700532, end: 2851824 }, { filename: "/pglite/lib/postgresql/utf8_and_euc_kr.so", start: 2851824, end: 2954744 }, { filename: "/pglite/lib/postgresql/utf8_and_euc_tw.so", start: 2954744, end: 3154364 }, { filename: "/pglite/lib/postgresql/utf8_and_gb18030.so", start: 3154364, end: 3416805 }, { filename: "/pglite/lib/postgresql/utf8_and_gbk.so", start: 3416805, end: 3563401 }, { filename: "/pglite/lib/postgresql/utf8_and_iso8859.so", start: 3563401, end: 3586992 }, { filename: "/pglite/lib/postgresql/utf8_and_iso8859_1.so", start: 3586992, end: 3588047 }, { filename: "/pglite/lib/postgresql/utf8_and_johab.so", start: 3588047, end: 3749815 }, { filename: "/pglite/lib/postgresql/utf8_and_sjis.so", start: 3749815, end: 3831539 }, { filename: "/pglite/lib/postgresql/utf8_and_sjis2004.so", start: 3831539, end: 3958235 }, { filename: "/pglite/lib/postgresql/utf8_and_uhc.so", start: 3958235, end: 4125571 }, { filename: "/pglite/lib/postgresql/utf8_and_win.so", start: 4125571, end: 4152089 }, { filename: "/pglite/locale-a", start: 4152089, end: 4152114 }, { filename: "/pglite/password", start: 4152114, end: 4152122 }, { filename: "/pglite/pgstdin", start: 4152122, end: 4152141 }, { filename: "/pglite/pgstdout", start: 4152141, end: 4152160 }, { filename: "/pglite/share/postgresql/errcodes.txt", start: 4152160, end: 4185899 }, { filename: "/pglite/share/postgresql/extension/plpgsql--1.0.sql", start: 4185899, end: 4186557 }, { filename: "/pglite/share/postgresql/extension/plpgsql.control", start: 4186557, end: 4186750 }, { filename: "/pglite/share/postgresql/information_schema.sql", start: 4186750, end: 4300747 }, { filename: "/pglite/share/postgresql/pg_hba.conf.sample", start: 4300747, end: 4306382 }, { filename: "/pglite/share/postgresql/pg_ident.conf.sample", start: 4306382, end: 4309063 }, { filename: "/pglite/share/postgresql/pg_service.conf.sample", start: 4309063, end: 4309667 }, { filename: "/pglite/share/postgresql/postgres.bki", start: 4309667, end: 5283436 }, { filename: "/pglite/share/postgresql/postgresql.conf.sample", start: 5283436, end: 5315988 }, { filename: "/pglite/share/postgresql/psqlrc.sample", start: 5315988, end: 5316266 }, { filename: "/pglite/share/postgresql/snowball_create.sql", start: 5316266, end: 5361976 }, { filename: "/pglite/share/postgresql/sql_features.txt", start: 5361976, end: 5397737 }, { filename: "/pglite/share/postgresql/system_constraints.sql", start: 5397737, end: 5406632 }, { filename: "/pglite/share/postgresql/system_functions.sql", start: 5406632, end: 5431511 }, { filename: "/pglite/share/postgresql/system_views.sql", start: 5431511, end: 5484875 }, { filename: "/pglite/share/postgresql/timezone/Africa/Abidjan", start: 5484875, end: 5485023 }, { filename: "/pglite/share/postgresql/timezone/Africa/Accra", start: 5485023, end: 5485171 }, { filename: "/pglite/share/postgresql/timezone/Africa/Addis_Ababa", start: 5485171, end: 5485436 }, { filename: "/pglite/share/postgresql/timezone/Africa/Algiers", start: 5485436, end: 5486171 }, { filename: "/pglite/share/postgresql/timezone/Africa/Asmara", start: 5486171, end: 5486436 }, { filename: "/pglite/share/postgresql/timezone/Africa/Asmera", start: 5486436, end: 5486701 }, { filename: "/pglite/share/postgresql/timezone/Africa/Bamako", start: 5486701, end: 5486849 }, { filename: "/pglite/share/postgresql/timezone/Africa/Bangui", start: 5486849, end: 5487084 }, { filename: "/pglite/share/postgresql/timezone/Africa/Banjul", start: 5487084, end: 5487232 }, { filename: "/pglite/share/postgresql/timezone/Africa/Bissau", start: 5487232, end: 5487426 }, { filename: "/pglite/share/postgresql/timezone/Africa/Blantyre", start: 5487426, end: 5487575 }, { filename: "/pglite/share/postgresql/timezone/Africa/Brazzaville", start: 5487575, end: 5487810 }, { filename: "/pglite/share/postgresql/timezone/Africa/Bujumbura", start: 5487810, end: 5487959 }, { filename: "/pglite/share/postgresql/timezone/Africa/Cairo", start: 5487959, end: 5490358 }, { filename: "/pglite/share/postgresql/timezone/Africa/Casablanca", start: 5490358, end: 5492787 }, { filename: "/pglite/share/postgresql/timezone/Africa/Ceuta", start: 5492787, end: 5494839 }, { filename: "/pglite/share/postgresql/timezone/Africa/Conakry", start: 5494839, end: 5494987 }, { filename: "/pglite/share/postgresql/timezone/Africa/Dakar", start: 5494987, end: 5495135 }, { filename: "/pglite/share/postgresql/timezone/Africa/Dar_es_Salaam", start: 5495135, end: 5495400 }, { filename: "/pglite/share/postgresql/timezone/Africa/Djibouti", start: 5495400, end: 5495665 }, { filename: "/pglite/share/postgresql/timezone/Africa/Douala", start: 5495665, end: 5495900 }, { filename: "/pglite/share/postgresql/timezone/Africa/El_Aaiun", start: 5495900, end: 5498195 }, { filename: "/pglite/share/postgresql/timezone/Africa/Freetown", start: 5498195, end: 5498343 }, { filename: "/pglite/share/postgresql/timezone/Africa/Gaborone", start: 5498343, end: 5498492 }, { filename: "/pglite/share/postgresql/timezone/Africa/Harare", start: 5498492, end: 5498641 }, { filename: "/pglite/share/postgresql/timezone/Africa/Johannesburg", start: 5498641, end: 5498887 }, { filename: "/pglite/share/postgresql/timezone/Africa/Juba", start: 5498887, end: 5499566 }, { filename: "/pglite/share/postgresql/timezone/Africa/Kampala", start: 5499566, end: 5499831 }, { filename: "/pglite/share/postgresql/timezone/Africa/Khartoum", start: 5499831, end: 5500510 }, { filename: "/pglite/share/postgresql/timezone/Africa/Kigali", start: 5500510, end: 5500659 }, { filename: "/pglite/share/postgresql/timezone/Africa/Kinshasa", start: 5500659, end: 5500894 }, { filename: "/pglite/share/postgresql/timezone/Africa/Lagos", start: 5500894, end: 5501129 }, { filename: "/pglite/share/postgresql/timezone/Africa/Libreville", start: 5501129, end: 5501364 }, { filename: "/pglite/share/postgresql/timezone/Africa/Lome", start: 5501364, end: 5501512 }, { filename: "/pglite/share/postgresql/timezone/Africa/Luanda", start: 5501512, end: 5501747 }, { filename: "/pglite/share/postgresql/timezone/Africa/Lubumbashi", start: 5501747, end: 5501896 }, { filename: "/pglite/share/postgresql/timezone/Africa/Lusaka", start: 5501896, end: 5502045 }, { filename: "/pglite/share/postgresql/timezone/Africa/Malabo", start: 5502045, end: 5502280 }, { filename: "/pglite/share/postgresql/timezone/Africa/Maputo", start: 5502280, end: 5502429 }, { filename: "/pglite/share/postgresql/timezone/Africa/Maseru", start: 5502429, end: 5502675 }, { filename: "/pglite/share/postgresql/timezone/Africa/Mbabane", start: 5502675, end: 5502921 }, { filename: "/pglite/share/postgresql/timezone/Africa/Mogadishu", start: 5502921, end: 5503186 }, { filename: "/pglite/share/postgresql/timezone/Africa/Monrovia", start: 5503186, end: 5503394 }, { filename: "/pglite/share/postgresql/timezone/Africa/Nairobi", start: 5503394, end: 5503659 }, { filename: "/pglite/share/postgresql/timezone/Africa/Ndjamena", start: 5503659, end: 5503858 }, { filename: "/pglite/share/postgresql/timezone/Africa/Niamey", start: 5503858, end: 5504093 }, { filename: "/pglite/share/postgresql/timezone/Africa/Nouakchott", start: 5504093, end: 5504241 }, { filename: "/pglite/share/postgresql/timezone/Africa/Ouagadougou", start: 5504241, end: 5504389 }, { filename: "/pglite/share/postgresql/timezone/Africa/Porto-Novo", start: 5504389, end: 5504624 }, { filename: "/pglite/share/postgresql/timezone/Africa/Sao_Tome", start: 5504624, end: 5504878 }, { filename: "/pglite/share/postgresql/timezone/Africa/Timbuktu", start: 5504878, end: 5505026 }, { filename: "/pglite/share/postgresql/timezone/Africa/Tripoli", start: 5505026, end: 5505651 }, { filename: "/pglite/share/postgresql/timezone/Africa/Tunis", start: 5505651, end: 5506340 }, { filename: "/pglite/share/postgresql/timezone/Africa/Windhoek", start: 5506340, end: 5507295 }, { filename: "/pglite/share/postgresql/timezone/America/Adak", start: 5507295, end: 5509651 }, { filename: "/pglite/share/postgresql/timezone/America/Anchorage", start: 5509651, end: 5512022 }, { filename: "/pglite/share/postgresql/timezone/America/Anguilla", start: 5512022, end: 5512268 }, { filename: "/pglite/share/postgresql/timezone/America/Antigua", start: 5512268, end: 5512514 }, { filename: "/pglite/share/postgresql/timezone/America/Araguaina", start: 5512514, end: 5513398 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/Buenos_Aires", start: 5513398, end: 5514474 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/Catamarca", start: 5514474, end: 5515550 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/ComodRivadavia", start: 5515550, end: 5516626 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/Cordoba", start: 5516626, end: 5517702 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/Jujuy", start: 5517702, end: 5518750 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/La_Rioja", start: 5518750, end: 5519840 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/Mendoza", start: 5519840, end: 5520916 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/Rio_Gallegos", start: 5520916, end: 5521992 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/Salta", start: 5521992, end: 5523040 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/San_Juan", start: 5523040, end: 5524130 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/San_Luis", start: 5524130, end: 5525232 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/Tucuman", start: 5525232, end: 5526336 }, { filename: "/pglite/share/postgresql/timezone/America/Argentina/Ushuaia", start: 5526336, end: 5527412 }, { filename: "/pglite/share/postgresql/timezone/America/Aruba", start: 5527412, end: 5527658 }, { filename: "/pglite/share/postgresql/timezone/America/Asuncion", start: 5527658, end: 5529316 }, { filename: "/pglite/share/postgresql/timezone/America/Atikokan", start: 5529316, end: 5529498 }, { filename: "/pglite/share/postgresql/timezone/America/Atka", start: 5529498, end: 5531854 }, { filename: "/pglite/share/postgresql/timezone/America/Bahia", start: 5531854, end: 5532878 }, { filename: "/pglite/share/postgresql/timezone/America/Bahia_Banderas", start: 5532878, end: 5533978 }, { filename: "/pglite/share/postgresql/timezone/America/Barbados", start: 5533978, end: 5534414 }, { filename: "/pglite/share/postgresql/timezone/America/Belem", start: 5534414, end: 5534990 }, { filename: "/pglite/share/postgresql/timezone/America/Belize", start: 5534990, end: 5536604 }, { filename: "/pglite/share/postgresql/timezone/America/Blanc-Sablon", start: 5536604, end: 5536850 }, { filename: "/pglite/share/postgresql/timezone/America/Boa_Vista", start: 5536850, end: 5537482 }, { filename: "/pglite/share/postgresql/timezone/America/Bogota", start: 5537482, end: 5537728 }, { filename: "/pglite/share/postgresql/timezone/America/Boise", start: 5537728, end: 5540138 }, { filename: "/pglite/share/postgresql/timezone/America/Buenos_Aires", start: 5540138, end: 5541214 }, { filename: "/pglite/share/postgresql/timezone/America/Cambridge_Bay", start: 5541214, end: 5543468 }, { filename: "/pglite/share/postgresql/timezone/America/Campo_Grande", start: 5543468, end: 5544912 }, { filename: "/pglite/share/postgresql/timezone/America/Cancun", start: 5544912, end: 5545776 }, { filename: "/pglite/share/postgresql/timezone/America/Caracas", start: 5545776, end: 5546040 }, { filename: "/pglite/share/postgresql/timezone/America/Catamarca", start: 5546040, end: 5547116 }, { filename: "/pglite/share/postgresql/timezone/America/Cayenne", start: 5547116, end: 5547314 }, { filename: "/pglite/share/postgresql/timezone/America/Cayman", start: 5547314, end: 5547496 }, { filename: "/pglite/share/postgresql/timezone/America/Chicago", start: 5547496, end: 5551088 }, { filename: "/pglite/share/postgresql/timezone/America/Chihuahua", start: 5551088, end: 5552190 }, { filename: "/pglite/share/postgresql/timezone/America/Ciudad_Juarez", start: 5552190, end: 5553728 }, { filename: "/pglite/share/postgresql/timezone/America/Coral_Harbour", start: 5553728, end: 5553910 }, { filename: "/pglite/share/postgresql/timezone/America/Cordoba", start: 5553910, end: 5554986 }, { filename: "/pglite/share/postgresql/timezone/America/Costa_Rica", start: 5554986, end: 5555302 }, { filename: "/pglite/share/postgresql/timezone/America/Coyhaique", start: 5555302, end: 5557442 }, { filename: "/pglite/share/postgresql/timezone/America/Creston", start: 5557442, end: 5557802 }, { filename: "/pglite/share/postgresql/timezone/America/Cuiaba", start: 5557802, end: 5559218 }, { filename: "/pglite/share/postgresql/timezone/America/Curacao", start: 5559218, end: 5559464 }, { filename: "/pglite/share/postgresql/timezone/America/Danmarkshavn", start: 5559464, end: 5560162 }, { filename: "/pglite/share/postgresql/timezone/America/Dawson", start: 5560162, end: 5561776 }, { filename: "/pglite/share/postgresql/timezone/America/Dawson_Creek", start: 5561776, end: 5562826 }, { filename: "/pglite/share/postgresql/timezone/America/Denver", start: 5562826, end: 5565286 }, { filename: "/pglite/share/postgresql/timezone/America/Detroit", start: 5565286, end: 5567516 }, { filename: "/pglite/share/postgresql/timezone/America/Dominica", start: 5567516, end: 5567762 }, { filename: "/pglite/share/postgresql/timezone/America/Edmonton", start: 5567762, end: 5570094 }, { filename: "/pglite/share/postgresql/timezone/America/Eirunepe", start: 5570094, end: 5570750 }, { filename: "/pglite/share/postgresql/timezone/America/El_Salvador", start: 5570750, end: 5570974 }, { filename: "/pglite/share/postgresql/timezone/America/Ensenada", start: 5570974, end: 5573880 }, { filename: "/pglite/share/postgresql/timezone/America/Fort_Nelson", start: 5573880, end: 5576120 }, { filename: "/pglite/share/postgresql/timezone/America/Fort_Wayne", start: 5576120, end: 5577802 }, { filename: "/pglite/share/postgresql/timezone/America/Fortaleza", start: 5577802, end: 5578518 }, { filename: "/pglite/share/postgresql/timezone/America/Glace_Bay", start: 5578518, end: 5580710 }, { filename: "/pglite/share/postgresql/timezone/America/Godthab", start: 5580710, end: 5582613 }, { filename: "/pglite/share/postgresql/timezone/America/Goose_Bay", start: 5582613, end: 5585823 }, { filename: "/pglite/share/postgresql/timezone/America/Grand_Turk", start: 5585823, end: 5587657 }, { filename: "/pglite/share/postgresql/timezone/America/Grenada", start: 5587657, end: 5587903 }, { filename: "/pglite/share/postgresql/timezone/America/Guadeloupe", start: 5587903, end: 5588149 }, { filename: "/pglite/share/postgresql/timezone/America/Guatemala", start: 5588149, end: 5588429 }, { filename: "/pglite/share/postgresql/timezone/America/Guayaquil", start: 5588429, end: 5588675 }, { filename: "/pglite/share/postgresql/timezone/America/Guyana", start: 5588675, end: 5588937 }, { filename: "/pglite/share/postgresql/timezone/America/Halifax", start: 5588937, end: 5592361 }, { filename: "/pglite/share/postgresql/timezone/America/Havana", start: 5592361, end: 5594777 }, { filename: "/pglite/share/postgresql/timezone/America/Hermosillo", start: 5594777, end: 5595165 }, { filename: "/pglite/share/postgresql/timezone/America/Indiana/Indianapolis", start: 5595165, end: 5596847 }, { filename: "/pglite/share/postgresql/timezone/America/Indiana/Knox", start: 5596847, end: 5599291 }, { filename: "/pglite/share/postgresql/timezone/America/Indiana/Marengo", start: 5599291, end: 5601029 }, { filename: "/pglite/share/postgresql/timezone/America/Indiana/Petersburg", start: 5601029, end: 5602949 }, { filename: "/pglite/share/postgresql/timezone/America/Indiana/Tell_City", start: 5602949, end: 5604649 }, { filename: "/pglite/share/postgresql/timezone/America/Indiana/Vevay", start: 5604649, end: 5606079 }, { filename: "/pglite/share/postgresql/timezone/America/Indiana/Vincennes", start: 5606079, end: 5607789 }, { filename: "/pglite/share/postgresql/timezone/America/Indiana/Winamac", start: 5607789, end: 5609583 }, { filename: "/pglite/share/postgresql/timezone/America/Indianapolis", start: 5609583, end: 5611265 }, { filename: "/pglite/share/postgresql/timezone/America/Inuvik", start: 5611265, end: 5613339 }, { filename: "/pglite/share/postgresql/timezone/America/Iqaluit", start: 5613339, end: 5615541 }, { filename: "/pglite/share/postgresql/timezone/America/Jamaica", start: 5615541, end: 5616023 }, { filename: "/pglite/share/postgresql/timezone/America/Jujuy", start: 5616023, end: 5617071 }, { filename: "/pglite/share/postgresql/timezone/America/Juneau", start: 5617071, end: 5619424 }, { filename: "/pglite/share/postgresql/timezone/America/Kentucky/Louisville", start: 5619424, end: 5622212 }, { filename: "/pglite/share/postgresql/timezone/America/Kentucky/Monticello", start: 5622212, end: 5624580 }, { filename: "/pglite/share/postgresql/timezone/America/Knox_IN", start: 5624580, end: 5627024 }, { filename: "/pglite/share/postgresql/timezone/America/Kralendijk", start: 5627024, end: 5627270 }, { filename: "/pglite/share/postgresql/timezone/America/La_Paz", start: 5627270, end: 5627502 }, { filename: "/pglite/share/postgresql/timezone/America/Lima", start: 5627502, end: 5627908 }, { filename: "/pglite/share/postgresql/timezone/America/Los_Angeles", start: 5627908, end: 5630760 }, { filename: "/pglite/share/postgresql/timezone/America/Louisville", start: 5630760, end: 5633548 }, { filename: "/pglite/share/postgresql/timezone/America/Lower_Princes", start: 5633548, end: 5633794 }, { filename: "/pglite/share/postgresql/timezone/America/Maceio", start: 5633794, end: 5634538 }, { filename: "/pglite/share/postgresql/timezone/America/Managua", start: 5634538, end: 5634968 }, { filename: "/pglite/share/postgresql/timezone/America/Manaus", start: 5634968, end: 5635572 }, { filename: "/pglite/share/postgresql/timezone/America/Marigot", start: 5635572, end: 5635818 }, { filename: "/pglite/share/postgresql/timezone/America/Martinique", start: 5635818, end: 5636050 }, { filename: "/pglite/share/postgresql/timezone/America/Matamoros", start: 5636050, end: 5637468 }, { filename: "/pglite/share/postgresql/timezone/America/Mazatlan", start: 5637468, end: 5638528 }, { filename: "/pglite/share/postgresql/timezone/America/Mendoza", start: 5638528, end: 5639604 }, { filename: "/pglite/share/postgresql/timezone/America/Menominee", start: 5639604, end: 5641878 }, { filename: "/pglite/share/postgresql/timezone/America/Merida", start: 5641878, end: 5642882 }, { filename: "/pglite/share/postgresql/timezone/America/Metlakatla", start: 5642882, end: 5644305 }, { filename: "/pglite/share/postgresql/timezone/America/Mexico_City", start: 5644305, end: 5645527 }, { filename: "/pglite/share/postgresql/timezone/America/Miquelon", start: 5645527, end: 5647193 }, { filename: "/pglite/share/postgresql/timezone/America/Moncton", start: 5647193, end: 5650347 }, { filename: "/pglite/share/postgresql/timezone/America/Monterrey", start: 5650347, end: 5651461 }, { filename: "/pglite/share/postgresql/timezone/America/Montevideo", start: 5651461, end: 5652971 }, { filename: "/pglite/share/postgresql/timezone/America/Montreal", start: 5652971, end: 5656465 }, { filename: "/pglite/share/postgresql/timezone/America/Montserrat", start: 5656465, end: 5656711 }, { filename: "/pglite/share/postgresql/timezone/America/Nassau", start: 5656711, end: 5660205 }, { filename: "/pglite/share/postgresql/timezone/America/New_York", start: 5660205, end: 5663757 }, { filename: "/pglite/share/postgresql/timezone/America/Nipigon", start: 5663757, end: 5667251 }, { filename: "/pglite/share/postgresql/timezone/America/Nome", start: 5667251, end: 5669618 }, { filename: "/pglite/share/postgresql/timezone/America/Noronha", start: 5669618, end: 5670334 }, { filename: "/pglite/share/postgresql/timezone/America/North_Dakota/Beulah", start: 5670334, end: 5672730 }, { filename: "/pglite/share/postgresql/timezone/America/North_Dakota/Center", start: 5672730, end: 5675126 }, { filename: "/pglite/share/postgresql/timezone/America/North_Dakota/New_Salem", start: 5675126, end: 5677522 }, { filename: "/pglite/share/postgresql/timezone/America/Nuuk", start: 5677522, end: 5679425 }, { filename: "/pglite/share/postgresql/timezone/America/Ojinaga", start: 5679425, end: 5680949 }, { filename: "/pglite/share/postgresql/timezone/America/Panama", start: 5680949, end: 5681131 }, { filename: "/pglite/share/postgresql/timezone/America/Pangnirtung", start: 5681131, end: 5683333 }, { filename: "/pglite/share/postgresql/timezone/America/Paramaribo", start: 5683333, end: 5683595 }, { filename: "/pglite/share/postgresql/timezone/America/Phoenix", start: 5683595, end: 5683955 }, { filename: "/pglite/share/postgresql/timezone/America/Port-au-Prince", start: 5683955, end: 5685389 }, { filename: "/pglite/share/postgresql/timezone/America/Port_of_Spain", start: 5685389, end: 5685635 }, { filename: "/pglite/share/postgresql/timezone/America/Porto_Acre", start: 5685635, end: 5686263 }, { filename: "/pglite/share/postgresql/timezone/America/Porto_Velho", start: 5686263, end: 5686839 }, { filename: "/pglite/share/postgresql/timezone/America/Puerto_Rico", start: 5686839, end: 5687085 }, { filename: "/pglite/share/postgresql/timezone/America/Punta_Arenas", start: 5687085, end: 5689001 }, { filename: "/pglite/share/postgresql/timezone/America/Rainy_River", start: 5689001, end: 5691869 }, { filename: "/pglite/share/postgresql/timezone/America/Rankin_Inlet", start: 5691869, end: 5693935 }, { filename: "/pglite/share/postgresql/timezone/America/Recife", start: 5693935, end: 5694651 }, { filename: "/pglite/share/postgresql/timezone/America/Regina", start: 5694651, end: 5695631 }, { filename: "/pglite/share/postgresql/timezone/America/Resolute", start: 5695631, end: 5697697 }, { filename: "/pglite/share/postgresql/timezone/America/Rio_Branco", start: 5697697, end: 5698325 }, { filename: "/pglite/share/postgresql/timezone/America/Rosario", start: 5698325, end: 5699401 }, { filename: "/pglite/share/postgresql/timezone/America/Santa_Isabel", start: 5699401, end: 5702307 }, { filename: "/pglite/share/postgresql/timezone/America/Santarem", start: 5702307, end: 5702909 }, { filename: "/pglite/share/postgresql/timezone/America/Santiago", start: 5702909, end: 5705438 }, { filename: "/pglite/share/postgresql/timezone/America/Santo_Domingo", start: 5705438, end: 5705896 }, { filename: "/pglite/share/postgresql/timezone/America/Sao_Paulo", start: 5705896, end: 5707340 }, { filename: "/pglite/share/postgresql/timezone/America/Scoresbysund", start: 5707340, end: 5709289 }, { filename: "/pglite/share/postgresql/timezone/America/Shiprock", start: 5709289, end: 5711749 }, { filename: "/pglite/share/postgresql/timezone/America/Sitka", start: 5711749, end: 5714078 }, { filename: "/pglite/share/postgresql/timezone/America/St_Barthelemy", start: 5714078, end: 5714324 }, { filename: "/pglite/share/postgresql/timezone/America/St_Johns", start: 5714324, end: 5717979 }, { filename: "/pglite/share/postgresql/timezone/America/St_Kitts", start: 5717979, end: 5718225 }, { filename: "/pglite/share/postgresql/timezone/America/St_Lucia", start: 5718225, end: 5718471 }, { filename: "/pglite/share/postgresql/timezone/America/St_Thomas", start: 5718471, end: 5718717 }, { filename: "/pglite/share/postgresql/timezone/America/St_Vincent", start: 5718717, end: 5718963 }, { filename: "/pglite/share/postgresql/timezone/America/Swift_Current", start: 5718963, end: 5719523 }, { filename: "/pglite/share/postgresql/timezone/America/Tegucigalpa", start: 5719523, end: 5719775 }, { filename: "/pglite/share/postgresql/timezone/America/Thule", start: 5719775, end: 5721277 }, { filename: "/pglite/share/postgresql/timezone/America/Thunder_Bay", start: 5721277, end: 5724771 }, { filename: "/pglite/share/postgresql/timezone/America/Tijuana", start: 5724771, end: 5727677 }, { filename: "/pglite/share/postgresql/timezone/America/Toronto", start: 5727677, end: 5731171 }, { filename: "/pglite/share/postgresql/timezone/America/Tortola", start: 5731171, end: 5731417 }, { filename: "/pglite/share/postgresql/timezone/America/Vancouver", start: 5731417, end: 5734309 }, { filename: "/pglite/share/postgresql/timezone/America/Virgin", start: 5734309, end: 5734555 }, { filename: "/pglite/share/postgresql/timezone/America/Whitehorse", start: 5734555, end: 5736169 }, { filename: "/pglite/share/postgresql/timezone/America/Winnipeg", start: 5736169, end: 5739037 }, { filename: "/pglite/share/postgresql/timezone/America/Yakutat", start: 5739037, end: 5741342 }, { filename: "/pglite/share/postgresql/timezone/America/Yellowknife", start: 5741342, end: 5743674 }, { filename: "/pglite/share/postgresql/timezone/Antarctica/Casey", start: 5743674, end: 5744111 }, { filename: "/pglite/share/postgresql/timezone/Antarctica/Davis", start: 5744111, end: 5744408 }, { filename: "/pglite/share/postgresql/timezone/Antarctica/DumontDUrville", start: 5744408, end: 5744594 }, { filename: "/pglite/share/postgresql/timezone/Antarctica/Macquarie", start: 5744594, end: 5746854 }, { filename: "/pglite/share/postgresql/timezone/Antarctica/Mawson", start: 5746854, end: 5747053 }, { filename: "/pglite/share/postgresql/timezone/Antarctica/McMurdo", start: 5747053, end: 5749490 }, { filename: "/pglite/share/postgresql/timezone/Antarctica/Palmer", start: 5749490, end: 5750908 }, { filename: "/pglite/share/postgresql/timezone/Antarctica/Rothera", start: 5750908, end: 5751072 }, { filename: "/pglite/share/postgresql/timezone/Antarctica/South_Pole", start: 5751072, end: 5753509 }, { filename: "/pglite/share/postgresql/timezone/Antarctica/Syowa", start: 5753509, end: 5753674 }, { filename: "/pglite/share/postgresql/timezone/Antarctica/Troll", start: 5753674, end: 5754836 }, { filename: "/pglite/share/postgresql/timezone/Antarctica/Vostok", start: 5754836, end: 5755063 }, { filename: "/pglite/share/postgresql/timezone/Arctic/Longyearbyen", start: 5755063, end: 5757361 }, { filename: "/pglite/share/postgresql/timezone/Asia/Aden", start: 5757361, end: 5757526 }, { filename: "/pglite/share/postgresql/timezone/Asia/Almaty", start: 5757526, end: 5758523 }, { filename: "/pglite/share/postgresql/timezone/Asia/Amman", start: 5758523, end: 5759970 }, { filename: "/pglite/share/postgresql/timezone/Asia/Anadyr", start: 5759970, end: 5761158 }, { filename: "/pglite/share/postgresql/timezone/Asia/Aqtau", start: 5761158, end: 5762141 }, { filename: "/pglite/share/postgresql/timezone/Asia/Aqtobe", start: 5762141, end: 5763152 }, { filename: "/pglite/share/postgresql/timezone/Asia/Ashgabat", start: 5763152, end: 5763771 }, { filename: "/pglite/share/postgresql/timezone/Asia/Ashkhabad", start: 5763771, end: 5764390 }, { filename: "/pglite/share/postgresql/timezone/Asia/Atyrau", start: 5764390, end: 5765381 }, { filename: "/pglite/share/postgresql/timezone/Asia/Baghdad", start: 5765381, end: 5766364 }, { filename: "/pglite/share/postgresql/timezone/Asia/Bahrain", start: 5766364, end: 5766563 }, { filename: "/pglite/share/postgresql/timezone/Asia/Baku", start: 5766563, end: 5767790 }, { filename: "/pglite/share/postgresql/timezone/Asia/Bangkok", start: 5767790, end: 5767989 }, { filename: "/pglite/share/postgresql/timezone/Asia/Barnaul", start: 5767989, end: 5769210 }, { filename: "/pglite/share/postgresql/timezone/Asia/Beirut", start: 5769210, end: 5771364 }, { filename: "/pglite/share/postgresql/timezone/Asia/Bishkek", start: 5771364, end: 5772347 }, { filename: "/pglite/share/postgresql/timezone/Asia/Brunei", start: 5772347, end: 5772830 }, { filename: "/pglite/share/postgresql/timezone/Asia/Calcutta", start: 5772830, end: 5773115 }, { filename: "/pglite/share/postgresql/timezone/Asia/Chita", start: 5773115, end: 5774336 }, { filename: "/pglite/share/postgresql/timezone/Asia/Choibalsan", start: 5774336, end: 5775227 }, { filename: "/pglite/share/postgresql/timezone/Asia/Chongqing", start: 5775227, end: 5775788 }, { filename: "/pglite/share/postgresql/timezone/Asia/Chungking", start: 5775788, end: 5776349 }, { filename: "/pglite/share/postgresql/timezone/Asia/Colombo", start: 5776349, end: 5776721 }, { filename: "/pglite/share/postgresql/timezone/Asia/Dacca", start: 5776721, end: 5777058 }, { filename: "/pglite/share/postgresql/timezone/Asia/Damascus", start: 5777058, end: 5778945 }, { filename: "/pglite/share/postgresql/timezone/Asia/Dhaka", start: 5778945, end: 5779282 }, { filename: "/pglite/share/postgresql/timezone/Asia/Dili", start: 5779282, end: 5779553 }, { filename: "/pglite/share/postgresql/timezone/Asia/Dubai", start: 5779553, end: 5779718 }, { filename: "/pglite/share/postgresql/timezone/Asia/Dushanbe", start: 5779718, end: 5780309 }, { filename: "/pglite/share/postgresql/timezone/Asia/Famagusta", start: 5780309, end: 5782337 }, { filename: "/pglite/share/postgresql/timezone/Asia/Gaza", start: 5782337, end: 5786181 }, { filename: "/pglite/share/postgresql/timezone/Asia/Harbin", start: 5786181, end: 5786742 }, { filename: "/pglite/share/postgresql/timezone/Asia/Hebron", start: 5786742, end: 5790614 }, { filename: "/pglite/share/postgresql/timezone/Asia/Ho_Chi_Minh", start: 5790614, end: 5790965 }, { filename: "/pglite/share/postgresql/timezone/Asia/Hong_Kong", start: 5790965, end: 5792198 }, { filename: "/pglite/share/postgresql/timezone/Asia/Hovd", start: 5792198, end: 5793089 }, { filename: "/pglite/share/postgresql/timezone/Asia/Irkutsk", start: 5793089, end: 5794332 }, { filename: "/pglite/share/postgresql/timezone/Asia/Istanbul", start: 5794332, end: 5796279 }, { filename: "/pglite/share/postgresql/timezone/Asia/Jakarta", start: 5796279, end: 5796662 }, { filename: "/pglite/share/postgresql/timezone/Asia/Jayapura", start: 5796662, end: 5796883 }, { filename: "/pglite/share/postgresql/timezone/Asia/Jerusalem", start: 5796883, end: 5799271 }, { filename: "/pglite/share/postgresql/timezone/Asia/Kabul", start: 5799271, end: 5799479 }, { filename: "/pglite/share/postgresql/timezone/Asia/Kamchatka", start: 5799479, end: 5800645 }, { filename: "/pglite/share/postgresql/timezone/Asia/Karachi", start: 5800645, end: 5801024 }, { filename: "/pglite/share/postgresql/timezone/Asia/Kashgar", start: 5801024, end: 5801189 }, { filename: "/pglite/share/postgresql/timezone/Asia/Kathmandu", start: 5801189, end: 5801401 }, { filename: "/pglite/share/postgresql/timezone/Asia/Katmandu", start: 5801401, end: 5801613 }, { filename: "/pglite/share/postgresql/timezone/Asia/Khandyga", start: 5801613, end: 5802884 }, { filename: "/pglite/share/postgresql/timezone/Asia/Kolkata", start: 5802884, end: 5803169 }, { filename: "/pglite/share/postgresql/timezone/Asia/Krasnoyarsk", start: 5803169, end: 5804376 }, { filename: "/pglite/share/postgresql/timezone/Asia/Kuala_Lumpur", start: 5804376, end: 5804791 }, { filename: "/pglite/share/postgresql/timezone/Asia/Kuching", start: 5804791, end: 5805274 }, { filename: "/pglite/share/postgresql/timezone/Asia/Kuwait", start: 5805274, end: 5805439 }, { filename: "/pglite/share/postgresql/timezone/Asia/Macao", start: 5805439, end: 5806666 }, { filename: "/pglite/share/postgresql/timezone/Asia/Macau", start: 5806666, end: 5807893 }, { filename: "/pglite/share/postgresql/timezone/Asia/Magadan", start: 5807893, end: 5809115 }, { filename: "/pglite/share/postgresql/timezone/Asia/Makassar", start: 5809115, end: 5809369 }, { filename: "/pglite/share/postgresql/timezone/Asia/Manila", start: 5809369, end: 5809791 }, { filename: "/pglite/share/postgresql/timezone/Asia/Muscat", start: 5809791, end: 5809956 }, { filename: "/pglite/share/postgresql/timezone/Asia/Nicosia", start: 5809956, end: 5811958 }, { filename: "/pglite/share/postgresql/timezone/Asia/Novokuznetsk", start: 5811958, end: 5813123 }, { filename: "/pglite/share/postgresql/timezone/Asia/Novosibirsk", start: 5813123, end: 5814344 }, { filename: "/pglite/share/postgresql/timezone/Asia/Omsk", start: 5814344, end: 5815551 }, { filename: "/pglite/share/postgresql/timezone/Asia/Oral", start: 5815551, end: 5816556 }, { filename: "/pglite/share/postgresql/timezone/Asia/Phnom_Penh", start: 5816556, end: 5816755 }, { filename: "/pglite/share/postgresql/timezone/Asia/Pontianak", start: 5816755, end: 5817108 }, { filename: "/pglite/share/postgresql/timezone/Asia/Pyongyang", start: 5817108, end: 5817345 }, { filename: "/pglite/share/postgresql/timezone/Asia/Qatar", start: 5817345, end: 5817544 }, { filename: "/pglite/share/postgresql/timezone/Asia/Qostanay", start: 5817544, end: 5818583 }, { filename: "/pglite/share/postgresql/timezone/Asia/Qyzylorda", start: 5818583, end: 5819608 }, { filename: "/pglite/share/postgresql/timezone/Asia/Rangoon", start: 5819608, end: 5819876 }, { filename: "/pglite/share/postgresql/timezone/Asia/Riyadh", start: 5819876, end: 5820041 }, { filename: "/pglite/share/postgresql/timezone/Asia/Saigon", start: 5820041, end: 5820392 }, { filename: "/pglite/share/postgresql/timezone/Asia/Sakhalin", start: 5820392, end: 5821594 }, { filename: "/pglite/share/postgresql/timezone/Asia/Samarkand", start: 5821594, end: 5822171 }, { filename: "/pglite/share/postgresql/timezone/Asia/Seoul", start: 5822171, end: 5822788 }, { filename: "/pglite/share/postgresql/timezone/Asia/Shanghai", start: 5822788, end: 5823349 }, { filename: "/pglite/share/postgresql/timezone/Asia/Singapore", start: 5823349, end: 5823764 }, { filename: "/pglite/share/postgresql/timezone/Asia/Srednekolymsk", start: 5823764, end: 5824972 }, { filename: "/pglite/share/postgresql/timezone/Asia/Taipei", start: 5824972, end: 5825733 }, { filename: "/pglite/share/postgresql/timezone/Asia/Tashkent", start: 5825733, end: 5826324 }, { filename: "/pglite/share/postgresql/timezone/Asia/Tbilisi", start: 5826324, end: 5827359 }, { filename: "/pglite/share/postgresql/timezone/Asia/Tehran", start: 5827359, end: 5828621 }, { filename: "/pglite/share/postgresql/timezone/Asia/Tel_Aviv", start: 5828621, end: 5831009 }, { filename: "/pglite/share/postgresql/timezone/Asia/Thimbu", start: 5831009, end: 5831212 }, { filename: "/pglite/share/postgresql/timezone/Asia/Thimphu", start: 5831212, end: 5831415 }, { filename: "/pglite/share/postgresql/timezone/Asia/Tokyo", start: 5831415, end: 5831724 }, { filename: "/pglite/share/postgresql/timezone/Asia/Tomsk", start: 5831724, end: 5832945 }, { filename: "/pglite/share/postgresql/timezone/Asia/Ujung_Pandang", start: 5832945, end: 5833199 }, { filename: "/pglite/share/postgresql/timezone/Asia/Ulaanbaatar", start: 5833199, end: 5834090 }, { filename: "/pglite/share/postgresql/timezone/Asia/Ulan_Bator", start: 5834090, end: 5834981 }, { filename: "/pglite/share/postgresql/timezone/Asia/Urumqi", start: 5834981, end: 5835146 }, { filename: "/pglite/share/postgresql/timezone/Asia/Ust-Nera", start: 5835146, end: 5836398 }, { filename: "/pglite/share/postgresql/timezone/Asia/Vientiane", start: 5836398, end: 5836597 }, { filename: "/pglite/share/postgresql/timezone/Asia/Vladivostok", start: 5836597, end: 5837805 }, { filename: "/pglite/share/postgresql/timezone/Asia/Yakutsk", start: 5837805, end: 5839012 }, { filename: "/pglite/share/postgresql/timezone/Asia/Yangon", start: 5839012, end: 5839280 }, { filename: "/pglite/share/postgresql/timezone/Asia/Yekaterinburg", start: 5839280, end: 5840523 }, { filename: "/pglite/share/postgresql/timezone/Asia/Yerevan", start: 5840523, end: 5841674 }, { filename: "/pglite/share/postgresql/timezone/Atlantic/Azores", start: 5841674, end: 5845130 }, { filename: "/pglite/share/postgresql/timezone/Atlantic/Bermuda", start: 5845130, end: 5847526 }, { filename: "/pglite/share/postgresql/timezone/Atlantic/Canary", start: 5847526, end: 5849423 }, { filename: "/pglite/share/postgresql/timezone/Atlantic/Cape_Verde", start: 5849423, end: 5849693 }, { filename: "/pglite/share/postgresql/timezone/Atlantic/Faeroe", start: 5849693, end: 5851508 }, { filename: "/pglite/share/postgresql/timezone/Atlantic/Faroe", start: 5851508, end: 5853323 }, { filename: "/pglite/share/postgresql/timezone/Atlantic/Jan_Mayen", start: 5853323, end: 5855621 }, { filename: "/pglite/share/postgresql/timezone/Atlantic/Madeira", start: 5855621, end: 5858998 }, { filename: "/pglite/share/postgresql/timezone/Atlantic/Reykjavik", start: 5858998, end: 5859146 }, { filename: "/pglite/share/postgresql/timezone/Atlantic/South_Georgia", start: 5859146, end: 5859310 }, { filename: "/pglite/share/postgresql/timezone/Atlantic/St_Helena", start: 5859310, end: 5859458 }, { filename: "/pglite/share/postgresql/timezone/Atlantic/Stanley", start: 5859458, end: 5860672 }, { filename: "/pglite/share/postgresql/timezone/Australia/ACT", start: 5860672, end: 5862862 }, { filename: "/pglite/share/postgresql/timezone/Australia/Adelaide", start: 5862862, end: 5865070 }, { filename: "/pglite/share/postgresql/timezone/Australia/Brisbane", start: 5865070, end: 5865489 }, { filename: "/pglite/share/postgresql/timezone/Australia/Broken_Hill", start: 5865489, end: 5867718 }, { filename: "/pglite/share/postgresql/timezone/Australia/Canberra", start: 5867718, end: 5869908 }, { filename: "/pglite/share/postgresql/timezone/Australia/Currie", start: 5869908, end: 5872266 }, { filename: "/pglite/share/postgresql/timezone/Australia/Darwin", start: 5872266, end: 5872591 }, { filename: "/pglite/share/postgresql/timezone/Australia/Eucla", start: 5872591, end: 5873061 }, { filename: "/pglite/share/postgresql/timezone/Australia/Hobart", start: 5873061, end: 5875419 }, { filename: "/pglite/share/postgresql/timezone/Australia/LHI", start: 5875419, end: 5877279 }, { filename: "/pglite/share/postgresql/timezone/Australia/Lindeman", start: 5877279, end: 5877754 }, { filename: "/pglite/share/postgresql/timezone/Australia/Lord_Howe", start: 5877754, end: 5879614 }, { filename: "/pglite/share/postgresql/timezone/Australia/Melbourne", start: 5879614, end: 5881804 }, { filename: "/pglite/share/postgresql/timezone/Australia/NSW", start: 5881804, end: 5883994 }, { filename: "/pglite/share/postgresql/timezone/Australia/North", start: 5883994, end: 5884319 }, { filename: "/pglite/share/postgresql/timezone/Australia/Perth", start: 5884319, end: 5884765 }, { filename: "/pglite/share/postgresql/timezone/Australia/Queensland", start: 5884765, end: 5885184 }, { filename: "/pglite/share/postgresql/timezone/Australia/South", start: 5885184, end: 5887392 }, { filename: "/pglite/share/postgresql/timezone/Australia/Sydney", start: 5887392, end: 5889582 }, { filename: "/pglite/share/postgresql/timezone/Australia/Tasmania", start: 5889582, end: 5891940 }, { filename: "/pglite/share/postgresql/timezone/Australia/Victoria", start: 5891940, end: 5894130 }, { filename: "/pglite/share/postgresql/timezone/Australia/West", start: 5894130, end: 5894576 }, { filename: "/pglite/share/postgresql/timezone/Australia/Yancowinna", start: 5894576, end: 5896805 }, { filename: "/pglite/share/postgresql/timezone/Brazil/Acre", start: 5896805, end: 5897433 }, { filename: "/pglite/share/postgresql/timezone/Brazil/DeNoronha", start: 5897433, end: 5898149 }, { filename: "/pglite/share/postgresql/timezone/Brazil/East", start: 5898149, end: 5899593 }, { filename: "/pglite/share/postgresql/timezone/Brazil/West", start: 5899593, end: 5900197 }, { filename: "/pglite/share/postgresql/timezone/CET", start: 5900197, end: 5903130 }, { filename: "/pglite/share/postgresql/timezone/CST6CDT", start: 5903130, end: 5906722 }, { filename: "/pglite/share/postgresql/timezone/Canada/Atlantic", start: 5906722, end: 5910146 }, { filename: "/pglite/share/postgresql/timezone/Canada/Central", start: 5910146, end: 5913014 }, { filename: "/pglite/share/postgresql/timezone/Canada/Eastern", start: 5913014, end: 5916508 }, { filename: "/pglite/share/postgresql/timezone/Canada/Mountain", start: 5916508, end: 5918840 }, { filename: "/pglite/share/postgresql/timezone/Canada/Newfoundland", start: 5918840, end: 5922495 }, { filename: "/pglite/share/postgresql/timezone/Canada/Pacific", start: 5922495, end: 5925387 }, { filename: "/pglite/share/postgresql/timezone/Canada/Saskatchewan", start: 5925387, end: 5926367 }, { filename: "/pglite/share/postgresql/timezone/Canada/Yukon", start: 5926367, end: 5927981 }, { filename: "/pglite/share/postgresql/timezone/Chile/Continental", start: 5927981, end: 5930510 }, { filename: "/pglite/share/postgresql/timezone/Chile/EasterIsland", start: 5930510, end: 5932743 }, { filename: "/pglite/share/postgresql/timezone/Cuba", start: 5932743, end: 5935159 }, { filename: "/pglite/share/postgresql/timezone/EET", start: 5935159, end: 5937421 }, { filename: "/pglite/share/postgresql/timezone/EST", start: 5937421, end: 5937603 }, { filename: "/pglite/share/postgresql/timezone/EST5EDT", start: 5937603, end: 5941155 }, { filename: "/pglite/share/postgresql/timezone/Egypt", start: 5941155, end: 5943554 }, { filename: "/pglite/share/postgresql/timezone/Eire", start: 5943554, end: 5947046 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT", start: 5947046, end: 5947160 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+0", start: 5947160, end: 5947274 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+1", start: 5947274, end: 5947390 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+10", start: 5947390, end: 5947507 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+11", start: 5947507, end: 5947624 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+12", start: 5947624, end: 5947741 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+2", start: 5947741, end: 5947857 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+3", start: 5947857, end: 5947973 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+4", start: 5947973, end: 5948089 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+5", start: 5948089, end: 5948205 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+6", start: 5948205, end: 5948321 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+7", start: 5948321, end: 5948437 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+8", start: 5948437, end: 5948553 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT+9", start: 5948553, end: 5948669 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-0", start: 5948669, end: 5948783 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-1", start: 5948783, end: 5948900 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-10", start: 5948900, end: 5949018 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-11", start: 5949018, end: 5949136 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-12", start: 5949136, end: 5949254 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-13", start: 5949254, end: 5949372 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-14", start: 5949372, end: 5949490 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-2", start: 5949490, end: 5949607 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-3", start: 5949607, end: 5949724 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-4", start: 5949724, end: 5949841 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-5", start: 5949841, end: 5949958 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-6", start: 5949958, end: 5950075 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-7", start: 5950075, end: 5950192 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-8", start: 5950192, end: 5950309 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT-9", start: 5950309, end: 5950426 }, { filename: "/pglite/share/postgresql/timezone/Etc/GMT0", start: 5950426, end: 5950540 }, { filename: "/pglite/share/postgresql/timezone/Etc/Greenwich", start: 5950540, end: 5950654 }, { filename: "/pglite/share/postgresql/timezone/Etc/UCT", start: 5950654, end: 5950768 }, { filename: "/pglite/share/postgresql/timezone/Etc/UTC", start: 5950768, end: 5950882 }, { filename: "/pglite/share/postgresql/timezone/Etc/Universal", start: 5950882, end: 5950996 }, { filename: "/pglite/share/postgresql/timezone/Etc/Zulu", start: 5950996, end: 5951110 }, { filename: "/pglite/share/postgresql/timezone/Europe/Amsterdam", start: 5951110, end: 5954043 }, { filename: "/pglite/share/postgresql/timezone/Europe/Andorra", start: 5954043, end: 5955785 }, { filename: "/pglite/share/postgresql/timezone/Europe/Astrakhan", start: 5955785, end: 5956950 }, { filename: "/pglite/share/postgresql/timezone/Europe/Athens", start: 5956950, end: 5959212 }, { filename: "/pglite/share/postgresql/timezone/Europe/Belfast", start: 5959212, end: 5962876 }, { filename: "/pglite/share/postgresql/timezone/Europe/Belgrade", start: 5962876, end: 5964796 }, { filename: "/pglite/share/postgresql/timezone/Europe/Berlin", start: 5964796, end: 5967094 }, { filename: "/pglite/share/postgresql/timezone/Europe/Bratislava", start: 5967094, end: 5969395 }, { filename: "/pglite/share/postgresql/timezone/Europe/Brussels", start: 5969395, end: 5972328 }, { filename: "/pglite/share/postgresql/timezone/Europe/Bucharest", start: 5972328, end: 5974512 }, { filename: "/pglite/share/postgresql/timezone/Europe/Budapest", start: 5974512, end: 5976880 }, { filename: "/pglite/share/postgresql/timezone/Europe/Busingen", start: 5976880, end: 5978789 }, { filename: "/pglite/share/postgresql/timezone/Europe/Chisinau", start: 5978789, end: 5981179 }, { filename: "/pglite/share/postgresql/timezone/Europe/Copenhagen", start: 5981179, end: 5983477 }, { filename: "/pglite/share/postgresql/timezone/Europe/Dublin", start: 5983477, end: 5986969 }, { filename: "/pglite/share/postgresql/timezone/Europe/Gibraltar", start: 5986969, end: 5990037 }, { filename: "/pglite/share/postgresql/timezone/Europe/Guernsey", start: 5990037, end: 5993701 }, { filename: "/pglite/share/postgresql/timezone/Europe/Helsinki", start: 5993701, end: 5995601 }, { filename: "/pglite/share/postgresql/timezone/Europe/Isle_of_Man", start: 5995601, end: 5999265 }, { filename: "/pglite/share/postgresql/timezone/Europe/Istanbul", start: 5999265, end: 6001212 }, { filename: "/pglite/share/postgresql/timezone/Europe/Jersey", start: 6001212, end: 6004876 }, { filename: "/pglite/share/postgresql/timezone/Europe/Kaliningrad", start: 6004876, end: 6006369 }, { filename: "/pglite/share/postgresql/timezone/Europe/Kiev", start: 6006369, end: 6008489 }, { filename: "/pglite/share/postgresql/timezone/Europe/Kirov", start: 6008489, end: 6009674 }, { filename: "/pglite/share/postgresql/timezone/Europe/Kyiv", start: 6009674, end: 6011794 }, { filename: "/pglite/share/postgresql/timezone/Europe/Lisbon", start: 6011794, end: 6015321 }, { filename: "/pglite/share/postgresql/timezone/Europe/Ljubljana", start: 6015321, end: 6017241 }, { filename: "/pglite/share/postgresql/timezone/Europe/London", start: 6017241, end: 6020905 }, { filename: "/pglite/share/postgresql/timezone/Europe/Luxembourg", start: 6020905, end: 6023838 }, { filename: "/pglite/share/postgresql/timezone/Europe/Madrid", start: 6023838, end: 6026452 }, { filename: "/pglite/share/postgresql/timezone/Europe/Malta", start: 6026452, end: 6029072 }, { filename: "/pglite/share/postgresql/timezone/Europe/Mariehamn", start: 6029072, end: 6030972 }, { filename: "/pglite/share/postgresql/timezone/Europe/Minsk", start: 6030972, end: 6032293 }, { filename: "/pglite/share/postgresql/timezone/Europe/Monaco", start: 6032293, end: 6035255 }, { filename: "/pglite/share/postgresql/timezone/Europe/Moscow", start: 6035255, end: 6036790 }, { filename: "/pglite/share/postgresql/timezone/Europe/Nicosia", start: 6036790, end: 6038792 }, { filename: "/pglite/share/postgresql/timezone/Europe/Oslo", start: 6038792, end: 6041090 }, { filename: "/pglite/share/postgresql/timezone/Europe/Paris", start: 6041090, end: 6044052 }, { filename: "/pglite/share/postgresql/timezone/Europe/Podgorica", start: 6044052, end: 6045972 }, { filename: "/pglite/share/postgresql/timezone/Europe/Prague", start: 6045972, end: 6048273 }, { filename: "/pglite/share/postgresql/timezone/Europe/Riga", start: 6048273, end: 6050471 }, { filename: "/pglite/share/postgresql/timezone/Europe/Rome", start: 6050471, end: 6053112 }, { filename: "/pglite/share/postgresql/timezone/Europe/Samara", start: 6053112, end: 6054327 }, { filename: "/pglite/share/postgresql/timezone/Europe/San_Marino", start: 6054327, end: 6056968 }, { filename: "/pglite/share/postgresql/timezone/Europe/Sarajevo", start: 6056968, end: 6058888 }, { filename: "/pglite/share/postgresql/timezone/Europe/Saratov", start: 6058888, end: 6060071 }, { filename: "/pglite/share/postgresql/timezone/Europe/Simferopol", start: 6060071, end: 6061540 }, { filename: "/pglite/share/postgresql/timezone/Europe/Skopje", start: 6061540, end: 6063460 }, { filename: "/pglite/share/postgresql/timezone/Europe/Sofia", start: 6063460, end: 6065537 }, { filename: "/pglite/share/postgresql/timezone/Europe/Stockholm", start: 6065537, end: 6067835 }, { filename: "/pglite/share/postgresql/timezone/Europe/Tallinn", start: 6067835, end: 6069983 }, { filename: "/pglite/share/postgresql/timezone/Europe/Tirane", start: 6069983, end: 6072067 }, { filename: "/pglite/share/postgresql/timezone/Europe/Tiraspol", start: 6072067, end: 6074457 }, { filename: "/pglite/share/postgresql/timezone/Europe/Ulyanovsk", start: 6074457, end: 6075724 }, { filename: "/pglite/share/postgresql/timezone/Europe/Uzhgorod", start: 6075724, end: 6077844 }, { filename: "/pglite/share/postgresql/timezone/Europe/Vaduz", start: 6077844, end: 6079753 }, { filename: "/pglite/share/postgresql/timezone/Europe/Vatican", start: 6079753, end: 6082394 }, { filename: "/pglite/share/postgresql/timezone/Europe/Vienna", start: 6082394, end: 6084594 }, { filename: "/pglite/share/postgresql/timezone/Europe/Vilnius", start: 6084594, end: 6086756 }, { filename: "/pglite/share/postgresql/timezone/Europe/Volgograd", start: 6086756, end: 6087949 }, { filename: "/pglite/share/postgresql/timezone/Europe/Warsaw", start: 6087949, end: 6090603 }, { filename: "/pglite/share/postgresql/timezone/Europe/Zagreb", start: 6090603, end: 6092523 }, { filename: "/pglite/share/postgresql/timezone/Europe/Zaporozhye", start: 6092523, end: 6094643 }, { filename: "/pglite/share/postgresql/timezone/Europe/Zurich", start: 6094643, end: 6096552 }, { filename: "/pglite/share/postgresql/timezone/Factory", start: 6096552, end: 6096668 }, { filename: "/pglite/share/postgresql/timezone/GB", start: 6096668, end: 6100332 }, { filename: "/pglite/share/postgresql/timezone/GB-Eire", start: 6100332, end: 6103996 }, { filename: "/pglite/share/postgresql/timezone/GMT", start: 6103996, end: 6104110 }, { filename: "/pglite/share/postgresql/timezone/GMT+0", start: 6104110, end: 6104224 }, { filename: "/pglite/share/postgresql/timezone/GMT-0", start: 6104224, end: 6104338 }, { filename: "/pglite/share/postgresql/timezone/GMT0", start: 6104338, end: 6104452 }, { filename: "/pglite/share/postgresql/timezone/Greenwich", start: 6104452, end: 6104566 }, { filename: "/pglite/share/postgresql/timezone/HST", start: 6104566, end: 6104895 }, { filename: "/pglite/share/postgresql/timezone/Hongkong", start: 6104895, end: 6106128 }, { filename: "/pglite/share/postgresql/timezone/Iceland", start: 6106128, end: 6106276 }, { filename: "/pglite/share/postgresql/timezone/Indian/Antananarivo", start: 6106276, end: 6106541 }, { filename: "/pglite/share/postgresql/timezone/Indian/Chagos", start: 6106541, end: 6106740 }, { filename: "/pglite/share/postgresql/timezone/Indian/Christmas", start: 6106740, end: 6106939 }, { filename: "/pglite/share/postgresql/timezone/Indian/Cocos", start: 6106939, end: 6107207 }, { filename: "/pglite/share/postgresql/timezone/Indian/Comoro", start: 6107207, end: 6107472 }, { filename: "/pglite/share/postgresql/timezone/Indian/Kerguelen", start: 6107472, end: 6107671 }, { filename: "/pglite/share/postgresql/timezone/Indian/Mahe", start: 6107671, end: 6107836 }, { filename: "/pglite/share/postgresql/timezone/Indian/Maldives", start: 6107836, end: 6108035 }, { filename: "/pglite/share/postgresql/timezone/Indian/Mauritius", start: 6108035, end: 6108276 }, { filename: "/pglite/share/postgresql/timezone/Indian/Mayotte", start: 6108276, end: 6108541 }, { filename: "/pglite/share/postgresql/timezone/Indian/Reunion", start: 6108541, end: 6108706 }, { filename: "/pglite/share/postgresql/timezone/Iran", start: 6108706, end: 6109968 }, { filename: "/pglite/share/postgresql/timezone/Israel", start: 6109968, end: 6112356 }, { filename: "/pglite/share/postgresql/timezone/Jamaica", start: 6112356, end: 6112838 }, { filename: "/pglite/share/postgresql/timezone/Japan", start: 6112838, end: 6113147 }, { filename: "/pglite/share/postgresql/timezone/Kwajalein", start: 6113147, end: 6113463 }, { filename: "/pglite/share/postgresql/timezone/Libya", start: 6113463, end: 6114088 }, { filename: "/pglite/share/postgresql/timezone/MET", start: 6114088, end: 6117021 }, { filename: "/pglite/share/postgresql/timezone/MST", start: 6117021, end: 6117381 }, { filename: "/pglite/share/postgresql/timezone/MST7MDT", start: 6117381, end: 6119841 }, { filename: "/pglite/share/postgresql/timezone/Mexico/BajaNorte", start: 6119841, end: 6122747 }, { filename: "/pglite/share/postgresql/timezone/Mexico/BajaSur", start: 6122747, end: 6123807 }, { filename: "/pglite/share/postgresql/timezone/Mexico/General", start: 6123807, end: 6125029 }, { filename: "/pglite/share/postgresql/timezone/NZ", start: 6125029, end: 6127466 }, { filename: "/pglite/share/postgresql/timezone/NZ-CHAT", start: 6127466, end: 6129534 }, { filename: "/pglite/share/postgresql/timezone/Navajo", start: 6129534, end: 6131994 }, { filename: "/pglite/share/postgresql/timezone/PRC", start: 6131994, end: 6132555 }, { filename: "/pglite/share/postgresql/timezone/PST8PDT", start: 6132555, end: 6135407 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Apia", start: 6135407, end: 6136019 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Auckland", start: 6136019, end: 6138456 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Bougainville", start: 6138456, end: 6138724 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Chatham", start: 6138724, end: 6140792 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Chuuk", start: 6140792, end: 6140978 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Easter", start: 6140978, end: 6143211 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Efate", start: 6143211, end: 6143749 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Enderbury", start: 6143749, end: 6143983 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Fakaofo", start: 6143983, end: 6144183 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Fiji", start: 6144183, end: 6144761 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Funafuti", start: 6144761, end: 6144927 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Galapagos", start: 6144927, end: 6145165 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Gambier", start: 6145165, end: 6145329 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Guadalcanal", start: 6145329, end: 6145495 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Guam", start: 6145495, end: 6145989 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Honolulu", start: 6145989, end: 6146318 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Johnston", start: 6146318, end: 6146647 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Kanton", start: 6146647, end: 6146881 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Kiritimati", start: 6146881, end: 6147119 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Kosrae", start: 6147119, end: 6147470 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Kwajalein", start: 6147470, end: 6147786 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Majuro", start: 6147786, end: 6147952 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Marquesas", start: 6147952, end: 6148125 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Midway", start: 6148125, end: 6148300 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Nauru", start: 6148300, end: 6148552 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Niue", start: 6148552, end: 6148755 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Norfolk", start: 6148755, end: 6149635 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Noumea", start: 6149635, end: 6149939 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Pago_Pago", start: 6149939, end: 6150114 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Palau", start: 6150114, end: 6150294 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Pitcairn", start: 6150294, end: 6150496 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Pohnpei", start: 6150496, end: 6150662 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Ponape", start: 6150662, end: 6150828 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Port_Moresby", start: 6150828, end: 6151014 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Rarotonga", start: 6151014, end: 6151617 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Saipan", start: 6151617, end: 6152111 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Samoa", start: 6152111, end: 6152286 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Tahiti", start: 6152286, end: 6152451 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Tarawa", start: 6152451, end: 6152617 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Tongatapu", start: 6152617, end: 6152989 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Truk", start: 6152989, end: 6153175 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Wake", start: 6153175, end: 6153341 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Wallis", start: 6153341, end: 6153507 }, { filename: "/pglite/share/postgresql/timezone/Pacific/Yap", start: 6153507, end: 6153693 }, { filename: "/pglite/share/postgresql/timezone/Poland", start: 6153693, end: 6156347 }, { filename: "/pglite/share/postgresql/timezone/Portugal", start: 6156347, end: 6159874 }, { filename: "/pglite/share/postgresql/timezone/ROC", start: 6159874, end: 6160635 }, { filename: "/pglite/share/postgresql/timezone/ROK", start: 6160635, end: 6161252 }, { filename: "/pglite/share/postgresql/timezone/Singapore", start: 6161252, end: 6161667 }, { filename: "/pglite/share/postgresql/timezone/Turkey", start: 6161667, end: 6163614 }, { filename: "/pglite/share/postgresql/timezone/UCT", start: 6163614, end: 6163728 }, { filename: "/pglite/share/postgresql/timezone/US/Alaska", start: 6163728, end: 6166099 }, { filename: "/pglite/share/postgresql/timezone/US/Aleutian", start: 6166099, end: 6168455 }, { filename: "/pglite/share/postgresql/timezone/US/Arizona", start: 6168455, end: 6168815 }, { filename: "/pglite/share/postgresql/timezone/US/Central", start: 6168815, end: 6172407 }, { filename: "/pglite/share/postgresql/timezone/US/East-Indiana", start: 6172407, end: 6174089 }, { filename: "/pglite/share/postgresql/timezone/US/Eastern", start: 6174089, end: 6177641 }, { filename: "/pglite/share/postgresql/timezone/US/Hawaii", start: 6177641, end: 6177970 }, { filename: "/pglite/share/postgresql/timezone/US/Indiana-Starke", start: 6177970, end: 6180414 }, { filename: "/pglite/share/postgresql/timezone/US/Michigan", start: 6180414, end: 6182644 }, { filename: "/pglite/share/postgresql/timezone/US/Mountain", start: 6182644, end: 6185104 }, { filename: "/pglite/share/postgresql/timezone/US/Pacific", start: 6185104, end: 6187956 }, { filename: "/pglite/share/postgresql/timezone/US/Samoa", start: 6187956, end: 6188131 }, { filename: "/pglite/share/postgresql/timezone/UTC", start: 6188131, end: 6188245 }, { filename: "/pglite/share/postgresql/timezone/Universal", start: 6188245, end: 6188359 }, { filename: "/pglite/share/postgresql/timezone/W-SU", start: 6188359, end: 6189894 }, { filename: "/pglite/share/postgresql/timezone/WET", start: 6189894, end: 6193421 }, { filename: "/pglite/share/postgresql/timezone/Zulu", start: 6193421, end: 6193535 }, { filename: "/pglite/share/postgresql/timezonesets/Africa.txt", start: 6193535, end: 6200508 }, { filename: "/pglite/share/postgresql/timezonesets/America.txt", start: 6200508, end: 6211515 }, { filename: "/pglite/share/postgresql/timezonesets/Antarctica.txt", start: 6211515, end: 6212649 }, { filename: "/pglite/share/postgresql/timezonesets/Asia.txt", start: 6212649, end: 6220960 }, { filename: "/pglite/share/postgresql/timezonesets/Atlantic.txt", start: 6220960, end: 6224493 }, { filename: "/pglite/share/postgresql/timezonesets/Australia", start: 6224493, end: 6225628 }, { filename: "/pglite/share/postgresql/timezonesets/Australia.txt", start: 6225628, end: 6229012 }, { filename: "/pglite/share/postgresql/timezonesets/Default", start: 6229012, end: 6256226 }, { filename: "/pglite/share/postgresql/timezonesets/Etc.txt", start: 6256226, end: 6257476 }, { filename: "/pglite/share/postgresql/timezonesets/Europe.txt", start: 6257476, end: 6266222 }, { filename: "/pglite/share/postgresql/timezonesets/India", start: 6266222, end: 6266815 }, { filename: "/pglite/share/postgresql/timezonesets/Indian.txt", start: 6266815, end: 6268076 }, { filename: "/pglite/share/postgresql/timezonesets/Pacific.txt", start: 6268076, end: 6271844 }, { filename: "/pglite/share/postgresql/tsearch_data/danish.stop", start: 6271844, end: 6272268 }, { filename: "/pglite/share/postgresql/tsearch_data/dutch.stop", start: 6272268, end: 6272721 }, { filename: "/pglite/share/postgresql/tsearch_data/english.stop", start: 6272721, end: 6273343 }, { filename: "/pglite/share/postgresql/tsearch_data/finnish.stop", start: 6273343, end: 6274922 }, { filename: "/pglite/share/postgresql/tsearch_data/french.stop", start: 6274922, end: 6275727 }, { filename: "/pglite/share/postgresql/tsearch_data/german.stop", start: 6275727, end: 6277076 }, { filename: "/pglite/share/postgresql/tsearch_data/hungarian.stop", start: 6277076, end: 6278303 }, { filename: "/pglite/share/postgresql/tsearch_data/hunspell_sample.affix", start: 6278303, end: 6278546 }, { filename: "/pglite/share/postgresql/tsearch_data/hunspell_sample_long.affix", start: 6278546, end: 6279179 }, { filename: "/pglite/share/postgresql/tsearch_data/hunspell_sample_long.dict", start: 6279179, end: 6279277 }, { filename: "/pglite/share/postgresql/tsearch_data/hunspell_sample_num.affix", start: 6279277, end: 6279739 }, { filename: "/pglite/share/postgresql/tsearch_data/hunspell_sample_num.dict", start: 6279739, end: 6279868 }, { filename: "/pglite/share/postgresql/tsearch_data/ispell_sample.affix", start: 6279868, end: 6280333 }, { filename: "/pglite/share/postgresql/tsearch_data/ispell_sample.dict", start: 6280333, end: 6280414 }, { filename: "/pglite/share/postgresql/tsearch_data/italian.stop", start: 6280414, end: 6282068 }, { filename: "/pglite/share/postgresql/tsearch_data/nepali.stop", start: 6282068, end: 6286329 }, { filename: "/pglite/share/postgresql/tsearch_data/norwegian.stop", start: 6286329, end: 6287180 }, { filename: "/pglite/share/postgresql/tsearch_data/portuguese.stop", start: 6287180, end: 6288447 }, { filename: "/pglite/share/postgresql/tsearch_data/russian.stop", start: 6288447, end: 6289682 }, { filename: "/pglite/share/postgresql/tsearch_data/spanish.stop", start: 6289682, end: 6291860 }, { filename: "/pglite/share/postgresql/tsearch_data/swedish.stop", start: 6291860, end: 6292419 }, { filename: "/pglite/share/postgresql/tsearch_data/synonym_sample.syn", start: 6292419, end: 6292492 }, { filename: "/pglite/share/postgresql/tsearch_data/thesaurus_sample.ths", start: 6292492, end: 6292965 }, { filename: "/pglite/share/postgresql/tsearch_data/turkish.stop", start: 6292965, end: 6293225 }], remote_package_size: 6293225 });
        })();
        var moduleOverrides = Object.assign({}, Module), arguments_ = [], thisProgram = "./this.program", quit_ = (e, t3) => {
          throw t3;
        }, scriptDirectory = "";
        function locateFile(e) {
          return Module.locateFile ? Module.locateFile(e, scriptDirectory) : scriptDirectory + e;
        }
        var readAsync, readBinary;
        if (ENVIRONMENT_IS_NODE) {
          var fs = require("fs"), nodePath = require("path");
          import.meta.url.startsWith("data:") || (scriptDirectory = nodePath.dirname(require("url").fileURLToPath(import.meta.url)) + "/"), readBinary = (e) => {
            e = isFileURI(e) ? new URL(e) : e;
            var t3 = fs.readFileSync(e);
            return t3;
          }, readAsync = async (e, t3 = true) => {
            e = isFileURI(e) ? new URL(e) : e;
            var r = fs.readFileSync(e, t3 ? void 0 : "utf8");
            return r;
          }, !Module.thisProgram && process.argv.length > 1 && (thisProgram = process.argv[1].replace(/\\/g, "/")), arguments_ = process.argv.slice(2), quit_ = (e, t3) => {
            throw process.exitCode = e, t3;
          };
        } else (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && (ENVIRONMENT_IS_WORKER ? scriptDirectory = self.location.href : typeof document < "u" && document.currentScript && (scriptDirectory = document.currentScript.src), _scriptName && (scriptDirectory = _scriptName), scriptDirectory.startsWith("blob:") ? scriptDirectory = "" : scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1), ENVIRONMENT_IS_WORKER && (readBinary = (e) => {
          var t3 = new XMLHttpRequest();
          return t3.open("GET", e, false), t3.responseType = "arraybuffer", t3.send(null), new Uint8Array(t3.response);
        }), readAsync = async (e) => {
          var t3 = await fetch(e, { credentials: "same-origin" });
          if (t3.ok) return t3.arrayBuffer();
          throw new Error(t3.status + " : " + t3.url);
        });
        var out = Module.print || console.log.bind(console), err = Module.printErr || console.error.bind(console);
        Object.assign(Module, moduleOverrides), moduleOverrides = null, Module.arguments && (arguments_ = Module.arguments), Module.thisProgram && (thisProgram = Module.thisProgram);
        var dynamicLibraries = Module.dynamicLibraries || [], wasmBinary = Module.wasmBinary;
        function intArrayFromBase64(e) {
          if (typeof ENVIRONMENT_IS_NODE < "u" && ENVIRONMENT_IS_NODE) {
            var t3 = Buffer.from(e, "base64");
            return new Uint8Array(t3.buffer, t3.byteOffset, t3.length);
          }
          for (var r = atob(e), a3 = new Uint8Array(r.length), o5 = 0; o5 < r.length; ++o5) a3[o5] = r.charCodeAt(o5);
          return a3;
        }
        var wasmMemory, ABORT = false, EXITSTATUS;
        function assert(e, t3) {
          e || abort(t3);
        }
        var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAP64, HEAPU64, HEAPF64;
        function updateMemoryViews() {
          var e = wasmMemory.buffer;
          Module.HEAP8 = HEAP8 = new Int8Array(e), Module.HEAP16 = HEAP16 = new Int16Array(e), Module.HEAPU8 = HEAPU8 = new Uint8Array(e), Module.HEAPU16 = HEAPU16 = new Uint16Array(e), Module.HEAP32 = HEAP32 = new Int32Array(e), Module.HEAPU32 = HEAPU32 = new Uint32Array(e), Module.HEAPF32 = HEAPF32 = new Float32Array(e), Module.HEAPF64 = HEAPF64 = new Float64Array(e), Module.HEAP64 = HEAP64 = new BigInt64Array(e), Module.HEAPU64 = HEAPU64 = new BigUint64Array(e);
        }
        if (Module.wasmMemory) wasmMemory = Module.wasmMemory;
        else {
          var INITIAL_MEMORY = Module.INITIAL_MEMORY || 134217728;
          wasmMemory = new WebAssembly.Memory({ initial: INITIAL_MEMORY / 65536, maximum: 32768 });
        }
        updateMemoryViews();
        var __ATPRERUN__ = [], __ATINIT__ = [], __ATMAIN__ = [], __ATEXIT__ = [], __ATPOSTRUN__ = [], __RELOC_FUNCS__ = [], runtimeInitialized = false, runtimeExited = false;
        function preRun() {
          if (Module.preRun) for (typeof Module.preRun == "function" && (Module.preRun = [Module.preRun]); Module.preRun.length; ) addOnPreRun(Module.preRun.shift());
          callRuntimeCallbacks(__ATPRERUN__);
        }
        function initRuntime() {
          runtimeInitialized = true, callRuntimeCallbacks(__RELOC_FUNCS__), !Module.noFSInit && !FS.initialized && FS.init(), FS.ignorePermissions = false, TTY.init(), SOCKFS.root = FS.mount(SOCKFS, {}, null), PIPEFS.root = FS.mount(PIPEFS, {}, null), callRuntimeCallbacks(__ATINIT__);
        }
        function preMain() {
          callRuntimeCallbacks(__ATMAIN__);
        }
        function exitRuntime() {
          ___funcs_on_exit(), callRuntimeCallbacks(__ATEXIT__), FS.quit(), TTY.shutdown(), IDBFS.quit(), runtimeExited = true;
        }
        function postRun() {
          if (Module.postRun) for (typeof Module.postRun == "function" && (Module.postRun = [Module.postRun]); Module.postRun.length; ) addOnPostRun(Module.postRun.shift());
          callRuntimeCallbacks(__ATPOSTRUN__);
        }
        function addOnPreRun(e) {
          __ATPRERUN__.unshift(e);
        }
        function addOnInit(e) {
          __ATINIT__.unshift(e);
        }
        function addOnPostRun(e) {
          __ATPOSTRUN__.unshift(e);
        }
        var runDependencies = 0, dependenciesFulfilled = null;
        function getUniqueRunDependency(e) {
          return e;
        }
        function addRunDependency(e) {
          runDependencies++, Module.monitorRunDependencies?.(runDependencies);
        }
        function removeRunDependency(e) {
          if (runDependencies--, Module.monitorRunDependencies?.(runDependencies), runDependencies == 0 && dependenciesFulfilled) {
            var t3 = dependenciesFulfilled;
            dependenciesFulfilled = null, t3();
          }
        }
        function abort(e) {
          Module.onAbort?.(e), e = "Aborted(" + e + ")", err(e), ABORT = true, e += ". Build with -sASSERTIONS for more info.";
          var t3 = new WebAssembly.RuntimeError(e);
          throw readyPromiseReject(t3), t3;
        }
        var dataURIPrefix = "data:application/octet-stream;base64,", isDataURI = (e) => e.startsWith(dataURIPrefix), isFileURI = (e) => e.startsWith("file://");
        function findWasmBinary() {
          if (Module.locateFile) {
            var e = "pglite.wasm";
            return isDataURI(e) ? e : locateFile(e);
          }
          return new URL("pglite.wasm", import.meta.url).href;
        }
        var wasmBinaryFile;
        function getBinarySync(e) {
          if (e == wasmBinaryFile && wasmBinary) return new Uint8Array(wasmBinary);
          if (readBinary) return readBinary(e);
          throw "both async and sync fetching of the wasm failed";
        }
        async function getWasmBinary(e) {
          if (!wasmBinary) try {
            var t3 = await readAsync(e);
            return new Uint8Array(t3);
          } catch {
          }
          return getBinarySync(e);
        }
        async function instantiateArrayBuffer(e, t3) {
          try {
            var r = await getWasmBinary(e), a3 = await WebAssembly.instantiate(r, t3);
            return a3;
          } catch (o5) {
            err(`failed to asynchronously prepare wasm: ${o5}`), abort(o5);
          }
        }
        async function instantiateAsync(e, t3, r) {
          if (!e && typeof WebAssembly.instantiateStreaming == "function" && !isDataURI(t3) && !ENVIRONMENT_IS_NODE && typeof fetch == "function") try {
            var a3 = fetch(t3, { credentials: "same-origin" }), o5 = await WebAssembly.instantiateStreaming(a3, r);
            return o5;
          } catch (_4) {
            err(`wasm streaming compile failed: ${_4}`), err("falling back to ArrayBuffer instantiation");
          }
          return instantiateArrayBuffer(t3, r);
        }
        function getWasmImports() {
          return { env: wasmImports, wasi_snapshot_preview1: wasmImports, "GOT.mem": new Proxy(wasmImports, GOTHandler), "GOT.func": new Proxy(wasmImports, GOTHandler) };
        }
        async function createWasm() {
          function e(o5, _4) {
            wasmExports = o5.exports, wasmExports = relocateExports(wasmExports, 1024);
            var s5 = getDylinkMetadata(_4);
            return s5.neededDynlibs && (dynamicLibraries = s5.neededDynlibs.concat(dynamicLibraries)), mergeLibSymbols(wasmExports, "main"), LDSO.init(), loadDylibs(), addOnInit(wasmExports.__wasm_call_ctors), __RELOC_FUNCS__.push(wasmExports.__wasm_apply_data_relocs), removeRunDependency("wasm-instantiate"), wasmExports;
          }
          addRunDependency("wasm-instantiate");
          function t3(o5) {
            e(o5.instance, o5.module);
          }
          var r = getWasmImports();
          if (Module.instantiateWasm) try {
            return Module.instantiateWasm(r, e);
          } catch (o5) {
            err(`Module.instantiateWasm callback failed with error: ${o5}`), readyPromiseReject(o5);
          }
          wasmBinaryFile ?? (wasmBinaryFile = findWasmBinary());
          try {
            var a3 = await instantiateAsync(wasmBinary, wasmBinaryFile, r);
            return t3(a3), a3;
          } catch (o5) {
            readyPromiseReject(o5);
            return;
          }
        }
        var ASM_CONSTS = {};
        class ExitStatus {
          constructor(t3) {
            P(this, "name", "ExitStatus");
            this.message = `Program terminated with exit(${t3})`, this.status = t3;
          }
        }
        var GOT = {}, currentModuleWeakSymbols = /* @__PURE__ */ new Set([]), GOTHandler = { get(e, t3) {
          var r = GOT[t3];
          return r || (r = GOT[t3] = new WebAssembly.Global({ value: "i32", mutable: true })), currentModuleWeakSymbols.has(t3) || (r.required = true), r;
        } }, callRuntimeCallbacks = (e) => {
          for (; e.length > 0; ) e.shift()(Module);
        }, UTF8Decoder = typeof TextDecoder < "u" ? new TextDecoder() : void 0, UTF8ArrayToString = (e, t3 = 0, r = NaN) => {
          for (var a3 = t3 + r, o5 = t3; e[o5] && !(o5 >= a3); ) ++o5;
          if (o5 - t3 > 16 && e.buffer && UTF8Decoder) return UTF8Decoder.decode(e.subarray(t3, o5));
          for (var _4 = ""; t3 < o5; ) {
            var s5 = e[t3++];
            if (!(s5 & 128)) {
              _4 += String.fromCharCode(s5);
              continue;
            }
            var n3 = e[t3++] & 63;
            if ((s5 & 224) == 192) {
              _4 += String.fromCharCode((s5 & 31) << 6 | n3);
              continue;
            }
            var l2 = e[t3++] & 63;
            if ((s5 & 240) == 224 ? s5 = (s5 & 15) << 12 | n3 << 6 | l2 : s5 = (s5 & 7) << 18 | n3 << 12 | l2 << 6 | e[t3++] & 63, s5 < 65536) _4 += String.fromCharCode(s5);
            else {
              var d3 = s5 - 65536;
              _4 += String.fromCharCode(55296 | d3 >> 10, 56320 | d3 & 1023);
            }
          }
          return _4;
        }, getDylinkMetadata = (e) => {
          var t3 = 0, r = 0;
          function a3() {
            return e[t3++];
          }
          function o5() {
            for (var I3 = 0, G4 = 1; ; ) {
              var q2 = e[t3++];
              if (I3 += (q2 & 127) * G4, G4 *= 128, !(q2 & 128)) break;
            }
            return I3;
          }
          function _4() {
            var I3 = o5();
            return t3 += I3, UTF8ArrayToString(e, t3 - I3, I3);
          }
          function s5(I3, G4) {
            if (I3) throw new Error(G4);
          }
          var n3 = "dylink.0";
          if (e instanceof WebAssembly.Module) {
            var l2 = WebAssembly.Module.customSections(e, n3);
            l2.length === 0 && (n3 = "dylink", l2 = WebAssembly.Module.customSections(e, n3)), s5(l2.length === 0, "need dylink section"), e = new Uint8Array(l2[0]), r = e.length;
          } else {
            var d3 = new Uint32Array(new Uint8Array(e.subarray(0, 24)).buffer), u3 = d3[0] == 1836278016;
            s5(!u3, "need to see wasm magic number"), s5(e[8] !== 0, "need the dylink section to be first"), t3 = 9;
            var c4 = o5();
            r = t3 + c4, n3 = _4();
          }
          var f5 = { neededDynlibs: [], tlsExports: /* @__PURE__ */ new Set(), weakImports: /* @__PURE__ */ new Set() };
          if (n3 == "dylink") {
            f5.memorySize = o5(), f5.memoryAlign = o5(), f5.tableSize = o5(), f5.tableAlign = o5();
            for (var g4 = o5(), m5 = 0; m5 < g4; ++m5) {
              var p6 = _4();
              f5.neededDynlibs.push(p6);
            }
          } else {
            s5(n3 !== "dylink.0");
            for (var h3 = 1, x4 = 2, b4 = 3, M3 = 4, y5 = 256, E3 = 3, F4 = 1; t3 < r; ) {
              var k3 = a3(), R3 = o5();
              if (k3 === h3) f5.memorySize = o5(), f5.memoryAlign = o5(), f5.tableSize = o5(), f5.tableAlign = o5();
              else if (k3 === x4) for (var g4 = o5(), m5 = 0; m5 < g4; ++m5) p6 = _4(), f5.neededDynlibs.push(p6);
              else if (k3 === b4) for (var D5 = o5(); D5--; ) {
                var te = _4(), H3 = o5();
                H3 & y5 && f5.tlsExports.add(te);
              }
              else if (k3 === M3) for (var D5 = o5(); D5--; ) {
                var X2 = _4(), te = _4(), H3 = o5();
                (H3 & E3) == F4 && f5.weakImports.add(te);
              }
              else t3 += R3;
            }
          }
          return f5;
        };
        function getValue(e, t3 = "i8") {
          switch (t3.endsWith("*") && (t3 = "*"), t3) {
            case "i1":
              return HEAP8[e];
            case "i8":
              return HEAP8[e];
            case "i16":
              return HEAP16[e >> 1];
            case "i32":
              return HEAP32[e >> 2];
            case "i64":
              return HEAP64[e >> 3];
            case "float":
              return HEAPF32[e >> 2];
            case "double":
              return HEAPF64[e >> 3];
            case "*":
              return HEAPU32[e >> 2];
            default:
              abort(`invalid type for getValue: ${t3}`);
          }
        }
        var newDSO = (e, t3, r) => {
          var a3 = { refcount: 1 / 0, name: e, exports: r, global: true };
          return LDSO.loadedLibsByName[e] = a3, t3 != null && (LDSO.loadedLibsByHandle[t3] = a3), a3;
        }, LDSO = { loadedLibsByName: {}, loadedLibsByHandle: {}, init() {
          newDSO("__main__", 0, wasmImports);
        } }, ___heap_base = 11373728, alignMemory = (e, t3) => Math.ceil(e / t3) * t3, getMemory = (e) => {
          if (runtimeInitialized) return _calloc(e, 1);
          var t3 = ___heap_base, r = t3 + alignMemory(e, 16);
          return ___heap_base = r, GOT.__heap_base.value = r, t3;
        }, isInternalSym = (e) => ["__cpp_exception", "__c_longjmp", "__wasm_apply_data_relocs", "__dso_handle", "__tls_size", "__tls_align", "__set_stack_limits", "_emscripten_tls_init", "__wasm_init_tls", "__wasm_call_ctors", "__start_em_asm", "__stop_em_asm", "__start_em_js", "__stop_em_js"].includes(e) || e.startsWith("__em_js__"), uleb128Encode = (e, t3) => {
          e < 128 ? t3.push(e) : t3.push(e % 128 | 128, e >> 7);
        }, sigToWasmTypes = (e) => {
          for (var t3 = { i: "i32", j: "i64", f: "f32", d: "f64", e: "externref", p: "i32" }, r = { parameters: [], results: e[0] == "v" ? [] : [t3[e[0]]] }, a3 = 1; a3 < e.length; ++a3) r.parameters.push(t3[e[a3]]);
          return r;
        }, generateFuncType = (e, t3) => {
          var r = e.slice(0, 1), a3 = e.slice(1), o5 = { i: 127, p: 127, j: 126, f: 125, d: 124, e: 111 };
          t3.push(96), uleb128Encode(a3.length, t3);
          for (var _4 = 0; _4 < a3.length; ++_4) t3.push(o5[a3[_4]]);
          r == "v" ? t3.push(0) : t3.push(1, o5[r]);
        }, convertJsFunctionToWasm = (e, t3) => {
          if (typeof WebAssembly.Function == "function") return new WebAssembly.Function(sigToWasmTypes(t3), e);
          var r = [1];
          generateFuncType(t3, r);
          var a3 = [0, 97, 115, 109, 1, 0, 0, 0, 1];
          uleb128Encode(r.length, a3), a3.push(...r), a3.push(2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0);
          var o5 = new WebAssembly.Module(new Uint8Array(a3)), _4 = new WebAssembly.Instance(o5, { e: { f: e } }), s5 = _4.exports.f;
          return s5;
        }, wasmTableMirror = [], wasmTable = new WebAssembly.Table({ initial: 7367, element: "anyfunc" }), getWasmTableEntry = (e) => {
          var t3 = wasmTableMirror[e];
          return t3 || (e >= wasmTableMirror.length && (wasmTableMirror.length = e + 1), wasmTableMirror[e] = t3 = wasmTable.get(e)), t3;
        }, updateTableMap = (e, t3) => {
          if (functionsInTableMap) for (var r = e; r < e + t3; r++) {
            var a3 = getWasmTableEntry(r);
            a3 && functionsInTableMap.set(a3, r);
          }
        }, functionsInTableMap, getFunctionAddress = (e) => (functionsInTableMap || (functionsInTableMap = /* @__PURE__ */ new WeakMap(), updateTableMap(0, wasmTable.length)), functionsInTableMap.get(e) || 0), freeTableIndexes = [], getEmptyTableSlot = () => {
          if (freeTableIndexes.length) return freeTableIndexes.pop();
          try {
            wasmTable.grow(1);
          } catch (e) {
            throw e instanceof RangeError ? "Unable to grow wasm table. Set ALLOW_TABLE_GROWTH." : e;
          }
          return wasmTable.length - 1;
        }, setWasmTableEntry = (e, t3) => {
          wasmTable.set(e, t3), wasmTableMirror[e] = wasmTable.get(e);
        }, addFunction = (e, t3) => {
          var r = getFunctionAddress(e);
          if (r) return r;
          var a3 = getEmptyTableSlot();
          try {
            setWasmTableEntry(a3, e);
          } catch (_4) {
            if (!(_4 instanceof TypeError)) throw _4;
            var o5 = convertJsFunctionToWasm(e, t3);
            setWasmTableEntry(a3, o5);
          }
          return functionsInTableMap.set(e, a3), a3;
        }, updateGOT = (e, t3) => {
          for (var r in e) if (!isInternalSym(r)) {
            var a3 = e[r];
            GOT[r] || (GOT[r] = new WebAssembly.Global({ value: "i32", mutable: true })), (t3 || GOT[r].value == 0) && (typeof a3 == "function" ? GOT[r].value = addFunction(a3) : typeof a3 == "number" ? GOT[r].value = a3 : err(`unhandled export type for '${r}': ${typeof a3}`));
          }
        }, relocateExports = (e, t3, r) => {
          var a3 = {};
          for (var o5 in e) {
            var _4 = e[o5];
            typeof _4 == "object" && (_4 = _4.value), typeof _4 == "number" && (_4 += t3), a3[o5] = _4;
          }
          return updateGOT(a3, r), a3;
        }, isSymbolDefined = (e) => {
          var t3 = wasmImports[e];
          return !(!t3 || t3.stub);
        }, dynCall = (e, t3, r = []) => {
          var a3 = getWasmTableEntry(t3)(...r);
          return a3;
        }, stackSave = () => _emscripten_stack_get_current(), stackRestore = (e) => __emscripten_stack_restore(e), createInvokeFunction = (e) => (t3, ...r) => {
          var a3 = stackSave();
          try {
            return dynCall(e, t3, r);
          } catch (o5) {
            if (stackRestore(a3), o5 !== o5 + 0) throw o5;
            if (_setThrew(1, 0), e[0] == "j") return 0n;
          }
        }, resolveGlobalSymbol = (e, t3 = false) => {
          var r;
          return isSymbolDefined(e) ? r = wasmImports[e] : e.startsWith("invoke_") && (r = wasmImports[e] = createInvokeFunction(e.split("_")[1])), { sym: r, name: e };
        }, UTF8ToString = (e, t3) => e ? UTF8ArrayToString(HEAPU8, e, t3) : "", loadWebAssemblyModule = (binary, flags, libName, localScope, handle) => {
          var metadata = getDylinkMetadata(binary);
          currentModuleWeakSymbols = metadata.weakImports;
          function loadModule() {
            var firstLoad = !handle || !HEAP8[handle + 8];
            if (firstLoad) {
              var memAlign = Math.pow(2, metadata.memoryAlign), memoryBase = metadata.memorySize ? alignMemory(getMemory(metadata.memorySize + memAlign), memAlign) : 0, tableBase = metadata.tableSize ? wasmTable.length : 0;
              handle && (HEAP8[handle + 8] = 1, HEAPU32[handle + 12 >> 2] = memoryBase, HEAP32[handle + 16 >> 2] = metadata.memorySize, HEAPU32[handle + 20 >> 2] = tableBase, HEAP32[handle + 24 >> 2] = metadata.tableSize);
            } else memoryBase = HEAPU32[handle + 12 >> 2], tableBase = HEAPU32[handle + 20 >> 2];
            var tableGrowthNeeded = tableBase + metadata.tableSize - wasmTable.length;
            tableGrowthNeeded > 0 && wasmTable.grow(tableGrowthNeeded);
            var moduleExports;
            function resolveSymbol(e) {
              var t3 = resolveGlobalSymbol(e).sym;
              return !t3 && localScope && (t3 = localScope[e]), t3 || (t3 = moduleExports[e]), t3;
            }
            var proxyHandler = { get(e, t3) {
              switch (t3) {
                case "__memory_base":
                  return memoryBase;
                case "__table_base":
                  return tableBase;
              }
              if (t3 in wasmImports && !wasmImports[t3].stub) return wasmImports[t3];
              if (!(t3 in e)) {
                var r;
                e[t3] = (...a3) => (r || (r = resolveSymbol(t3)), r(...a3));
              }
              return e[t3];
            } }, proxy = new Proxy({}, proxyHandler), info = { "GOT.mem": new Proxy({}, GOTHandler), "GOT.func": new Proxy({}, GOTHandler), env: proxy, wasi_snapshot_preview1: proxy };
            function postInstantiation(module, instance) {
              updateTableMap(tableBase, metadata.tableSize), moduleExports = relocateExports(instance.exports, memoryBase), flags.allowUndefined || reportUndefinedSymbols();
              function addEmAsm(addr, body) {
                for (var args = [], arity = 0; arity < 16 && body.indexOf("$" + arity) != -1; arity++) args.push("$" + arity);
                args = args.join(",");
                var func = `(${args}) => { ${body} };`;
                ASM_CONSTS[start] = eval(func);
              }
              if ("__start_em_asm" in moduleExports) for (var start = moduleExports.__start_em_asm, stop = moduleExports.__stop_em_asm; start < stop; ) {
                var jsString = UTF8ToString(start);
                addEmAsm(start, jsString), start = HEAPU8.indexOf(0, start) + 1;
              }
              function addEmJs(name, cSig, body) {
                var jsArgs = [];
                if (cSig = cSig.slice(1, -1), cSig != "void") {
                  cSig = cSig.split(",");
                  for (var i in cSig) {
                    var jsArg = cSig[i].split(" ").pop();
                    jsArgs.push(jsArg.replace("*", ""));
                  }
                }
                var func = `(${jsArgs}) => ${body};`;
                moduleExports[name] = eval(func);
              }
              for (var name in moduleExports) if (name.startsWith("__em_js__")) {
                var start = moduleExports[name], jsString = UTF8ToString(start), parts = jsString.split("<::>");
                addEmJs(name.replace("__em_js__", ""), parts[0], parts[1]), delete moduleExports[name];
              }
              var applyRelocs = moduleExports.__wasm_apply_data_relocs;
              applyRelocs && (runtimeInitialized ? applyRelocs() : __RELOC_FUNCS__.push(applyRelocs));
              var init = moduleExports.__wasm_call_ctors;
              return init && (runtimeInitialized ? init() : __ATINIT__.push(init)), moduleExports;
            }
            if (flags.loadAsync) {
              if (binary instanceof WebAssembly.Module) {
                var instance = new WebAssembly.Instance(binary, info);
                return Promise.resolve(postInstantiation(binary, instance));
              }
              return WebAssembly.instantiate(binary, info).then((e) => postInstantiation(e.module, e.instance));
            }
            var module = binary instanceof WebAssembly.Module ? binary : new WebAssembly.Module(binary), instance = new WebAssembly.Instance(module, info);
            return postInstantiation(module, instance);
          }
          return flags.loadAsync ? metadata.neededDynlibs.reduce((e, t3) => e.then(() => loadDynamicLibrary(t3, flags, localScope)), Promise.resolve()).then(loadModule) : (metadata.neededDynlibs.forEach((e) => loadDynamicLibrary(e, flags, localScope)), loadModule());
        }, mergeLibSymbols = (e, t3) => {
          for (var [r, a3] of Object.entries(e)) {
            let o5 = (s5) => {
              isSymbolDefined(s5) || (wasmImports[s5] = a3);
            };
            o5(r);
            let _4 = "__main_argc_argv";
            r == "main" && o5(_4), r == _4 && o5("main");
          }
        }, asyncLoad = async (e) => {
          var t3 = await readAsync(e);
          return new Uint8Array(t3);
        }, preloadPlugins = Module.preloadPlugins || [], registerWasmPlugin = () => {
          var e = { promiseChainEnd: Promise.resolve(), canHandle: (t3) => !Module.noWasmDecoding && t3.endsWith(".so"), handle: (t3, r, a3, o5) => {
            e.promiseChainEnd = e.promiseChainEnd.then(() => loadWebAssemblyModule(t3, { loadAsync: true, nodelete: true }, r, {})).then((_4) => {
              preloadedWasm[r] = _4, a3(t3);
            }, (_4) => {
              err(`failed to instantiate wasm: ${r}: ${_4}`), o5();
            });
          } };
          preloadPlugins.push(e);
        }, preloadedWasm = {};
        function loadDynamicLibrary(e, t3 = { global: true, nodelete: true }, r, a3) {
          var o5 = LDSO.loadedLibsByName[e];
          if (o5) return t3.global ? o5.global || (o5.global = true, mergeLibSymbols(o5.exports, e)) : r && Object.assign(r, o5.exports), t3.nodelete && o5.refcount !== 1 / 0 && (o5.refcount = 1 / 0), o5.refcount++, a3 && (LDSO.loadedLibsByHandle[a3] = o5), t3.loadAsync ? Promise.resolve(true) : true;
          o5 = newDSO(e, a3, "loading"), o5.refcount = t3.nodelete ? 1 / 0 : 1, o5.global = t3.global;
          function _4() {
            if (a3) {
              var l2 = HEAPU32[a3 + 28 >> 2], d3 = HEAPU32[a3 + 32 >> 2];
              if (l2 && d3) {
                var u3 = HEAP8.slice(l2, l2 + d3);
                return t3.loadAsync ? Promise.resolve(u3) : u3;
              }
            }
            var c4 = locateFile(e);
            if (t3.loadAsync) return asyncLoad(c4);
            if (!readBinary) throw new Error(`${c4}: file not found, and synchronous loading of external files is not available`);
            return readBinary(c4);
          }
          function s5() {
            var l2 = preloadedWasm[e];
            return l2 ? t3.loadAsync ? Promise.resolve(l2) : l2 : t3.loadAsync ? _4().then((d3) => loadWebAssemblyModule(d3, t3, e, r, a3)) : loadWebAssemblyModule(_4(), t3, e, r, a3);
          }
          function n3(l2) {
            o5.global ? mergeLibSymbols(l2, e) : r && Object.assign(r, l2), o5.exports = l2;
          }
          return t3.loadAsync ? s5().then((l2) => (n3(l2), true)) : (n3(s5()), true);
        }
        var reportUndefinedSymbols = () => {
          for (var [e, t3] of Object.entries(GOT)) if (t3.value == 0) {
            var r = resolveGlobalSymbol(e, true).sym;
            if (!r && !t3.required) continue;
            if (typeof r == "function") t3.value = addFunction(r, r.sig);
            else if (typeof r == "number") t3.value = r;
            else throw new Error(`bad export type for '${e}': ${typeof r}`);
          }
        }, loadDylibs = () => {
          if (!dynamicLibraries.length) {
            reportUndefinedSymbols();
            return;
          }
          addRunDependency("loadDylibs"), dynamicLibraries.reduce((e, t3) => e.then(() => loadDynamicLibrary(t3, { loadAsync: true, global: true, nodelete: true, allowUndefined: true })), Promise.resolve()).then(() => {
            reportUndefinedSymbols(), removeRunDependency("loadDylibs");
          });
        }, noExitRuntime = Module.noExitRuntime || false;
        function setValue(e, t3, r = "i8") {
          switch (r.endsWith("*") && (r = "*"), r) {
            case "i1":
              HEAP8[e] = t3;
              break;
            case "i8":
              HEAP8[e] = t3;
              break;
            case "i16":
              HEAP16[e >> 1] = t3;
              break;
            case "i32":
              HEAP32[e >> 2] = t3;
              break;
            case "i64":
              HEAP64[e >> 3] = BigInt(t3);
              break;
            case "float":
              HEAPF32[e >> 2] = t3;
              break;
            case "double":
              HEAPF64[e >> 3] = t3;
              break;
            case "*":
              HEAPU32[e >> 2] = t3;
              break;
            default:
              abort(`invalid type for setValue: ${r}`);
          }
        }
        var ___assert_fail = (e, t3, r, a3) => abort(`Assertion failed: ${UTF8ToString(e)}, at: ` + [t3 ? UTF8ToString(t3) : "unknown filename", r, a3 ? UTF8ToString(a3) : "unknown function"]);
        ___assert_fail.sig = "vppip";
        var ___call_sighandler = (e, t3) => getWasmTableEntry(e)(t3);
        ___call_sighandler.sig = "vpi";
        var ___memory_base = new WebAssembly.Global({ value: "i32", mutable: false }, 1024);
        Module.___memory_base = ___memory_base;
        var ___stack_pointer = new WebAssembly.Global({ value: "i32", mutable: true }, 11373728);
        Module.___stack_pointer = ___stack_pointer;
        var PATH = { isAbs: (e) => e.charAt(0) === "/", splitPath: (e) => {
          var t3 = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
          return t3.exec(e).slice(1);
        }, normalizeArray: (e, t3) => {
          for (var r = 0, a3 = e.length - 1; a3 >= 0; a3--) {
            var o5 = e[a3];
            o5 === "." ? e.splice(a3, 1) : o5 === ".." ? (e.splice(a3, 1), r++) : r && (e.splice(a3, 1), r--);
          }
          if (t3) for (; r; r--) e.unshift("..");
          return e;
        }, normalize: (e) => {
          var t3 = PATH.isAbs(e), r = e.substr(-1) === "/";
          return e = PATH.normalizeArray(e.split("/").filter((a3) => !!a3), !t3).join("/"), !e && !t3 && (e = "."), e && r && (e += "/"), (t3 ? "/" : "") + e;
        }, dirname: (e) => {
          var t3 = PATH.splitPath(e), r = t3[0], a3 = t3[1];
          return !r && !a3 ? "." : (a3 && (a3 = a3.substr(0, a3.length - 1)), r + a3);
        }, basename: (e) => {
          if (e === "/") return "/";
          e = PATH.normalize(e), e = e.replace(/\/$/, "");
          var t3 = e.lastIndexOf("/");
          return t3 === -1 ? e : e.substr(t3 + 1);
        }, join: (...e) => PATH.normalize(e.join("/")), join2: (e, t3) => PATH.normalize(e + "/" + t3) }, initRandomFill = () => {
          if (typeof crypto == "object" && typeof crypto.getRandomValues == "function") return (a3) => crypto.getRandomValues(a3);
          if (ENVIRONMENT_IS_NODE) try {
            var e = require("crypto"), t3 = e.randomFillSync;
            if (t3) return (a3) => e.randomFillSync(a3);
            var r = e.randomBytes;
            return (a3) => (a3.set(r(a3.byteLength)), a3);
          } catch {
          }
          abort("initRandomDevice");
        }, randomFill = (e) => (randomFill = initRandomFill())(e), PATH_FS = { resolve: (...e) => {
          for (var t3 = "", r = false, a3 = e.length - 1; a3 >= -1 && !r; a3--) {
            var o5 = a3 >= 0 ? e[a3] : FS.cwd();
            if (typeof o5 != "string") throw new TypeError("Arguments to path.resolve must be strings");
            if (!o5) return "";
            t3 = o5 + "/" + t3, r = PATH.isAbs(o5);
          }
          return t3 = PATH.normalizeArray(t3.split("/").filter((_4) => !!_4), !r).join("/"), (r ? "/" : "") + t3 || ".";
        }, relative: (e, t3) => {
          e = PATH_FS.resolve(e).substr(1), t3 = PATH_FS.resolve(t3).substr(1);
          function r(d3) {
            for (var u3 = 0; u3 < d3.length && d3[u3] === ""; u3++) ;
            for (var c4 = d3.length - 1; c4 >= 0 && d3[c4] === ""; c4--) ;
            return u3 > c4 ? [] : d3.slice(u3, c4 - u3 + 1);
          }
          for (var a3 = r(e.split("/")), o5 = r(t3.split("/")), _4 = Math.min(a3.length, o5.length), s5 = _4, n3 = 0; n3 < _4; n3++) if (a3[n3] !== o5[n3]) {
            s5 = n3;
            break;
          }
          for (var l2 = [], n3 = s5; n3 < a3.length; n3++) l2.push("..");
          return l2 = l2.concat(o5.slice(s5)), l2.join("/");
        } }, FS_stdin_getChar_buffer = [], lengthBytesUTF8 = (e) => {
          for (var t3 = 0, r = 0; r < e.length; ++r) {
            var a3 = e.charCodeAt(r);
            a3 <= 127 ? t3++ : a3 <= 2047 ? t3 += 2 : a3 >= 55296 && a3 <= 57343 ? (t3 += 4, ++r) : t3 += 3;
          }
          return t3;
        }, stringToUTF8Array = (e, t3, r, a3) => {
          if (!(a3 > 0)) return 0;
          for (var o5 = r, _4 = r + a3 - 1, s5 = 0; s5 < e.length; ++s5) {
            var n3 = e.charCodeAt(s5);
            if (n3 >= 55296 && n3 <= 57343) {
              var l2 = e.charCodeAt(++s5);
              n3 = 65536 + ((n3 & 1023) << 10) | l2 & 1023;
            }
            if (n3 <= 127) {
              if (r >= _4) break;
              t3[r++] = n3;
            } else if (n3 <= 2047) {
              if (r + 1 >= _4) break;
              t3[r++] = 192 | n3 >> 6, t3[r++] = 128 | n3 & 63;
            } else if (n3 <= 65535) {
              if (r + 2 >= _4) break;
              t3[r++] = 224 | n3 >> 12, t3[r++] = 128 | n3 >> 6 & 63, t3[r++] = 128 | n3 & 63;
            } else {
              if (r + 3 >= _4) break;
              t3[r++] = 240 | n3 >> 18, t3[r++] = 128 | n3 >> 12 & 63, t3[r++] = 128 | n3 >> 6 & 63, t3[r++] = 128 | n3 & 63;
            }
          }
          return t3[r] = 0, r - o5;
        };
        function intArrayFromString(e, t3, r) {
          var a3 = r > 0 ? r : lengthBytesUTF8(e) + 1, o5 = new Array(a3), _4 = stringToUTF8Array(e, o5, 0, o5.length);
          return t3 && (o5.length = _4), o5;
        }
        var FS_stdin_getChar = () => {
          if (!FS_stdin_getChar_buffer.length) {
            var e = null;
            if (ENVIRONMENT_IS_NODE) {
              var t3 = 256, r = Buffer.alloc(t3), a3 = 0, o5 = process.stdin.fd;
              try {
                a3 = fs.readSync(o5, r, 0, t3);
              } catch (_4) {
                if (_4.toString().includes("EOF")) a3 = 0;
                else throw _4;
              }
              a3 > 0 && (e = r.slice(0, a3).toString("utf-8"));
            } else typeof window < "u" && typeof window.prompt == "function" && (e = window.prompt("Input: "), e !== null && (e += `
`));
            if (!e) return null;
            FS_stdin_getChar_buffer = intArrayFromString(e, true);
          }
          return FS_stdin_getChar_buffer.shift();
        }, TTY = { ttys: [], init() {
        }, shutdown() {
        }, register(e, t3) {
          TTY.ttys[e] = { input: [], output: [], ops: t3 }, FS.registerDevice(e, TTY.stream_ops);
        }, stream_ops: { open(e) {
          var t3 = TTY.ttys[e.node.rdev];
          if (!t3) throw new FS.ErrnoError(43);
          e.tty = t3, e.seekable = false;
        }, close(e) {
          e.tty.ops.fsync(e.tty);
        }, fsync(e) {
          e.tty.ops.fsync(e.tty);
        }, read(e, t3, r, a3, o5) {
          if (!e.tty || !e.tty.ops.get_char) throw new FS.ErrnoError(60);
          for (var _4 = 0, s5 = 0; s5 < a3; s5++) {
            var n3;
            try {
              n3 = e.tty.ops.get_char(e.tty);
            } catch {
              throw new FS.ErrnoError(29);
            }
            if (n3 === void 0 && _4 === 0) throw new FS.ErrnoError(6);
            if (n3 == null) break;
            _4++, t3[r + s5] = n3;
          }
          return _4 && (e.node.atime = Date.now()), _4;
        }, write(e, t3, r, a3, o5) {
          if (!e.tty || !e.tty.ops.put_char) throw new FS.ErrnoError(60);
          try {
            for (var _4 = 0; _4 < a3; _4++) e.tty.ops.put_char(e.tty, t3[r + _4]);
          } catch {
            throw new FS.ErrnoError(29);
          }
          return a3 && (e.node.mtime = e.node.ctime = Date.now()), _4;
        } }, default_tty_ops: { get_char(e) {
          return FS_stdin_getChar();
        }, put_char(e, t3) {
          t3 === null || t3 === 10 ? (out(UTF8ArrayToString(e.output)), e.output = []) : t3 != 0 && e.output.push(t3);
        }, fsync(e) {
          e.output && e.output.length > 0 && (out(UTF8ArrayToString(e.output)), e.output = []);
        }, ioctl_tcgets(e) {
          return { c_iflag: 25856, c_oflag: 5, c_cflag: 191, c_lflag: 35387, c_cc: [3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
        }, ioctl_tcsets(e, t3, r) {
          return 0;
        }, ioctl_tiocgwinsz(e) {
          return [24, 80];
        } }, default_tty1_ops: { put_char(e, t3) {
          t3 === null || t3 === 10 ? (err(UTF8ArrayToString(e.output)), e.output = []) : t3 != 0 && e.output.push(t3);
        }, fsync(e) {
          e.output && e.output.length > 0 && (err(UTF8ArrayToString(e.output)), e.output = []);
        } } }, zeroMemory = (e, t3) => {
          HEAPU8.fill(0, e, e + t3);
        }, mmapAlloc = (e) => {
          e = alignMemory(e, 65536);
          var t3 = _emscripten_builtin_memalign(65536, e);
          return t3 && zeroMemory(t3, e), t3;
        }, MEMFS = { ops_table: null, mount(e) {
          return MEMFS.createNode(null, "/", 16895, 0);
        }, createNode(e, t3, r, a3) {
          if (FS.isBlkdev(r) || FS.isFIFO(r)) throw new FS.ErrnoError(63);
          MEMFS.ops_table || (MEMFS.ops_table = { dir: { node: { getattr: MEMFS.node_ops.getattr, setattr: MEMFS.node_ops.setattr, lookup: MEMFS.node_ops.lookup, mknod: MEMFS.node_ops.mknod, rename: MEMFS.node_ops.rename, unlink: MEMFS.node_ops.unlink, rmdir: MEMFS.node_ops.rmdir, readdir: MEMFS.node_ops.readdir, symlink: MEMFS.node_ops.symlink }, stream: { llseek: MEMFS.stream_ops.llseek } }, file: { node: { getattr: MEMFS.node_ops.getattr, setattr: MEMFS.node_ops.setattr }, stream: { llseek: MEMFS.stream_ops.llseek, read: MEMFS.stream_ops.read, write: MEMFS.stream_ops.write, allocate: MEMFS.stream_ops.allocate, mmap: MEMFS.stream_ops.mmap, msync: MEMFS.stream_ops.msync } }, link: { node: { getattr: MEMFS.node_ops.getattr, setattr: MEMFS.node_ops.setattr, readlink: MEMFS.node_ops.readlink }, stream: {} }, chrdev: { node: { getattr: MEMFS.node_ops.getattr, setattr: MEMFS.node_ops.setattr }, stream: FS.chrdev_stream_ops } });
          var o5 = FS.createNode(e, t3, r, a3);
          return FS.isDir(o5.mode) ? (o5.node_ops = MEMFS.ops_table.dir.node, o5.stream_ops = MEMFS.ops_table.dir.stream, o5.contents = {}) : FS.isFile(o5.mode) ? (o5.node_ops = MEMFS.ops_table.file.node, o5.stream_ops = MEMFS.ops_table.file.stream, o5.usedBytes = 0, o5.contents = null) : FS.isLink(o5.mode) ? (o5.node_ops = MEMFS.ops_table.link.node, o5.stream_ops = MEMFS.ops_table.link.stream) : FS.isChrdev(o5.mode) && (o5.node_ops = MEMFS.ops_table.chrdev.node, o5.stream_ops = MEMFS.ops_table.chrdev.stream), o5.atime = o5.mtime = o5.ctime = Date.now(), e && (e.contents[t3] = o5, e.atime = e.mtime = e.ctime = o5.atime), o5;
        }, getFileDataAsTypedArray(e) {
          return e.contents ? e.contents.subarray ? e.contents.subarray(0, e.usedBytes) : new Uint8Array(e.contents) : new Uint8Array(0);
        }, expandFileStorage(e, t3) {
          var r = e.contents ? e.contents.length : 0;
          if (!(r >= t3)) {
            var a3 = 1024 * 1024;
            t3 = Math.max(t3, r * (r < a3 ? 2 : 1.125) >>> 0), r != 0 && (t3 = Math.max(t3, 256));
            var o5 = e.contents;
            e.contents = new Uint8Array(t3), e.usedBytes > 0 && e.contents.set(o5.subarray(0, e.usedBytes), 0);
          }
        }, resizeFileStorage(e, t3) {
          if (e.usedBytes != t3) if (t3 == 0) e.contents = null, e.usedBytes = 0;
          else {
            var r = e.contents;
            e.contents = new Uint8Array(t3), r && e.contents.set(r.subarray(0, Math.min(t3, e.usedBytes))), e.usedBytes = t3;
          }
        }, node_ops: { getattr(e) {
          var t3 = {};
          return t3.dev = FS.isChrdev(e.mode) ? e.id : 1, t3.ino = e.id, t3.mode = e.mode, t3.nlink = 1, t3.uid = 0, t3.gid = 0, t3.rdev = e.rdev, FS.isDir(e.mode) ? t3.size = 4096 : FS.isFile(e.mode) ? t3.size = e.usedBytes : FS.isLink(e.mode) ? t3.size = e.link.length : t3.size = 0, t3.atime = new Date(e.atime), t3.mtime = new Date(e.mtime), t3.ctime = new Date(e.ctime), t3.blksize = 4096, t3.blocks = Math.ceil(t3.size / t3.blksize), t3;
        }, setattr(e, t3) {
          for (let r of ["mode", "atime", "mtime", "ctime"]) t3[r] && (e[r] = t3[r]);
          t3.size !== void 0 && MEMFS.resizeFileStorage(e, t3.size);
        }, lookup(e, t3) {
          throw MEMFS.doesNotExistError;
        }, mknod(e, t3, r, a3) {
          return MEMFS.createNode(e, t3, r, a3);
        }, rename(e, t3, r) {
          var a3;
          try {
            a3 = FS.lookupNode(t3, r);
          } catch {
          }
          if (a3) {
            if (FS.isDir(e.mode)) for (var o5 in a3.contents) throw new FS.ErrnoError(55);
            FS.hashRemoveNode(a3);
          }
          delete e.parent.contents[e.name], t3.contents[r] = e, e.name = r, t3.ctime = t3.mtime = e.parent.ctime = e.parent.mtime = Date.now();
        }, unlink(e, t3) {
          delete e.contents[t3], e.ctime = e.mtime = Date.now();
        }, rmdir(e, t3) {
          var r = FS.lookupNode(e, t3);
          for (var a3 in r.contents) throw new FS.ErrnoError(55);
          delete e.contents[t3], e.ctime = e.mtime = Date.now();
        }, readdir(e) {
          return [".", "..", ...Object.keys(e.contents)];
        }, symlink(e, t3, r) {
          var a3 = MEMFS.createNode(e, t3, 41471, 0);
          return a3.link = r, a3;
        }, readlink(e) {
          if (!FS.isLink(e.mode)) throw new FS.ErrnoError(28);
          return e.link;
        } }, stream_ops: { read(e, t3, r, a3, o5) {
          var _4 = e.node.contents;
          if (o5 >= e.node.usedBytes) return 0;
          var s5 = Math.min(e.node.usedBytes - o5, a3);
          if (s5 > 8 && _4.subarray) t3.set(_4.subarray(o5, o5 + s5), r);
          else for (var n3 = 0; n3 < s5; n3++) t3[r + n3] = _4[o5 + n3];
          return s5;
        }, write(e, t3, r, a3, o5, _4) {
          if (t3.buffer === HEAP8.buffer && (_4 = false), !a3) return 0;
          var s5 = e.node;
          if (s5.mtime = s5.ctime = Date.now(), t3.subarray && (!s5.contents || s5.contents.subarray)) {
            if (_4) return s5.contents = t3.subarray(r, r + a3), s5.usedBytes = a3, a3;
            if (s5.usedBytes === 0 && o5 === 0) return s5.contents = t3.slice(r, r + a3), s5.usedBytes = a3, a3;
            if (o5 + a3 <= s5.usedBytes) return s5.contents.set(t3.subarray(r, r + a3), o5), a3;
          }
          if (MEMFS.expandFileStorage(s5, o5 + a3), s5.contents.subarray && t3.subarray) s5.contents.set(t3.subarray(r, r + a3), o5);
          else for (var n3 = 0; n3 < a3; n3++) s5.contents[o5 + n3] = t3[r + n3];
          return s5.usedBytes = Math.max(s5.usedBytes, o5 + a3), a3;
        }, llseek(e, t3, r) {
          var a3 = t3;
          if (r === 1 ? a3 += e.position : r === 2 && FS.isFile(e.node.mode) && (a3 += e.node.usedBytes), a3 < 0) throw new FS.ErrnoError(28);
          return a3;
        }, allocate(e, t3, r) {
          MEMFS.expandFileStorage(e.node, t3 + r), e.node.usedBytes = Math.max(e.node.usedBytes, t3 + r);
        }, mmap(e, t3, r, a3, o5) {
          if (!FS.isFile(e.node.mode)) throw new FS.ErrnoError(43);
          var _4, s5, n3 = e.node.contents;
          if (!(o5 & 2) && n3 && n3.buffer === HEAP8.buffer) s5 = false, _4 = n3.byteOffset;
          else {
            if (s5 = true, _4 = mmapAlloc(t3), !_4) throw new FS.ErrnoError(48);
            n3 && ((r > 0 || r + t3 < n3.length) && (n3.subarray ? n3 = n3.subarray(r, r + t3) : n3 = Array.prototype.slice.call(n3, r, r + t3)), HEAP8.set(n3, _4));
          }
          return { ptr: _4, allocated: s5 };
        }, msync(e, t3, r, a3, o5) {
          return MEMFS.stream_ops.write(e, t3, 0, a3, r, false), 0;
        } } }, FS_createDataFile = (e, t3, r, a3, o5, _4) => {
          FS.createDataFile(e, t3, r, a3, o5, _4);
        }, FS_handledByPreloadPlugin = (e, t3, r, a3) => {
          typeof Browser < "u" && Browser.init();
          var o5 = false;
          return preloadPlugins.forEach((_4) => {
            o5 || _4.canHandle(t3) && (_4.handle(e, t3, r, a3), o5 = true);
          }), o5;
        }, FS_createPreloadedFile = (e, t3, r, a3, o5, _4, s5, n3, l2, d3) => {
          var u3 = t3 ? PATH_FS.resolve(PATH.join2(e, t3)) : e, c4 = `cp ${u3}`;
          function f5(g4) {
            function m5(p6) {
              d3?.(), n3 || FS_createDataFile(e, t3, p6, a3, o5, l2), _4?.(), removeRunDependency(c4);
            }
            FS_handledByPreloadPlugin(g4, u3, m5, () => {
              s5?.(), removeRunDependency(c4);
            }) || m5(g4);
          }
          addRunDependency(c4), typeof r == "string" ? asyncLoad(r).then(f5, s5) : f5(r);
        }, FS_modeStringToFlags = (e) => {
          var t3 = { r: 0, "r+": 2, w: 577, "w+": 578, a: 1089, "a+": 1090 }, r = t3[e];
          if (typeof r > "u") throw new Error(`Unknown file open mode: ${e}`);
          return r;
        }, FS_getMode = (e, t3) => {
          var r = 0;
          return e && (r |= 365), t3 && (r |= 146), r;
        }, IDBFS = { dbs: {}, indexedDB: () => {
          if (typeof indexedDB < "u") return indexedDB;
          var e = null;
          return typeof window == "object" && (e = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB), e;
        }, DB_VERSION: 21, DB_STORE_NAME: "FILE_DATA", queuePersist: (e) => {
          function t3() {
            e.idbPersistState === "again" ? r() : e.idbPersistState = 0;
          }
          function r() {
            e.idbPersistState = "idb", IDBFS.syncfs(e, false, t3);
          }
          e.idbPersistState ? e.idbPersistState === "idb" && (e.idbPersistState = "again") : e.idbPersistState = setTimeout(r, 0);
        }, mount: (e) => {
          var t3 = MEMFS.mount(e);
          if (e?.opts?.autoPersist) {
            t3.idbPersistState = 0;
            var r = t3.node_ops;
            t3.node_ops = Object.assign({}, t3.node_ops), t3.node_ops.mknod = (a3, o5, _4, s5) => {
              var n3 = r.mknod(a3, o5, _4, s5);
              return n3.node_ops = t3.node_ops, n3.idbfs_mount = t3.mount, n3.memfs_stream_ops = n3.stream_ops, n3.stream_ops = Object.assign({}, n3.stream_ops), n3.stream_ops.write = (l2, d3, u3, c4, f5, g4) => (l2.node.isModified = true, n3.memfs_stream_ops.write(l2, d3, u3, c4, f5, g4)), n3.stream_ops.close = (l2) => {
                var d3 = l2.node;
                if (d3.isModified && (IDBFS.queuePersist(d3.idbfs_mount), d3.isModified = false), d3.memfs_stream_ops.close) return d3.memfs_stream_ops.close(l2);
              }, n3;
            }, t3.node_ops.mkdir = (...a3) => (IDBFS.queuePersist(t3.mount), r.mkdir(...a3)), t3.node_ops.rmdir = (...a3) => (IDBFS.queuePersist(t3.mount), r.rmdir(...a3)), t3.node_ops.symlink = (...a3) => (IDBFS.queuePersist(t3.mount), r.symlink(...a3)), t3.node_ops.unlink = (...a3) => (IDBFS.queuePersist(t3.mount), r.unlink(...a3)), t3.node_ops.rename = (...a3) => (IDBFS.queuePersist(t3.mount), r.rename(...a3));
          }
          return t3;
        }, syncfs: (e, t3, r) => {
          IDBFS.getLocalSet(e, (a3, o5) => {
            if (a3) return r(a3);
            IDBFS.getRemoteSet(e, (_4, s5) => {
              if (_4) return r(_4);
              var n3 = t3 ? s5 : o5, l2 = t3 ? o5 : s5;
              IDBFS.reconcile(n3, l2, r);
            });
          });
        }, quit: () => {
          Object.values(IDBFS.dbs).forEach((e) => e.close()), IDBFS.dbs = {};
        }, getDB: (e, t3) => {
          var r = IDBFS.dbs[e];
          if (r) return t3(null, r);
          var a3;
          try {
            a3 = IDBFS.indexedDB().open(e, IDBFS.DB_VERSION);
          } catch (o5) {
            return t3(o5);
          }
          if (!a3) return t3("Unable to connect to IndexedDB");
          a3.onupgradeneeded = (o5) => {
            var _4 = o5.target.result, s5 = o5.target.transaction, n3;
            _4.objectStoreNames.contains(IDBFS.DB_STORE_NAME) ? n3 = s5.objectStore(IDBFS.DB_STORE_NAME) : n3 = _4.createObjectStore(IDBFS.DB_STORE_NAME), n3.indexNames.contains("timestamp") || n3.createIndex("timestamp", "timestamp", { unique: false });
          }, a3.onsuccess = () => {
            r = a3.result, IDBFS.dbs[e] = r, t3(null, r);
          }, a3.onerror = (o5) => {
            t3(o5.target.error), o5.preventDefault();
          };
        }, getLocalSet: (e, t3) => {
          var r = {};
          function a3(l2) {
            return l2 !== "." && l2 !== "..";
          }
          function o5(l2) {
            return (d3) => PATH.join2(l2, d3);
          }
          for (var _4 = FS.readdir(e.mountpoint).filter(a3).map(o5(e.mountpoint)); _4.length; ) {
            var s5 = _4.pop(), n3;
            try {
              n3 = FS.stat(s5);
            } catch (l2) {
              return t3(l2);
            }
            FS.isDir(n3.mode) && _4.push(...FS.readdir(s5).filter(a3).map(o5(s5))), r[s5] = { timestamp: n3.mtime };
          }
          return t3(null, { type: "local", entries: r });
        }, getRemoteSet: (e, t3) => {
          var r = {};
          IDBFS.getDB(e.mountpoint, (a3, o5) => {
            if (a3) return t3(a3);
            try {
              var _4 = o5.transaction([IDBFS.DB_STORE_NAME], "readonly");
              _4.onerror = (l2) => {
                t3(l2.target.error), l2.preventDefault();
              };
              var s5 = _4.objectStore(IDBFS.DB_STORE_NAME), n3 = s5.index("timestamp");
              n3.openKeyCursor().onsuccess = (l2) => {
                var d3 = l2.target.result;
                if (!d3) return t3(null, { type: "remote", db: o5, entries: r });
                r[d3.primaryKey] = { timestamp: d3.key }, d3.continue();
              };
            } catch (l2) {
              return t3(l2);
            }
          });
        }, loadLocalEntry: (e, t3) => {
          var r, a3;
          try {
            var o5 = FS.lookupPath(e);
            a3 = o5.node, r = FS.stat(e);
          } catch (_4) {
            return t3(_4);
          }
          return FS.isDir(r.mode) ? t3(null, { timestamp: r.mtime, mode: r.mode }) : FS.isFile(r.mode) ? (a3.contents = MEMFS.getFileDataAsTypedArray(a3), t3(null, { timestamp: r.mtime, mode: r.mode, contents: a3.contents })) : t3(new Error("node type not supported"));
        }, storeLocalEntry: (e, t3, r) => {
          try {
            if (FS.isDir(t3.mode)) FS.mkdirTree(e, t3.mode);
            else if (FS.isFile(t3.mode)) FS.writeFile(e, t3.contents, { canOwn: true });
            else return r(new Error("node type not supported"));
            FS.chmod(e, t3.mode), FS.utime(e, t3.timestamp, t3.timestamp);
          } catch (a3) {
            return r(a3);
          }
          r(null);
        }, removeLocalEntry: (e, t3) => {
          try {
            var r = FS.stat(e);
            FS.isDir(r.mode) ? FS.rmdir(e) : FS.isFile(r.mode) && FS.unlink(e);
          } catch (a3) {
            return t3(a3);
          }
          t3(null);
        }, loadRemoteEntry: (e, t3, r) => {
          var a3 = e.get(t3);
          a3.onsuccess = (o5) => r(null, o5.target.result), a3.onerror = (o5) => {
            r(o5.target.error), o5.preventDefault();
          };
        }, storeRemoteEntry: (e, t3, r, a3) => {
          try {
            var o5 = e.put(r, t3);
          } catch (_4) {
            a3(_4);
            return;
          }
          o5.onsuccess = (_4) => a3(), o5.onerror = (_4) => {
            a3(_4.target.error), _4.preventDefault();
          };
        }, removeRemoteEntry: (e, t3, r) => {
          var a3 = e.delete(t3);
          a3.onsuccess = (o5) => r(), a3.onerror = (o5) => {
            r(o5.target.error), o5.preventDefault();
          };
        }, reconcile: (e, t3, r) => {
          var a3 = 0, o5 = [];
          Object.keys(e.entries).forEach((c4) => {
            var f5 = e.entries[c4], g4 = t3.entries[c4];
            (!g4 || f5.timestamp.getTime() != g4.timestamp.getTime()) && (o5.push(c4), a3++);
          });
          var _4 = [];
          if (Object.keys(t3.entries).forEach((c4) => {
            e.entries[c4] || (_4.push(c4), a3++);
          }), !a3) return r(null);
          var s5 = false, n3 = e.type === "remote" ? e.db : t3.db, l2 = n3.transaction([IDBFS.DB_STORE_NAME], "readwrite"), d3 = l2.objectStore(IDBFS.DB_STORE_NAME);
          function u3(c4) {
            if (c4 && !s5) return s5 = true, r(c4);
          }
          l2.onerror = l2.onabort = (c4) => {
            u3(c4.target.error), c4.preventDefault();
          }, l2.oncomplete = (c4) => {
            s5 || r(null);
          }, o5.sort().forEach((c4) => {
            t3.type === "local" ? IDBFS.loadRemoteEntry(d3, c4, (f5, g4) => {
              if (f5) return u3(f5);
              IDBFS.storeLocalEntry(c4, g4, u3);
            }) : IDBFS.loadLocalEntry(c4, (f5, g4) => {
              if (f5) return u3(f5);
              IDBFS.storeRemoteEntry(d3, c4, g4, u3);
            });
          }), _4.sort().reverse().forEach((c4) => {
            t3.type === "local" ? IDBFS.removeLocalEntry(c4, u3) : IDBFS.removeRemoteEntry(d3, c4, u3);
          });
        } }, ERRNO_CODES = { EPERM: 63, ENOENT: 44, ESRCH: 71, EINTR: 27, EIO: 29, ENXIO: 60, E2BIG: 1, ENOEXEC: 45, EBADF: 8, ECHILD: 12, EAGAIN: 6, EWOULDBLOCK: 6, ENOMEM: 48, EACCES: 2, EFAULT: 21, ENOTBLK: 105, EBUSY: 10, EEXIST: 20, EXDEV: 75, ENODEV: 43, ENOTDIR: 54, EISDIR: 31, EINVAL: 28, ENFILE: 41, EMFILE: 33, ENOTTY: 59, ETXTBSY: 74, EFBIG: 22, ENOSPC: 51, ESPIPE: 70, EROFS: 69, EMLINK: 34, EPIPE: 64, EDOM: 18, ERANGE: 68, ENOMSG: 49, EIDRM: 24, ECHRNG: 106, EL2NSYNC: 156, EL3HLT: 107, EL3RST: 108, ELNRNG: 109, EUNATCH: 110, ENOCSI: 111, EL2HLT: 112, EDEADLK: 16, ENOLCK: 46, EBADE: 113, EBADR: 114, EXFULL: 115, ENOANO: 104, EBADRQC: 103, EBADSLT: 102, EDEADLOCK: 16, EBFONT: 101, ENOSTR: 100, ENODATA: 116, ETIME: 117, ENOSR: 118, ENONET: 119, ENOPKG: 120, EREMOTE: 121, ENOLINK: 47, EADV: 122, ESRMNT: 123, ECOMM: 124, EPROTO: 65, EMULTIHOP: 36, EDOTDOT: 125, EBADMSG: 9, ENOTUNIQ: 126, EBADFD: 127, EREMCHG: 128, ELIBACC: 129, ELIBBAD: 130, ELIBSCN: 131, ELIBMAX: 132, ELIBEXEC: 133, ENOSYS: 52, ENOTEMPTY: 55, ENAMETOOLONG: 37, ELOOP: 32, EOPNOTSUPP: 138, EPFNOSUPPORT: 139, ECONNRESET: 15, ENOBUFS: 42, EAFNOSUPPORT: 5, EPROTOTYPE: 67, ENOTSOCK: 57, ENOPROTOOPT: 50, ESHUTDOWN: 140, ECONNREFUSED: 14, EADDRINUSE: 3, ECONNABORTED: 13, ENETUNREACH: 40, ENETDOWN: 38, ETIMEDOUT: 73, EHOSTDOWN: 142, EHOSTUNREACH: 23, EINPROGRESS: 26, EALREADY: 7, EDESTADDRREQ: 17, EMSGSIZE: 35, EPROTONOSUPPORT: 66, ESOCKTNOSUPPORT: 137, EADDRNOTAVAIL: 4, ENETRESET: 39, EISCONN: 30, ENOTCONN: 53, ETOOMANYREFS: 141, EUSERS: 136, EDQUOT: 19, ESTALE: 72, ENOTSUP: 138, ENOMEDIUM: 148, EILSEQ: 25, EOVERFLOW: 61, ECANCELED: 11, ENOTRECOVERABLE: 56, EOWNERDEAD: 62, ESTRPIPE: 135 }, NODEFS = { isWindows: false, staticInit() {
          NODEFS.isWindows = !!process.platform.match(/^win/);
          var e = process.binding("constants");
          e.fs && (e = e.fs), NODEFS.flagsForNodeMap = { 1024: e.O_APPEND, 64: e.O_CREAT, 128: e.O_EXCL, 256: e.O_NOCTTY, 0: e.O_RDONLY, 2: e.O_RDWR, 4096: e.O_SYNC, 512: e.O_TRUNC, 1: e.O_WRONLY, 131072: e.O_NOFOLLOW };
        }, convertNodeCode(e) {
          var t3 = e.code;
          return ERRNO_CODES[t3];
        }, tryFSOperation(e) {
          try {
            return e();
          } catch (t3) {
            throw t3.code ? t3.code === "UNKNOWN" ? new FS.ErrnoError(28) : new FS.ErrnoError(NODEFS.convertNodeCode(t3)) : t3;
          }
        }, mount(e) {
          return NODEFS.createNode(null, "/", NODEFS.getMode(e.opts.root), 0);
        }, createNode(e, t3, r, a3) {
          if (!FS.isDir(r) && !FS.isFile(r) && !FS.isLink(r)) throw new FS.ErrnoError(28);
          var o5 = FS.createNode(e, t3, r);
          return o5.node_ops = NODEFS.node_ops, o5.stream_ops = NODEFS.stream_ops, o5;
        }, getMode(e) {
          return NODEFS.tryFSOperation(() => {
            var t3 = fs.lstatSync(e).mode;
            return NODEFS.isWindows && (t3 |= (t3 & 292) >> 2), t3;
          });
        }, realPath(e) {
          for (var t3 = []; e.parent !== e; ) t3.push(e.name), e = e.parent;
          return t3.push(e.mount.opts.root), t3.reverse(), PATH.join(...t3);
        }, flagsForNode(e) {
          e &= -2097153, e &= -2049, e &= -32769, e &= -524289, e &= -65537;
          var t3 = 0;
          for (var r in NODEFS.flagsForNodeMap) e & r && (t3 |= NODEFS.flagsForNodeMap[r], e ^= r);
          if (e) throw new FS.ErrnoError(28);
          return t3;
        }, node_ops: { getattr(e) {
          var t3 = NODEFS.realPath(e), r;
          return NODEFS.tryFSOperation(() => r = fs.lstatSync(t3)), NODEFS.isWindows && (r.blksize || (r.blksize = 4096), r.blocks || (r.blocks = (r.size + r.blksize - 1) / r.blksize | 0), r.mode |= (r.mode & 292) >> 2), { dev: r.dev, ino: r.ino, mode: r.mode, nlink: r.nlink, uid: r.uid, gid: r.gid, rdev: r.rdev, size: r.size, atime: r.atime, mtime: r.mtime, ctime: r.ctime, blksize: r.blksize, blocks: r.blocks };
        }, setattr(e, t3) {
          var r = NODEFS.realPath(e);
          NODEFS.tryFSOperation(() => {
            if (t3.mode !== void 0) {
              var a3 = t3.mode;
              NODEFS.isWindows && (a3 &= 384), fs.chmodSync(r, a3), e.mode = t3.mode;
            }
            if (t3.atime || t3.mtime) {
              var o5 = t3.atime && new Date(t3.atime), _4 = t3.mtime && new Date(t3.mtime);
              fs.utimesSync(r, o5, _4);
            }
            t3.size !== void 0 && fs.truncateSync(r, t3.size);
          });
        }, lookup(e, t3) {
          var r = PATH.join2(NODEFS.realPath(e), t3), a3 = NODEFS.getMode(r);
          return NODEFS.createNode(e, t3, a3);
        }, mknod(e, t3, r, a3) {
          var o5 = NODEFS.createNode(e, t3, r, a3), _4 = NODEFS.realPath(o5);
          return NODEFS.tryFSOperation(() => {
            FS.isDir(o5.mode) ? fs.mkdirSync(_4, o5.mode) : fs.writeFileSync(_4, "", { mode: o5.mode });
          }), o5;
        }, rename(e, t3, r) {
          var a3 = NODEFS.realPath(e), o5 = PATH.join2(NODEFS.realPath(t3), r);
          try {
            FS.unlink(o5);
          } catch {
          }
          NODEFS.tryFSOperation(() => fs.renameSync(a3, o5)), e.name = r;
        }, unlink(e, t3) {
          var r = PATH.join2(NODEFS.realPath(e), t3);
          NODEFS.tryFSOperation(() => fs.unlinkSync(r));
        }, rmdir(e, t3) {
          var r = PATH.join2(NODEFS.realPath(e), t3);
          NODEFS.tryFSOperation(() => fs.rmdirSync(r));
        }, readdir(e) {
          var t3 = NODEFS.realPath(e);
          return NODEFS.tryFSOperation(() => fs.readdirSync(t3));
        }, symlink(e, t3, r) {
          var a3 = PATH.join2(NODEFS.realPath(e), t3);
          NODEFS.tryFSOperation(() => fs.symlinkSync(r, a3));
        }, readlink(e) {
          var t3 = NODEFS.realPath(e);
          return NODEFS.tryFSOperation(() => fs.readlinkSync(t3));
        }, statfs(e) {
          var t3 = NODEFS.tryFSOperation(() => fs.statfsSync(e));
          return t3.frsize = t3.bsize, t3;
        } }, stream_ops: { open(e) {
          var t3 = NODEFS.realPath(e.node);
          NODEFS.tryFSOperation(() => {
            FS.isFile(e.node.mode) && (e.shared.refcount = 1, e.nfd = fs.openSync(t3, NODEFS.flagsForNode(e.flags)));
          });
        }, close(e) {
          NODEFS.tryFSOperation(() => {
            FS.isFile(e.node.mode) && e.nfd && --e.shared.refcount === 0 && fs.closeSync(e.nfd);
          });
        }, dup(e) {
          e.shared.refcount++;
        }, read(e, t3, r, a3, o5) {
          return a3 === 0 ? 0 : NODEFS.tryFSOperation(() => fs.readSync(e.nfd, new Int8Array(t3.buffer, r, a3), 0, a3, o5));
        }, write(e, t3, r, a3, o5) {
          return NODEFS.tryFSOperation(() => fs.writeSync(e.nfd, new Int8Array(t3.buffer, r, a3), 0, a3, o5));
        }, llseek(e, t3, r) {
          var a3 = t3;
          if (r === 1 ? a3 += e.position : r === 2 && FS.isFile(e.node.mode) && NODEFS.tryFSOperation(() => {
            var o5 = fs.fstatSync(e.nfd);
            a3 += o5.size;
          }), a3 < 0) throw new FS.ErrnoError(28);
          return a3;
        }, mmap(e, t3, r, a3, o5) {
          if (!FS.isFile(e.node.mode)) throw new FS.ErrnoError(43);
          var _4 = mmapAlloc(t3);
          return NODEFS.stream_ops.read(e, HEAP8, _4, t3, r), { ptr: _4, allocated: true };
        }, msync(e, t3, r, a3, o5) {
          return NODEFS.stream_ops.write(e, t3, 0, a3, r, false), 0;
        } } }, PROXYFS = { mount(e) {
          return PROXYFS.createNode(null, "/", e.opts.fs.lstat(e.opts.root).mode, 0);
        }, createNode(e, t3, r, a3) {
          if (!FS.isDir(r) && !FS.isFile(r) && !FS.isLink(r)) throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          var o5 = FS.createNode(e, t3, r);
          return o5.node_ops = PROXYFS.node_ops, o5.stream_ops = PROXYFS.stream_ops, o5;
        }, realPath(e) {
          for (var t3 = []; e.parent !== e; ) t3.push(e.name), e = e.parent;
          return t3.push(e.mount.opts.root), t3.reverse(), PATH.join(...t3);
        }, node_ops: { getattr(e) {
          var t3 = PROXYFS.realPath(e), r;
          try {
            r = e.mount.opts.fs.lstat(t3);
          } catch (a3) {
            throw a3.code ? new FS.ErrnoError(ERRNO_CODES[a3.code]) : a3;
          }
          return { dev: r.dev, ino: r.ino, mode: r.mode, nlink: r.nlink, uid: r.uid, gid: r.gid, rdev: r.rdev, size: r.size, atime: r.atime, mtime: r.mtime, ctime: r.ctime, blksize: r.blksize, blocks: r.blocks };
        }, setattr(e, t3) {
          var r = PROXYFS.realPath(e);
          try {
            if (t3.mode !== void 0 && (e.mount.opts.fs.chmod(r, t3.mode), e.mode = t3.mode), t3.atime || t3.mtime) {
              var a3 = new Date(t3.atime || t3.mtime), o5 = new Date(t3.mtime || t3.atime);
              e.mount.opts.fs.utime(r, a3, o5);
            }
            t3.size !== void 0 && e.mount.opts.fs.truncate(r, t3.size);
          } catch (_4) {
            throw _4.code ? new FS.ErrnoError(ERRNO_CODES[_4.code]) : _4;
          }
        }, lookup(e, t3) {
          try {
            var r = PATH.join2(PROXYFS.realPath(e), t3), a3 = e.mount.opts.fs.lstat(r).mode, o5 = PROXYFS.createNode(e, t3, a3);
            return o5;
          } catch (_4) {
            throw _4.code ? new FS.ErrnoError(ERRNO_CODES[_4.code]) : _4;
          }
        }, mknod(e, t3, r, a3) {
          var o5 = PROXYFS.createNode(e, t3, r, a3), _4 = PROXYFS.realPath(o5);
          try {
            FS.isDir(o5.mode) ? o5.mount.opts.fs.mkdir(_4, o5.mode) : o5.mount.opts.fs.writeFile(_4, "", { mode: o5.mode });
          } catch (s5) {
            throw s5.code ? new FS.ErrnoError(ERRNO_CODES[s5.code]) : s5;
          }
          return o5;
        }, rename(e, t3, r) {
          var a3 = PROXYFS.realPath(e), o5 = PATH.join2(PROXYFS.realPath(t3), r);
          try {
            e.mount.opts.fs.rename(a3, o5), e.name = r;
          } catch (_4) {
            throw _4.code ? new FS.ErrnoError(ERRNO_CODES[_4.code]) : _4;
          }
        }, unlink(e, t3) {
          var r = PATH.join2(PROXYFS.realPath(e), t3);
          try {
            e.mount.opts.fs.unlink(r);
          } catch (a3) {
            throw a3.code ? new FS.ErrnoError(ERRNO_CODES[a3.code]) : a3;
          }
        }, rmdir(e, t3) {
          var r = PATH.join2(PROXYFS.realPath(e), t3);
          try {
            e.mount.opts.fs.rmdir(r);
          } catch (a3) {
            throw a3.code ? new FS.ErrnoError(ERRNO_CODES[a3.code]) : a3;
          }
        }, readdir(e) {
          var t3 = PROXYFS.realPath(e);
          try {
            return e.mount.opts.fs.readdir(t3);
          } catch (r) {
            throw r.code ? new FS.ErrnoError(ERRNO_CODES[r.code]) : r;
          }
        }, symlink(e, t3, r) {
          var a3 = PATH.join2(PROXYFS.realPath(e), t3);
          try {
            e.mount.opts.fs.symlink(r, a3);
          } catch (o5) {
            throw o5.code ? new FS.ErrnoError(ERRNO_CODES[o5.code]) : o5;
          }
        }, readlink(e) {
          var t3 = PROXYFS.realPath(e);
          try {
            return e.mount.opts.fs.readlink(t3);
          } catch (r) {
            throw r.code ? new FS.ErrnoError(ERRNO_CODES[r.code]) : r;
          }
        } }, stream_ops: { open(e) {
          var t3 = PROXYFS.realPath(e.node);
          try {
            e.nfd = e.node.mount.opts.fs.open(t3, e.flags);
          } catch (r) {
            throw r.code ? new FS.ErrnoError(ERRNO_CODES[r.code]) : r;
          }
        }, close(e) {
          try {
            e.node.mount.opts.fs.close(e.nfd);
          } catch (t3) {
            throw t3.code ? new FS.ErrnoError(ERRNO_CODES[t3.code]) : t3;
          }
        }, read(e, t3, r, a3, o5) {
          try {
            return e.node.mount.opts.fs.read(e.nfd, t3, r, a3, o5);
          } catch (_4) {
            throw _4.code ? new FS.ErrnoError(ERRNO_CODES[_4.code]) : _4;
          }
        }, write(e, t3, r, a3, o5) {
          try {
            return e.node.mount.opts.fs.write(e.nfd, t3, r, a3, o5);
          } catch (_4) {
            throw _4.code ? new FS.ErrnoError(ERRNO_CODES[_4.code]) : _4;
          }
        }, llseek(e, t3, r) {
          var a3 = t3;
          if (r === 1) a3 += e.position;
          else if (r === 2 && FS.isFile(e.node.mode)) try {
            var o5 = e.node.node_ops.getattr(e.node);
            a3 += o5.size;
          } catch (_4) {
            throw new FS.ErrnoError(ERRNO_CODES[_4.code]);
          }
          if (a3 < 0) throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
          return a3;
        } } }, FS = { root: null, mounts: [], devices: {}, streams: [], nextInode: 1, nameTable: null, currentPath: "/", initialized: false, ignorePermissions: true, ErrnoError: class {
          constructor(e) {
            P(this, "name", "ErrnoError");
            this.errno = e;
          }
        }, filesystems: null, syncFSRequests: 0, readFiles: {}, FSStream: class {
          constructor() {
            P(this, "shared", {});
          }
          get object() {
            return this.node;
          }
          set object(e) {
            this.node = e;
          }
          get isRead() {
            return (this.flags & 2097155) !== 1;
          }
          get isWrite() {
            return (this.flags & 2097155) !== 0;
          }
          get isAppend() {
            return this.flags & 1024;
          }
          get flags() {
            return this.shared.flags;
          }
          set flags(e) {
            this.shared.flags = e;
          }
          get position() {
            return this.shared.position;
          }
          set position(e) {
            this.shared.position = e;
          }
        }, FSNode: class {
          constructor(e, t3, r, a3) {
            P(this, "node_ops", {});
            P(this, "stream_ops", {});
            P(this, "readMode", 365);
            P(this, "writeMode", 146);
            P(this, "mounted", null);
            e || (e = this), this.parent = e, this.mount = e.mount, this.id = FS.nextInode++, this.name = t3, this.mode = r, this.rdev = a3, this.atime = this.mtime = this.ctime = Date.now();
          }
          get read() {
            return (this.mode & this.readMode) === this.readMode;
          }
          set read(e) {
            e ? this.mode |= this.readMode : this.mode &= ~this.readMode;
          }
          get write() {
            return (this.mode & this.writeMode) === this.writeMode;
          }
          set write(e) {
            e ? this.mode |= this.writeMode : this.mode &= ~this.writeMode;
          }
          get isFolder() {
            return FS.isDir(this.mode);
          }
          get isDevice() {
            return FS.isChrdev(this.mode);
          }
        }, lookupPath(e, t3 = {}) {
          if (!e) return { path: "", node: null };
          t3.follow_mount ?? (t3.follow_mount = true), PATH.isAbs(e) || (e = FS.cwd() + "/" + e);
          e: for (var r = 0; r < 40; r++) {
            for (var a3 = e.split("/").filter((d3) => !!d3 && d3 !== "."), o5 = FS.root, _4 = "/", s5 = 0; s5 < a3.length; s5++) {
              var n3 = s5 === a3.length - 1;
              if (n3 && t3.parent) break;
              if (a3[s5] === "..") {
                _4 = PATH.dirname(_4), o5 = o5.parent;
                continue;
              }
              _4 = PATH.join2(_4, a3[s5]);
              try {
                o5 = FS.lookupNode(o5, a3[s5]);
              } catch (d3) {
                if (d3?.errno === 44 && n3 && t3.noent_okay) return { path: _4 };
                throw d3;
              }
              if (FS.isMountpoint(o5) && (!n3 || t3.follow_mount) && (o5 = o5.mounted.root), FS.isLink(o5.mode) && (!n3 || t3.follow)) {
                if (!o5.node_ops.readlink) throw new FS.ErrnoError(52);
                var l2 = o5.node_ops.readlink(o5);
                PATH.isAbs(l2) || (l2 = PATH.dirname(_4) + "/" + l2), e = l2 + "/" + a3.slice(s5 + 1).join("/");
                continue e;
              }
            }
            return { path: _4, node: o5 };
          }
          throw new FS.ErrnoError(32);
        }, getPath(e) {
          for (var t3; ; ) {
            if (FS.isRoot(e)) {
              var r = e.mount.mountpoint;
              return t3 ? r[r.length - 1] !== "/" ? `${r}/${t3}` : r + t3 : r;
            }
            t3 = t3 ? `${e.name}/${t3}` : e.name, e = e.parent;
          }
        }, hashName(e, t3) {
          for (var r = 0, a3 = 0; a3 < t3.length; a3++) r = (r << 5) - r + t3.charCodeAt(a3) | 0;
          return (e + r >>> 0) % FS.nameTable.length;
        }, hashAddNode(e) {
          var t3 = FS.hashName(e.parent.id, e.name);
          e.name_next = FS.nameTable[t3], FS.nameTable[t3] = e;
        }, hashRemoveNode(e) {
          var t3 = FS.hashName(e.parent.id, e.name);
          if (FS.nameTable[t3] === e) FS.nameTable[t3] = e.name_next;
          else for (var r = FS.nameTable[t3]; r; ) {
            if (r.name_next === e) {
              r.name_next = e.name_next;
              break;
            }
            r = r.name_next;
          }
        }, lookupNode(e, t3) {
          var r = FS.mayLookup(e);
          if (r) throw new FS.ErrnoError(r);
          for (var a3 = FS.hashName(e.id, t3), o5 = FS.nameTable[a3]; o5; o5 = o5.name_next) {
            var _4 = o5.name;
            if (o5.parent.id === e.id && _4 === t3) return o5;
          }
          return FS.lookup(e, t3);
        }, createNode(e, t3, r, a3) {
          var o5 = new FS.FSNode(e, t3, r, a3);
          return FS.hashAddNode(o5), o5;
        }, destroyNode(e) {
          FS.hashRemoveNode(e);
        }, isRoot(e) {
          return e === e.parent;
        }, isMountpoint(e) {
          return !!e.mounted;
        }, isFile(e) {
          return (e & 61440) === 32768;
        }, isDir(e) {
          return (e & 61440) === 16384;
        }, isLink(e) {
          return (e & 61440) === 40960;
        }, isChrdev(e) {
          return (e & 61440) === 8192;
        }, isBlkdev(e) {
          return (e & 61440) === 24576;
        }, isFIFO(e) {
          return (e & 61440) === 4096;
        }, isSocket(e) {
          return (e & 49152) === 49152;
        }, flagsToPermissionString(e) {
          var t3 = ["r", "w", "rw"][e & 3];
          return e & 512 && (t3 += "w"), t3;
        }, nodePermissions(e, t3) {
          return FS.ignorePermissions ? 0 : t3.includes("r") && !(e.mode & 292) || t3.includes("w") && !(e.mode & 146) || t3.includes("x") && !(e.mode & 73) ? 2 : 0;
        }, mayLookup(e) {
          if (!FS.isDir(e.mode)) return 54;
          var t3 = FS.nodePermissions(e, "x");
          return t3 || (e.node_ops.lookup ? 0 : 2);
        }, mayCreate(e, t3) {
          if (!FS.isDir(e.mode)) return 54;
          try {
            var r = FS.lookupNode(e, t3);
            return 20;
          } catch {
          }
          return FS.nodePermissions(e, "wx");
        }, mayDelete(e, t3, r) {
          var a3;
          try {
            a3 = FS.lookupNode(e, t3);
          } catch (_4) {
            return _4.errno;
          }
          var o5 = FS.nodePermissions(e, "wx");
          if (o5) return o5;
          if (r) {
            if (!FS.isDir(a3.mode)) return 54;
            if (FS.isRoot(a3) || FS.getPath(a3) === FS.cwd()) return 10;
          } else if (FS.isDir(a3.mode)) return 31;
          return 0;
        }, mayOpen(e, t3) {
          return e ? FS.isLink(e.mode) ? 32 : FS.isDir(e.mode) && (FS.flagsToPermissionString(t3) !== "r" || t3 & 512) ? 31 : FS.nodePermissions(e, FS.flagsToPermissionString(t3)) : 44;
        }, MAX_OPEN_FDS: 4096, nextfd() {
          for (var e = 0; e <= FS.MAX_OPEN_FDS; e++) if (!FS.streams[e]) return e;
          throw new FS.ErrnoError(33);
        }, getStreamChecked(e) {
          var t3 = FS.getStream(e);
          if (!t3) throw new FS.ErrnoError(8);
          return t3;
        }, getStream: (e) => FS.streams[e], createStream(e, t3 = -1) {
          return e = Object.assign(new FS.FSStream(), e), t3 == -1 && (t3 = FS.nextfd()), e.fd = t3, FS.streams[t3] = e, e;
        }, closeStream(e) {
          FS.streams[e] = null;
        }, dupStream(e, t3 = -1) {
          var r = FS.createStream(e, t3);
          return r.stream_ops?.dup?.(r), r;
        }, chrdev_stream_ops: { open(e) {
          var t3 = FS.getDevice(e.node.rdev);
          e.stream_ops = t3.stream_ops, e.stream_ops.open?.(e);
        }, llseek() {
          throw new FS.ErrnoError(70);
        } }, major: (e) => e >> 8, minor: (e) => e & 255, makedev: (e, t3) => e << 8 | t3, registerDevice(e, t3) {
          FS.devices[e] = { stream_ops: t3 };
        }, getDevice: (e) => FS.devices[e], getMounts(e) {
          for (var t3 = [], r = [e]; r.length; ) {
            var a3 = r.pop();
            t3.push(a3), r.push(...a3.mounts);
          }
          return t3;
        }, syncfs(e, t3) {
          typeof e == "function" && (t3 = e, e = false), FS.syncFSRequests++, FS.syncFSRequests > 1 && err(`warning: ${FS.syncFSRequests} FS.syncfs operations in flight at once, probably just doing extra work`);
          var r = FS.getMounts(FS.root.mount), a3 = 0;
          function o5(s5) {
            return FS.syncFSRequests--, t3(s5);
          }
          function _4(s5) {
            if (s5) return _4.errored ? void 0 : (_4.errored = true, o5(s5));
            ++a3 >= r.length && o5(null);
          }
          r.forEach((s5) => {
            if (!s5.type.syncfs) return _4(null);
            s5.type.syncfs(s5, e, _4);
          });
        }, mount(e, t3, r) {
          var a3 = r === "/", o5 = !r, _4;
          if (a3 && FS.root) throw new FS.ErrnoError(10);
          if (!a3 && !o5) {
            var s5 = FS.lookupPath(r, { follow_mount: false });
            if (r = s5.path, _4 = s5.node, FS.isMountpoint(_4)) throw new FS.ErrnoError(10);
            if (!FS.isDir(_4.mode)) throw new FS.ErrnoError(54);
          }
          var n3 = { type: e, opts: t3, mountpoint: r, mounts: [] }, l2 = e.mount(n3);
          return l2.mount = n3, n3.root = l2, a3 ? FS.root = l2 : _4 && (_4.mounted = n3, _4.mount && _4.mount.mounts.push(n3)), l2;
        }, unmount(e) {
          var t3 = FS.lookupPath(e, { follow_mount: false });
          if (!FS.isMountpoint(t3.node)) throw new FS.ErrnoError(28);
          var r = t3.node, a3 = r.mounted, o5 = FS.getMounts(a3);
          Object.keys(FS.nameTable).forEach((s5) => {
            for (var n3 = FS.nameTable[s5]; n3; ) {
              var l2 = n3.name_next;
              o5.includes(n3.mount) && FS.destroyNode(n3), n3 = l2;
            }
          }), r.mounted = null;
          var _4 = r.mount.mounts.indexOf(a3);
          r.mount.mounts.splice(_4, 1);
        }, lookup(e, t3) {
          return e.node_ops.lookup(e, t3);
        }, mknod(e, t3, r) {
          var a3 = FS.lookupPath(e, { parent: true }), o5 = a3.node, _4 = PATH.basename(e);
          if (!_4 || _4 === "." || _4 === "..") throw new FS.ErrnoError(28);
          var s5 = FS.mayCreate(o5, _4);
          if (s5) throw new FS.ErrnoError(s5);
          if (!o5.node_ops.mknod) throw new FS.ErrnoError(63);
          return o5.node_ops.mknod(o5, _4, t3, r);
        }, statfs(e) {
          var t3 = { bsize: 4096, frsize: 4096, blocks: 1e6, bfree: 5e5, bavail: 5e5, files: FS.nextInode, ffree: FS.nextInode - 1, fsid: 42, flags: 2, namelen: 255 }, r = FS.lookupPath(e, { follow: true }).node;
          return r?.node_ops.statfs && Object.assign(t3, r.node_ops.statfs(r.mount.opts.root)), t3;
        }, create(e, t3 = 438) {
          return t3 &= 4095, t3 |= 32768, FS.mknod(e, t3, 0);
        }, mkdir(e, t3 = 511) {
          return t3 &= 1023, t3 |= 16384, FS.mknod(e, t3, 0);
        }, mkdirTree(e, t3) {
          for (var r = e.split("/"), a3 = "", o5 = 0; o5 < r.length; ++o5) if (r[o5]) {
            a3 += "/" + r[o5];
            try {
              FS.mkdir(a3, t3);
            } catch (_4) {
              if (_4.errno != 20) throw _4;
            }
          }
        }, mkdev(e, t3, r) {
          return typeof r > "u" && (r = t3, t3 = 438), t3 |= 8192, FS.mknod(e, t3, r);
        }, symlink(e, t3) {
          if (!PATH_FS.resolve(e)) throw new FS.ErrnoError(44);
          var r = FS.lookupPath(t3, { parent: true }), a3 = r.node;
          if (!a3) throw new FS.ErrnoError(44);
          var o5 = PATH.basename(t3), _4 = FS.mayCreate(a3, o5);
          if (_4) throw new FS.ErrnoError(_4);
          if (!a3.node_ops.symlink) throw new FS.ErrnoError(63);
          return a3.node_ops.symlink(a3, o5, e);
        }, rename(e, t3) {
          var r = PATH.dirname(e), a3 = PATH.dirname(t3), o5 = PATH.basename(e), _4 = PATH.basename(t3), s5, n3, l2;
          if (s5 = FS.lookupPath(e, { parent: true }), n3 = s5.node, s5 = FS.lookupPath(t3, { parent: true }), l2 = s5.node, !n3 || !l2) throw new FS.ErrnoError(44);
          if (n3.mount !== l2.mount) throw new FS.ErrnoError(75);
          var d3 = FS.lookupNode(n3, o5), u3 = PATH_FS.relative(e, a3);
          if (u3.charAt(0) !== ".") throw new FS.ErrnoError(28);
          if (u3 = PATH_FS.relative(t3, r), u3.charAt(0) !== ".") throw new FS.ErrnoError(55);
          var c4;
          try {
            c4 = FS.lookupNode(l2, _4);
          } catch {
          }
          if (d3 !== c4) {
            var f5 = FS.isDir(d3.mode), g4 = FS.mayDelete(n3, o5, f5);
            if (g4) throw new FS.ErrnoError(g4);
            if (g4 = c4 ? FS.mayDelete(l2, _4, f5) : FS.mayCreate(l2, _4), g4) throw new FS.ErrnoError(g4);
            if (!n3.node_ops.rename) throw new FS.ErrnoError(63);
            if (FS.isMountpoint(d3) || c4 && FS.isMountpoint(c4)) throw new FS.ErrnoError(10);
            if (l2 !== n3 && (g4 = FS.nodePermissions(n3, "w"), g4)) throw new FS.ErrnoError(g4);
            FS.hashRemoveNode(d3);
            try {
              n3.node_ops.rename(d3, l2, _4), d3.parent = l2;
            } catch (m5) {
              throw m5;
            } finally {
              FS.hashAddNode(d3);
            }
          }
        }, rmdir(e) {
          var t3 = FS.lookupPath(e, { parent: true }), r = t3.node, a3 = PATH.basename(e), o5 = FS.lookupNode(r, a3), _4 = FS.mayDelete(r, a3, true);
          if (_4) throw new FS.ErrnoError(_4);
          if (!r.node_ops.rmdir) throw new FS.ErrnoError(63);
          if (FS.isMountpoint(o5)) throw new FS.ErrnoError(10);
          r.node_ops.rmdir(r, a3), FS.destroyNode(o5);
        }, readdir(e) {
          var t3 = FS.lookupPath(e, { follow: true }), r = t3.node;
          if (!r.node_ops.readdir) throw new FS.ErrnoError(54);
          return r.node_ops.readdir(r);
        }, unlink(e) {
          var t3 = FS.lookupPath(e, { parent: true }), r = t3.node;
          if (!r) throw new FS.ErrnoError(44);
          var a3 = PATH.basename(e), o5 = FS.lookupNode(r, a3), _4 = FS.mayDelete(r, a3, false);
          if (_4) throw new FS.ErrnoError(_4);
          if (!r.node_ops.unlink) throw new FS.ErrnoError(63);
          if (FS.isMountpoint(o5)) throw new FS.ErrnoError(10);
          r.node_ops.unlink(r, a3), FS.destroyNode(o5);
        }, readlink(e) {
          var t3 = FS.lookupPath(e), r = t3.node;
          if (!r) throw new FS.ErrnoError(44);
          if (!r.node_ops.readlink) throw new FS.ErrnoError(28);
          return r.node_ops.readlink(r);
        }, stat(e, t3) {
          var r = FS.lookupPath(e, { follow: !t3 }), a3 = r.node;
          if (!a3) throw new FS.ErrnoError(44);
          if (!a3.node_ops.getattr) throw new FS.ErrnoError(63);
          return a3.node_ops.getattr(a3);
        }, lstat(e) {
          return FS.stat(e, true);
        }, chmod(e, t3, r) {
          var a3;
          if (typeof e == "string") {
            var o5 = FS.lookupPath(e, { follow: !r });
            a3 = o5.node;
          } else a3 = e;
          if (!a3.node_ops.setattr) throw new FS.ErrnoError(63);
          a3.node_ops.setattr(a3, { mode: t3 & 4095 | a3.mode & -4096, ctime: Date.now() });
        }, lchmod(e, t3) {
          FS.chmod(e, t3, true);
        }, fchmod(e, t3) {
          var r = FS.getStreamChecked(e);
          FS.chmod(r.node, t3);
        }, chown(e, t3, r, a3) {
          var o5;
          if (typeof e == "string") {
            var _4 = FS.lookupPath(e, { follow: !a3 });
            o5 = _4.node;
          } else o5 = e;
          if (!o5.node_ops.setattr) throw new FS.ErrnoError(63);
          o5.node_ops.setattr(o5, { timestamp: Date.now() });
        }, lchown(e, t3, r) {
          FS.chown(e, t3, r, true);
        }, fchown(e, t3, r) {
          var a3 = FS.getStreamChecked(e);
          FS.chown(a3.node, t3, r);
        }, truncate(e, t3) {
          if (t3 < 0) throw new FS.ErrnoError(28);
          var r;
          if (typeof e == "string") {
            var a3 = FS.lookupPath(e, { follow: true });
            r = a3.node;
          } else r = e;
          if (!r.node_ops.setattr) throw new FS.ErrnoError(63);
          if (FS.isDir(r.mode)) throw new FS.ErrnoError(31);
          if (!FS.isFile(r.mode)) throw new FS.ErrnoError(28);
          var o5 = FS.nodePermissions(r, "w");
          if (o5) throw new FS.ErrnoError(o5);
          r.node_ops.setattr(r, { size: t3, timestamp: Date.now() });
        }, ftruncate(e, t3) {
          var r = FS.getStreamChecked(e);
          if (!(r.flags & 2097155)) throw new FS.ErrnoError(28);
          FS.truncate(r.node, t3);
        }, utime(e, t3, r) {
          var a3 = FS.lookupPath(e, { follow: true }), o5 = a3.node;
          o5.node_ops.setattr(o5, { atime: t3, mtime: r });
        }, open(e, t3, r = 438) {
          if (e === "") throw new FS.ErrnoError(44);
          t3 = typeof t3 == "string" ? FS_modeStringToFlags(t3) : t3, t3 & 64 ? r = r & 4095 | 32768 : r = 0;
          var a3;
          if (typeof e == "object") a3 = e;
          else {
            var o5 = FS.lookupPath(e, { follow: !(t3 & 131072), noent_okay: true });
            a3 = o5.node, e = o5.path;
          }
          var _4 = false;
          if (t3 & 64) if (a3) {
            if (t3 & 128) throw new FS.ErrnoError(20);
          } else a3 = FS.mknod(e, r, 0), _4 = true;
          if (!a3) throw new FS.ErrnoError(44);
          if (FS.isChrdev(a3.mode) && (t3 &= -513), t3 & 65536 && !FS.isDir(a3.mode)) throw new FS.ErrnoError(54);
          if (!_4) {
            var s5 = FS.mayOpen(a3, t3);
            if (s5) throw new FS.ErrnoError(s5);
          }
          t3 & 512 && !_4 && FS.truncate(a3, 0), t3 &= -131713;
          var n3 = FS.createStream({ node: a3, path: FS.getPath(a3), flags: t3, seekable: true, position: 0, stream_ops: a3.stream_ops, ungotten: [], error: false });
          return n3.stream_ops.open && n3.stream_ops.open(n3), Module.logReadFiles && !(t3 & 1) && (e in FS.readFiles || (FS.readFiles[e] = 1)), n3;
        }, close(e) {
          if (FS.isClosed(e)) throw new FS.ErrnoError(8);
          e.getdents && (e.getdents = null);
          try {
            e.stream_ops.close && e.stream_ops.close(e);
          } catch (t3) {
            throw t3;
          } finally {
            FS.closeStream(e.fd);
          }
          e.fd = null;
        }, isClosed(e) {
          return e.fd === null;
        }, llseek(e, t3, r) {
          if (FS.isClosed(e)) throw new FS.ErrnoError(8);
          if (!e.seekable || !e.stream_ops.llseek) throw new FS.ErrnoError(70);
          if (r != 0 && r != 1 && r != 2) throw new FS.ErrnoError(28);
          return e.position = e.stream_ops.llseek(e, t3, r), e.ungotten = [], e.position;
        }, read(e, t3, r, a3, o5) {
          if (a3 < 0 || o5 < 0) throw new FS.ErrnoError(28);
          if (FS.isClosed(e)) throw new FS.ErrnoError(8);
          if ((e.flags & 2097155) === 1) throw new FS.ErrnoError(8);
          if (FS.isDir(e.node.mode)) throw new FS.ErrnoError(31);
          if (!e.stream_ops.read) throw new FS.ErrnoError(28);
          var _4 = typeof o5 < "u";
          if (!_4) o5 = e.position;
          else if (!e.seekable) throw new FS.ErrnoError(70);
          var s5 = e.stream_ops.read(e, t3, r, a3, o5);
          return _4 || (e.position += s5), s5;
        }, write(e, t3, r, a3, o5, _4) {
          if (a3 < 0 || o5 < 0) throw new FS.ErrnoError(28);
          if (FS.isClosed(e)) throw new FS.ErrnoError(8);
          if (!(e.flags & 2097155)) throw new FS.ErrnoError(8);
          if (FS.isDir(e.node.mode)) throw new FS.ErrnoError(31);
          if (!e.stream_ops.write) throw new FS.ErrnoError(28);
          e.seekable && e.flags & 1024 && FS.llseek(e, 0, 2);
          var s5 = typeof o5 < "u";
          if (!s5) o5 = e.position;
          else if (!e.seekable) throw new FS.ErrnoError(70);
          var n3 = e.stream_ops.write(e, t3, r, a3, o5, _4);
          return s5 || (e.position += n3), n3;
        }, allocate(e, t3, r) {
          if (FS.isClosed(e)) throw new FS.ErrnoError(8);
          if (t3 < 0 || r <= 0) throw new FS.ErrnoError(28);
          if (!(e.flags & 2097155)) throw new FS.ErrnoError(8);
          if (!FS.isFile(e.node.mode) && !FS.isDir(e.node.mode)) throw new FS.ErrnoError(43);
          if (!e.stream_ops.allocate) throw new FS.ErrnoError(138);
          e.stream_ops.allocate(e, t3, r);
        }, mmap(e, t3, r, a3, o5) {
          if (a3 & 2 && !(o5 & 2) && (e.flags & 2097155) !== 2) throw new FS.ErrnoError(2);
          if ((e.flags & 2097155) === 1) throw new FS.ErrnoError(2);
          if (!e.stream_ops.mmap) throw new FS.ErrnoError(43);
          if (!t3) throw new FS.ErrnoError(28);
          return e.stream_ops.mmap(e, t3, r, a3, o5);
        }, msync(e, t3, r, a3, o5) {
          return e.stream_ops.msync ? e.stream_ops.msync(e, t3, r, a3, o5) : 0;
        }, ioctl(e, t3, r) {
          if (!e.stream_ops.ioctl) throw new FS.ErrnoError(59);
          return e.stream_ops.ioctl(e, t3, r);
        }, readFile(e, t3 = {}) {
          if (t3.flags = t3.flags || 0, t3.encoding = t3.encoding || "binary", t3.encoding !== "utf8" && t3.encoding !== "binary") throw new Error(`Invalid encoding type "${t3.encoding}"`);
          var r, a3 = FS.open(e, t3.flags), o5 = FS.stat(e), _4 = o5.size, s5 = new Uint8Array(_4);
          return FS.read(a3, s5, 0, _4, 0), t3.encoding === "utf8" ? r = UTF8ArrayToString(s5) : t3.encoding === "binary" && (r = s5), FS.close(a3), r;
        }, writeFile(e, t3, r = {}) {
          r.flags = r.flags || 577;
          var a3 = FS.open(e, r.flags, r.mode);
          if (typeof t3 == "string") {
            var o5 = new Uint8Array(lengthBytesUTF8(t3) + 1), _4 = stringToUTF8Array(t3, o5, 0, o5.length);
            FS.write(a3, o5, 0, _4, void 0, r.canOwn);
          } else if (ArrayBuffer.isView(t3)) FS.write(a3, t3, 0, t3.byteLength, void 0, r.canOwn);
          else throw new Error("Unsupported data type");
          FS.close(a3);
        }, cwd: () => FS.currentPath, chdir(e) {
          var t3 = FS.lookupPath(e, { follow: true });
          if (t3.node === null) throw new FS.ErrnoError(44);
          if (!FS.isDir(t3.node.mode)) throw new FS.ErrnoError(54);
          var r = FS.nodePermissions(t3.node, "x");
          if (r) throw new FS.ErrnoError(r);
          FS.currentPath = t3.path;
        }, createDefaultDirectories() {
          FS.mkdir("/tmp"), FS.mkdir("/home"), FS.mkdir("/home/web_user");
        }, createDefaultDevices() {
          FS.mkdir("/dev"), FS.registerDevice(FS.makedev(1, 3), { read: () => 0, write: (a3, o5, _4, s5, n3) => s5, llseek: () => 0 }), FS.mkdev("/dev/null", FS.makedev(1, 3)), TTY.register(FS.makedev(5, 0), TTY.default_tty_ops), TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops), FS.mkdev("/dev/tty", FS.makedev(5, 0)), FS.mkdev("/dev/tty1", FS.makedev(6, 0));
          var e = new Uint8Array(1024), t3 = 0, r = () => (t3 === 0 && (t3 = randomFill(e).byteLength), e[--t3]);
          FS.createDevice("/dev", "random", r), FS.createDevice("/dev", "urandom", r), FS.mkdir("/dev/shm"), FS.mkdir("/dev/shm/tmp");
        }, createSpecialDirectories() {
          FS.mkdir("/proc");
          var e = FS.mkdir("/proc/self");
          FS.mkdir("/proc/self/fd"), FS.mount({ mount() {
            var t3 = FS.createNode(e, "fd", 16895, 73);
            return t3.stream_ops = { llseek: MEMFS.stream_ops.llseek }, t3.node_ops = { lookup(r, a3) {
              var o5 = +a3, _4 = FS.getStreamChecked(o5), s5 = { parent: null, mount: { mountpoint: "fake" }, node_ops: { readlink: () => _4.path }, id: o5 + 1 };
              return s5.parent = s5, s5;
            }, readdir() {
              return Array.from(FS.streams.entries()).filter(([r, a3]) => a3).map(([r, a3]) => r.toString());
            } }, t3;
          } }, {}, "/proc/self/fd");
        }, createStandardStreams(e, t3, r) {
          e ? FS.createDevice("/dev", "stdin", e) : FS.symlink("/dev/tty", "/dev/stdin"), t3 ? FS.createDevice("/dev", "stdout", null, t3) : FS.symlink("/dev/tty", "/dev/stdout"), r ? FS.createDevice("/dev", "stderr", null, r) : FS.symlink("/dev/tty1", "/dev/stderr");
          var a3 = FS.open("/dev/stdin", 0), o5 = FS.open("/dev/stdout", 1), _4 = FS.open("/dev/stderr", 1);
        }, staticInit() {
          FS.nameTable = new Array(4096), FS.mount(MEMFS, {}, "/"), FS.createDefaultDirectories(), FS.createDefaultDevices(), FS.createSpecialDirectories(), FS.filesystems = { MEMFS, IDBFS, NODEFS, PROXYFS };
        }, init(e, t3, r) {
          FS.initialized = true, e ?? (e = Module.stdin), t3 ?? (t3 = Module.stdout), r ?? (r = Module.stderr), FS.createStandardStreams(e, t3, r);
        }, quit() {
          FS.initialized = false, _fflush(0);
          for (var e = 0; e < FS.streams.length; e++) {
            var t3 = FS.streams[e];
            t3 && FS.close(t3);
          }
        }, findObject(e, t3) {
          var r = FS.analyzePath(e, t3);
          return r.exists ? r.object : null;
        }, analyzePath(e, t3) {
          try {
            var r = FS.lookupPath(e, { follow: !t3 });
            e = r.path;
          } catch {
          }
          var a3 = { isRoot: false, exists: false, error: 0, name: null, path: null, object: null, parentExists: false, parentPath: null, parentObject: null };
          try {
            var r = FS.lookupPath(e, { parent: true });
            a3.parentExists = true, a3.parentPath = r.path, a3.parentObject = r.node, a3.name = PATH.basename(e), r = FS.lookupPath(e, { follow: !t3 }), a3.exists = true, a3.path = r.path, a3.object = r.node, a3.name = r.node.name, a3.isRoot = r.path === "/";
          } catch (o5) {
            a3.error = o5.errno;
          }
          return a3;
        }, createPath(e, t3, r, a3) {
          e = typeof e == "string" ? e : FS.getPath(e);
          for (var o5 = t3.split("/").reverse(); o5.length; ) {
            var _4 = o5.pop();
            if (_4) {
              var s5 = PATH.join2(e, _4);
              try {
                FS.mkdir(s5);
              } catch {
              }
              e = s5;
            }
          }
          return s5;
        }, createFile(e, t3, r, a3, o5) {
          var _4 = PATH.join2(typeof e == "string" ? e : FS.getPath(e), t3), s5 = FS_getMode(a3, o5);
          return FS.create(_4, s5);
        }, createDataFile(e, t3, r, a3, o5, _4) {
          var s5 = t3;
          e && (e = typeof e == "string" ? e : FS.getPath(e), s5 = t3 ? PATH.join2(e, t3) : e);
          var n3 = FS_getMode(a3, o5), l2 = FS.create(s5, n3);
          if (r) {
            if (typeof r == "string") {
              for (var d3 = new Array(r.length), u3 = 0, c4 = r.length; u3 < c4; ++u3) d3[u3] = r.charCodeAt(u3);
              r = d3;
            }
            FS.chmod(l2, n3 | 146);
            var f5 = FS.open(l2, 577);
            FS.write(f5, r, 0, r.length, 0, _4), FS.close(f5), FS.chmod(l2, n3);
          }
        }, createDevice(e, t3, r, a3) {
          var n3;
          var o5 = PATH.join2(typeof e == "string" ? e : FS.getPath(e), t3), _4 = FS_getMode(!!r, !!a3);
          (n3 = FS.createDevice).major ?? (n3.major = 64);
          var s5 = FS.makedev(FS.createDevice.major++, 0);
          return FS.registerDevice(s5, { open(l2) {
            l2.seekable = false;
          }, close(l2) {
            a3?.buffer?.length && a3(10);
          }, read(l2, d3, u3, c4, f5) {
            for (var g4 = 0, m5 = 0; m5 < c4; m5++) {
              var p6;
              try {
                p6 = r();
              } catch {
                throw new FS.ErrnoError(29);
              }
              if (p6 === void 0 && g4 === 0) throw new FS.ErrnoError(6);
              if (p6 == null) break;
              g4++, d3[u3 + m5] = p6;
            }
            return g4 && (l2.node.atime = Date.now()), g4;
          }, write(l2, d3, u3, c4, f5) {
            for (var g4 = 0; g4 < c4; g4++) try {
              a3(d3[u3 + g4]);
            } catch {
              throw new FS.ErrnoError(29);
            }
            return c4 && (l2.node.mtime = l2.node.ctime = Date.now()), g4;
          } }), FS.mkdev(o5, _4, s5);
        }, forceLoadFile(e) {
          if (e.isDevice || e.isFolder || e.link || e.contents) return true;
          if (typeof XMLHttpRequest < "u") throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
          try {
            e.contents = readBinary(e.url), e.usedBytes = e.contents.length;
          } catch {
            throw new FS.ErrnoError(29);
          }
        }, createLazyFile(e, t3, r, a3, o5) {
          class _4 {
            constructor() {
              P(this, "lengthKnown", false);
              P(this, "chunks", []);
            }
            get(g4) {
              if (!(g4 > this.length - 1 || g4 < 0)) {
                var m5 = g4 % this.chunkSize, p6 = g4 / this.chunkSize | 0;
                return this.getter(p6)[m5];
              }
            }
            setDataGetter(g4) {
              this.getter = g4;
            }
            cacheLength() {
              var g4 = new XMLHttpRequest();
              if (g4.open("HEAD", r, false), g4.send(null), !(g4.status >= 200 && g4.status < 300 || g4.status === 304)) throw new Error("Couldn't load " + r + ". Status: " + g4.status);
              var m5 = Number(g4.getResponseHeader("Content-length")), p6, h3 = (p6 = g4.getResponseHeader("Accept-Ranges")) && p6 === "bytes", x4 = (p6 = g4.getResponseHeader("Content-Encoding")) && p6 === "gzip", b4 = 1024 * 1024;
              h3 || (b4 = m5);
              var M3 = (E3, F4) => {
                if (E3 > F4) throw new Error("invalid range (" + E3 + ", " + F4 + ") or no bytes requested!");
                if (F4 > m5 - 1) throw new Error("only " + m5 + " bytes available! programmer error!");
                var k3 = new XMLHttpRequest();
                if (k3.open("GET", r, false), m5 !== b4 && k3.setRequestHeader("Range", "bytes=" + E3 + "-" + F4), k3.responseType = "arraybuffer", k3.overrideMimeType && k3.overrideMimeType("text/plain; charset=x-user-defined"), k3.send(null), !(k3.status >= 200 && k3.status < 300 || k3.status === 304)) throw new Error("Couldn't load " + r + ". Status: " + k3.status);
                return k3.response !== void 0 ? new Uint8Array(k3.response || []) : intArrayFromString(k3.responseText || "", true);
              }, y5 = this;
              y5.setDataGetter((E3) => {
                var F4 = E3 * b4, k3 = (E3 + 1) * b4 - 1;
                if (k3 = Math.min(k3, m5 - 1), typeof y5.chunks[E3] > "u" && (y5.chunks[E3] = M3(F4, k3)), typeof y5.chunks[E3] > "u") throw new Error("doXHR failed!");
                return y5.chunks[E3];
              }), (x4 || !m5) && (b4 = m5 = 1, m5 = this.getter(0).length, b4 = m5, out("LazyFiles on gzip forces download of the whole file when length is accessed")), this._length = m5, this._chunkSize = b4, this.lengthKnown = true;
            }
            get length() {
              return this.lengthKnown || this.cacheLength(), this._length;
            }
            get chunkSize() {
              return this.lengthKnown || this.cacheLength(), this._chunkSize;
            }
          }
          if (typeof XMLHttpRequest < "u") {
            if (!ENVIRONMENT_IS_WORKER) throw "Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";
            var s5 = new _4(), n3 = { isDevice: false, contents: s5 };
          } else var n3 = { isDevice: false, url: r };
          var l2 = FS.createFile(e, t3, n3, a3, o5);
          n3.contents ? l2.contents = n3.contents : n3.url && (l2.contents = null, l2.url = n3.url), Object.defineProperties(l2, { usedBytes: { get: function() {
            return this.contents.length;
          } } });
          var d3 = {}, u3 = Object.keys(l2.stream_ops);
          u3.forEach((f5) => {
            var g4 = l2.stream_ops[f5];
            d3[f5] = (...m5) => (FS.forceLoadFile(l2), g4(...m5));
          });
          function c4(f5, g4, m5, p6, h3) {
            var x4 = f5.node.contents;
            if (h3 >= x4.length) return 0;
            var b4 = Math.min(x4.length - h3, p6);
            if (x4.slice) for (var M3 = 0; M3 < b4; M3++) g4[m5 + M3] = x4[h3 + M3];
            else for (var M3 = 0; M3 < b4; M3++) g4[m5 + M3] = x4.get(h3 + M3);
            return b4;
          }
          return d3.read = (f5, g4, m5, p6, h3) => (FS.forceLoadFile(l2), c4(f5, g4, m5, p6, h3)), d3.mmap = (f5, g4, m5, p6, h3) => {
            FS.forceLoadFile(l2);
            var x4 = mmapAlloc(g4);
            if (!x4) throw new FS.ErrnoError(48);
            return c4(f5, HEAP8, x4, g4, m5), { ptr: x4, allocated: true };
          }, l2.stream_ops = d3, l2;
        } }, SYSCALLS = { DEFAULT_POLLMASK: 5, calculateAt(e, t3, r) {
          if (PATH.isAbs(t3)) return t3;
          var a3;
          if (e === -100) a3 = FS.cwd();
          else {
            var o5 = SYSCALLS.getStreamFromFD(e);
            a3 = o5.path;
          }
          if (t3.length == 0) {
            if (!r) throw new FS.ErrnoError(44);
            return a3;
          }
          return a3 + "/" + t3;
        }, doStat(e, t3, r) {
          var a3 = e(t3);
          HEAP32[r >> 2] = a3.dev, HEAP32[r + 4 >> 2] = a3.mode, HEAPU32[r + 8 >> 2] = a3.nlink, HEAP32[r + 12 >> 2] = a3.uid, HEAP32[r + 16 >> 2] = a3.gid, HEAP32[r + 20 >> 2] = a3.rdev, HEAP64[r + 24 >> 3] = BigInt(a3.size), HEAP32[r + 32 >> 2] = 4096, HEAP32[r + 36 >> 2] = a3.blocks;
          var o5 = a3.atime.getTime(), _4 = a3.mtime.getTime(), s5 = a3.ctime.getTime();
          return HEAP64[r + 40 >> 3] = BigInt(Math.floor(o5 / 1e3)), HEAPU32[r + 48 >> 2] = o5 % 1e3 * 1e3 * 1e3, HEAP64[r + 56 >> 3] = BigInt(Math.floor(_4 / 1e3)), HEAPU32[r + 64 >> 2] = _4 % 1e3 * 1e3 * 1e3, HEAP64[r + 72 >> 3] = BigInt(Math.floor(s5 / 1e3)), HEAPU32[r + 80 >> 2] = s5 % 1e3 * 1e3 * 1e3, HEAP64[r + 88 >> 3] = BigInt(a3.ino), 0;
        }, doMsync(e, t3, r, a3, o5) {
          if (!FS.isFile(t3.node.mode)) throw new FS.ErrnoError(43);
          if (a3 & 2) return 0;
          var _4 = HEAPU8.slice(e, e + r);
          FS.msync(t3, _4, o5, r, a3);
        }, getStreamFromFD(e) {
          var t3 = FS.getStreamChecked(e);
          return t3;
        }, varargs: void 0, getStr(e) {
          var t3 = UTF8ToString(e);
          return t3;
        } }, ___syscall__newselect = function(e, t3, r, a3, o5) {
          try {
            for (var _4 = 0, s5 = t3 ? HEAP32[t3 >> 2] : 0, n3 = t3 ? HEAP32[t3 + 4 >> 2] : 0, l2 = r ? HEAP32[r >> 2] : 0, d3 = r ? HEAP32[r + 4 >> 2] : 0, u3 = a3 ? HEAP32[a3 >> 2] : 0, c4 = a3 ? HEAP32[a3 + 4 >> 2] : 0, f5 = 0, g4 = 0, m5 = 0, p6 = 0, h3 = 0, x4 = 0, b4 = (t3 ? HEAP32[t3 >> 2] : 0) | (r ? HEAP32[r >> 2] : 0) | (a3 ? HEAP32[a3 >> 2] : 0), M3 = (t3 ? HEAP32[t3 + 4 >> 2] : 0) | (r ? HEAP32[r + 4 >> 2] : 0) | (a3 ? HEAP32[a3 + 4 >> 2] : 0), y5 = (X2, I3, G4, q2) => X2 < 32 ? I3 & q2 : G4 & q2, E3 = 0; E3 < e; E3++) {
              var F4 = 1 << E3 % 32;
              if (y5(E3, b4, M3, F4)) {
                var k3 = SYSCALLS.getStreamFromFD(E3), R3 = SYSCALLS.DEFAULT_POLLMASK;
                if (k3.stream_ops.poll) {
                  var D5 = -1;
                  if (o5) {
                    var te = t3 ? HEAP32[o5 >> 2] : 0, H3 = t3 ? HEAP32[o5 + 4 >> 2] : 0;
                    D5 = (te + H3 / 1e6) * 1e3;
                  }
                  R3 = k3.stream_ops.poll(k3, D5);
                }
                R3 & 1 && y5(E3, s5, n3, F4) && (E3 < 32 ? f5 = f5 | F4 : g4 = g4 | F4, _4++), R3 & 4 && y5(E3, l2, d3, F4) && (E3 < 32 ? m5 = m5 | F4 : p6 = p6 | F4, _4++), R3 & 2 && y5(E3, u3, c4, F4) && (E3 < 32 ? h3 = h3 | F4 : x4 = x4 | F4, _4++);
              }
            }
            return t3 && (HEAP32[t3 >> 2] = f5, HEAP32[t3 + 4 >> 2] = g4), r && (HEAP32[r >> 2] = m5, HEAP32[r + 4 >> 2] = p6), a3 && (HEAP32[a3 >> 2] = h3, HEAP32[a3 + 4 >> 2] = x4), _4;
          } catch (X2) {
            if (typeof FS > "u" || X2.name !== "ErrnoError") throw X2;
            return -X2.errno;
          }
        };
        ___syscall__newselect.sig = "iipppp";
        var SOCKFS = { websocketArgs: {}, callbacks: {}, on(e, t3) {
          SOCKFS.callbacks[e] = t3;
        }, emit(e, t3) {
          SOCKFS.callbacks[e]?.(t3);
        }, mount(e) {
          return SOCKFS.websocketArgs = Module.websocket || {}, (Module.websocket ?? (Module.websocket = {})).on = SOCKFS.on, FS.createNode(null, "/", 16895, 0);
        }, createSocket(e, t3, r) {
          t3 &= -526337;
          var a3 = t3 == 1;
          if (a3 && r && r != 6) throw new FS.ErrnoError(66);
          var o5 = { family: e, type: t3, protocol: r, server: null, error: null, peers: {}, pending: [], recv_queue: [], sock_ops: SOCKFS.websocket_sock_ops }, _4 = SOCKFS.nextname(), s5 = FS.createNode(SOCKFS.root, _4, 49152, 0);
          s5.sock = o5;
          var n3 = FS.createStream({ path: _4, node: s5, flags: 2, seekable: false, stream_ops: SOCKFS.stream_ops });
          return o5.stream = n3, o5;
        }, getSocket(e) {
          var t3 = FS.getStream(e);
          return !t3 || !FS.isSocket(t3.node.mode) ? null : t3.node.sock;
        }, stream_ops: { poll(e) {
          var t3 = e.node.sock;
          return t3.sock_ops.poll(t3);
        }, ioctl(e, t3, r) {
          var a3 = e.node.sock;
          return a3.sock_ops.ioctl(a3, t3, r);
        }, read(e, t3, r, a3, o5) {
          var _4 = e.node.sock, s5 = _4.sock_ops.recvmsg(_4, a3);
          return s5 ? (t3.set(s5.buffer, r), s5.buffer.length) : 0;
        }, write(e, t3, r, a3, o5) {
          var _4 = e.node.sock;
          return _4.sock_ops.sendmsg(_4, t3, r, a3);
        }, close(e) {
          var t3 = e.node.sock;
          t3.sock_ops.close(t3);
        } }, nextname() {
          return SOCKFS.nextname.current || (SOCKFS.nextname.current = 0), `socket[${SOCKFS.nextname.current++}]`;
        }, websocket_sock_ops: { createPeer(e, t3, r) {
          var a3;
          if (typeof t3 == "object" && (a3 = t3, t3 = null, r = null), a3) if (a3._socket) t3 = a3._socket.remoteAddress, r = a3._socket.remotePort;
          else {
            var o5 = /ws[s]?:\/\/([^:]+):(\d+)/.exec(a3.url);
            if (!o5) throw new Error("WebSocket URL must be in the format ws(s)://address:port");
            t3 = o5[1], r = parseInt(o5[2], 10);
          }
          else try {
            var _4 = "ws:#".replace("#", "//"), s5 = "binary", n3 = void 0;
            if (SOCKFS.websocketArgs.url && (_4 = SOCKFS.websocketArgs.url), SOCKFS.websocketArgs.subprotocol ? s5 = SOCKFS.websocketArgs.subprotocol : SOCKFS.websocketArgs.subprotocol === null && (s5 = "null"), _4 === "ws://" || _4 === "wss://") {
              var l2 = t3.split("/");
              _4 = _4 + l2[0] + ":" + r + "/" + l2.slice(1).join("/");
            }
            s5 !== "null" && (s5 = s5.replace(/^ +| +$/g, "").split(/ *, */), n3 = s5);
            var d3;
            ENVIRONMENT_IS_NODE ? d3 = require("ws") : d3 = WebSocket, a3 = new d3(_4, n3), a3.binaryType = "arraybuffer";
          } catch {
            throw new FS.ErrnoError(23);
          }
          var u3 = { addr: t3, port: r, socket: a3, msg_send_queue: [] };
          return SOCKFS.websocket_sock_ops.addPeer(e, u3), SOCKFS.websocket_sock_ops.handlePeerEvents(e, u3), e.type === 2 && typeof e.sport < "u" && u3.msg_send_queue.push(new Uint8Array([255, 255, 255, 255, 112, 111, 114, 116, (e.sport & 65280) >> 8, e.sport & 255])), u3;
        }, getPeer(e, t3, r) {
          return e.peers[t3 + ":" + r];
        }, addPeer(e, t3) {
          e.peers[t3.addr + ":" + t3.port] = t3;
        }, removePeer(e, t3) {
          delete e.peers[t3.addr + ":" + t3.port];
        }, handlePeerEvents(e, t3) {
          var r = true, a3 = function() {
            e.connecting = false, SOCKFS.emit("open", e.stream.fd);
            try {
              for (var _4 = t3.msg_send_queue.shift(); _4; ) t3.socket.send(_4), _4 = t3.msg_send_queue.shift();
            } catch {
              t3.socket.close();
            }
          };
          function o5(_4) {
            if (typeof _4 == "string") {
              var s5 = new TextEncoder();
              _4 = s5.encode(_4);
            } else {
              if (assert(_4.byteLength !== void 0), _4.byteLength == 0) return;
              _4 = new Uint8Array(_4);
            }
            var n3 = r;
            if (r = false, n3 && _4.length === 10 && _4[0] === 255 && _4[1] === 255 && _4[2] === 255 && _4[3] === 255 && _4[4] === 112 && _4[5] === 111 && _4[6] === 114 && _4[7] === 116) {
              var l2 = _4[8] << 8 | _4[9];
              SOCKFS.websocket_sock_ops.removePeer(e, t3), t3.port = l2, SOCKFS.websocket_sock_ops.addPeer(e, t3);
              return;
            }
            e.recv_queue.push({ addr: t3.addr, port: t3.port, data: _4 }), SOCKFS.emit("message", e.stream.fd);
          }
          ENVIRONMENT_IS_NODE ? (t3.socket.on("open", a3), t3.socket.on("message", function(_4, s5) {
            s5 && o5(new Uint8Array(_4).buffer);
          }), t3.socket.on("close", function() {
            SOCKFS.emit("close", e.stream.fd);
          }), t3.socket.on("error", function(_4) {
            e.error = 14, SOCKFS.emit("error", [e.stream.fd, e.error, "ECONNREFUSED: Connection refused"]);
          })) : (t3.socket.onopen = a3, t3.socket.onclose = function() {
            SOCKFS.emit("close", e.stream.fd);
          }, t3.socket.onmessage = function(s5) {
            o5(s5.data);
          }, t3.socket.onerror = function(_4) {
            e.error = 14, SOCKFS.emit("error", [e.stream.fd, e.error, "ECONNREFUSED: Connection refused"]);
          });
        }, poll(e) {
          if (e.type === 1 && e.server) return e.pending.length ? 65 : 0;
          var t3 = 0, r = e.type === 1 ? SOCKFS.websocket_sock_ops.getPeer(e, e.daddr, e.dport) : null;
          return (e.recv_queue.length || !r || r && r.socket.readyState === r.socket.CLOSING || r && r.socket.readyState === r.socket.CLOSED) && (t3 |= 65), (!r || r && r.socket.readyState === r.socket.OPEN) && (t3 |= 4), (r && r.socket.readyState === r.socket.CLOSING || r && r.socket.readyState === r.socket.CLOSED) && (e.connecting ? t3 |= 4 : t3 |= 16), t3;
        }, ioctl(e, t3, r) {
          switch (t3) {
            case 21531:
              var a3 = 0;
              return e.recv_queue.length && (a3 = e.recv_queue[0].data.length), HEAP32[r >> 2] = a3, 0;
            default:
              return 28;
          }
        }, close(e) {
          if (e.server) {
            try {
              e.server.close();
            } catch {
            }
            e.server = null;
          }
          for (var t3 = Object.keys(e.peers), r = 0; r < t3.length; r++) {
            var a3 = e.peers[t3[r]];
            try {
              a3.socket.close();
            } catch {
            }
            SOCKFS.websocket_sock_ops.removePeer(e, a3);
          }
          return 0;
        }, bind(e, t3, r) {
          if (typeof e.saddr < "u" || typeof e.sport < "u") throw new FS.ErrnoError(28);
          if (e.saddr = t3, e.sport = r, e.type === 2) {
            e.server && (e.server.close(), e.server = null);
            try {
              e.sock_ops.listen(e, 0);
            } catch (a3) {
              if (a3.name !== "ErrnoError" || a3.errno !== 138) throw a3;
            }
          }
        }, connect(e, t3, r) {
          if (e.server) throw new FS.ErrnoError(138);
          if (typeof e.daddr < "u" && typeof e.dport < "u") {
            var a3 = SOCKFS.websocket_sock_ops.getPeer(e, e.daddr, e.dport);
            if (a3) throw a3.socket.readyState === a3.socket.CONNECTING ? new FS.ErrnoError(7) : new FS.ErrnoError(30);
          }
          var o5 = SOCKFS.websocket_sock_ops.createPeer(e, t3, r);
          e.daddr = o5.addr, e.dport = o5.port, e.connecting = true;
        }, listen(e, t3) {
          if (!ENVIRONMENT_IS_NODE) throw new FS.ErrnoError(138);
          if (e.server) throw new FS.ErrnoError(28);
          var r = require("ws").Server, a3 = e.saddr;
          e.server = new r({ host: a3, port: e.sport }), SOCKFS.emit("listen", e.stream.fd), e.server.on("connection", function(o5) {
            if (e.type === 1) {
              var _4 = SOCKFS.createSocket(e.family, e.type, e.protocol), s5 = SOCKFS.websocket_sock_ops.createPeer(_4, o5);
              _4.daddr = s5.addr, _4.dport = s5.port, e.pending.push(_4), SOCKFS.emit("connection", _4.stream.fd);
            } else SOCKFS.websocket_sock_ops.createPeer(e, o5), SOCKFS.emit("connection", e.stream.fd);
          }), e.server.on("close", function() {
            SOCKFS.emit("close", e.stream.fd), e.server = null;
          }), e.server.on("error", function(o5) {
            e.error = 23, SOCKFS.emit("error", [e.stream.fd, e.error, "EHOSTUNREACH: Host is unreachable"]);
          });
        }, accept(e) {
          if (!e.server || !e.pending.length) throw new FS.ErrnoError(28);
          var t3 = e.pending.shift();
          return t3.stream.flags = e.stream.flags, t3;
        }, getname(e, t3) {
          var r, a3;
          if (t3) {
            if (e.daddr === void 0 || e.dport === void 0) throw new FS.ErrnoError(53);
            r = e.daddr, a3 = e.dport;
          } else r = e.saddr || 0, a3 = e.sport || 0;
          return { addr: r, port: a3 };
        }, sendmsg(e, t3, r, a3, o5, _4) {
          if (e.type === 2) {
            if ((o5 === void 0 || _4 === void 0) && (o5 = e.daddr, _4 = e.dport), o5 === void 0 || _4 === void 0) throw new FS.ErrnoError(17);
          } else o5 = e.daddr, _4 = e.dport;
          var s5 = SOCKFS.websocket_sock_ops.getPeer(e, o5, _4);
          if (e.type === 1 && (!s5 || s5.socket.readyState === s5.socket.CLOSING || s5.socket.readyState === s5.socket.CLOSED)) throw new FS.ErrnoError(53);
          ArrayBuffer.isView(t3) && (r += t3.byteOffset, t3 = t3.buffer);
          var n3 = t3.slice(r, r + a3);
          if (!s5 || s5.socket.readyState !== s5.socket.OPEN) return e.type === 2 && (!s5 || s5.socket.readyState === s5.socket.CLOSING || s5.socket.readyState === s5.socket.CLOSED) && (s5 = SOCKFS.websocket_sock_ops.createPeer(e, o5, _4)), s5.msg_send_queue.push(n3), a3;
          try {
            return s5.socket.send(n3), a3;
          } catch {
            throw new FS.ErrnoError(28);
          }
        }, recvmsg(e, t3) {
          if (e.type === 1 && e.server) throw new FS.ErrnoError(53);
          var r = e.recv_queue.shift();
          if (!r) {
            if (e.type === 1) {
              var a3 = SOCKFS.websocket_sock_ops.getPeer(e, e.daddr, e.dport);
              if (!a3) throw new FS.ErrnoError(53);
              if (a3.socket.readyState === a3.socket.CLOSING || a3.socket.readyState === a3.socket.CLOSED) return null;
              throw new FS.ErrnoError(6);
            }
            throw new FS.ErrnoError(6);
          }
          var o5 = r.data.byteLength || r.data.length, _4 = r.data.byteOffset || 0, s5 = r.data.buffer || r.data, n3 = Math.min(t3, o5), l2 = { buffer: new Uint8Array(s5, _4, n3), addr: r.addr, port: r.port };
          if (e.type === 1 && n3 < o5) {
            var d3 = o5 - n3;
            r.data = new Uint8Array(s5, _4 + n3, d3), e.recv_queue.unshift(r);
          }
          return l2;
        } } }, getSocketFromFD = (e) => {
          var t3 = SOCKFS.getSocket(e);
          if (!t3) throw new FS.ErrnoError(8);
          return t3;
        }, inetPton4 = (e) => {
          for (var t3 = e.split("."), r = 0; r < 4; r++) {
            var a3 = Number(t3[r]);
            if (isNaN(a3)) return null;
            t3[r] = a3;
          }
          return (t3[0] | t3[1] << 8 | t3[2] << 16 | t3[3] << 24) >>> 0;
        }, jstoi_q = (e) => parseInt(e), inetPton6 = (e) => {
          var t3, r, a3, o5, _4 = /^((?=.*::)(?!.*::.+::)(::)?([\dA-F]{1,4}:(:|\b)|){5}|([\dA-F]{1,4}:){6})((([\dA-F]{1,4}((?!\3)::|:\b|$))|(?!\2\3)){2}|(((2[0-4]|1\d|[1-9])?\d|25[0-5])\.?\b){4})$/i, s5 = [];
          if (!_4.test(e)) return null;
          if (e === "::") return [0, 0, 0, 0, 0, 0, 0, 0];
          for (e.startsWith("::") ? e = e.replace("::", "Z:") : e = e.replace("::", ":Z:"), e.indexOf(".") > 0 ? (e = e.replace(new RegExp("[.]", "g"), ":"), t3 = e.split(":"), t3[t3.length - 4] = jstoi_q(t3[t3.length - 4]) + jstoi_q(t3[t3.length - 3]) * 256, t3[t3.length - 3] = jstoi_q(t3[t3.length - 2]) + jstoi_q(t3[t3.length - 1]) * 256, t3 = t3.slice(0, t3.length - 2)) : t3 = e.split(":"), a3 = 0, o5 = 0, r = 0; r < t3.length; r++) if (typeof t3[r] == "string") if (t3[r] === "Z") {
            for (o5 = 0; o5 < 8 - t3.length + 1; o5++) s5[r + o5] = 0;
            a3 = o5 - 1;
          } else s5[r + a3] = _htons(parseInt(t3[r], 16));
          else s5[r + a3] = t3[r];
          return [s5[1] << 16 | s5[0], s5[3] << 16 | s5[2], s5[5] << 16 | s5[4], s5[7] << 16 | s5[6]];
        }, writeSockaddr = (e, t3, r, a3, o5) => {
          switch (t3) {
            case 2:
              r = inetPton4(r), zeroMemory(e, 16), o5 && (HEAP32[o5 >> 2] = 16), HEAP16[e >> 1] = t3, HEAP32[e + 4 >> 2] = r, HEAP16[e + 2 >> 1] = _htons(a3);
              break;
            case 10:
              r = inetPton6(r), zeroMemory(e, 28), o5 && (HEAP32[o5 >> 2] = 28), HEAP32[e >> 2] = t3, HEAP32[e + 8 >> 2] = r[0], HEAP32[e + 12 >> 2] = r[1], HEAP32[e + 16 >> 2] = r[2], HEAP32[e + 20 >> 2] = r[3], HEAP16[e + 2 >> 1] = _htons(a3);
              break;
            default:
              return 5;
          }
          return 0;
        }, DNS = { address_map: { id: 1, addrs: {}, names: {} }, lookup_name(e) {
          var t3 = inetPton4(e);
          if (t3 !== null || (t3 = inetPton6(e), t3 !== null)) return e;
          var r;
          if (DNS.address_map.addrs[e]) r = DNS.address_map.addrs[e];
          else {
            var a3 = DNS.address_map.id++;
            assert(a3 < 65535, "exceeded max address mappings of 65535"), r = "172.29." + (a3 & 255) + "." + (a3 & 65280), DNS.address_map.names[r] = e, DNS.address_map.addrs[e] = r;
          }
          return r;
        }, lookup_addr(e) {
          return DNS.address_map.names[e] ? DNS.address_map.names[e] : null;
        } };
        function ___syscall_accept4(e, t3, r, a3, o5, _4) {
          try {
            var s5 = getSocketFromFD(e), n3 = s5.sock_ops.accept(s5);
            if (t3) var l2 = writeSockaddr(t3, n3.family, DNS.lookup_name(n3.daddr), n3.dport, r);
            return n3.stream.fd;
          } catch (d3) {
            if (typeof FS > "u" || d3.name !== "ErrnoError") throw d3;
            return -d3.errno;
          }
        }
        ___syscall_accept4.sig = "iippiii";
        var inetNtop4 = (e) => (e & 255) + "." + (e >> 8 & 255) + "." + (e >> 16 & 255) + "." + (e >> 24 & 255), inetNtop6 = (e) => {
          var t3 = "", r = 0, a3 = 0, o5 = 0, _4 = 0, s5 = 0, n3 = 0, l2 = [e[0] & 65535, e[0] >> 16, e[1] & 65535, e[1] >> 16, e[2] & 65535, e[2] >> 16, e[3] & 65535, e[3] >> 16], d3 = true, u3 = "";
          for (n3 = 0; n3 < 5; n3++) if (l2[n3] !== 0) {
            d3 = false;
            break;
          }
          if (d3) {
            if (u3 = inetNtop4(l2[6] | l2[7] << 16), l2[5] === -1) return t3 = "::ffff:", t3 += u3, t3;
            if (l2[5] === 0) return t3 = "::", u3 === "0.0.0.0" && (u3 = ""), u3 === "0.0.0.1" && (u3 = "1"), t3 += u3, t3;
          }
          for (r = 0; r < 8; r++) l2[r] === 0 && (r - o5 > 1 && (s5 = 0), o5 = r, s5++), s5 > a3 && (a3 = s5, _4 = r - a3 + 1);
          for (r = 0; r < 8; r++) {
            if (a3 > 1 && l2[r] === 0 && r >= _4 && r < _4 + a3) {
              r === _4 && (t3 += ":", _4 === 0 && (t3 += ":"));
              continue;
            }
            t3 += Number(_ntohs(l2[r] & 65535)).toString(16), t3 += r < 7 ? ":" : "";
          }
          return t3;
        }, readSockaddr = (e, t3) => {
          var r = HEAP16[e >> 1], a3 = _ntohs(HEAPU16[e + 2 >> 1]), o5;
          switch (r) {
            case 2:
              if (t3 !== 16) return { errno: 28 };
              o5 = HEAP32[e + 4 >> 2], o5 = inetNtop4(o5);
              break;
            case 10:
              if (t3 !== 28) return { errno: 28 };
              o5 = [HEAP32[e + 8 >> 2], HEAP32[e + 12 >> 2], HEAP32[e + 16 >> 2], HEAP32[e + 20 >> 2]], o5 = inetNtop6(o5);
              break;
            default:
              return { errno: 5 };
          }
          return { family: r, addr: o5, port: a3 };
        }, getSocketAddress = (e, t3) => {
          var r = readSockaddr(e, t3);
          if (r.errno) throw new FS.ErrnoError(r.errno);
          return r.addr = DNS.lookup_addr(r.addr) || r.addr, r;
        };
        function ___syscall_bind(e, t3, r, a3, o5, _4) {
          try {
            var s5 = getSocketFromFD(e), n3 = getSocketAddress(t3, r);
            return s5.sock_ops.bind(s5, n3.addr, n3.port), 0;
          } catch (l2) {
            if (typeof FS > "u" || l2.name !== "ErrnoError") throw l2;
            return -l2.errno;
          }
        }
        ___syscall_bind.sig = "iippiii";
        function ___syscall_chdir(e) {
          try {
            return e = SYSCALLS.getStr(e), FS.chdir(e), 0;
          } catch (t3) {
            if (typeof FS > "u" || t3.name !== "ErrnoError") throw t3;
            return -t3.errno;
          }
        }
        ___syscall_chdir.sig = "ip";
        function ___syscall_chmod(e, t3) {
          try {
            return e = SYSCALLS.getStr(e), FS.chmod(e, t3), 0;
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return -r.errno;
          }
        }
        ___syscall_chmod.sig = "ipi";
        function ___syscall_connect(e, t3, r, a3, o5, _4) {
          try {
            var s5 = getSocketFromFD(e), n3 = getSocketAddress(t3, r);
            return s5.sock_ops.connect(s5, n3.addr, n3.port), 0;
          } catch (l2) {
            if (typeof FS > "u" || l2.name !== "ErrnoError") throw l2;
            return -l2.errno;
          }
        }
        ___syscall_connect.sig = "iippiii";
        function ___syscall_dup(e) {
          try {
            var t3 = SYSCALLS.getStreamFromFD(e);
            return FS.dupStream(t3).fd;
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return -r.errno;
          }
        }
        ___syscall_dup.sig = "ii";
        function ___syscall_dup3(e, t3, r) {
          try {
            var a3 = SYSCALLS.getStreamFromFD(e);
            if (a3.fd === t3) return -28;
            if (t3 < 0 || t3 >= FS.MAX_OPEN_FDS) return -8;
            var o5 = FS.getStream(t3);
            return o5 && FS.close(o5), FS.dupStream(a3, t3).fd;
          } catch (_4) {
            if (typeof FS > "u" || _4.name !== "ErrnoError") throw _4;
            return -_4.errno;
          }
        }
        ___syscall_dup3.sig = "iiii";
        function ___syscall_faccessat(e, t3, r, a3) {
          try {
            if (t3 = SYSCALLS.getStr(t3), t3 = SYSCALLS.calculateAt(e, t3), r & -8) return -28;
            var o5 = FS.lookupPath(t3, { follow: true }), _4 = o5.node;
            if (!_4) return -44;
            var s5 = "";
            return r & 4 && (s5 += "r"), r & 2 && (s5 += "w"), r & 1 && (s5 += "x"), s5 && FS.nodePermissions(_4, s5) ? -2 : 0;
          } catch (n3) {
            if (typeof FS > "u" || n3.name !== "ErrnoError") throw n3;
            return -n3.errno;
          }
        }
        ___syscall_faccessat.sig = "iipii";
        var ___syscall_fadvise64 = (e, t3, r, a3) => 0;
        ___syscall_fadvise64.sig = "iijji";
        var INT53_MAX = 9007199254740992, INT53_MIN = -9007199254740992, bigintToI53Checked = (e) => e < INT53_MIN || e > INT53_MAX ? NaN : Number(e);
        function ___syscall_fallocate(e, t3, r, a3) {
          r = bigintToI53Checked(r), a3 = bigintToI53Checked(a3);
          try {
            if (isNaN(r)) return 61;
            var o5 = SYSCALLS.getStreamFromFD(e);
            return FS.allocate(o5, r, a3), 0;
          } catch (_4) {
            if (typeof FS > "u" || _4.name !== "ErrnoError") throw _4;
            return -_4.errno;
          }
        }
        ___syscall_fallocate.sig = "iiijj";
        function ___syscall_fchmod(e, t3) {
          try {
            return FS.fchmod(e, t3), 0;
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return -r.errno;
          }
        }
        ___syscall_fchmod.sig = "iii";
        function ___syscall_fchmodat2(e, t3, r, a3) {
          try {
            var o5 = a3 & 256;
            return t3 = SYSCALLS.getStr(t3), t3 = SYSCALLS.calculateAt(e, t3), FS.chmod(t3, r, o5), 0;
          } catch (_4) {
            if (typeof FS > "u" || _4.name !== "ErrnoError") throw _4;
            return -_4.errno;
          }
        }
        ___syscall_fchmodat2.sig = "iipii";
        function ___syscall_fchown32(e, t3, r) {
          try {
            return FS.fchown(e, t3, r), 0;
          } catch (a3) {
            if (typeof FS > "u" || a3.name !== "ErrnoError") throw a3;
            return -a3.errno;
          }
        }
        ___syscall_fchown32.sig = "iiii";
        function ___syscall_fchownat(e, t3, r, a3, o5) {
          try {
            t3 = SYSCALLS.getStr(t3);
            var _4 = o5 & 256;
            return o5 = o5 & -257, t3 = SYSCALLS.calculateAt(e, t3), (_4 ? FS.lchown : FS.chown)(t3, r, a3), 0;
          } catch (s5) {
            if (typeof FS > "u" || s5.name !== "ErrnoError") throw s5;
            return -s5.errno;
          }
        }
        ___syscall_fchownat.sig = "iipiii";
        var syscallGetVarargI = () => {
          var e = HEAP32[+SYSCALLS.varargs >> 2];
          return SYSCALLS.varargs += 4, e;
        }, syscallGetVarargP = syscallGetVarargI;
        function ___syscall_fcntl64(e, t3, r) {
          SYSCALLS.varargs = r;
          try {
            var a3 = SYSCALLS.getStreamFromFD(e);
            switch (t3) {
              case 0: {
                var o5 = syscallGetVarargI();
                if (o5 < 0) return -28;
                for (; FS.streams[o5]; ) o5++;
                var _4;
                return _4 = FS.dupStream(a3, o5), _4.fd;
              }
              case 1:
              case 2:
                return 0;
              case 3:
                return a3.flags;
              case 4: {
                var o5 = syscallGetVarargI();
                return a3.flags |= o5, 0;
              }
              case 12: {
                var o5 = syscallGetVarargP(), s5 = 0;
                return HEAP16[o5 + s5 >> 1] = 2, 0;
              }
              case 13:
              case 14:
                return 0;
            }
            return -28;
          } catch (n3) {
            if (typeof FS > "u" || n3.name !== "ErrnoError") throw n3;
            return -n3.errno;
          }
        }
        ___syscall_fcntl64.sig = "iiip";
        function ___syscall_fdatasync(e) {
          try {
            var t3 = SYSCALLS.getStreamFromFD(e);
            return 0;
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return -r.errno;
          }
        }
        ___syscall_fdatasync.sig = "ii";
        function ___syscall_fstat64(e, t3) {
          try {
            var r = SYSCALLS.getStreamFromFD(e);
            return SYSCALLS.doStat(FS.stat, r.path, t3);
          } catch (a3) {
            if (typeof FS > "u" || a3.name !== "ErrnoError") throw a3;
            return -a3.errno;
          }
        }
        ___syscall_fstat64.sig = "iip";
        function ___syscall_ftruncate64(e, t3) {
          t3 = bigintToI53Checked(t3);
          try {
            return isNaN(t3) ? 61 : (FS.ftruncate(e, t3), 0);
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return -r.errno;
          }
        }
        ___syscall_ftruncate64.sig = "iij";
        var stringToUTF8 = (e, t3, r) => stringToUTF8Array(e, HEAPU8, t3, r);
        function ___syscall_getcwd(e, t3) {
          try {
            if (t3 === 0) return -28;
            var r = FS.cwd(), a3 = lengthBytesUTF8(r) + 1;
            return t3 < a3 ? -68 : (stringToUTF8(r, e, t3), a3);
          } catch (o5) {
            if (typeof FS > "u" || o5.name !== "ErrnoError") throw o5;
            return -o5.errno;
          }
        }
        ___syscall_getcwd.sig = "ipp";
        function ___syscall_getdents64(e, t3, r) {
          try {
            var a3 = SYSCALLS.getStreamFromFD(e);
            a3.getdents || (a3.getdents = FS.readdir(a3.path));
            for (var o5 = 280, _4 = 0, s5 = FS.llseek(a3, 0, 1), n3 = Math.floor(s5 / o5), l2 = Math.min(a3.getdents.length, n3 + Math.floor(r / o5)), d3 = n3; d3 < l2; d3++) {
              var u3, c4, f5 = a3.getdents[d3];
              if (f5 === ".") u3 = a3.node.id, c4 = 4;
              else if (f5 === "..") {
                var g4 = FS.lookupPath(a3.path, { parent: true });
                u3 = g4.node.id, c4 = 4;
              } else {
                var m5;
                try {
                  m5 = FS.lookupNode(a3.node, f5);
                } catch (p6) {
                  if (p6?.errno === 28) continue;
                  throw p6;
                }
                u3 = m5.id, c4 = FS.isChrdev(m5.mode) ? 2 : FS.isDir(m5.mode) ? 4 : FS.isLink(m5.mode) ? 10 : 8;
              }
              HEAP64[t3 + _4 >> 3] = BigInt(u3), HEAP64[t3 + _4 + 8 >> 3] = BigInt((d3 + 1) * o5), HEAP16[t3 + _4 + 16 >> 1] = 280, HEAP8[t3 + _4 + 18] = c4, stringToUTF8(f5, t3 + _4 + 19, 256), _4 += o5;
            }
            return FS.llseek(a3, d3 * o5, 0), _4;
          } catch (p6) {
            if (typeof FS > "u" || p6.name !== "ErrnoError") throw p6;
            return -p6.errno;
          }
        }
        ___syscall_getdents64.sig = "iipp";
        function ___syscall_ioctl(e, t3, r) {
          SYSCALLS.varargs = r;
          try {
            var a3 = SYSCALLS.getStreamFromFD(e);
            switch (t3) {
              case 21509:
                return a3.tty ? 0 : -59;
              case 21505: {
                if (!a3.tty) return -59;
                if (a3.tty.ops.ioctl_tcgets) {
                  var o5 = a3.tty.ops.ioctl_tcgets(a3), _4 = syscallGetVarargP();
                  HEAP32[_4 >> 2] = o5.c_iflag || 0, HEAP32[_4 + 4 >> 2] = o5.c_oflag || 0, HEAP32[_4 + 8 >> 2] = o5.c_cflag || 0, HEAP32[_4 + 12 >> 2] = o5.c_lflag || 0;
                  for (var s5 = 0; s5 < 32; s5++) HEAP8[_4 + s5 + 17] = o5.c_cc[s5] || 0;
                  return 0;
                }
                return 0;
              }
              case 21510:
              case 21511:
              case 21512:
                return a3.tty ? 0 : -59;
              case 21506:
              case 21507:
              case 21508: {
                if (!a3.tty) return -59;
                if (a3.tty.ops.ioctl_tcsets) {
                  for (var _4 = syscallGetVarargP(), n3 = HEAP32[_4 >> 2], l2 = HEAP32[_4 + 4 >> 2], d3 = HEAP32[_4 + 8 >> 2], u3 = HEAP32[_4 + 12 >> 2], c4 = [], s5 = 0; s5 < 32; s5++) c4.push(HEAP8[_4 + s5 + 17]);
                  return a3.tty.ops.ioctl_tcsets(a3.tty, t3, { c_iflag: n3, c_oflag: l2, c_cflag: d3, c_lflag: u3, c_cc: c4 });
                }
                return 0;
              }
              case 21519: {
                if (!a3.tty) return -59;
                var _4 = syscallGetVarargP();
                return HEAP32[_4 >> 2] = 0, 0;
              }
              case 21520:
                return a3.tty ? -28 : -59;
              case 21531: {
                var _4 = syscallGetVarargP();
                return FS.ioctl(a3, t3, _4);
              }
              case 21523: {
                if (!a3.tty) return -59;
                if (a3.tty.ops.ioctl_tiocgwinsz) {
                  var f5 = a3.tty.ops.ioctl_tiocgwinsz(a3.tty), _4 = syscallGetVarargP();
                  HEAP16[_4 >> 1] = f5[0], HEAP16[_4 + 2 >> 1] = f5[1];
                }
                return 0;
              }
              case 21524:
                return a3.tty ? 0 : -59;
              case 21515:
                return a3.tty ? 0 : -59;
              default:
                return -28;
            }
          } catch (g4) {
            if (typeof FS > "u" || g4.name !== "ErrnoError") throw g4;
            return -g4.errno;
          }
        }
        ___syscall_ioctl.sig = "iiip";
        function ___syscall_listen(e, t3) {
          try {
            var r = getSocketFromFD(e);
            return r.sock_ops.listen(r, t3), 0;
          } catch (a3) {
            if (typeof FS > "u" || a3.name !== "ErrnoError") throw a3;
            return -a3.errno;
          }
        }
        ___syscall_listen.sig = "iiiiiii";
        function ___syscall_lstat64(e, t3) {
          try {
            return e = SYSCALLS.getStr(e), SYSCALLS.doStat(FS.lstat, e, t3);
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return -r.errno;
          }
        }
        ___syscall_lstat64.sig = "ipp";
        function ___syscall_mkdirat(e, t3, r) {
          try {
            return t3 = SYSCALLS.getStr(t3), t3 = SYSCALLS.calculateAt(e, t3), FS.mkdir(t3, r, 0), 0;
          } catch (a3) {
            if (typeof FS > "u" || a3.name !== "ErrnoError") throw a3;
            return -a3.errno;
          }
        }
        ___syscall_mkdirat.sig = "iipi";
        function ___syscall_newfstatat(e, t3, r, a3) {
          try {
            t3 = SYSCALLS.getStr(t3);
            var o5 = a3 & 256, _4 = a3 & 4096;
            return a3 = a3 & -6401, t3 = SYSCALLS.calculateAt(e, t3, _4), SYSCALLS.doStat(o5 ? FS.lstat : FS.stat, t3, r);
          } catch (s5) {
            if (typeof FS > "u" || s5.name !== "ErrnoError") throw s5;
            return -s5.errno;
          }
        }
        ___syscall_newfstatat.sig = "iippi";
        function ___syscall_openat(e, t3, r, a3) {
          SYSCALLS.varargs = a3;
          try {
            t3 = SYSCALLS.getStr(t3), t3 = SYSCALLS.calculateAt(e, t3);
            var o5 = a3 ? syscallGetVarargI() : 0;
            return FS.open(t3, r, o5).fd;
          } catch (_4) {
            if (typeof FS > "u" || _4.name !== "ErrnoError") throw _4;
            return -_4.errno;
          }
        }
        ___syscall_openat.sig = "iipip";
        var PIPEFS = { BUCKET_BUFFER_SIZE: 8192, mount(e) {
          return FS.createNode(null, "/", 16895, 0);
        }, createPipe() {
          var e = { buckets: [], refcnt: 2 };
          e.buckets.push({ buffer: new Uint8Array(PIPEFS.BUCKET_BUFFER_SIZE), offset: 0, roffset: 0 });
          var t3 = PIPEFS.nextname(), r = PIPEFS.nextname(), a3 = FS.createNode(PIPEFS.root, t3, 4096, 0), o5 = FS.createNode(PIPEFS.root, r, 4096, 0);
          a3.pipe = e, o5.pipe = e;
          var _4 = FS.createStream({ path: t3, node: a3, flags: 0, seekable: false, stream_ops: PIPEFS.stream_ops });
          a3.stream = _4;
          var s5 = FS.createStream({ path: r, node: o5, flags: 1, seekable: false, stream_ops: PIPEFS.stream_ops });
          return o5.stream = s5, { readable_fd: _4.fd, writable_fd: s5.fd };
        }, stream_ops: { poll(e) {
          var t3 = e.node.pipe;
          if ((e.flags & 2097155) === 1) return 260;
          if (t3.buckets.length > 0) for (var r = 0; r < t3.buckets.length; r++) {
            var a3 = t3.buckets[r];
            if (a3.offset - a3.roffset > 0) return 65;
          }
          return 0;
        }, ioctl(e, t3, r) {
          return 28;
        }, fsync(e) {
          return 28;
        }, read(e, t3, r, a3, o5) {
          for (var _4 = e.node.pipe, s5 = 0, n3 = 0; n3 < _4.buckets.length; n3++) {
            var l2 = _4.buckets[n3];
            s5 += l2.offset - l2.roffset;
          }
          var d3 = t3.subarray(r, r + a3);
          if (a3 <= 0) return 0;
          if (s5 == 0) throw new FS.ErrnoError(6);
          for (var u3 = Math.min(s5, a3), c4 = u3, f5 = 0, n3 = 0; n3 < _4.buckets.length; n3++) {
            var g4 = _4.buckets[n3], m5 = g4.offset - g4.roffset;
            if (u3 <= m5) {
              var p6 = g4.buffer.subarray(g4.roffset, g4.offset);
              u3 < m5 ? (p6 = p6.subarray(0, u3), g4.roffset += u3) : f5++, d3.set(p6);
              break;
            } else {
              var p6 = g4.buffer.subarray(g4.roffset, g4.offset);
              d3.set(p6), d3 = d3.subarray(p6.byteLength), u3 -= p6.byteLength, f5++;
            }
          }
          return f5 && f5 == _4.buckets.length && (f5--, _4.buckets[f5].offset = 0, _4.buckets[f5].roffset = 0), _4.buckets.splice(0, f5), c4;
        }, write(e, t3, r, a3, o5) {
          var _4 = e.node.pipe, s5 = t3.subarray(r, r + a3), n3 = s5.byteLength;
          if (n3 <= 0) return 0;
          var l2 = null;
          _4.buckets.length == 0 ? (l2 = { buffer: new Uint8Array(PIPEFS.BUCKET_BUFFER_SIZE), offset: 0, roffset: 0 }, _4.buckets.push(l2)) : l2 = _4.buckets[_4.buckets.length - 1], assert(l2.offset <= PIPEFS.BUCKET_BUFFER_SIZE);
          var d3 = PIPEFS.BUCKET_BUFFER_SIZE - l2.offset;
          if (d3 >= n3) return l2.buffer.set(s5, l2.offset), l2.offset += n3, n3;
          d3 > 0 && (l2.buffer.set(s5.subarray(0, d3), l2.offset), l2.offset += d3, s5 = s5.subarray(d3, s5.byteLength));
          for (var u3 = s5.byteLength / PIPEFS.BUCKET_BUFFER_SIZE | 0, c4 = s5.byteLength % PIPEFS.BUCKET_BUFFER_SIZE, f5 = 0; f5 < u3; f5++) {
            var g4 = { buffer: new Uint8Array(PIPEFS.BUCKET_BUFFER_SIZE), offset: PIPEFS.BUCKET_BUFFER_SIZE, roffset: 0 };
            _4.buckets.push(g4), g4.buffer.set(s5.subarray(0, PIPEFS.BUCKET_BUFFER_SIZE)), s5 = s5.subarray(PIPEFS.BUCKET_BUFFER_SIZE, s5.byteLength);
          }
          if (c4 > 0) {
            var g4 = { buffer: new Uint8Array(PIPEFS.BUCKET_BUFFER_SIZE), offset: s5.byteLength, roffset: 0 };
            _4.buckets.push(g4), g4.buffer.set(s5);
          }
          return n3;
        }, close(e) {
          var t3 = e.node.pipe;
          t3.refcnt--, t3.refcnt === 0 && (t3.buckets = null);
        } }, nextname() {
          return PIPEFS.nextname.current || (PIPEFS.nextname.current = 0), "pipe[" + PIPEFS.nextname.current++ + "]";
        } };
        function ___syscall_pipe(e) {
          try {
            if (e == 0) throw new FS.ErrnoError(21);
            var t3 = PIPEFS.createPipe();
            return HEAP32[e >> 2] = t3.readable_fd, HEAP32[e + 4 >> 2] = t3.writable_fd, 0;
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return -r.errno;
          }
        }
        ___syscall_pipe.sig = "ip";
        function ___syscall_readlinkat(e, t3, r, a3) {
          try {
            if (t3 = SYSCALLS.getStr(t3), t3 = SYSCALLS.calculateAt(e, t3), a3 <= 0) return -28;
            var o5 = FS.readlink(t3), _4 = Math.min(a3, lengthBytesUTF8(o5)), s5 = HEAP8[r + _4];
            return stringToUTF8(o5, r, a3 + 1), HEAP8[r + _4] = s5, _4;
          } catch (n3) {
            if (typeof FS > "u" || n3.name !== "ErrnoError") throw n3;
            return -n3.errno;
          }
        }
        ___syscall_readlinkat.sig = "iippp";
        function ___syscall_recvfrom(e, t3, r, a3, o5, _4) {
          try {
            var s5 = getSocketFromFD(e), n3 = s5.sock_ops.recvmsg(s5, r);
            if (!n3) return 0;
            if (o5) var l2 = writeSockaddr(o5, s5.family, DNS.lookup_name(n3.addr), n3.port, _4);
            return HEAPU8.set(n3.buffer, t3), n3.buffer.byteLength;
          } catch (d3) {
            if (typeof FS > "u" || d3.name !== "ErrnoError") throw d3;
            return -d3.errno;
          }
        }
        ___syscall_recvfrom.sig = "iippipp";
        function ___syscall_renameat(e, t3, r, a3) {
          try {
            return t3 = SYSCALLS.getStr(t3), a3 = SYSCALLS.getStr(a3), t3 = SYSCALLS.calculateAt(e, t3), a3 = SYSCALLS.calculateAt(r, a3), FS.rename(t3, a3), 0;
          } catch (o5) {
            if (typeof FS > "u" || o5.name !== "ErrnoError") throw o5;
            return -o5.errno;
          }
        }
        ___syscall_renameat.sig = "iipip";
        function ___syscall_rmdir(e) {
          try {
            return e = SYSCALLS.getStr(e), FS.rmdir(e), 0;
          } catch (t3) {
            if (typeof FS > "u" || t3.name !== "ErrnoError") throw t3;
            return -t3.errno;
          }
        }
        ___syscall_rmdir.sig = "ip";
        function ___syscall_sendto(e, t3, r, a3, o5, _4) {
          try {
            var s5 = getSocketFromFD(e);
            if (!o5) return FS.write(s5.stream, HEAP8, t3, r);
            var n3 = getSocketAddress(o5, _4);
            return s5.sock_ops.sendmsg(s5, HEAP8, t3, r, n3.addr, n3.port);
          } catch (l2) {
            if (typeof FS > "u" || l2.name !== "ErrnoError") throw l2;
            return -l2.errno;
          }
        }
        ___syscall_sendto.sig = "iippipp";
        function ___syscall_socket(e, t3, r) {
          try {
            var a3 = SOCKFS.createSocket(e, t3, r);
            return a3.stream.fd;
          } catch (o5) {
            if (typeof FS > "u" || o5.name !== "ErrnoError") throw o5;
            return -o5.errno;
          }
        }
        ___syscall_socket.sig = "iiiiiii";
        function ___syscall_stat64(e, t3) {
          try {
            return e = SYSCALLS.getStr(e), SYSCALLS.doStat(FS.stat, e, t3);
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return -r.errno;
          }
        }
        ___syscall_stat64.sig = "ipp";
        function ___syscall_statfs64(e, t3, r) {
          try {
            var a3 = FS.statfs(SYSCALLS.getStr(e));
            return HEAP32[r + 4 >> 2] = a3.bsize, HEAP32[r + 40 >> 2] = a3.bsize, HEAP32[r + 8 >> 2] = a3.blocks, HEAP32[r + 12 >> 2] = a3.bfree, HEAP32[r + 16 >> 2] = a3.bavail, HEAP32[r + 20 >> 2] = a3.files, HEAP32[r + 24 >> 2] = a3.ffree, HEAP32[r + 28 >> 2] = a3.fsid, HEAP32[r + 44 >> 2] = a3.flags, HEAP32[r + 36 >> 2] = a3.namelen, 0;
          } catch (o5) {
            if (typeof FS > "u" || o5.name !== "ErrnoError") throw o5;
            return -o5.errno;
          }
        }
        ___syscall_statfs64.sig = "ippp";
        function ___syscall_symlinkat(e, t3, r) {
          try {
            return e = SYSCALLS.getStr(e), r = SYSCALLS.getStr(r), r = SYSCALLS.calculateAt(t3, r), FS.symlink(e, r), 0;
          } catch (a3) {
            if (typeof FS > "u" || a3.name !== "ErrnoError") throw a3;
            return -a3.errno;
          }
        }
        ___syscall_symlinkat.sig = "ipip";
        function ___syscall_truncate64(e, t3) {
          t3 = bigintToI53Checked(t3);
          try {
            return isNaN(t3) ? 61 : (e = SYSCALLS.getStr(e), FS.truncate(e, t3), 0);
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return -r.errno;
          }
        }
        ___syscall_truncate64.sig = "ipj";
        function ___syscall_unlinkat(e, t3, r) {
          try {
            return t3 = SYSCALLS.getStr(t3), t3 = SYSCALLS.calculateAt(e, t3), r === 0 ? FS.unlink(t3) : r === 512 ? FS.rmdir(t3) : abort("Invalid flags passed to unlinkat"), 0;
          } catch (a3) {
            if (typeof FS > "u" || a3.name !== "ErrnoError") throw a3;
            return -a3.errno;
          }
        }
        ___syscall_unlinkat.sig = "iipi";
        var readI53FromI64 = (e) => HEAPU32[e >> 2] + HEAP32[e + 4 >> 2] * 4294967296;
        function ___syscall_utimensat(e, t3, r, a3) {
          try {
            t3 = SYSCALLS.getStr(t3), t3 = SYSCALLS.calculateAt(e, t3, true);
            var o5 = Date.now(), _4, s5;
            if (!r) _4 = o5, s5 = o5;
            else {
              var n3 = readI53FromI64(r), l2 = HEAP32[r + 8 >> 2];
              l2 == 1073741823 ? _4 = o5 : l2 == 1073741822 ? _4 = null : _4 = n3 * 1e3 + l2 / 1e6, r += 16, n3 = readI53FromI64(r), l2 = HEAP32[r + 8 >> 2], l2 == 1073741823 ? s5 = o5 : l2 == 1073741822 ? s5 = null : s5 = n3 * 1e3 + l2 / 1e6;
            }
            return (s5 ?? _4) !== null && FS.utime(t3, _4, s5), 0;
          } catch (d3) {
            if (typeof FS > "u" || d3.name !== "ErrnoError") throw d3;
            return -d3.errno;
          }
        }
        ___syscall_utimensat.sig = "iippi";
        var ___table_base = new WebAssembly.Global({ value: "i32", mutable: false }, 1);
        Module.___table_base = ___table_base;
        var __abort_js = () => abort("");
        __abort_js.sig = "v";
        var ENV = {}, stackAlloc = (e) => __emscripten_stack_alloc(e), stringToUTF8OnStack = (e) => {
          var t3 = lengthBytesUTF8(e) + 1, r = stackAlloc(t3);
          return stringToUTF8(e, r, t3), r;
        }, dlSetError = (e) => {
          var t3 = stackSave(), r = stringToUTF8OnStack(e);
          ___dl_seterr(r, 0), stackRestore(t3);
        }, dlopenInternal = (e, t3) => {
          var r = UTF8ToString(e + 36), a3 = HEAP32[e + 4 >> 2];
          r = PATH.normalize(r);
          var o5 = !!(a3 & 256), _4 = o5 ? null : {}, s5 = { global: o5, nodelete: !!(a3 & 4096), loadAsync: t3.loadAsync };
          if (t3.loadAsync) return loadDynamicLibrary(r, s5, _4, e);
          try {
            return loadDynamicLibrary(r, s5, _4, e);
          } catch (n3) {
            return dlSetError(`Could not load dynamic lib: ${r}
${n3}`), 0;
          }
        }, __dlopen_js = (e) => dlopenInternal(e, { loadAsync: false });
        __dlopen_js.sig = "pp";
        var __dlsym_js = (e, t3, r) => {
          t3 = UTF8ToString(t3);
          var a3, o5, _4 = LDSO.loadedLibsByHandle[e];
          if (!_4.exports.hasOwnProperty(t3) || _4.exports[t3].stub) return dlSetError(`Tried to lookup unknown symbol "${t3}" in dynamic lib: ${_4.name}`), 0;
          if (o5 = Object.keys(_4.exports).indexOf(t3), a3 = _4.exports[t3], typeof a3 == "function") {
            var s5 = getFunctionAddress(a3);
            s5 ? a3 = s5 : (a3 = addFunction(a3, a3.sig), HEAPU32[r >> 2] = o5);
          }
          return a3;
        };
        __dlsym_js.sig = "pppp";
        var runtimeKeepaliveCounter = 0, __emscripten_runtime_keepalive_clear = () => {
          noExitRuntime = false, runtimeKeepaliveCounter = 0;
        };
        __emscripten_runtime_keepalive_clear.sig = "v";
        var __emscripten_throw_longjmp = () => {
          throw 1 / 0;
        };
        __emscripten_throw_longjmp.sig = "v";
        function __gmtime_js(e, t3) {
          e = bigintToI53Checked(e);
          var r = new Date(e * 1e3);
          HEAP32[t3 >> 2] = r.getUTCSeconds(), HEAP32[t3 + 4 >> 2] = r.getUTCMinutes(), HEAP32[t3 + 8 >> 2] = r.getUTCHours(), HEAP32[t3 + 12 >> 2] = r.getUTCDate(), HEAP32[t3 + 16 >> 2] = r.getUTCMonth(), HEAP32[t3 + 20 >> 2] = r.getUTCFullYear() - 1900, HEAP32[t3 + 24 >> 2] = r.getUTCDay();
          var a3 = Date.UTC(r.getUTCFullYear(), 0, 1, 0, 0, 0, 0), o5 = (r.getTime() - a3) / (1e3 * 60 * 60 * 24) | 0;
          HEAP32[t3 + 28 >> 2] = o5;
        }
        __gmtime_js.sig = "vjp";
        var isLeapYear = (e) => e % 4 === 0 && (e % 100 !== 0 || e % 400 === 0), MONTH_DAYS_LEAP_CUMULATIVE = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], MONTH_DAYS_REGULAR_CUMULATIVE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], ydayFromDate = (e) => {
          var t3 = isLeapYear(e.getFullYear()), r = t3 ? MONTH_DAYS_LEAP_CUMULATIVE : MONTH_DAYS_REGULAR_CUMULATIVE, a3 = r[e.getMonth()] + e.getDate() - 1;
          return a3;
        };
        function __localtime_js(e, t3) {
          e = bigintToI53Checked(e);
          var r = new Date(e * 1e3);
          HEAP32[t3 >> 2] = r.getSeconds(), HEAP32[t3 + 4 >> 2] = r.getMinutes(), HEAP32[t3 + 8 >> 2] = r.getHours(), HEAP32[t3 + 12 >> 2] = r.getDate(), HEAP32[t3 + 16 >> 2] = r.getMonth(), HEAP32[t3 + 20 >> 2] = r.getFullYear() - 1900, HEAP32[t3 + 24 >> 2] = r.getDay();
          var a3 = ydayFromDate(r) | 0;
          HEAP32[t3 + 28 >> 2] = a3, HEAP32[t3 + 36 >> 2] = -(r.getTimezoneOffset() * 60);
          var o5 = new Date(r.getFullYear(), 0, 1), _4 = new Date(r.getFullYear(), 6, 1).getTimezoneOffset(), s5 = o5.getTimezoneOffset(), n3 = (_4 != s5 && r.getTimezoneOffset() == Math.min(s5, _4)) | 0;
          HEAP32[t3 + 32 >> 2] = n3;
        }
        __localtime_js.sig = "vjp";
        function __mmap_js(e, t3, r, a3, o5, _4, s5) {
          o5 = bigintToI53Checked(o5);
          try {
            if (isNaN(o5)) return 61;
            var n3 = SYSCALLS.getStreamFromFD(a3), l2 = FS.mmap(n3, e, o5, t3, r), d3 = l2.ptr;
            return HEAP32[_4 >> 2] = l2.allocated, HEAPU32[s5 >> 2] = d3, 0;
          } catch (u3) {
            if (typeof FS > "u" || u3.name !== "ErrnoError") throw u3;
            return -u3.errno;
          }
        }
        __mmap_js.sig = "ipiiijpp";
        function __munmap_js(e, t3, r, a3, o5, _4) {
          _4 = bigintToI53Checked(_4);
          try {
            var s5 = SYSCALLS.getStreamFromFD(o5);
            r & 2 && SYSCALLS.doMsync(e, s5, t3, a3, _4);
          } catch (n3) {
            if (typeof FS > "u" || n3.name !== "ErrnoError") throw n3;
            return -n3.errno;
          }
        }
        __munmap_js.sig = "ippiiij";
        var timers = {}, handleException = (e) => {
          if (e instanceof ExitStatus || e == "unwind") return EXITSTATUS;
          quit_(1, e);
        }, keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0, _proc_exit = (e) => {
          EXITSTATUS = e, keepRuntimeAlive() || (Module.onExit?.(e), ABORT = true), quit_(e, new ExitStatus(e));
        };
        _proc_exit.sig = "vi";
        var exitJS = (e, t3) => {
          EXITSTATUS = e, keepRuntimeAlive() || exitRuntime(), _proc_exit(e);
        }, _exit = exitJS;
        Module._exit = _exit, _exit.sig = "vi";
        var maybeExit = () => {
          if (!runtimeExited && !keepRuntimeAlive()) try {
            _exit(EXITSTATUS);
          } catch (e) {
            handleException(e);
          }
        }, callUserCallback = (e) => {
          if (!(runtimeExited || ABORT)) try {
            e(), maybeExit();
          } catch (t3) {
            handleException(t3);
          }
        }, _emscripten_get_now = () => performance.now();
        _emscripten_get_now.sig = "d";
        var __setitimer_js = (e, t3) => {
          if (timers[e] && (clearTimeout(timers[e].id), delete timers[e]), !t3) return 0;
          var r = setTimeout(() => {
            delete timers[e], callUserCallback(() => __emscripten_timeout(e, _emscripten_get_now()));
          }, t3);
          return timers[e] = { id: r, timeout_ms: t3 }, 0;
        };
        __setitimer_js.sig = "iid";
        var __tzset_js = (e, t3, r, a3) => {
          var o5 = (/* @__PURE__ */ new Date()).getFullYear(), _4 = new Date(o5, 0, 1), s5 = new Date(o5, 6, 1), n3 = _4.getTimezoneOffset(), l2 = s5.getTimezoneOffset(), d3 = Math.max(n3, l2);
          HEAPU32[e >> 2] = d3 * 60, HEAP32[t3 >> 2] = +(n3 != l2);
          var u3 = (g4) => {
            var m5 = g4 >= 0 ? "-" : "+", p6 = Math.abs(g4), h3 = String(Math.floor(p6 / 60)).padStart(2, "0"), x4 = String(p6 % 60).padStart(2, "0");
            return `UTC${m5}${h3}${x4}`;
          }, c4 = u3(n3), f5 = u3(l2);
          l2 < n3 ? (stringToUTF8(c4, r, 17), stringToUTF8(f5, a3, 17)) : (stringToUTF8(c4, a3, 17), stringToUTF8(f5, r, 17));
        };
        __tzset_js.sig = "vpppp";
        var _emscripten_date_now = () => Date.now();
        _emscripten_date_now.sig = "d";
        var nowIsMonotonic = 1, checkWasiClock = (e) => e >= 0 && e <= 3;
        function _clock_time_get(e, t3, r) {
          if (t3 = bigintToI53Checked(t3), !checkWasiClock(e)) return 28;
          var a3;
          if (e === 0) a3 = _emscripten_date_now();
          else if (nowIsMonotonic) a3 = _emscripten_get_now();
          else return 52;
          var o5 = Math.round(a3 * 1e3 * 1e3);
          return HEAP64[r >> 3] = BigInt(o5), 0;
        }
        _clock_time_get.sig = "iijp";
        var getHeapMax = () => 2147483648, _emscripten_get_heap_max = () => getHeapMax();
        _emscripten_get_heap_max.sig = "p";
        var growMemory = (e) => {
          var t3 = wasmMemory.buffer, r = (e - t3.byteLength + 65535) / 65536 | 0;
          try {
            return wasmMemory.grow(r), updateMemoryViews(), 1;
          } catch {
          }
        }, _emscripten_resize_heap = (e) => {
          var t3 = HEAPU8.length;
          e >>>= 0;
          var r = getHeapMax();
          if (e > r) return false;
          for (var a3 = 1; a3 <= 4; a3 *= 2) {
            var o5 = t3 * (1 + 0.2 / a3);
            o5 = Math.min(o5, e + 100663296);
            var _4 = Math.min(r, alignMemory(Math.max(e, o5), 65536)), s5 = growMemory(_4);
            if (s5) return true;
          }
          return false;
        };
        _emscripten_resize_heap.sig = "ip";
        var getExecutableName = () => thisProgram || "./this.program", getEnvStrings = () => {
          if (!getEnvStrings.strings) {
            var e = (typeof navigator == "object" && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8", t3 = { USER: "web_user", LOGNAME: "web_user", PATH: "/", PWD: "/", HOME: "/home/web_user", LANG: e, _: getExecutableName() };
            for (var r in ENV) ENV[r] === void 0 ? delete t3[r] : t3[r] = ENV[r];
            var a3 = [];
            for (var r in t3) a3.push(`${r}=${t3[r]}`);
            getEnvStrings.strings = a3;
          }
          return getEnvStrings.strings;
        }, stringToAscii = (e, t3) => {
          for (var r = 0; r < e.length; ++r) HEAP8[t3++] = e.charCodeAt(r);
          HEAP8[t3] = 0;
        }, _environ_get = (e, t3) => {
          var r = 0;
          return getEnvStrings().forEach((a3, o5) => {
            var _4 = t3 + r;
            HEAPU32[e + o5 * 4 >> 2] = _4, stringToAscii(a3, _4), r += a3.length + 1;
          }), 0;
        };
        _environ_get.sig = "ipp";
        var _environ_sizes_get = (e, t3) => {
          var r = getEnvStrings();
          HEAPU32[e >> 2] = r.length;
          var a3 = 0;
          return r.forEach((o5) => a3 += o5.length + 1), HEAPU32[t3 >> 2] = a3, 0;
        };
        _environ_sizes_get.sig = "ipp";
        function _fd_close(e) {
          try {
            var t3 = SYSCALLS.getStreamFromFD(e);
            return FS.close(t3), 0;
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return r.errno;
          }
        }
        _fd_close.sig = "ii";
        function _fd_fdstat_get(e, t3) {
          try {
            var r = 0, a3 = 0, o5 = 0, _4 = SYSCALLS.getStreamFromFD(e), s5 = _4.tty ? 2 : FS.isDir(_4.mode) ? 3 : FS.isLink(_4.mode) ? 7 : 4;
            return HEAP8[t3] = s5, HEAP16[t3 + 2 >> 1] = o5, HEAP64[t3 + 8 >> 3] = BigInt(r), HEAP64[t3 + 16 >> 3] = BigInt(a3), 0;
          } catch (n3) {
            if (typeof FS > "u" || n3.name !== "ErrnoError") throw n3;
            return n3.errno;
          }
        }
        _fd_fdstat_get.sig = "iip";
        var doReadv = (e, t3, r, a3) => {
          for (var o5 = 0, _4 = 0; _4 < r; _4++) {
            var s5 = HEAPU32[t3 >> 2], n3 = HEAPU32[t3 + 4 >> 2];
            t3 += 8;
            var l2 = FS.read(e, HEAP8, s5, n3, a3);
            if (l2 < 0) return -1;
            if (o5 += l2, l2 < n3) break;
            typeof a3 < "u" && (a3 += l2);
          }
          return o5;
        };
        function _fd_pread(e, t3, r, a3, o5) {
          a3 = bigintToI53Checked(a3);
          try {
            if (isNaN(a3)) return 61;
            var _4 = SYSCALLS.getStreamFromFD(e), s5 = doReadv(_4, t3, r, a3);
            return HEAPU32[o5 >> 2] = s5, 0;
          } catch (n3) {
            if (typeof FS > "u" || n3.name !== "ErrnoError") throw n3;
            return n3.errno;
          }
        }
        _fd_pread.sig = "iippjp";
        var doWritev = (e, t3, r, a3) => {
          for (var o5 = 0, _4 = 0; _4 < r; _4++) {
            var s5 = HEAPU32[t3 >> 2], n3 = HEAPU32[t3 + 4 >> 2];
            t3 += 8;
            var l2 = FS.write(e, HEAP8, s5, n3, a3);
            if (l2 < 0) return -1;
            if (o5 += l2, l2 < n3) break;
            typeof a3 < "u" && (a3 += l2);
          }
          return o5;
        };
        function _fd_pwrite(e, t3, r, a3, o5) {
          a3 = bigintToI53Checked(a3);
          try {
            if (isNaN(a3)) return 61;
            var _4 = SYSCALLS.getStreamFromFD(e), s5 = doWritev(_4, t3, r, a3);
            return HEAPU32[o5 >> 2] = s5, 0;
          } catch (n3) {
            if (typeof FS > "u" || n3.name !== "ErrnoError") throw n3;
            return n3.errno;
          }
        }
        _fd_pwrite.sig = "iippjp";
        function _fd_read(e, t3, r, a3) {
          try {
            var o5 = SYSCALLS.getStreamFromFD(e), _4 = doReadv(o5, t3, r);
            return HEAPU32[a3 >> 2] = _4, 0;
          } catch (s5) {
            if (typeof FS > "u" || s5.name !== "ErrnoError") throw s5;
            return s5.errno;
          }
        }
        _fd_read.sig = "iippp";
        function _fd_seek(e, t3, r, a3) {
          t3 = bigintToI53Checked(t3);
          try {
            if (isNaN(t3)) return 61;
            var o5 = SYSCALLS.getStreamFromFD(e);
            return FS.llseek(o5, t3, r), HEAP64[a3 >> 3] = BigInt(o5.position), o5.getdents && t3 === 0 && r === 0 && (o5.getdents = null), 0;
          } catch (_4) {
            if (typeof FS > "u" || _4.name !== "ErrnoError") throw _4;
            return _4.errno;
          }
        }
        _fd_seek.sig = "iijip";
        function _fd_sync(e) {
          try {
            var t3 = SYSCALLS.getStreamFromFD(e);
            return t3.stream_ops?.fsync ? t3.stream_ops.fsync(t3) : 0;
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return r.errno;
          }
        }
        _fd_sync.sig = "ii";
        function _fd_write(e, t3, r, a3) {
          try {
            var o5 = SYSCALLS.getStreamFromFD(e), _4 = doWritev(o5, t3, r);
            return HEAPU32[a3 >> 2] = _4, 0;
          } catch (s5) {
            if (typeof FS > "u" || s5.name !== "ErrnoError") throw s5;
            return s5.errno;
          }
        }
        _fd_write.sig = "iippp";
        var _getaddrinfo = (e, t3, r, a3) => {
          var o5 = 0, _4 = 0, s5 = 0, n3 = 0, l2 = 0, d3 = 0, u3;
          function c4(f5, g4, m5, p6, h3, x4) {
            var b4, M3, y5, E3;
            return M3 = f5 === 10 ? 28 : 16, h3 = f5 === 10 ? inetNtop6(h3) : inetNtop4(h3), b4 = _malloc(M3), E3 = writeSockaddr(b4, f5, h3, x4), assert(!E3), y5 = _malloc(32), HEAP32[y5 + 4 >> 2] = f5, HEAP32[y5 + 8 >> 2] = g4, HEAP32[y5 + 12 >> 2] = m5, HEAPU32[y5 + 24 >> 2] = p6, HEAPU32[y5 + 20 >> 2] = b4, f5 === 10 ? HEAP32[y5 + 16 >> 2] = 28 : HEAP32[y5 + 16 >> 2] = 16, HEAP32[y5 + 28 >> 2] = 0, y5;
          }
          if (r && (s5 = HEAP32[r >> 2], n3 = HEAP32[r + 4 >> 2], l2 = HEAP32[r + 8 >> 2], d3 = HEAP32[r + 12 >> 2]), l2 && !d3 && (d3 = l2 === 2 ? 17 : 6), !l2 && d3 && (l2 = d3 === 17 ? 2 : 1), d3 === 0 && (d3 = 6), l2 === 0 && (l2 = 1), !e && !t3) return -2;
          if (s5 & -1088 || r !== 0 && HEAP32[r >> 2] & 2 && !e) return -1;
          if (s5 & 32) return -2;
          if (l2 !== 0 && l2 !== 1 && l2 !== 2) return -7;
          if (n3 !== 0 && n3 !== 2 && n3 !== 10) return -6;
          if (t3 && (t3 = UTF8ToString(t3), _4 = parseInt(t3, 10), isNaN(_4))) return s5 & 1024 ? -2 : -8;
          if (!e) return n3 === 0 && (n3 = 2), s5 & 1 || (n3 === 2 ? o5 = _htonl(2130706433) : o5 = [0, 0, 0, _htonl(1)]), u3 = c4(n3, l2, d3, null, o5, _4), HEAPU32[a3 >> 2] = u3, 0;
          if (e = UTF8ToString(e), o5 = inetPton4(e), o5 !== null) if (n3 === 0 || n3 === 2) n3 = 2;
          else if (n3 === 10 && s5 & 8) o5 = [0, 0, _htonl(65535), o5], n3 = 10;
          else return -2;
          else if (o5 = inetPton6(e), o5 !== null) if (n3 === 0 || n3 === 10) n3 = 10;
          else return -2;
          return o5 != null ? (u3 = c4(n3, l2, d3, e, o5, _4), HEAPU32[a3 >> 2] = u3, 0) : s5 & 4 ? -2 : (e = DNS.lookup_name(e), o5 = inetPton4(e), n3 === 0 ? n3 = 2 : n3 === 10 && (o5 = [0, 0, _htonl(65535), o5]), u3 = c4(n3, l2, d3, null, o5, _4), HEAPU32[a3 >> 2] = u3, 0);
        };
        _getaddrinfo.sig = "ipppp";
        var _getnameinfo = (e, t3, r, a3, o5, _4, s5) => {
          var n3 = readSockaddr(e, t3);
          if (n3.errno) return -6;
          var l2 = n3.port, d3 = n3.addr, u3 = false;
          if (r && a3) {
            var c4;
            if (s5 & 1 || !(c4 = DNS.lookup_addr(d3))) {
              if (s5 & 8) return -2;
            } else d3 = c4;
            var f5 = stringToUTF8(d3, r, a3);
            f5 + 1 >= a3 && (u3 = true);
          }
          if (o5 && _4) {
            l2 = "" + l2;
            var f5 = stringToUTF8(l2, o5, _4);
            f5 + 1 >= _4 && (u3 = true);
          }
          return u3 ? -12 : 0;
        };
        _getnameinfo.sig = "ipipipii";
        function _random_get(e, t3) {
          try {
            return randomFill(HEAPU8.subarray(e, e + t3)), 0;
          } catch (r) {
            if (typeof FS > "u" || r.name !== "ErrnoError") throw r;
            return r.errno;
          }
        }
        _random_get.sig = "ipp";
        var stringToNewUTF8 = (e) => {
          var t3 = lengthBytesUTF8(e) + 1, r = _malloc(t3);
          return r && stringToUTF8(e, r, t3), r;
        }, removeFunction = (e) => {
          functionsInTableMap.delete(getWasmTableEntry(e)), setWasmTableEntry(e, null), freeTableIndexes.push(e);
        }, FS_createPath = FS.createPath, FS_unlink = (e) => FS.unlink(e), FS_createLazyFile = FS.createLazyFile, FS_createDevice = FS.createDevice, setTempRet0 = (e) => __emscripten_tempret_set(e), _setTempRet0 = setTempRet0;
        Module._setTempRet0 = _setTempRet0;
        var getTempRet0 = (e) => __emscripten_tempret_get(), _getTempRet0 = getTempRet0;
        Module._getTempRet0 = _getTempRet0;
        var _emscripten_force_exit = (e) => {
          __emscripten_runtime_keepalive_clear(), _exit(e);
        };
        Module._emscripten_force_exit = _emscripten_force_exit, _emscripten_force_exit.sig = "vi";
        var _sched_yield = () => 0;
        Module._sched_yield = _sched_yield, _sched_yield.sig = "i";
        var exceptionLast = 0;
        class ExceptionInfo {
          constructor(t3) {
            this.excPtr = t3, this.ptr = t3 - 24;
          }
          set_type(t3) {
            HEAPU32[this.ptr + 4 >> 2] = t3;
          }
          get_type() {
            return HEAPU32[this.ptr + 4 >> 2];
          }
          set_destructor(t3) {
            HEAPU32[this.ptr + 8 >> 2] = t3;
          }
          get_destructor() {
            return HEAPU32[this.ptr + 8 >> 2];
          }
          set_caught(t3) {
            t3 = t3 ? 1 : 0, HEAP8[this.ptr + 12] = t3;
          }
          get_caught() {
            return HEAP8[this.ptr + 12] != 0;
          }
          set_rethrown(t3) {
            t3 = t3 ? 1 : 0, HEAP8[this.ptr + 13] = t3;
          }
          get_rethrown() {
            return HEAP8[this.ptr + 13] != 0;
          }
          init(t3, r) {
            this.set_adjusted_ptr(0), this.set_type(t3), this.set_destructor(r);
          }
          set_adjusted_ptr(t3) {
            HEAPU32[this.ptr + 16 >> 2] = t3;
          }
          get_adjusted_ptr() {
            return HEAPU32[this.ptr + 16 >> 2];
          }
        }
        var ___resumeException = (e) => {
          throw exceptionLast || (exceptionLast = e), exceptionLast;
        };
        Module.___resumeException = ___resumeException, ___resumeException.sig = "vp";
        var findMatchingCatch = (e) => {
          var t3 = exceptionLast;
          if (!t3) return setTempRet0(0), 0;
          var r = new ExceptionInfo(t3);
          r.set_adjusted_ptr(t3);
          var a3 = r.get_type();
          if (!a3) return setTempRet0(0), t3;
          for (var o5 of e) {
            if (o5 === 0 || o5 === a3) break;
            var _4 = r.ptr + 16;
            if (___cxa_can_catch(o5, a3, _4)) return setTempRet0(o5), t3;
          }
          return setTempRet0(a3), t3;
        }, ___cxa_find_matching_catch_2 = () => findMatchingCatch([]);
        Module.___cxa_find_matching_catch_2 = ___cxa_find_matching_catch_2, ___cxa_find_matching_catch_2.sig = "p";
        var ___cxa_find_matching_catch_3 = (e) => findMatchingCatch([e]);
        Module.___cxa_find_matching_catch_3 = ___cxa_find_matching_catch_3, ___cxa_find_matching_catch_3.sig = "pp";
        var uncaughtExceptionCount = 0, ___cxa_throw = (e, t3, r) => {
          var a3 = new ExceptionInfo(e);
          throw a3.init(t3, r), exceptionLast = e, uncaughtExceptionCount++, exceptionLast;
        };
        Module.___cxa_throw = ___cxa_throw, ___cxa_throw.sig = "vppp";
        var exceptionCaught = [], ___cxa_rethrow = () => {
          var e = exceptionCaught.pop();
          e || abort("no exception to throw");
          var t3 = e.excPtr;
          throw e.get_rethrown() || (exceptionCaught.push(e), e.set_rethrown(true), e.set_caught(false), uncaughtExceptionCount++), exceptionLast = t3, exceptionLast;
        };
        Module.___cxa_rethrow = ___cxa_rethrow, ___cxa_rethrow.sig = "v";
        var ___cxa_begin_catch = (e) => {
          var t3 = new ExceptionInfo(e);
          return t3.get_caught() || (t3.set_caught(true), uncaughtExceptionCount--), t3.set_rethrown(false), exceptionCaught.push(t3), ___cxa_increment_exception_refcount(e), ___cxa_get_exception_ptr(e);
        };
        Module.___cxa_begin_catch = ___cxa_begin_catch, ___cxa_begin_catch.sig = "pp";
        var ___cxa_end_catch = () => {
          _setThrew(0, 0);
          var e = exceptionCaught.pop();
          ___cxa_decrement_exception_refcount(e.excPtr), exceptionLast = 0;
        };
        Module.___cxa_end_catch = ___cxa_end_catch, ___cxa_end_catch.sig = "v";
        var ___cxa_uncaught_exceptions = () => uncaughtExceptionCount;
        Module.___cxa_uncaught_exceptions = ___cxa_uncaught_exceptions, ___cxa_uncaught_exceptions.sig = "i";
        var ___cxa_current_primary_exception = () => {
          if (!exceptionCaught.length) return 0;
          var e = exceptionCaught[exceptionCaught.length - 1];
          return ___cxa_increment_exception_refcount(e.excPtr), e.excPtr;
        };
        Module.___cxa_current_primary_exception = ___cxa_current_primary_exception, ___cxa_current_primary_exception.sig = "p";
        var ___cxa_rethrow_primary_exception = (e) => {
          if (e) {
            var t3 = new ExceptionInfo(e);
            exceptionCaught.push(t3), t3.set_rethrown(true), ___cxa_rethrow();
          }
        };
        Module.___cxa_rethrow_primary_exception = ___cxa_rethrow_primary_exception, ___cxa_rethrow_primary_exception.sig = "vp", registerWasmPlugin(), FS.createPreloadedFile = FS_createPreloadedFile, FS.staticInit(), Module.FS_createPath = FS.createPath, Module.FS_createDataFile = FS.createDataFile, Module.FS_createPreloadedFile = FS.createPreloadedFile, Module.FS_unlink = FS.unlink, Module.FS_createLazyFile = FS.createLazyFile, Module.FS_createDevice = FS.createDevice, MEMFS.doesNotExistError = new FS.ErrnoError(44), MEMFS.doesNotExistError.stack = "<generic error, no stack>", ENVIRONMENT_IS_NODE && NODEFS.staticInit();
        var wasmImports = { __assert_fail: ___assert_fail, __call_sighandler: ___call_sighandler, __cxa_begin_catch: ___cxa_begin_catch, __cxa_current_primary_exception: ___cxa_current_primary_exception, __cxa_end_catch: ___cxa_end_catch, __cxa_find_matching_catch_2: ___cxa_find_matching_catch_2, __cxa_find_matching_catch_3: ___cxa_find_matching_catch_3, __cxa_rethrow: ___cxa_rethrow, __cxa_rethrow_primary_exception: ___cxa_rethrow_primary_exception, __cxa_throw: ___cxa_throw, __cxa_uncaught_exceptions: ___cxa_uncaught_exceptions, __heap_base: ___heap_base, __indirect_function_table: wasmTable, __memory_base: ___memory_base, __resumeException: ___resumeException, __stack_pointer: ___stack_pointer, __syscall__newselect: ___syscall__newselect, __syscall_accept4: ___syscall_accept4, __syscall_bind: ___syscall_bind, __syscall_chdir: ___syscall_chdir, __syscall_chmod: ___syscall_chmod, __syscall_connect: ___syscall_connect, __syscall_dup: ___syscall_dup, __syscall_dup3: ___syscall_dup3, __syscall_faccessat: ___syscall_faccessat, __syscall_fadvise64: ___syscall_fadvise64, __syscall_fallocate: ___syscall_fallocate, __syscall_fchmod: ___syscall_fchmod, __syscall_fchmodat2: ___syscall_fchmodat2, __syscall_fchown32: ___syscall_fchown32, __syscall_fchownat: ___syscall_fchownat, __syscall_fcntl64: ___syscall_fcntl64, __syscall_fdatasync: ___syscall_fdatasync, __syscall_fstat64: ___syscall_fstat64, __syscall_ftruncate64: ___syscall_ftruncate64, __syscall_getcwd: ___syscall_getcwd, __syscall_getdents64: ___syscall_getdents64, __syscall_ioctl: ___syscall_ioctl, __syscall_listen: ___syscall_listen, __syscall_lstat64: ___syscall_lstat64, __syscall_mkdirat: ___syscall_mkdirat, __syscall_newfstatat: ___syscall_newfstatat, __syscall_openat: ___syscall_openat, __syscall_pipe: ___syscall_pipe, __syscall_readlinkat: ___syscall_readlinkat, __syscall_recvfrom: ___syscall_recvfrom, __syscall_renameat: ___syscall_renameat, __syscall_rmdir: ___syscall_rmdir, __syscall_sendto: ___syscall_sendto, __syscall_socket: ___syscall_socket, __syscall_stat64: ___syscall_stat64, __syscall_statfs64: ___syscall_statfs64, __syscall_symlinkat: ___syscall_symlinkat, __syscall_truncate64: ___syscall_truncate64, __syscall_unlinkat: ___syscall_unlinkat, __syscall_utimensat: ___syscall_utimensat, __table_base: ___table_base, _abort_js: __abort_js, _dlopen_js: __dlopen_js, _dlsym_js: __dlsym_js, _emscripten_runtime_keepalive_clear: __emscripten_runtime_keepalive_clear, _emscripten_throw_longjmp: __emscripten_throw_longjmp, _gmtime_js: __gmtime_js, _localtime_js: __localtime_js, _mmap_js: __mmap_js, _munmap_js: __munmap_js, _setitimer_js: __setitimer_js, _tzset_js: __tzset_js, clock_time_get: _clock_time_get, emscripten_date_now: _emscripten_date_now, emscripten_force_exit: _emscripten_force_exit, emscripten_get_heap_max: _emscripten_get_heap_max, emscripten_get_now: _emscripten_get_now, emscripten_resize_heap: _emscripten_resize_heap, environ_get: _environ_get, environ_sizes_get: _environ_sizes_get, exit: _exit, fd_close: _fd_close, fd_fdstat_get: _fd_fdstat_get, fd_pread: _fd_pread, fd_pwrite: _fd_pwrite, fd_read: _fd_read, fd_seek: _fd_seek, fd_sync: _fd_sync, fd_write: _fd_write, getTempRet0: _getTempRet0, getaddrinfo: _getaddrinfo, getnameinfo: _getnameinfo, invoke_di, invoke_i, invoke_id, invoke_ii, invoke_iii, invoke_iiii, invoke_iiiii, invoke_iiiiii, invoke_iiiiiii, invoke_iiiiiiii, invoke_iiiiiiiii, invoke_iiiiiiiiii, invoke_iiiiiiiiiii, invoke_iiiiiiiiiiiiii, invoke_iiiiiiiiiiiiiiiiii, invoke_iiiiiji, invoke_iiiij, invoke_iiij, invoke_iiji, invoke_iijj, invoke_ij, invoke_ijiiiii, invoke_ijiiiiii, invoke_ijji, invoke_j, invoke_ji, invoke_jii, invoke_jiii, invoke_jiiii, invoke_jiiiiii, invoke_jiiiiiiiii, invoke_jij, invoke_v, invoke_vi, invoke_vid, invoke_vii, invoke_viii, invoke_viiii, invoke_viiiii, invoke_viiiiii, invoke_viiiiiii, invoke_viiiiiiii, invoke_viiiiiiiii, invoke_viiiiiiiiiiii, invoke_viiiji, invoke_viij, invoke_viiji, invoke_viijii, invoke_viijiiii, invoke_vij, invoke_viji, invoke_vijiji, invoke_vijjii, invoke_vj, invoke_vji, invoke_vjii, memory: wasmMemory, proc_exit: _proc_exit, random_get: _random_get, sched_yield: _sched_yield, setTempRet0: _setTempRet0 }, wasmExports;
        createWasm();
        var ___wasm_call_ctors = () => (___wasm_call_ctors = wasmExports.__wasm_call_ctors)(), _palloc0 = Module._palloc0 = (e) => (_palloc0 = Module._palloc0 = wasmExports.palloc0)(e), _RelationGetNumberOfBlocksInFork = Module._RelationGetNumberOfBlocksInFork = (e, t3) => (_RelationGetNumberOfBlocksInFork = Module._RelationGetNumberOfBlocksInFork = wasmExports.RelationGetNumberOfBlocksInFork)(e, t3), _ExtendBufferedRel = Module._ExtendBufferedRel = (e, t3, r, a3) => (_ExtendBufferedRel = Module._ExtendBufferedRel = wasmExports.ExtendBufferedRel)(e, t3, r, a3), _MarkBufferDirty = Module._MarkBufferDirty = (e) => (_MarkBufferDirty = Module._MarkBufferDirty = wasmExports.MarkBufferDirty)(e), _XLogBeginInsert = Module._XLogBeginInsert = () => (_XLogBeginInsert = Module._XLogBeginInsert = wasmExports.XLogBeginInsert)(), _XLogRegisterData = Module._XLogRegisterData = (e, t3) => (_XLogRegisterData = Module._XLogRegisterData = wasmExports.XLogRegisterData)(e, t3), _XLogInsert = Module._XLogInsert = (e, t3) => (_XLogInsert = Module._XLogInsert = wasmExports.XLogInsert)(e, t3), _UnlockReleaseBuffer = Module._UnlockReleaseBuffer = (e) => (_UnlockReleaseBuffer = Module._UnlockReleaseBuffer = wasmExports.UnlockReleaseBuffer)(e), _palloc = Module._palloc = (e) => (_palloc = Module._palloc = wasmExports.palloc)(e), _brin_build_desc = Module._brin_build_desc = (e) => (_brin_build_desc = Module._brin_build_desc = wasmExports.brin_build_desc)(e), _EnterParallelMode = Module._EnterParallelMode = () => (_EnterParallelMode = Module._EnterParallelMode = wasmExports.EnterParallelMode)(), _CreateParallelContext = Module._CreateParallelContext = (e, t3, r) => (_CreateParallelContext = Module._CreateParallelContext = wasmExports.CreateParallelContext)(e, t3, r), _GetTransactionSnapshot = Module._GetTransactionSnapshot = () => (_GetTransactionSnapshot = Module._GetTransactionSnapshot = wasmExports.GetTransactionSnapshot)(), _RegisterSnapshot = Module._RegisterSnapshot = (e) => (_RegisterSnapshot = Module._RegisterSnapshot = wasmExports.RegisterSnapshot)(e), _table_parallelscan_estimate = Module._table_parallelscan_estimate = (e, t3) => (_table_parallelscan_estimate = Module._table_parallelscan_estimate = wasmExports.table_parallelscan_estimate)(e, t3), _add_size = Module._add_size = (e, t3) => (_add_size = Module._add_size = wasmExports.add_size)(e, t3), _tuplesort_estimate_shared = Module._tuplesort_estimate_shared = (e) => (_tuplesort_estimate_shared = Module._tuplesort_estimate_shared = wasmExports.tuplesort_estimate_shared)(e), _strlen = Module._strlen = (e) => (_strlen = Module._strlen = wasmExports.strlen)(e), _InitializeParallelDSM = Module._InitializeParallelDSM = (e) => (_InitializeParallelDSM = Module._InitializeParallelDSM = wasmExports.InitializeParallelDSM)(e), _UnregisterSnapshot = Module._UnregisterSnapshot = (e) => (_UnregisterSnapshot = Module._UnregisterSnapshot = wasmExports.UnregisterSnapshot)(e), _DestroyParallelContext = Module._DestroyParallelContext = (e) => (_DestroyParallelContext = Module._DestroyParallelContext = wasmExports.DestroyParallelContext)(e), _ExitParallelMode = Module._ExitParallelMode = () => (_ExitParallelMode = Module._ExitParallelMode = wasmExports.ExitParallelMode)(), _shm_toc_allocate = Module._shm_toc_allocate = (e, t3) => (_shm_toc_allocate = Module._shm_toc_allocate = wasmExports.shm_toc_allocate)(e, t3), _ConditionVariableInit = Module._ConditionVariableInit = (e) => (_ConditionVariableInit = Module._ConditionVariableInit = wasmExports.ConditionVariableInit)(e), _table_parallelscan_initialize = Module._table_parallelscan_initialize = (e, t3, r) => (_table_parallelscan_initialize = Module._table_parallelscan_initialize = wasmExports.table_parallelscan_initialize)(e, t3, r), _tuplesort_initialize_shared = Module._tuplesort_initialize_shared = (e, t3, r) => (_tuplesort_initialize_shared = Module._tuplesort_initialize_shared = wasmExports.tuplesort_initialize_shared)(e, t3, r), _shm_toc_insert = Module._shm_toc_insert = (e, t3, r) => (_shm_toc_insert = Module._shm_toc_insert = wasmExports.shm_toc_insert)(e, t3, r), _memcpy = Module._memcpy = (e, t3, r) => (_memcpy = Module._memcpy = wasmExports.memcpy)(e, t3, r), _LaunchParallelWorkers = Module._LaunchParallelWorkers = (e) => (_LaunchParallelWorkers = Module._LaunchParallelWorkers = wasmExports.LaunchParallelWorkers)(e), _WaitForParallelWorkersToAttach = Module._WaitForParallelWorkersToAttach = (e) => (_WaitForParallelWorkersToAttach = Module._WaitForParallelWorkersToAttach = wasmExports.WaitForParallelWorkersToAttach)(e), _s_lock = Module._s_lock = (e, t3, r, a3) => (_s_lock = Module._s_lock = wasmExports.s_lock)(e, t3, r, a3), _ConditionVariableSleep = Module._ConditionVariableSleep = (e, t3) => (_ConditionVariableSleep = Module._ConditionVariableSleep = wasmExports.ConditionVariableSleep)(e, t3), _ConditionVariableCancelSleep = Module._ConditionVariableCancelSleep = () => (_ConditionVariableCancelSleep = Module._ConditionVariableCancelSleep = wasmExports.ConditionVariableCancelSleep)(), _tuplesort_performsort = Module._tuplesort_performsort = (e) => (_tuplesort_performsort = Module._tuplesort_performsort = wasmExports.tuplesort_performsort)(e), _AllocSetContextCreateInternal = Module._AllocSetContextCreateInternal = (e, t3, r, a3, o5) => (_AllocSetContextCreateInternal = Module._AllocSetContextCreateInternal = wasmExports.AllocSetContextCreateInternal)(e, t3, r, a3, o5), _tuplesort_end = Module._tuplesort_end = (e) => (_tuplesort_end = Module._tuplesort_end = wasmExports.tuplesort_end)(e), _MemoryContextReset = Module._MemoryContextReset = (e) => (_MemoryContextReset = Module._MemoryContextReset = wasmExports.MemoryContextReset)(e), _brin_deform_tuple = Module._brin_deform_tuple = (e, t3, r) => (_brin_deform_tuple = Module._brin_deform_tuple = wasmExports.brin_deform_tuple)(e, t3, r), _pfree = Module._pfree = (e) => (_pfree = Module._pfree = wasmExports.pfree)(e), _MemoryContextDelete = Module._MemoryContextDelete = (e) => (_MemoryContextDelete = Module._MemoryContextDelete = wasmExports.MemoryContextDelete)(e), _errstart_cold = Module._errstart_cold = (e, t3) => (_errstart_cold = Module._errstart_cold = wasmExports.errstart_cold)(e, t3), _errmsg_internal = Module._errmsg_internal = (e, t3) => (_errmsg_internal = Module._errmsg_internal = wasmExports.errmsg_internal)(e, t3), _errfinish = Module._errfinish = (e, t3, r) => (_errfinish = Module._errfinish = wasmExports.errfinish)(e, t3, r), _log_newpage_buffer = Module._log_newpage_buffer = (e, t3) => (_log_newpage_buffer = Module._log_newpage_buffer = wasmExports.log_newpage_buffer)(e, t3), _ProcessInterrupts = Module._ProcessInterrupts = () => (_ProcessInterrupts = Module._ProcessInterrupts = wasmExports.ProcessInterrupts)(), _errstart = Module._errstart = (e, t3) => (_errstart = Module._errstart = wasmExports.errstart)(e, t3), _errcode = Module._errcode = (e) => (_errcode = Module._errcode = wasmExports.errcode)(e), _errmsg = Module._errmsg = (e, t3) => (_errmsg = Module._errmsg = wasmExports.errmsg)(e, t3), _LockBuffer = Module._LockBuffer = (e, t3) => (_LockBuffer = Module._LockBuffer = wasmExports.LockBuffer)(e, t3), _ReleaseBuffer = Module._ReleaseBuffer = (e) => (_ReleaseBuffer = Module._ReleaseBuffer = wasmExports.ReleaseBuffer)(e), _IndexGetRelation = Module._IndexGetRelation = (e, t3) => (_IndexGetRelation = Module._IndexGetRelation = wasmExports.IndexGetRelation)(e, t3), _table_open = Module._table_open = (e, t3) => (_table_open = Module._table_open = wasmExports.table_open)(e, t3), _ReadBufferExtended = Module._ReadBufferExtended = (e, t3, r, a3, o5) => (_ReadBufferExtended = Module._ReadBufferExtended = wasmExports.ReadBufferExtended)(e, t3, r, a3, o5), _table_close = Module._table_close = (e, t3) => (_table_close = Module._table_close = wasmExports.table_close)(e, t3), _build_reloptions = Module._build_reloptions = (e, t3, r, a3, o5, _4) => (_build_reloptions = Module._build_reloptions = wasmExports.build_reloptions)(e, t3, r, a3, o5, _4), _RelationGetIndexScan = Module._RelationGetIndexScan = (e, t3, r) => (_RelationGetIndexScan = Module._RelationGetIndexScan = wasmExports.RelationGetIndexScan)(e, t3, r), _pgstat_assoc_relation = Module._pgstat_assoc_relation = (e) => (_pgstat_assoc_relation = Module._pgstat_assoc_relation = wasmExports.pgstat_assoc_relation)(e), _memset = Module._memset = (e, t3, r) => (_memset = Module._memset = wasmExports.memset)(e, t3, r), _index_getprocinfo = Module._index_getprocinfo = (e, t3, r) => (_index_getprocinfo = Module._index_getprocinfo = wasmExports.index_getprocinfo)(e, t3, r), _fmgr_info_copy = Module._fmgr_info_copy = (e, t3, r) => (_fmgr_info_copy = Module._fmgr_info_copy = wasmExports.fmgr_info_copy)(e, t3, r), _FunctionCall4Coll = Module._FunctionCall4Coll = (e, t3, r, a3, o5, _4) => (_FunctionCall4Coll = Module._FunctionCall4Coll = wasmExports.FunctionCall4Coll)(e, t3, r, a3, o5, _4), _FunctionCall1Coll = Module._FunctionCall1Coll = (e, t3, r) => (_FunctionCall1Coll = Module._FunctionCall1Coll = wasmExports.FunctionCall1Coll)(e, t3, r), _brin_free_desc = Module._brin_free_desc = (e) => (_brin_free_desc = Module._brin_free_desc = wasmExports.brin_free_desc)(e), _WaitForParallelWorkersToFinish = Module._WaitForParallelWorkersToFinish = (e) => (_WaitForParallelWorkersToFinish = Module._WaitForParallelWorkersToFinish = wasmExports.WaitForParallelWorkersToFinish)(e), _PageGetFreeSpace = Module._PageGetFreeSpace = (e) => (_PageGetFreeSpace = Module._PageGetFreeSpace = wasmExports.PageGetFreeSpace)(e), _BufferGetBlockNumber = Module._BufferGetBlockNumber = (e) => (_BufferGetBlockNumber = Module._BufferGetBlockNumber = wasmExports.BufferGetBlockNumber)(e), _BuildIndexInfo = Module._BuildIndexInfo = (e) => (_BuildIndexInfo = Module._BuildIndexInfo = wasmExports.BuildIndexInfo)(e), _Int64GetDatum = Module._Int64GetDatum = (e) => (_Int64GetDatum = Module._Int64GetDatum = wasmExports.Int64GetDatum)(e), _DirectFunctionCall2Coll = Module._DirectFunctionCall2Coll = (e, t3, r, a3) => (_DirectFunctionCall2Coll = Module._DirectFunctionCall2Coll = wasmExports.DirectFunctionCall2Coll)(e, t3, r, a3), _RecoveryInProgress = Module._RecoveryInProgress = () => (_RecoveryInProgress = Module._RecoveryInProgress = wasmExports.RecoveryInProgress)(), _GetUserIdAndSecContext = Module._GetUserIdAndSecContext = (e, t3) => (_GetUserIdAndSecContext = Module._GetUserIdAndSecContext = wasmExports.GetUserIdAndSecContext)(e, t3), _SetUserIdAndSecContext = Module._SetUserIdAndSecContext = (e, t3) => (_SetUserIdAndSecContext = Module._SetUserIdAndSecContext = wasmExports.SetUserIdAndSecContext)(e, t3), _NewGUCNestLevel = Module._NewGUCNestLevel = () => (_NewGUCNestLevel = Module._NewGUCNestLevel = wasmExports.NewGUCNestLevel)(), _RestrictSearchPath = Module._RestrictSearchPath = () => (_RestrictSearchPath = Module._RestrictSearchPath = wasmExports.RestrictSearchPath)(), _index_open = Module._index_open = (e, t3) => (_index_open = Module._index_open = wasmExports.index_open)(e, t3), _object_ownercheck = Module._object_ownercheck = (e, t3, r) => (_object_ownercheck = Module._object_ownercheck = wasmExports.object_ownercheck)(e, t3, r), _aclcheck_error = Module._aclcheck_error = (e, t3, r) => (_aclcheck_error = Module._aclcheck_error = wasmExports.aclcheck_error)(e, t3, r), _AtEOXact_GUC = Module._AtEOXact_GUC = (e, t3) => (_AtEOXact_GUC = Module._AtEOXact_GUC = wasmExports.AtEOXact_GUC)(e, t3), _relation_close = Module._relation_close = (e, t3) => (_relation_close = Module._relation_close = wasmExports.relation_close)(e, t3), _errhint = Module._errhint = (e, t3) => (_errhint = Module._errhint = wasmExports.errhint)(e, t3), _GetUserId = Module._GetUserId = () => (_GetUserId = Module._GetUserId = wasmExports.GetUserId)(), _ReadBuffer = Module._ReadBuffer = (e, t3) => (_ReadBuffer = Module._ReadBuffer = wasmExports.ReadBuffer)(e, t3), _shm_toc_lookup = Module._shm_toc_lookup = (e, t3, r) => (_shm_toc_lookup = Module._shm_toc_lookup = wasmExports.shm_toc_lookup)(e, t3, r), _pgstat_report_activity = Module._pgstat_report_activity = (e, t3) => (_pgstat_report_activity = Module._pgstat_report_activity = wasmExports.pgstat_report_activity)(e, t3), _tuplesort_attach_shared = Module._tuplesort_attach_shared = (e, t3) => (_tuplesort_attach_shared = Module._tuplesort_attach_shared = wasmExports.tuplesort_attach_shared)(e, t3), _index_close = Module._index_close = (e, t3) => (_index_close = Module._index_close = wasmExports.index_close)(e, t3), _table_beginscan_parallel = Module._table_beginscan_parallel = (e, t3) => (_table_beginscan_parallel = Module._table_beginscan_parallel = wasmExports.table_beginscan_parallel)(e, t3), _ConditionVariableSignal = Module._ConditionVariableSignal = (e) => (_ConditionVariableSignal = Module._ConditionVariableSignal = wasmExports.ConditionVariableSignal)(e), _datumCopy = Module._datumCopy = (e, t3, r) => (_datumCopy = Module._datumCopy = wasmExports.datumCopy)(e, t3, r), _lookup_type_cache = Module._lookup_type_cache = (e, t3) => (_lookup_type_cache = Module._lookup_type_cache = wasmExports.lookup_type_cache)(e, t3), _get_fn_opclass_options = Module._get_fn_opclass_options = (e) => (_get_fn_opclass_options = Module._get_fn_opclass_options = wasmExports.get_fn_opclass_options)(e), _log = Module._log = (e) => (_log = Module._log = wasmExports.log)(e), _pg_detoast_datum = Module._pg_detoast_datum = (e) => (_pg_detoast_datum = Module._pg_detoast_datum = wasmExports.pg_detoast_datum)(e), _index_getprocid = Module._index_getprocid = (e, t3, r) => (_index_getprocid = Module._index_getprocid = wasmExports.index_getprocid)(e, t3, r), _errdetail_internal = Module._errdetail_internal = (e, t3) => (_errdetail_internal = Module._errdetail_internal = wasmExports.errdetail_internal)(e, t3), _pg_popcount_optimized = Module._pg_popcount_optimized = (e, t3) => (_pg_popcount_optimized = Module._pg_popcount_optimized = wasmExports.pg_popcount_optimized)(e, t3), _init_local_reloptions = Module._init_local_reloptions = (e, t3) => (_init_local_reloptions = Module._init_local_reloptions = wasmExports.init_local_reloptions)(e, t3), _initStringInfo = Module._initStringInfo = (e) => (_initStringInfo = Module._initStringInfo = wasmExports.initStringInfo)(e), _appendStringInfoChar = Module._appendStringInfoChar = (e, t3) => (_appendStringInfoChar = Module._appendStringInfoChar = wasmExports.appendStringInfoChar)(e, t3), _appendStringInfo = Module._appendStringInfo = (e, t3, r) => (_appendStringInfo = Module._appendStringInfo = wasmExports.appendStringInfo)(e, t3, r), _FunctionCall2Coll = Module._FunctionCall2Coll = (e, t3, r, a3) => (_FunctionCall2Coll = Module._FunctionCall2Coll = wasmExports.FunctionCall2Coll)(e, t3, r, a3), _SysCacheGetAttrNotNull = Module._SysCacheGetAttrNotNull = (e, t3, r) => (_SysCacheGetAttrNotNull = Module._SysCacheGetAttrNotNull = wasmExports.SysCacheGetAttrNotNull)(e, t3, r), _ReleaseSysCache = Module._ReleaseSysCache = (e) => (_ReleaseSysCache = Module._ReleaseSysCache = wasmExports.ReleaseSysCache)(e), _get_opcode = Module._get_opcode = (e) => (_get_opcode = Module._get_opcode = wasmExports.get_opcode)(e), _fmgr_info_cxt = Module._fmgr_info_cxt = (e, t3, r) => (_fmgr_info_cxt = Module._fmgr_info_cxt = wasmExports.fmgr_info_cxt)(e, t3, r), _Float8GetDatum = Module._Float8GetDatum = (e) => (_Float8GetDatum = Module._Float8GetDatum = wasmExports.Float8GetDatum)(e), _numeric_float8 = Module._numeric_float8 = (e) => (_numeric_float8 = Module._numeric_float8 = wasmExports.numeric_float8)(e), _numeric_sub = Module._numeric_sub = (e) => (_numeric_sub = Module._numeric_sub = wasmExports.numeric_sub)(e), _DirectFunctionCall1Coll = Module._DirectFunctionCall1Coll = (e, t3, r) => (_DirectFunctionCall1Coll = Module._DirectFunctionCall1Coll = wasmExports.DirectFunctionCall1Coll)(e, t3, r), _pg_detoast_datum_packed = Module._pg_detoast_datum_packed = (e) => (_pg_detoast_datum_packed = Module._pg_detoast_datum_packed = wasmExports.pg_detoast_datum_packed)(e), _pg_qsort = Module._pg_qsort = (e, t3, r, a3) => (_pg_qsort = Module._pg_qsort = wasmExports.pg_qsort)(e, t3, r, a3), _get_typbyval = Module._get_typbyval = (e) => (_get_typbyval = Module._get_typbyval = wasmExports.get_typbyval)(e), _get_typlen = Module._get_typlen = (e) => (_get_typlen = Module._get_typlen = wasmExports.get_typlen)(e), _qsort_arg = Module._qsort_arg = (e, t3, r, a3, o5) => (_qsort_arg = Module._qsort_arg = wasmExports.qsort_arg)(e, t3, r, a3, o5), _memmove = Module._memmove = (e, t3, r) => (_memmove = Module._memmove = wasmExports.memmove)(e, t3, r), _add_local_int_reloption = Module._add_local_int_reloption = (e, t3, r, a3, o5, _4, s5) => (_add_local_int_reloption = Module._add_local_int_reloption = wasmExports.add_local_int_reloption)(e, t3, r, a3, o5, _4, s5), _getTypeOutputInfo = Module._getTypeOutputInfo = (e, t3, r) => (_getTypeOutputInfo = Module._getTypeOutputInfo = wasmExports.getTypeOutputInfo)(e, t3, r), _fmgr_info = Module._fmgr_info = (e, t3) => (_fmgr_info = Module._fmgr_info = wasmExports.fmgr_info)(e, t3), _OutputFunctionCall = Module._OutputFunctionCall = (e, t3) => (_OutputFunctionCall = Module._OutputFunctionCall = wasmExports.OutputFunctionCall)(e, t3), _cstring_to_text_with_len = Module._cstring_to_text_with_len = (e, t3) => (_cstring_to_text_with_len = Module._cstring_to_text_with_len = wasmExports.cstring_to_text_with_len)(e, t3), _accumArrayResult = Module._accumArrayResult = (e, t3, r, a3, o5) => (_accumArrayResult = Module._accumArrayResult = wasmExports.accumArrayResult)(e, t3, r, a3, o5), _makeArrayResult = Module._makeArrayResult = (e, t3) => (_makeArrayResult = Module._makeArrayResult = wasmExports.makeArrayResult)(e, t3), _OidOutputFunctionCall = Module._OidOutputFunctionCall = (e, t3) => (_OidOutputFunctionCall = Module._OidOutputFunctionCall = wasmExports.OidOutputFunctionCall)(e, t3), _cstring_to_text = Module._cstring_to_text = (e) => (_cstring_to_text = Module._cstring_to_text = wasmExports.cstring_to_text)(e), _PageGetExactFreeSpace = Module._PageGetExactFreeSpace = (e) => (_PageGetExactFreeSpace = Module._PageGetExactFreeSpace = wasmExports.PageGetExactFreeSpace)(e), _PageIndexTupleOverwrite = Module._PageIndexTupleOverwrite = (e, t3, r, a3) => (_PageIndexTupleOverwrite = Module._PageIndexTupleOverwrite = wasmExports.PageIndexTupleOverwrite)(e, t3, r, a3), _PageInit = Module._PageInit = (e, t3, r) => (_PageInit = Module._PageInit = wasmExports.PageInit)(e, t3, r), _PageAddItemExtended = Module._PageAddItemExtended = (e, t3, r, a3, o5) => (_PageAddItemExtended = Module._PageAddItemExtended = wasmExports.PageAddItemExtended)(e, t3, r, a3, o5), _LockRelationForExtension = Module._LockRelationForExtension = (e, t3) => (_LockRelationForExtension = Module._LockRelationForExtension = wasmExports.LockRelationForExtension)(e, t3), _UnlockRelationForExtension = Module._UnlockRelationForExtension = (e, t3) => (_UnlockRelationForExtension = Module._UnlockRelationForExtension = wasmExports.UnlockRelationForExtension)(e, t3), _smgropen = Module._smgropen = (e, t3) => (_smgropen = Module._smgropen = wasmExports.smgropen)(e, t3), _smgrpin = Module._smgrpin = (e) => (_smgrpin = Module._smgrpin = wasmExports.smgrpin)(e), _ItemPointerEquals = Module._ItemPointerEquals = (e, t3) => (_ItemPointerEquals = Module._ItemPointerEquals = wasmExports.ItemPointerEquals)(e, t3), _detoast_external_attr = Module._detoast_external_attr = (e) => (_detoast_external_attr = Module._detoast_external_attr = wasmExports.detoast_external_attr)(e), _CreateTemplateTupleDesc = Module._CreateTemplateTupleDesc = (e) => (_CreateTemplateTupleDesc = Module._CreateTemplateTupleDesc = wasmExports.CreateTemplateTupleDesc)(e), _TupleDescInitEntry = Module._TupleDescInitEntry = (e, t3, r, a3, o5, _4) => (_TupleDescInitEntry = Module._TupleDescInitEntry = wasmExports.TupleDescInitEntry)(e, t3, r, a3, o5, _4), _repalloc = Module._repalloc = (e, t3) => (_repalloc = Module._repalloc = wasmExports.repalloc)(e, t3), _memcmp = Module._memcmp = (e, t3, r) => (_memcmp = Module._memcmp = wasmExports.memcmp)(e, t3, r), _SearchSysCache1 = Module._SearchSysCache1 = (e, t3) => (_SearchSysCache1 = Module._SearchSysCache1 = wasmExports.SearchSysCache1)(e, t3), _get_opfamily_name = Module._get_opfamily_name = (e, t3) => (_get_opfamily_name = Module._get_opfamily_name = wasmExports.get_opfamily_name)(e, t3), _SearchSysCacheList = Module._SearchSysCacheList = (e, t3, r, a3, o5) => (_SearchSysCacheList = Module._SearchSysCacheList = wasmExports.SearchSysCacheList)(e, t3, r, a3, o5), _check_amproc_signature = Module._check_amproc_signature = (e, t3, r, a3, o5, _4) => (_check_amproc_signature = Module._check_amproc_signature = wasmExports.check_amproc_signature)(e, t3, r, a3, o5, _4), _check_amoptsproc_signature = Module._check_amoptsproc_signature = (e) => (_check_amoptsproc_signature = Module._check_amoptsproc_signature = wasmExports.check_amoptsproc_signature)(e), _format_procedure = Module._format_procedure = (e) => (_format_procedure = Module._format_procedure = wasmExports.format_procedure)(e), _format_operator = Module._format_operator = (e) => (_format_operator = Module._format_operator = wasmExports.format_operator)(e), _check_amop_signature = Module._check_amop_signature = (e, t3, r, a3) => (_check_amop_signature = Module._check_amop_signature = wasmExports.check_amop_signature)(e, t3, r, a3), _identify_opfamily_groups = Module._identify_opfamily_groups = (e, t3) => (_identify_opfamily_groups = Module._identify_opfamily_groups = wasmExports.identify_opfamily_groups)(e, t3), _format_type_be = Module._format_type_be = (e) => (_format_type_be = Module._format_type_be = wasmExports.format_type_be)(e), _ReleaseCatCacheList = Module._ReleaseCatCacheList = (e) => (_ReleaseCatCacheList = Module._ReleaseCatCacheList = wasmExports.ReleaseCatCacheList)(e), _format_type_with_typemod = Module._format_type_with_typemod = (e, t3) => (_format_type_with_typemod = Module._format_type_with_typemod = wasmExports.format_type_with_typemod)(e, t3), _errdetail = Module._errdetail = (e, t3) => (_errdetail = Module._errdetail = wasmExports.errdetail)(e, t3), _strcmp = Module._strcmp = (e, t3) => (_strcmp = Module._strcmp = wasmExports.strcmp)(e, t3), _DatumGetEOHP = Module._DatumGetEOHP = (e) => (_DatumGetEOHP = Module._DatumGetEOHP = wasmExports.DatumGetEOHP)(e), _EOH_get_flat_size = Module._EOH_get_flat_size = (e) => (_EOH_get_flat_size = Module._EOH_get_flat_size = wasmExports.EOH_get_flat_size)(e), _EOH_flatten_into = Module._EOH_flatten_into = (e, t3, r) => (_EOH_flatten_into = Module._EOH_flatten_into = wasmExports.EOH_flatten_into)(e, t3, r), _toast_raw_datum_size = Module._toast_raw_datum_size = (e) => (_toast_raw_datum_size = Module._toast_raw_datum_size = wasmExports.toast_raw_datum_size)(e), _getmissingattr = Module._getmissingattr = (e, t3, r) => (_getmissingattr = Module._getmissingattr = wasmExports.getmissingattr)(e, t3, r), _hash_create = Module._hash_create = (e, t3, r, a3) => (_hash_create = Module._hash_create = wasmExports.hash_create)(e, t3, r, a3), _hash_search = Module._hash_search = (e, t3, r, a3) => (_hash_search = Module._hash_search = wasmExports.hash_search)(e, t3, r, a3), _nocachegetattr = Module._nocachegetattr = (e, t3, r) => (_nocachegetattr = Module._nocachegetattr = wasmExports.nocachegetattr)(e, t3, r), _heap_getsysattr = Module._heap_getsysattr = (e, t3, r, a3) => (_heap_getsysattr = Module._heap_getsysattr = wasmExports.heap_getsysattr)(e, t3, r, a3), _heap_form_tuple = Module._heap_form_tuple = (e, t3, r) => (_heap_form_tuple = Module._heap_form_tuple = wasmExports.heap_form_tuple)(e, t3, r), _heap_modify_tuple = Module._heap_modify_tuple = (e, t3, r, a3, o5) => (_heap_modify_tuple = Module._heap_modify_tuple = wasmExports.heap_modify_tuple)(e, t3, r, a3, o5), _heap_deform_tuple = Module._heap_deform_tuple = (e, t3, r, a3) => (_heap_deform_tuple = Module._heap_deform_tuple = wasmExports.heap_deform_tuple)(e, t3, r, a3), _heap_modify_tuple_by_cols = Module._heap_modify_tuple_by_cols = (e, t3, r, a3, o5, _4) => (_heap_modify_tuple_by_cols = Module._heap_modify_tuple_by_cols = wasmExports.heap_modify_tuple_by_cols)(e, t3, r, a3, o5, _4), _heap_freetuple = Module._heap_freetuple = (e) => (_heap_freetuple = Module._heap_freetuple = wasmExports.heap_freetuple)(e), _hash_bytes = Module._hash_bytes = (e, t3) => (_hash_bytes = Module._hash_bytes = wasmExports.hash_bytes)(e, t3), _index_form_tuple = Module._index_form_tuple = (e, t3, r) => (_index_form_tuple = Module._index_form_tuple = wasmExports.index_form_tuple)(e, t3, r), _MemoryContextAllocZero = Module._MemoryContextAllocZero = (e, t3) => (_MemoryContextAllocZero = Module._MemoryContextAllocZero = wasmExports.MemoryContextAllocZero)(e, t3), _nocache_index_getattr = Module._nocache_index_getattr = (e, t3, r) => (_nocache_index_getattr = Module._nocache_index_getattr = wasmExports.nocache_index_getattr)(e, t3, r), _index_deform_tuple = Module._index_deform_tuple = (e, t3, r, a3) => (_index_deform_tuple = Module._index_deform_tuple = wasmExports.index_deform_tuple)(e, t3, r, a3), _CopyIndexTuple = Module._CopyIndexTuple = (e) => (_CopyIndexTuple = Module._CopyIndexTuple = wasmExports.CopyIndexTuple)(e), _CreateTupleDescTruncatedCopy = Module._CreateTupleDescTruncatedCopy = (e, t3) => (_CreateTupleDescTruncatedCopy = Module._CreateTupleDescTruncatedCopy = wasmExports.CreateTupleDescTruncatedCopy)(e, t3), _enlargeStringInfo = Module._enlargeStringInfo = (e, t3) => (_enlargeStringInfo = Module._enlargeStringInfo = wasmExports.enlargeStringInfo)(e, t3), _slot_getsomeattrs_int = Module._slot_getsomeattrs_int = (e, t3) => (_slot_getsomeattrs_int = Module._slot_getsomeattrs_int = wasmExports.slot_getsomeattrs_int)(e, t3), _pg_lltoa = Module._pg_lltoa = (e, t3) => (_pg_lltoa = Module._pg_lltoa = wasmExports.pg_lltoa)(e, t3), _pg_ltoa = Module._pg_ltoa = (e, t3) => (_pg_ltoa = Module._pg_ltoa = wasmExports.pg_ltoa)(e, t3), _pq_sendbytes = Module._pq_sendbytes = (e, t3, r) => (_pq_sendbytes = Module._pq_sendbytes = wasmExports.pq_sendbytes)(e, t3, r), _pg_printf = Module._pg_printf = (e, t3) => (_pg_printf = Module._pg_printf = wasmExports.pg_printf)(e, t3), _relation_open = Module._relation_open = (e, t3) => (_relation_open = Module._relation_open = wasmExports.relation_open)(e, t3), _LockRelationOid = Module._LockRelationOid = (e, t3) => (_LockRelationOid = Module._LockRelationOid = wasmExports.LockRelationOid)(e, t3), _RelationIdGetRelation = Module._RelationIdGetRelation = (e) => (_RelationIdGetRelation = Module._RelationIdGetRelation = wasmExports.RelationIdGetRelation)(e), _try_relation_open = Module._try_relation_open = (e, t3) => (_try_relation_open = Module._try_relation_open = wasmExports.try_relation_open)(e, t3), _UnlockRelationOid = Module._UnlockRelationOid = (e, t3) => (_UnlockRelationOid = Module._UnlockRelationOid = wasmExports.UnlockRelationOid)(e, t3), _relation_openrv = Module._relation_openrv = (e, t3) => (_relation_openrv = Module._relation_openrv = wasmExports.relation_openrv)(e, t3), _AcceptInvalidationMessages = Module._AcceptInvalidationMessages = () => (_AcceptInvalidationMessages = Module._AcceptInvalidationMessages = wasmExports.AcceptInvalidationMessages)(), _RangeVarGetRelidExtended = Module._RangeVarGetRelidExtended = (e, t3, r, a3, o5) => (_RangeVarGetRelidExtended = Module._RangeVarGetRelidExtended = wasmExports.RangeVarGetRelidExtended)(e, t3, r, a3, o5), _RelationClose = Module._RelationClose = (e) => (_RelationClose = Module._RelationClose = wasmExports.RelationClose)(e), _add_reloption_kind = Module._add_reloption_kind = () => (_add_reloption_kind = Module._add_reloption_kind = wasmExports.add_reloption_kind)(), _register_reloptions_validator = Module._register_reloptions_validator = (e, t3) => (_register_reloptions_validator = Module._register_reloptions_validator = wasmExports.register_reloptions_validator)(e, t3), _lappend = Module._lappend = (e, t3) => (_lappend = Module._lappend = wasmExports.lappend)(e, t3), _pstrdup = Module._pstrdup = (e) => (_pstrdup = Module._pstrdup = wasmExports.pstrdup)(e), _add_int_reloption = Module._add_int_reloption = (e, t3, r, a3, o5, _4, s5) => (_add_int_reloption = Module._add_int_reloption = wasmExports.add_int_reloption)(e, t3, r, a3, o5, _4, s5), _add_real_reloption = Module._add_real_reloption = (e, t3, r, a3, o5, _4, s5) => (_add_real_reloption = Module._add_real_reloption = wasmExports.add_real_reloption)(e, t3, r, a3, o5, _4, s5), _add_string_reloption = Module._add_string_reloption = (e, t3, r, a3, o5, _4) => (_add_string_reloption = Module._add_string_reloption = wasmExports.add_string_reloption)(e, t3, r, a3, o5, _4), _strdup = Module._strdup = (e) => (_strdup = Module._strdup = wasmExports.strdup)(e), _MemoryContextStrdup = Module._MemoryContextStrdup = (e, t3) => (_MemoryContextStrdup = Module._MemoryContextStrdup = wasmExports.MemoryContextStrdup)(e, t3), _transformRelOptions = Module._transformRelOptions = (e, t3, r, a3, o5, _4) => (_transformRelOptions = Module._transformRelOptions = wasmExports.transformRelOptions)(e, t3, r, a3, o5, _4), _deconstruct_array_builtin = Module._deconstruct_array_builtin = (e, t3, r, a3, o5) => (_deconstruct_array_builtin = Module._deconstruct_array_builtin = wasmExports.deconstruct_array_builtin)(e, t3, r, a3, o5), _strncmp = Module._strncmp = (e, t3, r) => (_strncmp = Module._strncmp = wasmExports.strncmp)(e, t3, r), _defGetString = Module._defGetString = (e) => (_defGetString = Module._defGetString = wasmExports.defGetString)(e), _strchr = Module._strchr = (e, t3) => (_strchr = Module._strchr = wasmExports.strchr)(e, t3), _defGetBoolean = Module._defGetBoolean = (e) => (_defGetBoolean = Module._defGetBoolean = wasmExports.defGetBoolean)(e), _pg_sprintf = Module._pg_sprintf = (e, t3, r) => (_pg_sprintf = Module._pg_sprintf = wasmExports.pg_sprintf)(e, t3, r), _untransformRelOptions = Module._untransformRelOptions = (e) => (_untransformRelOptions = Module._untransformRelOptions = wasmExports.untransformRelOptions)(e), _text_to_cstring = Module._text_to_cstring = (e) => (_text_to_cstring = Module._text_to_cstring = wasmExports.text_to_cstring)(e), _makeString = Module._makeString = (e) => (_makeString = Module._makeString = wasmExports.makeString)(e), _makeDefElem = Module._makeDefElem = (e, t3, r) => (_makeDefElem = Module._makeDefElem = wasmExports.makeDefElem)(e, t3, r), _heap_reloptions = Module._heap_reloptions = (e, t3, r) => (_heap_reloptions = Module._heap_reloptions = wasmExports.heap_reloptions)(e, t3, r), _strcpy = Module._strcpy = (e, t3) => (_strcpy = Module._strcpy = wasmExports.strcpy)(e, t3), _MemoryContextAlloc = Module._MemoryContextAlloc = (e, t3) => (_MemoryContextAlloc = Module._MemoryContextAlloc = wasmExports.MemoryContextAlloc)(e, t3), _parse_bool = Module._parse_bool = (e, t3) => (_parse_bool = Module._parse_bool = wasmExports.parse_bool)(e, t3), _parse_int = Module._parse_int = (e, t3, r, a3) => (_parse_int = Module._parse_int = wasmExports.parse_int)(e, t3, r, a3), _parse_real = Module._parse_real = (e, t3, r, a3) => (_parse_real = Module._parse_real = wasmExports.parse_real)(e, t3, r, a3), _pg_strcasecmp = Module._pg_strcasecmp = (e, t3) => (_pg_strcasecmp = Module._pg_strcasecmp = wasmExports.pg_strcasecmp)(e, t3), _ScanKeyInit = Module._ScanKeyInit = (e, t3, r, a3, o5) => (_ScanKeyInit = Module._ScanKeyInit = wasmExports.ScanKeyInit)(e, t3, r, a3, o5), _dsm_segment_handle = Module._dsm_segment_handle = (e) => (_dsm_segment_handle = Module._dsm_segment_handle = wasmExports.dsm_segment_handle)(e), _dsm_create = Module._dsm_create = (e, t3) => (_dsm_create = Module._dsm_create = wasmExports.dsm_create)(e, t3), _dsm_segment_address = Module._dsm_segment_address = (e) => (_dsm_segment_address = Module._dsm_segment_address = wasmExports.dsm_segment_address)(e), _dsa_pin_mapping = Module._dsa_pin_mapping = (e) => (_dsa_pin_mapping = Module._dsa_pin_mapping = wasmExports.dsa_pin_mapping)(e), _dsm_attach = Module._dsm_attach = (e) => (_dsm_attach = Module._dsm_attach = wasmExports.dsm_attach)(e), _dsm_detach = Module._dsm_detach = (e) => (_dsm_detach = Module._dsm_detach = wasmExports.dsm_detach)(e), _dsa_detach = Module._dsa_detach = (e) => (_dsa_detach = Module._dsa_detach = wasmExports.dsa_detach)(e), _ShmemInitStruct = Module._ShmemInitStruct = (e, t3, r) => (_ShmemInitStruct = Module._ShmemInitStruct = wasmExports.ShmemInitStruct)(e, t3, r), _LWLockAcquire = Module._LWLockAcquire = (e, t3) => (_LWLockAcquire = Module._LWLockAcquire = wasmExports.LWLockAcquire)(e, t3), _LWLockRelease = Module._LWLockRelease = (e) => (_LWLockRelease = Module._LWLockRelease = wasmExports.LWLockRelease)(e), _LWLockConditionalAcquire = Module._LWLockConditionalAcquire = (e, t3) => (_LWLockConditionalAcquire = Module._LWLockConditionalAcquire = wasmExports.LWLockConditionalAcquire)(e, t3), _dsa_create_ext = Module._dsa_create_ext = (e, t3, r) => (_dsa_create_ext = Module._dsa_create_ext = wasmExports.dsa_create_ext)(e, t3, r), _dsa_allocate_extended = Module._dsa_allocate_extended = (e, t3, r) => (_dsa_allocate_extended = Module._dsa_allocate_extended = wasmExports.dsa_allocate_extended)(e, t3, r), _dsa_get_address = Module._dsa_get_address = (e, t3) => (_dsa_get_address = Module._dsa_get_address = wasmExports.dsa_get_address)(e, t3), _LWLockInitialize = Module._LWLockInitialize = (e, t3) => (_LWLockInitialize = Module._LWLockInitialize = wasmExports.LWLockInitialize)(e, t3), _dsa_attach = Module._dsa_attach = (e) => (_dsa_attach = Module._dsa_attach = wasmExports.dsa_attach)(e), _dsa_free = Module._dsa_free = (e, t3) => (_dsa_free = Module._dsa_free = wasmExports.dsa_free)(e, t3), _dsa_get_total_size = Module._dsa_get_total_size = (e) => (_dsa_get_total_size = Module._dsa_get_total_size = wasmExports.dsa_get_total_size)(e), _MemoryContextMemAllocated = Module._MemoryContextMemAllocated = (e, t3) => (_MemoryContextMemAllocated = Module._MemoryContextMemAllocated = wasmExports.MemoryContextMemAllocated)(e, t3), _check_stack_depth = Module._check_stack_depth = () => (_check_stack_depth = Module._check_stack_depth = wasmExports.check_stack_depth)(), _GetCurrentCommandId = Module._GetCurrentCommandId = (e) => (_GetCurrentCommandId = Module._GetCurrentCommandId = wasmExports.GetCurrentCommandId)(e), _toast_open_indexes = Module._toast_open_indexes = (e, t3, r, a3) => (_toast_open_indexes = Module._toast_open_indexes = wasmExports.toast_open_indexes)(e, t3, r, a3), _heap_insert = Module._heap_insert = (e, t3, r, a3, o5) => (_heap_insert = Module._heap_insert = wasmExports.heap_insert)(e, t3, r, a3, o5), _RelationGetIndexList = Module._RelationGetIndexList = (e) => (_RelationGetIndexList = Module._RelationGetIndexList = wasmExports.RelationGetIndexList)(e), _list_free = Module._list_free = (e) => (_list_free = Module._list_free = wasmExports.list_free)(e), _systable_beginscan = Module._systable_beginscan = (e, t3, r, a3, o5, _4) => (_systable_beginscan = Module._systable_beginscan = wasmExports.systable_beginscan)(e, t3, r, a3, o5, _4), _systable_getnext = Module._systable_getnext = (e) => (_systable_getnext = Module._systable_getnext = wasmExports.systable_getnext)(e), _systable_endscan = Module._systable_endscan = (e) => (_systable_endscan = Module._systable_endscan = wasmExports.systable_endscan)(e), _toast_close_indexes = Module._toast_close_indexes = (e, t3, r) => (_toast_close_indexes = Module._toast_close_indexes = wasmExports.toast_close_indexes)(e, t3, r), _systable_beginscan_ordered = Module._systable_beginscan_ordered = (e, t3, r, a3, o5) => (_systable_beginscan_ordered = Module._systable_beginscan_ordered = wasmExports.systable_beginscan_ordered)(e, t3, r, a3, o5), _systable_getnext_ordered = Module._systable_getnext_ordered = (e, t3) => (_systable_getnext_ordered = Module._systable_getnext_ordered = wasmExports.systable_getnext_ordered)(e, t3), _systable_endscan_ordered = Module._systable_endscan_ordered = (e) => (_systable_endscan_ordered = Module._systable_endscan_ordered = wasmExports.systable_endscan_ordered)(e), _get_toast_snapshot = Module._get_toast_snapshot = () => (_get_toast_snapshot = Module._get_toast_snapshot = wasmExports.get_toast_snapshot)(), _convert_tuples_by_position = Module._convert_tuples_by_position = (e, t3, r) => (_convert_tuples_by_position = Module._convert_tuples_by_position = wasmExports.convert_tuples_by_position)(e, t3, r), _execute_attr_map_tuple = Module._execute_attr_map_tuple = (e, t3) => (_execute_attr_map_tuple = Module._execute_attr_map_tuple = wasmExports.execute_attr_map_tuple)(e, t3), _ExecStoreVirtualTuple = Module._ExecStoreVirtualTuple = (e) => (_ExecStoreVirtualTuple = Module._ExecStoreVirtualTuple = wasmExports.ExecStoreVirtualTuple)(e), _bms_is_member = Module._bms_is_member = (e, t3) => (_bms_is_member = Module._bms_is_member = wasmExports.bms_is_member)(e, t3), _bms_add_member = Module._bms_add_member = (e, t3) => (_bms_add_member = Module._bms_add_member = wasmExports.bms_add_member)(e, t3), _CreateTupleDescCopy = Module._CreateTupleDescCopy = (e) => (_CreateTupleDescCopy = Module._CreateTupleDescCopy = wasmExports.CreateTupleDescCopy)(e), _ResourceOwnerEnlarge = Module._ResourceOwnerEnlarge = (e) => (_ResourceOwnerEnlarge = Module._ResourceOwnerEnlarge = wasmExports.ResourceOwnerEnlarge)(e), _ResourceOwnerRemember = Module._ResourceOwnerRemember = (e, t3, r) => (_ResourceOwnerRemember = Module._ResourceOwnerRemember = wasmExports.ResourceOwnerRemember)(e, t3, r), _DecrTupleDescRefCount = Module._DecrTupleDescRefCount = (e) => (_DecrTupleDescRefCount = Module._DecrTupleDescRefCount = wasmExports.DecrTupleDescRefCount)(e), _ResourceOwnerForget = Module._ResourceOwnerForget = (e, t3, r) => (_ResourceOwnerForget = Module._ResourceOwnerForget = wasmExports.ResourceOwnerForget)(e, t3, r), _datumIsEqual = Module._datumIsEqual = (e, t3, r, a3) => (_datumIsEqual = Module._datumIsEqual = wasmExports.datumIsEqual)(e, t3, r, a3), _namestrcpy = Module._namestrcpy = (e, t3) => (_namestrcpy = Module._namestrcpy = wasmExports.namestrcpy)(e, t3), _TupleDescInitEntryCollation = Module._TupleDescInitEntryCollation = (e, t3, r) => (_TupleDescInitEntryCollation = Module._TupleDescInitEntryCollation = wasmExports.TupleDescInitEntryCollation)(e, t3, r), _stringToNode = Module._stringToNode = (e) => (_stringToNode = Module._stringToNode = wasmExports.stringToNode)(e), _psprintf = Module._psprintf = (e, t3) => (_psprintf = Module._psprintf = wasmExports.psprintf)(e, t3), _pg_detoast_datum_copy = Module._pg_detoast_datum_copy = (e) => (_pg_detoast_datum_copy = Module._pg_detoast_datum_copy = wasmExports.pg_detoast_datum_copy)(e), _get_typlenbyvalalign = Module._get_typlenbyvalalign = (e, t3, r, a3) => (_get_typlenbyvalalign = Module._get_typlenbyvalalign = wasmExports.get_typlenbyvalalign)(e, t3, r, a3), _deconstruct_array = Module._deconstruct_array = (e, t3, r, a3, o5, _4, s5, n3) => (_deconstruct_array = Module._deconstruct_array = wasmExports.deconstruct_array)(e, t3, r, a3, o5, _4, s5, n3), _ginCompareAttEntries = Module._ginCompareAttEntries = (e, t3, r, a3, o5, _4, s5) => (_ginCompareAttEntries = Module._ginCompareAttEntries = wasmExports.ginCompareAttEntries)(e, t3, r, a3, o5, _4, s5), _repalloc_huge = Module._repalloc_huge = (e, t3) => (_repalloc_huge = Module._repalloc_huge = wasmExports.repalloc_huge)(e, t3), _GinDataLeafPageGetItems = Module._GinDataLeafPageGetItems = (e, t3, r) => (_GinDataLeafPageGetItems = Module._GinDataLeafPageGetItems = wasmExports.GinDataLeafPageGetItems)(e, t3, r), _tbm_add_tuples = Module._tbm_add_tuples = (e, t3, r, a3) => (_tbm_add_tuples = Module._tbm_add_tuples = wasmExports.tbm_add_tuples)(e, t3, r, a3), _ginPostingListDecode = Module._ginPostingListDecode = (e, t3) => (_ginPostingListDecode = Module._ginPostingListDecode = wasmExports.ginPostingListDecode)(e, t3), _ItemPointerCompare = Module._ItemPointerCompare = (e, t3) => (_ItemPointerCompare = Module._ItemPointerCompare = wasmExports.ItemPointerCompare)(e, t3), _gintuple_get_attrnum = Module._gintuple_get_attrnum = (e, t3) => (_gintuple_get_attrnum = Module._gintuple_get_attrnum = wasmExports.gintuple_get_attrnum)(e, t3), _gintuple_get_key = Module._gintuple_get_key = (e, t3, r) => (_gintuple_get_key = Module._gintuple_get_key = wasmExports.gintuple_get_key)(e, t3, r), _LockPage = Module._LockPage = (e, t3, r) => (_LockPage = Module._LockPage = wasmExports.LockPage)(e, t3, r), _UnlockPage = Module._UnlockPage = (e, t3, r) => (_UnlockPage = Module._UnlockPage = wasmExports.UnlockPage)(e, t3, r), _vacuum_delay_point = Module._vacuum_delay_point = (e) => (_vacuum_delay_point = Module._vacuum_delay_point = wasmExports.vacuum_delay_point)(e), _RecordFreeIndexPage = Module._RecordFreeIndexPage = (e, t3) => (_RecordFreeIndexPage = Module._RecordFreeIndexPage = wasmExports.RecordFreeIndexPage)(e, t3), _IndexFreeSpaceMapVacuum = Module._IndexFreeSpaceMapVacuum = (e) => (_IndexFreeSpaceMapVacuum = Module._IndexFreeSpaceMapVacuum = wasmExports.IndexFreeSpaceMapVacuum)(e), _initGinState = Module._initGinState = (e, t3) => (_initGinState = Module._initGinState = wasmExports.initGinState)(e, t3), _pg_prng_double = Module._pg_prng_double = (e) => (_pg_prng_double = Module._pg_prng_double = wasmExports.pg_prng_double)(e), _pgstat_progress_update_param = Module._pgstat_progress_update_param = (e, t3) => (_pgstat_progress_update_param = Module._pgstat_progress_update_param = wasmExports.pgstat_progress_update_param)(e, t3), _log_newpage_range = Module._log_newpage_range = (e, t3, r, a3, o5) => (_log_newpage_range = Module._log_newpage_range = wasmExports.log_newpage_range)(e, t3, r, a3, o5), _GetFreeIndexPage = Module._GetFreeIndexPage = (e) => (_GetFreeIndexPage = Module._GetFreeIndexPage = wasmExports.GetFreeIndexPage)(e), _ConditionalLockBuffer = Module._ConditionalLockBuffer = (e) => (_ConditionalLockBuffer = Module._ConditionalLockBuffer = wasmExports.ConditionalLockBuffer)(e), _LockBufferForCleanup = Module._LockBufferForCleanup = (e) => (_LockBufferForCleanup = Module._LockBufferForCleanup = wasmExports.LockBufferForCleanup)(e), _ReadNextFullTransactionId = Module._ReadNextFullTransactionId = () => (_ReadNextFullTransactionId = Module._ReadNextFullTransactionId = wasmExports.ReadNextFullTransactionId)(), _PageIndexMultiDelete = Module._PageIndexMultiDelete = (e, t3, r) => (_PageIndexMultiDelete = Module._PageIndexMultiDelete = wasmExports.PageIndexMultiDelete)(e, t3, r), _list_make1_impl = Module._list_make1_impl = (e, t3) => (_list_make1_impl = Module._list_make1_impl = wasmExports.list_make1_impl)(e, t3), _lcons = Module._lcons = (e, t3) => (_lcons = Module._lcons = wasmExports.lcons)(e, t3), _pow = Module._pow = (e, t3) => (_pow = Module._pow = wasmExports.pow)(e, t3), _smgrnblocks = Module._smgrnblocks = (e, t3) => (_smgrnblocks = Module._smgrnblocks = wasmExports.smgrnblocks)(e, t3), _list_free_deep = Module._list_free_deep = (e) => (_list_free_deep = Module._list_free_deep = wasmExports.list_free_deep)(e), _BufFileWrite = Module._BufFileWrite = (e, t3, r) => (_BufFileWrite = Module._BufFileWrite = wasmExports.BufFileWrite)(e, t3, r), _BufFileReadExact = Module._BufFileReadExact = (e, t3, r) => (_BufFileReadExact = Module._BufFileReadExact = wasmExports.BufFileReadExact)(e, t3, r), _BufFileClose = Module._BufFileClose = (e) => (_BufFileClose = Module._BufFileClose = wasmExports.BufFileClose)(e), _pairingheap_remove_first = Module._pairingheap_remove_first = (e) => (_pairingheap_remove_first = Module._pairingheap_remove_first = wasmExports.pairingheap_remove_first)(e), _pairingheap_add = Module._pairingheap_add = (e, t3) => (_pairingheap_add = Module._pairingheap_add = wasmExports.pairingheap_add)(e, t3), _float_overflow_error = Module._float_overflow_error = () => (_float_overflow_error = Module._float_overflow_error = wasmExports.float_overflow_error)(), _float8_cmp_internal = Module._float8_cmp_internal = (e, t3) => (_float8_cmp_internal = Module._float8_cmp_internal = wasmExports.float8_cmp_internal)(e, t3), _float_underflow_error = Module._float_underflow_error = () => (_float_underflow_error = Module._float_underflow_error = wasmExports.float_underflow_error)(), _DirectFunctionCall5Coll = Module._DirectFunctionCall5Coll = (e, t3, r, a3, o5, _4, s5) => (_DirectFunctionCall5Coll = Module._DirectFunctionCall5Coll = wasmExports.DirectFunctionCall5Coll)(e, t3, r, a3, o5, _4, s5), _pairingheap_allocate = Module._pairingheap_allocate = (e, t3) => (_pairingheap_allocate = Module._pairingheap_allocate = wasmExports.pairingheap_allocate)(e, t3), _GetXLogInsertRecPtr = Module._GetXLogInsertRecPtr = () => (_GetXLogInsertRecPtr = Module._GetXLogInsertRecPtr = wasmExports.GetXLogInsertRecPtr)(), _OidFunctionCall1Coll = Module._OidFunctionCall1Coll = (e, t3, r) => (_OidFunctionCall1Coll = Module._OidFunctionCall1Coll = wasmExports.OidFunctionCall1Coll)(e, t3, r), _GenerationContextCreate = Module._GenerationContextCreate = (e, t3, r, a3, o5) => (_GenerationContextCreate = Module._GenerationContextCreate = wasmExports.GenerationContextCreate)(e, t3, r, a3, o5), _block_range_read_stream_cb = Module._block_range_read_stream_cb = (e, t3, r) => (_block_range_read_stream_cb = Module._block_range_read_stream_cb = wasmExports.block_range_read_stream_cb)(e, t3, r), _read_stream_begin_relation = Module._read_stream_begin_relation = (e, t3, r, a3, o5, _4, s5) => (_read_stream_begin_relation = Module._read_stream_begin_relation = wasmExports.read_stream_begin_relation)(e, t3, r, a3, o5, _4, s5), _read_stream_next_buffer = Module._read_stream_next_buffer = (e, t3) => (_read_stream_next_buffer = Module._read_stream_next_buffer = wasmExports.read_stream_next_buffer)(e, t3), _read_stream_end = Module._read_stream_end = (e) => (_read_stream_end = Module._read_stream_end = wasmExports.read_stream_end)(e), __hash_getbuf = Module.__hash_getbuf = (e, t3, r, a3) => (__hash_getbuf = Module.__hash_getbuf = wasmExports._hash_getbuf)(e, t3, r, a3), __hash_relbuf = Module.__hash_relbuf = (e, t3) => (__hash_relbuf = Module.__hash_relbuf = wasmExports._hash_relbuf)(e, t3), __hash_get_indextuple_hashkey = Module.__hash_get_indextuple_hashkey = (e) => (__hash_get_indextuple_hashkey = Module.__hash_get_indextuple_hashkey = wasmExports._hash_get_indextuple_hashkey)(e), _hashcharextended = Module._hashcharextended = (e) => (_hashcharextended = Module._hashcharextended = wasmExports.hashcharextended)(e), _hashint8 = Module._hashint8 = (e) => (_hashint8 = Module._hashint8 = wasmExports.hashint8)(e), _hashint8extended = Module._hashint8extended = (e) => (_hashint8extended = Module._hashint8extended = wasmExports.hashint8extended)(e), _hash_bytes_extended = Module._hash_bytes_extended = (e, t3, r) => (_hash_bytes_extended = Module._hash_bytes_extended = wasmExports.hash_bytes_extended)(e, t3, r), _hashfloat8 = Module._hashfloat8 = (e) => (_hashfloat8 = Module._hashfloat8 = wasmExports.hashfloat8)(e), _hashfloat8extended = Module._hashfloat8extended = (e) => (_hashfloat8extended = Module._hashfloat8extended = wasmExports.hashfloat8extended)(e), _pg_newlocale_from_collation = Module._pg_newlocale_from_collation = (e) => (_pg_newlocale_from_collation = Module._pg_newlocale_from_collation = wasmExports.pg_newlocale_from_collation)(e), __hash_ovflblkno_to_bitno = Module.__hash_ovflblkno_to_bitno = (e, t3) => (__hash_ovflblkno_to_bitno = Module.__hash_ovflblkno_to_bitno = wasmExports._hash_ovflblkno_to_bitno)(e, t3), _hash_destroy = Module._hash_destroy = (e) => (_hash_destroy = Module._hash_destroy = wasmExports.hash_destroy)(e), _list_member_oid = Module._list_member_oid = (e, t3) => (_list_member_oid = Module._list_member_oid = wasmExports.list_member_oid)(e, t3), _CommandCounterIncrement = Module._CommandCounterIncrement = () => (_CommandCounterIncrement = Module._CommandCounterIncrement = wasmExports.CommandCounterIncrement)(), _list_concat_copy = Module._list_concat_copy = (e, t3) => (_list_concat_copy = Module._list_concat_copy = wasmExports.list_concat_copy)(e, t3), _HeapTupleSatisfiesVisibility = Module._HeapTupleSatisfiesVisibility = (e, t3, r) => (_HeapTupleSatisfiesVisibility = Module._HeapTupleSatisfiesVisibility = wasmExports.HeapTupleSatisfiesVisibility)(e, t3, r), _GetAccessStrategy = Module._GetAccessStrategy = (e) => (_GetAccessStrategy = Module._GetAccessStrategy = wasmExports.GetAccessStrategy)(e), _FreeAccessStrategy = Module._FreeAccessStrategy = (e) => (_FreeAccessStrategy = Module._FreeAccessStrategy = wasmExports.FreeAccessStrategy)(e), _heap_getnext = Module._heap_getnext = (e, t3) => (_heap_getnext = Module._heap_getnext = wasmExports.heap_getnext)(e, t3), _ExecStoreBufferHeapTuple = Module._ExecStoreBufferHeapTuple = (e, t3, r) => (_ExecStoreBufferHeapTuple = Module._ExecStoreBufferHeapTuple = wasmExports.ExecStoreBufferHeapTuple)(e, t3, r), _heap_fetch = Module._heap_fetch = (e, t3, r, a3, o5) => (_heap_fetch = Module._heap_fetch = wasmExports.heap_fetch)(e, t3, r, a3, o5), _HeapTupleSatisfiesVacuum = Module._HeapTupleSatisfiesVacuum = (e, t3, r) => (_HeapTupleSatisfiesVacuum = Module._HeapTupleSatisfiesVacuum = wasmExports.HeapTupleSatisfiesVacuum)(e, t3, r), _GetMultiXactIdMembers = Module._GetMultiXactIdMembers = (e, t3, r, a3) => (_GetMultiXactIdMembers = Module._GetMultiXactIdMembers = wasmExports.GetMultiXactIdMembers)(e, t3, r, a3), _TransactionIdPrecedes = Module._TransactionIdPrecedes = (e, t3) => (_TransactionIdPrecedes = Module._TransactionIdPrecedes = wasmExports.TransactionIdPrecedes)(e, t3), _GetBulkInsertState = Module._GetBulkInsertState = () => (_GetBulkInsertState = Module._GetBulkInsertState = wasmExports.GetBulkInsertState)(), _FreeBulkInsertState = Module._FreeBulkInsertState = (e) => (_FreeBulkInsertState = Module._FreeBulkInsertState = wasmExports.FreeBulkInsertState)(e), _visibilitymap_clear = Module._visibilitymap_clear = (e, t3, r, a3) => (_visibilitymap_clear = Module._visibilitymap_clear = wasmExports.visibilitymap_clear)(e, t3, r, a3), _pgstat_count_heap_insert = Module._pgstat_count_heap_insert = (e, t3) => (_pgstat_count_heap_insert = Module._pgstat_count_heap_insert = wasmExports.pgstat_count_heap_insert)(e, t3), _heap_multi_insert = Module._heap_multi_insert = (e, t3, r, a3, o5, _4) => (_heap_multi_insert = Module._heap_multi_insert = wasmExports.heap_multi_insert)(e, t3, r, a3, o5, _4), _ExecFetchSlotHeapTuple = Module._ExecFetchSlotHeapTuple = (e, t3, r) => (_ExecFetchSlotHeapTuple = Module._ExecFetchSlotHeapTuple = wasmExports.ExecFetchSlotHeapTuple)(e, t3, r), _heap_delete = Module._heap_delete = (e, t3, r, a3, o5, _4, s5) => (_heap_delete = Module._heap_delete = wasmExports.heap_delete)(e, t3, r, a3, o5, _4, s5), _visibilitymap_pin = Module._visibilitymap_pin = (e, t3, r) => (_visibilitymap_pin = Module._visibilitymap_pin = wasmExports.visibilitymap_pin)(e, t3, r), _HeapTupleSatisfiesUpdate = Module._HeapTupleSatisfiesUpdate = (e, t3, r) => (_HeapTupleSatisfiesUpdate = Module._HeapTupleSatisfiesUpdate = wasmExports.HeapTupleSatisfiesUpdate)(e, t3, r), _TransactionIdIsCurrentTransactionId = Module._TransactionIdIsCurrentTransactionId = (e) => (_TransactionIdIsCurrentTransactionId = Module._TransactionIdIsCurrentTransactionId = wasmExports.TransactionIdIsCurrentTransactionId)(e), _TransactionIdDidCommit = Module._TransactionIdDidCommit = (e) => (_TransactionIdDidCommit = Module._TransactionIdDidCommit = wasmExports.TransactionIdDidCommit)(e), _TransactionIdIsInProgress = Module._TransactionIdIsInProgress = (e) => (_TransactionIdIsInProgress = Module._TransactionIdIsInProgress = wasmExports.TransactionIdIsInProgress)(e), _bms_free = Module._bms_free = (e) => (_bms_free = Module._bms_free = wasmExports.bms_free)(e), _bms_add_members = Module._bms_add_members = (e, t3) => (_bms_add_members = Module._bms_add_members = wasmExports.bms_add_members)(e, t3), _bms_next_member = Module._bms_next_member = (e, t3) => (_bms_next_member = Module._bms_next_member = wasmExports.bms_next_member)(e, t3), _bms_overlap = Module._bms_overlap = (e, t3) => (_bms_overlap = Module._bms_overlap = wasmExports.bms_overlap)(e, t3), _HeapTupleGetUpdateXid = Module._HeapTupleGetUpdateXid = (e) => (_HeapTupleGetUpdateXid = Module._HeapTupleGetUpdateXid = wasmExports.HeapTupleGetUpdateXid)(e), _heap_lock_tuple = Module._heap_lock_tuple = (e, t3, r, a3, o5, _4, s5, n3) => (_heap_lock_tuple = Module._heap_lock_tuple = wasmExports.heap_lock_tuple)(e, t3, r, a3, o5, _4, s5, n3), _MultiXactIdPrecedes = Module._MultiXactIdPrecedes = (e, t3) => (_MultiXactIdPrecedes = Module._MultiXactIdPrecedes = wasmExports.MultiXactIdPrecedes)(e, t3), _heap_tuple_needs_eventual_freeze = Module._heap_tuple_needs_eventual_freeze = (e) => (_heap_tuple_needs_eventual_freeze = Module._heap_tuple_needs_eventual_freeze = wasmExports.heap_tuple_needs_eventual_freeze)(e), _PrefetchBuffer = Module._PrefetchBuffer = (e, t3, r, a3) => (_PrefetchBuffer = Module._PrefetchBuffer = wasmExports.PrefetchBuffer)(e, t3, r, a3), _RelationTruncate = Module._RelationTruncate = (e, t3) => (_RelationTruncate = Module._RelationTruncate = wasmExports.RelationTruncate)(e, t3), _FlushRelationBuffers = Module._FlushRelationBuffers = (e) => (_FlushRelationBuffers = Module._FlushRelationBuffers = wasmExports.FlushRelationBuffers)(e), _smgrexists = Module._smgrexists = (e, t3) => (_smgrexists = Module._smgrexists = wasmExports.smgrexists)(e, t3), _table_slot_create = Module._table_slot_create = (e, t3) => (_table_slot_create = Module._table_slot_create = wasmExports.table_slot_create)(e, t3), _ExecDropSingleTupleTableSlot = Module._ExecDropSingleTupleTableSlot = (e) => (_ExecDropSingleTupleTableSlot = Module._ExecDropSingleTupleTableSlot = wasmExports.ExecDropSingleTupleTableSlot)(e), _CreateExecutorState = Module._CreateExecutorState = () => (_CreateExecutorState = Module._CreateExecutorState = wasmExports.CreateExecutorState)(), _MakePerTupleExprContext = Module._MakePerTupleExprContext = (e) => (_MakePerTupleExprContext = Module._MakePerTupleExprContext = wasmExports.MakePerTupleExprContext)(e), _ExecPrepareQual = Module._ExecPrepareQual = (e, t3) => (_ExecPrepareQual = Module._ExecPrepareQual = wasmExports.ExecPrepareQual)(e, t3), _GetOldestNonRemovableTransactionId = Module._GetOldestNonRemovableTransactionId = (e) => (_GetOldestNonRemovableTransactionId = Module._GetOldestNonRemovableTransactionId = wasmExports.GetOldestNonRemovableTransactionId)(e), _FormIndexDatum = Module._FormIndexDatum = (e, t3, r, a3, o5) => (_FormIndexDatum = Module._FormIndexDatum = wasmExports.FormIndexDatum)(e, t3, r, a3, o5), _FreeExecutorState = Module._FreeExecutorState = (e) => (_FreeExecutorState = Module._FreeExecutorState = wasmExports.FreeExecutorState)(e), _MakeSingleTupleTableSlot = Module._MakeSingleTupleTableSlot = (e, t3) => (_MakeSingleTupleTableSlot = Module._MakeSingleTupleTableSlot = wasmExports.MakeSingleTupleTableSlot)(e, t3), _tuplesort_getdatum = Module._tuplesort_getdatum = (e, t3, r, a3, o5, _4) => (_tuplesort_getdatum = Module._tuplesort_getdatum = wasmExports.tuplesort_getdatum)(e, t3, r, a3, o5, _4), _ExecStoreHeapTuple = Module._ExecStoreHeapTuple = (e, t3, r) => (_ExecStoreHeapTuple = Module._ExecStoreHeapTuple = wasmExports.ExecStoreHeapTuple)(e, t3, r), _XidInMVCCSnapshot = Module._XidInMVCCSnapshot = (e, t3) => (_XidInMVCCSnapshot = Module._XidInMVCCSnapshot = wasmExports.XidInMVCCSnapshot)(e, t3), _bsearch = Module._bsearch = (e, t3, r, a3, o5) => (_bsearch = Module._bsearch = wasmExports.bsearch)(e, t3, r, a3, o5), _XLogRecGetBlockTagExtended = Module._XLogRecGetBlockTagExtended = (e, t3, r, a3, o5, _4) => (_XLogRecGetBlockTagExtended = Module._XLogRecGetBlockTagExtended = wasmExports.XLogRecGetBlockTagExtended)(e, t3, r, a3, o5, _4), _hash_seq_init = Module._hash_seq_init = (e, t3) => (_hash_seq_init = Module._hash_seq_init = wasmExports.hash_seq_init)(e, t3), _hash_seq_search = Module._hash_seq_search = (e) => (_hash_seq_search = Module._hash_seq_search = wasmExports.hash_seq_search)(e), _errcode_for_file_access = Module._errcode_for_file_access = () => (_errcode_for_file_access = Module._errcode_for_file_access = wasmExports.errcode_for_file_access)(), _pg_snprintf = Module._pg_snprintf = (e, t3, r, a3) => (_pg_snprintf = Module._pg_snprintf = wasmExports.pg_snprintf)(e, t3, r, a3), _OpenTransientFile = Module._OpenTransientFile = (e, t3) => (_OpenTransientFile = Module._OpenTransientFile = wasmExports.OpenTransientFile)(e, t3), _ftruncate = Module._ftruncate = (e, t3) => (_ftruncate = Module._ftruncate = wasmExports.ftruncate)(e, t3), ___errno_location = Module.___errno_location = () => (___errno_location = Module.___errno_location = wasmExports.__errno_location)(), _pwrite = Module._pwrite = (e, t3, r, a3) => (_pwrite = Module._pwrite = wasmExports.pwrite)(e, t3, r, a3), _CloseTransientFile = Module._CloseTransientFile = (e) => (_CloseTransientFile = Module._CloseTransientFile = wasmExports.CloseTransientFile)(e), _sscanf = Module._sscanf = (e, t3, r) => (_sscanf = Module._sscanf = wasmExports.sscanf)(e, t3, r), _unlink = Module._unlink = (e) => (_unlink = Module._unlink = wasmExports.unlink)(e), _fsync_fname = Module._fsync_fname = (e, t3) => (_fsync_fname = Module._fsync_fname = wasmExports.fsync_fname)(e, t3), _GetCurrentTimestamp = Module._GetCurrentTimestamp = () => (_GetCurrentTimestamp = Module._GetCurrentTimestamp = wasmExports.GetCurrentTimestamp)(), _get_namespace_name = Module._get_namespace_name = (e) => (_get_namespace_name = Module._get_namespace_name = wasmExports.get_namespace_name)(e), _pg_prng_uint32 = Module._pg_prng_uint32 = (e) => (_pg_prng_uint32 = Module._pg_prng_uint32 = wasmExports.pg_prng_uint32)(e), _GetRecordedFreeSpace = Module._GetRecordedFreeSpace = (e, t3) => (_GetRecordedFreeSpace = Module._GetRecordedFreeSpace = wasmExports.GetRecordedFreeSpace)(e, t3), _visibilitymap_get_status = Module._visibilitymap_get_status = (e, t3, r) => (_visibilitymap_get_status = Module._visibilitymap_get_status = wasmExports.visibilitymap_get_status)(e, t3, r), _vac_estimate_reltuples = Module._vac_estimate_reltuples = (e, t3, r, a3) => (_vac_estimate_reltuples = Module._vac_estimate_reltuples = wasmExports.vac_estimate_reltuples)(e, t3, r, a3), _WaitLatch = Module._WaitLatch = (e, t3, r, a3) => (_WaitLatch = Module._WaitLatch = wasmExports.WaitLatch)(e, t3, r, a3), _ResetLatch = Module._ResetLatch = (e) => (_ResetLatch = Module._ResetLatch = wasmExports.ResetLatch)(e), _clock_gettime = Module._clock_gettime = (e, t3) => (_clock_gettime = Module._clock_gettime = wasmExports.clock_gettime)(e, t3), _WalUsageAccumDiff = Module._WalUsageAccumDiff = (e, t3, r) => (_WalUsageAccumDiff = Module._WalUsageAccumDiff = wasmExports.WalUsageAccumDiff)(e, t3, r), _BufferUsageAccumDiff = Module._BufferUsageAccumDiff = (e, t3, r) => (_BufferUsageAccumDiff = Module._BufferUsageAccumDiff = wasmExports.BufferUsageAccumDiff)(e, t3, r), _appendStringInfoString = Module._appendStringInfoString = (e, t3) => (_appendStringInfoString = Module._appendStringInfoString = wasmExports.appendStringInfoString)(e, t3), _set_errcontext_domain = Module._set_errcontext_domain = (e) => (_set_errcontext_domain = Module._set_errcontext_domain = wasmExports.set_errcontext_domain)(e), _errcontext_msg = Module._errcontext_msg = (e, t3) => (_errcontext_msg = Module._errcontext_msg = wasmExports.errcontext_msg)(e, t3), _visibilitymap_prepare_truncate = Module._visibilitymap_prepare_truncate = (e, t3) => (_visibilitymap_prepare_truncate = Module._visibilitymap_prepare_truncate = wasmExports.visibilitymap_prepare_truncate)(e, t3), _check_enable_rls = Module._check_enable_rls = (e, t3, r) => (_check_enable_rls = Module._check_enable_rls = wasmExports.check_enable_rls)(e, t3, r), _pg_class_aclcheck = Module._pg_class_aclcheck = (e, t3, r) => (_pg_class_aclcheck = Module._pg_class_aclcheck = wasmExports.pg_class_aclcheck)(e, t3, r), _try_index_open = Module._try_index_open = (e, t3) => (_try_index_open = Module._try_index_open = wasmExports.try_index_open)(e, t3), _btboolcmp = Module._btboolcmp = (e) => (_btboolcmp = Module._btboolcmp = wasmExports.btboolcmp)(e), _btint2cmp = Module._btint2cmp = (e) => (_btint2cmp = Module._btint2cmp = wasmExports.btint2cmp)(e), _btint4cmp = Module._btint4cmp = (e) => (_btint4cmp = Module._btint4cmp = wasmExports.btint4cmp)(e), _btint8cmp = Module._btint8cmp = (e) => (_btint8cmp = Module._btint8cmp = wasmExports.btint8cmp)(e), _btoidcmp = Module._btoidcmp = (e) => (_btoidcmp = Module._btoidcmp = wasmExports.btoidcmp)(e), _btcharcmp = Module._btcharcmp = (e) => (_btcharcmp = Module._btcharcmp = wasmExports.btcharcmp)(e), __bt_form_posting = Module.__bt_form_posting = (e, t3, r) => (__bt_form_posting = Module.__bt_form_posting = wasmExports._bt_form_posting)(e, t3, r), __bt_mkscankey = Module.__bt_mkscankey = (e, t3) => (__bt_mkscankey = Module.__bt_mkscankey = wasmExports._bt_mkscankey)(e, t3), __bt_checkpage = Module.__bt_checkpage = (e, t3) => (__bt_checkpage = Module.__bt_checkpage = wasmExports._bt_checkpage)(e, t3), __bt_compare = Module.__bt_compare = (e, t3, r, a3) => (__bt_compare = Module.__bt_compare = wasmExports._bt_compare)(e, t3, r, a3), __bt_relbuf = Module.__bt_relbuf = (e, t3) => (__bt_relbuf = Module.__bt_relbuf = wasmExports._bt_relbuf)(e, t3), __bt_search = Module.__bt_search = (e, t3, r, a3, o5) => (__bt_search = Module.__bt_search = wasmExports._bt_search)(e, t3, r, a3, o5), __bt_binsrch_insert = Module.__bt_binsrch_insert = (e, t3) => (__bt_binsrch_insert = Module.__bt_binsrch_insert = wasmExports._bt_binsrch_insert)(e, t3), __bt_freestack = Module.__bt_freestack = (e) => (__bt_freestack = Module.__bt_freestack = wasmExports._bt_freestack)(e), __bt_metaversion = Module.__bt_metaversion = (e, t3, r) => (__bt_metaversion = Module.__bt_metaversion = wasmExports._bt_metaversion)(e, t3, r), _get_opfamily_member = Module._get_opfamily_member = (e, t3, r, a3) => (_get_opfamily_member = Module._get_opfamily_member = wasmExports.get_opfamily_member)(e, t3, r, a3), __bt_allequalimage = Module.__bt_allequalimage = (e, t3) => (__bt_allequalimage = Module.__bt_allequalimage = wasmExports._bt_allequalimage)(e, t3), ___wasm_setjmp_test = Module.___wasm_setjmp_test = (e, t3) => (___wasm_setjmp_test = Module.___wasm_setjmp_test = wasmExports.__wasm_setjmp_test)(e, t3), _before_shmem_exit = Module._before_shmem_exit = (e, t3) => (_before_shmem_exit = Module._before_shmem_exit = wasmExports.before_shmem_exit)(e, t3), ___wasm_setjmp = Module.___wasm_setjmp = (e, t3, r) => (___wasm_setjmp = Module.___wasm_setjmp = wasmExports.__wasm_setjmp)(e, t3, r), _cancel_before_shmem_exit = Module._cancel_before_shmem_exit = (e, t3) => (_cancel_before_shmem_exit = Module._cancel_before_shmem_exit = wasmExports.cancel_before_shmem_exit)(e, t3), _pg_re_throw = Module._pg_re_throw = () => (_pg_re_throw = Module._pg_re_throw = wasmExports.pg_re_throw)(), _emscripten_longjmp = Module._emscripten_longjmp = (e, t3) => (_emscripten_longjmp = Module._emscripten_longjmp = wasmExports.emscripten_longjmp)(e, t3), _ConditionVariableBroadcast = Module._ConditionVariableBroadcast = (e) => (_ConditionVariableBroadcast = Module._ConditionVariableBroadcast = wasmExports.ConditionVariableBroadcast)(e), _datum_image_eq = Module._datum_image_eq = (e, t3, r, a3) => (_datum_image_eq = Module._datum_image_eq = wasmExports.datum_image_eq)(e, t3, r, a3), _time = Module._time = (e) => (_time = Module._time = wasmExports.time)(e), __bt_check_natts = Module.__bt_check_natts = (e, t3, r, a3) => (__bt_check_natts = Module.__bt_check_natts = wasmExports._bt_check_natts)(e, t3, r, a3), _strlcpy = Module._strlcpy = (e, t3, r) => (_strlcpy = Module._strlcpy = wasmExports.strlcpy)(e, t3, r), _strncpy = Module._strncpy = (e, t3, r) => (_strncpy = Module._strncpy = wasmExports.strncpy)(e, t3, r), _timestamptz_to_str = Module._timestamptz_to_str = (e) => (_timestamptz_to_str = Module._timestamptz_to_str = wasmExports.timestamptz_to_str)(e), _XLogRecGetBlockRefInfo = Module._XLogRecGetBlockRefInfo = (e, t3, r, a3, o5) => (_XLogRecGetBlockRefInfo = Module._XLogRecGetBlockRefInfo = wasmExports.XLogRecGetBlockRefInfo)(e, t3, r, a3, o5), _varstr_cmp = Module._varstr_cmp = (e, t3, r, a3, o5) => (_varstr_cmp = Module._varstr_cmp = wasmExports.varstr_cmp)(e, t3, r, a3, o5), _getBaseType = Module._getBaseType = (e) => (_getBaseType = Module._getBaseType = wasmExports.getBaseType)(e), _exprType = Module._exprType = (e) => (_exprType = Module._exprType = wasmExports.exprType)(e), _GetActiveSnapshot = Module._GetActiveSnapshot = () => (_GetActiveSnapshot = Module._GetActiveSnapshot = wasmExports.GetActiveSnapshot)(), _errdetail_relkind_not_supported = Module._errdetail_relkind_not_supported = (e) => (_errdetail_relkind_not_supported = Module._errdetail_relkind_not_supported = wasmExports.errdetail_relkind_not_supported)(e), _table_openrv = Module._table_openrv = (e, t3) => (_table_openrv = Module._table_openrv = wasmExports.table_openrv)(e, t3), _table_slot_callbacks = Module._table_slot_callbacks = (e) => (_table_slot_callbacks = Module._table_slot_callbacks = wasmExports.table_slot_callbacks)(e), _clamp_row_est = Module._clamp_row_est = (e) => (_clamp_row_est = Module._clamp_row_est = wasmExports.clamp_row_est)(e), _pre_format_elog_string = Module._pre_format_elog_string = (e, t3) => (_pre_format_elog_string = Module._pre_format_elog_string = wasmExports.pre_format_elog_string)(e, t3), _format_elog_string = Module._format_elog_string = (e, t3) => (_format_elog_string = Module._format_elog_string = wasmExports.format_elog_string)(e, t3), _IsTransactionState = Module._IsTransactionState = () => (_IsTransactionState = Module._IsTransactionState = wasmExports.IsTransactionState)(), _estimate_expression_value = Module._estimate_expression_value = (e, t3) => (_estimate_expression_value = Module._estimate_expression_value = wasmExports.estimate_expression_value)(e, t3), _SetConfigOption = Module._SetConfigOption = (e, t3, r, a3) => (_SetConfigOption = Module._SetConfigOption = wasmExports.SetConfigOption)(e, t3, r, a3), _XLogFlush = Module._XLogFlush = (e) => (_XLogFlush = Module._XLogFlush = wasmExports.XLogFlush)(e), _get_call_result_type = Module._get_call_result_type = (e, t3, r) => (_get_call_result_type = Module._get_call_result_type = wasmExports.get_call_result_type)(e, t3, r), _HeapTupleHeaderGetDatum = Module._HeapTupleHeaderGetDatum = (e) => (_HeapTupleHeaderGetDatum = Module._HeapTupleHeaderGetDatum = wasmExports.HeapTupleHeaderGetDatum)(e), _GenericXLogStart = Module._GenericXLogStart = (e) => (_GenericXLogStart = Module._GenericXLogStart = wasmExports.GenericXLogStart)(e), _GenericXLogRegisterBuffer = Module._GenericXLogRegisterBuffer = (e, t3, r) => (_GenericXLogRegisterBuffer = Module._GenericXLogRegisterBuffer = wasmExports.GenericXLogRegisterBuffer)(e, t3, r), _GenericXLogFinish = Module._GenericXLogFinish = (e) => (_GenericXLogFinish = Module._GenericXLogFinish = wasmExports.GenericXLogFinish)(e), _GenericXLogAbort = Module._GenericXLogAbort = (e) => (_GenericXLogAbort = Module._GenericXLogAbort = wasmExports.GenericXLogAbort)(e), _errmsg_plural = Module._errmsg_plural = (e, t3, r, a3) => (_errmsg_plural = Module._errmsg_plural = wasmExports.errmsg_plural)(e, t3, r, a3), _ReadNextMultiXactId = Module._ReadNextMultiXactId = () => (_ReadNextMultiXactId = Module._ReadNextMultiXactId = wasmExports.ReadNextMultiXactId)(), _ReadMultiXactIdRange = Module._ReadMultiXactIdRange = (e, t3) => (_ReadMultiXactIdRange = Module._ReadMultiXactIdRange = wasmExports.ReadMultiXactIdRange)(e, t3), _MultiXactIdPrecedesOrEquals = Module._MultiXactIdPrecedesOrEquals = (e, t3) => (_MultiXactIdPrecedesOrEquals = Module._MultiXactIdPrecedesOrEquals = wasmExports.MultiXactIdPrecedesOrEquals)(e, t3), _init_MultiFuncCall = Module._init_MultiFuncCall = (e) => (_init_MultiFuncCall = Module._init_MultiFuncCall = wasmExports.init_MultiFuncCall)(e), _TupleDescGetAttInMetadata = Module._TupleDescGetAttInMetadata = (e) => (_TupleDescGetAttInMetadata = Module._TupleDescGetAttInMetadata = wasmExports.TupleDescGetAttInMetadata)(e), _per_MultiFuncCall = Module._per_MultiFuncCall = (e) => (_per_MultiFuncCall = Module._per_MultiFuncCall = wasmExports.per_MultiFuncCall)(e), _BuildTupleFromCStrings = Module._BuildTupleFromCStrings = (e, t3) => (_BuildTupleFromCStrings = Module._BuildTupleFromCStrings = wasmExports.BuildTupleFromCStrings)(e, t3), _end_MultiFuncCall = Module._end_MultiFuncCall = (e, t3) => (_end_MultiFuncCall = Module._end_MultiFuncCall = wasmExports.end_MultiFuncCall)(e, t3), _GetCurrentSubTransactionId = Module._GetCurrentSubTransactionId = () => (_GetCurrentSubTransactionId = Module._GetCurrentSubTransactionId = wasmExports.GetCurrentSubTransactionId)(), _WaitForBackgroundWorkerShutdown = Module._WaitForBackgroundWorkerShutdown = (e) => (_WaitForBackgroundWorkerShutdown = Module._WaitForBackgroundWorkerShutdown = wasmExports.WaitForBackgroundWorkerShutdown)(e), _RegisterDynamicBackgroundWorker = Module._RegisterDynamicBackgroundWorker = (e, t3) => (_RegisterDynamicBackgroundWorker = Module._RegisterDynamicBackgroundWorker = wasmExports.RegisterDynamicBackgroundWorker)(e, t3), _appendBinaryStringInfo = Module._appendBinaryStringInfo = (e, t3, r) => (_appendBinaryStringInfo = Module._appendBinaryStringInfo = wasmExports.appendBinaryStringInfo)(e, t3, r), _pq_getmsgbyte = Module._pq_getmsgbyte = (e) => (_pq_getmsgbyte = Module._pq_getmsgbyte = wasmExports.pq_getmsgbyte)(e), _pq_getmsgint = Module._pq_getmsgint = (e, t3) => (_pq_getmsgint = Module._pq_getmsgint = wasmExports.pq_getmsgint)(e, t3), _pq_getmsgint64 = Module._pq_getmsgint64 = (e) => (_pq_getmsgint64 = Module._pq_getmsgint64 = wasmExports.pq_getmsgint64)(e), _die = Module._die = (e) => (_die = Module._die = wasmExports.die)(e), _pqsignal_be = Module._pqsignal_be = (e, t3) => (_pqsignal_be = Module._pqsignal_be = wasmExports.pqsignal_be)(e, t3), _BackgroundWorkerUnblockSignals = Module._BackgroundWorkerUnblockSignals = () => (_BackgroundWorkerUnblockSignals = Module._BackgroundWorkerUnblockSignals = wasmExports.BackgroundWorkerUnblockSignals)(), _BackgroundWorkerInitializeConnectionByOid = Module._BackgroundWorkerInitializeConnectionByOid = (e, t3, r) => (_BackgroundWorkerInitializeConnectionByOid = Module._BackgroundWorkerInitializeConnectionByOid = wasmExports.BackgroundWorkerInitializeConnectionByOid)(e, t3, r), _GetDatabaseEncoding = Module._GetDatabaseEncoding = () => (_GetDatabaseEncoding = Module._GetDatabaseEncoding = wasmExports.GetDatabaseEncoding)(), _StartTransactionCommand = Module._StartTransactionCommand = () => (_StartTransactionCommand = Module._StartTransactionCommand = wasmExports.StartTransactionCommand)(), _CommitTransactionCommand = Module._CommitTransactionCommand = () => (_CommitTransactionCommand = Module._CommitTransactionCommand = wasmExports.CommitTransactionCommand)(), _PushActiveSnapshot = Module._PushActiveSnapshot = (e) => (_PushActiveSnapshot = Module._PushActiveSnapshot = wasmExports.PushActiveSnapshot)(e), _PopActiveSnapshot = Module._PopActiveSnapshot = () => (_PopActiveSnapshot = Module._PopActiveSnapshot = wasmExports.PopActiveSnapshot)(), _RmgrNotFound = Module._RmgrNotFound = (e) => (_RmgrNotFound = Module._RmgrNotFound = wasmExports.RmgrNotFound)(e), _InitMaterializedSRF = Module._InitMaterializedSRF = (e, t3) => (_InitMaterializedSRF = Module._InitMaterializedSRF = wasmExports.InitMaterializedSRF)(e, t3), _tuplestore_putvalues = Module._tuplestore_putvalues = (e, t3, r, a3) => (_tuplestore_putvalues = Module._tuplestore_putvalues = wasmExports.tuplestore_putvalues)(e, t3, r, a3), _pread = Module._pread = (e, t3, r, a3) => (_pread = Module._pread = wasmExports.pread)(e, t3, r, a3), _strspn = Module._strspn = (e, t3) => (_strspn = Module._strspn = wasmExports.strspn)(e, t3), _strtoll = Module._strtoll = (e, t3, r) => (_strtoll = Module._strtoll = wasmExports.strtoll)(e, t3, r), _AllocateFile = Module._AllocateFile = (e, t3) => (_AllocateFile = Module._AllocateFile = wasmExports.AllocateFile)(e, t3), _ferror = Module._ferror = (e) => (_ferror = Module._ferror = wasmExports.ferror)(e), _FreeFile = Module._FreeFile = (e) => (_FreeFile = Module._FreeFile = wasmExports.FreeFile)(e), _getpid = Module._getpid = () => (_getpid = Module._getpid = wasmExports.getpid)(), _read = Module._read = (e, t3, r) => (_read = Module._read = wasmExports.read)(e, t3, r), _write = Module._write = (e, t3, r) => (_write = Module._write = wasmExports.write)(e, t3, r), _durable_rename = Module._durable_rename = (e, t3, r) => (_durable_rename = Module._durable_rename = wasmExports.durable_rename)(e, t3, r), _BlessTupleDesc = Module._BlessTupleDesc = (e) => (_BlessTupleDesc = Module._BlessTupleDesc = wasmExports.BlessTupleDesc)(e), _fstat = Module._fstat = (e, t3) => (_fstat = Module._fstat = wasmExports.fstat)(e, t3), _superuser_arg = Module._superuser_arg = (e) => (_superuser_arg = Module._superuser_arg = wasmExports.superuser_arg)(e), _wal_segment_close = Module._wal_segment_close = (e) => (_wal_segment_close = Module._wal_segment_close = wasmExports.wal_segment_close)(e), _wal_segment_open = Module._wal_segment_open = (e, t3, r) => (_wal_segment_open = Module._wal_segment_open = wasmExports.wal_segment_open)(e, t3, r), _XLogReaderAllocate = Module._XLogReaderAllocate = (e, t3, r, a3) => (_XLogReaderAllocate = Module._XLogReaderAllocate = wasmExports.XLogReaderAllocate)(e, t3, r, a3), _XLogReadRecord = Module._XLogReadRecord = (e, t3) => (_XLogReadRecord = Module._XLogReadRecord = wasmExports.XLogReadRecord)(e, t3), _XLogReaderFree = Module._XLogReaderFree = (e) => (_XLogReaderFree = Module._XLogReaderFree = wasmExports.XLogReaderFree)(e), _strtoull = Module._strtoull = (e, t3, r) => (_strtoull = Module._strtoull = wasmExports.strtoull)(e, t3, r), _access = Module._access = (e, t3) => (_access = Module._access = wasmExports.access)(e, t3), _IsAbortedTransactionBlockState = Module._IsAbortedTransactionBlockState = () => (_IsAbortedTransactionBlockState = Module._IsAbortedTransactionBlockState = wasmExports.IsAbortedTransactionBlockState)(), _GetTopFullTransactionId = Module._GetTopFullTransactionId = () => (_GetTopFullTransactionId = Module._GetTopFullTransactionId = wasmExports.GetTopFullTransactionId)(), _GetCurrentTransactionNestLevel = Module._GetCurrentTransactionNestLevel = () => (_GetCurrentTransactionNestLevel = Module._GetCurrentTransactionNestLevel = wasmExports.GetCurrentTransactionNestLevel)(), _ResourceOwnerCreate = Module._ResourceOwnerCreate = (e, t3) => (_ResourceOwnerCreate = Module._ResourceOwnerCreate = wasmExports.ResourceOwnerCreate)(e, t3), _AbortCurrentTransaction = Module._AbortCurrentTransaction = () => (_AbortCurrentTransaction = Module._AbortCurrentTransaction = wasmExports.AbortCurrentTransaction)(), _IsTransactionBlock = Module._IsTransactionBlock = () => (_IsTransactionBlock = Module._IsTransactionBlock = wasmExports.IsTransactionBlock)(), _RegisterXactCallback = Module._RegisterXactCallback = (e, t3) => (_RegisterXactCallback = Module._RegisterXactCallback = wasmExports.RegisterXactCallback)(e, t3), _UnregisterXactCallback = Module._UnregisterXactCallback = (e, t3) => (_UnregisterXactCallback = Module._UnregisterXactCallback = wasmExports.UnregisterXactCallback)(e, t3), _RegisterSubXactCallback = Module._RegisterSubXactCallback = (e, t3) => (_RegisterSubXactCallback = Module._RegisterSubXactCallback = wasmExports.RegisterSubXactCallback)(e, t3), _BeginInternalSubTransaction = Module._BeginInternalSubTransaction = (e) => (_BeginInternalSubTransaction = Module._BeginInternalSubTransaction = wasmExports.BeginInternalSubTransaction)(e), _ReleaseCurrentSubTransaction = Module._ReleaseCurrentSubTransaction = () => (_ReleaseCurrentSubTransaction = Module._ReleaseCurrentSubTransaction = wasmExports.ReleaseCurrentSubTransaction)(), _ResourceOwnerDelete = Module._ResourceOwnerDelete = (e) => (_ResourceOwnerDelete = Module._ResourceOwnerDelete = wasmExports.ResourceOwnerDelete)(e), _RollbackAndReleaseCurrentSubTransaction = Module._RollbackAndReleaseCurrentSubTransaction = () => (_RollbackAndReleaseCurrentSubTransaction = Module._RollbackAndReleaseCurrentSubTransaction = wasmExports.RollbackAndReleaseCurrentSubTransaction)(), _pg_usleep = Module._pg_usleep = (e) => (_pg_usleep = Module._pg_usleep = wasmExports.pg_usleep)(e), _close = Module._close = (e) => (_close = Module._close = wasmExports.close)(e), _ReleaseExternalFD = Module._ReleaseExternalFD = () => (_ReleaseExternalFD = Module._ReleaseExternalFD = wasmExports.ReleaseExternalFD)(), _GetDefaultCharSignedness = Module._GetDefaultCharSignedness = () => (_GetDefaultCharSignedness = Module._GetDefaultCharSignedness = wasmExports.GetDefaultCharSignedness)(), _SplitIdentifierString = Module._SplitIdentifierString = (e, t3, r) => (_SplitIdentifierString = Module._SplitIdentifierString = wasmExports.SplitIdentifierString)(e, t3, r), _guc_malloc = Module._guc_malloc = (e, t3) => (_guc_malloc = Module._guc_malloc = wasmExports.guc_malloc)(e, t3), _find_option = Module._find_option = (e, t3, r, a3) => (_find_option = Module._find_option = wasmExports.find_option)(e, t3, r, a3), _gettimeofday = Module._gettimeofday = (e, t3) => (_gettimeofday = Module._gettimeofday = wasmExports.gettimeofday)(e, t3), _pg_strong_random = Module._pg_strong_random = (e, t3) => (_pg_strong_random = Module._pg_strong_random = wasmExports.pg_strong_random)(e, t3), _stat = Module._stat = (e, t3) => (_stat = Module._stat = wasmExports.stat)(e, t3), _GetFlushRecPtr = Module._GetFlushRecPtr = (e) => (_GetFlushRecPtr = Module._GetFlushRecPtr = wasmExports.GetFlushRecPtr)(e), _GetXLogReplayRecPtr = Module._GetXLogReplayRecPtr = (e) => (_GetXLogReplayRecPtr = Module._GetXLogReplayRecPtr = wasmExports.GetXLogReplayRecPtr)(e), _TimestampDifferenceMilliseconds = Module._TimestampDifferenceMilliseconds = (e, t3) => (_TimestampDifferenceMilliseconds = Module._TimestampDifferenceMilliseconds = wasmExports.TimestampDifferenceMilliseconds)(e, t3), _strtoul = Module._strtoul = (e, t3, r) => (_strtoul = Module._strtoul = wasmExports.strtoul)(e, t3, r), _readlink = Module._readlink = (e, t3, r) => (_readlink = Module._readlink = wasmExports.readlink)(e, t3, r), _pg_fprintf = Module._pg_fprintf = (e, t3, r) => (_pg_fprintf = Module._pg_fprintf = wasmExports.pg_fprintf)(e, t3, r), _fflush = Module._fflush = (e) => (_fflush = Module._fflush = wasmExports.fflush)(e), _pgl_system = Module._pgl_system = (e) => (_pgl_system = Module._pgl_system = wasmExports.pgl_system)(e), _wait_result_to_str = Module._wait_result_to_str = (e) => (_wait_result_to_str = Module._wait_result_to_str = wasmExports.wait_result_to_str)(e), _replace_percent_placeholders = Module._replace_percent_placeholders = (e, t3, r, a3) => (_replace_percent_placeholders = Module._replace_percent_placeholders = wasmExports.replace_percent_placeholders)(e, t3, r, a3), _makeStringInfo = Module._makeStringInfo = () => (_makeStringInfo = Module._makeStringInfo = wasmExports.makeStringInfo)(), _pg_toupper = Module._pg_toupper = (e) => (_pg_toupper = Module._pg_toupper = wasmExports.pg_toupper)(e), _numeric_in = Module._numeric_in = (e) => (_numeric_in = Module._numeric_in = wasmExports.numeric_in)(e), _DirectFunctionCall3Coll = Module._DirectFunctionCall3Coll = (e, t3, r, a3, o5) => (_DirectFunctionCall3Coll = Module._DirectFunctionCall3Coll = wasmExports.DirectFunctionCall3Coll)(e, t3, r, a3, o5), _palloc_extended = Module._palloc_extended = (e, t3) => (_palloc_extended = Module._palloc_extended = wasmExports.palloc_extended)(e, t3), _pg_vsnprintf = Module._pg_vsnprintf = (e, t3, r, a3) => (_pg_vsnprintf = Module._pg_vsnprintf = wasmExports.pg_vsnprintf)(e, t3, r, a3), _XLogFindNextRecord = Module._XLogFindNextRecord = (e, t3) => (_XLogFindNextRecord = Module._XLogFindNextRecord = wasmExports.XLogFindNextRecord)(e, t3), _RestoreBlockImage = Module._RestoreBlockImage = (e, t3, r) => (_RestoreBlockImage = Module._RestoreBlockImage = wasmExports.RestoreBlockImage)(e, t3, r), _timestamptz_in = Module._timestamptz_in = (e) => (_timestamptz_in = Module._timestamptz_in = wasmExports.timestamptz_in)(e), _fscanf = Module._fscanf = (e, t3, r) => (_fscanf = Module._fscanf = wasmExports.fscanf)(e, t3, r), _symlink = Module._symlink = (e, t3) => (_symlink = Module._symlink = wasmExports.symlink)(e, t3), _ConditionVariableTimedSleep = Module._ConditionVariableTimedSleep = (e, t3, r) => (_ConditionVariableTimedSleep = Module._ConditionVariableTimedSleep = wasmExports.ConditionVariableTimedSleep)(e, t3, r), _ParseDateTime = Module._ParseDateTime = (e, t3, r, a3, o5, _4, s5) => (_ParseDateTime = Module._ParseDateTime = wasmExports.ParseDateTime)(e, t3, r, a3, o5, _4, s5), _DecodeDateTime = Module._DecodeDateTime = (e, t3, r, a3, o5, _4, s5, n3) => (_DecodeDateTime = Module._DecodeDateTime = wasmExports.DecodeDateTime)(e, t3, r, a3, o5, _4, s5, n3), _tm2timestamp = Module._tm2timestamp = (e, t3, r, a3) => (_tm2timestamp = Module._tm2timestamp = wasmExports.tm2timestamp)(e, t3, r, a3), _XLogRecStoreStats = Module._XLogRecStoreStats = (e, t3) => (_XLogRecStoreStats = Module._XLogRecStoreStats = wasmExports.XLogRecStoreStats)(e, t3), _hash_get_num_entries = Module._hash_get_num_entries = (e) => (_hash_get_num_entries = Module._hash_get_num_entries = wasmExports.hash_get_num_entries)(e), _read_local_xlog_page_no_wait = Module._read_local_xlog_page_no_wait = (e, t3, r, a3, o5) => (_read_local_xlog_page_no_wait = Module._read_local_xlog_page_no_wait = wasmExports.read_local_xlog_page_no_wait)(e, t3, r, a3, o5), _escape_json_with_len = Module._escape_json_with_len = (e, t3, r) => (_escape_json_with_len = Module._escape_json_with_len = wasmExports.escape_json_with_len)(e, t3, r), _BufFileSeek = Module._BufFileSeek = (e, t3, r, a3) => (_BufFileSeek = Module._BufFileSeek = wasmExports.BufFileSeek)(e, t3, r, a3), _lstat = Module._lstat = (e, t3) => (_lstat = Module._lstat = wasmExports.lstat)(e, t3), _destroyStringInfo = Module._destroyStringInfo = (e) => (_destroyStringInfo = Module._destroyStringInfo = wasmExports.destroyStringInfo)(e), _list_sort = Module._list_sort = (e, t3) => (_list_sort = Module._list_sort = wasmExports.list_sort)(e, t3), _pgl_geteuid = Module._pgl_geteuid = () => (_pgl_geteuid = Module._pgl_geteuid = wasmExports.pgl_geteuid)(), _getegid = Module._getegid = () => (_getegid = Module._getegid = wasmExports.getegid)(), _pg_checksum_page = Module._pg_checksum_page = (e, t3) => (_pg_checksum_page = Module._pg_checksum_page = wasmExports.pg_checksum_page)(e, t3), _CreateDestReceiver = Module._CreateDestReceiver = (e) => (_CreateDestReceiver = Module._CreateDestReceiver = wasmExports.CreateDestReceiver)(e), _bbsink_forward_end_archive = Module._bbsink_forward_end_archive = (e) => (_bbsink_forward_end_archive = Module._bbsink_forward_end_archive = wasmExports.bbsink_forward_end_archive)(e), _bbsink_forward_begin_manifest = Module._bbsink_forward_begin_manifest = (e) => (_bbsink_forward_begin_manifest = Module._bbsink_forward_begin_manifest = wasmExports.bbsink_forward_begin_manifest)(e), _bbsink_forward_end_manifest = Module._bbsink_forward_end_manifest = (e) => (_bbsink_forward_end_manifest = Module._bbsink_forward_end_manifest = wasmExports.bbsink_forward_end_manifest)(e), _bbsink_forward_end_backup = Module._bbsink_forward_end_backup = (e, t3, r) => (_bbsink_forward_end_backup = Module._bbsink_forward_end_backup = wasmExports.bbsink_forward_end_backup)(e, t3, r), _bbsink_forward_cleanup = Module._bbsink_forward_cleanup = (e) => (_bbsink_forward_cleanup = Module._bbsink_forward_cleanup = wasmExports.bbsink_forward_cleanup)(e), _MemoryContextAllocExtended = Module._MemoryContextAllocExtended = (e, t3, r) => (_MemoryContextAllocExtended = Module._MemoryContextAllocExtended = wasmExports.MemoryContextAllocExtended)(e, t3, r), _appendStringInfoVA = Module._appendStringInfoVA = (e, t3, r) => (_appendStringInfoVA = Module._appendStringInfoVA = wasmExports.appendStringInfoVA)(e, t3, r), _list_concat = Module._list_concat = (e, t3) => (_list_concat = Module._list_concat = wasmExports.list_concat)(e, t3), _strrchr = Module._strrchr = (e, t3) => (_strrchr = Module._strrchr = wasmExports.strrchr)(e, t3), _bbsink_forward_begin_backup = Module._bbsink_forward_begin_backup = (e) => (_bbsink_forward_begin_backup = Module._bbsink_forward_begin_backup = wasmExports.bbsink_forward_begin_backup)(e), _bbsink_forward_archive_contents = Module._bbsink_forward_archive_contents = (e, t3) => (_bbsink_forward_archive_contents = Module._bbsink_forward_archive_contents = wasmExports.bbsink_forward_archive_contents)(e, t3), _bbsink_forward_begin_archive = Module._bbsink_forward_begin_archive = (e, t3) => (_bbsink_forward_begin_archive = Module._bbsink_forward_begin_archive = wasmExports.bbsink_forward_begin_archive)(e, t3), _bbsink_forward_manifest_contents = Module._bbsink_forward_manifest_contents = (e, t3) => (_bbsink_forward_manifest_contents = Module._bbsink_forward_manifest_contents = wasmExports.bbsink_forward_manifest_contents)(e, t3), _has_privs_of_role = Module._has_privs_of_role = (e, t3) => (_has_privs_of_role = Module._has_privs_of_role = wasmExports.has_privs_of_role)(e, t3), _BaseBackupAddTarget = Module._BaseBackupAddTarget = (e, t3, r) => (_BaseBackupAddTarget = Module._BaseBackupAddTarget = wasmExports.BaseBackupAddTarget)(e, t3, r), _list_copy = Module._list_copy = (e) => (_list_copy = Module._list_copy = wasmExports.list_copy)(e), _tuplestore_puttuple = Module._tuplestore_puttuple = (e, t3) => (_tuplestore_puttuple = Module._tuplestore_puttuple = wasmExports.tuplestore_puttuple)(e, t3), _isatty = Module._isatty = (e) => (_isatty = Module._isatty = wasmExports.isatty)(e), _makeRangeVar = Module._makeRangeVar = (e, t3, r) => (_makeRangeVar = Module._makeRangeVar = wasmExports.makeRangeVar)(e, t3, r), _DefineIndex = Module._DefineIndex = (e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4) => (_DefineIndex = Module._DefineIndex = wasmExports.DefineIndex)(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4), _getc = Module._getc = (e) => (_getc = Module._getc = wasmExports.getc)(e), _fread = Module._fread = (e, t3, r, a3) => (_fread = Module._fread = wasmExports.fread)(e, t3, r, a3), _clearerr = Module._clearerr = (e) => (_clearerr = Module._clearerr = wasmExports.clearerr)(e), _copyObjectImpl = Module._copyObjectImpl = (e) => (_copyObjectImpl = Module._copyObjectImpl = wasmExports.copyObjectImpl)(e), _get_object_address = Module._get_object_address = (e, t3, r, a3, o5, _4) => (_get_object_address = Module._get_object_address = wasmExports.get_object_address)(e, t3, r, a3, o5, _4), _lappend_oid = Module._lappend_oid = (e, t3) => (_lappend_oid = Module._lappend_oid = wasmExports.lappend_oid)(e, t3), _makeTypeNameFromNameList = Module._makeTypeNameFromNameList = (e) => (_makeTypeNameFromNameList = Module._makeTypeNameFromNameList = wasmExports.makeTypeNameFromNameList)(e), _SearchSysCache2 = Module._SearchSysCache2 = (e, t3, r) => (_SearchSysCache2 = Module._SearchSysCache2 = wasmExports.SearchSysCache2)(e, t3, r), _SysCacheGetAttr = Module._SysCacheGetAttr = (e, t3, r, a3) => (_SysCacheGetAttr = Module._SysCacheGetAttr = wasmExports.SysCacheGetAttr)(e, t3, r, a3), _CatalogTupleUpdate = Module._CatalogTupleUpdate = (e, t3, r) => (_CatalogTupleUpdate = Module._CatalogTupleUpdate = wasmExports.CatalogTupleUpdate)(e, t3, r), _get_attnum = Module._get_attnum = (e, t3) => (_get_attnum = Module._get_attnum = wasmExports.get_attnum)(e, t3), _get_rel_name = Module._get_rel_name = (e) => (_get_rel_name = Module._get_rel_name = wasmExports.get_rel_name)(e), _CatalogTupleDelete = Module._CatalogTupleDelete = (e, t3) => (_CatalogTupleDelete = Module._CatalogTupleDelete = wasmExports.CatalogTupleDelete)(e, t3), _get_namespace_oid = Module._get_namespace_oid = (e, t3) => (_get_namespace_oid = Module._get_namespace_oid = wasmExports.get_namespace_oid)(e, t3), _SearchSysCache3 = Module._SearchSysCache3 = (e, t3, r, a3) => (_SearchSysCache3 = Module._SearchSysCache3 = wasmExports.SearchSysCache3)(e, t3, r, a3), _performDeletion = Module._performDeletion = (e, t3, r) => (_performDeletion = Module._performDeletion = wasmExports.performDeletion)(e, t3, r), _CatalogTupleInsert = Module._CatalogTupleInsert = (e, t3) => (_CatalogTupleInsert = Module._CatalogTupleInsert = wasmExports.CatalogTupleInsert)(e, t3), _recordDependencyOn = Module._recordDependencyOn = (e, t3, r) => (_recordDependencyOn = Module._recordDependencyOn = wasmExports.recordDependencyOn)(e, t3, r), _get_element_type = Module._get_element_type = (e) => (_get_element_type = Module._get_element_type = wasmExports.get_element_type)(e), _object_aclcheck = Module._object_aclcheck = (e, t3, r, a3) => (_object_aclcheck = Module._object_aclcheck = wasmExports.object_aclcheck)(e, t3, r, a3), _isTempNamespace = Module._isTempNamespace = (e) => (_isTempNamespace = Module._isTempNamespace = wasmExports.isTempNamespace)(e), _superuser = Module._superuser = () => (_superuser = Module._superuser = wasmExports.superuser)(), _SearchSysCacheAttName = Module._SearchSysCacheAttName = (e, t3) => (_SearchSysCacheAttName = Module._SearchSysCacheAttName = wasmExports.SearchSysCacheAttName)(e, t3), _new_object_addresses = Module._new_object_addresses = () => (_new_object_addresses = Module._new_object_addresses = wasmExports.new_object_addresses)(), _free_object_addresses = Module._free_object_addresses = (e) => (_free_object_addresses = Module._free_object_addresses = wasmExports.free_object_addresses)(e), _performMultipleDeletions = Module._performMultipleDeletions = (e, t3, r) => (_performMultipleDeletions = Module._performMultipleDeletions = wasmExports.performMultipleDeletions)(e, t3, r), _recordDependencyOnExpr = Module._recordDependencyOnExpr = (e, t3, r, a3) => (_recordDependencyOnExpr = Module._recordDependencyOnExpr = wasmExports.recordDependencyOnExpr)(e, t3, r, a3), _query_tree_walker_impl = Module._query_tree_walker_impl = (e, t3, r, a3) => (_query_tree_walker_impl = Module._query_tree_walker_impl = wasmExports.query_tree_walker_impl)(e, t3, r, a3), _expression_tree_walker_impl = Module._expression_tree_walker_impl = (e, t3, r) => (_expression_tree_walker_impl = Module._expression_tree_walker_impl = wasmExports.expression_tree_walker_impl)(e, t3, r), _add_exact_object_address = Module._add_exact_object_address = (e, t3) => (_add_exact_object_address = Module._add_exact_object_address = wasmExports.add_exact_object_address)(e, t3), _get_rel_relkind = Module._get_rel_relkind = (e) => (_get_rel_relkind = Module._get_rel_relkind = wasmExports.get_rel_relkind)(e), _get_typtype = Module._get_typtype = (e) => (_get_typtype = Module._get_typtype = wasmExports.get_typtype)(e), _list_delete_last = Module._list_delete_last = (e) => (_list_delete_last = Module._list_delete_last = wasmExports.list_delete_last)(e), _type_is_collatable = Module._type_is_collatable = (e) => (_type_is_collatable = Module._type_is_collatable = wasmExports.type_is_collatable)(e), _CatalogOpenIndexes = Module._CatalogOpenIndexes = (e) => (_CatalogOpenIndexes = Module._CatalogOpenIndexes = wasmExports.CatalogOpenIndexes)(e), _CatalogCloseIndexes = Module._CatalogCloseIndexes = (e) => (_CatalogCloseIndexes = Module._CatalogCloseIndexes = wasmExports.CatalogCloseIndexes)(e), _get_relname_relid = Module._get_relname_relid = (e, t3) => (_get_relname_relid = Module._get_relname_relid = wasmExports.get_relname_relid)(e, t3), _GetSysCacheOid = Module._GetSysCacheOid = (e, t3, r, a3, o5, _4) => (_GetSysCacheOid = Module._GetSysCacheOid = wasmExports.GetSysCacheOid)(e, t3, r, a3, o5, _4), _CheckTableNotInUse = Module._CheckTableNotInUse = (e, t3) => (_CheckTableNotInUse = Module._CheckTableNotInUse = wasmExports.CheckTableNotInUse)(e, t3), _construct_array = Module._construct_array = (e, t3, r, a3, o5, _4) => (_construct_array = Module._construct_array = wasmExports.construct_array)(e, t3, r, a3, o5, _4), _make_parsestate = Module._make_parsestate = (e) => (_make_parsestate = Module._make_parsestate = wasmExports.make_parsestate)(e), _addRangeTableEntryForRelation = Module._addRangeTableEntryForRelation = (e, t3, r, a3, o5, _4) => (_addRangeTableEntryForRelation = Module._addRangeTableEntryForRelation = wasmExports.addRangeTableEntryForRelation)(e, t3, r, a3, o5, _4), _addNSItemToQuery = Module._addNSItemToQuery = (e, t3, r, a3, o5) => (_addNSItemToQuery = Module._addNSItemToQuery = wasmExports.addNSItemToQuery)(e, t3, r, a3, o5), _transformExpr = Module._transformExpr = (e, t3, r) => (_transformExpr = Module._transformExpr = wasmExports.transformExpr)(e, t3, r), _coerce_to_boolean = Module._coerce_to_boolean = (e, t3, r) => (_coerce_to_boolean = Module._coerce_to_boolean = wasmExports.coerce_to_boolean)(e, t3, r), _assign_expr_collations = Module._assign_expr_collations = (e, t3) => (_assign_expr_collations = Module._assign_expr_collations = wasmExports.assign_expr_collations)(e, t3), _equal = Module._equal = (e, t3) => (_equal = Module._equal = wasmExports.equal)(e, t3), _pull_var_clause = Module._pull_var_clause = (e, t3) => (_pull_var_clause = Module._pull_var_clause = wasmExports.pull_var_clause)(e, t3), _get_attname = Module._get_attname = (e, t3, r) => (_get_attname = Module._get_attname = wasmExports.get_attname)(e, t3, r), _coerce_to_target_type = Module._coerce_to_target_type = (e, t3, r, a3, o5, _4, s5, n3) => (_coerce_to_target_type = Module._coerce_to_target_type = wasmExports.coerce_to_target_type)(e, t3, r, a3, o5, _4, s5, n3), _nodeToString = Module._nodeToString = (e) => (_nodeToString = Module._nodeToString = wasmExports.nodeToString)(e), _lappend_int = Module._lappend_int = (e, t3) => (_lappend_int = Module._lappend_int = wasmExports.lappend_int)(e, t3), _list_delete_nth_cell = Module._list_delete_nth_cell = (e, t3) => (_list_delete_nth_cell = Module._list_delete_nth_cell = wasmExports.list_delete_nth_cell)(e, t3), _CatalogTupleInsertWithInfo = Module._CatalogTupleInsertWithInfo = (e, t3, r) => (_CatalogTupleInsertWithInfo = Module._CatalogTupleInsertWithInfo = wasmExports.CatalogTupleInsertWithInfo)(e, t3, r), _buildoidvector = Module._buildoidvector = (e, t3) => (_buildoidvector = Module._buildoidvector = wasmExports.buildoidvector)(e, t3), _parser_errposition = Module._parser_errposition = (e, t3) => (_parser_errposition = Module._parser_errposition = wasmExports.parser_errposition)(e, t3), _exprLocation = Module._exprLocation = (e) => (_exprLocation = Module._exprLocation = wasmExports.exprLocation)(e), _exprTypmod = Module._exprTypmod = (e) => (_exprTypmod = Module._exprTypmod = wasmExports.exprTypmod)(e), _get_base_element_type = Module._get_base_element_type = (e) => (_get_base_element_type = Module._get_base_element_type = wasmExports.get_base_element_type)(e), _SystemFuncName = Module._SystemFuncName = (e) => (_SystemFuncName = Module._SystemFuncName = wasmExports.SystemFuncName)(e), _CreateTrigger = Module._CreateTrigger = (e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4) => (_CreateTrigger = Module._CreateTrigger = wasmExports.CreateTrigger)(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4), _plan_create_index_workers = Module._plan_create_index_workers = (e, t3) => (_plan_create_index_workers = Module._plan_create_index_workers = wasmExports.plan_create_index_workers)(e, t3), _tuplesort_begin_datum = Module._tuplesort_begin_datum = (e, t3, r, a3, o5, _4, s5) => (_tuplesort_begin_datum = Module._tuplesort_begin_datum = wasmExports.tuplesort_begin_datum)(e, t3, r, a3, o5, _4, s5), _tuplesort_putdatum = Module._tuplesort_putdatum = (e, t3, r) => (_tuplesort_putdatum = Module._tuplesort_putdatum = wasmExports.tuplesort_putdatum)(e, t3, r), _get_rel_namespace = Module._get_rel_namespace = (e) => (_get_rel_namespace = Module._get_rel_namespace = wasmExports.get_rel_namespace)(e), _ExecOpenIndices = Module._ExecOpenIndices = (e, t3) => (_ExecOpenIndices = Module._ExecOpenIndices = wasmExports.ExecOpenIndices)(e, t3), _ExecCloseIndices = Module._ExecCloseIndices = (e) => (_ExecCloseIndices = Module._ExecCloseIndices = wasmExports.ExecCloseIndices)(e), _ConditionalLockRelationOid = Module._ConditionalLockRelationOid = (e, t3) => (_ConditionalLockRelationOid = Module._ConditionalLockRelationOid = wasmExports.ConditionalLockRelationOid)(e, t3), _RelnameGetRelid = Module._RelnameGetRelid = (e) => (_RelnameGetRelid = Module._RelnameGetRelid = wasmExports.RelnameGetRelid)(e), _get_relkind_objtype = Module._get_relkind_objtype = (e) => (_get_relkind_objtype = Module._get_relkind_objtype = wasmExports.get_relkind_objtype)(e), _RelationIsVisible = Module._RelationIsVisible = (e) => (_RelationIsVisible = Module._RelationIsVisible = wasmExports.RelationIsVisible)(e), _TypenameGetTypid = Module._TypenameGetTypid = (e) => (_TypenameGetTypid = Module._TypenameGetTypid = wasmExports.TypenameGetTypid)(e), _get_func_arg_info = Module._get_func_arg_info = (e, t3, r, a3) => (_get_func_arg_info = Module._get_func_arg_info = wasmExports.get_func_arg_info)(e, t3, r, a3), _NameListToString = Module._NameListToString = (e) => (_NameListToString = Module._NameListToString = wasmExports.NameListToString)(e), _OpernameGetOprid = Module._OpernameGetOprid = (e, t3, r) => (_OpernameGetOprid = Module._OpernameGetOprid = wasmExports.OpernameGetOprid)(e, t3, r), _get_ts_config_oid = Module._get_ts_config_oid = (e, t3) => (_get_ts_config_oid = Module._get_ts_config_oid = wasmExports.get_ts_config_oid)(e, t3), _makeRangeVarFromNameList = Module._makeRangeVarFromNameList = (e) => (_makeRangeVarFromNameList = Module._makeRangeVarFromNameList = wasmExports.makeRangeVarFromNameList)(e), _quote_identifier = Module._quote_identifier = (e) => (_quote_identifier = Module._quote_identifier = wasmExports.quote_identifier)(e), _atoi = Module._atoi = (e) => (_atoi = Module._atoi = wasmExports.atoi)(e), _GetSearchPathMatcher = Module._GetSearchPathMatcher = (e) => (_GetSearchPathMatcher = Module._GetSearchPathMatcher = wasmExports.GetSearchPathMatcher)(e), _SearchPathMatchesCurrentEnvironment = Module._SearchPathMatchesCurrentEnvironment = (e) => (_SearchPathMatchesCurrentEnvironment = Module._SearchPathMatchesCurrentEnvironment = wasmExports.SearchPathMatchesCurrentEnvironment)(e), _get_collation_oid = Module._get_collation_oid = (e, t3) => (_get_collation_oid = Module._get_collation_oid = wasmExports.get_collation_oid)(e, t3), _GetDatabaseEncodingName = Module._GetDatabaseEncodingName = () => (_GetDatabaseEncodingName = Module._GetDatabaseEncodingName = wasmExports.GetDatabaseEncodingName)(), _CacheRegisterSyscacheCallback = Module._CacheRegisterSyscacheCallback = (e, t3, r) => (_CacheRegisterSyscacheCallback = Module._CacheRegisterSyscacheCallback = wasmExports.CacheRegisterSyscacheCallback)(e, t3, r), _fetch_search_path = Module._fetch_search_path = (e) => (_fetch_search_path = Module._fetch_search_path = wasmExports.fetch_search_path)(e), _get_extension_oid = Module._get_extension_oid = (e, t3) => (_get_extension_oid = Module._get_extension_oid = wasmExports.get_extension_oid)(e, t3), _get_role_oid = Module._get_role_oid = (e, t3) => (_get_role_oid = Module._get_role_oid = wasmExports.get_role_oid)(e, t3), _get_am_oid = Module._get_am_oid = (e, t3) => (_get_am_oid = Module._get_am_oid = wasmExports.get_am_oid)(e, t3), _GetForeignServerByName = Module._GetForeignServerByName = (e, t3) => (_GetForeignServerByName = Module._GetForeignServerByName = wasmExports.GetForeignServerByName)(e, t3), _typeStringToTypeName = Module._typeStringToTypeName = (e, t3) => (_typeStringToTypeName = Module._typeStringToTypeName = wasmExports.typeStringToTypeName)(e, t3), _makeFloat = Module._makeFloat = (e) => (_makeFloat = Module._makeFloat = wasmExports.makeFloat)(e), _list_make2_impl = Module._list_make2_impl = (e, t3, r) => (_list_make2_impl = Module._list_make2_impl = wasmExports.list_make2_impl)(e, t3, r), _check_object_ownership = Module._check_object_ownership = (e, t3, r, a3, o5) => (_check_object_ownership = Module._check_object_ownership = wasmExports.check_object_ownership)(e, t3, r, a3, o5), _GetUserNameFromId = Module._GetUserNameFromId = (e, t3) => (_GetUserNameFromId = Module._GetUserNameFromId = wasmExports.GetUserNameFromId)(e, t3), _format_type_extended = Module._format_type_extended = (e, t3, r) => (_format_type_extended = Module._format_type_extended = wasmExports.format_type_extended)(e, t3, r), _quote_qualified_identifier = Module._quote_qualified_identifier = (e, t3) => (_quote_qualified_identifier = Module._quote_qualified_identifier = wasmExports.quote_qualified_identifier)(e, t3), _get_tablespace_name = Module._get_tablespace_name = (e) => (_get_tablespace_name = Module._get_tablespace_name = wasmExports.get_tablespace_name)(e), _GetForeignServerExtended = Module._GetForeignServerExtended = (e, t3) => (_GetForeignServerExtended = Module._GetForeignServerExtended = wasmExports.GetForeignServerExtended)(e, t3), _GetForeignServer = Module._GetForeignServer = (e) => (_GetForeignServer = Module._GetForeignServer = wasmExports.GetForeignServer)(e), _get_extension_name = Module._get_extension_name = (e) => (_get_extension_name = Module._get_extension_name = wasmExports.get_extension_name)(e), _construct_empty_array = Module._construct_empty_array = (e) => (_construct_empty_array = Module._construct_empty_array = wasmExports.construct_empty_array)(e), _format_type_be_qualified = Module._format_type_be_qualified = (e) => (_format_type_be_qualified = Module._format_type_be_qualified = wasmExports.format_type_be_qualified)(e), _get_namespace_name_or_temp = Module._get_namespace_name_or_temp = (e) => (_get_namespace_name_or_temp = Module._get_namespace_name_or_temp = wasmExports.get_namespace_name_or_temp)(e), _list_make3_impl = Module._list_make3_impl = (e, t3, r, a3) => (_list_make3_impl = Module._list_make3_impl = wasmExports.list_make3_impl)(e, t3, r, a3), _construct_md_array = Module._construct_md_array = (e, t3, r, a3, o5, _4, s5, n3, l2) => (_construct_md_array = Module._construct_md_array = wasmExports.construct_md_array)(e, t3, r, a3, o5, _4, s5, n3, l2), _pull_varattnos = Module._pull_varattnos = (e, t3, r) => (_pull_varattnos = Module._pull_varattnos = wasmExports.pull_varattnos)(e, t3, r), _makeBoolExpr = Module._makeBoolExpr = (e, t3, r) => (_makeBoolExpr = Module._makeBoolExpr = wasmExports.makeBoolExpr)(e, t3, r), _eval_const_expressions = Module._eval_const_expressions = (e, t3) => (_eval_const_expressions = Module._eval_const_expressions = wasmExports.eval_const_expressions)(e, t3), _get_func_name = Module._get_func_name = (e) => (_get_func_name = Module._get_func_name = wasmExports.get_func_name)(e), _construct_array_builtin = Module._construct_array_builtin = (e, t3, r) => (_construct_array_builtin = Module._construct_array_builtin = wasmExports.construct_array_builtin)(e, t3, r), _makeObjectName = Module._makeObjectName = (e, t3, r) => (_makeObjectName = Module._makeObjectName = wasmExports.makeObjectName)(e, t3, r), _get_primary_key_attnos = Module._get_primary_key_attnos = (e, t3, r) => (_get_primary_key_attnos = Module._get_primary_key_attnos = wasmExports.get_primary_key_attnos)(e, t3, r), _check_functional_grouping = Module._check_functional_grouping = (e, t3, r, a3, o5) => (_check_functional_grouping = Module._check_functional_grouping = wasmExports.check_functional_grouping)(e, t3, r, a3, o5), _bms_is_subset = Module._bms_is_subset = (e, t3) => (_bms_is_subset = Module._bms_is_subset = wasmExports.bms_is_subset)(e, t3), _getExtensionOfObject = Module._getExtensionOfObject = (e, t3) => (_getExtensionOfObject = Module._getExtensionOfObject = wasmExports.getExtensionOfObject)(e, t3), _find_inheritance_children = Module._find_inheritance_children = (e, t3) => (_find_inheritance_children = Module._find_inheritance_children = wasmExports.find_inheritance_children)(e, t3), _find_all_inheritors = Module._find_all_inheritors = (e, t3, r) => (_find_all_inheritors = Module._find_all_inheritors = wasmExports.find_all_inheritors)(e, t3, r), _has_superclass = Module._has_superclass = (e) => (_has_superclass = Module._has_superclass = wasmExports.has_superclass)(e), _strstr = Module._strstr = (e, t3) => (_strstr = Module._strstr = wasmExports.strstr)(e, t3), _memchr = Module._memchr = (e, t3, r) => (_memchr = Module._memchr = wasmExports.memchr)(e, t3, r), _CheckFunctionValidatorAccess = Module._CheckFunctionValidatorAccess = (e, t3) => (_CheckFunctionValidatorAccess = Module._CheckFunctionValidatorAccess = wasmExports.CheckFunctionValidatorAccess)(e, t3), _AcquireRewriteLocks = Module._AcquireRewriteLocks = (e, t3, r) => (_AcquireRewriteLocks = Module._AcquireRewriteLocks = wasmExports.AcquireRewriteLocks)(e, t3, r), _pg_parse_query = Module._pg_parse_query = (e) => (_pg_parse_query = Module._pg_parse_query = wasmExports.pg_parse_query)(e), _get_func_result_type = Module._get_func_result_type = (e, t3, r) => (_get_func_result_type = Module._get_func_result_type = wasmExports.get_func_result_type)(e, t3, r), _function_parse_error_transpose = Module._function_parse_error_transpose = (e) => (_function_parse_error_transpose = Module._function_parse_error_transpose = wasmExports.function_parse_error_transpose)(e), _geterrposition = Module._geterrposition = () => (_geterrposition = Module._geterrposition = wasmExports.geterrposition)(), _getinternalerrposition = Module._getinternalerrposition = () => (_getinternalerrposition = Module._getinternalerrposition = wasmExports.getinternalerrposition)(), _pg_mblen_cstr = Module._pg_mblen_cstr = (e) => (_pg_mblen_cstr = Module._pg_mblen_cstr = wasmExports.pg_mblen_cstr)(e), _pg_mbstrlen_with_len = Module._pg_mbstrlen_with_len = (e, t3) => (_pg_mbstrlen_with_len = Module._pg_mbstrlen_with_len = wasmExports.pg_mbstrlen_with_len)(e, t3), _errposition = Module._errposition = (e) => (_errposition = Module._errposition = wasmExports.errposition)(e), _internalerrposition = Module._internalerrposition = (e) => (_internalerrposition = Module._internalerrposition = wasmExports.internalerrposition)(e), _internalerrquery = Module._internalerrquery = (e) => (_internalerrquery = Module._internalerrquery = wasmExports.internalerrquery)(e), _bms_num_members = Module._bms_num_members = (e) => (_bms_num_members = Module._bms_num_members = wasmExports.bms_num_members)(e), _quote_literal_cstr = Module._quote_literal_cstr = (e) => (_quote_literal_cstr = Module._quote_literal_cstr = wasmExports.quote_literal_cstr)(e), _get_array_type = Module._get_array_type = (e) => (_get_array_type = Module._get_array_type = wasmExports.get_array_type)(e), _pnstrdup = Module._pnstrdup = (e, t3) => (_pnstrdup = Module._pnstrdup = wasmExports.pnstrdup)(e, t3), _smgrtruncate = Module._smgrtruncate = (e, t3, r, a3, o5) => (_smgrtruncate = Module._smgrtruncate = wasmExports.smgrtruncate)(e, t3, r, a3, o5), _smgrreadv = Module._smgrreadv = (e, t3, r, a3, o5) => (_smgrreadv = Module._smgrreadv = wasmExports.smgrreadv)(e, t3, r, a3, o5), _NewRelationCreateToastTable = Module._NewRelationCreateToastTable = (e, t3) => (_NewRelationCreateToastTable = Module._NewRelationCreateToastTable = wasmExports.NewRelationCreateToastTable)(e, t3), _transformStmt = Module._transformStmt = (e, t3) => (_transformStmt = Module._transformStmt = wasmExports.transformStmt)(e, t3), _free_parsestate = Module._free_parsestate = (e) => (_free_parsestate = Module._free_parsestate = wasmExports.free_parsestate)(e), _makeFromExpr = Module._makeFromExpr = (e, t3) => (_makeFromExpr = Module._makeFromExpr = wasmExports.makeFromExpr)(e, t3), _assign_query_collations = Module._assign_query_collations = (e, t3) => (_assign_query_collations = Module._assign_query_collations = wasmExports.assign_query_collations)(e, t3), _ParseFuncOrColumn = Module._ParseFuncOrColumn = (e, t3, r, a3, o5, _4, s5) => (_ParseFuncOrColumn = Module._ParseFuncOrColumn = wasmExports.ParseFuncOrColumn)(e, t3, r, a3, o5, _4, s5), _exprCollation = Module._exprCollation = (e) => (_exprCollation = Module._exprCollation = wasmExports.exprCollation)(e), _transformSortClause = Module._transformSortClause = (e, t3, r, a3, o5) => (_transformSortClause = Module._transformSortClause = wasmExports.transformSortClause)(e, t3, r, a3, o5), _transformDistinctClause = Module._transformDistinctClause = (e, t3, r, a3) => (_transformDistinctClause = Module._transformDistinctClause = wasmExports.transformDistinctClause)(e, t3, r, a3), _makeTargetEntry = Module._makeTargetEntry = (e, t3, r, a3) => (_makeTargetEntry = Module._makeTargetEntry = wasmExports.makeTargetEntry)(e, t3, r, a3), _select_common_type = Module._select_common_type = (e, t3, r, a3) => (_select_common_type = Module._select_common_type = wasmExports.select_common_type)(e, t3, r, a3), _coerce_to_common_type = Module._coerce_to_common_type = (e, t3, r, a3) => (_coerce_to_common_type = Module._coerce_to_common_type = wasmExports.coerce_to_common_type)(e, t3, r, a3), _select_common_collation = Module._select_common_collation = (e, t3, r) => (_select_common_collation = Module._select_common_collation = wasmExports.select_common_collation)(e, t3, r), _contain_vars_of_level = Module._contain_vars_of_level = (e, t3) => (_contain_vars_of_level = Module._contain_vars_of_level = wasmExports.contain_vars_of_level)(e, t3), _expandNSItemAttrs = Module._expandNSItemAttrs = (e, t3, r, a3, o5) => (_expandNSItemAttrs = Module._expandNSItemAttrs = wasmExports.expandNSItemAttrs)(e, t3, r, a3, o5), _makeAlias = Module._makeAlias = (e, t3) => (_makeAlias = Module._makeAlias = wasmExports.makeAlias)(e, t3), _addRangeTableEntryForSubquery = Module._addRangeTableEntryForSubquery = (e, t3, r, a3, o5) => (_addRangeTableEntryForSubquery = Module._addRangeTableEntryForSubquery = wasmExports.addRangeTableEntryForSubquery)(e, t3, r, a3, o5), _assign_list_collations = Module._assign_list_collations = (e, t3) => (_assign_list_collations = Module._assign_list_collations = wasmExports.assign_list_collations)(e, t3), _expandNSItemVars = Module._expandNSItemVars = (e, t3, r, a3, o5) => (_expandNSItemVars = Module._expandNSItemVars = wasmExports.expandNSItemVars)(e, t3, r, a3, o5), _markTargetListOrigins = Module._markTargetListOrigins = (e, t3) => (_markTargetListOrigins = Module._markTargetListOrigins = wasmExports.markTargetListOrigins)(e, t3), _addRangeTableEntryForJoin = Module._addRangeTableEntryForJoin = (e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3) => (_addRangeTableEntryForJoin = Module._addRangeTableEntryForJoin = wasmExports.addRangeTableEntryForJoin)(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3), _list_truncate = Module._list_truncate = (e, t3) => (_list_truncate = Module._list_truncate = wasmExports.list_truncate)(e, t3), _makeVar = Module._makeVar = (e, t3, r, a3, o5, _4) => (_makeVar = Module._makeVar = wasmExports.makeVar)(e, t3, r, a3, o5, _4), _makeNullConst = Module._makeNullConst = (e, t3, r) => (_makeNullConst = Module._makeNullConst = wasmExports.makeNullConst)(e, t3, r), _get_sort_group_operators = Module._get_sort_group_operators = (e, t3, r, a3, o5, _4, s5, n3) => (_get_sort_group_operators = Module._get_sort_group_operators = wasmExports.get_sort_group_operators)(e, t3, r, a3, o5, _4, s5, n3), _refnameNamespaceItem = Module._refnameNamespaceItem = (e, t3, r, a3, o5) => (_refnameNamespaceItem = Module._refnameNamespaceItem = wasmExports.refnameNamespaceItem)(e, t3, r, a3, o5), _setup_parser_errposition_callback = Module._setup_parser_errposition_callback = (e, t3, r) => (_setup_parser_errposition_callback = Module._setup_parser_errposition_callback = wasmExports.setup_parser_errposition_callback)(e, t3, r), _cancel_parser_errposition_callback = Module._cancel_parser_errposition_callback = (e) => (_cancel_parser_errposition_callback = Module._cancel_parser_errposition_callback = wasmExports.cancel_parser_errposition_callback)(e), _locate_var_of_level = Module._locate_var_of_level = (e, t3) => (_locate_var_of_level = Module._locate_var_of_level = wasmExports.locate_var_of_level)(e, t3), _makeBoolean = Module._makeBoolean = (e) => (_makeBoolean = Module._makeBoolean = wasmExports.makeBoolean)(e), _makeInteger = Module._makeInteger = (e) => (_makeInteger = Module._makeInteger = wasmExports.makeInteger)(e), _makeSimpleA_Expr = Module._makeSimpleA_Expr = (e, t3, r, a3, o5) => (_makeSimpleA_Expr = Module._makeSimpleA_Expr = wasmExports.makeSimpleA_Expr)(e, t3, r, a3, o5), _makeTypeName = Module._makeTypeName = (e) => (_makeTypeName = Module._makeTypeName = wasmExports.makeTypeName)(e), _SystemTypeName = Module._SystemTypeName = (e) => (_SystemTypeName = Module._SystemTypeName = wasmExports.SystemTypeName)(e), _makeFuncCall = Module._makeFuncCall = (e, t3, r, a3) => (_makeFuncCall = Module._makeFuncCall = wasmExports.makeFuncCall)(e, t3, r, a3), _makeA_Expr = Module._makeA_Expr = (e, t3, r, a3, o5) => (_makeA_Expr = Module._makeA_Expr = wasmExports.makeA_Expr)(e, t3, r, a3, o5), _list_make4_impl = Module._list_make4_impl = (e, t3, r, a3, o5) => (_list_make4_impl = Module._list_make4_impl = wasmExports.list_make4_impl)(e, t3, r, a3, o5), _addTargetToSortList = Module._addTargetToSortList = (e, t3, r, a3, o5) => (_addTargetToSortList = Module._addTargetToSortList = wasmExports.addTargetToSortList)(e, t3, r, a3, o5), _locate_agg_of_level = Module._locate_agg_of_level = (e, t3) => (_locate_agg_of_level = Module._locate_agg_of_level = wasmExports.locate_agg_of_level)(e, t3), _list_intersection_int = Module._list_intersection_int = (e, t3) => (_list_intersection_int = Module._list_intersection_int = wasmExports.list_intersection_int)(e, t3), _get_sortgroupclause_tle = Module._get_sortgroupclause_tle = (e, t3) => (_get_sortgroupclause_tle = Module._get_sortgroupclause_tle = wasmExports.get_sortgroupclause_tle)(e, t3), _flatten_join_alias_vars = Module._flatten_join_alias_vars = (e, t3, r) => (_flatten_join_alias_vars = Module._flatten_join_alias_vars = wasmExports.flatten_join_alias_vars)(e, t3, r), _list_member_int = Module._list_member_int = (e, t3) => (_list_member_int = Module._list_member_int = wasmExports.list_member_int)(e, t3), _list_union_int = Module._list_union_int = (e, t3) => (_list_union_int = Module._list_union_int = wasmExports.list_union_int)(e, t3), _makeFuncExpr = Module._makeFuncExpr = (e, t3, r, a3, o5, _4) => (_makeFuncExpr = Module._makeFuncExpr = wasmExports.makeFuncExpr)(e, t3, r, a3, o5, _4), _get_rte_attribute_name = Module._get_rte_attribute_name = (e, t3) => (_get_rte_attribute_name = Module._get_rte_attribute_name = wasmExports.get_rte_attribute_name)(e, t3), _expression_tree_mutator_impl = Module._expression_tree_mutator_impl = (e, t3, r) => (_expression_tree_mutator_impl = Module._expression_tree_mutator_impl = wasmExports.expression_tree_mutator_impl)(e, t3, r), _checkNameSpaceConflicts = Module._checkNameSpaceConflicts = (e, t3, r) => (_checkNameSpaceConflicts = Module._checkNameSpaceConflicts = wasmExports.checkNameSpaceConflicts)(e, t3, r), _addRangeTableEntryForENR = Module._addRangeTableEntryForENR = (e, t3, r) => (_addRangeTableEntryForENR = Module._addRangeTableEntryForENR = wasmExports.addRangeTableEntryForENR)(e, t3, r), _addRangeTableEntry = Module._addRangeTableEntry = (e, t3, r, a3, o5) => (_addRangeTableEntry = Module._addRangeTableEntry = wasmExports.addRangeTableEntry)(e, t3, r, a3, o5), _FigureColname = Module._FigureColname = (e) => (_FigureColname = Module._FigureColname = wasmExports.FigureColname)(e), _coerce_to_specific_type = Module._coerce_to_specific_type = (e, t3, r, a3) => (_coerce_to_specific_type = Module._coerce_to_specific_type = wasmExports.coerce_to_specific_type)(e, t3, r, a3), _typenameTypeIdAndMod = Module._typenameTypeIdAndMod = (e, t3, r, a3) => (_typenameTypeIdAndMod = Module._typenameTypeIdAndMod = wasmExports.typenameTypeIdAndMod)(e, t3, r, a3), _get_typcollation = Module._get_typcollation = (e) => (_get_typcollation = Module._get_typcollation = wasmExports.get_typcollation)(e), _markNullableIfNeeded = Module._markNullableIfNeeded = (e, t3) => (_markNullableIfNeeded = Module._markNullableIfNeeded = wasmExports.markNullableIfNeeded)(e, t3), _markVarForSelectPriv = Module._markVarForSelectPriv = (e, t3) => (_markVarForSelectPriv = Module._markVarForSelectPriv = wasmExports.markVarForSelectPriv)(e, t3), _coerce_type = Module._coerce_type = (e, t3, r, a3, o5, _4, s5, n3) => (_coerce_type = Module._coerce_type = wasmExports.coerce_type)(e, t3, r, a3, o5, _4, s5, n3), _LookupFuncName = Module._LookupFuncName = (e, t3, r, a3) => (_LookupFuncName = Module._LookupFuncName = wasmExports.LookupFuncName)(e, t3, r, a3), _addRangeTableEntryForFunction = Module._addRangeTableEntryForFunction = (e, t3, r, a3, o5, _4, s5) => (_addRangeTableEntryForFunction = Module._addRangeTableEntryForFunction = wasmExports.addRangeTableEntryForFunction)(e, t3, r, a3, o5, _4, s5), _parserOpenTable = Module._parserOpenTable = (e, t3, r) => (_parserOpenTable = Module._parserOpenTable = wasmExports.parserOpenTable)(e, t3, r), _strip_implicit_coercions = Module._strip_implicit_coercions = (e) => (_strip_implicit_coercions = Module._strip_implicit_coercions = wasmExports.strip_implicit_coercions)(e), _colNameToVar = Module._colNameToVar = (e, t3, r, a3) => (_colNameToVar = Module._colNameToVar = wasmExports.colNameToVar)(e, t3, r, a3), _op_hashjoinable = Module._op_hashjoinable = (e, t3) => (_op_hashjoinable = Module._op_hashjoinable = wasmExports.op_hashjoinable)(e, t3), _get_commutator = Module._get_commutator = (e) => (_get_commutator = Module._get_commutator = wasmExports.get_commutator)(e), _can_coerce_type = Module._can_coerce_type = (e, t3, r, a3) => (_can_coerce_type = Module._can_coerce_type = wasmExports.can_coerce_type)(e, t3, r, a3), _get_sortgroupref_tle = Module._get_sortgroupref_tle = (e, t3) => (_get_sortgroupref_tle = Module._get_sortgroupref_tle = wasmExports.get_sortgroupref_tle)(e, t3), _assignSortGroupRef = Module._assignSortGroupRef = (e, t3) => (_assignSortGroupRef = Module._assignSortGroupRef = wasmExports.assignSortGroupRef)(e, t3), _targetIsInSortList = Module._targetIsInSortList = (e, t3, r) => (_targetIsInSortList = Module._targetIsInSortList = wasmExports.targetIsInSortList)(e, t3, r), _contain_aggs_of_level = Module._contain_aggs_of_level = (e, t3) => (_contain_aggs_of_level = Module._contain_aggs_of_level = wasmExports.contain_aggs_of_level)(e, t3), _find_coercion_pathway = Module._find_coercion_pathway = (e, t3, r, a3) => (_find_coercion_pathway = Module._find_coercion_pathway = wasmExports.find_coercion_pathway)(e, t3, r, a3), _typeidType = Module._typeidType = (e) => (_typeidType = Module._typeidType = wasmExports.typeidType)(e), _typeTypeCollation = Module._typeTypeCollation = (e) => (_typeTypeCollation = Module._typeTypeCollation = wasmExports.typeTypeCollation)(e), _typeLen = Module._typeLen = (e) => (_typeLen = Module._typeLen = wasmExports.typeLen)(e), _typeByVal = Module._typeByVal = (e) => (_typeByVal = Module._typeByVal = wasmExports.typeByVal)(e), _makeConst = Module._makeConst = (e, t3, r, a3, o5, _4, s5) => (_makeConst = Module._makeConst = wasmExports.makeConst)(e, t3, r, a3, o5, _4, s5), _lookup_rowtype_tupdesc = Module._lookup_rowtype_tupdesc = (e, t3) => (_lookup_rowtype_tupdesc = Module._lookup_rowtype_tupdesc = wasmExports.lookup_rowtype_tupdesc)(e, t3), _verify_common_type = Module._verify_common_type = (e, t3) => (_verify_common_type = Module._verify_common_type = wasmExports.verify_common_type)(e, t3), _bms_del_member = Module._bms_del_member = (e, t3) => (_bms_del_member = Module._bms_del_member = wasmExports.bms_del_member)(e, t3), _list_member = Module._list_member = (e, t3) => (_list_member = Module._list_member = wasmExports.list_member)(e, t3), _raw_expression_tree_walker_impl = Module._raw_expression_tree_walker_impl = (e, t3, r) => (_raw_expression_tree_walker_impl = Module._raw_expression_tree_walker_impl = wasmExports.raw_expression_tree_walker_impl)(e, t3, r), _type_is_rowtype = Module._type_is_rowtype = (e) => (_type_is_rowtype = Module._type_is_rowtype = wasmExports.type_is_rowtype)(e), _scanNSItemForColumn = Module._scanNSItemForColumn = (e, t3, r, a3, o5) => (_scanNSItemForColumn = Module._scanNSItemForColumn = wasmExports.scanNSItemForColumn)(e, t3, r, a3, o5), _make_op = Module._make_op = (e, t3, r, a3, o5, _4) => (_make_op = Module._make_op = wasmExports.make_op)(e, t3, r, a3, o5, _4), _make_scalar_array_op = Module._make_scalar_array_op = (e, t3, r, a3, o5, _4) => (_make_scalar_array_op = Module._make_scalar_array_op = wasmExports.make_scalar_array_op)(e, t3, r, a3, o5, _4), _count_nonjunk_tlist_entries = Module._count_nonjunk_tlist_entries = (e) => (_count_nonjunk_tlist_entries = Module._count_nonjunk_tlist_entries = wasmExports.count_nonjunk_tlist_entries)(e), _makeWholeRowVar = Module._makeWholeRowVar = (e, t3, r, a3) => (_makeWholeRowVar = Module._makeWholeRowVar = wasmExports.makeWholeRowVar)(e, t3, r, a3), _expandRTE = Module._expandRTE = (e, t3, r, a3, o5, _4, s5, n3) => (_expandRTE = Module._expandRTE = wasmExports.expandRTE)(e, t3, r, a3, o5, _4, s5, n3), _bms_int_members = Module._bms_int_members = (e, t3) => (_bms_int_members = Module._bms_int_members = wasmExports.bms_int_members)(e, t3), _contain_var_clause = Module._contain_var_clause = (e) => (_contain_var_clause = Module._contain_var_clause = wasmExports.contain_var_clause)(e), _jsonb_in = Module._jsonb_in = (e) => (_jsonb_in = Module._jsonb_in = wasmExports.jsonb_in)(e), _escape_json = Module._escape_json = (e, t3) => (_escape_json = Module._escape_json = wasmExports.escape_json)(e, t3), _geterrcode = Module._geterrcode = () => (_geterrcode = Module._geterrcode = wasmExports.geterrcode)(), _bit_in = Module._bit_in = (e) => (_bit_in = Module._bit_in = wasmExports.bit_in)(e), _repalloc0 = Module._repalloc0 = (e, t3, r) => (_repalloc0 = Module._repalloc0 = wasmExports.repalloc0)(e, t3, r), _bms_union = Module._bms_union = (e, t3) => (_bms_union = Module._bms_union = wasmExports.bms_union)(e, t3), _varstr_levenshtein_less_equal = Module._varstr_levenshtein_less_equal = (e, t3, r, a3, o5, _4, s5, n3, l2) => (_varstr_levenshtein_less_equal = Module._varstr_levenshtein_less_equal = wasmExports.varstr_levenshtein_less_equal)(e, t3, r, a3, o5, _4, s5, n3, l2), _raw_parser = Module._raw_parser = (e, t3) => (_raw_parser = Module._raw_parser = wasmExports.raw_parser)(e, t3), _errsave_start = Module._errsave_start = (e, t3) => (_errsave_start = Module._errsave_start = wasmExports.errsave_start)(e, t3), _errsave_finish = Module._errsave_finish = (e, t3, r, a3) => (_errsave_finish = Module._errsave_finish = wasmExports.errsave_finish)(e, t3, r, a3), _makeColumnDef = Module._makeColumnDef = (e, t3, r, a3) => (_makeColumnDef = Module._makeColumnDef = wasmExports.makeColumnDef)(e, t3, r, a3), _GetDefaultOpClass = Module._GetDefaultOpClass = (e, t3) => (_GetDefaultOpClass = Module._GetDefaultOpClass = wasmExports.GetDefaultOpClass)(e, t3), _ChooseRelationName = Module._ChooseRelationName = (e, t3, r, a3, o5) => (_ChooseRelationName = Module._ChooseRelationName = wasmExports.ChooseRelationName)(e, t3, r, a3, o5), _scanner_init = Module._scanner_init = (e, t3, r, a3) => (_scanner_init = Module._scanner_init = wasmExports.scanner_init)(e, t3, r, a3), _scanner_finish = Module._scanner_finish = (e) => (_scanner_finish = Module._scanner_finish = wasmExports.scanner_finish)(e), _core_yylex = Module._core_yylex = (e, t3, r) => (_core_yylex = Module._core_yylex = wasmExports.core_yylex)(e, t3, r), _isxdigit = Module._isxdigit = (e) => (_isxdigit = Module._isxdigit = wasmExports.isxdigit)(e), _scanner_isspace = Module._scanner_isspace = (e) => (_scanner_isspace = Module._scanner_isspace = wasmExports.scanner_isspace)(e), _truncate_identifier = Module._truncate_identifier = (e, t3, r) => (_truncate_identifier = Module._truncate_identifier = wasmExports.truncate_identifier)(e, t3, r), _ScanKeywordLookup = Module._ScanKeywordLookup = (e, t3) => (_ScanKeywordLookup = Module._ScanKeywordLookup = wasmExports.ScanKeywordLookup)(e, t3), _pg_verifymbstr = Module._pg_verifymbstr = (e, t3, r) => (_pg_verifymbstr = Module._pg_verifymbstr = wasmExports.pg_verifymbstr)(e, t3, r), _downcase_truncate_identifier = Module._downcase_truncate_identifier = (e, t3, r) => (_downcase_truncate_identifier = Module._downcase_truncate_identifier = wasmExports.downcase_truncate_identifier)(e, t3, r), _pg_database_encoding_max_length = Module._pg_database_encoding_max_length = () => (_pg_database_encoding_max_length = Module._pg_database_encoding_max_length = wasmExports.pg_database_encoding_max_length)(), _getTypeInputInfo = Module._getTypeInputInfo = (e, t3, r) => (_getTypeInputInfo = Module._getTypeInputInfo = wasmExports.getTypeInputInfo)(e, t3, r), _RenameSchema = Module._RenameSchema = (e, t3, r) => (_RenameSchema = Module._RenameSchema = wasmExports.RenameSchema)(e, t3, r), _namein = Module._namein = (e) => (_namein = Module._namein = wasmExports.namein)(e), _BlockSampler_Init = Module._BlockSampler_Init = (e, t3, r, a3) => (_BlockSampler_Init = Module._BlockSampler_Init = wasmExports.BlockSampler_Init)(e, t3, r, a3), _reservoir_init_selection_state = Module._reservoir_init_selection_state = (e, t3) => (_reservoir_init_selection_state = Module._reservoir_init_selection_state = wasmExports.reservoir_init_selection_state)(e, t3), _reservoir_get_next_S = Module._reservoir_get_next_S = (e, t3, r) => (_reservoir_get_next_S = Module._reservoir_get_next_S = wasmExports.reservoir_get_next_S)(e, t3, r), _sampler_random_fract = Module._sampler_random_fract = (e) => (_sampler_random_fract = Module._sampler_random_fract = wasmExports.sampler_random_fract)(e), _std_typanalyze = Module._std_typanalyze = (e) => (_std_typanalyze = Module._std_typanalyze = wasmExports.std_typanalyze)(e), _BlockSampler_HasMore = Module._BlockSampler_HasMore = (e) => (_BlockSampler_HasMore = Module._BlockSampler_HasMore = wasmExports.BlockSampler_HasMore)(e), _BlockSampler_Next = Module._BlockSampler_Next = (e) => (_BlockSampler_Next = Module._BlockSampler_Next = wasmExports.BlockSampler_Next)(e), _Async_Notify = Module._Async_Notify = (e, t3) => (_Async_Notify = Module._Async_Notify = wasmExports.Async_Notify)(e, t3), _RangeVarCallbackMaintainsTable = Module._RangeVarCallbackMaintainsTable = (e, t3, r, a3) => (_RangeVarCallbackMaintainsTable = Module._RangeVarCallbackMaintainsTable = wasmExports.RangeVarCallbackMaintainsTable)(e, t3, r, a3), _make_new_heap = Module._make_new_heap = (e, t3, r, a3, o5) => (_make_new_heap = Module._make_new_heap = wasmExports.make_new_heap)(e, t3, r, a3, o5), _finish_heap_swap = Module._finish_heap_swap = (e, t3, r, a3, o5, _4, s5, n3, l2) => (_finish_heap_swap = Module._finish_heap_swap = wasmExports.finish_heap_swap)(e, t3, r, a3, o5, _4, s5, n3, l2), _OpenPipeStream = Module._OpenPipeStream = (e, t3) => (_OpenPipeStream = Module._OpenPipeStream = wasmExports.OpenPipeStream)(e, t3), _pg_is_ascii = Module._pg_is_ascii = (e) => (_pg_is_ascii = Module._pg_is_ascii = wasmExports.pg_is_ascii)(e), _ClosePipeStream = Module._ClosePipeStream = (e) => (_ClosePipeStream = Module._ClosePipeStream = wasmExports.ClosePipeStream)(e), _BeginCopyFrom = Module._BeginCopyFrom = (e, t3, r, a3, o5, _4, s5, n3) => (_BeginCopyFrom = Module._BeginCopyFrom = wasmExports.BeginCopyFrom)(e, t3, r, a3, o5, _4, s5, n3), _EndCopyFrom = Module._EndCopyFrom = (e) => (_EndCopyFrom = Module._EndCopyFrom = wasmExports.EndCopyFrom)(e), _ProcessCopyOptions = Module._ProcessCopyOptions = (e, t3, r, a3) => (_ProcessCopyOptions = Module._ProcessCopyOptions = wasmExports.ProcessCopyOptions)(e, t3, r, a3), _pg_strtoint64 = Module._pg_strtoint64 = (e) => (_pg_strtoint64 = Module._pg_strtoint64 = wasmExports.pg_strtoint64)(e), _CopyFromErrorCallback = Module._CopyFromErrorCallback = (e) => (_CopyFromErrorCallback = Module._CopyFromErrorCallback = wasmExports.CopyFromErrorCallback)(e), _bms_make_singleton = Module._bms_make_singleton = (e) => (_bms_make_singleton = Module._bms_make_singleton = wasmExports.bms_make_singleton)(e), _ExecInitRangeTable = Module._ExecInitRangeTable = (e, t3, r, a3) => (_ExecInitRangeTable = Module._ExecInitRangeTable = wasmExports.ExecInitRangeTable)(e, t3, r, a3), _ExecInitResultRelation = Module._ExecInitResultRelation = (e, t3, r) => (_ExecInitResultRelation = Module._ExecInitResultRelation = wasmExports.ExecInitResultRelation)(e, t3, r), _ExecInitQual = Module._ExecInitQual = (e, t3) => (_ExecInitQual = Module._ExecInitQual = wasmExports.ExecInitQual)(e, t3), _NextCopyFrom = Module._NextCopyFrom = (e, t3, r, a3) => (_NextCopyFrom = Module._NextCopyFrom = wasmExports.NextCopyFrom)(e, t3, r, a3), _ExecCloseResultRelations = Module._ExecCloseResultRelations = (e) => (_ExecCloseResultRelations = Module._ExecCloseResultRelations = wasmExports.ExecCloseResultRelations)(e), _ExecCloseRangeTableRelations = Module._ExecCloseRangeTableRelations = (e) => (_ExecCloseRangeTableRelations = Module._ExecCloseRangeTableRelations = wasmExports.ExecCloseRangeTableRelations)(e), _ExecConstraints = Module._ExecConstraints = (e, t3, r) => (_ExecConstraints = Module._ExecConstraints = wasmExports.ExecConstraints)(e, t3, r), _ExecInsertIndexTuples = Module._ExecInsertIndexTuples = (e, t3, r, a3, o5, _4, s5, n3) => (_ExecInsertIndexTuples = Module._ExecInsertIndexTuples = wasmExports.ExecInsertIndexTuples)(e, t3, r, a3, o5, _4, s5, n3), _build_column_default = Module._build_column_default = (e, t3) => (_build_column_default = Module._build_column_default = wasmExports.build_column_default)(e, t3), _ExecInitExpr = Module._ExecInitExpr = (e, t3) => (_ExecInitExpr = Module._ExecInitExpr = wasmExports.ExecInitExpr)(e, t3), _fileno = Module._fileno = (e) => (_fileno = Module._fileno = wasmExports.fileno)(e), _NextCopyFromRawFields = Module._NextCopyFromRawFields = (e, t3, r) => (_NextCopyFromRawFields = Module._NextCopyFromRawFields = wasmExports.NextCopyFromRawFields)(e, t3, r), _resetStringInfo = Module._resetStringInfo = (e) => (_resetStringInfo = Module._resetStringInfo = wasmExports.resetStringInfo)(e), _pq_copymsgbytes = Module._pq_copymsgbytes = (e, t3, r) => (_pq_copymsgbytes = Module._pq_copymsgbytes = wasmExports.pq_copymsgbytes)(e, t3, r), _pg_encoding_max_length = Module._pg_encoding_max_length = (e) => (_pg_encoding_max_length = Module._pg_encoding_max_length = wasmExports.pg_encoding_max_length)(e), _tolower = Module._tolower = (e) => (_tolower = Module._tolower = wasmExports.tolower)(e), _pg_plan_query = Module._pg_plan_query = (e, t3, r, a3) => (_pg_plan_query = Module._pg_plan_query = wasmExports.pg_plan_query)(e, t3, r, a3), _PushCopiedSnapshot = Module._PushCopiedSnapshot = (e) => (_PushCopiedSnapshot = Module._PushCopiedSnapshot = wasmExports.PushCopiedSnapshot)(e), _UpdateActiveSnapshotCommandId = Module._UpdateActiveSnapshotCommandId = () => (_UpdateActiveSnapshotCommandId = Module._UpdateActiveSnapshotCommandId = wasmExports.UpdateActiveSnapshotCommandId)(), _CreateQueryDesc = Module._CreateQueryDesc = (e, t3, r, a3, o5, _4, s5, n3) => (_CreateQueryDesc = Module._CreateQueryDesc = wasmExports.CreateQueryDesc)(e, t3, r, a3, o5, _4, s5, n3), _ExecutorStart = Module._ExecutorStart = (e, t3) => (_ExecutorStart = Module._ExecutorStart = wasmExports.ExecutorStart)(e, t3), _ExecutorFinish = Module._ExecutorFinish = (e) => (_ExecutorFinish = Module._ExecutorFinish = wasmExports.ExecutorFinish)(e), _ExecutorEnd = Module._ExecutorEnd = (e) => (_ExecutorEnd = Module._ExecutorEnd = wasmExports.ExecutorEnd)(e), _FreeQueryDesc = Module._FreeQueryDesc = (e) => (_FreeQueryDesc = Module._FreeQueryDesc = wasmExports.FreeQueryDesc)(e), _ExecutorRun = Module._ExecutorRun = (e, t3, r) => (_ExecutorRun = Module._ExecutorRun = wasmExports.ExecutorRun)(e, t3, r), _pg_server_to_any = Module._pg_server_to_any = (e, t3, r) => (_pg_server_to_any = Module._pg_server_to_any = wasmExports.pg_server_to_any)(e, t3, r), _fwrite = Module._fwrite = (e, t3, r, a3) => (_fwrite = Module._fwrite = wasmExports.fwrite)(e, t3, r, a3), _CreateTableAsRelExists = Module._CreateTableAsRelExists = (e) => (_CreateTableAsRelExists = Module._CreateTableAsRelExists = wasmExports.CreateTableAsRelExists)(e), _QueryRewrite = Module._QueryRewrite = (e) => (_QueryRewrite = Module._QueryRewrite = wasmExports.QueryRewrite)(e), _DefineRelation = Module._DefineRelation = (e, t3, r, a3, o5, _4) => (_DefineRelation = Module._DefineRelation = wasmExports.DefineRelation)(e, t3, r, a3, o5, _4), _rmdir = Module._rmdir = (e) => (_rmdir = Module._rmdir = wasmExports.rmdir)(e), _atof = Module._atof = (e) => (_atof = Module._atof = wasmExports.atof)(e), _int8in = Module._int8in = (e) => (_int8in = Module._int8in = wasmExports.int8in)(e), _oidin = Module._oidin = (e) => (_oidin = Module._oidin = wasmExports.oidin)(e), _RemoveObjects = Module._RemoveObjects = (e) => (_RemoveObjects = Module._RemoveObjects = wasmExports.RemoveObjects)(e), _GetCommandTagName = Module._GetCommandTagName = (e) => (_GetCommandTagName = Module._GetCommandTagName = wasmExports.GetCommandTagName)(e), _NewExplainState = Module._NewExplainState = () => (_NewExplainState = Module._NewExplainState = wasmExports.NewExplainState)(), _ExplainBeginOutput = Module._ExplainBeginOutput = (e) => (_ExplainBeginOutput = Module._ExplainBeginOutput = wasmExports.ExplainBeginOutput)(e), _ExplainEndOutput = Module._ExplainEndOutput = (e) => (_ExplainEndOutput = Module._ExplainEndOutput = wasmExports.ExplainEndOutput)(e), _ExplainOpenGroup = Module._ExplainOpenGroup = (e, t3, r, a3) => (_ExplainOpenGroup = Module._ExplainOpenGroup = wasmExports.ExplainOpenGroup)(e, t3, r, a3), _ExplainPrintPlan = Module._ExplainPrintPlan = (e, t3) => (_ExplainPrintPlan = Module._ExplainPrintPlan = wasmExports.ExplainPrintPlan)(e, t3), _ExplainIndentText = Module._ExplainIndentText = (e) => (_ExplainIndentText = Module._ExplainIndentText = wasmExports.ExplainIndentText)(e), _ExplainPropertyInteger = Module._ExplainPropertyInteger = (e, t3, r, a3) => (_ExplainPropertyInteger = Module._ExplainPropertyInteger = wasmExports.ExplainPropertyInteger)(e, t3, r, a3), _ExplainCloseGroup = Module._ExplainCloseGroup = (e, t3, r, a3) => (_ExplainCloseGroup = Module._ExplainCloseGroup = wasmExports.ExplainCloseGroup)(e, t3, r, a3), _ExplainPropertyFloat = Module._ExplainPropertyFloat = (e, t3, r, a3, o5) => (_ExplainPropertyFloat = Module._ExplainPropertyFloat = wasmExports.ExplainPropertyFloat)(e, t3, r, a3, o5), _ExplainPrintTriggers = Module._ExplainPrintTriggers = (e, t3) => (_ExplainPrintTriggers = Module._ExplainPrintTriggers = wasmExports.ExplainPrintTriggers)(e, t3), _ExplainPropertyUInteger = Module._ExplainPropertyUInteger = (e, t3, r, a3) => (_ExplainPropertyUInteger = Module._ExplainPropertyUInteger = wasmExports.ExplainPropertyUInteger)(e, t3, r, a3), _ExplainPropertyText = Module._ExplainPropertyText = (e, t3, r) => (_ExplainPropertyText = Module._ExplainPropertyText = wasmExports.ExplainPropertyText)(e, t3, r), _GetConfigOptionByName = Module._GetConfigOptionByName = (e, t3, r) => (_GetConfigOptionByName = Module._GetConfigOptionByName = wasmExports.GetConfigOptionByName)(e, t3, r), _ExplainPrintJITSummary = Module._ExplainPrintJITSummary = (e, t3) => (_ExplainPrintJITSummary = Module._ExplainPrintJITSummary = wasmExports.ExplainPrintJITSummary)(e, t3), _ExplainPropertyBool = Module._ExplainPropertyBool = (e, t3, r) => (_ExplainPropertyBool = Module._ExplainPropertyBool = wasmExports.ExplainPropertyBool)(e, t3, r), _InstrEndLoop = Module._InstrEndLoop = (e) => (_InstrEndLoop = Module._InstrEndLoop = wasmExports.InstrEndLoop)(e), _appendStringInfoSpaces = Module._appendStringInfoSpaces = (e, t3) => (_appendStringInfoSpaces = Module._appendStringInfoSpaces = wasmExports.appendStringInfoSpaces)(e, t3), _ExplainQueryText = Module._ExplainQueryText = (e, t3) => (_ExplainQueryText = Module._ExplainQueryText = wasmExports.ExplainQueryText)(e, t3), _ExplainQueryParameters = Module._ExplainQueryParameters = (e, t3, r) => (_ExplainQueryParameters = Module._ExplainQueryParameters = wasmExports.ExplainQueryParameters)(e, t3, r), _get_func_namespace = Module._get_func_namespace = (e) => (_get_func_namespace = Module._get_func_namespace = wasmExports.get_func_namespace)(e), _GetExplainExtensionId = Module._GetExplainExtensionId = (e) => (_GetExplainExtensionId = Module._GetExplainExtensionId = wasmExports.GetExplainExtensionId)(e), _GetExplainExtensionState = Module._GetExplainExtensionState = (e, t3) => (_GetExplainExtensionState = Module._GetExplainExtensionState = wasmExports.GetExplainExtensionState)(e, t3), _SetExplainExtensionState = Module._SetExplainExtensionState = (e, t3, r) => (_SetExplainExtensionState = Module._SetExplainExtensionState = wasmExports.SetExplainExtensionState)(e, t3, r), _RegisterExtensionExplainOption = Module._RegisterExtensionExplainOption = (e, t3) => (_RegisterExtensionExplainOption = Module._RegisterExtensionExplainOption = wasmExports.RegisterExtensionExplainOption)(e, t3), _get_function_sibling_type = Module._get_function_sibling_type = (e, t3) => (_get_function_sibling_type = Module._get_function_sibling_type = wasmExports.get_function_sibling_type)(e, t3), _GetSysCacheHashValue = Module._GetSysCacheHashValue = (e, t3, r, a3, o5) => (_GetSysCacheHashValue = Module._GetSysCacheHashValue = wasmExports.GetSysCacheHashValue)(e, t3, r, a3, o5), _CreateSchemaCommand = Module._CreateSchemaCommand = (e, t3, r, a3) => (_CreateSchemaCommand = Module._CreateSchemaCommand = wasmExports.CreateSchemaCommand)(e, t3, r, a3), _get_rel_type_id = Module._get_rel_type_id = (e) => (_get_rel_type_id = Module._get_rel_type_id = wasmExports.get_rel_type_id)(e), _set_config_option = Module._set_config_option = (e, t3, r, a3, o5, _4, s5, n3) => (_set_config_option = Module._set_config_option = wasmExports.set_config_option)(e, t3, r, a3, o5, _4, s5, n3), _pg_any_to_server = Module._pg_any_to_server = (e, t3, r) => (_pg_any_to_server = Module._pg_any_to_server = wasmExports.pg_any_to_server)(e, t3, r), _DirectFunctionCall4Coll = Module._DirectFunctionCall4Coll = (e, t3, r, a3, o5, _4) => (_DirectFunctionCall4Coll = Module._DirectFunctionCall4Coll = wasmExports.DirectFunctionCall4Coll)(e, t3, r, a3, o5, _4), _replace_text = Module._replace_text = (e) => (_replace_text = Module._replace_text = wasmExports.replace_text)(e), _ProcessUtility = Module._ProcessUtility = (e, t3, r, a3, o5, _4, s5, n3) => (_ProcessUtility = Module._ProcessUtility = wasmExports.ProcessUtility)(e, t3, r, a3, o5, _4, s5, n3), _CleanQuerytext = Module._CleanQuerytext = (e, t3, r) => (_CleanQuerytext = Module._CleanQuerytext = wasmExports.CleanQuerytext)(e, t3, r), _list_delete_cell = Module._list_delete_cell = (e, t3) => (_list_delete_cell = Module._list_delete_cell = wasmExports.list_delete_cell)(e, t3), _GetForeignDataWrapper = Module._GetForeignDataWrapper = (e) => (_GetForeignDataWrapper = Module._GetForeignDataWrapper = wasmExports.GetForeignDataWrapper)(e), _CreateExprContext = Module._CreateExprContext = (e) => (_CreateExprContext = Module._CreateExprContext = wasmExports.CreateExprContext)(e), _EnsurePortalSnapshotExists = Module._EnsurePortalSnapshotExists = () => (_EnsurePortalSnapshotExists = Module._EnsurePortalSnapshotExists = wasmExports.EnsurePortalSnapshotExists)(), _CheckIndexCompatible = Module._CheckIndexCompatible = (e, t3, r, a3, o5) => (_CheckIndexCompatible = Module._CheckIndexCompatible = wasmExports.CheckIndexCompatible)(e, t3, r, a3, o5), _get_opfamily_member_for_cmptype = Module._get_opfamily_member_for_cmptype = (e, t3, r, a3) => (_get_opfamily_member_for_cmptype = Module._get_opfamily_member_for_cmptype = wasmExports.get_opfamily_member_for_cmptype)(e, t3, r, a3), _pgstat_count_truncate = Module._pgstat_count_truncate = (e) => (_pgstat_count_truncate = Module._pgstat_count_truncate = wasmExports.pgstat_count_truncate)(e), _SPI_connect = Module._SPI_connect = () => (_SPI_connect = Module._SPI_connect = wasmExports.SPI_connect)(), _SPI_exec = Module._SPI_exec = (e, t3) => (_SPI_exec = Module._SPI_exec = wasmExports.SPI_exec)(e, t3), _SPI_execute = Module._SPI_execute = (e, t3, r) => (_SPI_execute = Module._SPI_execute = wasmExports.SPI_execute)(e, t3, r), _SPI_getvalue = Module._SPI_getvalue = (e, t3, r) => (_SPI_getvalue = Module._SPI_getvalue = wasmExports.SPI_getvalue)(e, t3, r), _generate_operator_clause = Module._generate_operator_clause = (e, t3, r, a3, o5, _4) => (_generate_operator_clause = Module._generate_operator_clause = wasmExports.generate_operator_clause)(e, t3, r, a3, o5, _4), _SPI_finish = Module._SPI_finish = () => (_SPI_finish = Module._SPI_finish = wasmExports.SPI_finish)(), _CreateTransientRelDestReceiver = Module._CreateTransientRelDestReceiver = (e) => (_CreateTransientRelDestReceiver = Module._CreateTransientRelDestReceiver = wasmExports.CreateTransientRelDestReceiver)(e), _MemoryContextSetIdentifier = Module._MemoryContextSetIdentifier = (e, t3) => (_MemoryContextSetIdentifier = Module._MemoryContextSetIdentifier = wasmExports.MemoryContextSetIdentifier)(e, t3), _checkExprHasSubLink = Module._checkExprHasSubLink = (e) => (_checkExprHasSubLink = Module._checkExprHasSubLink = wasmExports.checkExprHasSubLink)(e), _MemoryContextSetParent = Module._MemoryContextSetParent = (e, t3) => (_MemoryContextSetParent = Module._MemoryContextSetParent = wasmExports.MemoryContextSetParent)(e, t3), _SetTuplestoreDestReceiverParams = Module._SetTuplestoreDestReceiverParams = (e, t3, r, a3, o5, _4) => (_SetTuplestoreDestReceiverParams = Module._SetTuplestoreDestReceiverParams = wasmExports.SetTuplestoreDestReceiverParams)(e, t3, r, a3, o5, _4), _tuplestore_rescan = Module._tuplestore_rescan = (e) => (_tuplestore_rescan = Module._tuplestore_rescan = wasmExports.tuplestore_rescan)(e), _MemoryContextDeleteChildren = Module._MemoryContextDeleteChildren = (e) => (_MemoryContextDeleteChildren = Module._MemoryContextDeleteChildren = wasmExports.MemoryContextDeleteChildren)(e), _makeParamList = Module._makeParamList = (e) => (_makeParamList = Module._makeParamList = wasmExports.makeParamList)(e), _ReleaseCachedPlan = Module._ReleaseCachedPlan = (e, t3) => (_ReleaseCachedPlan = Module._ReleaseCachedPlan = wasmExports.ReleaseCachedPlan)(e, t3), _bms_equal = Module._bms_equal = (e, t3) => (_bms_equal = Module._bms_equal = wasmExports.bms_equal)(e, t3), _func_volatile = Module._func_volatile = (e) => (_func_volatile = Module._func_volatile = wasmExports.func_volatile)(e), _register_label_provider = Module._register_label_provider = (e, t3) => (_register_label_provider = Module._register_label_provider = wasmExports.register_label_provider)(e, t3), _DefineSequence = Module._DefineSequence = (e, t3, r) => (_DefineSequence = Module._DefineSequence = wasmExports.DefineSequence)(e, t3, r), _AlterSequence = Module._AlterSequence = (e, t3, r) => (_AlterSequence = Module._AlterSequence = wasmExports.AlterSequence)(e, t3, r), _nextval = Module._nextval = (e) => (_nextval = Module._nextval = wasmExports.nextval)(e), _textToQualifiedNameList = Module._textToQualifiedNameList = (e) => (_textToQualifiedNameList = Module._textToQualifiedNameList = wasmExports.textToQualifiedNameList)(e), _nextval_internal = Module._nextval_internal = (e, t3) => (_nextval_internal = Module._nextval_internal = wasmExports.nextval_internal)(e, t3), _setval_oid = Module._setval_oid = (e) => (_setval_oid = Module._setval_oid = wasmExports.setval_oid)(e), _tuplestore_gettupleslot = Module._tuplestore_gettupleslot = (e, t3, r, a3) => (_tuplestore_gettupleslot = Module._tuplestore_gettupleslot = wasmExports.tuplestore_gettupleslot)(e, t3, r, a3), _list_delete = Module._list_delete = (e, t3) => (_list_delete = Module._list_delete = wasmExports.list_delete)(e, t3), _tuplestore_end = Module._tuplestore_end = (e) => (_tuplestore_end = Module._tuplestore_end = wasmExports.tuplestore_end)(e), _list_append_unique = Module._list_append_unique = (e, t3) => (_list_append_unique = Module._list_append_unique = wasmExports.list_append_unique)(e, t3), _contain_mutable_functions = Module._contain_mutable_functions = (e) => (_contain_mutable_functions = Module._contain_mutable_functions = wasmExports.contain_mutable_functions)(e), _RemoveRelations = Module._RemoveRelations = (e) => (_RemoveRelations = Module._RemoveRelations = wasmExports.RemoveRelations)(e), _ExecuteTruncateGuts = Module._ExecuteTruncateGuts = (e, t3, r, a3, o5, _4) => (_ExecuteTruncateGuts = Module._ExecuteTruncateGuts = wasmExports.ExecuteTruncateGuts)(e, t3, r, a3, o5, _4), _InitResultRelInfo = Module._InitResultRelInfo = (e, t3, r, a3, o5) => (_InitResultRelInfo = Module._InitResultRelInfo = wasmExports.InitResultRelInfo)(e, t3, r, a3, o5), _AlterTable = Module._AlterTable = (e, t3, r) => (_AlterTable = Module._AlterTable = wasmExports.AlterTable)(e, t3, r), _ExecStoreAllNullTuple = Module._ExecStoreAllNullTuple = (e) => (_ExecStoreAllNullTuple = Module._ExecStoreAllNullTuple = wasmExports.ExecStoreAllNullTuple)(e), _ChangeVarNodes = Module._ChangeVarNodes = (e, t3, r, a3) => (_ChangeVarNodes = Module._ChangeVarNodes = wasmExports.ChangeVarNodes)(e, t3, r, a3), _tuplestore_begin_heap = Module._tuplestore_begin_heap = (e, t3, r) => (_tuplestore_begin_heap = Module._tuplestore_begin_heap = wasmExports.tuplestore_begin_heap)(e, t3, r), _tuplestore_puttupleslot = Module._tuplestore_puttupleslot = (e, t3) => (_tuplestore_puttupleslot = Module._tuplestore_puttupleslot = wasmExports.tuplestore_puttupleslot)(e, t3), _ExecForceStoreHeapTuple = Module._ExecForceStoreHeapTuple = (e, t3, r) => (_ExecForceStoreHeapTuple = Module._ExecForceStoreHeapTuple = wasmExports.ExecForceStoreHeapTuple)(e, t3, r), _ExecUpdateLockMode = Module._ExecUpdateLockMode = (e, t3) => (_ExecUpdateLockMode = Module._ExecUpdateLockMode = wasmExports.ExecUpdateLockMode)(e, t3), _bms_copy = Module._bms_copy = (e) => (_bms_copy = Module._bms_copy = wasmExports.bms_copy)(e), _strtoint = Module._strtoint = (e, t3, r) => (_strtoint = Module._strtoint = wasmExports.strtoint)(e, t3, r), _strtod = Module._strtod = (e, t3) => (_strtod = Module._strtod = wasmExports.strtod)(e, t3), _plain_crypt_verify = Module._plain_crypt_verify = (e, t3, r, a3) => (_plain_crypt_verify = Module._plain_crypt_verify = wasmExports.plain_crypt_verify)(e, t3, r, a3), _ProcessConfigFile = Module._ProcessConfigFile = (e) => (_ProcessConfigFile = Module._ProcessConfigFile = wasmExports.ProcessConfigFile)(e), _pgl_exit = Module._pgl_exit = (e) => (_pgl_exit = Module._pgl_exit = wasmExports.pgl_exit)(e), _dsa_get_handle = Module._dsa_get_handle = (e) => (_dsa_get_handle = Module._dsa_get_handle = wasmExports.dsa_get_handle)(e), _pg_strncasecmp = Module._pg_strncasecmp = (e, t3, r) => (_pg_strncasecmp = Module._pg_strncasecmp = wasmExports.pg_strncasecmp)(e, t3, r), _ExecReScan = Module._ExecReScan = (e) => (_ExecReScan = Module._ExecReScan = wasmExports.ExecReScan)(e), _ExecAsyncResponse = Module._ExecAsyncResponse = (e) => (_ExecAsyncResponse = Module._ExecAsyncResponse = wasmExports.ExecAsyncResponse)(e), _ExecAsyncRequestDone = Module._ExecAsyncRequestDone = (e, t3) => (_ExecAsyncRequestDone = Module._ExecAsyncRequestDone = wasmExports.ExecAsyncRequestDone)(e, t3), _ExecAsyncRequestPending = Module._ExecAsyncRequestPending = (e) => (_ExecAsyncRequestPending = Module._ExecAsyncRequestPending = wasmExports.ExecAsyncRequestPending)(e), _ExprEvalPushStep = Module._ExprEvalPushStep = (e, t3) => (_ExprEvalPushStep = Module._ExprEvalPushStep = wasmExports.ExprEvalPushStep)(e, t3), _ExecInitExprWithParams = Module._ExecInitExprWithParams = (e, t3) => (_ExecInitExprWithParams = Module._ExecInitExprWithParams = wasmExports.ExecInitExprWithParams)(e, t3), _ExecInitExprList = Module._ExecInitExprList = (e, t3) => (_ExecInitExprList = Module._ExecInitExprList = wasmExports.ExecInitExprList)(e, t3), _ExecGetResultType = Module._ExecGetResultType = (e) => (_ExecGetResultType = Module._ExecGetResultType = wasmExports.ExecGetResultType)(e), _ExecInitExtraTupleSlot = Module._ExecInitExtraTupleSlot = (e, t3, r) => (_ExecInitExtraTupleSlot = Module._ExecInitExtraTupleSlot = wasmExports.ExecInitExtraTupleSlot)(e, t3, r), _MakeExpandedObjectReadOnlyInternal = Module._MakeExpandedObjectReadOnlyInternal = (e) => (_MakeExpandedObjectReadOnlyInternal = Module._MakeExpandedObjectReadOnlyInternal = wasmExports.MakeExpandedObjectReadOnlyInternal)(e), _tuplesort_puttupleslot = Module._tuplesort_puttupleslot = (e, t3) => (_tuplesort_puttupleslot = Module._tuplesort_puttupleslot = wasmExports.tuplesort_puttupleslot)(e, t3), _ArrayGetNItems = Module._ArrayGetNItems = (e, t3) => (_ArrayGetNItems = Module._ArrayGetNItems = wasmExports.ArrayGetNItems)(e, t3), _expanded_record_fetch_tupdesc = Module._expanded_record_fetch_tupdesc = (e) => (_expanded_record_fetch_tupdesc = Module._expanded_record_fetch_tupdesc = wasmExports.expanded_record_fetch_tupdesc)(e), _expanded_record_fetch_field = Module._expanded_record_fetch_field = (e, t3, r) => (_expanded_record_fetch_field = Module._expanded_record_fetch_field = wasmExports.expanded_record_fetch_field)(e, t3, r), _json_validate = Module._json_validate = (e, t3, r) => (_json_validate = Module._json_validate = wasmExports.json_validate)(e, t3, r), _JsonbValueToJsonb = Module._JsonbValueToJsonb = (e) => (_JsonbValueToJsonb = Module._JsonbValueToJsonb = wasmExports.JsonbValueToJsonb)(e), _numeric_out = Module._numeric_out = (e) => (_numeric_out = Module._numeric_out = wasmExports.numeric_out)(e), _boolout = Module._boolout = (e) => (_boolout = Module._boolout = wasmExports.boolout)(e), _bool_int4 = Module._bool_int4 = (e) => (_bool_int4 = Module._bool_int4 = wasmExports.bool_int4)(e), _lookup_rowtype_tupdesc_domain = Module._lookup_rowtype_tupdesc_domain = (e, t3, r) => (_lookup_rowtype_tupdesc_domain = Module._lookup_rowtype_tupdesc_domain = wasmExports.lookup_rowtype_tupdesc_domain)(e, t3, r), _MemoryContextGetParent = Module._MemoryContextGetParent = (e) => (_MemoryContextGetParent = Module._MemoryContextGetParent = wasmExports.MemoryContextGetParent)(e), _DeleteExpandedObject = Module._DeleteExpandedObject = (e) => (_DeleteExpandedObject = Module._DeleteExpandedObject = wasmExports.DeleteExpandedObject)(e), _ExecFindJunkAttributeInTlist = Module._ExecFindJunkAttributeInTlist = (e, t3) => (_ExecFindJunkAttributeInTlist = Module._ExecFindJunkAttributeInTlist = wasmExports.ExecFindJunkAttributeInTlist)(e, t3), _standard_ExecutorStart = Module._standard_ExecutorStart = (e, t3) => (_standard_ExecutorStart = Module._standard_ExecutorStart = wasmExports.standard_ExecutorStart)(e, t3), _ExecInitNode = Module._ExecInitNode = (e, t3, r) => (_ExecInitNode = Module._ExecInitNode = wasmExports.ExecInitNode)(e, t3, r), _standard_ExecutorRun = Module._standard_ExecutorRun = (e, t3, r) => (_standard_ExecutorRun = Module._standard_ExecutorRun = wasmExports.standard_ExecutorRun)(e, t3, r), _standard_ExecutorFinish = Module._standard_ExecutorFinish = (e) => (_standard_ExecutorFinish = Module._standard_ExecutorFinish = wasmExports.standard_ExecutorFinish)(e), _standard_ExecutorEnd = Module._standard_ExecutorEnd = (e) => (_standard_ExecutorEnd = Module._standard_ExecutorEnd = wasmExports.standard_ExecutorEnd)(e), _ExecEndNode = Module._ExecEndNode = (e) => (_ExecEndNode = Module._ExecEndNode = wasmExports.ExecEndNode)(e), _InstrAlloc = Module._InstrAlloc = (e, t3, r) => (_InstrAlloc = Module._InstrAlloc = wasmExports.InstrAlloc)(e, t3, r), _MakeTupleTableSlot = Module._MakeTupleTableSlot = (e, t3) => (_MakeTupleTableSlot = Module._MakeTupleTableSlot = wasmExports.MakeTupleTableSlot)(e, t3), _ExecWithCheckOptions = Module._ExecWithCheckOptions = (e, t3, r, a3) => (_ExecWithCheckOptions = Module._ExecWithCheckOptions = wasmExports.ExecWithCheckOptions)(e, t3, r, a3), _get_typlenbyval = Module._get_typlenbyval = (e, t3, r) => (_get_typlenbyval = Module._get_typlenbyval = wasmExports.get_typlenbyval)(e, t3, r), _ExecInitScanTupleSlot = Module._ExecInitScanTupleSlot = (e, t3, r, a3) => (_ExecInitScanTupleSlot = Module._ExecInitScanTupleSlot = wasmExports.ExecInitScanTupleSlot)(e, t3, r, a3), _InputFunctionCall = Module._InputFunctionCall = (e, t3, r, a3) => (_InputFunctionCall = Module._InputFunctionCall = wasmExports.InputFunctionCall)(e, t3, r, a3), _list_delete_ptr = Module._list_delete_ptr = (e, t3) => (_list_delete_ptr = Module._list_delete_ptr = wasmExports.list_delete_ptr)(e, t3), _FreeExprContext = Module._FreeExprContext = (e, t3) => (_FreeExprContext = Module._FreeExprContext = wasmExports.FreeExprContext)(e, t3), _ExecAssignExprContext = Module._ExecAssignExprContext = (e, t3) => (_ExecAssignExprContext = Module._ExecAssignExprContext = wasmExports.ExecAssignExprContext)(e, t3), _ExecAssignProjectionInfo = Module._ExecAssignProjectionInfo = (e, t3) => (_ExecAssignProjectionInfo = Module._ExecAssignProjectionInfo = wasmExports.ExecAssignProjectionInfo)(e, t3), _ExecOpenScanRelation = Module._ExecOpenScanRelation = (e, t3, r) => (_ExecOpenScanRelation = Module._ExecOpenScanRelation = wasmExports.ExecOpenScanRelation)(e, t3, r), _bms_intersect = Module._bms_intersect = (e, t3) => (_bms_intersect = Module._bms_intersect = wasmExports.bms_intersect)(e, t3), _GetAttributeByName = Module._GetAttributeByName = (e, t3, r) => (_GetAttributeByName = Module._GetAttributeByName = wasmExports.GetAttributeByName)(e, t3, r), _GetAttributeByNum = Module._GetAttributeByNum = (e, t3, r) => (_GetAttributeByNum = Module._GetAttributeByNum = wasmExports.GetAttributeByNum)(e, t3, r), _ExecGetReturningSlot = Module._ExecGetReturningSlot = (e, t3) => (_ExecGetReturningSlot = Module._ExecGetReturningSlot = wasmExports.ExecGetReturningSlot)(e, t3), _ExecGetResultRelCheckAsUser = Module._ExecGetResultRelCheckAsUser = (e, t3) => (_ExecGetResultRelCheckAsUser = Module._ExecGetResultRelCheckAsUser = wasmExports.ExecGetResultRelCheckAsUser)(e, t3), _MemoryContextRegisterResetCallback = Module._MemoryContextRegisterResetCallback = (e, t3) => (_MemoryContextRegisterResetCallback = Module._MemoryContextRegisterResetCallback = wasmExports.MemoryContextRegisterResetCallback)(e, t3), _cached_function_compile = Module._cached_function_compile = (e, t3, r, a3, o5, _4, s5) => (_cached_function_compile = Module._cached_function_compile = wasmExports.cached_function_compile)(e, t3, r, a3, o5, _4, s5), _InstrUpdateTupleCount = Module._InstrUpdateTupleCount = (e, t3) => (_InstrUpdateTupleCount = Module._InstrUpdateTupleCount = wasmExports.InstrUpdateTupleCount)(e, t3), _tuplesort_begin_heap = Module._tuplesort_begin_heap = (e, t3, r, a3, o5, _4, s5, n3, l2) => (_tuplesort_begin_heap = Module._tuplesort_begin_heap = wasmExports.tuplesort_begin_heap)(e, t3, r, a3, o5, _4, s5, n3, l2), _AggCheckCallContext = Module._AggCheckCallContext = (e, t3) => (_AggCheckCallContext = Module._AggCheckCallContext = wasmExports.AggCheckCallContext)(e, t3), _tuplesort_gettupleslot = Module._tuplesort_gettupleslot = (e, t3, r, a3, o5) => (_tuplesort_gettupleslot = Module._tuplesort_gettupleslot = wasmExports.tuplesort_gettupleslot)(e, t3, r, a3, o5), _bms_del_members = Module._bms_del_members = (e, t3) => (_bms_del_members = Module._bms_del_members = wasmExports.bms_del_members)(e, t3), _AddWaitEventToSet = Module._AddWaitEventToSet = (e, t3, r, a3, o5) => (_AddWaitEventToSet = Module._AddWaitEventToSet = wasmExports.AddWaitEventToSet)(e, t3, r, a3, o5), _GetNumRegisteredWaitEvents = Module._GetNumRegisteredWaitEvents = (e) => (_GetNumRegisteredWaitEvents = Module._GetNumRegisteredWaitEvents = wasmExports.GetNumRegisteredWaitEvents)(e), _tuplestore_clear = Module._tuplestore_clear = (e) => (_tuplestore_clear = Module._tuplestore_clear = wasmExports.tuplestore_clear)(e), _get_attstatsslot = Module._get_attstatsslot = (e, t3, r, a3, o5) => (_get_attstatsslot = Module._get_attstatsslot = wasmExports.get_attstatsslot)(e, t3, r, a3, o5), _free_attstatsslot = Module._free_attstatsslot = (e) => (_free_attstatsslot = Module._free_attstatsslot = wasmExports.free_attstatsslot)(e), _SharedFileSetInit = Module._SharedFileSetInit = (e, t3) => (_SharedFileSetInit = Module._SharedFileSetInit = wasmExports.SharedFileSetInit)(e, t3), _SharedFileSetAttach = Module._SharedFileSetAttach = (e, t3) => (_SharedFileSetAttach = Module._SharedFileSetAttach = wasmExports.SharedFileSetAttach)(e, t3), _tuplesort_reset = Module._tuplesort_reset = (e) => (_tuplesort_reset = Module._tuplesort_reset = wasmExports.tuplesort_reset)(e), _pairingheap_first = Module._pairingheap_first = (e) => (_pairingheap_first = Module._pairingheap_first = wasmExports.pairingheap_first)(e), _bms_nonempty_difference = Module._bms_nonempty_difference = (e, t3) => (_bms_nonempty_difference = Module._bms_nonempty_difference = wasmExports.bms_nonempty_difference)(e, t3), _datum_image_hash = Module._datum_image_hash = (e, t3, r) => (_datum_image_hash = Module._datum_image_hash = wasmExports.datum_image_hash)(e, t3, r), _tuplesort_rescan = Module._tuplesort_rescan = (e) => (_tuplesort_rescan = Module._tuplesort_rescan = wasmExports.tuplesort_rescan)(e), _WinGetPartitionLocalMemory = Module._WinGetPartitionLocalMemory = (e, t3) => (_WinGetPartitionLocalMemory = Module._WinGetPartitionLocalMemory = wasmExports.WinGetPartitionLocalMemory)(e, t3), _WinGetCurrentPosition = Module._WinGetCurrentPosition = (e) => (_WinGetCurrentPosition = Module._WinGetCurrentPosition = wasmExports.WinGetCurrentPosition)(e), _WinGetPartitionRowCount = Module._WinGetPartitionRowCount = (e) => (_WinGetPartitionRowCount = Module._WinGetPartitionRowCount = wasmExports.WinGetPartitionRowCount)(e), _WinGetFuncArgInPartition = Module._WinGetFuncArgInPartition = (e, t3, r, a3, o5, _4, s5) => (_WinGetFuncArgInPartition = Module._WinGetFuncArgInPartition = wasmExports.WinGetFuncArgInPartition)(e, t3, r, a3, o5, _4, s5), _WinGetFuncArgCurrent = Module._WinGetFuncArgCurrent = (e, t3, r) => (_WinGetFuncArgCurrent = Module._WinGetFuncArgCurrent = wasmExports.WinGetFuncArgCurrent)(e, t3, r), _SPI_connect_ext = Module._SPI_connect_ext = (e) => (_SPI_connect_ext = Module._SPI_connect_ext = wasmExports.SPI_connect_ext)(e), _SPI_commit = Module._SPI_commit = () => (_SPI_commit = Module._SPI_commit = wasmExports.SPI_commit)(), _CopyErrorData = Module._CopyErrorData = () => (_CopyErrorData = Module._CopyErrorData = wasmExports.CopyErrorData)(), _FlushErrorState = Module._FlushErrorState = () => (_FlushErrorState = Module._FlushErrorState = wasmExports.FlushErrorState)(), _ReThrowError = Module._ReThrowError = (e) => (_ReThrowError = Module._ReThrowError = wasmExports.ReThrowError)(e), _SPI_commit_and_chain = Module._SPI_commit_and_chain = () => (_SPI_commit_and_chain = Module._SPI_commit_and_chain = wasmExports.SPI_commit_and_chain)(), _SPI_rollback = Module._SPI_rollback = () => (_SPI_rollback = Module._SPI_rollback = wasmExports.SPI_rollback)(), _SPI_rollback_and_chain = Module._SPI_rollback_and_chain = () => (_SPI_rollback_and_chain = Module._SPI_rollback_and_chain = wasmExports.SPI_rollback_and_chain)(), _SPI_freetuptable = Module._SPI_freetuptable = (e) => (_SPI_freetuptable = Module._SPI_freetuptable = wasmExports.SPI_freetuptable)(e), _SPI_execute_extended = Module._SPI_execute_extended = (e, t3) => (_SPI_execute_extended = Module._SPI_execute_extended = wasmExports.SPI_execute_extended)(e, t3), _SPI_execute_plan = Module._SPI_execute_plan = (e, t3, r, a3, o5) => (_SPI_execute_plan = Module._SPI_execute_plan = wasmExports.SPI_execute_plan)(e, t3, r, a3, o5), _SPI_execp = Module._SPI_execp = (e, t3, r, a3) => (_SPI_execp = Module._SPI_execp = wasmExports.SPI_execp)(e, t3, r, a3), _SPI_execute_plan_extended = Module._SPI_execute_plan_extended = (e, t3) => (_SPI_execute_plan_extended = Module._SPI_execute_plan_extended = wasmExports.SPI_execute_plan_extended)(e, t3), _SPI_execute_plan_with_paramlist = Module._SPI_execute_plan_with_paramlist = (e, t3, r, a3) => (_SPI_execute_plan_with_paramlist = Module._SPI_execute_plan_with_paramlist = wasmExports.SPI_execute_plan_with_paramlist)(e, t3, r, a3), _SPI_execute_with_args = Module._SPI_execute_with_args = (e, t3, r, a3, o5, _4, s5) => (_SPI_execute_with_args = Module._SPI_execute_with_args = wasmExports.SPI_execute_with_args)(e, t3, r, a3, o5, _4, s5), _SPI_prepare = Module._SPI_prepare = (e, t3, r) => (_SPI_prepare = Module._SPI_prepare = wasmExports.SPI_prepare)(e, t3, r), _SPI_prepare_extended = Module._SPI_prepare_extended = (e, t3) => (_SPI_prepare_extended = Module._SPI_prepare_extended = wasmExports.SPI_prepare_extended)(e, t3), _SPI_keepplan = Module._SPI_keepplan = (e) => (_SPI_keepplan = Module._SPI_keepplan = wasmExports.SPI_keepplan)(e), _SPI_freeplan = Module._SPI_freeplan = (e) => (_SPI_freeplan = Module._SPI_freeplan = wasmExports.SPI_freeplan)(e), _SPI_copytuple = Module._SPI_copytuple = (e) => (_SPI_copytuple = Module._SPI_copytuple = wasmExports.SPI_copytuple)(e), _SPI_returntuple = Module._SPI_returntuple = (e, t3) => (_SPI_returntuple = Module._SPI_returntuple = wasmExports.SPI_returntuple)(e, t3), _SPI_modifytuple = Module._SPI_modifytuple = (e, t3, r, a3, o5, _4) => (_SPI_modifytuple = Module._SPI_modifytuple = wasmExports.SPI_modifytuple)(e, t3, r, a3, o5, _4), _SPI_fnumber = Module._SPI_fnumber = (e, t3) => (_SPI_fnumber = Module._SPI_fnumber = wasmExports.SPI_fnumber)(e, t3), _SPI_fname = Module._SPI_fname = (e, t3) => (_SPI_fname = Module._SPI_fname = wasmExports.SPI_fname)(e, t3), _SPI_getbinval = Module._SPI_getbinval = (e, t3, r, a3) => (_SPI_getbinval = Module._SPI_getbinval = wasmExports.SPI_getbinval)(e, t3, r, a3), _SPI_gettype = Module._SPI_gettype = (e, t3) => (_SPI_gettype = Module._SPI_gettype = wasmExports.SPI_gettype)(e, t3), _SPI_gettypeid = Module._SPI_gettypeid = (e, t3) => (_SPI_gettypeid = Module._SPI_gettypeid = wasmExports.SPI_gettypeid)(e, t3), _SPI_getrelname = Module._SPI_getrelname = (e) => (_SPI_getrelname = Module._SPI_getrelname = wasmExports.SPI_getrelname)(e), _SPI_palloc = Module._SPI_palloc = (e) => (_SPI_palloc = Module._SPI_palloc = wasmExports.SPI_palloc)(e), _SPI_repalloc = Module._SPI_repalloc = (e, t3) => (_SPI_repalloc = Module._SPI_repalloc = wasmExports.SPI_repalloc)(e, t3), _SPI_pfree = Module._SPI_pfree = (e) => (_SPI_pfree = Module._SPI_pfree = wasmExports.SPI_pfree)(e), _SPI_datumTransfer = Module._SPI_datumTransfer = (e, t3, r) => (_SPI_datumTransfer = Module._SPI_datumTransfer = wasmExports.SPI_datumTransfer)(e, t3, r), _datumTransfer = Module._datumTransfer = (e, t3, r) => (_datumTransfer = Module._datumTransfer = wasmExports.datumTransfer)(e, t3, r), _SPI_cursor_open_with_args = Module._SPI_cursor_open_with_args = (e, t3, r, a3, o5, _4, s5, n3) => (_SPI_cursor_open_with_args = Module._SPI_cursor_open_with_args = wasmExports.SPI_cursor_open_with_args)(e, t3, r, a3, o5, _4, s5, n3), _SPI_cursor_open_with_paramlist = Module._SPI_cursor_open_with_paramlist = (e, t3, r, a3) => (_SPI_cursor_open_with_paramlist = Module._SPI_cursor_open_with_paramlist = wasmExports.SPI_cursor_open_with_paramlist)(e, t3, r, a3), _SPI_cursor_parse_open = Module._SPI_cursor_parse_open = (e, t3, r) => (_SPI_cursor_parse_open = Module._SPI_cursor_parse_open = wasmExports.SPI_cursor_parse_open)(e, t3, r), _SPI_cursor_find = Module._SPI_cursor_find = (e) => (_SPI_cursor_find = Module._SPI_cursor_find = wasmExports.SPI_cursor_find)(e), _SPI_cursor_fetch = Module._SPI_cursor_fetch = (e, t3, r) => (_SPI_cursor_fetch = Module._SPI_cursor_fetch = wasmExports.SPI_cursor_fetch)(e, t3, r), _SPI_scroll_cursor_fetch = Module._SPI_scroll_cursor_fetch = (e, t3, r) => (_SPI_scroll_cursor_fetch = Module._SPI_scroll_cursor_fetch = wasmExports.SPI_scroll_cursor_fetch)(e, t3, r), _SPI_scroll_cursor_move = Module._SPI_scroll_cursor_move = (e, t3, r) => (_SPI_scroll_cursor_move = Module._SPI_scroll_cursor_move = wasmExports.SPI_scroll_cursor_move)(e, t3, r), _SPI_cursor_close = Module._SPI_cursor_close = (e) => (_SPI_cursor_close = Module._SPI_cursor_close = wasmExports.SPI_cursor_close)(e), _SPI_plan_is_valid = Module._SPI_plan_is_valid = (e) => (_SPI_plan_is_valid = Module._SPI_plan_is_valid = wasmExports.SPI_plan_is_valid)(e), _SPI_result_code_string = Module._SPI_result_code_string = (e) => (_SPI_result_code_string = Module._SPI_result_code_string = wasmExports.SPI_result_code_string)(e), _SPI_plan_get_plan_sources = Module._SPI_plan_get_plan_sources = (e) => (_SPI_plan_get_plan_sources = Module._SPI_plan_get_plan_sources = wasmExports.SPI_plan_get_plan_sources)(e), _SPI_plan_get_cached_plan = Module._SPI_plan_get_cached_plan = (e) => (_SPI_plan_get_cached_plan = Module._SPI_plan_get_cached_plan = wasmExports.SPI_plan_get_cached_plan)(e), _SPI_register_relation = Module._SPI_register_relation = (e) => (_SPI_register_relation = Module._SPI_register_relation = wasmExports.SPI_register_relation)(e), _create_queryEnv = Module._create_queryEnv = () => (_create_queryEnv = Module._create_queryEnv = wasmExports.create_queryEnv)(), _register_ENR = Module._register_ENR = (e, t3) => (_register_ENR = Module._register_ENR = wasmExports.register_ENR)(e, t3), _SPI_register_trigger_data = Module._SPI_register_trigger_data = (e) => (_SPI_register_trigger_data = Module._SPI_register_trigger_data = wasmExports.SPI_register_trigger_data)(e), _tuplestore_tuple_count = Module._tuplestore_tuple_count = (e) => (_tuplestore_tuple_count = Module._tuplestore_tuple_count = wasmExports.tuplestore_tuple_count)(e), _GetUserMapping = Module._GetUserMapping = (e, t3) => (_GetUserMapping = Module._GetUserMapping = wasmExports.GetUserMapping)(e, t3), _GetForeignTable = Module._GetForeignTable = (e) => (_GetForeignTable = Module._GetForeignTable = wasmExports.GetForeignTable)(e), _GetForeignColumnOptions = Module._GetForeignColumnOptions = (e, t3) => (_GetForeignColumnOptions = Module._GetForeignColumnOptions = wasmExports.GetForeignColumnOptions)(e, t3), _initClosestMatch = Module._initClosestMatch = (e, t3, r) => (_initClosestMatch = Module._initClosestMatch = wasmExports.initClosestMatch)(e, t3, r), _updateClosestMatch = Module._updateClosestMatch = (e, t3) => (_updateClosestMatch = Module._updateClosestMatch = wasmExports.updateClosestMatch)(e, t3), _getClosestMatch = Module._getClosestMatch = (e) => (_getClosestMatch = Module._getClosestMatch = wasmExports.getClosestMatch)(e), _GetExistingLocalJoinPath = Module._GetExistingLocalJoinPath = (e) => (_GetExistingLocalJoinPath = Module._GetExistingLocalJoinPath = wasmExports.GetExistingLocalJoinPath)(e), _pathkeys_contained_in = Module._pathkeys_contained_in = (e, t3) => (_pathkeys_contained_in = Module._pathkeys_contained_in = wasmExports.pathkeys_contained_in)(e, t3), _bloom_create = Module._bloom_create = (e, t3, r) => (_bloom_create = Module._bloom_create = wasmExports.bloom_create)(e, t3, r), _bloom_free = Module._bloom_free = (e) => (_bloom_free = Module._bloom_free = wasmExports.bloom_free)(e), _bloom_add_element = Module._bloom_add_element = (e, t3, r) => (_bloom_add_element = Module._bloom_add_element = wasmExports.bloom_add_element)(e, t3, r), _bloom_lacks_element = Module._bloom_lacks_element = (e, t3, r) => (_bloom_lacks_element = Module._bloom_lacks_element = wasmExports.bloom_lacks_element)(e, t3, r), _bloom_prop_bits_set = Module._bloom_prop_bits_set = (e) => (_bloom_prop_bits_set = Module._bloom_prop_bits_set = wasmExports.bloom_prop_bits_set)(e), _dshash_create = Module._dshash_create = (e, t3, r) => (_dshash_create = Module._dshash_create = wasmExports.dshash_create)(e, t3, r), _dshash_attach = Module._dshash_attach = (e, t3, r, a3) => (_dshash_attach = Module._dshash_attach = wasmExports.dshash_attach)(e, t3, r, a3), _dshash_detach = Module._dshash_detach = (e) => (_dshash_detach = Module._dshash_detach = wasmExports.dshash_detach)(e), _dshash_destroy = Module._dshash_destroy = (e) => (_dshash_destroy = Module._dshash_destroy = wasmExports.dshash_destroy)(e), _dshash_get_hash_table_handle = Module._dshash_get_hash_table_handle = (e) => (_dshash_get_hash_table_handle = Module._dshash_get_hash_table_handle = wasmExports.dshash_get_hash_table_handle)(e), _dshash_find = Module._dshash_find = (e, t3, r) => (_dshash_find = Module._dshash_find = wasmExports.dshash_find)(e, t3, r), _dshash_find_or_insert = Module._dshash_find_or_insert = (e, t3, r) => (_dshash_find_or_insert = Module._dshash_find_or_insert = wasmExports.dshash_find_or_insert)(e, t3, r), _dshash_delete_key = Module._dshash_delete_key = (e, t3) => (_dshash_delete_key = Module._dshash_delete_key = wasmExports.dshash_delete_key)(e, t3), _dshash_release_lock = Module._dshash_release_lock = (e, t3) => (_dshash_release_lock = Module._dshash_release_lock = wasmExports.dshash_release_lock)(e, t3), _tag_hash = Module._tag_hash = (e, t3) => (_tag_hash = Module._tag_hash = wasmExports.tag_hash)(e, t3), _dshash_seq_init = Module._dshash_seq_init = (e, t3, r) => (_dshash_seq_init = Module._dshash_seq_init = wasmExports.dshash_seq_init)(e, t3, r), _dshash_seq_next = Module._dshash_seq_next = (e) => (_dshash_seq_next = Module._dshash_seq_next = wasmExports.dshash_seq_next)(e), _dshash_seq_term = Module._dshash_seq_term = (e) => (_dshash_seq_term = Module._dshash_seq_term = wasmExports.dshash_seq_term)(e), _dshash_delete_current = Module._dshash_delete_current = (e) => (_dshash_delete_current = Module._dshash_delete_current = wasmExports.dshash_delete_current)(e), _ldexp = Module._ldexp = (e, t3) => (_ldexp = Module._ldexp = wasmExports.ldexp)(e, t3), _pg_b64_enc_len = Module._pg_b64_enc_len = (e) => (_pg_b64_enc_len = Module._pg_b64_enc_len = wasmExports.pg_b64_enc_len)(e), _pg_b64_encode = Module._pg_b64_encode = (e, t3, r, a3) => (_pg_b64_encode = Module._pg_b64_encode = wasmExports.pg_b64_encode)(e, t3, r, a3), _strtol = Module._strtol = (e, t3, r) => (_strtol = Module._strtol = wasmExports.strtol)(e, t3, r), _gai_strerror = Module._gai_strerror = (e) => (_gai_strerror = Module._gai_strerror = wasmExports.gai_strerror)(e), _socket = Module._socket = (e, t3, r) => (_socket = Module._socket = wasmExports.socket)(e, t3, r), _pgl_connect = Module._pgl_connect = (e, t3, r) => (_pgl_connect = Module._pgl_connect = wasmExports.pgl_connect)(e, t3, r), _pgl_send = Module._pgl_send = (e, t3, r, a3) => (_pgl_send = Module._pgl_send = wasmExports.pgl_send)(e, t3, r, a3), _pgl_recv = Module._pgl_recv = (e, t3, r, a3) => (_pgl_recv = Module._pgl_recv = wasmExports.pgl_recv)(e, t3, r, a3), _be_lo_unlink = Module._be_lo_unlink = (e) => (_be_lo_unlink = Module._be_lo_unlink = wasmExports.be_lo_unlink)(e), _text_to_cstring_buffer = Module._text_to_cstring_buffer = (e, t3, r) => (_text_to_cstring_buffer = Module._text_to_cstring_buffer = wasmExports.text_to_cstring_buffer)(e, t3, r), _pg_mb2wchar_with_len = Module._pg_mb2wchar_with_len = (e, t3, r) => (_pg_mb2wchar_with_len = Module._pg_mb2wchar_with_len = wasmExports.pg_mb2wchar_with_len)(e, t3, r), _pg_regcomp = Module._pg_regcomp = (e, t3, r, a3, o5) => (_pg_regcomp = Module._pg_regcomp = wasmExports.pg_regcomp)(e, t3, r, a3, o5), _pg_regerror = Module._pg_regerror = (e, t3, r, a3) => (_pg_regerror = Module._pg_regerror = wasmExports.pg_regerror)(e, t3, r, a3), _strcat = Module._strcat = (e, t3) => (_strcat = Module._strcat = wasmExports.strcat)(e, t3), _pgl_getsockname = Module._pgl_getsockname = (e, t3, r) => (_pgl_getsockname = Module._pgl_getsockname = wasmExports.pgl_getsockname)(e, t3, r), _pgl_setsockopt = Module._pgl_setsockopt = (e, t3, r, a3, o5) => (_pgl_setsockopt = Module._pgl_setsockopt = wasmExports.pgl_setsockopt)(e, t3, r, a3, o5), _pgl_fcntl = Module._pgl_fcntl = (e, t3, r) => (_pgl_fcntl = Module._pgl_fcntl = wasmExports.pgl_fcntl)(e, t3, r), _utime = Module._utime = (e, t3) => (_utime = Module._utime = wasmExports.utime)(e, t3), _pq_buffer_remaining_data = Module._pq_buffer_remaining_data = () => (_pq_buffer_remaining_data = Module._pq_buffer_remaining_data = wasmExports.pq_buffer_remaining_data)(), _pgl_getsockopt = Module._pgl_getsockopt = (e, t3, r, a3, o5) => (_pgl_getsockopt = Module._pgl_getsockopt = wasmExports.pgl_getsockopt)(e, t3, r, a3, o5), _pq_sendtext = Module._pq_sendtext = (e, t3, r) => (_pq_sendtext = Module._pq_sendtext = wasmExports.pq_sendtext)(e, t3, r), _pq_sendfloat4 = Module._pq_sendfloat4 = (e, t3) => (_pq_sendfloat4 = Module._pq_sendfloat4 = wasmExports.pq_sendfloat4)(e, t3), _pq_sendfloat8 = Module._pq_sendfloat8 = (e, t3) => (_pq_sendfloat8 = Module._pq_sendfloat8 = wasmExports.pq_sendfloat8)(e, t3), _pq_begintypsend = Module._pq_begintypsend = (e) => (_pq_begintypsend = Module._pq_begintypsend = wasmExports.pq_begintypsend)(e), _pq_endtypsend = Module._pq_endtypsend = (e) => (_pq_endtypsend = Module._pq_endtypsend = wasmExports.pq_endtypsend)(e), _pq_getmsgfloat4 = Module._pq_getmsgfloat4 = (e) => (_pq_getmsgfloat4 = Module._pq_getmsgfloat4 = wasmExports.pq_getmsgfloat4)(e), _pq_getmsgfloat8 = Module._pq_getmsgfloat8 = (e) => (_pq_getmsgfloat8 = Module._pq_getmsgfloat8 = wasmExports.pq_getmsgfloat8)(e), _pq_getmsgtext = Module._pq_getmsgtext = (e, t3, r) => (_pq_getmsgtext = Module._pq_getmsgtext = wasmExports.pq_getmsgtext)(e, t3, r), _pg_strtoint32 = Module._pg_strtoint32 = (e) => (_pg_strtoint32 = Module._pg_strtoint32 = wasmExports.pg_strtoint32)(e), _main = Module._main = (e, t3) => (_main = Module._main = wasmExports.__main_argc_argv)(e, t3), _pgl_getuid = Module._pgl_getuid = () => (_pgl_getuid = Module._pgl_getuid = wasmExports.pgl_getuid)(), _getenv = Module._getenv = (e) => (_getenv = Module._getenv = wasmExports.getenv)(e), _bms_membership = Module._bms_membership = (e) => (_bms_membership = Module._bms_membership = wasmExports.bms_membership)(e), _RegisterExtensibleNodeMethods = Module._RegisterExtensibleNodeMethods = (e) => (_RegisterExtensibleNodeMethods = Module._RegisterExtensibleNodeMethods = wasmExports.RegisterExtensibleNodeMethods)(e), _list_make5_impl = Module._list_make5_impl = (e, t3, r, a3, o5, _4) => (_list_make5_impl = Module._list_make5_impl = wasmExports.list_make5_impl)(e, t3, r, a3, o5, _4), _GetMemoryChunkContext = Module._GetMemoryChunkContext = (e) => (_GetMemoryChunkContext = Module._GetMemoryChunkContext = wasmExports.GetMemoryChunkContext)(e), _list_insert_nth = Module._list_insert_nth = (e, t3, r) => (_list_insert_nth = Module._list_insert_nth = wasmExports.list_insert_nth)(e, t3, r), _list_member_ptr = Module._list_member_ptr = (e, t3) => (_list_member_ptr = Module._list_member_ptr = wasmExports.list_member_ptr)(e, t3), _list_append_unique_ptr = Module._list_append_unique_ptr = (e, t3) => (_list_append_unique_ptr = Module._list_append_unique_ptr = wasmExports.list_append_unique_ptr)(e, t3), _make_opclause = Module._make_opclause = (e, t3, r, a3, o5, _4, s5) => (_make_opclause = Module._make_opclause = wasmExports.make_opclause)(e, t3, r, a3, o5, _4, s5), _exprIsLengthCoercion = Module._exprIsLengthCoercion = (e, t3) => (_exprIsLengthCoercion = Module._exprIsLengthCoercion = wasmExports.exprIsLengthCoercion)(e, t3), _fix_opfuncids = Module._fix_opfuncids = (e) => (_fix_opfuncids = Module._fix_opfuncids = wasmExports.fix_opfuncids)(e), _outToken = Module._outToken = (e, t3) => (_outToken = Module._outToken = wasmExports.outToken)(e, t3), _outNode = Module._outNode = (e, t3) => (_outNode = Module._outNode = wasmExports.outNode)(e, t3), _appendStringInfoStringQuoted = Module._appendStringInfoStringQuoted = (e, t3, r) => (_appendStringInfoStringQuoted = Module._appendStringInfoStringQuoted = wasmExports.appendStringInfoStringQuoted)(e, t3, r), _EnableQueryId = Module._EnableQueryId = () => (_EnableQueryId = Module._EnableQueryId = wasmExports.EnableQueryId)(), _nodeRead = Module._nodeRead = (e, t3) => (_nodeRead = Module._nodeRead = wasmExports.nodeRead)(e, t3), _pg_strtok = Module._pg_strtok = (e) => (_pg_strtok = Module._pg_strtok = wasmExports.pg_strtok)(e), _debackslash = Module._debackslash = (e, t3) => (_debackslash = Module._debackslash = wasmExports.debackslash)(e, t3), _exp2 = Module._exp2 = (e) => (_exp2 = Module._exp2 = wasmExports.exp2)(e), _find_base_rel = Module._find_base_rel = (e, t3) => (_find_base_rel = Module._find_base_rel = wasmExports.find_base_rel)(e, t3), _add_path = Module._add_path = (e, t3) => (_add_path = Module._add_path = wasmExports.add_path)(e, t3), _create_sort_path = Module._create_sort_path = (e, t3, r, a3, o5) => (_create_sort_path = Module._create_sort_path = wasmExports.create_sort_path)(e, t3, r, a3, o5), _set_baserel_size_estimates = Module._set_baserel_size_estimates = (e, t3) => (_set_baserel_size_estimates = Module._set_baserel_size_estimates = wasmExports.set_baserel_size_estimates)(e, t3), _get_func_support = Module._get_func_support = (e) => (_get_func_support = Module._get_func_support = wasmExports.get_func_support)(e), _clauselist_selectivity = Module._clauselist_selectivity = (e, t3, r, a3, o5) => (_clauselist_selectivity = Module._clauselist_selectivity = wasmExports.clauselist_selectivity)(e, t3, r, a3, o5), _get_tablespace_page_costs = Module._get_tablespace_page_costs = (e, t3, r) => (_get_tablespace_page_costs = Module._get_tablespace_page_costs = wasmExports.get_tablespace_page_costs)(e, t3, r), _cost_qual_eval = Module._cost_qual_eval = (e, t3, r) => (_cost_qual_eval = Module._cost_qual_eval = wasmExports.cost_qual_eval)(e, t3, r), _pull_varnos = Module._pull_varnos = (e, t3) => (_pull_varnos = Module._pull_varnos = wasmExports.pull_varnos)(e, t3), _estimate_num_groups = Module._estimate_num_groups = (e, t3, r, a3, o5) => (_estimate_num_groups = Module._estimate_num_groups = wasmExports.estimate_num_groups)(e, t3, r, a3, o5), _cost_sort = Module._cost_sort = (e, t3, r, a3, o5, _4, s5, n3, l2, d3) => (_cost_sort = Module._cost_sort = wasmExports.cost_sort)(e, t3, r, a3, o5, _4, s5, n3, l2, d3), _get_sortgrouplist_exprs = Module._get_sortgrouplist_exprs = (e, t3) => (_get_sortgrouplist_exprs = Module._get_sortgrouplist_exprs = wasmExports.get_sortgrouplist_exprs)(e, t3), _make_restrictinfo = Module._make_restrictinfo = (e, t3, r, a3, o5, _4, s5, n3, l2, d3) => (_make_restrictinfo = Module._make_restrictinfo = wasmExports.make_restrictinfo)(e, t3, r, a3, o5, _4, s5, n3, l2, d3), _setup_eclass_member_iterator = Module._setup_eclass_member_iterator = (e, t3, r) => (_setup_eclass_member_iterator = Module._setup_eclass_member_iterator = wasmExports.setup_eclass_member_iterator)(e, t3, r), _eclass_member_iterator_next = Module._eclass_member_iterator_next = (e) => (_eclass_member_iterator_next = Module._eclass_member_iterator_next = wasmExports.eclass_member_iterator_next)(e), _remove_nulling_relids = Module._remove_nulling_relids = (e, t3, r) => (_remove_nulling_relids = Module._remove_nulling_relids = wasmExports.remove_nulling_relids)(e, t3, r), _get_mergejoin_opfamilies = Module._get_mergejoin_opfamilies = (e) => (_get_mergejoin_opfamilies = Module._get_mergejoin_opfamilies = wasmExports.get_mergejoin_opfamilies)(e), _generate_implied_equalities_for_column = Module._generate_implied_equalities_for_column = (e, t3, r, a3, o5) => (_generate_implied_equalities_for_column = Module._generate_implied_equalities_for_column = wasmExports.generate_implied_equalities_for_column)(e, t3, r, a3, o5), _eclass_useful_for_merging = Module._eclass_useful_for_merging = (e, t3, r) => (_eclass_useful_for_merging = Module._eclass_useful_for_merging = wasmExports.eclass_useful_for_merging)(e, t3, r), _join_clause_is_movable_to = Module._join_clause_is_movable_to = (e, t3) => (_join_clause_is_movable_to = Module._join_clause_is_movable_to = wasmExports.join_clause_is_movable_to)(e, t3), _get_plan_rowmark = Module._get_plan_rowmark = (e, t3) => (_get_plan_rowmark = Module._get_plan_rowmark = wasmExports.get_plan_rowmark)(e, t3), _is_pseudo_constant_for_index = Module._is_pseudo_constant_for_index = (e, t3, r) => (_is_pseudo_constant_for_index = Module._is_pseudo_constant_for_index = wasmExports.is_pseudo_constant_for_index)(e, t3, r), _update_mergeclause_eclasses = Module._update_mergeclause_eclasses = (e, t3) => (_update_mergeclause_eclasses = Module._update_mergeclause_eclasses = wasmExports.update_mergeclause_eclasses)(e, t3), _pull_vars_of_level = Module._pull_vars_of_level = (e, t3) => (_pull_vars_of_level = Module._pull_vars_of_level = wasmExports.pull_vars_of_level)(e, t3), _find_join_rel = Module._find_join_rel = (e, t3) => (_find_join_rel = Module._find_join_rel = wasmExports.find_join_rel)(e, t3), _make_canonical_pathkey = Module._make_canonical_pathkey = (e, t3, r, a3, o5) => (_make_canonical_pathkey = Module._make_canonical_pathkey = wasmExports.make_canonical_pathkey)(e, t3, r, a3, o5), _get_sortgroupref_clause_noerr = Module._get_sortgroupref_clause_noerr = (e, t3) => (_get_sortgroupref_clause_noerr = Module._get_sortgroupref_clause_noerr = wasmExports.get_sortgroupref_clause_noerr)(e, t3), _extract_actual_clauses = Module._extract_actual_clauses = (e, t3) => (_extract_actual_clauses = Module._extract_actual_clauses = wasmExports.extract_actual_clauses)(e, t3), _tlist_member = Module._tlist_member = (e, t3) => (_tlist_member = Module._tlist_member = wasmExports.tlist_member)(e, t3), _change_plan_targetlist = Module._change_plan_targetlist = (e, t3, r) => (_change_plan_targetlist = Module._change_plan_targetlist = wasmExports.change_plan_targetlist)(e, t3, r), _make_foreignscan = Module._make_foreignscan = (e, t3, r, a3, o5, _4, s5, n3) => (_make_foreignscan = Module._make_foreignscan = wasmExports.make_foreignscan)(e, t3, r, a3, o5, _4, s5, n3), _IncrementVarSublevelsUp = Module._IncrementVarSublevelsUp = (e, t3, r) => (_IncrementVarSublevelsUp = Module._IncrementVarSublevelsUp = wasmExports.IncrementVarSublevelsUp)(e, t3, r), _op_mergejoinable = Module._op_mergejoinable = (e, t3) => (_op_mergejoinable = Module._op_mergejoinable = wasmExports.op_mergejoinable)(e, t3), _find_nonnullable_rels = Module._find_nonnullable_rels = (e) => (_find_nonnullable_rels = Module._find_nonnullable_rels = wasmExports.find_nonnullable_rels)(e), _standard_planner = Module._standard_planner = (e, t3, r, a3) => (_standard_planner = Module._standard_planner = wasmExports.standard_planner)(e, t3, r, a3), _get_relids_in_jointree = Module._get_relids_in_jointree = (e, t3, r) => (_get_relids_in_jointree = Module._get_relids_in_jointree = wasmExports.get_relids_in_jointree)(e, t3, r), _SS_process_sublinks = Module._SS_process_sublinks = (e, t3, r) => (_SS_process_sublinks = Module._SS_process_sublinks = wasmExports.SS_process_sublinks)(e, t3, r), _add_new_columns_to_pathtarget = Module._add_new_columns_to_pathtarget = (e, t3) => (_add_new_columns_to_pathtarget = Module._add_new_columns_to_pathtarget = wasmExports.add_new_columns_to_pathtarget)(e, t3), _get_agg_clause_costs = Module._get_agg_clause_costs = (e, t3, r) => (_get_agg_clause_costs = Module._get_agg_clause_costs = wasmExports.get_agg_clause_costs)(e, t3, r), _grouping_is_sortable = Module._grouping_is_sortable = (e) => (_grouping_is_sortable = Module._grouping_is_sortable = wasmExports.grouping_is_sortable)(e), _copy_pathtarget = Module._copy_pathtarget = (e) => (_copy_pathtarget = Module._copy_pathtarget = wasmExports.copy_pathtarget)(e), _create_projection_path = Module._create_projection_path = (e, t3, r, a3) => (_create_projection_path = Module._create_projection_path = wasmExports.create_projection_path)(e, t3, r, a3), _contain_nonstrict_functions = Module._contain_nonstrict_functions = (e) => (_contain_nonstrict_functions = Module._contain_nonstrict_functions = wasmExports.contain_nonstrict_functions)(e), _get_translated_update_targetlist = Module._get_translated_update_targetlist = (e, t3, r, a3) => (_get_translated_update_targetlist = Module._get_translated_update_targetlist = wasmExports.get_translated_update_targetlist)(e, t3, r, a3), _add_row_identity_var = Module._add_row_identity_var = (e, t3, r, a3) => (_add_row_identity_var = Module._add_row_identity_var = wasmExports.add_row_identity_var)(e, t3, r, a3), _get_rel_all_updated_cols = Module._get_rel_all_updated_cols = (e, t3) => (_get_rel_all_updated_cols = Module._get_rel_all_updated_cols = wasmExports.get_rel_all_updated_cols)(e, t3), _get_baserel_parampathinfo = Module._get_baserel_parampathinfo = (e, t3, r) => (_get_baserel_parampathinfo = Module._get_baserel_parampathinfo = wasmExports.get_baserel_parampathinfo)(e, t3, r), _create_foreignscan_path = Module._create_foreignscan_path = (e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4) => (_create_foreignscan_path = Module._create_foreignscan_path = wasmExports.create_foreignscan_path)(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4), _create_foreign_join_path = Module._create_foreign_join_path = (e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4) => (_create_foreign_join_path = Module._create_foreign_join_path = wasmExports.create_foreign_join_path)(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4), _create_foreign_upper_path = Module._create_foreign_upper_path = (e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3) => (_create_foreign_upper_path = Module._create_foreign_upper_path = wasmExports.create_foreign_upper_path)(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3), _adjust_limit_rows_costs = Module._adjust_limit_rows_costs = (e, t3, r, a3, o5) => (_adjust_limit_rows_costs = Module._adjust_limit_rows_costs = wasmExports.adjust_limit_rows_costs)(e, t3, r, a3, o5), _add_to_flat_tlist = Module._add_to_flat_tlist = (e, t3) => (_add_to_flat_tlist = Module._add_to_flat_tlist = wasmExports.add_to_flat_tlist)(e, t3), _get_fn_expr_variadic = Module._get_fn_expr_variadic = (e) => (_get_fn_expr_variadic = Module._get_fn_expr_variadic = wasmExports.get_fn_expr_variadic)(e), _get_fn_expr_argtype = Module._get_fn_expr_argtype = (e, t3) => (_get_fn_expr_argtype = Module._get_fn_expr_argtype = wasmExports.get_fn_expr_argtype)(e, t3), _on_shmem_exit = Module._on_shmem_exit = (e, t3) => (_on_shmem_exit = Module._on_shmem_exit = wasmExports.on_shmem_exit)(e, t3), _pgl_shmdt = Module._pgl_shmdt = (e) => (_pgl_shmdt = Module._pgl_shmdt = wasmExports.pgl_shmdt)(e), _pgl_shmctl = Module._pgl_shmctl = (e, t3, r) => (_pgl_shmctl = Module._pgl_shmctl = wasmExports.pgl_shmctl)(e, t3, r), _pgl_shmat = Module._pgl_shmat = (e, t3, r) => (_pgl_shmat = Module._pgl_shmat = wasmExports.pgl_shmat)(e, t3, r), _mmap = Module._mmap = (e, t3, r, a3, o5, _4) => (_mmap = Module._mmap = wasmExports.mmap)(e, t3, r, a3, o5, _4), _pgl_shmget = Module._pgl_shmget = (e, t3, r) => (_pgl_shmget = Module._pgl_shmget = wasmExports.pgl_shmget)(e, t3, r), _pgl_munmap = Module._pgl_munmap = (e, t3) => (_pgl_munmap = Module._pgl_munmap = wasmExports.pgl_munmap)(e, t3), _SignalHandlerForConfigReload = Module._SignalHandlerForConfigReload = (e) => (_SignalHandlerForConfigReload = Module._SignalHandlerForConfigReload = wasmExports.SignalHandlerForConfigReload)(e), _SignalHandlerForShutdownRequest = Module._SignalHandlerForShutdownRequest = (e) => (_SignalHandlerForShutdownRequest = Module._SignalHandlerForShutdownRequest = wasmExports.SignalHandlerForShutdownRequest)(e), _procsignal_sigusr1_handler = Module._procsignal_sigusr1_handler = (e) => (_procsignal_sigusr1_handler = Module._procsignal_sigusr1_handler = wasmExports.procsignal_sigusr1_handler)(e), _RegisterBackgroundWorker = Module._RegisterBackgroundWorker = (e) => (_RegisterBackgroundWorker = Module._RegisterBackgroundWorker = wasmExports.RegisterBackgroundWorker)(e), _WaitForBackgroundWorkerStartup = Module._WaitForBackgroundWorkerStartup = (e, t3) => (_WaitForBackgroundWorkerStartup = Module._WaitForBackgroundWorkerStartup = wasmExports.WaitForBackgroundWorkerStartup)(e, t3), _open = Module._open = (e, t3, r) => (_open = Module._open = wasmExports.open)(e, t3, r), _rename = Module._rename = (e, t3) => (_rename = Module._rename = wasmExports.rename)(e, t3), _GetConfigOption = Module._GetConfigOption = (e, t3, r) => (_GetConfigOption = Module._GetConfigOption = wasmExports.GetConfigOption)(e, t3, r), _puts = Module._puts = (e) => (_puts = Module._puts = wasmExports.puts)(e), _fopen = Module._fopen = (e, t3) => (_fopen = Module._fopen = wasmExports.fopen)(e, t3), _fclose = Module._fclose = (e) => (_fclose = Module._fclose = wasmExports.fclose)(e), _fputc = Module._fputc = (e, t3) => (_fputc = Module._fputc = wasmExports.fputc)(e, t3), _ftello = Module._ftello = (e) => (_ftello = Module._ftello = wasmExports.ftello)(e), _malloc = Module._malloc = (e) => (_malloc = Module._malloc = wasmExports.malloc)(e), _free = Module._free = (e) => (_free = Module._free = wasmExports.free)(e), _realloc = Module._realloc = (e, t3) => (_realloc = Module._realloc = wasmExports.realloc)(e, t3), _iswprint_l = Module._iswprint_l = (e, t3) => (_iswprint_l = Module._iswprint_l = wasmExports.iswprint_l)(e, t3), _iswalpha_l = Module._iswalpha_l = (e, t3) => (_iswalpha_l = Module._iswalpha_l = wasmExports.iswalpha_l)(e, t3), _iswdigit_l = Module._iswdigit_l = (e, t3) => (_iswdigit_l = Module._iswdigit_l = wasmExports.iswdigit_l)(e, t3), _isdigit_l = Module._isdigit_l = (e, t3) => (_isdigit_l = Module._isdigit_l = wasmExports.isdigit_l)(e, t3), _iswpunct_l = Module._iswpunct_l = (e, t3) => (_iswpunct_l = Module._iswpunct_l = wasmExports.iswpunct_l)(e, t3), _iswspace_l = Module._iswspace_l = (e, t3) => (_iswspace_l = Module._iswspace_l = wasmExports.iswspace_l)(e, t3), _iswlower_l = Module._iswlower_l = (e, t3) => (_iswlower_l = Module._iswlower_l = wasmExports.iswlower_l)(e, t3), _iswupper_l = Module._iswupper_l = (e, t3) => (_iswupper_l = Module._iswupper_l = wasmExports.iswupper_l)(e, t3), _pg_ascii_tolower = Module._pg_ascii_tolower = (e) => (_pg_ascii_tolower = Module._pg_ascii_tolower = wasmExports.pg_ascii_tolower)(e), _towlower_l = Module._towlower_l = (e, t3) => (_towlower_l = Module._towlower_l = wasmExports.towlower_l)(e, t3), _tolower_l = Module._tolower_l = (e, t3) => (_tolower_l = Module._tolower_l = wasmExports.tolower_l)(e, t3), _towupper_l = Module._towupper_l = (e, t3) => (_towupper_l = Module._towupper_l = wasmExports.towupper_l)(e, t3), _toupper_l = Module._toupper_l = (e, t3) => (_toupper_l = Module._toupper_l = wasmExports.toupper_l)(e, t3), _pg_reg_getinitialstate = Module._pg_reg_getinitialstate = (e) => (_pg_reg_getinitialstate = Module._pg_reg_getinitialstate = wasmExports.pg_reg_getinitialstate)(e), _pg_reg_getfinalstate = Module._pg_reg_getfinalstate = (e) => (_pg_reg_getfinalstate = Module._pg_reg_getfinalstate = wasmExports.pg_reg_getfinalstate)(e), _pg_reg_getnumoutarcs = Module._pg_reg_getnumoutarcs = (e, t3) => (_pg_reg_getnumoutarcs = Module._pg_reg_getnumoutarcs = wasmExports.pg_reg_getnumoutarcs)(e, t3), _pg_reg_getoutarcs = Module._pg_reg_getoutarcs = (e, t3, r, a3) => (_pg_reg_getoutarcs = Module._pg_reg_getoutarcs = wasmExports.pg_reg_getoutarcs)(e, t3, r, a3), _pg_reg_getnumcolors = Module._pg_reg_getnumcolors = (e) => (_pg_reg_getnumcolors = Module._pg_reg_getnumcolors = wasmExports.pg_reg_getnumcolors)(e), _pg_reg_colorisbegin = Module._pg_reg_colorisbegin = (e, t3) => (_pg_reg_colorisbegin = Module._pg_reg_colorisbegin = wasmExports.pg_reg_colorisbegin)(e, t3), _pg_reg_colorisend = Module._pg_reg_colorisend = (e, t3) => (_pg_reg_colorisend = Module._pg_reg_colorisend = wasmExports.pg_reg_colorisend)(e, t3), _pg_reg_getnumcharacters = Module._pg_reg_getnumcharacters = (e, t3) => (_pg_reg_getnumcharacters = Module._pg_reg_getnumcharacters = wasmExports.pg_reg_getnumcharacters)(e, t3), _pg_reg_getcharacters = Module._pg_reg_getcharacters = (e, t3, r, a3) => (_pg_reg_getcharacters = Module._pg_reg_getcharacters = wasmExports.pg_reg_getcharacters)(e, t3, r, a3), _dsa_pin = Module._dsa_pin = (e) => (_dsa_pin = Module._dsa_pin = wasmExports.dsa_pin)(e), _OutputPluginPrepareWrite = Module._OutputPluginPrepareWrite = (e, t3) => (_OutputPluginPrepareWrite = Module._OutputPluginPrepareWrite = wasmExports.OutputPluginPrepareWrite)(e, t3), _OutputPluginWrite = Module._OutputPluginWrite = (e, t3) => (_OutputPluginWrite = Module._OutputPluginWrite = wasmExports.OutputPluginWrite)(e, t3), _array_contains_nulls = Module._array_contains_nulls = (e) => (_array_contains_nulls = Module._array_contains_nulls = wasmExports.array_contains_nulls)(e), _CacheRegisterRelcacheCallback = Module._CacheRegisterRelcacheCallback = (e, t3) => (_CacheRegisterRelcacheCallback = Module._CacheRegisterRelcacheCallback = wasmExports.CacheRegisterRelcacheCallback)(e, t3), _hash_seq_term = Module._hash_seq_term = (e) => (_hash_seq_term = Module._hash_seq_term = wasmExports.hash_seq_term)(e), _FreeErrorData = Module._FreeErrorData = (e) => (_FreeErrorData = Module._FreeErrorData = wasmExports.FreeErrorData)(e), _RelidByRelfilenumber = Module._RelidByRelfilenumber = (e, t3) => (_RelidByRelfilenumber = Module._RelidByRelfilenumber = wasmExports.RelidByRelfilenumber)(e, t3), _SnapBuildRestoreSnapshot = Module._SnapBuildRestoreSnapshot = (e, t3, r, a3) => (_SnapBuildRestoreSnapshot = Module._SnapBuildRestoreSnapshot = wasmExports.SnapBuildRestoreSnapshot)(e, t3, r, a3), _WaitLatchOrSocket = Module._WaitLatchOrSocket = (e, t3, r, a3, o5) => (_WaitLatchOrSocket = Module._WaitLatchOrSocket = wasmExports.WaitLatchOrSocket)(e, t3, r, a3, o5), _BufFileCreateFileSet = Module._BufFileCreateFileSet = (e, t3) => (_BufFileCreateFileSet = Module._BufFileCreateFileSet = wasmExports.BufFileCreateFileSet)(e, t3), _BufFileOpenFileSet = Module._BufFileOpenFileSet = (e, t3, r, a3) => (_BufFileOpenFileSet = Module._BufFileOpenFileSet = wasmExports.BufFileOpenFileSet)(e, t3, r, a3), _BufFileTell = Module._BufFileTell = (e, t3, r) => (_BufFileTell = Module._BufFileTell = wasmExports.BufFileTell)(e, t3, r), _ConditionVariablePrepareToSleep = Module._ConditionVariablePrepareToSleep = (e) => (_ConditionVariablePrepareToSleep = Module._ConditionVariablePrepareToSleep = wasmExports.ConditionVariablePrepareToSleep)(e), _get_row_security_policies = Module._get_row_security_policies = (e, t3, r, a3, o5, _4, s5) => (_get_row_security_policies = Module._get_row_security_policies = wasmExports.get_row_security_policies)(e, t3, r, a3, o5, _4, s5), _extract_variadic_args = Module._extract_variadic_args = (e, t3, r, a3, o5, _4) => (_extract_variadic_args = Module._extract_variadic_args = wasmExports.extract_variadic_args)(e, t3, r, a3, o5, _4), _errhidestmt = Module._errhidestmt = (e) => (_errhidestmt = Module._errhidestmt = wasmExports.errhidestmt)(e), _hash_estimate_size = Module._hash_estimate_size = (e, t3) => (_hash_estimate_size = Module._hash_estimate_size = wasmExports.hash_estimate_size)(e, t3), _ShmemInitHash = Module._ShmemInitHash = (e, t3, r, a3, o5) => (_ShmemInitHash = Module._ShmemInitHash = wasmExports.ShmemInitHash)(e, t3, r, a3, o5), _LockBufHdr = Module._LockBufHdr = (e) => (_LockBufHdr = Module._LockBufHdr = wasmExports.LockBufHdr)(e), _EvictUnpinnedBuffer = Module._EvictUnpinnedBuffer = (e, t3) => (_EvictUnpinnedBuffer = Module._EvictUnpinnedBuffer = wasmExports.EvictUnpinnedBuffer)(e, t3), _EvictAllUnpinnedBuffers = Module._EvictAllUnpinnedBuffers = (e, t3, r) => (_EvictAllUnpinnedBuffers = Module._EvictAllUnpinnedBuffers = wasmExports.EvictAllUnpinnedBuffers)(e, t3, r), _EvictRelUnpinnedBuffers = Module._EvictRelUnpinnedBuffers = (e, t3, r, a3) => (_EvictRelUnpinnedBuffers = Module._EvictRelUnpinnedBuffers = wasmExports.EvictRelUnpinnedBuffers)(e, t3, r, a3), _have_free_buffer = Module._have_free_buffer = () => (_have_free_buffer = Module._have_free_buffer = wasmExports.have_free_buffer)(), _calloc = Module._calloc = (e, t3) => (_calloc = Module._calloc = wasmExports.calloc)(e, t3), _BufFileExportFileSet = Module._BufFileExportFileSet = (e) => (_BufFileExportFileSet = Module._BufFileExportFileSet = wasmExports.BufFileExportFileSet)(e), _copy_file = Module._copy_file = (e, t3) => (_copy_file = Module._copy_file = wasmExports.copy_file)(e, t3), _fdatasync = Module._fdatasync = (e) => (_fdatasync = Module._fdatasync = wasmExports.fdatasync)(e), _truncate = Module._truncate = (e, t3) => (_truncate = Module._truncate = wasmExports.truncate)(e, t3), _dup = Module._dup = (e) => (_dup = Module._dup = wasmExports.dup)(e), _AcquireExternalFD = Module._AcquireExternalFD = () => (_AcquireExternalFD = Module._AcquireExternalFD = wasmExports.AcquireExternalFD)(), _mkdir = Module._mkdir = (e, t3) => (_mkdir = Module._mkdir = wasmExports.mkdir)(e, t3), _pgl_popen = Module._pgl_popen = (e, t3) => (_pgl_popen = Module._pgl_popen = wasmExports.pgl_popen)(e, t3), _pgl_pclose = Module._pgl_pclose = (e) => (_pgl_pclose = Module._pgl_pclose = wasmExports.pgl_pclose)(e), _closedir = Module._closedir = (e) => (_closedir = Module._closedir = wasmExports.closedir)(e), _opendir = Module._opendir = (e) => (_opendir = Module._opendir = wasmExports.opendir)(e), _readdir = Module._readdir = (e) => (_readdir = Module._readdir = wasmExports.readdir)(e), _GetNamedDSMSegment = Module._GetNamedDSMSegment = (e, t3, r, a3) => (_GetNamedDSMSegment = Module._GetNamedDSMSegment = wasmExports.GetNamedDSMSegment)(e, t3, r, a3), _pgl_atexit = Module._pgl_atexit = (e) => (_pgl_atexit = Module._pgl_atexit = wasmExports.pgl_atexit)(e), _RequestAddinShmemSpace = Module._RequestAddinShmemSpace = (e) => (_RequestAddinShmemSpace = Module._RequestAddinShmemSpace = wasmExports.RequestAddinShmemSpace)(e), _GetRunningTransactionData = Module._GetRunningTransactionData = () => (_GetRunningTransactionData = Module._GetRunningTransactionData = wasmExports.GetRunningTransactionData)(), _BackendXidGetPid = Module._BackendXidGetPid = (e) => (_BackendXidGetPid = Module._BackendXidGetPid = wasmExports.BackendXidGetPid)(e), _pg_numa_init = Module._pg_numa_init = () => (_pg_numa_init = Module._pg_numa_init = wasmExports.pg_numa_init)(), _sysconf = Module._sysconf = (e) => (_sysconf = Module._sysconf = wasmExports.sysconf)(e), _pg_numa_query_pages = Module._pg_numa_query_pages = (e, t3, r, a3) => (_pg_numa_query_pages = Module._pg_numa_query_pages = wasmExports.pg_numa_query_pages)(e, t3, r, a3), _pg_get_shmem_pagesize = Module._pg_get_shmem_pagesize = () => (_pg_get_shmem_pagesize = Module._pg_get_shmem_pagesize = wasmExports.pg_get_shmem_pagesize)(), _pgl_poll = Module._pgl_poll = (e, t3, r) => (_pgl_poll = Module._pgl_poll = wasmExports.pgl_poll)(e, t3, r), _GetLockmodeName = Module._GetLockmodeName = (e, t3) => (_GetLockmodeName = Module._GetLockmodeName = wasmExports.GetLockmodeName)(e, t3), _LWLockRegisterTranche = Module._LWLockRegisterTranche = (e, t3) => (_LWLockRegisterTranche = Module._LWLockRegisterTranche = wasmExports.LWLockRegisterTranche)(e, t3), _GetNamedLWLockTranche = Module._GetNamedLWLockTranche = (e) => (_GetNamedLWLockTranche = Module._GetNamedLWLockTranche = wasmExports.GetNamedLWLockTranche)(e), _LWLockNewTrancheId = Module._LWLockNewTrancheId = () => (_LWLockNewTrancheId = Module._LWLockNewTrancheId = wasmExports.LWLockNewTrancheId)(), _RequestNamedLWLockTranche = Module._RequestNamedLWLockTranche = (e, t3) => (_RequestNamedLWLockTranche = Module._RequestNamedLWLockTranche = wasmExports.RequestNamedLWLockTranche)(e, t3), _LWLockHeldByMe = Module._LWLockHeldByMe = (e) => (_LWLockHeldByMe = Module._LWLockHeldByMe = wasmExports.LWLockHeldByMe)(e), _ProcessStartupPacket = Module._ProcessStartupPacket = (e, t3, r) => (_ProcessStartupPacket = Module._ProcessStartupPacket = wasmExports.ProcessStartupPacket)(e, t3, r), _htons = (e) => (_htons = wasmExports.htons)(e), _htonl = (e) => (_htonl = wasmExports.htonl)(e), _pgl_startPGlite = Module._pgl_startPGlite = () => (_pgl_startPGlite = Module._pgl_startPGlite = wasmExports.pgl_startPGlite)(), _pgl_pq_flush = Module._pgl_pq_flush = () => (_pgl_pq_flush = Module._pgl_pq_flush = wasmExports.pgl_pq_flush)(), _pgl_getMyProcPort = Module._pgl_getMyProcPort = () => (_pgl_getMyProcPort = Module._pgl_getMyProcPort = wasmExports.pgl_getMyProcPort)(), _pgl_sendConnData = Module._pgl_sendConnData = () => (_pgl_sendConnData = Module._pgl_sendConnData = wasmExports.pgl_sendConnData)(), _PostgresMainLongJmp = Module._PostgresMainLongJmp = () => (_PostgresMainLongJmp = Module._PostgresMainLongJmp = wasmExports.PostgresMainLongJmp)(), _PostgresMainLoopOnce = Module._PostgresMainLoopOnce = () => (_PostgresMainLoopOnce = Module._PostgresMainLoopOnce = wasmExports.PostgresMainLoopOnce)(), _PostgresSendReadyForQueryIfNecessary = Module._PostgresSendReadyForQueryIfNecessary = () => (_PostgresSendReadyForQueryIfNecessary = Module._PostgresSendReadyForQueryIfNecessary = wasmExports.PostgresSendReadyForQueryIfNecessary)(), _standard_ProcessUtility = Module._standard_ProcessUtility = (e, t3, r, a3, o5, _4, s5, n3) => (_standard_ProcessUtility = Module._standard_ProcessUtility = wasmExports.standard_ProcessUtility)(e, t3, r, a3, o5, _4, s5, n3), _lookup_ts_dictionary_cache = Module._lookup_ts_dictionary_cache = (e) => (_lookup_ts_dictionary_cache = Module._lookup_ts_dictionary_cache = wasmExports.lookup_ts_dictionary_cache)(e), _get_tsearch_config_filename = Module._get_tsearch_config_filename = (e, t3) => (_get_tsearch_config_filename = Module._get_tsearch_config_filename = wasmExports.get_tsearch_config_filename)(e, t3), _str_tolower = Module._str_tolower = (e, t3, r) => (_str_tolower = Module._str_tolower = wasmExports.str_tolower)(e, t3, r), _readstoplist = Module._readstoplist = (e, t3, r) => (_readstoplist = Module._readstoplist = wasmExports.readstoplist)(e, t3, r), _searchstoplist = Module._searchstoplist = (e, t3) => (_searchstoplist = Module._searchstoplist = wasmExports.searchstoplist)(e, t3), _tsearch_readline_begin = Module._tsearch_readline_begin = (e, t3) => (_tsearch_readline_begin = Module._tsearch_readline_begin = wasmExports.tsearch_readline_begin)(e, t3), _tsearch_readline = Module._tsearch_readline = (e) => (_tsearch_readline = Module._tsearch_readline = wasmExports.tsearch_readline)(e), _tsearch_readline_end = Module._tsearch_readline_end = (e) => (_tsearch_readline_end = Module._tsearch_readline_end = wasmExports.tsearch_readline_end)(e), _stringToQualifiedNameList = Module._stringToQualifiedNameList = (e, t3) => (_stringToQualifiedNameList = Module._stringToQualifiedNameList = wasmExports.stringToQualifiedNameList)(e, t3), _to_tsvector_byid = Module._to_tsvector_byid = (e) => (_to_tsvector_byid = Module._to_tsvector_byid = wasmExports.to_tsvector_byid)(e), _t_isalnum_with_len = Module._t_isalnum_with_len = (e, t3) => (_t_isalnum_with_len = Module._t_isalnum_with_len = wasmExports.t_isalnum_with_len)(e, t3), _isalnum = Module._isalnum = (e) => (_isalnum = Module._isalnum = wasmExports.isalnum)(e), _t_isalnum_cstr = Module._t_isalnum_cstr = (e) => (_t_isalnum_cstr = Module._t_isalnum_cstr = wasmExports.t_isalnum_cstr)(e), _pg_mblen_unbounded = Module._pg_mblen_unbounded = (e) => (_pg_mblen_unbounded = Module._pg_mblen_unbounded = wasmExports.pg_mblen_unbounded)(e), _get_restriction_variable = Module._get_restriction_variable = (e, t3, r, a3, o5, _4) => (_get_restriction_variable = Module._get_restriction_variable = wasmExports.get_restriction_variable)(e, t3, r, a3, o5, _4), _pg_mblen_range = Module._pg_mblen_range = (e, t3) => (_pg_mblen_range = Module._pg_mblen_range = wasmExports.pg_mblen_range)(e, t3), _MemoryContextAllocHuge = Module._MemoryContextAllocHuge = (e, t3) => (_MemoryContextAllocHuge = Module._MemoryContextAllocHuge = wasmExports.MemoryContextAllocHuge)(e, t3), _fseek = Module._fseek = (e, t3, r) => (_fseek = Module._fseek = wasmExports.fseek)(e, t3, r), _WaitEventExtensionNew = Module._WaitEventExtensionNew = (e) => (_WaitEventExtensionNew = Module._WaitEventExtensionNew = wasmExports.WaitEventExtensionNew)(e), _pg_popcount64 = Module._pg_popcount64 = (e) => (_pg_popcount64 = Module._pg_popcount64 = wasmExports.pg_popcount64)(e), _expand_array = Module._expand_array = (e, t3, r) => (_expand_array = Module._expand_array = wasmExports.expand_array)(e, t3, r), _exp = Module._exp = (e) => (_exp = Module._exp = wasmExports.exp)(e), _arraycontsel = Module._arraycontsel = (e) => (_arraycontsel = Module._arraycontsel = wasmExports.arraycontsel)(e), _arraycontjoinsel = Module._arraycontjoinsel = (e) => (_arraycontjoinsel = Module._arraycontjoinsel = wasmExports.arraycontjoinsel)(e), _initArrayResult = Module._initArrayResult = (e, t3, r) => (_initArrayResult = Module._initArrayResult = wasmExports.initArrayResult)(e, t3, r), _array_create_iterator = Module._array_create_iterator = (e, t3, r) => (_array_create_iterator = Module._array_create_iterator = wasmExports.array_create_iterator)(e, t3, r), _array_iterate = Module._array_iterate = (e, t3, r) => (_array_iterate = Module._array_iterate = wasmExports.array_iterate)(e, t3, r), _array_free_iterator = Module._array_free_iterator = (e) => (_array_free_iterator = Module._array_free_iterator = wasmExports.array_free_iterator)(e), _ArrayGetIntegerTypmods = Module._ArrayGetIntegerTypmods = (e, t3) => (_ArrayGetIntegerTypmods = Module._ArrayGetIntegerTypmods = wasmExports.ArrayGetIntegerTypmods)(e, t3), _boolin = Module._boolin = (e) => (_boolin = Module._boolin = wasmExports.boolin)(e), ___multi3 = Module.___multi3 = (e, t3, r, a3, o5) => (___multi3 = Module.___multi3 = wasmExports.__multi3)(e, t3, r, a3, o5), _cash_cmp = Module._cash_cmp = (e) => (_cash_cmp = Module._cash_cmp = wasmExports.cash_cmp)(e), _int64_to_numeric = Module._int64_to_numeric = (e) => (_int64_to_numeric = Module._int64_to_numeric = wasmExports.int64_to_numeric)(e), _numeric_div = Module._numeric_div = (e) => (_numeric_div = Module._numeric_div = wasmExports.numeric_div)(e), _numeric_round = Module._numeric_round = (e) => (_numeric_round = Module._numeric_round = wasmExports.numeric_round)(e), _numeric_int8 = Module._numeric_int8 = (e) => (_numeric_int8 = Module._numeric_int8 = wasmExports.numeric_int8)(e), _numeric_mul = Module._numeric_mul = (e) => (_numeric_mul = Module._numeric_mul = wasmExports.numeric_mul)(e), _j2date = Module._j2date = (e, t3, r, a3) => (_j2date = Module._j2date = wasmExports.j2date)(e, t3, r, a3), _EncodeDateOnly = Module._EncodeDateOnly = (e, t3, r) => (_EncodeDateOnly = Module._EncodeDateOnly = wasmExports.EncodeDateOnly)(e, t3, r), _EncodeSpecialDate = Module._EncodeSpecialDate = (e, t3) => (_EncodeSpecialDate = Module._EncodeSpecialDate = wasmExports.EncodeSpecialDate)(e, t3), _date_eq = Module._date_eq = (e) => (_date_eq = Module._date_eq = wasmExports.date_eq)(e), _date_lt = Module._date_lt = (e) => (_date_lt = Module._date_lt = wasmExports.date_lt)(e), _date_le = Module._date_le = (e) => (_date_le = Module._date_le = wasmExports.date_le)(e), _date_gt = Module._date_gt = (e) => (_date_gt = Module._date_gt = wasmExports.date_gt)(e), _date_ge = Module._date_ge = (e) => (_date_ge = Module._date_ge = wasmExports.date_ge)(e), _date_cmp = Module._date_cmp = (e) => (_date_cmp = Module._date_cmp = wasmExports.date_cmp)(e), _date_mi = Module._date_mi = (e) => (_date_mi = Module._date_mi = wasmExports.date_mi)(e), _timestamp2tm = Module._timestamp2tm = (e, t3, r, a3, o5, _4) => (_timestamp2tm = Module._timestamp2tm = wasmExports.timestamp2tm)(e, t3, r, a3, o5, _4), _time2tm = Module._time2tm = (e, t3, r) => (_time2tm = Module._time2tm = wasmExports.time2tm)(e, t3, r), _EncodeTimeOnly = Module._EncodeTimeOnly = (e, t3, r, a3, o5, _4) => (_EncodeTimeOnly = Module._EncodeTimeOnly = wasmExports.EncodeTimeOnly)(e, t3, r, a3, o5, _4), _time_eq = Module._time_eq = (e) => (_time_eq = Module._time_eq = wasmExports.time_eq)(e), _time_lt = Module._time_lt = (e) => (_time_lt = Module._time_lt = wasmExports.time_lt)(e), _time_le = Module._time_le = (e) => (_time_le = Module._time_le = wasmExports.time_le)(e), _time_gt = Module._time_gt = (e) => (_time_gt = Module._time_gt = wasmExports.time_gt)(e), _time_ge = Module._time_ge = (e) => (_time_ge = Module._time_ge = wasmExports.time_ge)(e), _time_cmp = Module._time_cmp = (e) => (_time_cmp = Module._time_cmp = wasmExports.time_cmp)(e), _time_mi_time = Module._time_mi_time = (e) => (_time_mi_time = Module._time_mi_time = wasmExports.time_mi_time)(e), _timetz2tm = Module._timetz2tm = (e, t3, r, a3) => (_timetz2tm = Module._timetz2tm = wasmExports.timetz2tm)(e, t3, r, a3), _timetz_cmp = Module._timetz_cmp = (e) => (_timetz_cmp = Module._timetz_cmp = wasmExports.timetz_cmp)(e), _pg_tolower = Module._pg_tolower = (e) => (_pg_tolower = Module._pg_tolower = wasmExports.pg_tolower)(e), _EncodeDateTime = Module._EncodeDateTime = (e, t3, r, a3, o5, _4, s5) => (_EncodeDateTime = Module._EncodeDateTime = wasmExports.EncodeDateTime)(e, t3, r, a3, o5, _4, s5), _TransferExpandedObject = Module._TransferExpandedObject = (e, t3) => (_TransferExpandedObject = Module._TransferExpandedObject = wasmExports.TransferExpandedObject)(e, t3), _forkname_to_number = Module._forkname_to_number = (e) => (_forkname_to_number = Module._forkname_to_number = wasmExports.forkname_to_number)(e), _numeric_lt = Module._numeric_lt = (e) => (_numeric_lt = Module._numeric_lt = wasmExports.numeric_lt)(e), _numeric_abs = Module._numeric_abs = (e) => (_numeric_abs = Module._numeric_abs = wasmExports.numeric_abs)(e), _numeric_add = Module._numeric_add = (e) => (_numeric_add = Module._numeric_add = wasmExports.numeric_add)(e), _numeric_ge = Module._numeric_ge = (e) => (_numeric_ge = Module._numeric_ge = wasmExports.numeric_ge)(e), _err_generic_string = Module._err_generic_string = (e, t3) => (_err_generic_string = Module._err_generic_string = wasmExports.err_generic_string)(e, t3), _domain_check = Module._domain_check = (e, t3, r, a3, o5) => (_domain_check = Module._domain_check = wasmExports.domain_check)(e, t3, r, a3, o5), _enum_lt = Module._enum_lt = (e) => (_enum_lt = Module._enum_lt = wasmExports.enum_lt)(e), _enum_le = Module._enum_le = (e) => (_enum_le = Module._enum_le = wasmExports.enum_le)(e), _enum_ge = Module._enum_ge = (e) => (_enum_ge = Module._enum_ge = wasmExports.enum_ge)(e), _enum_gt = Module._enum_gt = (e) => (_enum_gt = Module._enum_gt = wasmExports.enum_gt)(e), _enum_cmp = Module._enum_cmp = (e) => (_enum_cmp = Module._enum_cmp = wasmExports.enum_cmp)(e), _make_expanded_record_from_typeid = Module._make_expanded_record_from_typeid = (e, t3, r) => (_make_expanded_record_from_typeid = Module._make_expanded_record_from_typeid = wasmExports.make_expanded_record_from_typeid)(e, t3, r), _make_expanded_record_from_tupdesc = Module._make_expanded_record_from_tupdesc = (e, t3) => (_make_expanded_record_from_tupdesc = Module._make_expanded_record_from_tupdesc = wasmExports.make_expanded_record_from_tupdesc)(e, t3), _make_expanded_record_from_exprecord = Module._make_expanded_record_from_exprecord = (e, t3) => (_make_expanded_record_from_exprecord = Module._make_expanded_record_from_exprecord = wasmExports.make_expanded_record_from_exprecord)(e, t3), _expanded_record_set_tuple = Module._expanded_record_set_tuple = (e, t3, r, a3) => (_expanded_record_set_tuple = Module._expanded_record_set_tuple = wasmExports.expanded_record_set_tuple)(e, t3, r, a3), _expanded_record_get_tuple = Module._expanded_record_get_tuple = (e) => (_expanded_record_get_tuple = Module._expanded_record_get_tuple = wasmExports.expanded_record_get_tuple)(e), _deconstruct_expanded_record = Module._deconstruct_expanded_record = (e) => (_deconstruct_expanded_record = Module._deconstruct_expanded_record = wasmExports.deconstruct_expanded_record)(e), _expanded_record_lookup_field = Module._expanded_record_lookup_field = (e, t3, r) => (_expanded_record_lookup_field = Module._expanded_record_lookup_field = wasmExports.expanded_record_lookup_field)(e, t3, r), _expanded_record_set_field_internal = Module._expanded_record_set_field_internal = (e, t3, r, a3, o5, _4) => (_expanded_record_set_field_internal = Module._expanded_record_set_field_internal = wasmExports.expanded_record_set_field_internal)(e, t3, r, a3, o5, _4), _expanded_record_set_fields = Module._expanded_record_set_fields = (e, t3, r, a3) => (_expanded_record_set_fields = Module._expanded_record_set_fields = wasmExports.expanded_record_set_fields)(e, t3, r, a3), _float4in_internal = Module._float4in_internal = (e, t3, r, a3, o5) => (_float4in_internal = Module._float4in_internal = wasmExports.float4in_internal)(e, t3, r, a3, o5), _strtof = Module._strtof = (e, t3) => (_strtof = Module._strtof = wasmExports.strtof)(e, t3), _float_to_shortest_decimal_buf = Module._float_to_shortest_decimal_buf = (e, t3) => (_float_to_shortest_decimal_buf = Module._float_to_shortest_decimal_buf = wasmExports.float_to_shortest_decimal_buf)(e, t3), _float8in = Module._float8in = (e) => (_float8in = Module._float8in = wasmExports.float8in)(e), _float8in_internal = Module._float8in_internal = (e, t3, r, a3, o5) => (_float8in_internal = Module._float8in_internal = wasmExports.float8in_internal)(e, t3, r, a3, o5), _float8out = Module._float8out = (e) => (_float8out = Module._float8out = wasmExports.float8out)(e), _float8out_internal = Module._float8out_internal = (e) => (_float8out_internal = Module._float8out_internal = wasmExports.float8out_internal)(e), _float8pl = Module._float8pl = (e) => (_float8pl = Module._float8pl = wasmExports.float8pl)(e), _float4_cmp_internal = Module._float4_cmp_internal = (e, t3) => (_float4_cmp_internal = Module._float4_cmp_internal = wasmExports.float4_cmp_internal)(e, t3), _btfloat4cmp = Module._btfloat4cmp = (e) => (_btfloat4cmp = Module._btfloat4cmp = wasmExports.btfloat4cmp)(e), _btfloat8cmp = Module._btfloat8cmp = (e) => (_btfloat8cmp = Module._btfloat8cmp = wasmExports.btfloat8cmp)(e), _dtoi4 = Module._dtoi4 = (e) => (_dtoi4 = Module._dtoi4 = wasmExports.dtoi4)(e), _dtoi2 = Module._dtoi2 = (e) => (_dtoi2 = Module._dtoi2 = wasmExports.dtoi2)(e), _cbrt = Module._cbrt = (e) => (_cbrt = Module._cbrt = wasmExports.cbrt)(e), _dexp = Module._dexp = (e) => (_dexp = Module._dexp = wasmExports.dexp)(e), _log10 = Module._log10 = (e) => (_log10 = Module._log10 = wasmExports.log10)(e), _dacos = Module._dacos = (e) => (_dacos = Module._dacos = wasmExports.dacos)(e), _acos = Module._acos = (e) => (_acos = Module._acos = wasmExports.acos)(e), _dasin = Module._dasin = (e) => (_dasin = Module._dasin = wasmExports.dasin)(e), _asin = Module._asin = (e) => (_asin = Module._asin = wasmExports.asin)(e), _datan = Module._datan = (e) => (_datan = Module._datan = wasmExports.datan)(e), _atan = Module._atan = (e) => (_atan = Module._atan = wasmExports.atan)(e), _datan2 = Module._datan2 = (e) => (_datan2 = Module._datan2 = wasmExports.datan2)(e), _atan2 = Module._atan2 = (e, t3) => (_atan2 = Module._atan2 = wasmExports.atan2)(e, t3), _dcos = Module._dcos = (e) => (_dcos = Module._dcos = wasmExports.dcos)(e), _cos = Module._cos = (e) => (_cos = Module._cos = wasmExports.cos)(e), _dcot = Module._dcot = (e) => (_dcot = Module._dcot = wasmExports.dcot)(e), _tan = Module._tan = (e) => (_tan = Module._tan = wasmExports.tan)(e), _dsin = Module._dsin = (e) => (_dsin = Module._dsin = wasmExports.dsin)(e), _sin = Module._sin = (e) => (_sin = Module._sin = wasmExports.sin)(e), _dtan = Module._dtan = (e) => (_dtan = Module._dtan = wasmExports.dtan)(e), _fmod = Module._fmod = (e, t3) => (_fmod = Module._fmod = wasmExports.fmod)(e, t3), _degrees = Module._degrees = (e) => (_degrees = Module._degrees = wasmExports.degrees)(e), _dpi = Module._dpi = (e) => (_dpi = Module._dpi = wasmExports.dpi)(e), _radians = Module._radians = (e) => (_radians = Module._radians = wasmExports.radians)(e), _sinh = Module._sinh = (e) => (_sinh = Module._sinh = wasmExports.sinh)(e), _cosh = Module._cosh = (e) => (_cosh = Module._cosh = wasmExports.cosh)(e), _tanh = Module._tanh = (e) => (_tanh = Module._tanh = wasmExports.tanh)(e), _asinh = Module._asinh = (e) => (_asinh = Module._asinh = wasmExports.asinh)(e), _acosh = Module._acosh = (e) => (_acosh = Module._acosh = wasmExports.acosh)(e), _atanh = Module._atanh = (e) => (_atanh = Module._atanh = wasmExports.atanh)(e), _float8_accum = Module._float8_accum = (e) => (_float8_accum = Module._float8_accum = wasmExports.float8_accum)(e), _float8_stddev_pop = Module._float8_stddev_pop = (e) => (_float8_stddev_pop = Module._float8_stddev_pop = wasmExports.float8_stddev_pop)(e), _float8_stddev_samp = Module._float8_stddev_samp = (e) => (_float8_stddev_samp = Module._float8_stddev_samp = wasmExports.float8_stddev_samp)(e), _asc_tolower = Module._asc_tolower = (e, t3) => (_asc_tolower = Module._asc_tolower = wasmExports.asc_tolower)(e, t3), _pg_strfold = Module._pg_strfold = (e, t3, r, a3, o5) => (_pg_strfold = Module._pg_strfold = wasmExports.pg_strfold)(e, t3, r, a3, o5), _numeric_power = Module._numeric_power = (e) => (_numeric_power = Module._numeric_power = wasmExports.numeric_power)(e), _dtoi8 = Module._dtoi8 = (e) => (_dtoi8 = Module._dtoi8 = wasmExports.dtoi8)(e), _int8out = Module._int8out = (e) => (_int8out = Module._int8out = wasmExports.int8out)(e), _fseeko = Module._fseeko = (e, t3, r) => (_fseeko = Module._fseeko = wasmExports.fseeko)(e, t3, r), _int4in = Module._int4in = (e) => (_int4in = Module._int4in = wasmExports.int4in)(e), _int4_bool = Module._int4_bool = (e) => (_int4_bool = Module._int4_bool = wasmExports.int4_bool)(e), _int8pl = Module._int8pl = (e) => (_int8pl = Module._int8pl = wasmExports.int8pl)(e), _int84 = Module._int84 = (e) => (_int84 = Module._int84 = wasmExports.int84)(e), _int82 = Module._int82 = (e) => (_int82 = Module._int82 = wasmExports.int82)(e), _json_in = Module._json_in = (e) => (_json_in = Module._json_in = wasmExports.json_in)(e), _EncodeSpecialTimestamp = Module._EncodeSpecialTimestamp = (e, t3) => (_EncodeSpecialTimestamp = Module._EncodeSpecialTimestamp = wasmExports.EncodeSpecialTimestamp)(e, t3), _pushJsonbValue = Module._pushJsonbValue = (e, t3, r) => (_pushJsonbValue = Module._pushJsonbValue = wasmExports.pushJsonbValue)(e, t3, r), _numeric_int2 = Module._numeric_int2 = (e) => (_numeric_int2 = Module._numeric_int2 = wasmExports.numeric_int2)(e), _numeric_int4 = Module._numeric_int4 = (e) => (_numeric_int4 = Module._numeric_int4 = wasmExports.numeric_int4)(e), _numeric_float4 = Module._numeric_float4 = (e) => (_numeric_float4 = Module._numeric_float4 = wasmExports.numeric_float4)(e), _numeric_normalize = Module._numeric_normalize = (e) => (_numeric_normalize = Module._numeric_normalize = wasmExports.numeric_normalize)(e), _numeric_cmp = Module._numeric_cmp = (e) => (_numeric_cmp = Module._numeric_cmp = wasmExports.numeric_cmp)(e), _numeric_eq = Module._numeric_eq = (e) => (_numeric_eq = Module._numeric_eq = wasmExports.numeric_eq)(e), _hash_numeric = Module._hash_numeric = (e) => (_hash_numeric = Module._hash_numeric = wasmExports.hash_numeric)(e), _hash_numeric_extended = Module._hash_numeric_extended = (e) => (_hash_numeric_extended = Module._hash_numeric_extended = wasmExports.hash_numeric_extended)(e), _int2_numeric = Module._int2_numeric = (e) => (_int2_numeric = Module._int2_numeric = wasmExports.int2_numeric)(e), _int4_numeric = Module._int4_numeric = (e) => (_int4_numeric = Module._int4_numeric = wasmExports.int4_numeric)(e), _int8_numeric = Module._int8_numeric = (e) => (_int8_numeric = Module._int8_numeric = wasmExports.int8_numeric)(e), _float4_numeric = Module._float4_numeric = (e) => (_float4_numeric = Module._float4_numeric = wasmExports.float4_numeric)(e), _float8_numeric = Module._float8_numeric = (e) => (_float8_numeric = Module._float8_numeric = wasmExports.float8_numeric)(e), _numeric_uminus = Module._numeric_uminus = (e) => (_numeric_uminus = Module._numeric_uminus = wasmExports.numeric_uminus)(e), _numeric_is_nan = Module._numeric_is_nan = (e) => (_numeric_is_nan = Module._numeric_is_nan = wasmExports.numeric_is_nan)(e), _numeric_ceil = Module._numeric_ceil = (e) => (_numeric_ceil = Module._numeric_ceil = wasmExports.numeric_ceil)(e), _numeric_floor = Module._numeric_floor = (e) => (_numeric_floor = Module._numeric_floor = wasmExports.numeric_floor)(e), _timestamp_cmp = Module._timestamp_cmp = (e) => (_timestamp_cmp = Module._timestamp_cmp = wasmExports.timestamp_cmp)(e), _macaddr_cmp = Module._macaddr_cmp = (e) => (_macaddr_cmp = Module._macaddr_cmp = wasmExports.macaddr_cmp)(e), _macaddr_lt = Module._macaddr_lt = (e) => (_macaddr_lt = Module._macaddr_lt = wasmExports.macaddr_lt)(e), _macaddr_le = Module._macaddr_le = (e) => (_macaddr_le = Module._macaddr_le = wasmExports.macaddr_le)(e), _macaddr_eq = Module._macaddr_eq = (e) => (_macaddr_eq = Module._macaddr_eq = wasmExports.macaddr_eq)(e), _macaddr_ge = Module._macaddr_ge = (e) => (_macaddr_ge = Module._macaddr_ge = wasmExports.macaddr_ge)(e), _macaddr_gt = Module._macaddr_gt = (e) => (_macaddr_gt = Module._macaddr_gt = wasmExports.macaddr_gt)(e), _macaddr8_cmp = Module._macaddr8_cmp = (e) => (_macaddr8_cmp = Module._macaddr8_cmp = wasmExports.macaddr8_cmp)(e), _macaddr8_lt = Module._macaddr8_lt = (e) => (_macaddr8_lt = Module._macaddr8_lt = wasmExports.macaddr8_lt)(e), _macaddr8_le = Module._macaddr8_le = (e) => (_macaddr8_le = Module._macaddr8_le = wasmExports.macaddr8_le)(e), _macaddr8_eq = Module._macaddr8_eq = (e) => (_macaddr8_eq = Module._macaddr8_eq = wasmExports.macaddr8_eq)(e), _macaddr8_ge = Module._macaddr8_ge = (e) => (_macaddr8_ge = Module._macaddr8_ge = wasmExports.macaddr8_ge)(e), _macaddr8_gt = Module._macaddr8_gt = (e) => (_macaddr8_gt = Module._macaddr8_gt = wasmExports.macaddr8_gt)(e), _current_query = Module._current_query = (e) => (_current_query = Module._current_query = wasmExports.current_query)(e), _get_fn_expr_arg_stable = Module._get_fn_expr_arg_stable = (e, t3) => (_get_fn_expr_arg_stable = Module._get_fn_expr_arg_stable = wasmExports.get_fn_expr_arg_stable)(e, t3), _unpack_sql_state = Module._unpack_sql_state = (e) => (_unpack_sql_state = Module._unpack_sql_state = wasmExports.unpack_sql_state)(e), _get_fn_expr_rettype = Module._get_fn_expr_rettype = (e) => (_get_fn_expr_rettype = Module._get_fn_expr_rettype = wasmExports.get_fn_expr_rettype)(e), _btnamecmp = Module._btnamecmp = (e) => (_btnamecmp = Module._btnamecmp = wasmExports.btnamecmp)(e), _inet_in = Module._inet_in = (e) => (_inet_in = Module._inet_in = wasmExports.inet_in)(e), _network_cmp = Module._network_cmp = (e) => (_network_cmp = Module._network_cmp = wasmExports.network_cmp)(e), _convert_network_to_scalar = Module._convert_network_to_scalar = (e, t3, r) => (_convert_network_to_scalar = Module._convert_network_to_scalar = wasmExports.convert_network_to_scalar)(e, t3, r), _numeric_sign = Module._numeric_sign = (e) => (_numeric_sign = Module._numeric_sign = wasmExports.numeric_sign)(e), _numeric_gt = Module._numeric_gt = (e) => (_numeric_gt = Module._numeric_gt = wasmExports.numeric_gt)(e), _numeric_le = Module._numeric_le = (e) => (_numeric_le = Module._numeric_le = wasmExports.numeric_le)(e), _numeric_mod = Module._numeric_mod = (e) => (_numeric_mod = Module._numeric_mod = wasmExports.numeric_mod)(e), _numeric_sqrt = Module._numeric_sqrt = (e) => (_numeric_sqrt = Module._numeric_sqrt = wasmExports.numeric_sqrt)(e), ___divti3 = Module.___divti3 = (e, t3, r, a3, o5) => (___divti3 = Module.___divti3 = wasmExports.__divti3)(e, t3, r, a3, o5), _numeric_exp = Module._numeric_exp = (e) => (_numeric_exp = Module._numeric_exp = wasmExports.numeric_exp)(e), _numeric_ln = Module._numeric_ln = (e) => (_numeric_ln = Module._numeric_ln = wasmExports.numeric_ln)(e), _numeric_log = Module._numeric_log = (e) => (_numeric_log = Module._numeric_log = wasmExports.numeric_log)(e), _numeric_float8_no_overflow = Module._numeric_float8_no_overflow = (e) => (_numeric_float8_no_overflow = Module._numeric_float8_no_overflow = wasmExports.numeric_float8_no_overflow)(e), _oidout = Module._oidout = (e) => (_oidout = Module._oidout = wasmExports.oidout)(e), _btrim1 = Module._btrim1 = (e) => (_btrim1 = Module._btrim1 = wasmExports.btrim1)(e), _ltrim1 = Module._ltrim1 = (e) => (_ltrim1 = Module._ltrim1 = wasmExports.ltrim1)(e), _rtrim1 = Module._rtrim1 = (e) => (_rtrim1 = Module._rtrim1 = wasmExports.rtrim1)(e), _tuplesort_skiptuples = Module._tuplesort_skiptuples = (e, t3, r) => (_tuplesort_skiptuples = Module._tuplesort_skiptuples = wasmExports.tuplesort_skiptuples)(e, t3, r), _interval_mi = Module._interval_mi = (e) => (_interval_mi = Module._interval_mi = wasmExports.interval_mi)(e), _setlocale = Module._setlocale = (e, t3) => (_setlocale = Module._setlocale = wasmExports.setlocale)(e, t3), _newlocale = Module._newlocale = (e, t3, r) => (_newlocale = Module._newlocale = wasmExports.newlocale)(e, t3, r), _strftime_l = Module._strftime_l = (e, t3, r, a3, o5) => (_strftime_l = Module._strftime_l = wasmExports.strftime_l)(e, t3, r, a3, o5), _freelocale = Module._freelocale = (e) => (_freelocale = Module._freelocale = wasmExports.freelocale)(e), _uselocale = Module._uselocale = (e) => (_uselocale = Module._uselocale = wasmExports.uselocale)(e), _strcoll_l = Module._strcoll_l = (e, t3, r) => (_strcoll_l = Module._strcoll_l = wasmExports.strcoll_l)(e, t3, r), _strxfrm_l = Module._strxfrm_l = (e, t3, r, a3) => (_strxfrm_l = Module._strxfrm_l = wasmExports.strxfrm_l)(e, t3, r, a3), _drandom = Module._drandom = (e) => (_drandom = Module._drandom = wasmExports.drandom)(e), _quote_ident = Module._quote_ident = (e) => (_quote_ident = Module._quote_ident = wasmExports.quote_ident)(e), _textregexeq = Module._textregexeq = (e) => (_textregexeq = Module._textregexeq = wasmExports.textregexeq)(e), _text_substr = Module._text_substr = (e) => (_text_substr = Module._text_substr = wasmExports.text_substr)(e), _pg_wchar2mb_with_len = Module._pg_wchar2mb_with_len = (e, t3, r) => (_pg_wchar2mb_with_len = Module._pg_wchar2mb_with_len = wasmExports.pg_wchar2mb_with_len)(e, t3, r), _regexp_split_to_array = Module._regexp_split_to_array = (e) => (_regexp_split_to_array = Module._regexp_split_to_array = wasmExports.regexp_split_to_array)(e), _regclassin = Module._regclassin = (e) => (_regclassin = Module._regclassin = wasmExports.regclassin)(e), _regtypeout = Module._regtypeout = (e) => (_regtypeout = Module._regtypeout = wasmExports.regtypeout)(e), _pg_get_indexdef_columns_extended = Module._pg_get_indexdef_columns_extended = (e, t3) => (_pg_get_indexdef_columns_extended = Module._pg_get_indexdef_columns_extended = wasmExports.pg_get_indexdef_columns_extended)(e, t3), _pg_get_querydef = Module._pg_get_querydef = (e, t3) => (_pg_get_querydef = Module._pg_get_querydef = wasmExports.pg_get_querydef)(e, t3), _strcspn = Module._strcspn = (e, t3) => (_strcspn = Module._strcspn = wasmExports.strcspn)(e, t3), _generic_restriction_selectivity = Module._generic_restriction_selectivity = (e, t3, r, a3, o5, _4) => (_generic_restriction_selectivity = Module._generic_restriction_selectivity = wasmExports.generic_restriction_selectivity)(e, t3, r, a3, o5, _4), _genericcostestimate = Module._genericcostestimate = (e, t3, r, a3) => (_genericcostestimate = Module._genericcostestimate = wasmExports.genericcostestimate)(e, t3, r, a3), _tidin = Module._tidin = (e) => (_tidin = Module._tidin = wasmExports.tidin)(e), _tidout = Module._tidout = (e) => (_tidout = Module._tidout = wasmExports.tidout)(e), _timestamp_in = Module._timestamp_in = (e) => (_timestamp_in = Module._timestamp_in = wasmExports.timestamp_in)(e), _timestamp_eq = Module._timestamp_eq = (e) => (_timestamp_eq = Module._timestamp_eq = wasmExports.timestamp_eq)(e), _timestamp_lt = Module._timestamp_lt = (e) => (_timestamp_lt = Module._timestamp_lt = wasmExports.timestamp_lt)(e), _timestamp_gt = Module._timestamp_gt = (e) => (_timestamp_gt = Module._timestamp_gt = wasmExports.timestamp_gt)(e), _timestamp_le = Module._timestamp_le = (e) => (_timestamp_le = Module._timestamp_le = wasmExports.timestamp_le)(e), _timestamp_ge = Module._timestamp_ge = (e) => (_timestamp_ge = Module._timestamp_ge = wasmExports.timestamp_ge)(e), _interval_eq = Module._interval_eq = (e) => (_interval_eq = Module._interval_eq = wasmExports.interval_eq)(e), _interval_lt = Module._interval_lt = (e) => (_interval_lt = Module._interval_lt = wasmExports.interval_lt)(e), _interval_gt = Module._interval_gt = (e) => (_interval_gt = Module._interval_gt = wasmExports.interval_gt)(e), _interval_le = Module._interval_le = (e) => (_interval_le = Module._interval_le = wasmExports.interval_le)(e), _interval_ge = Module._interval_ge = (e) => (_interval_ge = Module._interval_ge = wasmExports.interval_ge)(e), _interval_cmp = Module._interval_cmp = (e) => (_interval_cmp = Module._interval_cmp = wasmExports.interval_cmp)(e), _timestamp_mi = Module._timestamp_mi = (e) => (_timestamp_mi = Module._timestamp_mi = wasmExports.timestamp_mi)(e), _interval_um = Module._interval_um = (e) => (_interval_um = Module._interval_um = wasmExports.interval_um)(e), _has_fn_opclass_options = Module._has_fn_opclass_options = (e) => (_has_fn_opclass_options = Module._has_fn_opclass_options = wasmExports.has_fn_opclass_options)(e), _uuid_in = Module._uuid_in = (e) => (_uuid_in = Module._uuid_in = wasmExports.uuid_in)(e), _uuid_out = Module._uuid_out = (e) => (_uuid_out = Module._uuid_out = wasmExports.uuid_out)(e), _uuid_cmp = Module._uuid_cmp = (e) => (_uuid_cmp = Module._uuid_cmp = wasmExports.uuid_cmp)(e), _gen_random_uuid = Module._gen_random_uuid = (e) => (_gen_random_uuid = Module._gen_random_uuid = wasmExports.gen_random_uuid)(e), _varbit_in = Module._varbit_in = (e) => (_varbit_in = Module._varbit_in = wasmExports.varbit_in)(e), _biteq = Module._biteq = (e) => (_biteq = Module._biteq = wasmExports.biteq)(e), _bitlt = Module._bitlt = (e) => (_bitlt = Module._bitlt = wasmExports.bitlt)(e), _bitle = Module._bitle = (e) => (_bitle = Module._bitle = wasmExports.bitle)(e), _bitgt = Module._bitgt = (e) => (_bitgt = Module._bitgt = wasmExports.bitgt)(e), _bitge = Module._bitge = (e) => (_bitge = Module._bitge = wasmExports.bitge)(e), _bitcmp = Module._bitcmp = (e) => (_bitcmp = Module._bitcmp = wasmExports.bitcmp)(e), _bpchareq = Module._bpchareq = (e) => (_bpchareq = Module._bpchareq = wasmExports.bpchareq)(e), _bpcharlt = Module._bpcharlt = (e) => (_bpcharlt = Module._bpcharlt = wasmExports.bpcharlt)(e), _bpcharle = Module._bpcharle = (e) => (_bpcharle = Module._bpcharle = wasmExports.bpcharle)(e), _bpchargt = Module._bpchargt = (e) => (_bpchargt = Module._bpchargt = wasmExports.bpchargt)(e), _bpcharge = Module._bpcharge = (e) => (_bpcharge = Module._bpcharge = wasmExports.bpcharge)(e), _bpcharcmp = Module._bpcharcmp = (e) => (_bpcharcmp = Module._bpcharcmp = wasmExports.bpcharcmp)(e), _pg_detoast_datum_slice = Module._pg_detoast_datum_slice = (e, t3, r) => (_pg_detoast_datum_slice = Module._pg_detoast_datum_slice = wasmExports.pg_detoast_datum_slice)(e, t3, r), _text_substr_no_len = Module._text_substr_no_len = (e) => (_text_substr_no_len = Module._text_substr_no_len = wasmExports.text_substr_no_len)(e), _texteq = Module._texteq = (e) => (_texteq = Module._texteq = wasmExports.texteq)(e), _text_lt = Module._text_lt = (e) => (_text_lt = Module._text_lt = wasmExports.text_lt)(e), _text_le = Module._text_le = (e) => (_text_le = Module._text_le = wasmExports.text_le)(e), _text_gt = Module._text_gt = (e) => (_text_gt = Module._text_gt = wasmExports.text_gt)(e), _text_ge = Module._text_ge = (e) => (_text_ge = Module._text_ge = wasmExports.text_ge)(e), _bttextcmp = Module._bttextcmp = (e) => (_bttextcmp = Module._bttextcmp = wasmExports.bttextcmp)(e), _byteaeq = Module._byteaeq = (e) => (_byteaeq = Module._byteaeq = wasmExports.byteaeq)(e), _bytealt = Module._bytealt = (e) => (_bytealt = Module._bytealt = wasmExports.bytealt)(e), _byteale = Module._byteale = (e) => (_byteale = Module._byteale = wasmExports.byteale)(e), _byteagt = Module._byteagt = (e) => (_byteagt = Module._byteagt = wasmExports.byteagt)(e), _byteage = Module._byteage = (e) => (_byteage = Module._byteage = wasmExports.byteage)(e), _byteacmp = Module._byteacmp = (e) => (_byteacmp = Module._byteacmp = wasmExports.byteacmp)(e), _to_hex32 = Module._to_hex32 = (e) => (_to_hex32 = Module._to_hex32 = wasmExports.to_hex32)(e), _text_left = Module._text_left = (e) => (_text_left = Module._text_left = wasmExports.text_left)(e), _text_right = Module._text_right = (e) => (_text_right = Module._text_right = wasmExports.text_right)(e), _text_reverse = Module._text_reverse = (e) => (_text_reverse = Module._text_reverse = wasmExports.text_reverse)(e), _varstr_levenshtein = Module._varstr_levenshtein = (e, t3, r, a3, o5, _4, s5, n3) => (_varstr_levenshtein = Module._varstr_levenshtein = wasmExports.varstr_levenshtein)(e, t3, r, a3, o5, _4, s5, n3), _pg_utf_mblen_private = Module._pg_utf_mblen_private = (e) => (_pg_utf_mblen_private = Module._pg_utf_mblen_private = wasmExports.pg_utf_mblen_private)(e), _pg_xml_init = Module._pg_xml_init = (e) => (_pg_xml_init = Module._pg_xml_init = wasmExports.pg_xml_init)(e), _xml_ereport = Module._xml_ereport = (e, t3, r, a3) => (_xml_ereport = Module._xml_ereport = wasmExports.xml_ereport)(e, t3, r, a3), _pg_xml_done = Module._pg_xml_done = (e, t3) => (_pg_xml_done = Module._pg_xml_done = wasmExports.pg_xml_done)(e, t3), _pg_do_encoding_conversion = Module._pg_do_encoding_conversion = (e, t3, r, a3) => (_pg_do_encoding_conversion = Module._pg_do_encoding_conversion = wasmExports.pg_do_encoding_conversion)(e, t3, r, a3), _CreateCacheMemoryContext = Module._CreateCacheMemoryContext = () => (_CreateCacheMemoryContext = Module._CreateCacheMemoryContext = wasmExports.CreateCacheMemoryContext)(), _cfunc_resolve_polymorphic_argtypes = Module._cfunc_resolve_polymorphic_argtypes = (e, t3, r, a3, o5, _4) => (_cfunc_resolve_polymorphic_argtypes = Module._cfunc_resolve_polymorphic_argtypes = wasmExports.cfunc_resolve_polymorphic_argtypes)(e, t3, r, a3, o5, _4), _get_typsubscript = Module._get_typsubscript = (e, t3) => (_get_typsubscript = Module._get_typsubscript = wasmExports.get_typsubscript)(e, t3), _CachedPlanAllowsSimpleValidityCheck = Module._CachedPlanAllowsSimpleValidityCheck = (e, t3, r) => (_CachedPlanAllowsSimpleValidityCheck = Module._CachedPlanAllowsSimpleValidityCheck = wasmExports.CachedPlanAllowsSimpleValidityCheck)(e, t3, r), _CachedPlanIsSimplyValid = Module._CachedPlanIsSimplyValid = (e, t3, r) => (_CachedPlanIsSimplyValid = Module._CachedPlanIsSimplyValid = wasmExports.CachedPlanIsSimplyValid)(e, t3, r), _GetCachedExpression = Module._GetCachedExpression = (e) => (_GetCachedExpression = Module._GetCachedExpression = wasmExports.GetCachedExpression)(e), _FreeCachedExpression = Module._FreeCachedExpression = (e) => (_FreeCachedExpression = Module._FreeCachedExpression = wasmExports.FreeCachedExpression)(e), _ReleaseAllPlanCacheRefsInOwner = Module._ReleaseAllPlanCacheRefsInOwner = (e) => (_ReleaseAllPlanCacheRefsInOwner = Module._ReleaseAllPlanCacheRefsInOwner = wasmExports.ReleaseAllPlanCacheRefsInOwner)(e), _abort = Module._abort = () => (_abort = Module._abort = wasmExports.abort)(), _in_error_recursion_trouble = Module._in_error_recursion_trouble = () => (_in_error_recursion_trouble = Module._in_error_recursion_trouble = wasmExports.in_error_recursion_trouble)(), _pg_vfprintf = Module._pg_vfprintf = (e, t3, r) => (_pg_vfprintf = Module._pg_vfprintf = wasmExports.pg_vfprintf)(e, t3, r), _pgl_longjmp = Module._pgl_longjmp = (e, t3) => (_pgl_longjmp = Module._pgl_longjmp = wasmExports.pgl_longjmp)(e, t3), _GetErrorContextStack = Module._GetErrorContextStack = () => (_GetErrorContextStack = Module._GetErrorContextStack = wasmExports.GetErrorContextStack)(), _dlsym = Module._dlsym = (e, t3) => (_dlsym = Module._dlsym = wasmExports.dlsym)(e, t3), _dlopen = Module._dlopen = (e, t3) => (_dlopen = Module._dlopen = wasmExports.dlopen)(e, t3), _dlerror = Module._dlerror = () => (_dlerror = Module._dlerror = wasmExports.dlerror)(), _dlclose = Module._dlclose = (e) => (_dlclose = Module._dlclose = wasmExports.dlclose)(e), _find_rendezvous_variable = Module._find_rendezvous_variable = (e) => (_find_rendezvous_variable = Module._find_rendezvous_variable = wasmExports.find_rendezvous_variable)(e), _CallerFInfoFunctionCall1 = Module._CallerFInfoFunctionCall1 = (e, t3, r, a3) => (_CallerFInfoFunctionCall1 = Module._CallerFInfoFunctionCall1 = wasmExports.CallerFInfoFunctionCall1)(e, t3, r, a3), _CallerFInfoFunctionCall2 = Module._CallerFInfoFunctionCall2 = (e, t3, r, a3, o5) => (_CallerFInfoFunctionCall2 = Module._CallerFInfoFunctionCall2 = wasmExports.CallerFInfoFunctionCall2)(e, t3, r, a3, o5), _FunctionCall0Coll = Module._FunctionCall0Coll = (e, t3) => (_FunctionCall0Coll = Module._FunctionCall0Coll = wasmExports.FunctionCall0Coll)(e, t3), _RelationNameGetTupleDesc = Module._RelationNameGetTupleDesc = (e) => (_RelationNameGetTupleDesc = Module._RelationNameGetTupleDesc = wasmExports.RelationNameGetTupleDesc)(e), _hash_freeze = Module._hash_freeze = (e) => (_hash_freeze = Module._hash_freeze = wasmExports.hash_freeze)(e), _chdir = Module._chdir = (e) => (_chdir = Module._chdir = wasmExports.chdir)(e), _pg_bindtextdomain = Module._pg_bindtextdomain = (e) => (_pg_bindtextdomain = Module._pg_bindtextdomain = wasmExports.pg_bindtextdomain)(e), _pg_mblen = Module._pg_mblen = (e) => (_pg_mblen = Module._pg_mblen = wasmExports.pg_mblen)(e), _DefineCustomBoolVariable = Module._DefineCustomBoolVariable = (e, t3, r, a3, o5, _4, s5, n3, l2, d3) => (_DefineCustomBoolVariable = Module._DefineCustomBoolVariable = wasmExports.DefineCustomBoolVariable)(e, t3, r, a3, o5, _4, s5, n3, l2, d3), _DefineCustomIntVariable = Module._DefineCustomIntVariable = (e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4) => (_DefineCustomIntVariable = Module._DefineCustomIntVariable = wasmExports.DefineCustomIntVariable)(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4), _DefineCustomRealVariable = Module._DefineCustomRealVariable = (e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4) => (_DefineCustomRealVariable = Module._DefineCustomRealVariable = wasmExports.DefineCustomRealVariable)(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4), _DefineCustomStringVariable = Module._DefineCustomStringVariable = (e, t3, r, a3, o5, _4, s5, n3, l2, d3) => (_DefineCustomStringVariable = Module._DefineCustomStringVariable = wasmExports.DefineCustomStringVariable)(e, t3, r, a3, o5, _4, s5, n3, l2, d3), _DefineCustomEnumVariable = Module._DefineCustomEnumVariable = (e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3) => (_DefineCustomEnumVariable = Module._DefineCustomEnumVariable = wasmExports.DefineCustomEnumVariable)(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3), _MarkGUCPrefixReserved = Module._MarkGUCPrefixReserved = (e) => (_MarkGUCPrefixReserved = Module._MarkGUCPrefixReserved = wasmExports.MarkGUCPrefixReserved)(e), _sampler_random_init_state = Module._sampler_random_init_state = (e, t3) => (_sampler_random_init_state = Module._sampler_random_init_state = wasmExports.sampler_random_init_state)(e, t3), _dsa_trim = Module._dsa_trim = (e) => (_dsa_trim = Module._dsa_trim = wasmExports.dsa_trim)(e), _pchomp = Module._pchomp = (e) => (_pchomp = Module._pchomp = wasmExports.pchomp)(e), _PinPortal = Module._PinPortal = (e) => (_PinPortal = Module._PinPortal = wasmExports.PinPortal)(e), _UnpinPortal = Module._UnpinPortal = (e) => (_UnpinPortal = Module._UnpinPortal = wasmExports.UnpinPortal)(e), ___lshrti3 = Module.___lshrti3 = (e, t3, r, a3) => (___lshrti3 = Module.___lshrti3 = wasmExports.__lshrti3)(e, t3, r, a3), _realpath = Module._realpath = (e, t3) => (_realpath = Module._realpath = wasmExports.realpath)(e, t3), _float_to_shortest_decimal_bufn = Module._float_to_shortest_decimal_bufn = (e, t3) => (_float_to_shortest_decimal_bufn = Module._float_to_shortest_decimal_bufn = wasmExports.float_to_shortest_decimal_bufn)(e, t3), _IsValidJsonNumber = Module._IsValidJsonNumber = (e, t3) => (_IsValidJsonNumber = Module._IsValidJsonNumber = wasmExports.IsValidJsonNumber)(e, t3), _pg_prng_uint64 = Module._pg_prng_uint64 = (e) => (_pg_prng_uint64 = Module._pg_prng_uint64 = wasmExports.pg_prng_uint64)(e), _makeStringInfoExt = Module._makeStringInfoExt = (e) => (_makeStringInfoExt = Module._makeStringInfoExt = wasmExports.makeStringInfoExt)(e), _pgl_getpwuid = Module._pgl_getpwuid = (e) => (_pgl_getpwuid = Module._pgl_getpwuid = wasmExports.pgl_getpwuid)(e), _getcwd = Module._getcwd = (e, t3) => (_getcwd = Module._getcwd = wasmExports.getcwd)(e, t3), _pthread_mutex_lock = Module._pthread_mutex_lock = (e) => (_pthread_mutex_lock = Module._pthread_mutex_lock = wasmExports.pthread_mutex_lock)(e), _localeconv = Module._localeconv = () => (_localeconv = Module._localeconv = wasmExports.localeconv)(), _pthread_mutex_unlock = Module._pthread_mutex_unlock = (e) => (_pthread_mutex_unlock = Module._pthread_mutex_unlock = wasmExports.pthread_mutex_unlock)(e), _nanosleep = Module._nanosleep = (e, t3) => (_nanosleep = Module._nanosleep = wasmExports.nanosleep)(e, t3), _strchrnul = Module._strchrnul = (e, t3) => (_strchrnul = Module._strchrnul = wasmExports.strchrnul)(e, t3), _snprintf = Module._snprintf = (e, t3, r, a3) => (_snprintf = Module._snprintf = wasmExports.snprintf)(e, t3, r, a3), _strerror = Module._strerror = (e) => (_strerror = Module._strerror = wasmExports.strerror)(e), _clear_setitimer = Module._clear_setitimer = () => (_clear_setitimer = Module._clear_setitimer = wasmExports.clear_setitimer)(), _pgl_setPGliteActive = Module._pgl_setPGliteActive = (e) => (_pgl_setPGliteActive = Module._pgl_setPGliteActive = wasmExports.pgl_setPGliteActive)(e), _pgl_siglongjmp = Module._pgl_siglongjmp = (e, t3) => (_pgl_siglongjmp = Module._pgl_siglongjmp = wasmExports.pgl_siglongjmp)(e, t3), _pgl_set_system_fn = Module._pgl_set_system_fn = (e) => (_pgl_set_system_fn = Module._pgl_set_system_fn = wasmExports.pgl_set_system_fn)(e), _pgl_set_popen_fn = Module._pgl_set_popen_fn = (e) => (_pgl_set_popen_fn = Module._pgl_set_popen_fn = wasmExports.pgl_set_popen_fn)(e), _pgl_set_pclose_fn = Module._pgl_set_pclose_fn = (e) => (_pgl_set_pclose_fn = Module._pgl_set_pclose_fn = wasmExports.pgl_set_pclose_fn)(e), _pgl_run_atexit_funcs = Module._pgl_run_atexit_funcs = () => (_pgl_run_atexit_funcs = Module._pgl_run_atexit_funcs = wasmExports.pgl_run_atexit_funcs)(), _pgl_freopen = Module._pgl_freopen = (e, t3, r) => (_pgl_freopen = Module._pgl_freopen = wasmExports.pgl_freopen)(e, t3, r), _fiprintf = Module._fiprintf = (e, t3, r) => (_fiprintf = Module._fiprintf = wasmExports.fiprintf)(e, t3, r), _pgl_set_rw_cbs = Module._pgl_set_rw_cbs = (e, t3) => (_pgl_set_rw_cbs = Module._pgl_set_rw_cbs = wasmExports.pgl_set_rw_cbs)(e, t3), _vfprintf = Module._vfprintf = (e, t3, r) => (_vfprintf = Module._vfprintf = wasmExports.vfprintf)(e, t3, r), _pthread_key_create = Module._pthread_key_create = (e, t3) => (_pthread_key_create = Module._pthread_key_create = wasmExports.pthread_key_create)(e, t3), _pthread_getspecific = Module._pthread_getspecific = (e) => (_pthread_getspecific = Module._pthread_getspecific = wasmExports.pthread_getspecific)(e), _pthread_key_delete = Module._pthread_key_delete = (e) => (_pthread_key_delete = Module._pthread_key_delete = wasmExports.pthread_key_delete)(e), _pthread_setspecific = Module._pthread_setspecific = (e, t3) => (_pthread_setspecific = Module._pthread_setspecific = wasmExports.pthread_setspecific)(e, t3), _toupper = Module._toupper = (e) => (_toupper = Module._toupper = wasmExports.toupper)(e), _iconv_open = Module._iconv_open = (e, t3) => (_iconv_open = Module._iconv_open = wasmExports.iconv_open)(e, t3), _iconv_close = Module._iconv_close = (e) => (_iconv_close = Module._iconv_close = wasmExports.iconv_close)(e), _iconv = Module._iconv = (e, t3, r, a3, o5) => (_iconv = Module._iconv = wasmExports.iconv)(e, t3, r, a3, o5), _pthread_mutex_init = Module._pthread_mutex_init = (e, t3) => (_pthread_mutex_init = Module._pthread_mutex_init = wasmExports.pthread_mutex_init)(e, t3), _pthread_mutex_destroy = Module._pthread_mutex_destroy = (e) => (_pthread_mutex_destroy = Module._pthread_mutex_destroy = wasmExports.pthread_mutex_destroy)(e), _pthread_cond_init = Module._pthread_cond_init = (e, t3) => (_pthread_cond_init = Module._pthread_cond_init = wasmExports.pthread_cond_init)(e, t3), _pthread_cond_destroy = Module._pthread_cond_destroy = (e) => (_pthread_cond_destroy = Module._pthread_cond_destroy = wasmExports.pthread_cond_destroy)(e), _pthread_self = Module._pthread_self = () => (_pthread_self = Module._pthread_self = wasmExports.pthread_self)(), _pthread_cond_wait = Module._pthread_cond_wait = (e, t3) => (_pthread_cond_wait = Module._pthread_cond_wait = wasmExports.pthread_cond_wait)(e, t3), _pthread_cond_signal = Module._pthread_cond_signal = (e) => (_pthread_cond_signal = Module._pthread_cond_signal = wasmExports.pthread_cond_signal)(e), _pthread_once = Module._pthread_once = (e, t3) => (_pthread_once = Module._pthread_once = wasmExports.pthread_once)(e, t3), ___cxa_atexit = Module.___cxa_atexit = (e, t3, r) => (___cxa_atexit = Module.___cxa_atexit = wasmExports.__cxa_atexit)(e, t3, r), _fputs = Module._fputs = (e, t3) => (_fputs = Module._fputs = wasmExports.fputs)(e, t3), _vsnprintf = Module._vsnprintf = (e, t3, r, a3) => (_vsnprintf = Module._vsnprintf = wasmExports.vsnprintf)(e, t3, r, a3), ___small_fprintf = Module.___small_fprintf = (e, t3, r) => (___small_fprintf = Module.___small_fprintf = wasmExports.__small_fprintf)(e, t3, r), ___dynamic_cast = Module.___dynamic_cast = (e, t3, r, a3) => (___dynamic_cast = Module.___dynamic_cast = wasmExports.__dynamic_cast)(e, t3, r, a3), ___cxa_pure_virtual = Module.___cxa_pure_virtual = () => (___cxa_pure_virtual = Module.___cxa_pure_virtual = wasmExports.__cxa_pure_virtual)(), _modf = Module._modf = (e, t3) => (_modf = Module._modf = wasmExports.modf)(e, t3), _localtime_r = Module._localtime_r = (e, t3) => (_localtime_r = Module._localtime_r = wasmExports.localtime_r)(e, t3), _strncat = Module._strncat = (e, t3, r) => (_strncat = Module._strncat = wasmExports.strncat)(e, t3, r), _munmap = Module._munmap = (e, t3) => (_munmap = Module._munmap = wasmExports.munmap)(e, t3), __ZdlPvm = Module.__ZdlPvm = (e, t3) => (__ZdlPvm = Module.__ZdlPvm = wasmExports._ZdlPvm)(e, t3), ___ctype_get_mb_cur_max = Module.___ctype_get_mb_cur_max = () => (___ctype_get_mb_cur_max = Module.___ctype_get_mb_cur_max = wasmExports.__ctype_get_mb_cur_max)(), ___ctype_tolower_loc = Module.___ctype_tolower_loc = () => (___ctype_tolower_loc = Module.___ctype_tolower_loc = wasmExports.__ctype_tolower_loc)(), ___ctype_toupper_loc = Module.___ctype_toupper_loc = () => (___ctype_toupper_loc = Module.___ctype_toupper_loc = wasmExports.__ctype_toupper_loc)(), _fdopen = Module._fdopen = (e, t3) => (_fdopen = Module._fdopen = wasmExports.fdopen)(e, t3), _sqrt = Module._sqrt = (e) => (_sqrt = Module._sqrt = wasmExports.sqrt)(e), _acosl = Module._acosl = (e, t3, r) => (_acosl = Module._acosl = wasmExports.acosl)(e, t3, r), _aligned_alloc = Module._aligned_alloc = (e, t3) => (_aligned_alloc = Module._aligned_alloc = wasmExports.aligned_alloc)(e, t3), _atan2l = Module._atan2l = (e, t3, r, a3, o5) => (_atan2l = Module._atan2l = wasmExports.atan2l)(e, t3, r, a3, o5), ___funcs_on_exit = () => (___funcs_on_exit = wasmExports.__funcs_on_exit)(), _atexit = Module._atexit = (e) => (_atexit = Module._atexit = wasmExports.atexit)(e), ___cxa_finalize = Module.___cxa_finalize = (e) => (___cxa_finalize = Module.___cxa_finalize = wasmExports.__cxa_finalize)(e), _btowc = Module._btowc = (e) => (_btowc = Module._btowc = wasmExports.btowc)(e), _clock = Module._clock = () => (_clock = Module._clock = wasmExports.clock)(), _scalbn = Module._scalbn = (e, t3) => (_scalbn = Module._scalbn = wasmExports.scalbn)(e, t3), _cosl = Module._cosl = (e, t3, r) => (_cosl = Module._cosl = wasmExports.cosl)(e, t3, r), _dladdr = Module._dladdr = (e, t3) => (_dladdr = Module._dladdr = wasmExports.dladdr)(e, t3), ___dl_seterr = (e, t3) => (___dl_seterr = wasmExports.__dl_seterr)(e, t3), _duplocale = Module._duplocale = (e) => (_duplocale = Module._duplocale = wasmExports.duplocale)(e), _fchmod = Module._fchmod = (e, t3) => (_fchmod = Module._fchmod = wasmExports.fchmod)(e, t3), _fchmodat = Module._fchmodat = (e, t3, r, a3) => (_fchmodat = Module._fchmodat = wasmExports.fchmodat)(e, t3, r, a3), _fchown = Module._fchown = (e, t3, r) => (_fchown = Module._fchown = wasmExports.fchown)(e, t3, r), _fcntl = Module._fcntl = (e, t3, r) => (_fcntl = Module._fcntl = wasmExports.fcntl)(e, t3, r), _fdopendir = Module._fdopendir = (e) => (_fdopendir = Module._fdopendir = wasmExports.fdopendir)(e), _fmax = Module._fmax = (e, t3) => (_fmax = Module._fmax = wasmExports.fmax)(e, t3), _fmin = Module._fmin = (e, t3) => (_fmin = Module._fmin = wasmExports.fmin)(e, t3), _fputwc = Module._fputwc = (e, t3) => (_fputwc = Module._fputwc = wasmExports.fputwc)(e, t3), _frexp = Module._frexp = (e, t3) => (_frexp = Module._frexp = wasmExports.frexp)(e, t3), _ftell = Module._ftell = (e) => (_ftell = Module._ftell = wasmExports.ftell)(e), _getentropy = Module._getentropy = (e, t3) => (_getentropy = Module._getentropy = wasmExports.getentropy)(e, t3), _geteuid = Module._geteuid = () => (_geteuid = Module._geteuid = wasmExports.geteuid)(), _getgid = Module._getgid = () => (_getgid = Module._getgid = wasmExports.getgid)(), _mbtowc = Module._mbtowc = (e, t3, r) => (_mbtowc = Module._mbtowc = wasmExports.mbtowc)(e, t3, r), _getuid = Module._getuid = () => (_getuid = Module._getuid = wasmExports.getuid)(), _getwc = Module._getwc = (e) => (_getwc = Module._getwc = wasmExports.getwc)(e), _gmtime = Module._gmtime = (e) => (_gmtime = Module._gmtime = wasmExports.gmtime)(e), _hypot = Module._hypot = (e, t3) => (_hypot = Module._hypot = wasmExports.hypot)(e, t3), _mbrtowc = Module._mbrtowc = (e, t3, r, a3) => (_mbrtowc = Module._mbrtowc = wasmExports.mbrtowc)(e, t3, r, a3), _ioctl = Module._ioctl = (e, t3, r) => (_ioctl = Module._ioctl = wasmExports.ioctl)(e, t3, r), _isalpha = Module._isalpha = (e) => (_isalpha = Module._isalpha = wasmExports.isalpha)(e), _isgraph = Module._isgraph = (e) => (_isgraph = Module._isgraph = wasmExports.isgraph)(e), _isspace = Module._isspace = (e) => (_isspace = Module._isspace = wasmExports.isspace)(e), _iswblank_l = Module._iswblank_l = (e, t3) => (_iswblank_l = Module._iswblank_l = wasmExports.iswblank_l)(e, t3), _iswcntrl_l = Module._iswcntrl_l = (e, t3) => (_iswcntrl_l = Module._iswcntrl_l = wasmExports.iswcntrl_l)(e, t3), _iswxdigit_l = Module._iswxdigit_l = (e, t3) => (_iswxdigit_l = Module._iswxdigit_l = wasmExports.iswxdigit_l)(e, t3), _isxdigit_l = Module._isxdigit_l = (e, t3) => (_isxdigit_l = Module._isxdigit_l = wasmExports.isxdigit_l)(e, t3), _pthread_cond_broadcast = Module._pthread_cond_broadcast = (e) => (_pthread_cond_broadcast = Module._pthread_cond_broadcast = wasmExports.pthread_cond_broadcast)(e), _pthread_atfork = Module._pthread_atfork = (e, t3, r) => (_pthread_atfork = Module._pthread_atfork = wasmExports.pthread_atfork)(e, t3, r), _pthread_mutexattr_init = Module._pthread_mutexattr_init = (e) => (_pthread_mutexattr_init = Module._pthread_mutexattr_init = wasmExports.pthread_mutexattr_init)(e), _pthread_mutexattr_setprotocol = Module._pthread_mutexattr_setprotocol = (e, t3) => (_pthread_mutexattr_setprotocol = Module._pthread_mutexattr_setprotocol = wasmExports.pthread_mutexattr_setprotocol)(e, t3), _pthread_mutexattr_settype = Module._pthread_mutexattr_settype = (e, t3) => (_pthread_mutexattr_settype = Module._pthread_mutexattr_settype = wasmExports.pthread_mutexattr_settype)(e, t3), _pthread_mutexattr_destroy = Module._pthread_mutexattr_destroy = (e) => (_pthread_mutexattr_destroy = Module._pthread_mutexattr_destroy = wasmExports.pthread_mutexattr_destroy)(e), _pthread_mutexattr_setpshared = Module._pthread_mutexattr_setpshared = (e, t3) => (_pthread_mutexattr_setpshared = Module._pthread_mutexattr_setpshared = wasmExports.pthread_mutexattr_setpshared)(e, t3), _pthread_mutex_trylock = Module._pthread_mutex_trylock = (e) => (_pthread_mutex_trylock = Module._pthread_mutex_trylock = wasmExports.pthread_mutex_trylock)(e), _pthread_create = Module._pthread_create = (e, t3, r, a3) => (_pthread_create = Module._pthread_create = wasmExports.pthread_create)(e, t3, r, a3), _pthread_join = Module._pthread_join = (e, t3) => (_pthread_join = Module._pthread_join = wasmExports.pthread_join)(e, t3), _pthread_cond_timedwait = Module._pthread_cond_timedwait = (e, t3, r) => (_pthread_cond_timedwait = Module._pthread_cond_timedwait = wasmExports.pthread_cond_timedwait)(e, t3, r), _pthread_detach = Module._pthread_detach = (e) => (_pthread_detach = Module._pthread_detach = wasmExports.pthread_detach)(e), _link = Module._link = (e, t3) => (_link = Module._link = wasmExports.link)(e, t3), _llround = Module._llround = (e) => (_llround = Module._llround = wasmExports.llround)(e), _localtime = Module._localtime = (e) => (_localtime = Module._localtime = wasmExports.localtime)(e), _log2 = Module._log2 = (e) => (_log2 = Module._log2 = wasmExports.log2)(e), _logb = Module._logb = (e) => (_logb = Module._logb = wasmExports.logb)(e), _lround = Module._lround = (e) => (_lround = Module._lround = wasmExports.lround)(e), _mbrlen = Module._mbrlen = (e, t3, r) => (_mbrlen = Module._mbrlen = wasmExports.mbrlen)(e, t3, r), _mbsnrtowcs = Module._mbsnrtowcs = (e, t3, r, a3, o5) => (_mbsnrtowcs = Module._mbsnrtowcs = wasmExports.mbsnrtowcs)(e, t3, r, a3, o5), _mbsrtowcs = Module._mbsrtowcs = (e, t3, r, a3) => (_mbsrtowcs = Module._mbsrtowcs = wasmExports.mbsrtowcs)(e, t3, r, a3), _memrchr = Module._memrchr = (e, t3, r) => (_memrchr = Module._memrchr = wasmExports.memrchr)(e, t3, r), _emscripten_builtin_memalign = (e, t3) => (_emscripten_builtin_memalign = wasmExports.emscripten_builtin_memalign)(e, t3), _nextafter = Module._nextafter = (e, t3) => (_nextafter = Module._nextafter = wasmExports.nextafter)(e, t3), _nextafterf = Module._nextafterf = (e, t3) => (_nextafterf = Module._nextafterf = wasmExports.nextafterf)(e, t3), _ntohs = (e) => (_ntohs = wasmExports.ntohs)(e), _openat = Module._openat = (e, t3, r, a3) => (_openat = Module._openat = wasmExports.openat)(e, t3, r, a3), _pathconf = Module._pathconf = (e, t3) => (_pathconf = Module._pathconf = wasmExports.pathconf)(e, t3), _perror = Module._perror = (e) => (_perror = Module._perror = wasmExports.perror)(e), _iprintf = Module._iprintf = (e, t3) => (_iprintf = Module._iprintf = wasmExports.iprintf)(e, t3), ___small_printf = Module.___small_printf = (e, t3) => (___small_printf = Module.___small_printf = wasmExports.__small_printf)(e, t3), _pthread_mutexattr_getprotocol = Module._pthread_mutexattr_getprotocol = (e, t3) => (_pthread_mutexattr_getprotocol = Module._pthread_mutexattr_getprotocol = wasmExports.pthread_mutexattr_getprotocol)(e, t3), _pthread_mutexattr_getpshared = Module._pthread_mutexattr_getpshared = (e, t3) => (_pthread_mutexattr_getpshared = Module._pthread_mutexattr_getpshared = wasmExports.pthread_mutexattr_getpshared)(e, t3), _pthread_mutexattr_getrobust = Module._pthread_mutexattr_getrobust = (e, t3) => (_pthread_mutexattr_getrobust = Module._pthread_mutexattr_getrobust = wasmExports.pthread_mutexattr_getrobust)(e, t3), _pthread_mutexattr_gettype = Module._pthread_mutexattr_gettype = (e, t3) => (_pthread_mutexattr_gettype = Module._pthread_mutexattr_gettype = wasmExports.pthread_mutexattr_gettype)(e, t3), _putchar = Module._putchar = (e) => (_putchar = Module._putchar = wasmExports.putchar)(e), _qsort = Module._qsort = (e, t3, r, a3) => (_qsort = Module._qsort = wasmExports.qsort)(e, t3, r, a3), _srand = Module._srand = (e) => (_srand = Module._srand = wasmExports.srand)(e), _rand = Module._rand = () => (_rand = Module._rand = wasmExports.rand)(), _remainder = Module._remainder = (e, t3) => (_remainder = Module._remainder = wasmExports.remainder)(e, t3), _remove = Module._remove = (e) => (_remove = Module._remove = wasmExports.remove)(e), _remquo = Module._remquo = (e, t3, r) => (_remquo = Module._remquo = wasmExports.remquo)(e, t3, r), _round = Module._round = (e) => (_round = Module._round = wasmExports.round)(e), _roundf = Module._roundf = (e) => (_roundf = Module._roundf = wasmExports.roundf)(e), __emscripten_timeout = (e, t3) => (__emscripten_timeout = wasmExports._emscripten_timeout)(e, t3), _sinl = Module._sinl = (e, t3, r) => (_sinl = Module._sinl = wasmExports.sinl)(e, t3, r), _siprintf = Module._siprintf = (e, t3, r) => (_siprintf = Module._siprintf = wasmExports.siprintf)(e, t3, r), _sqrtl = Module._sqrtl = (e, t3, r) => (_sqrtl = Module._sqrtl = wasmExports.sqrtl)(e, t3, r), _vsscanf = Module._vsscanf = (e, t3, r) => (_vsscanf = Module._vsscanf = wasmExports.vsscanf)(e, t3, r), _statvfs = Module._statvfs = (e, t3) => (_statvfs = Module._statvfs = wasmExports.statvfs)(e, t3), _strcasecmp = Module._strcasecmp = (e, t3) => (_strcasecmp = Module._strcasecmp = wasmExports.strcasecmp)(e, t3), _strerror_r = Module._strerror_r = (e, t3, r) => (_strerror_r = Module._strerror_r = wasmExports.strerror_r)(e, t3, r), _strftime = Module._strftime = (e, t3, r, a3) => (_strftime = Module._strftime = wasmExports.strftime)(e, t3, r, a3), _strncasecmp = Module._strncasecmp = (e, t3, r) => (_strncasecmp = Module._strncasecmp = wasmExports.strncasecmp)(e, t3, r), ___multf3 = Module.___multf3 = (e, t3, r, a3, o5) => (___multf3 = Module.___multf3 = wasmExports.__multf3)(e, t3, r, a3, o5), ___addtf3 = Module.___addtf3 = (e, t3, r, a3, o5) => (___addtf3 = Module.___addtf3 = wasmExports.__addtf3)(e, t3, r, a3, o5), ___extenddftf2 = Module.___extenddftf2 = (e, t3) => (___extenddftf2 = Module.___extenddftf2 = wasmExports.__extenddftf2)(e, t3), ___subtf3 = Module.___subtf3 = (e, t3, r, a3, o5) => (___subtf3 = Module.___subtf3 = wasmExports.__subtf3)(e, t3, r, a3, o5), ___divtf3 = Module.___divtf3 = (e, t3, r, a3, o5) => (___divtf3 = Module.___divtf3 = wasmExports.__divtf3)(e, t3, r, a3, o5), ___eqtf2 = Module.___eqtf2 = (e, t3, r, a3) => (___eqtf2 = Module.___eqtf2 = wasmExports.__eqtf2)(e, t3, r, a3), ___trunctfdf2 = Module.___trunctfdf2 = (e, t3) => (___trunctfdf2 = Module.___trunctfdf2 = wasmExports.__trunctfdf2)(e, t3), _strtold = Module._strtold = (e, t3, r) => (_strtold = Module._strtold = wasmExports.strtold)(e, t3, r), _strtof_l = Module._strtof_l = (e, t3, r) => (_strtof_l = Module._strtof_l = wasmExports.strtof_l)(e, t3, r), _strtod_l = Module._strtod_l = (e, t3, r) => (_strtod_l = Module._strtod_l = wasmExports.strtod_l)(e, t3, r), _strtold_l = Module._strtold_l = (e, t3, r, a3) => (_strtold_l = Module._strtold_l = wasmExports.strtold_l)(e, t3, r, a3), _strtok = Module._strtok = (e, t3) => (_strtok = Module._strtok = wasmExports.strtok)(e, t3), _strtoull_l = Module._strtoull_l = (e, t3, r, a3) => (_strtoull_l = Module._strtoull_l = wasmExports.strtoull_l)(e, t3, r, a3), _strtoll_l = Module._strtoll_l = (e, t3, r, a3) => (_strtoll_l = Module._strtoll_l = wasmExports.strtoll_l)(e, t3, r, a3), _swprintf = Module._swprintf = (e, t3, r, a3) => (_swprintf = Module._swprintf = wasmExports.swprintf)(e, t3, r, a3), _trunc = Module._trunc = (e) => (_trunc = Module._trunc = wasmExports.trunc)(e), _ungetc = Module._ungetc = (e, t3) => (_ungetc = Module._ungetc = wasmExports.ungetc)(e, t3), _ungetwc = Module._ungetwc = (e, t3) => (_ungetwc = Module._ungetwc = wasmExports.ungetwc)(e, t3), _unlinkat = Module._unlinkat = (e, t3, r) => (_unlinkat = Module._unlinkat = wasmExports.unlinkat)(e, t3, r), _usleep = Module._usleep = (e) => (_usleep = Module._usleep = wasmExports.usleep)(e), _utimensat = Module._utimensat = (e, t3, r, a3) => (_utimensat = Module._utimensat = wasmExports.utimensat)(e, t3, r, a3), _vasprintf = Module._vasprintf = (e, t3, r) => (_vasprintf = Module._vasprintf = wasmExports.vasprintf)(e, t3, r), _wcrtomb = Module._wcrtomb = (e, t3, r) => (_wcrtomb = Module._wcrtomb = wasmExports.wcrtomb)(e, t3, r), _wcslen = Module._wcslen = (e) => (_wcslen = Module._wcslen = wasmExports.wcslen)(e), _wcscoll_l = Module._wcscoll_l = (e, t3, r) => (_wcscoll_l = Module._wcscoll_l = wasmExports.wcscoll_l)(e, t3, r), _wcsnrtombs = Module._wcsnrtombs = (e, t3, r, a3, o5) => (_wcsnrtombs = Module._wcsnrtombs = wasmExports.wcsnrtombs)(e, t3, r, a3, o5), _wcstof = Module._wcstof = (e, t3) => (_wcstof = Module._wcstof = wasmExports.wcstof)(e, t3), _wcstod = Module._wcstod = (e, t3) => (_wcstod = Module._wcstod = wasmExports.wcstod)(e, t3), _wcstold = Module._wcstold = (e, t3, r) => (_wcstold = Module._wcstold = wasmExports.wcstold)(e, t3, r), _wcstoull = Module._wcstoull = (e, t3, r) => (_wcstoull = Module._wcstoull = wasmExports.wcstoull)(e, t3, r), _wcstoll = Module._wcstoll = (e, t3, r) => (_wcstoll = Module._wcstoll = wasmExports.wcstoll)(e, t3, r), _wcstoul = Module._wcstoul = (e, t3, r) => (_wcstoul = Module._wcstoul = wasmExports.wcstoul)(e, t3, r), _wcstol = Module._wcstol = (e, t3, r) => (_wcstol = Module._wcstol = wasmExports.wcstol)(e, t3, r), _wcsxfrm_l = Module._wcsxfrm_l = (e, t3, r, a3) => (_wcsxfrm_l = Module._wcsxfrm_l = wasmExports.wcsxfrm_l)(e, t3, r, a3), _wctob = Module._wctob = (e) => (_wctob = Module._wctob = wasmExports.wctob)(e), _wmemchr = Module._wmemchr = (e, t3, r) => (_wmemchr = Module._wmemchr = wasmExports.wmemchr)(e, t3, r), _wmemcmp = Module._wmemcmp = (e, t3, r) => (_wmemcmp = Module._wmemcmp = wasmExports.wmemcmp)(e, t3, r), ___lttf2 = Module.___lttf2 = (e, t3, r, a3) => (___lttf2 = Module.___lttf2 = wasmExports.__lttf2)(e, t3, r, a3), _setThrew = (e, t3) => (_setThrew = wasmExports.setThrew)(e, t3), __emscripten_tempret_set = (e) => (__emscripten_tempret_set = wasmExports._emscripten_tempret_set)(e), __emscripten_tempret_get = () => (__emscripten_tempret_get = wasmExports._emscripten_tempret_get)(), __emscripten_stack_restore = (e) => (__emscripten_stack_restore = wasmExports._emscripten_stack_restore)(e), __emscripten_stack_alloc = (e) => (__emscripten_stack_alloc = wasmExports._emscripten_stack_alloc)(e), _emscripten_stack_get_current = () => (_emscripten_stack_get_current = wasmExports.emscripten_stack_get_current)(), __Znwm = Module.__Znwm = (e) => (__Znwm = Module.__Znwm = wasmExports._Znwm)(e), __ZNSt3__210__stdinbufIcEC2EP8_IO_FILEP11__mbstate_t = Module.__ZNSt3__210__stdinbufIcEC2EP8_IO_FILEP11__mbstate_t = (e, t3, r) => (__ZNSt3__210__stdinbufIcEC2EP8_IO_FILEP11__mbstate_t = Module.__ZNSt3__210__stdinbufIcEC2EP8_IO_FILEP11__mbstate_t = wasmExports._ZNSt3__210__stdinbufIcEC2EP8_IO_FILEP11__mbstate_t)(e, t3, r), __ZNSt3__211__stdoutbufIcEC2EP8_IO_FILEP11__mbstate_t = Module.__ZNSt3__211__stdoutbufIcEC2EP8_IO_FILEP11__mbstate_t = (e, t3, r) => (__ZNSt3__211__stdoutbufIcEC2EP8_IO_FILEP11__mbstate_t = Module.__ZNSt3__211__stdoutbufIcEC2EP8_IO_FILEP11__mbstate_t = wasmExports._ZNSt3__211__stdoutbufIcEC2EP8_IO_FILEP11__mbstate_t)(e, t3, r), __ZNSt3__210__stdinbufIwEC2EP8_IO_FILEP11__mbstate_t = Module.__ZNSt3__210__stdinbufIwEC2EP8_IO_FILEP11__mbstate_t = (e, t3, r) => (__ZNSt3__210__stdinbufIwEC2EP8_IO_FILEP11__mbstate_t = Module.__ZNSt3__210__stdinbufIwEC2EP8_IO_FILEP11__mbstate_t = wasmExports._ZNSt3__210__stdinbufIwEC2EP8_IO_FILEP11__mbstate_t)(e, t3, r), __ZNSt3__211__stdoutbufIwEC2EP8_IO_FILEP11__mbstate_t = Module.__ZNSt3__211__stdoutbufIwEC2EP8_IO_FILEP11__mbstate_t = (e, t3, r) => (__ZNSt3__211__stdoutbufIwEC2EP8_IO_FILEP11__mbstate_t = Module.__ZNSt3__211__stdoutbufIwEC2EP8_IO_FILEP11__mbstate_t = wasmExports._ZNSt3__211__stdoutbufIwEC2EP8_IO_FILEP11__mbstate_t)(e, t3, r), __ZSt15get_new_handlerv = Module.__ZSt15get_new_handlerv = () => (__ZSt15get_new_handlerv = Module.__ZSt15get_new_handlerv = wasmExports._ZSt15get_new_handlerv)(), __ZdlPv = Module.__ZdlPv = (e) => (__ZdlPv = Module.__ZdlPv = wasmExports._ZdlPv)(e), __ZNSt13runtime_errorD2Ev = Module.__ZNSt13runtime_errorD2Ev = (e) => (__ZNSt13runtime_errorD2Ev = Module.__ZNSt13runtime_errorD2Ev = wasmExports._ZNSt13runtime_errorD2Ev)(e), __ZNKSt13runtime_error4whatEv = Module.__ZNKSt13runtime_error4whatEv = (e) => (__ZNKSt13runtime_error4whatEv = Module.__ZNKSt13runtime_error4whatEv = wasmExports._ZNKSt13runtime_error4whatEv)(e), __ZSt9terminatev = Module.__ZSt9terminatev = () => (__ZSt9terminatev = Module.__ZSt9terminatev = wasmExports._ZSt9terminatev)(), __ZNSt11logic_errorD2Ev = Module.__ZNSt11logic_errorD2Ev = (e) => (__ZNSt11logic_errorD2Ev = Module.__ZNSt11logic_errorD2Ev = wasmExports._ZNSt11logic_errorD2Ev)(e), ___cxa_decrement_exception_refcount = Module.___cxa_decrement_exception_refcount = (e) => (___cxa_decrement_exception_refcount = Module.___cxa_decrement_exception_refcount = wasmExports.__cxa_decrement_exception_refcount)(e), ___cxa_increment_exception_refcount = Module.___cxa_increment_exception_refcount = (e) => (___cxa_increment_exception_refcount = Module.___cxa_increment_exception_refcount = wasmExports.__cxa_increment_exception_refcount)(e), __ZNSt9exceptionD2Ev = Module.__ZNSt9exceptionD2Ev = (e) => (__ZNSt9exceptionD2Ev = Module.__ZNSt9exceptionD2Ev = wasmExports._ZNSt9exceptionD2Ev)(e), __ZNKSt11logic_error4whatEv = Module.__ZNKSt11logic_error4whatEv = (e) => (__ZNKSt11logic_error4whatEv = Module.__ZNKSt11logic_error4whatEv = wasmExports._ZNKSt11logic_error4whatEv)(e), ___cxa_bad_cast = Module.___cxa_bad_cast = () => (___cxa_bad_cast = Module.___cxa_bad_cast = wasmExports.__cxa_bad_cast)(), ___cxa_bad_typeid = Module.___cxa_bad_typeid = () => (___cxa_bad_typeid = Module.___cxa_bad_typeid = wasmExports.__cxa_bad_typeid)(), ___cxa_allocate_exception = Module.___cxa_allocate_exception = (e) => (___cxa_allocate_exception = Module.___cxa_allocate_exception = wasmExports.__cxa_allocate_exception)(e), ___cxa_free_exception = Module.___cxa_free_exception = (e) => (___cxa_free_exception = Module.___cxa_free_exception = wasmExports.__cxa_free_exception)(e), ___cxa_init_primary_exception = Module.___cxa_init_primary_exception = (e, t3, r) => (___cxa_init_primary_exception = Module.___cxa_init_primary_exception = wasmExports.__cxa_init_primary_exception)(e, t3, r), __ZNSt9type_infoD2Ev = Module.__ZNSt9type_infoD2Ev = (e) => (__ZNSt9type_infoD2Ev = Module.__ZNSt9type_infoD2Ev = wasmExports._ZNSt9type_infoD2Ev)(e), ___cxa_can_catch = (e, t3, r) => (___cxa_can_catch = wasmExports.__cxa_can_catch)(e, t3, r), ___cxa_get_exception_ptr = Module.___cxa_get_exception_ptr = (e) => (___cxa_get_exception_ptr = Module.___cxa_get_exception_ptr = wasmExports.__cxa_get_exception_ptr)(e), __ZNSt9exceptionD0Ev = Module.__ZNSt9exceptionD0Ev = (e) => (__ZNSt9exceptionD0Ev = Module.__ZNSt9exceptionD0Ev = wasmExports._ZNSt9exceptionD0Ev)(e), __ZNSt9exceptionD1Ev = Module.__ZNSt9exceptionD1Ev = (e) => (__ZNSt9exceptionD1Ev = Module.__ZNSt9exceptionD1Ev = wasmExports._ZNSt9exceptionD1Ev)(e), __ZNKSt9exception4whatEv = Module.__ZNKSt9exception4whatEv = (e) => (__ZNKSt9exception4whatEv = Module.__ZNKSt9exception4whatEv = wasmExports._ZNKSt9exception4whatEv)(e), __ZNSt13bad_exceptionD0Ev = Module.__ZNSt13bad_exceptionD0Ev = (e) => (__ZNSt13bad_exceptionD0Ev = Module.__ZNSt13bad_exceptionD0Ev = wasmExports._ZNSt13bad_exceptionD0Ev)(e), __ZNSt13bad_exceptionD1Ev = Module.__ZNSt13bad_exceptionD1Ev = (e) => (__ZNSt13bad_exceptionD1Ev = Module.__ZNSt13bad_exceptionD1Ev = wasmExports._ZNSt13bad_exceptionD1Ev)(e), __ZNKSt13bad_exception4whatEv = Module.__ZNKSt13bad_exception4whatEv = (e) => (__ZNKSt13bad_exception4whatEv = Module.__ZNKSt13bad_exception4whatEv = wasmExports._ZNKSt13bad_exception4whatEv)(e), __ZNSt9bad_allocC2Ev = Module.__ZNSt9bad_allocC2Ev = (e) => (__ZNSt9bad_allocC2Ev = Module.__ZNSt9bad_allocC2Ev = wasmExports._ZNSt9bad_allocC2Ev)(e), __ZNSt9bad_allocD0Ev = Module.__ZNSt9bad_allocD0Ev = (e) => (__ZNSt9bad_allocD0Ev = Module.__ZNSt9bad_allocD0Ev = wasmExports._ZNSt9bad_allocD0Ev)(e), __ZNSt9bad_allocD1Ev = Module.__ZNSt9bad_allocD1Ev = (e) => (__ZNSt9bad_allocD1Ev = Module.__ZNSt9bad_allocD1Ev = wasmExports._ZNSt9bad_allocD1Ev)(e), __ZNKSt9bad_alloc4whatEv = Module.__ZNKSt9bad_alloc4whatEv = (e) => (__ZNKSt9bad_alloc4whatEv = Module.__ZNKSt9bad_alloc4whatEv = wasmExports._ZNKSt9bad_alloc4whatEv)(e), __ZNSt20bad_array_new_lengthC2Ev = Module.__ZNSt20bad_array_new_lengthC2Ev = (e) => (__ZNSt20bad_array_new_lengthC2Ev = Module.__ZNSt20bad_array_new_lengthC2Ev = wasmExports._ZNSt20bad_array_new_lengthC2Ev)(e), __ZNSt20bad_array_new_lengthD0Ev = Module.__ZNSt20bad_array_new_lengthD0Ev = (e) => (__ZNSt20bad_array_new_lengthD0Ev = Module.__ZNSt20bad_array_new_lengthD0Ev = wasmExports._ZNSt20bad_array_new_lengthD0Ev)(e), __ZNSt20bad_array_new_lengthD1Ev = Module.__ZNSt20bad_array_new_lengthD1Ev = (e) => (__ZNSt20bad_array_new_lengthD1Ev = Module.__ZNSt20bad_array_new_lengthD1Ev = wasmExports._ZNSt20bad_array_new_lengthD1Ev)(e), __ZNKSt20bad_array_new_length4whatEv = Module.__ZNKSt20bad_array_new_length4whatEv = (e) => (__ZNKSt20bad_array_new_length4whatEv = Module.__ZNKSt20bad_array_new_length4whatEv = wasmExports._ZNKSt20bad_array_new_length4whatEv)(e), __ZNSt13bad_exceptionD2Ev = Module.__ZNSt13bad_exceptionD2Ev = (e) => (__ZNSt13bad_exceptionD2Ev = Module.__ZNSt13bad_exceptionD2Ev = wasmExports._ZNSt13bad_exceptionD2Ev)(e), __ZNSt9bad_allocC1Ev = Module.__ZNSt9bad_allocC1Ev = (e) => (__ZNSt9bad_allocC1Ev = Module.__ZNSt9bad_allocC1Ev = wasmExports._ZNSt9bad_allocC1Ev)(e), __ZNSt9bad_allocD2Ev = Module.__ZNSt9bad_allocD2Ev = (e) => (__ZNSt9bad_allocD2Ev = Module.__ZNSt9bad_allocD2Ev = wasmExports._ZNSt9bad_allocD2Ev)(e), __ZNSt20bad_array_new_lengthC1Ev = Module.__ZNSt20bad_array_new_lengthC1Ev = (e) => (__ZNSt20bad_array_new_lengthC1Ev = Module.__ZNSt20bad_array_new_lengthC1Ev = wasmExports._ZNSt20bad_array_new_lengthC1Ev)(e), __ZNSt20bad_array_new_lengthD2Ev = Module.__ZNSt20bad_array_new_lengthD2Ev = (e) => (__ZNSt20bad_array_new_lengthD2Ev = Module.__ZNSt20bad_array_new_lengthD2Ev = wasmExports._ZNSt20bad_array_new_lengthD2Ev)(e), __ZNSt11logic_errorD0Ev = Module.__ZNSt11logic_errorD0Ev = (e) => (__ZNSt11logic_errorD0Ev = Module.__ZNSt11logic_errorD0Ev = wasmExports._ZNSt11logic_errorD0Ev)(e), __ZNSt11logic_errorD1Ev = Module.__ZNSt11logic_errorD1Ev = (e) => (__ZNSt11logic_errorD1Ev = Module.__ZNSt11logic_errorD1Ev = wasmExports._ZNSt11logic_errorD1Ev)(e), __ZNSt13runtime_errorD0Ev = Module.__ZNSt13runtime_errorD0Ev = (e) => (__ZNSt13runtime_errorD0Ev = Module.__ZNSt13runtime_errorD0Ev = wasmExports._ZNSt13runtime_errorD0Ev)(e), __ZNSt13runtime_errorD1Ev = Module.__ZNSt13runtime_errorD1Ev = (e) => (__ZNSt13runtime_errorD1Ev = Module.__ZNSt13runtime_errorD1Ev = wasmExports._ZNSt13runtime_errorD1Ev)(e), __ZNSt12domain_errorD0Ev = Module.__ZNSt12domain_errorD0Ev = (e) => (__ZNSt12domain_errorD0Ev = Module.__ZNSt12domain_errorD0Ev = wasmExports._ZNSt12domain_errorD0Ev)(e), __ZNSt12domain_errorD1Ev = Module.__ZNSt12domain_errorD1Ev = (e) => (__ZNSt12domain_errorD1Ev = Module.__ZNSt12domain_errorD1Ev = wasmExports._ZNSt12domain_errorD1Ev)(e), __ZNSt16invalid_argumentD0Ev = Module.__ZNSt16invalid_argumentD0Ev = (e) => (__ZNSt16invalid_argumentD0Ev = Module.__ZNSt16invalid_argumentD0Ev = wasmExports._ZNSt16invalid_argumentD0Ev)(e), __ZNSt16invalid_argumentD1Ev = Module.__ZNSt16invalid_argumentD1Ev = (e) => (__ZNSt16invalid_argumentD1Ev = Module.__ZNSt16invalid_argumentD1Ev = wasmExports._ZNSt16invalid_argumentD1Ev)(e), __ZNSt12length_errorD0Ev = Module.__ZNSt12length_errorD0Ev = (e) => (__ZNSt12length_errorD0Ev = Module.__ZNSt12length_errorD0Ev = wasmExports._ZNSt12length_errorD0Ev)(e), __ZNSt12length_errorD1Ev = Module.__ZNSt12length_errorD1Ev = (e) => (__ZNSt12length_errorD1Ev = Module.__ZNSt12length_errorD1Ev = wasmExports._ZNSt12length_errorD1Ev)(e), __ZNSt12out_of_rangeD0Ev = Module.__ZNSt12out_of_rangeD0Ev = (e) => (__ZNSt12out_of_rangeD0Ev = Module.__ZNSt12out_of_rangeD0Ev = wasmExports._ZNSt12out_of_rangeD0Ev)(e), __ZNSt12out_of_rangeD1Ev = Module.__ZNSt12out_of_rangeD1Ev = (e) => (__ZNSt12out_of_rangeD1Ev = Module.__ZNSt12out_of_rangeD1Ev = wasmExports._ZNSt12out_of_rangeD1Ev)(e), __ZNSt11range_errorD0Ev = Module.__ZNSt11range_errorD0Ev = (e) => (__ZNSt11range_errorD0Ev = Module.__ZNSt11range_errorD0Ev = wasmExports._ZNSt11range_errorD0Ev)(e), __ZNSt11range_errorD1Ev = Module.__ZNSt11range_errorD1Ev = (e) => (__ZNSt11range_errorD1Ev = Module.__ZNSt11range_errorD1Ev = wasmExports._ZNSt11range_errorD1Ev)(e), __ZNSt14overflow_errorD0Ev = Module.__ZNSt14overflow_errorD0Ev = (e) => (__ZNSt14overflow_errorD0Ev = Module.__ZNSt14overflow_errorD0Ev = wasmExports._ZNSt14overflow_errorD0Ev)(e), __ZNSt14overflow_errorD1Ev = Module.__ZNSt14overflow_errorD1Ev = (e) => (__ZNSt14overflow_errorD1Ev = Module.__ZNSt14overflow_errorD1Ev = wasmExports._ZNSt14overflow_errorD1Ev)(e), __ZNSt15underflow_errorD0Ev = Module.__ZNSt15underflow_errorD0Ev = (e) => (__ZNSt15underflow_errorD0Ev = Module.__ZNSt15underflow_errorD0Ev = wasmExports._ZNSt15underflow_errorD0Ev)(e), __ZNSt15underflow_errorD1Ev = Module.__ZNSt15underflow_errorD1Ev = (e) => (__ZNSt15underflow_errorD1Ev = Module.__ZNSt15underflow_errorD1Ev = wasmExports._ZNSt15underflow_errorD1Ev)(e), __ZNSt12domain_errorD2Ev = Module.__ZNSt12domain_errorD2Ev = (e) => (__ZNSt12domain_errorD2Ev = Module.__ZNSt12domain_errorD2Ev = wasmExports._ZNSt12domain_errorD2Ev)(e), __ZNSt16invalid_argumentD2Ev = Module.__ZNSt16invalid_argumentD2Ev = (e) => (__ZNSt16invalid_argumentD2Ev = Module.__ZNSt16invalid_argumentD2Ev = wasmExports._ZNSt16invalid_argumentD2Ev)(e), __ZNSt12length_errorD2Ev = Module.__ZNSt12length_errorD2Ev = (e) => (__ZNSt12length_errorD2Ev = Module.__ZNSt12length_errorD2Ev = wasmExports._ZNSt12length_errorD2Ev)(e), __ZNSt12out_of_rangeD2Ev = Module.__ZNSt12out_of_rangeD2Ev = (e) => (__ZNSt12out_of_rangeD2Ev = Module.__ZNSt12out_of_rangeD2Ev = wasmExports._ZNSt12out_of_rangeD2Ev)(e), __ZNSt11range_errorD2Ev = Module.__ZNSt11range_errorD2Ev = (e) => (__ZNSt11range_errorD2Ev = Module.__ZNSt11range_errorD2Ev = wasmExports._ZNSt11range_errorD2Ev)(e), __ZNSt14overflow_errorD2Ev = Module.__ZNSt14overflow_errorD2Ev = (e) => (__ZNSt14overflow_errorD2Ev = Module.__ZNSt14overflow_errorD2Ev = wasmExports._ZNSt14overflow_errorD2Ev)(e), __ZNSt15underflow_errorD2Ev = Module.__ZNSt15underflow_errorD2Ev = (e) => (__ZNSt15underflow_errorD2Ev = Module.__ZNSt15underflow_errorD2Ev = wasmExports._ZNSt15underflow_errorD2Ev)(e), __ZNSt9type_infoD0Ev = Module.__ZNSt9type_infoD0Ev = (e) => (__ZNSt9type_infoD0Ev = Module.__ZNSt9type_infoD0Ev = wasmExports._ZNSt9type_infoD0Ev)(e), __ZNSt9type_infoD1Ev = Module.__ZNSt9type_infoD1Ev = (e) => (__ZNSt9type_infoD1Ev = Module.__ZNSt9type_infoD1Ev = wasmExports._ZNSt9type_infoD1Ev)(e), __ZNSt8bad_castC2Ev = Module.__ZNSt8bad_castC2Ev = (e) => (__ZNSt8bad_castC2Ev = Module.__ZNSt8bad_castC2Ev = wasmExports._ZNSt8bad_castC2Ev)(e), __ZNSt8bad_castD2Ev = Module.__ZNSt8bad_castD2Ev = (e) => (__ZNSt8bad_castD2Ev = Module.__ZNSt8bad_castD2Ev = wasmExports._ZNSt8bad_castD2Ev)(e), __ZNSt8bad_castD0Ev = Module.__ZNSt8bad_castD0Ev = (e) => (__ZNSt8bad_castD0Ev = Module.__ZNSt8bad_castD0Ev = wasmExports._ZNSt8bad_castD0Ev)(e), __ZNSt8bad_castD1Ev = Module.__ZNSt8bad_castD1Ev = (e) => (__ZNSt8bad_castD1Ev = Module.__ZNSt8bad_castD1Ev = wasmExports._ZNSt8bad_castD1Ev)(e), __ZNKSt8bad_cast4whatEv = Module.__ZNKSt8bad_cast4whatEv = (e) => (__ZNKSt8bad_cast4whatEv = Module.__ZNKSt8bad_cast4whatEv = wasmExports._ZNKSt8bad_cast4whatEv)(e), __ZNSt10bad_typeidC2Ev = Module.__ZNSt10bad_typeidC2Ev = (e) => (__ZNSt10bad_typeidC2Ev = Module.__ZNSt10bad_typeidC2Ev = wasmExports._ZNSt10bad_typeidC2Ev)(e), __ZNSt10bad_typeidD2Ev = Module.__ZNSt10bad_typeidD2Ev = (e) => (__ZNSt10bad_typeidD2Ev = Module.__ZNSt10bad_typeidD2Ev = wasmExports._ZNSt10bad_typeidD2Ev)(e), __ZNSt10bad_typeidD0Ev = Module.__ZNSt10bad_typeidD0Ev = (e) => (__ZNSt10bad_typeidD0Ev = Module.__ZNSt10bad_typeidD0Ev = wasmExports._ZNSt10bad_typeidD0Ev)(e), __ZNSt10bad_typeidD1Ev = Module.__ZNSt10bad_typeidD1Ev = (e) => (__ZNSt10bad_typeidD1Ev = Module.__ZNSt10bad_typeidD1Ev = wasmExports._ZNSt10bad_typeidD1Ev)(e), __ZNKSt10bad_typeid4whatEv = Module.__ZNKSt10bad_typeid4whatEv = (e) => (__ZNKSt10bad_typeid4whatEv = Module.__ZNKSt10bad_typeid4whatEv = wasmExports._ZNKSt10bad_typeid4whatEv)(e), __ZNSt8bad_castC1Ev = Module.__ZNSt8bad_castC1Ev = (e) => (__ZNSt8bad_castC1Ev = Module.__ZNSt8bad_castC1Ev = wasmExports._ZNSt8bad_castC1Ev)(e), __ZNSt10bad_typeidC1Ev = Module.__ZNSt10bad_typeidC1Ev = (e) => (__ZNSt10bad_typeidC1Ev = Module.__ZNSt10bad_typeidC1Ev = wasmExports._ZNSt10bad_typeidC1Ev)(e), ___wasm_apply_data_relocs = () => (___wasm_apply_data_relocs = wasmExports.__wasm_apply_data_relocs)(), _LocalBufferBlockPointers = Module._LocalBufferBlockPointers = 2796604, _BufferBlocks = Module._BufferBlocks = 2791308, _wal_level = Module._wal_level = 2582944, _CurrentMemoryContext = Module._CurrentMemoryContext = 2880704, _SnapshotAnyData = Module._SnapshotAnyData = 2674208, _debug_query_string = Module._debug_query_string = 2804316, _maintenance_work_mem = Module._maintenance_work_mem = 2618976, _CritSectionCount = Module._CritSectionCount = 2875364, _InterruptPending = Module._InterruptPending = 2875312, _ParallelWorkerNumber = Module._ParallelWorkerNumber = 2574456, _pg_number_of_ones = Module._pg_number_of_ones = 2034800, _TopMemoryContext = Module._TopMemoryContext = 2880708, _IsUnderPostmaster = Module._IsUnderPostmaster = 2875397, _MainLWLockArray = Module._MainLWLockArray = 2802324, _CurrentResourceOwner = Module._CurrentResourceOwner = 2880756, _work_mem = Module._work_mem = 2618964, _pg_global_prng_state = Module._pg_global_prng_state = 2964208, _NBuffers = Module._NBuffers = 2618984, _XactIsoLevel = Module._XactIsoLevel = 2582808, _bsysscan = Module._bsysscan = 2775716, _CheckXidAlive = Module._CheckXidAlive = 2775712, _MyProc = Module._MyProc = 2804140, _MyDatabaseId = Module._MyDatabaseId = 2875376, _TTSOpsBufferHeapTuple = Module._TTSOpsBufferHeapTuple = 2586992, _RecentXmin = Module._RecentXmin = 2674356, _TTSOpsHeapTuple = Module._TTSOpsHeapTuple = 2586888, _pgWalUsage = Module._pgWalUsage = 2779064, _pgBufferUsage = Module._pgBufferUsage = 2778936, _error_context_stack = Module._error_context_stack = 2873608, _MyLatch = Module._MyLatch = 2875524, ___THREW__ = Module.___THREW__ = 2981972, ___threwValue = Module.___threwValue = 2981976, _PG_exception_stack = Module._PG_exception_stack = 2873612, _TTSOpsVirtual = Module._TTSOpsVirtual = 2586836, _GUC_check_errdetail_string = Module._GUC_check_errdetail_string = 2879292, _TransamVariables = Module._TransamVariables = 2775704, _TopTransactionContext = Module._TopTransactionContext = 2880728, _MyProcPid = Module._MyProcPid = 2875448, _RmgrTable = Module._RmgrTable = 2574528, _process_shared_preload_libraries_in_progress = Module._process_shared_preload_libraries_in_progress = 2878688, _wal_segment_size = Module._wal_segment_size = 2582964, _TopTransactionResourceOwner = Module._TopTransactionResourceOwner = 2880764, _arch_module_check_errdetail_string = Module._arch_module_check_errdetail_string = 2788776, _stdout = Module._stdout = 2770224, _stdin = Module._stdin = 2770072, _object_access_hook = Module._object_access_hook = 2777456, _InvalidObjectAddress = Module._InvalidObjectAddress = 736344, _check_function_bodies = Module._check_function_bodies = 2619166, _post_parse_analyze_hook = Module._post_parse_analyze_hook = 2777496, _ScanKeywordTokens = Module._ScanKeywordTokens = 1285648, _ScanKeywords = Module._ScanKeywords = 2726024, _None_Receiver = Module._None_Receiver = 2592780, _explain_per_plan_hook = Module._explain_per_plan_hook = 2777640, _explain_per_node_hook = Module._explain_per_node_hook = 2777644, _CacheMemoryContext = Module._CacheMemoryContext = 2880720, _SPI_processed = Module._SPI_processed = 2779256, _SPI_tuptable = Module._SPI_tuptable = 2779264, _TTSOpsMinimalTuple = Module._TTSOpsMinimalTuple = 2586940, _check_password_hook = Module._check_password_hook = 2777804, _ConfigReloadPending = Module._ConfigReloadPending = 2788748, _max_parallel_maintenance_workers = Module._max_parallel_maintenance_workers = 2618980, _DateStyle = Module._DateStyle = 2618952, _ExecutorStart_hook = Module._ExecutorStart_hook = 2778912, _ExecutorRun_hook = Module._ExecutorRun_hook = 2778916, _ExecutorFinish_hook = Module._ExecutorFinish_hook = 2778920, _ExecutorEnd_hook = Module._ExecutorEnd_hook = 2778924, _SPI_result = Module._SPI_result = 2779268, _stderr = Module._stderr = 2769920, _MyProcPort = Module._MyProcPort = 2875476, _ClientAuthentication_hook = Module._ClientAuthentication_hook = 2779472, _set_rel_pathlist_hook = Module._set_rel_pathlist_hook = 2788336, _cpu_tuple_cost = Module._cpu_tuple_cost = 2587464, _cpu_operator_cost = Module._cpu_operator_cost = 2587480, _seq_page_cost = Module._seq_page_cost = 2587448, _planner_hook = Module._planner_hook = 2788380, _QueryCancelPending = Module._QueryCancelPending = 2875316, _ShutdownRequestPending = Module._ShutdownRequestPending = 2788752, _MyStartTime = Module._MyStartTime = 2875456, _cluster_name = Module._cluster_name = 2619216, _ProcDiePending = Module._ProcDiePending = 2875320, _application_name = Module._application_name = 2879500, _row_security_policy_hook_restrictive = Module._row_security_policy_hook_restrictive = 2791276, _row_security_policy_hook_permissive = Module._row_security_policy_hook_permissive = 2791272, _BufferDescriptors = Module._BufferDescriptors = 2791304, _shmem_startup_hook = Module._shmem_startup_hook = 2797300, _ProcessUtility_hook = Module._ProcessUtility_hook = 2804520, _IntervalStyle = Module._IntervalStyle = 2875400, _extra_float_digits = Module._extra_float_digits = 2609272, _pg_crc32_table = Module._pg_crc32_table = 1698672, _shmem_request_hook = Module._shmem_request_hook = 2878692, __ZTVN10__cxxabiv120__si_class_type_infoE = Module.__ZTVN10__cxxabiv120__si_class_type_infoE = 2770852, __ZTVN10__cxxabiv117__class_type_infoE = Module.__ZTVN10__cxxabiv117__class_type_infoE = 2770812, __ZTVN10__cxxabiv121__vmi_class_type_infoE = Module.__ZTVN10__cxxabiv121__vmi_class_type_infoE = 2770904, __ZTVSt11logic_error = Module.__ZTVSt11logic_error = 2771164, __ZTVSt9exception = Module.__ZTVSt9exception = 2771080, __ZTVSt13runtime_error = Module.__ZTVSt13runtime_error = 2771184, __ZTISt13runtime_error = Module.__ZTISt13runtime_error = 2771376, __ZTISt9exception = Module.__ZTISt9exception = 2771100, __ZTISt11logic_error = Module.__ZTISt11logic_error = 2771236, __ZTISt9type_info = Module.__ZTISt9type_info = 2771508, __ZTVN10__cxxabiv116__shim_type_infoE = Module.__ZTVN10__cxxabiv116__shim_type_infoE = 2770500, __ZTVN10__cxxabiv123__fundamental_type_infoE = Module.__ZTVN10__cxxabiv123__fundamental_type_infoE = 2770528, __ZTVN10__cxxabiv119__pointer_type_infoE = Module.__ZTVN10__cxxabiv119__pointer_type_infoE = 2770984, __ZTIb = Module.__ZTIb = 2770584, __ZTIPKc = Module.__ZTIPKc = 2770600, __ZTIh = Module.__ZTIh = 2770616, __ZTIa = Module.__ZTIa = 2770624, __ZTIs = Module.__ZTIs = 2770632, __ZTIt = Module.__ZTIt = 2770640, __ZTIi = Module.__ZTIi = 2770648, __ZTIj = Module.__ZTIj = 2770656, __ZTIl = Module.__ZTIl = 2770664, __ZTIm = Module.__ZTIm = 2770672, __ZTIx = Module.__ZTIx = 2770680, __ZTIf = Module.__ZTIf = 2770688, __ZTId = Module.__ZTId = 2770696, __ZTVN10__cxxabiv117__array_type_infoE = Module.__ZTVN10__cxxabiv117__array_type_infoE = 2770704, __ZTVN10__cxxabiv120__function_type_infoE = Module.__ZTVN10__cxxabiv120__function_type_infoE = 2770744, __ZTVN10__cxxabiv116__enum_type_infoE = Module.__ZTVN10__cxxabiv116__enum_type_infoE = 2770772, __ZTVN10__cxxabiv117__pbase_type_infoE = Module.__ZTVN10__cxxabiv117__pbase_type_infoE = 2770956, __ZTVN10__cxxabiv129__pointer_to_member_type_infoE = Module.__ZTVN10__cxxabiv129__pointer_to_member_type_infoE = 2771012, __ZTVSt9bad_alloc = Module.__ZTVSt9bad_alloc = 2771040, __ZTVSt20bad_array_new_length = Module.__ZTVSt20bad_array_new_length = 2771060, __ZTISt9bad_alloc = Module.__ZTISt9bad_alloc = 2771140, __ZTISt20bad_array_new_length = Module.__ZTISt20bad_array_new_length = 2771152, __ZTSSt9exception = Module.__ZTSSt9exception = 2559709, __ZTVSt13bad_exception = Module.__ZTVSt13bad_exception = 2771108, __ZTISt13bad_exception = Module.__ZTISt13bad_exception = 2771128, __ZTSSt13bad_exception = Module.__ZTSSt13bad_exception = 2559722, __ZTSSt9bad_alloc = Module.__ZTSSt9bad_alloc = 2559740, __ZTSSt20bad_array_new_length = Module.__ZTSSt20bad_array_new_length = 2559753, __ZTVSt12domain_error = Module.__ZTVSt12domain_error = 2771204, __ZTISt12domain_error = Module.__ZTISt12domain_error = 2771224, __ZTSSt12domain_error = Module.__ZTSSt12domain_error = 2559778, __ZTSSt11logic_error = Module.__ZTSSt11logic_error = 2559795, __ZTVSt16invalid_argument = Module.__ZTVSt16invalid_argument = 2771248, __ZTISt16invalid_argument = Module.__ZTISt16invalid_argument = 2771268, __ZTSSt16invalid_argument = Module.__ZTSSt16invalid_argument = 2559811, __ZTVSt12length_error = Module.__ZTVSt12length_error = 2771280, __ZTISt12length_error = Module.__ZTISt12length_error = 2771300, __ZTSSt12length_error = Module.__ZTSSt12length_error = 2559832, __ZTVSt12out_of_range = Module.__ZTVSt12out_of_range = 2771312, __ZTISt12out_of_range = Module.__ZTISt12out_of_range = 2771332, __ZTSSt12out_of_range = Module.__ZTSSt12out_of_range = 2559849, __ZTVSt11range_error = Module.__ZTVSt11range_error = 2771344, __ZTISt11range_error = Module.__ZTISt11range_error = 2771364, __ZTSSt11range_error = Module.__ZTSSt11range_error = 2559866, __ZTSSt13runtime_error = Module.__ZTSSt13runtime_error = 2559882, __ZTVSt14overflow_error = Module.__ZTVSt14overflow_error = 2771388, __ZTISt14overflow_error = Module.__ZTISt14overflow_error = 2771408, __ZTSSt14overflow_error = Module.__ZTSSt14overflow_error = 2559900, __ZTVSt15underflow_error = Module.__ZTVSt15underflow_error = 2771420, __ZTISt15underflow_error = Module.__ZTISt15underflow_error = 2771440, __ZTSSt15underflow_error = Module.__ZTSSt15underflow_error = 2559919, __ZTVSt8bad_cast = Module.__ZTVSt8bad_cast = 2771452, __ZTVSt10bad_typeid = Module.__ZTVSt10bad_typeid = 2771472, __ZTISt8bad_cast = Module.__ZTISt8bad_cast = 2771516, __ZTISt10bad_typeid = Module.__ZTISt10bad_typeid = 2771528, __ZTVSt9type_info = Module.__ZTVSt9type_info = 2771492, __ZTSSt9type_info = Module.__ZTSSt9type_info = 2559939, __ZTSSt8bad_cast = Module.__ZTSSt8bad_cast = 2559952, __ZTSSt10bad_typeid = Module.__ZTSSt10bad_typeid = 2559964;
        function invoke_ii(e, t3) {
          var r = stackSave();
          try {
            return getWasmTableEntry(e)(t3);
          } catch (a3) {
            if (stackRestore(r), a3 !== a3 + 0) throw a3;
            _setThrew(1, 0);
          }
        }
        function invoke_vii(e, t3, r) {
          var a3 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r);
          } catch (o5) {
            if (stackRestore(a3), o5 !== o5 + 0) throw o5;
            _setThrew(1, 0);
          }
        }
        function invoke_viiiii(e, t3, r, a3, o5, _4) {
          var s5 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5, _4);
          } catch (n3) {
            if (stackRestore(s5), n3 !== n3 + 0) throw n3;
            _setThrew(1, 0);
          }
        }
        function invoke_vi(e, t3) {
          var r = stackSave();
          try {
            getWasmTableEntry(e)(t3);
          } catch (a3) {
            if (stackRestore(r), a3 !== a3 + 0) throw a3;
            _setThrew(1, 0);
          }
        }
        function invoke_v(e) {
          var t3 = stackSave();
          try {
            getWasmTableEntry(e)();
          } catch (r) {
            if (stackRestore(t3), r !== r + 0) throw r;
            _setThrew(1, 0);
          }
        }
        function invoke_iii(e, t3, r) {
          var a3 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r);
          } catch (o5) {
            if (stackRestore(a3), o5 !== o5 + 0) throw o5;
            _setThrew(1, 0);
          }
        }
        function invoke_viii(e, t3, r, a3) {
          var o5 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3);
          } catch (_4) {
            if (stackRestore(o5), _4 !== _4 + 0) throw _4;
            _setThrew(1, 0);
          }
        }
        function invoke_iiii(e, t3, r, a3) {
          var o5 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3);
          } catch (_4) {
            if (stackRestore(o5), _4 !== _4 + 0) throw _4;
            _setThrew(1, 0);
          }
        }
        function invoke_jii(e, t3, r) {
          var a3 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r);
          } catch (o5) {
            if (stackRestore(a3), o5 !== o5 + 0) throw o5;
            return _setThrew(1, 0), 0n;
          }
        }
        function invoke_iiiii(e, t3, r, a3, o5) {
          var _4 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5);
          } catch (s5) {
            if (stackRestore(_4), s5 !== s5 + 0) throw s5;
            _setThrew(1, 0);
          }
        }
        function invoke_i(e) {
          var t3 = stackSave();
          try {
            return getWasmTableEntry(e)();
          } catch (r) {
            if (stackRestore(t3), r !== r + 0) throw r;
            _setThrew(1, 0);
          }
        }
        function invoke_ji(e, t3) {
          var r = stackSave();
          try {
            return getWasmTableEntry(e)(t3);
          } catch (a3) {
            if (stackRestore(r), a3 !== a3 + 0) throw a3;
            return _setThrew(1, 0), 0n;
          }
        }
        function invoke_jiiiiiiiii(e, t3, r, a3, o5, _4, s5, n3, l2, d3) {
          var u3 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3, l2, d3);
          } catch (c4) {
            if (stackRestore(u3), c4 !== c4 + 0) throw c4;
            return _setThrew(1, 0), 0n;
          }
        }
        function invoke_jiiiiii(e, t3, r, a3, o5, _4, s5) {
          var n3 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4, s5);
          } catch (l2) {
            if (stackRestore(n3), l2 !== l2 + 0) throw l2;
            return _setThrew(1, 0), 0n;
          }
        }
        function invoke_viiii(e, t3, r, a3, o5) {
          var _4 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5);
          } catch (s5) {
            if (stackRestore(_4), s5 !== s5 + 0) throw s5;
            _setThrew(1, 0);
          }
        }
        function invoke_iiiiiiiiiiiiii(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4, f5, g4) {
          var m5 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4, f5, g4);
          } catch (p6) {
            if (stackRestore(m5), p6 !== p6 + 0) throw p6;
            _setThrew(1, 0);
          }
        }
        function invoke_vji(e, t3, r) {
          var a3 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r);
          } catch (o5) {
            if (stackRestore(a3), o5 !== o5 + 0) throw o5;
            _setThrew(1, 0);
          }
        }
        function invoke_viiji(e, t3, r, a3, o5) {
          var _4 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5);
          } catch (s5) {
            if (stackRestore(_4), s5 !== s5 + 0) throw s5;
            _setThrew(1, 0);
          }
        }
        function invoke_iiiij(e, t3, r, a3, o5) {
          var _4 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5);
          } catch (s5) {
            if (stackRestore(_4), s5 !== s5 + 0) throw s5;
            _setThrew(1, 0);
          }
        }
        function invoke_vijiji(e, t3, r, a3, o5, _4) {
          var s5 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5, _4);
          } catch (n3) {
            if (stackRestore(s5), n3 !== n3 + 0) throw n3;
            _setThrew(1, 0);
          }
        }
        function invoke_viji(e, t3, r, a3) {
          var o5 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3);
          } catch (_4) {
            if (stackRestore(o5), _4 !== _4 + 0) throw _4;
            _setThrew(1, 0);
          }
        }
        function invoke_iiiiii(e, t3, r, a3, o5, _4) {
          var s5 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4);
          } catch (n3) {
            if (stackRestore(s5), n3 !== n3 + 0) throw n3;
            _setThrew(1, 0);
          }
        }
        function invoke_iiiiiiiii(e, t3, r, a3, o5, _4, s5, n3, l2) {
          var d3 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3, l2);
          } catch (u3) {
            if (stackRestore(d3), u3 !== u3 + 0) throw u3;
            _setThrew(1, 0);
          }
        }
        function invoke_iiiiiiiiiiiiiiiiii(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4, f5, g4, m5, p6, h3, x4) {
          var b4 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4, f5, g4, m5, p6, h3, x4);
          } catch (M3) {
            if (stackRestore(b4), M3 !== M3 + 0) throw M3;
            _setThrew(1, 0);
          }
        }
        function invoke_iiiiiii(e, t3, r, a3, o5, _4, s5) {
          var n3 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4, s5);
          } catch (l2) {
            if (stackRestore(n3), l2 !== l2 + 0) throw l2;
            _setThrew(1, 0);
          }
        }
        function invoke_vj(e, t3) {
          var r = stackSave();
          try {
            getWasmTableEntry(e)(t3);
          } catch (a3) {
            if (stackRestore(r), a3 !== a3 + 0) throw a3;
            _setThrew(1, 0);
          }
        }
        function invoke_iiiiiiiiii(e, t3, r, a3, o5, _4, s5, n3, l2, d3) {
          var u3 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3, l2, d3);
          } catch (c4) {
            if (stackRestore(u3), c4 !== c4 + 0) throw c4;
            _setThrew(1, 0);
          }
        }
        function invoke_viij(e, t3, r, a3) {
          var o5 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3);
          } catch (_4) {
            if (stackRestore(o5), _4 !== _4 + 0) throw _4;
            _setThrew(1, 0);
          }
        }
        function invoke_viiiiiiii(e, t3, r, a3, o5, _4, s5, n3, l2) {
          var d3 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3, l2);
          } catch (u3) {
            if (stackRestore(d3), u3 !== u3 + 0) throw u3;
            _setThrew(1, 0);
          }
        }
        function invoke_viiiiiiiii(e, t3, r, a3, o5, _4, s5, n3, l2, d3) {
          var u3 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3, l2, d3);
          } catch (c4) {
            if (stackRestore(u3), c4 !== c4 + 0) throw c4;
            _setThrew(1, 0);
          }
        }
        function invoke_vij(e, t3, r) {
          var a3 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r);
          } catch (o5) {
            if (stackRestore(a3), o5 !== o5 + 0) throw o5;
            _setThrew(1, 0);
          }
        }
        function invoke_viiiiii(e, t3, r, a3, o5, _4, s5) {
          var n3 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5, _4, s5);
          } catch (l2) {
            if (stackRestore(n3), l2 !== l2 + 0) throw l2;
            _setThrew(1, 0);
          }
        }
        function invoke_iiji(e, t3, r, a3) {
          var o5 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3);
          } catch (_4) {
            if (stackRestore(o5), _4 !== _4 + 0) throw _4;
            _setThrew(1, 0);
          }
        }
        function invoke_ij(e, t3) {
          var r = stackSave();
          try {
            return getWasmTableEntry(e)(t3);
          } catch (a3) {
            if (stackRestore(r), a3 !== a3 + 0) throw a3;
            _setThrew(1, 0);
          }
        }
        function invoke_viiiiiii(e, t3, r, a3, o5, _4, s5, n3) {
          var l2 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3);
          } catch (d3) {
            if (stackRestore(l2), d3 !== d3 + 0) throw d3;
            _setThrew(1, 0);
          }
        }
        function invoke_viiiji(e, t3, r, a3, o5, _4) {
          var s5 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5, _4);
          } catch (n3) {
            if (stackRestore(s5), n3 !== n3 + 0) throw n3;
            _setThrew(1, 0);
          }
        }
        function invoke_iiiiiiii(e, t3, r, a3, o5, _4, s5, n3) {
          var l2 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3);
          } catch (d3) {
            if (stackRestore(l2), d3 !== d3 + 0) throw d3;
            _setThrew(1, 0);
          }
        }
        function invoke_iiij(e, t3, r, a3) {
          var o5 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3);
          } catch (_4) {
            if (stackRestore(o5), _4 !== _4 + 0) throw _4;
            _setThrew(1, 0);
          }
        }
        function invoke_vid(e, t3, r) {
          var a3 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r);
          } catch (o5) {
            if (stackRestore(a3), o5 !== o5 + 0) throw o5;
            _setThrew(1, 0);
          }
        }
        function invoke_j(e) {
          var t3 = stackSave();
          try {
            return getWasmTableEntry(e)();
          } catch (r) {
            if (stackRestore(t3), r !== r + 0) throw r;
            return _setThrew(1, 0), 0n;
          }
        }
        function invoke_ijji(e, t3, r, a3) {
          var o5 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3);
          } catch (_4) {
            if (stackRestore(o5), _4 !== _4 + 0) throw _4;
            _setThrew(1, 0);
          }
        }
        function invoke_iijj(e, t3, r, a3) {
          var o5 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3);
          } catch (_4) {
            if (stackRestore(o5), _4 !== _4 + 0) throw _4;
            _setThrew(1, 0);
          }
        }
        function invoke_jiii(e, t3, r, a3) {
          var o5 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3);
          } catch (_4) {
            if (stackRestore(o5), _4 !== _4 + 0) throw _4;
            return _setThrew(1, 0), 0n;
          }
        }
        function invoke_jij(e, t3, r) {
          var a3 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r);
          } catch (o5) {
            if (stackRestore(a3), o5 !== o5 + 0) throw o5;
            return _setThrew(1, 0), 0n;
          }
        }
        function invoke_ijiiiiii(e, t3, r, a3, o5, _4, s5, n3) {
          var l2 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3);
          } catch (d3) {
            if (stackRestore(l2), d3 !== d3 + 0) throw d3;
            _setThrew(1, 0);
          }
        }
        function invoke_viijii(e, t3, r, a3, o5, _4) {
          var s5 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5, _4);
          } catch (n3) {
            if (stackRestore(s5), n3 !== n3 + 0) throw n3;
            _setThrew(1, 0);
          }
        }
        function invoke_iiiiiji(e, t3, r, a3, o5, _4, s5) {
          var n3 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4, s5);
          } catch (l2) {
            if (stackRestore(n3), l2 !== l2 + 0) throw l2;
            _setThrew(1, 0);
          }
        }
        function invoke_viijiiii(e, t3, r, a3, o5, _4, s5, n3) {
          var l2 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3);
          } catch (d3) {
            if (stackRestore(l2), d3 !== d3 + 0) throw d3;
            _setThrew(1, 0);
          }
        }
        function invoke_vijjii(e, t3, r, a3, o5, _4) {
          var s5 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5, _4);
          } catch (n3) {
            if (stackRestore(s5), n3 !== n3 + 0) throw n3;
            _setThrew(1, 0);
          }
        }
        function invoke_vjii(e, t3, r, a3) {
          var o5 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3);
          } catch (_4) {
            if (stackRestore(o5), _4 !== _4 + 0) throw _4;
            _setThrew(1, 0);
          }
        }
        function invoke_jiiii(e, t3, r, a3, o5) {
          var _4 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5);
          } catch (s5) {
            if (stackRestore(_4), s5 !== s5 + 0) throw s5;
            return _setThrew(1, 0), 0n;
          }
        }
        function invoke_viiiiiiiiiiii(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4, f5) {
          var g4 = stackSave();
          try {
            getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3, l2, d3, u3, c4, f5);
          } catch (m5) {
            if (stackRestore(g4), m5 !== m5 + 0) throw m5;
            _setThrew(1, 0);
          }
        }
        function invoke_di(e, t3) {
          var r = stackSave();
          try {
            return getWasmTableEntry(e)(t3);
          } catch (a3) {
            if (stackRestore(r), a3 !== a3 + 0) throw a3;
            _setThrew(1, 0);
          }
        }
        function invoke_id(e, t3) {
          var r = stackSave();
          try {
            return getWasmTableEntry(e)(t3);
          } catch (a3) {
            if (stackRestore(r), a3 !== a3 + 0) throw a3;
            _setThrew(1, 0);
          }
        }
        function invoke_ijiiiii(e, t3, r, a3, o5, _4, s5) {
          var n3 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4, s5);
          } catch (l2) {
            if (stackRestore(n3), l2 !== l2 + 0) throw l2;
            _setThrew(1, 0);
          }
        }
        function invoke_iiiiiiiiiii(e, t3, r, a3, o5, _4, s5, n3, l2, d3, u3) {
          var c4 = stackSave();
          try {
            return getWasmTableEntry(e)(t3, r, a3, o5, _4, s5, n3, l2, d3, u3);
          } catch (f5) {
            if (stackRestore(c4), f5 !== f5 + 0) throw f5;
            _setThrew(1, 0);
          }
        }
        Module.addRunDependency = addRunDependency, Module.removeRunDependency = removeRunDependency, Module.callMain = callMain, Module.ENV = ENV, Module.addFunction = addFunction, Module.removeFunction = removeFunction, Module.setValue = setValue, Module.getValue = getValue, Module.UTF8ToString = UTF8ToString, Module.stringToNewUTF8 = stringToNewUTF8, Module.stringToUTF8OnStack = stringToUTF8OnStack, Module.FS_createPreloadedFile = FS_createPreloadedFile, Module.FS_unlink = FS_unlink, Module.FS_createPath = FS_createPath, Module.FS_createDevice = FS_createDevice, Module.FS = FS, Module.FS_createDataFile = FS_createDataFile, Module.FS_createLazyFile = FS_createLazyFile, Module.MEMFS = MEMFS, Module.PROXYFS = PROXYFS, Module.IDBFS = IDBFS;
        var calledRun;
        dependenciesFulfilled = function e() {
          calledRun || run(), calledRun || (dependenciesFulfilled = e);
        };
        function callMain(e = []) {
          var t3 = resolveGlobalSymbol("main").sym;
          if (t3) {
            e.unshift(thisProgram);
            var r = e.length, a3 = stackAlloc((r + 1) * 4), o5 = a3;
            e.forEach((s5) => {
              HEAPU32[o5 >> 2] = stringToUTF8OnStack(s5), o5 += 4;
            }), HEAPU32[o5 >> 2] = 0;
            try {
              var _4 = t3(r, a3);
              return exitJS(_4, true), _4;
            } catch (s5) {
              return handleException(s5);
            }
          }
        }
        function run(e = arguments_) {
          if (runDependencies > 0 || (preRun(), runDependencies > 0)) return;
          function t3() {
            calledRun || (calledRun = true, Module.calledRun = true, !ABORT && (initRuntime(), preMain(), readyPromiseResolve(Module), Module.onRuntimeInitialized?.(), shouldRunNow && callMain(e), postRun()));
          }
          Module.setStatus ? (Module.setStatus("Running..."), setTimeout(() => {
            setTimeout(() => Module.setStatus(""), 1), t3();
          }, 1)) : t3();
        }
        if (Module.preInit) for (typeof Module.preInit == "function" && (Module.preInit = [Module.preInit]); Module.preInit.length > 0; ) Module.preInit.pop()();
        var shouldRunNow = false;
        return Module.noInitialRun && (shouldRunNow = false), run(), moduleRtn = readyPromise, moduleRtn;
      };
    })();
    He3 = ht2;
    We3 = He3;
    ae2 = class {
      constructor(t3 = { results: [], throwOnError: false, onNotice: void 0, databaseError: null }) {
        this.results = [];
        this.throwOnError = false;
        this.databaseError = null;
        this.results = t3.results || [], this.throwOnError = t3.throwOnError || false, this.onNotice = t3.onNotice, this.databaseError = t3.databaseError === void 0 ? null : t3.databaseError;
      }
    };
    O3 = class O4 extends z2 {
      constructor(r = {}, a3 = {}) {
        super();
        R(this, S4);
        this.POSTGRES_MAIN_LONGJMP = 100;
        R(this, W4);
        R(this, oe2, false);
        R(this, _e2, false);
        R(this, se2, false);
        R(this, ie3, false);
        R(this, ke3, new J2());
        R(this, Te2, new J2());
        R(this, Pe2, new J2());
        R(this, Ce3, new J2());
        R(this, de3, false);
        this.debug = 0;
        R(this, ue3);
        R(this, Me3, []);
        R(this, pe2, new pe());
        R(this, ne);
        R(this, ee2);
        R(this, z3, /* @__PURE__ */ new Map());
        R(this, le2, /* @__PURE__ */ new Set());
        R(this, ce3, -1);
        R(this, A2, new ae2());
        R(this, me2, -1);
        R(this, $3, []);
        R(this, V2, 0);
        R(this, L4, new Uint8Array(0));
        R(this, B3, 0);
        R(this, he2, -1);
        R(this, xe3, -1);
        R(this, we2, -1);
        this.externalCommandStreamFd = null;
        R(this, ge2, false);
        typeof r == "string" ? a3 = { dataDir: r, ...a3 } : a3 = r, this.dataDir = a3.dataDir, a3.parsers !== void 0 && (this.parsers = { ...this.parsers, ...a3.parsers }), a3.serializers !== void 0 && (this.serializers = { ...this.serializers, ...a3.serializers }), a3?.debug !== void 0 && (this.debug = a3.debug), a3?.relaxedDurability !== void 0 && x(this, ie3, a3.relaxedDurability), x(this, ue3, a3.extensions ?? {}), this.waitReady = T(this, S4, Ye3).call(this, a3 ?? {});
      }
      get ENV() {
        return this.mod?.ENV;
      }
      static async create(r, a3) {
        let o5 = typeof r == "string" ? { dataDir: r, ...a3 ?? {} } : r ?? {}, _4 = new O4(o5);
        return await _4.waitReady, _4;
      }
      handleExternalCmd(r, a3) {
        if (r.startsWith("locale -a") && a3 === "r") {
          let o5 = this.mod.stringToUTF8OnStack("/pglite/locale-a"), _4 = this.mod.stringToUTF8OnStack(a3);
          return this.mod._fopen(o5, _4);
        }
        throw new Error("Unhandled cmd");
      }
      get Module() {
        return this.mod;
      }
      get ready() {
        return h(this, oe2) && !h(this, _e2) && !h(this, se2);
      }
      get closed() {
        return h(this, se2);
      }
      async close() {
        await this._checkReady(), x(this, _e2, true);
        for (let r of h(this, Me3)) await r();
        try {
          this.mod._pgl_setPGliteActive(0), await this.execProtocol(We2.end()), this.mod._pgl_run_atexit_funcs();
        } catch (r) {
          let a3 = r;
          a3.name === "ExitStatus" && a3.status === 0 || T(this, S4, U2).call(this, "An error occured while closing the db", r.toString());
        } finally {
          this.mod.removeFunction(h(this, me2)), this.mod.removeFunction(h(this, ce3));
        }
        await this.fs.closeFs(), x(this, se2, true), x(this, _e2, false), x(this, oe2, false), x(this, ge2, false);
        try {
          this.mod._emscripten_force_exit(0);
        } catch (r) {
          T(this, S4, U2).call(this, r), r.status !== 0 && T(this, S4, U2).call(this, "Error when exiting", r.toString());
        }
      }
      async [Symbol.asyncDispose]() {
        await this.close();
      }
      async _handleBlob(r) {
        x(this, ne, r ? await r.arrayBuffer() : void 0);
      }
      async _cleanupBlob() {
        x(this, ne, void 0);
      }
      async _getWrittenBlob() {
        if (!h(this, ee2)) return;
        let r = new Blob(h(this, ee2));
        return x(this, ee2, void 0), r;
      }
      async _checkReady() {
        if (h(this, _e2)) throw new Error("PGlite is closing");
        if (h(this, se2)) throw new Error("PGlite is closed");
        h(this, oe2) || await this.waitReady;
      }
      execProtocolRawSync(r) {
        let a3 = this.mod;
        if (x(this, V2, 0), x(this, B3, 0), x(this, $3, r), h(this, W4) || x(this, W4, T(this, S4, et2)), h(this, L4).length !== O4.DEFAULT_RECV_BUF_SIZE && x(this, L4, new Uint8Array(O4.DEFAULT_RECV_BUF_SIZE)), r[0] === 88) return new Uint8Array(0);
        if (r[0] === 0) return T(this, S4, st2).call(this, r);
        let o5 = p2.pgliteProc.exitCode;
        try {
          for (; h(this, V2) < r.length || a3._pq_buffer_remaining_data() > 0; ) try {
            a3._PostgresMainLoopOnce();
          } catch (_4) {
            _4.status === this.POSTGRES_MAIN_LONGJMP && a3._PostgresMainLongJmp();
          }
        } finally {
          a3._PostgresSendReadyForQueryIfNecessary(), a3._pgl_pq_flush(), p2.pgliteProc.exitCode = o5;
        }
        return x(this, $3, []), h(this, B3) ? new Uint8Array(h(this, L4).subarray(0, h(this, B3))) : new Uint8Array(0);
      }
      async execProtocolRaw(r, { syncToFs: a3 = true } = {}) {
        let o5 = this.execProtocolRawSync(r);
        return a3 && await this.syncToFs(), o5;
      }
      async execProtocolRawStream(r, { syncToFs: a3 = true, onRawData: o5 }) {
        x(this, W4, (_4) => (o5(_4), _4.length)), this.execProtocolRawSync(r), a3 && await this.syncToFs();
      }
      async execProtocol(r, { syncToFs: a3 = true, throwOnError: o5 = true, onNotice: _4 } = {}) {
        x(this, A2, new ae2({ throwOnError: o5, onNotice: _4 }));
        let s5 = await this.execProtocolRaw(r, { syncToFs: a3 }), n3 = h(this, A2).databaseError, l2 = { messages: h(this, A2).results, data: s5 };
        if (x(this, A2, new ae2()), x(this, W4, void 0), o5 && n3) throw x(this, pe2, new pe()), n3;
        return l2;
      }
      async execProtocolStream(r, { syncToFs: a3, throwOnError: o5 = true, onNotice: _4 } = {}) {
        x(this, A2, new ae2({ throwOnError: o5, onNotice: _4 })), x(this, W4, T(this, S4, qe2)), await this.execProtocolRaw(r, { syncToFs: a3 });
        let s5 = h(this, A2).databaseError, n3 = h(this, A2).results;
        if (x(this, A2, new ae2()), x(this, W4, void 0), o5 && s5) throw x(this, pe2, new pe()), s5;
        return n3;
      }
      isInTransaction() {
        return this.mod._IsTransactionBlock() !== 0;
      }
      async syncToFs() {
        if (h(this, de3)) return;
        x(this, de3, true);
        let r = async () => {
          await h(this, Ce3).runExclusive(async () => {
            x(this, de3, false), await this.fs.syncToFs(h(this, ie3));
          });
        };
        h(this, ie3) ? r() : await r();
      }
      async listen(r, a3, o5) {
        return this._runExclusiveListen(() => T(this, S4, rt2).call(this, r, a3, o5));
      }
      async unlisten(r, a3, o5) {
        return this._runExclusiveListen(() => T(this, S4, at3).call(this, r, a3, o5));
      }
      onNotification(r) {
        return h(this, le2).add(r), () => {
          h(this, le2).delete(r);
        };
      }
      offNotification(r) {
        h(this, le2).delete(r);
      }
      async dumpDataDir(r) {
        await this._checkReady();
        let a3 = this.dataDir?.split("/").pop() ?? "pgdata";
        return this.fs.dumpTar(a3, r);
      }
      _runExclusiveQuery(r) {
        return h(this, ke3).runExclusive(r);
      }
      _runExclusiveTransaction(r) {
        return h(this, Te2).runExclusive(r);
      }
      async clone() {
        let r = await this.dumpDataDir("none");
        return O4.create({ loadDataDir: r, extensions: h(this, ue3) });
      }
      _runExclusiveListen(r) {
        return h(this, Pe2).runExclusive(r);
      }
      callMain(r) {
        return this.mod.callMain(r);
      }
      copyToFS(r, a3, o5) {
        fe2(this.mod.FS, r, a3, o5);
      }
    };
    W4 = /* @__PURE__ */ new WeakMap(), oe2 = /* @__PURE__ */ new WeakMap(), _e2 = /* @__PURE__ */ new WeakMap(), se2 = /* @__PURE__ */ new WeakMap(), ie3 = /* @__PURE__ */ new WeakMap(), ke3 = /* @__PURE__ */ new WeakMap(), Te2 = /* @__PURE__ */ new WeakMap(), Pe2 = /* @__PURE__ */ new WeakMap(), Ce3 = /* @__PURE__ */ new WeakMap(), de3 = /* @__PURE__ */ new WeakMap(), ue3 = /* @__PURE__ */ new WeakMap(), Me3 = /* @__PURE__ */ new WeakMap(), pe2 = /* @__PURE__ */ new WeakMap(), ne = /* @__PURE__ */ new WeakMap(), ee2 = /* @__PURE__ */ new WeakMap(), z3 = /* @__PURE__ */ new WeakMap(), le2 = /* @__PURE__ */ new WeakMap(), ce3 = /* @__PURE__ */ new WeakMap(), A2 = /* @__PURE__ */ new WeakMap(), me2 = /* @__PURE__ */ new WeakMap(), $3 = /* @__PURE__ */ new WeakMap(), V2 = /* @__PURE__ */ new WeakMap(), L4 = /* @__PURE__ */ new WeakMap(), B3 = /* @__PURE__ */ new WeakMap(), he2 = /* @__PURE__ */ new WeakMap(), xe3 = /* @__PURE__ */ new WeakMap(), we2 = /* @__PURE__ */ new WeakMap(), ge2 = /* @__PURE__ */ new WeakMap(), S4 = /* @__PURE__ */ new WeakSet(), Xe2 = function(r) {
      this.debug && console.debug(r);
    }, Ke2 = function(r) {
      this.debug && console.error(r);
    }, Ye3 = async function(r) {
      let a3 = p2.pgliteProc.exitCode;
      if (r.fs) this.fs = r.fs;
      else {
        let { dataDir: m5, fsType: p6 } = Ze2(r.dataDir);
        this.fs = await je3(m5, p6);
      }
      let o5 = {}, _4 = [], s5 = [...this.debug ? ["-d", this.debug.toString()] : []];
      r.pgliteWasmModule || p2.startArtifactDownload(new URL("./pglite.wasm", import.meta.url)), r.initdbWasmModule || p2.startArtifactDownload(new URL("./initdb.wasm", import.meta.url));
      let n3 = new URL("./pglite.data", import.meta.url), l2 = r.fsBundle ? r.fsBundle.arrayBuffer() : p2.getFsBundle(n3), d3;
      l2.then((m5) => {
        d3 = m5;
      });
      let u3 = new WebAssembly.Memory({ initial: r.initialMemory ? r.initialMemory / (64 * 1024) : 2048, maximum: 32768 }), c4 = { thisProgram: wt, PGLITE_ENV: {}, WASM_PREFIX: p2.WASM_PREFIX, arguments: s5, noExitRuntime: true, wasmMemory: u3, stdin: () => null, print: (m5) => {
        T(this, S4, Xe2).call(this, m5);
      }, printErr: (m5) => {
        T(this, S4, Ke2).call(this, m5);
      }, instantiateWasm: (m5, p6) => {
        let h3 = new URL("./pglite.wasm", import.meta.url);
        return p2.instantiateWasm(m5, h3, r.pgliteWasmModule).then(({ instance: x4, module: b4 }) => {
          p6(x4, b4);
        }), {};
      }, getPreloadedPackage: (m5, p6) => {
        if (m5 === "pglite.data") {
          if (d3.byteLength !== p6) throw new Error(`Invalid FS bundle size: ${d3.byteLength} !== ${p6}`);
          return d3;
        }
        throw new Error(`Unknown package: ${m5}`);
      }, preRun: [(m5) => {
        m5.onRuntimeInitialized = () => {
          T(this, S4, Je2).call(this, m5);
        };
      }, (m5) => {
        let p6 = m5.FS.makedev(64, 0), h3 = { open: (x4) => {
        }, close: (x4) => {
        }, read: (x4, b4, M3, y5, E3) => {
          let F4 = h(this, ne);
          if (!F4) throw new Error("No /dev/blob File or Blob provided to read from");
          let k3 = new Uint8Array(F4);
          if (E3 >= k3.length) return 0;
          let R3 = Math.min(k3.length - E3, y5);
          for (let D5 = 0; D5 < R3; D5++) b4[M3 + D5] = k3[E3 + D5];
          return R3;
        }, write: (x4, b4, M3, y5, E3) => (h(this, ee2) ?? x(this, ee2, []), h(this, ee2).push(b4.slice(M3, M3 + y5)), y5), llseek: (x4, b4, M3) => {
          let y5 = h(this, ne);
          if (!y5) throw new Error("No /dev/blob File or Blob provided to llseek");
          let E3 = b4;
          if (M3 === 1 ? E3 += x4.position : M3 === 2 && (E3 = new Uint8Array(y5).length), E3 < 0) throw new m5.FS.ErrnoError(28);
          return E3;
        } };
        m5.FS.registerDevice(p6, h3), m5.FS.mkdev("/dev/blob", p6);
      }, (m5) => {
        m5.ENV.HOME = "/home/postgres", m5.ENV.USER = "postgres", m5.ENV.LOGNAME = "postgres", m5.ENV.PGDATA = B, m5.ENV.PGUSER = r.username ?? "postgres", m5.ENV.PGDATABASE = r.database ?? "postgres", m5.ENV.LANG = m5.ENV.LC_COLLATE = m5.ENV.LC_CTYPE = "en_US.UTF-8", m5.ENV.TZ = "UTC", m5.ENV.PGTZ = "UTC", m5.ENV.PGCLIENTENCODING = "UTF8", m5.ENV.ICU_DATA = jr, m5.PGLITE_ENV && Object.assign(m5.ENV, m5.PGLITE_ENV);
      }, (m5) => {
        m5.FS.chmod("/home/postgres/.pgpass", 384), m5.FS.chmod(Yr, 365), m5.FS.chmod(wt, 365);
      }] }, { emscriptenOpts: f5 } = await this.fs.init(this, c4);
      c4 = f5;
      let g4 = [];
      for (let [m5, p6] of Object.entries(h(this, ue3))) if (p6 instanceof URL) o5[m5] = Re3(p6);
      else {
        let h3 = await p6.setup(this, c4);
        if (h3.emscriptenOpts && (c4 = h3.emscriptenOpts), h3.namespaceObj) {
          let x4 = this;
          x4[m5] = h3.namespaceObj;
        }
        h3.bundlePath && (o5[m5] = Re3(h3.bundlePath)), h3.init && _4.push(h3.init), h3.close && h(this, Me3).push(h3.close), g4.push(...h3.sharedPreloadLibraries ?? []);
      }
      if (c4.pg_extensions = o5, await l2, this.mod = await We3(c4), await this.fs.initialSyncFs(), r.icuDataDir && await T(this, S4, $e2).call(this, r.icuDataDir), !r.noInitDb) {
        if (r.loadDataDir) {
          if (this.mod.FS.analyzePath(B + "/PG_VERSION").exists) throw new Error("Database already exists, cannot load from tarball");
          T(this, S4, U2).call(this, "pglite: loading data from tarball"), await at(this.mod.FS, r.loadDataDir, B);
        } else if (this.mod.FS.analyzePath(B + "/PG_VERSION").exists) T(this, S4, U2).call(this, "pglite: found DB, resuming");
        else {
          T(this, S4, U2).call(this, "pglite: no db in filesystem, running initdb");
          let m5 = { ...r };
          m5.noInitDb = true, m5.dataDir = void 0, m5.extensions = void 0, m5.loadDataDir = void 0;
          let p6 = await O3.create(m5), h3 = await At({ pg: p6, debug: r.debug, wasmModule: r.initdbWasmModule, args: r.initDbStartParams });
          if (h3.exitCode !== 0 && !h3.stderr.includes("exists but is not empty")) throw new Error("INITDB failed to initialize: " + h3.stderr);
          let x4 = await p6.dumpDataDir("none");
          p6.close(), await at(this.mod.FS, x4, B), await this.syncToFs();
        }
        await Ue3(this.mod, (...m5) => T(this, S4, U2).call(this, ...m5)), T(this, S4, Qe2).call(this, g4, r), this.mod._pgl_setPGliteActive(1), T(this, S4, _t2).call(this, { pgDataFolder: B, startParams: [...r.startParams || O3.defaultStartParams, ...this.debug ? ["-d", this.debug.toString()] : []] }), T(this, S4, ot2).call(this), x(this, oe2, true), r.username && await this.exec(`SET ROLE ${r.username};`), await this._initArrayTypes();
        for (let m5 of _4) await m5();
      }
      p2.pgliteProc.exitCode = a3;
    }, Qe2 = function(r, a3) {
      if (r.length && !a3.postgresqlconf && (a3.postgresqlconf = new Array()), a3.postgresqlconf) {
        let o5 = typeof a3.postgresqlconf == "string" ? a3.postgresqlconf : a3.postgresqlconf.join(`
`);
        if (r.length) {
          let _4 = o5.match(/^(shared_preload_libraries\s*=\s*)(.*)$/m);
          if (_4) {
            let s5 = _4[2].split(",").map((l2) => l2.trim()), n3 = [.../* @__PURE__ */ new Set([...s5, ...r])];
            o5 = o5.replace(_4[0], `${_4[1]}${n3.join(",")}`);
          } else o5 += `
shared_preload_libraries=${r.join(",")}`;
        }
        fe2(this.mod.FS, `${B}/postgresql.conf`, new TextEncoder().encode(o5));
      }
    }, $e2 = async function(r) {
      T(this, S4, U2).call(this, `pglite: icuDataDir specified, removing default icu data dir at ${jr}`), p2.rmdirRecursive(this.mod.FS, jr), T(this, S4, U2).call(this, `pglite: loading icu data from tarball ${r}`), this.mod.FS.mkdirTree(jr), await at(this.mod.FS, r, jr);
    }, Je2 = function(r) {
      x(this, he2, r.addFunction((a3) => (T(this, S4, U2).call(this, `Postgres tried to execute ${r.UTF8ToString(a3)}, returning 1.`), 1), "pi")), r._pgl_set_system_fn(h(this, he2)), x(this, xe3, r.addFunction((a3, o5) => {
        let _4 = r.UTF8ToString(o5), s5 = r.UTF8ToString(a3);
        return this.externalCommandStreamFd = this.handleExternalCmd(s5, _4), this.externalCommandStreamFd;
      }, "ppp")), r._pgl_set_popen_fn(h(this, xe3)), x(this, we2, r.addFunction((a3) => {
        if (a3 === this.externalCommandStreamFd) this.mod._fclose(this.externalCommandStreamFd), this.externalCommandStreamFd = null;
        else throw `Unhandled pclose ${a3}`;
        T(this, S4, U2).call(this, "pclose_fn", a3);
      }, "pi")), r._pgl_set_pclose_fn(h(this, we2)), x(this, ce3, r.addFunction((a3, o5) => {
        let _4;
        try {
          _4 = this.mod.HEAPU8.subarray(a3, a3 + o5);
        } catch (s5) {
          throw console.error("error", s5), s5;
        }
        return h(this, W4).call(this, _4);
      }, "iii")), x(this, me2, r.addFunction((a3, o5) => {
        let _4 = h(this, $3).length - h(this, V2);
        return _4 > o5 && (_4 = o5), this.mod.HEAP8.set(h(this, $3).subarray(h(this, V2), h(this, V2) + _4), a3), x(this, V2, h(this, V2) + _4), _4;
      }, "iii")), r._pgl_set_rw_cbs(h(this, me2), h(this, ce3));
    }, et2 = function(r) {
      let a3 = r.slice(), o5 = h(this, B3) + a3.length;
      if (o5 > h(this, L4).length) {
        let _4 = h(this, L4).length + (h(this, L4).length >> 1) + o5;
        o5 > O3.MAX_BUFFER_SIZE && (o5 = O3.MAX_BUFFER_SIZE);
        let s5 = new Uint8Array(_4);
        s5.set(h(this, L4).subarray(0, h(this, B3))), x(this, L4, s5);
      }
      return h(this, L4).set(a3, h(this, B3)), x(this, B3, h(this, B3) + a3.length), T(this, S4, qe2).call(this, a3);
    }, qe2 = function(r) {
      return h(this, pe2).parse(r, (a3) => {
        let o5 = T(this, S4, tt2).call(this, a3);
        o5 && h(this, A2).results.push(o5);
      }), r.length;
    }, tt2 = function(r) {
      if (!h(this, A2).databaseError) {
        if (r instanceof E) h(this, A2).throwOnError && (h(this, A2).databaseError = r);
        else if (r instanceof Z) this.debug > 0 && console.warn(r), h(this, A2).onNotice && h(this, A2).onNotice(r);
        else if (r instanceof K) {
          let a3 = h(this, z3).get(r.channel);
          a3 && a3.forEach((o5) => {
            queueMicrotask(() => o5(r.payload));
          }), h(this, le2).forEach((o5) => {
            queueMicrotask(() => o5(r.channel, r.payload));
          });
        }
        return r;
      }
      return null;
    }, U2 = function(...r) {
      this.debug > 0 && console.log(...r);
    }, rt2 = async function(r, a3, o5) {
      let _4 = p2.toPostgresName(r), s5 = o5 ?? this;
      h(this, z3).has(_4) || h(this, z3).set(_4, /* @__PURE__ */ new Set()), h(this, z3).get(_4).add(a3);
      try {
        await s5.exec(`LISTEN ${r}`);
      } catch (n3) {
        throw h(this, z3).get(_4).delete(a3), h(this, z3).get(_4)?.size === 0 && h(this, z3).delete(_4), n3;
      }
      return async (n3) => {
        await this.unlisten(_4, a3, n3);
      };
    }, at3 = async function(r, a3, o5) {
      let _4 = p2.toPostgresName(r), s5 = o5 ?? this, n3 = async () => {
        await s5.exec(`UNLISTEN ${r}`), h(this, z3).get(_4)?.size === 0 && h(this, z3).delete(_4);
      };
      a3 ? (h(this, z3).get(_4)?.delete(a3), h(this, z3).get(_4)?.size === 0 && await n3()) : await n3();
    }, ot2 = function() {
      if (h(this, ge2)) throw new Error("PGlite single mode already running");
      this.mod._pgl_startPGlite(), x(this, ge2, true);
    }, _t2 = function(r) {
      let a3 = [...r.startParams, "-D", r.pgDataFolder, this.mod.ENV.PGDATABASE];
      if (this.mod.callMain(a3) !== 99) throw new Error("PGlite failed to initialize properly");
    }, st2 = function(r) {
      x(this, V2, 0), x(this, B3, 0), x(this, $3, r);
      let a3 = this.mod._pgl_getMyProcPort();
      if (this.mod._ProcessStartupPacket(a3, true, true) !== 0) throw new Error(`Cannot process startup packet + ${r.toString()}`);
      return this.mod._pgl_sendConnData(), this.mod._pgl_pq_flush(), x(this, $3, []), h(this, B3) ? h(this, L4).subarray(0, h(this, B3)) : new Uint8Array(0);
    }, O3.paths = { PG_ROOT: I, PGDATA: B, ICU_DATA_PATH: jr, INITDB_EXE_PATH: Yr, POSTGRES_EXE_PATH: wt }, O3.DEFAULT_RECV_BUF_SIZE = 1 * 1024 * 1024, O3.MAX_BUFFER_SIZE = Math.pow(2, 30), O3.defaultStartParams = ["--single", "-F", "-O", "-j", "-c", "search_path=public", "-c", "exit_on_error=false", "-c", "log_checkpoints=false", "-c", "max_worker_processes=0", "-c", "max_parallel_workers=0", "-c", "max_parallel_workers_per_gather=0", "-c", "io_method=sync", "-c", "max_parallel_maintenance_workers=0"];
    Ve3 = O3;
    u();
  }
});

// node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js
var pg_trgm_exports = {};
__export(pg_trgm_exports, {
  pg_trgm: () => p5
});
var t2, p5;
var init_pg_trgm = __esm({
  "node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js"() {
    init_chunk_QY3QWFKW();
    u();
    t2 = async (n3, s5) => ({ bundlePath: new URL("../pg_trgm.tar.gz", import.meta.url) });
    p5 = { name: "pg_trgm", setup: t2 };
  }
});

// dist/embedding-client.js
var embedding_client_exports = {};
__export(embedding_client_exports, {
  embed: () => embed,
  embedWithProfile: () => embedWithProfile
});
async function embed(text, opts) {
  return (await embedWithProfile(text, opts)).vector;
}
async function embedWithProfile(text, opts) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("embed: empty text");
  }
  const profile = resolveEmbeddingProfile({
    profileId: opts?.profileId ?? process.env.VAULT_MIND_EMBED_PROFILE ?? DEFAULT_PROFILE,
    endpoint: opts?.url ?? process.env.VAULT_MIND_EMBED_URL,
    model: opts?.model ?? process.env.VAULT_MIND_EMBED_MODEL,
    dimensions: opts?.dimensions,
    defaultProfileId: DEFAULT_PROFILE
  });
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const abort2 = () => ctrl.abort();
  if (opts?.signal?.aborted)
    ctrl.abort();
  else
    opts?.signal?.addEventListener("abort", abort2, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(profile.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: text, model: profile.model }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const body3 = await res.text().catch(() => "");
      throw new Error(`embed: HTTP ${res.status} ${body3.slice(0, 200)}`);
    }
    const body2 = await res.json();
    const vec = body2.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) {
      throw new Error("embed: response missing data[0].embedding");
    }
    validateEmbeddingVector(vec, profile);
    return { vector: vec, fingerprint: embeddingFingerprint(profile) };
  } catch (e) {
    if (e?.name === "AbortError") {
      if (opts?.signal?.aborted)
        throw new Error("embed: aborted");
      throw new Error(`embed: timeout after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", abort2);
  }
}
var DEFAULT_PROFILE, DEFAULT_TIMEOUT_MS;
var init_embedding_client = __esm({
  "dist/embedding-client.js"() {
    "use strict";
    init_profile();
    DEFAULT_PROFILE = "ollama/bge-m3";
    DEFAULT_TIMEOUT_MS = 15e3;
  }
});

// dist/scripts/vault-cli.js
import { access } from "node:fs/promises";
import { resolve as resolve3 } from "node:path";
import { pathToFileURL } from "node:url";

// dist/adapters/registry.js
var AdapterRegistry = class {
  adapters = /* @__PURE__ */ new Map();
  defaultName = null;
  register(adapter) {
    this.adapters.set(adapter.name, adapter);
    if (this.defaultName === null) {
      this.defaultName = adapter.name;
    }
  }
  unregister(name2) {
    const deleted = this.adapters.delete(name2);
    if (this.defaultName === name2) {
      this.defaultName = this.adapters.size > 0 ? this.adapters.keys().next().value ?? null : null;
    }
    return deleted;
  }
  get(name2) {
    return this.adapters.get(name2);
  }
  getDefault() {
    if (this.defaultName === null)
      throw new Error("No adapters registered");
    const adapter = this.adapters.get(this.defaultName);
    if (!adapter)
      throw new Error(`Default adapter "${this.defaultName}" not found`);
    return adapter;
  }
  getByCapability(capability) {
    return [...this.adapters.values()].filter((a3) => a3.capabilities.includes(capability));
  }
  list() {
    return [...this.adapters.values()];
  }
  setDefault(name2) {
    if (!this.adapters.has(name2))
      throw new Error(`Adapter "${name2}" not registered`);
    this.defaultName = name2;
  }
};

// dist/adapters/filesystem.js
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, isAbsolute as isAbsolute2, join, relative, resolve, sep } from "node:path";

// dist/retrieval/evidence.js
import { createHash } from "node:crypto";
import { basename, isAbsolute } from "node:path";
var EVIDENCE_TIERS = ["compiled", "raw-evidence", "adapter-evidence"];
var FRESHNESS_STATES = ["fresh", "stale", "unknown", "incompatible"];
var EXTERNAL_ADAPTERS = /* @__PURE__ */ new Set(["qmd", "graphify", "lightrag", "raganything", "rag-anything", "hindsight"]);
var SENSITIVE_KEY = /(?:token|api[_-]?key|secret|password|authorization|credential)/i;
function normalizeSearchResult(result, adapterName = result.source) {
  if (result.evidence)
    return { ...result, evidence: sanitizeEvidence(result.evidence) };
  const metadata2 = result.metadata ?? {};
  const tier = inferEvidenceTier(adapterName, result.path, metadata2.evidenceTier);
  const originalIdentifier = stringValue(metadata2.uri) ?? stringValue(metadata2.originalIdentifier) ?? result.path;
  const providerId = normalizeProviderId(adapterName);
  const profileRevision = stringValue(metadata2.profileRevision);
  const sourceRevision = stringValue(metadata2.sourceRevision);
  const sourceId = stringValue(metadata2.sourceId);
  const freshness = inferFreshness(tier, metadata2);
  const missingCapabilities = stringArray(metadata2.missingCapabilities);
  const diagnosticCodes = normalizedDiagnosticCodes(metadata2.diagnosticCodes);
  const partial = metadata2.partial === true || missingCapabilities.length > 0 || diagnosticCodes.includes("PARTIAL_RESULT");
  const explanation = boundedText(metadata2.explanation ?? metadata2.context);
  return {
    ...result,
    evidence: {
      schemaVersion: 1,
      normalizedIdentifier: normalizedEvidenceIdentifier(providerId, result.path),
      tier,
      freshness,
      provenance: {
        providerId,
        originalIdentifier: redactIdentifier(originalIdentifier),
        ...sourceId ? { sourceId } : {},
        ...sourceRevision ? { sourceRevision } : {},
        ...profileRevision ? { profileRevision } : {},
        authority: tier === "compiled" ? "rebuildable-projection" : tier === "raw-evidence" ? "immutable-evidence" : "external-read-only"
      },
      scoreSemantics: inferScoreSemantics(adapterName),
      ...explanation ? { explanation } : {},
      partial: {
        status: partial ? "partial" : "complete",
        missingCapabilities,
        diagnosticCodes
      }
    }
  };
}
function buildRetrievalPlan(intentValue, detailValue) {
  const intent = normalizeIntent(intentValue);
  const detail = normalizeDetail(detailValue);
  const quotation = /(?:quote|quotation|verbatim|citation|原文|引用)/i.test(intent);
  const factual = /(?:fact|support|verify|evidence|事实|证据|核实)/i.test(intent);
  const navigation = /(?:navigate|overview|concept|relationship|browse|导航|概览|概念)/i.test(intent);
  const rawFirst = quotation || factual || detail === "high";
  const tierOrder = rawFirst ? ["raw-evidence", "compiled", "adapter-evidence"] : navigation ? ["compiled", "raw-evidence", "adapter-evidence"] : ["compiled", "adapter-evidence", "raw-evidence"];
  const fallbacks = [
    { from: "compiled", to: "raw-evidence", reason: "stale-projection" },
    { from: "compiled", to: "raw-evidence", reason: "missing-provenance" }
  ];
  if (quotation)
    fallbacks.push({ from: "compiled", to: "raw-evidence", reason: "quotation" });
  else if (factual)
    fallbacks.push({ from: "compiled", to: "raw-evidence", reason: "factual-support" });
  else if (detail === "high")
    fallbacks.push({ from: "compiled", to: "raw-evidence", reason: "high-detail" });
  return {
    schemaVersion: 1,
    intent,
    detail,
    tierOrder,
    requireFreshness: rawFirst,
    requireProvenance: rawFirst,
    fallbacks
  };
}
function routeEvidence(results, plan) {
  const normalized = results.map((result) => normalizeSearchResult(result));
  const needsRawFallback = normalized.some((result) => result.evidence.tier === "compiled" && (plan.requireFreshness && result.evidence.freshness.state !== "fresh" || plan.requireProvenance && !result.evidence.provenance.sourceRevision));
  const tierOrder = needsRawFallback ? uniqueTiers(["raw-evidence", ...plan.tierOrder]) : plan.tierOrder;
  const priority = new Map(tierOrder.map((tier, index) => [tier, index]));
  return normalized.sort((left, right) => (priority.get(left.evidence.tier) ?? 99) - (priority.get(right.evidence.tier) ?? 99) || right.score - left.score || left.evidence.normalizedIdentifier.localeCompare(right.evidence.normalizedIdentifier));
}
function boundedDiagnosticCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/(?:timeout|timed out|etimedout|abort)/i.test(message))
    return "PROVIDER_TIMEOUT";
  if (/(?:parse|json|schema|invalid|malformed)/i.test(message))
    return "INCOMPATIBLE_OUTPUT";
  if (SENSITIVE_KEY.test(message) || /https?:\/\/[^\s]+/i.test(message))
    return "SENSITIVE_ERROR_REDACTED";
  return "PROVIDER_UNAVAILABLE";
}
function redactTraceValue(value) {
  if (Array.isArray(value))
    return value.map(redactTraceValue);
  if (!value || typeof value !== "object")
    return typeof value === "string" ? redactIdentifier(value) : value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactTraceValue(item);
  }
  return output;
}
function sanitizeEvidence(value) {
  return {
    ...value,
    normalizedIdentifier: normalizedEvidenceIdentifier(value.provenance.providerId, value.normalizedIdentifier),
    provenance: {
      ...value.provenance,
      providerId: normalizeProviderId(value.provenance.providerId),
      originalIdentifier: redactIdentifier(value.provenance.originalIdentifier)
    },
    explanation: boundedText(value.explanation),
    partial: {
      status: value.partial.status,
      missingCapabilities: stringArray(value.partial.missingCapabilities),
      diagnosticCodes: normalizedDiagnosticCodes(value.partial.diagnosticCodes)
    }
  };
}
function inferEvidenceTier(adapterName, path, configured) {
  if (typeof configured === "string" && EVIDENCE_TIERS.includes(configured))
    return configured;
  if (EXTERNAL_ADAPTERS.has(adapterName.toLowerCase()))
    return "adapter-evidence";
  const portable = path.replace(/\\/g, "/").toLowerCase();
  if (/(?:^|\/)(?:wiki|concepts|summaries)(?:\/|$)/.test(portable) || portable.includes("_knowledge_base/"))
    return "compiled";
  if (portable.includes("00-inbox/evidence/") || portable.includes("/raw/") || portable.startsWith("raw/"))
    return "raw-evidence";
  return adapterName === "filesystem" ? "raw-evidence" : "adapter-evidence";
}
function inferFreshness(tier, metadata2) {
  const configured = stringValue(metadata2.freshness);
  if (configured && FRESHNESS_STATES.includes(configured)) {
    return { state: configured, ...stringValue(metadata2.observedAt) ? { observedAt: stringValue(metadata2.observedAt) } : {} };
  }
  const projectionRevision = stringValue(metadata2.projectionRevision);
  const activeSourceRevision = stringValue(metadata2.activeSourceRevision);
  if (tier === "compiled" && projectionRevision && activeSourceRevision) {
    return projectionRevision === activeSourceRevision ? { state: "fresh", reason: "projection-matches-active-source" } : { state: "stale", reason: "active-source-newer-than-projection" };
  }
  return { state: "unknown", reason: tier === "compiled" ? "projection-freshness-not-proven" : "provider-did-not-report-freshness" };
}
function inferScoreSemantics(adapterName) {
  switch (adapterName.toLowerCase()) {
    case "filesystem":
      return "literal-match";
    case "graphify":
      return "graph-proximity";
    case "qmd":
      return "provider-relevance";
    case "lightrag":
    case "raganything":
    case "rag-anything":
    case "hindsight":
      return "relative-rank";
    default:
      return "unknown";
  }
}
function normalizedEvidenceIdentifier(providerId, value) {
  if (/^llmwiki:\/\/evidence\//.test(value))
    return value;
  const portable = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const safe = portable.split("/").filter(Boolean).map((segment) => encodeURIComponent(segment)).join("/");
  if (safe && !isAbsolute(value) && !/^[a-z]:[\\/]/i.test(value))
    return `llmwiki://evidence/${providerId}/${safe}`;
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 20);
  return `llmwiki://evidence/${providerId}/redacted-${digest}`;
}
function redactIdentifier(value) {
  if (isAbsolute(value) || /^[a-z]:[\\/]/i.test(value)) {
    return `[redacted-local-path]/${basename(value.replace(/\\/g, "/"))}`;
  }
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()])
      if (SENSITIVE_KEY.test(key))
        url.searchParams.set(key, "[redacted]");
    return url.toString();
  } catch {
    return value.replace(/(bearer\s+)[^\s]+/gi, "$1[redacted]").replace(/((?:token|api[_-]?key|secret|password)=)[^&\s]+/gi, "$1[redacted]");
  }
}
function normalizeProviderId(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
function normalizeIntent(value) {
  return value?.replace(/\s+/g, " ").trim().slice(0, 120) || "general";
}
function normalizeDetail(value) {
  return value === "low" || value === "high" ? value : "medium";
}
function boundedText(value) {
  if (typeof value !== "string")
    return void 0;
  const safe = redactIdentifier(value).replace(/\s+/g, " ").trim();
  return safe ? safe.slice(0, 500) : void 0;
}
function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function stringArray(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))].sort() : [];
}
function normalizedDiagnosticCodes(value) {
  return stringArray(value).map((code) => code.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80));
}
function uniqueTiers(values) {
  return [...new Set(values)];
}

// dist/adapters/filesystem.js
function expandGlobBraces(pattern) {
  const start2 = pattern.indexOf("{");
  if (start2 === -1)
    return [pattern];
  const end = pattern.indexOf("}", start2 + 1);
  if (end === -1)
    return [pattern];
  const alternatives = pattern.slice(start2 + 1, end).split(",");
  return alternatives.flatMap((alternative) => expandGlobBraces(`${pattern.slice(0, start2)}${alternative}${pattern.slice(end + 1)}`));
}
function globToRegExp(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += /[\\^$+?.()|[\]{}]/.test(character) ? `\\${character}` : character;
    }
  }
  return new RegExp(`^(?:${source})$`);
}
function matchesGlob(relativePath, glob) {
  if (!glob)
    return true;
  const normalized = relativePath.replace(/\\/g, "/");
  return expandGlobBraces(glob.replace(/\\/g, "/")).some((pattern) => globToRegExp(pattern).test(normalized));
}
var exec = promisify(execFile);
var FilesystemAdapter = class {
  vaultPath;
  name = "filesystem";
  capabilities = ["search", "read", "write"];
  basePath;
  constructor(vaultPath) {
    this.vaultPath = vaultPath;
    this.basePath = vaultPath.endsWith(sep) ? vaultPath : vaultPath + sep;
  }
  async init() {
  }
  async dispose() {
  }
  async search(query, opts) {
    const maxResults = opts?.maxResults ?? 20;
    const args2 = [
      "--files-with-matches",
      "--fixed-strings",
      // treat query literal, not regex (ReDoS protection)
      "--max-count",
      "1"
      // stop after the first match in each file
    ];
    if (!opts?.caseSensitive)
      args2.push("-i");
    if (opts?.glob)
      args2.push("--glob", opts.glob);
    const scopedSearch = Boolean(opts?.glob);
    args2.push("--", query, scopedSearch ? "." : this.vaultPath);
    try {
      const { stdout } = await exec("rg", args2, {
        maxBuffer: 2 * 1024 * 1024,
        ...scopedSearch ? { cwd: this.vaultPath } : {}
      });
      const files = stdout.split(/\r?\n/).filter(Boolean).slice(0, maxResults);
      const results = [];
      for (const file of files) {
        try {
          const fullPath = isAbsolute2(file) ? file : join(this.vaultPath, file);
          const content = await readFile(fullPath, "utf-8");
          results.push(normalizeSearchResult({
            source: this.name,
            path: relative(this.vaultPath, fullPath).replace(/\\/g, "/"),
            content: this.extractSnippet(content, query, opts),
            score: 1
          }, this.name));
        } catch {
        }
      }
      return results;
    } catch (err2) {
      if (this.isExitCode(err2, 1))
        return [];
      return this.fallbackSearch(query, opts);
    }
  }
  async read(path) {
    const fullPath = this.resolvePath(path);
    return readFile(fullPath, "utf-8");
  }
  async write(path, content, dryRun = false) {
    const fullPath = this.resolvePath(path);
    if (dryRun)
      return;
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }
  // --- Internal ---
  resolvePath(p6) {
    const resolved = join(this.vaultPath, p6);
    if (resolved !== this.vaultPath && !resolved.startsWith(this.basePath)) {
      throw new Error(`Path traversal blocked: ${p6}`);
    }
    return resolved;
  }
  extractSnippet(content, query, opts) {
    const context = Math.max(0, opts?.context ?? 0);
    const needle = opts?.caseSensitive ? query : query.toLowerCase();
    const lines = content.split(/\r?\n/);
    for (let i3 = 0; i3 < lines.length; i3++) {
      const haystack = opts?.caseSensitive ? lines[i3] : lines[i3].toLowerCase();
      if (haystack.includes(needle)) {
        const start2 = Math.max(0, i3 - context);
        const end = Math.min(lines.length, i3 + context + 1);
        return lines.slice(start2, end).join("\n").trim();
      }
    }
    return lines.find((line) => line.trim())?.trim() ?? "";
  }
  parseRipgrepJson(stdout) {
    const results = [];
    for (const line of stdout.split("\n").filter(Boolean)) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "match") {
          const path = relative(this.vaultPath, msg.data.path.text).replace(/\\/g, "/");
          results.push(normalizeSearchResult({
            source: this.name,
            path,
            content: msg.data.lines.text.trim(),
            score: 1
            // ripgrep doesn't rank -- all matches equal
          }, this.name));
        }
      } catch {
      }
    }
    return results;
  }
  async fallbackSearch(query, opts) {
    const args2 = ["-r", "-l", "-F"];
    if (!opts?.caseSensitive)
      args2.push("-i");
    args2.push("--", query, this.vaultPath);
    try {
      const { stdout } = await exec("grep", args2, { maxBuffer: 5 * 1024 * 1024 });
      const files = stdout.split(/\r?\n/).filter(Boolean);
      const results = [];
      for (const file of files) {
        const fullPath = isAbsolute2(file) ? file : resolve(file);
        const relPath = relative(this.vaultPath, fullPath);
        if (relPath.startsWith("..") || isAbsolute2(relPath))
          continue;
        if (!matchesGlob(relPath, opts?.glob))
          continue;
        try {
          const content = await readFile(fullPath, "utf-8");
          results.push(normalizeSearchResult({
            source: this.name,
            path: relPath.replace(/\\/g, "/"),
            content: this.extractSnippet(content, query, opts),
            score: 1
          }, this.name));
          if (results.length >= (opts?.maxResults ?? 20))
            break;
        } catch {
        }
      }
      return results;
    } catch (err2) {
      if (this.isExitCode(err2, 1))
        return [];
      throw new Error("Search failed: neither ripgrep nor grep available");
    }
  }
  isExitCode(err2, code) {
    return !!err2 && typeof err2 === "object" && "code" in err2 && err2.code === code;
  }
};

// dist/adapters/vaultbrain/index.js
import { homedir } from "node:os";
import { join as join3 } from "node:path";

// dist/adapters/vaultbrain/schema.js
var EMBED_DIM = parseInt(process.env.VAULTBRAIN_EMBED_DIM ?? "1024", 10);
var VAULTBRAIN_CORE_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT,
  content TEXT,
  hash TEXT,
  mtime_ms BIGINT,
  size_bytes BIGINT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE pages ADD COLUMN IF NOT EXISTS mtime_ms BIGINT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS size_bytes BIGINT;

CREATE TABLE IF NOT EXISTS chunks (
  slug TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  token_count INTEGER,
  UNIQUE(slug, chunk_index)
);

CREATE TABLE IF NOT EXISTS vaultbrain_metadata (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS page_tags (
  slug TEXT,
  tag TEXT,
  PRIMARY KEY (slug, tag)
);

CREATE TABLE IF NOT EXISTS page_links (
  from_slug TEXT,
  to_slug TEXT,
  PRIMARY KEY (from_slug, to_slug)
);

CREATE INDEX IF NOT EXISTS chunks_trgm_idx
  ON chunks USING gin (chunk_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS chunks_slug_idx
  ON chunks (slug);

-- Full-text keyword search (bilingual floor, no embeddings required).
-- A generated tsvector stays in sync with chunk_text; ts_rank_cd over it ranks
-- English / multi-word NL phrases. CJK can't be word-segmented by 'simple', so
-- the engine RRF-fuses this with pg_trgm (chunks_trgm_idx above). ADD COLUMN
-- IF NOT EXISTS migrates stores created before this column existed.
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS chunk_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', chunk_text)) STORED;

CREATE INDEX IF NOT EXISTS chunks_tsv_idx
  ON chunks USING gin (chunk_tsv);
`;
var VAULTBRAIN_VECTOR_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding vector(${EMBED_DIM});

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);
`;

// dist/adapters/vaultbrain/pglite-engine.js
init_profile();

// dist/adapters/vaultbrain/embedding-index.js
var EmbeddingIndexRebuildRequiredError = class extends Error {
  code = "EMBEDDING_INDEX_REBUILD_REQUIRED";
  rebuildPlan;
  constructor(indexId, expectedFingerprint, actualFingerprint) {
    const reason = actualFingerprint ? "fingerprint-mismatch" : "missing-fingerprint";
    super(`Embedding index ${indexId} requires a per-index rebuild (${reason}); expected ${expectedFingerprint.digest}` + (actualFingerprint ? `, found ${actualFingerprint.digest}` : ""));
    this.name = "EmbeddingIndexRebuildRequiredError";
    this.rebuildPlan = {
      indexId,
      reason,
      steps: [
        `stop writes to ${indexId}`,
        `clear only ${indexId} vector rows and vector metadata`,
        `bind ${expectedFingerprint.profileId} (${expectedFingerprint.digest})`,
        `re-embed and verify ${indexId}`
      ],
      expectedFingerprint,
      ...actualFingerprint ? { actualFingerprint } : {}
    };
  }
};

// dist/adapters/vaultbrain/pglite-engine.js
var dynamicImport = new Function("specifier", "return import(specifier)");
var PGliteEngine = class {
  dataDir;
  db = null;
  // True only if the pgvector extension module loaded successfully. When false,
  // the schema/queries fall back to a keyword-only floor (see schema.ts) --
  // vector search is an optional upgrade, not a hard dependency.
  hasVector = false;
  constructor(dataDir) {
    this.dataDir = dataDir;
  }
  async connect() {
    const { PGlite } = await Promise.resolve().then(() => (init_dist(), dist_exports));
    const { pg_trgm } = await Promise.resolve().then(() => (init_pg_trgm(), pg_trgm_exports));
    let extensions = { pg_trgm };
    try {
      const { vector } = await dynamicImport("@electric-sql/pglite/vector");
      extensions = { vector, pg_trgm };
      this.hasVector = true;
    } catch (err2) {
      console.warn(`[vaultbrain] pgvector extension unavailable, falling back to keyword-only search: ${err2.message}`);
      this.hasVector = false;
    }
    this.db = new PGlite(this.dataDir, { extensions });
    await this.db.waitReady;
  }
  async disconnect() {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
  async initSchema() {
    const db = this.requireDb();
    await db.exec(VAULTBRAIN_CORE_SCHEMA_SQL);
    if (this.hasVector) {
      await db.exec(VAULTBRAIN_VECTOR_SCHEMA_SQL);
    }
  }
  async ensureEmbeddingFingerprint(fingerprint) {
    const db = this.requireDb();
    const { rows } = await db.query(`SELECT value_json FROM vaultbrain_metadata WHERE key = $1`, ["embedding-fingerprint"]);
    const serialized = rows[0]?.value_json;
    if (!serialized) {
      if (await this.countEmbeddedChunks() > 0) {
        throw new EmbeddingIndexRebuildRequiredError("vaultbrain", fingerprint);
      }
      await db.query(`INSERT INTO vaultbrain_metadata (key, value_json, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = now()`, ["embedding-fingerprint", JSON.stringify(fingerprint)]);
      return;
    }
    let stored;
    try {
      stored = JSON.parse(serialized);
    } catch {
      throw new EmbeddingIndexRebuildRequiredError("vaultbrain", fingerprint);
    }
    if (!stored.digest || !embeddingFingerprintsMatch(stored, fingerprint)) {
      throw new EmbeddingIndexRebuildRequiredError("vaultbrain", fingerprint, stored.digest ? stored : void 0);
    }
  }
  async upsertPage(slug, title, content, hash, stamp) {
    await this.requireDb().query(`INSERT INTO pages (slug, title, content, hash, mtime_ms, size_bytes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         hash = EXCLUDED.hash,
         mtime_ms = EXCLUDED.mtime_ms,
         size_bytes = EXCLUDED.size_bytes,
         updated_at = now()`, [slug, title, content, hash, stamp?.mtimeMs ?? null, stamp?.sizeBytes ?? null]);
  }
  async getPageHash(slug) {
    const { rows } = await this.requireDb().query(`SELECT hash FROM pages WHERE slug = $1`, [slug]);
    return rows[0]?.hash ?? null;
  }
  async getPageStamp(slug) {
    const { rows } = await this.requireDb().query(`SELECT mtime_ms, size_bytes FROM pages WHERE slug = $1`, [slug]);
    const row = rows[0];
    if (!row || row.mtime_ms === null || row.size_bytes === null)
      return null;
    return { mtimeMs: Number(row.mtime_ms), sizeBytes: Number(row.size_bytes) };
  }
  async listPageSlugs() {
    const { rows } = await this.requireDb().query(`SELECT slug FROM pages ORDER BY slug`);
    return rows.map((row) => row.slug);
  }
  async deletePage(slug) {
    const db = this.requireDb();
    await db.query(`DELETE FROM chunks WHERE slug = $1`, [slug]);
    await db.query(`DELETE FROM page_tags WHERE slug = $1`, [slug]);
    await db.query(`DELETE FROM page_links WHERE from_slug = $1 OR to_slug = $1`, [slug]);
    await db.query(`DELETE FROM pages WHERE slug = $1`, [slug]);
  }
  async clearPageMetadata(slug) {
    const db = this.requireDb();
    await db.query(`DELETE FROM page_tags WHERE slug = $1`, [slug]);
    await db.query(`DELETE FROM page_links WHERE from_slug = $1`, [slug]);
  }
  async replacePage(slug, title, content, hash, chunks, links, tags, stamp) {
    const db = this.requireDb();
    await db.transaction(async (tx) => {
      await tx.query(`DELETE FROM chunks WHERE slug = $1`, [slug]);
      await tx.query(`DELETE FROM page_tags WHERE slug = $1`, [slug]);
      await tx.query(`DELETE FROM page_links WHERE from_slug = $1`, [slug]);
      await this.upsertChunksOn(tx, slug, chunks);
      for (const toSlug of links) {
        await tx.query(`INSERT INTO page_links (from_slug, to_slug)
           VALUES ($1, $2)
           ON CONFLICT (from_slug, to_slug) DO NOTHING`, [slug, toSlug]);
      }
      for (const tag of tags) {
        await tx.query(`INSERT INTO page_tags (slug, tag)
           VALUES ($1, $2)
           ON CONFLICT (slug, tag) DO NOTHING`, [slug, tag]);
      }
      await tx.query(`INSERT INTO pages (slug, title, content, hash, mtime_ms, size_bytes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           hash = EXCLUDED.hash,
           mtime_ms = EXCLUDED.mtime_ms,
           size_bytes = EXCLUDED.size_bytes,
           updated_at = now()`, [slug, title, content, hash, stamp?.mtimeMs ?? null, stamp?.sizeBytes ?? null]);
    });
  }
  async upsertChunks(slug, chunks) {
    await this.upsertChunksOn(this.requireDb(), slug, chunks);
  }
  async upsertChunksOn(db, slug, chunks) {
    if (chunks.length === 0)
      return;
    for (const chunk of chunks) {
      if (!this.hasVector) {
        await db.query(`INSERT INTO chunks (slug, chunk_index, chunk_text, token_count)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (slug, chunk_index) DO UPDATE SET
             chunk_text = EXCLUDED.chunk_text,
             token_count = EXCLUDED.token_count`, [slug, chunk.chunkIndex, chunk.chunkText, chunk.tokenCount]);
        continue;
      }
      const embeddingStr = chunk.embedding && chunk.embedding.length > 0 ? JSON.stringify(chunk.embedding) : null;
      if (embeddingStr) {
        await db.query(`INSERT INTO chunks (slug, chunk_index, chunk_text, embedding, token_count)
           VALUES ($1, $2, $3, $4::vector, $5)
           ON CONFLICT (slug, chunk_index) DO UPDATE SET
             chunk_text = EXCLUDED.chunk_text,
             embedding = EXCLUDED.embedding,
             token_count = EXCLUDED.token_count`, [slug, chunk.chunkIndex, chunk.chunkText, embeddingStr, chunk.tokenCount]);
      } else {
        await db.query(`INSERT INTO chunks (slug, chunk_index, chunk_text, embedding, token_count)
           VALUES ($1, $2, $3, NULL, $4)
           ON CONFLICT (slug, chunk_index) DO UPDATE SET
             chunk_text = EXCLUDED.chunk_text,
             token_count = EXCLUDED.token_count`, [slug, chunk.chunkIndex, chunk.chunkText, chunk.tokenCount]);
      }
    }
  }
  async deleteChunks(slug) {
    await this.requireDb().query(`DELETE FROM chunks WHERE slug = $1`, [slug]);
  }
  async searchKeyword(query, limit) {
    const { rows } = await this.requireDb().query(`WITH q AS (
         SELECT to_tsquery('simple',
                  NULLIF(array_to_string(
                    tsvector_to_array(to_tsvector('simple', $1)), ' | '), '')
                ) AS tsq
       ),
       scored AS (
         SELECT slug, chunk_index, chunk_text,
                ts_rank_cd(chunk_tsv, (SELECT tsq FROM q)) AS ts_score,
                similarity(chunk_text, $1) AS trgm_score,
                (chunk_text ILIKE '%' || $1 || '%') AS substr_hit
         FROM chunks
         WHERE chunk_tsv @@ (SELECT tsq FROM q)
            OR similarity(chunk_text, $1) >= 0.1
            OR chunk_text ILIKE '%' || $1 || '%'
       ),
       ranked AS (
         SELECT slug, chunk_index, chunk_text, ts_score, trgm_score, substr_hit,
                rank() OVER (ORDER BY ts_score DESC)   AS ts_rank,
                rank() OVER (ORDER BY trgm_score DESC) AS trgm_rank
         FROM scored
       )
       SELECT slug, chunk_index, chunk_text,
              ( CASE WHEN ts_score   > 0 THEN 1.0 / (60 + ts_rank)   ELSE 0 END
              + CASE WHEN trgm_score > 0 THEN 1.0 / (60 + trgm_rank) ELSE 0 END
              + CASE WHEN substr_hit     THEN 1.0 / 60               ELSE 0 END
              ) AS score
       FROM ranked
       ORDER BY score DESC, slug, chunk_index
       LIMIT $2`, [query, limit]);
    return rows.map((r) => ({
      slug: r.slug,
      chunkIndex: r.chunk_index,
      chunkText: r.chunk_text,
      score: Number(r.score)
    }));
  }
  async searchVector(embedding, limit) {
    if (!this.hasVector)
      return [];
    const vecStr = JSON.stringify(embedding);
    const { rows } = await this.requireDb().query(`SELECT slug, chunk_index, chunk_text,
              1 - (embedding <=> $1::vector) AS score
       FROM chunks
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`, [vecStr, limit]);
    return rows.map((r) => ({
      slug: r.slug,
      chunkIndex: r.chunk_index,
      chunkText: r.chunk_text,
      score: Number(r.score)
    }));
  }
  async countChunks() {
    const { rows } = await this.requireDb().query(`SELECT count(*)::int AS n FROM chunks`);
    return Number(rows[0]?.n ?? 0);
  }
  async countEmbeddedChunks() {
    if (!this.hasVector)
      return 0;
    const { rows } = await this.requireDb().query(`SELECT count(*)::int AS n FROM chunks WHERE embedding IS NOT NULL`);
    return Number(rows[0]?.n ?? 0);
  }
  async getLastIndexedAtMs() {
    const { rows } = await this.requireDb().query(`SELECT MAX(updated_at) AS last FROM pages`);
    const last = rows[0]?.last;
    return last ? new Date(last).getTime() : null;
  }
  async setReindexState(state) {
    await this.requireDb().query(`INSERT INTO vaultbrain_metadata (key, value_json, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET
         value_json = EXCLUDED.value_json,
         updated_at = now()`, ["reindex-state", JSON.stringify(state)]);
  }
  async getReindexState() {
    const { rows } = await this.requireDb().query(`SELECT value_json FROM vaultbrain_metadata WHERE key = $1`, ["reindex-state"]);
    const value = rows[0]?.value_json;
    if (!value)
      return null;
    return JSON.parse(value);
  }
  async upsertLink(fromSlug, toSlug) {
    await this.requireDb().query(`INSERT INTO page_links (from_slug, to_slug)
       VALUES ($1, $2)
       ON CONFLICT (from_slug, to_slug) DO NOTHING`, [fromSlug, toSlug]);
  }
  async upsertTag(slug, tag) {
    await this.requireDb().query(`INSERT INTO page_tags (slug, tag)
       VALUES ($1, $2)
       ON CONFLICT (slug, tag) DO NOTHING`, [slug, tag]);
  }
  requireDb() {
    if (!this.db)
      throw new Error("PGliteEngine not connected. Call connect() first.");
    return this.db;
  }
};

// dist/adapters/vaultbrain/ingest.js
var CHARS_PER_TOKEN = 4;
var EMBED_BATCH_SIZE = 20;
async function getEmbedFn() {
  try {
    const { embedWithProfile: embedWithProfile2 } = await Promise.resolve().then(() => (init_embedding_client(), embedding_client_exports));
    return embedWithProfile2;
  } catch {
    return null;
  }
}
function chunkMarkdown(content, maxTokens = 512, overlap = 64) {
  if (!content.trim())
    return [];
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlap * CHARS_PER_TOKEN;
  const paragraphs = content.split(/\n\n+/).map((p6) => p6.trim()).filter(Boolean);
  const normalized = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      normalized.push(para);
      continue;
    }
    const sentences = para.split(/(?<=\.\s)/);
    const pieces = [];
    let buf = "";
    for (const sent of sentences) {
      if ((buf + sent).length > maxChars && buf) {
        pieces.push(buf);
        buf = sent;
      } else {
        buf += sent;
      }
    }
    if (buf)
      pieces.push(buf);
    const finalPieces = [];
    for (const piece of pieces) {
      if (piece.length <= maxChars) {
        finalPieces.push(piece);
      } else {
        for (let i3 = 0; i3 < piece.length; i3 += maxChars) {
          finalPieces.push(piece.slice(i3, i3 + maxChars));
        }
      }
    }
    normalized.push(...finalPieces);
  }
  const chunks = [];
  let current = "";
  for (const para of normalized) {
    if (!current) {
      current = para;
      continue;
    }
    const combined = current + "\n\n" + para;
    if (combined.length <= maxChars) {
      current = combined;
    } else {
      chunks.push(current);
      current = para;
    }
  }
  if (current)
    chunks.push(current);
  if (overlapChars > 0 && chunks.length > 1) {
    const withOverlap = [chunks[0]];
    for (let i3 = 1; i3 < chunks.length; i3++) {
      const prev = chunks[i3 - 1];
      const tail = prev.slice(Math.max(0, prev.length - overlapChars));
      withOverlap.push(tail + "\n\n" + chunks[i3]);
    }
    return withOverlap;
  }
  return chunks;
}
async function embedTextsWithProfile(texts, options) {
  if (texts.length === 0)
    return [];
  const embed2 = await getEmbedFn();
  if (!embed2) {
    console.warn("[vaultbrain] embedTexts: no embedding provider (VAULT_MIND_EMBED_URL not set, embedding-client unavailable)");
    return [];
  }
  const allEmbeddings = [];
  for (let i3 = 0; i3 < texts.length; i3 += EMBED_BATCH_SIZE) {
    if (options?.signal?.aborted)
      throw new Error("embedTexts: aborted");
    const batch = texts.slice(i3, i3 + EMBED_BATCH_SIZE);
    try {
      const results = await Promise.all(batch.map((t3) => embed2(t3, options)));
      allEmbeddings.push(...results);
    } catch (err2) {
      if (options?.signal?.aborted)
        throw err2;
      console.warn(`[vaultbrain] embedTexts batch error: ${err2.message}`);
      return [];
    }
  }
  return allEmbeddings;
}

// dist/adapters/vaultbrain/index.js
var RRF_K = 60;
var VaultBrainAdapter = class {
  dataDir;
  embedding;
  name = "vaultbrain";
  capabilities = ["search", "embeddings"];
  engine = null;
  _available = false;
  mutationTails = /* @__PURE__ */ new Map();
  get isAvailable() {
    return this._available;
  }
  constructor(dataDir, embedding = {}) {
    this.dataDir = dataDir;
    this.embedding = embedding;
  }
  async init() {
    const dir = this.dataDir ?? join3(homedir(), ".vault-mind", "vaultbrain");
    try {
      const engine = new PGliteEngine(dir);
      await engine.connect();
      await engine.initSchema();
      this.engine = engine;
      this._available = true;
    } catch (err2) {
      console.warn(`[vaultbrain] init failed, adapter disabled: ${err2.message}`);
      this.engine = null;
      this._available = false;
    }
  }
  async dispose() {
    if (this.engine) {
      try {
        await this.engine.disconnect();
      } catch {
      }
      this.engine = null;
    }
  }
  /** Chunk count -- lazy backfill uses this to detect an empty (never-indexed) store. */
  async countChunks() {
    return this.engine ? this.engine.countChunks() : 0;
  }
  /** Embedded chunk count -- 0 while chunks exist means Ollama never embedded (semantic off). */
  async countEmbeddedChunks() {
    return this.engine ? this.engine.countEmbeddedChunks() : 0;
  }
  /** Index-wide last-write watermark (epoch ms) -- vault-status uses this for staleness detection. */
  async getLastIndexedAtMs() {
    return this.engine ? this.engine.getLastIndexedAtMs() : null;
  }
  async search(query, opts) {
    if (!this.engine)
      return [];
    const limit = opts?.maxResults ?? 20;
    const perListLimit = Math.ceil(limit * 2);
    let kwResults = [];
    try {
      kwResults = await this.engine.searchKeyword(query, perListLimit);
    } catch {
    }
    let vecResults = [];
    try {
      const embeddings = await embedTextsWithProfile([query], this.embedOptions());
      const result = embeddings[0];
      if (result && result.vector.length > 0) {
        await this.engine.ensureEmbeddingFingerprint(result.fingerprint);
        vecResults = await this.engine.searchVector(result.vector, perListLimit);
      }
    } catch (error) {
      if (error instanceof EmbeddingIndexRebuildRequiredError)
        throw error;
    }
    const scoreMap = /* @__PURE__ */ new Map();
    for (let rank = 0; rank < kwResults.length; rank++) {
      const r = kwResults[rank];
      const key = `${r.slug}::${r.chunkIndex}`;
      const rrfScore = 1 / (RRF_K + rank);
      const existing = scoreMap.get(key);
      if (existing)
        existing.score += rrfScore;
      else
        scoreMap.set(key, { result: r, score: rrfScore });
    }
    for (let rank = 0; rank < vecResults.length; rank++) {
      const r = vecResults[rank];
      const key = `${r.slug}::${r.chunkIndex}`;
      const rrfScore = 1 / (RRF_K + rank);
      const existing = scoreMap.get(key);
      if (existing)
        existing.score += rrfScore;
      else
        scoreMap.set(key, { result: r, score: rrfScore });
    }
    return Array.from(scoreMap.values()).sort((a3, b4) => b4.score - a3.score).slice(0, limit).map(({ result, score }) => ({
      source: this.name,
      path: result.slug,
      content: result.chunkText,
      score
    }));
  }
  /**
   * Ingest a Markdown file, skipping unchanged content before rebuilding chunks.
   * Returns true when the page is written and false when no write occurs.
   */
  async ingest(path, content, stamp, signal) {
    const slug = pathToSlug(path);
    return this.enqueueMutation(slug, async () => {
      if (!this.engine)
        return false;
      if (signal?.aborted)
        throw new Error("VaultBrain ingest aborted");
      const title = extractTitle(content);
      const hash = simpleHash(content);
      if (await this.engine.getPageHash(slug) === hash)
        return false;
      const chunks = chunkMarkdown(content);
      const embeddings = await embedTextsWithProfile(chunks, {
        ...this.embedOptions(),
        signal
      });
      if (signal?.aborted)
        throw new Error("VaultBrain ingest aborted");
      if (embeddings[0]) {
        await this.engine.ensureEmbeddingFingerprint(embeddings[0].fingerprint);
        if (embeddings.some((result) => result.fingerprint.digest !== embeddings[0].fingerprint.digest)) {
          throw new Error("VaultBrain embedding batch returned mixed profile fingerprints");
        }
      }
      if (signal?.aborted)
        throw new Error("VaultBrain ingest aborted");
      await this.engine.replacePage(slug, title, content, hash, chunks.map((chunkText, i3) => ({
        chunkIndex: i3,
        chunkText,
        embedding: embeddings[i3]?.vector ?? null,
        tokenCount: Math.ceil(chunkText.length / 4)
      })), extractWikiLinks(content), extractTags(content), stamp);
      return true;
    });
  }
  async listIndexedSlugs() {
    if (!this.engine)
      return [];
    return this.engine.listPageSlugs();
  }
  async getIndexedStamp(path) {
    if (!this.engine)
      return null;
    return this.engine.getPageStamp(pathToSlug(path));
  }
  async setReindexState(state) {
    if (this.engine)
      await this.engine.setReindexState(state);
  }
  async getReindexState() {
    if (!this.engine)
      return null;
    return this.engine.getReindexState();
  }
  async deletePath(path, signal) {
    await this.deleteSlug(pathToSlug(path), signal);
  }
  async deleteSlug(slug, signal) {
    await this.enqueueMutation(slug, async () => {
      if (signal?.aborted)
        throw new Error("VaultBrain delete aborted");
      if (this.engine)
        await this.engine.deletePage(slug);
    });
  }
  enqueueMutation(slug, mutation) {
    const previous = this.mutationTails.get(slug) ?? Promise.resolve();
    const current = previous.catch(() => void 0).then(mutation);
    this.mutationTails.set(slug, current);
    const clear = () => {
      if (this.mutationTails.get(slug) === current)
        this.mutationTails.delete(slug);
    };
    void current.then(clear, clear);
    return current;
  }
  embedOptions() {
    return {
      profileId: this.embedding.profileId,
      url: this.embedding.endpoint,
      model: this.embedding.model,
      dimensions: this.embedding.dimensions
    };
  }
};
function pathToSlug(path) {
  return path.replace(/\\/g, "/").replace(/\.md$/, "");
}
function extractTitle(content) {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1)
    return h1[1].trim();
  const lines = content.split("\n").filter((l2) => l2.trim());
  return lines[0]?.slice(0, 80) ?? "";
}
function simpleHash(content) {
  let h3 = 5381;
  for (let i3 = 0; i3 < content.length; i3++) {
    h3 = (h3 << 5) + h3 + content.charCodeAt(i3);
    h3 = h3 & h3;
  }
  return (h3 >>> 0).toString(16);
}
function extractWikiLinks(content) {
  const matches = content.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g);
  return [...matches].map((m5) => m5[1].trim().toLowerCase().replace(/\s+/g, "-"));
}
function extractTags(content) {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter)
    return [];
  const inlineTags = frontmatter[1].match(/^tags:\s*\[([^\]]+)\]/m);
  const blockTags = frontmatter[1].match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
  const tagSource = inlineTags?.[1] ?? blockTags?.[1];
  if (!tagSource)
    return [];
  return tagSource.split(/[\n,]/).map((t3) => t3.replace(/^-\s*/, "").replace(/['"]/g, "").trim()).filter(Boolean);
}

// dist/adapters/vaultbrain/lazy-index.js
import { existsSync as existsSync2, readdirSync, readFileSync, statSync } from "node:fs";
import { join as join4, relative as relative2 } from "node:path";
var PROTECTED_DIRS = {
  ".git": true,
  ".obsidian": true,
  ".vault-mind": true,
  "node_modules": true,
  "wiki": true,
  ".trash": true
};
var DEFAULT_SYNC_CAP = 300;
var _vba = null;
var _vaultPath = "";
var _inFlight = null;
var _backfillAbortController = null;
function configureLazyIndex(vba, vaultPath) {
  _vba = vba;
  _vaultPath = vaultPath;
}
function scanVaultMarkdown(vaultPath) {
  const files = [];
  let complete = true;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      complete = false;
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && PROTECTED_DIRS[e.name] !== true)
          walk(join4(dir, e.name));
      } else if (e.isFile() && !e.name.startsWith(".") && e.name.endsWith(".md")) {
        files.push(join4(dir, e.name));
      }
    }
  };
  walk(vaultPath);
  return { files, complete };
}
async function reindexVault(vba, vaultPath, opts) {
  const scan = scanVaultMarkdown(vaultPath);
  const candidates = scan.files.map((fullPath) => {
    let stamp = null;
    try {
      const stats = statSync(fullPath);
      stamp = { mtimeMs: Math.floor(stats.mtimeMs), sizeBytes: stats.size };
    } catch {
    }
    return {
      fullPath,
      relativePath: relative2(vaultPath, fullPath).replace(/\\/g, "/"),
      stamp
    };
  });
  const errors = [];
  const startedAt = Date.now();
  const report = (event) => {
    try {
      opts?.onProgress?.(event);
    } catch (error) {
      errors.push(`progress: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const persist = async (state) => {
    try {
      await vba.setReindexState(state);
    } catch (error) {
      errors.push(`reindex state: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await persist({
    status: "running",
    startedAt,
    indexed: 0,
    total: candidates.length,
    skipped: 0,
    deleted: 0,
    errors: []
  });
  report({ phase: "scan", completed: 0, total: candidates.length });
  let indexedSlugs = /* @__PURE__ */ new Set();
  try {
    indexedSlugs = new Set(await vba.listIndexedSlugs());
  } catch (error) {
    errors.push(`indexed paths: ${error instanceof Error ? error.message : String(error)}`);
  }
  const currentSlugs = new Set(candidates.map((candidate) => pathToSlug(candidate.relativePath)));
  const concurrency = Math.max(1, Math.floor(opts?.concurrency ?? 4));
  let indexed = 0;
  let skipped = 0;
  let deleted = 0;
  if (!scan.complete)
    errors.push("vault scan incomplete; stale deletion skipped");
  for (let i3 = 0; i3 < candidates.length; i3 += concurrency) {
    if (opts?.signal?.aborted) {
      errors.push("reindex cancelled");
      break;
    }
    const batch = candidates.slice(i3, i3 + concurrency);
    const outcomes = await Promise.all(batch.map(async (candidate) => {
      try {
        if (opts?.signal?.aborted)
          return { kind: "cancelled" };
        if (candidate.stamp) {
          const indexedStamp = await vba.getIndexedStamp(candidate.relativePath);
          if (indexedStamp && indexedStamp.mtimeMs === candidate.stamp.mtimeMs && indexedStamp.sizeBytes === candidate.stamp.sizeBytes) {
            return { kind: "skipped" };
          }
        }
        const content = readFileSync(candidate.fullPath, "utf-8");
        const changed = await vba.ingest(candidate.relativePath, content, candidate.stamp ?? void 0, opts?.signal);
        return changed === false ? { kind: "skipped" } : { kind: "indexed" };
      } catch (error) {
        return {
          kind: "error",
          path: candidate.relativePath,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }));
    for (const outcome of outcomes) {
      if (outcome.kind === "indexed")
        indexed++;
      else if (outcome.kind === "skipped")
        skipped++;
      else if (outcome.kind === "cancelled")
        errors.push("reindex cancelled");
      else
        errors.push(`${outcome.path}: ${outcome.message}`);
    }
    report({ phase: "index", completed: indexed + skipped, total: candidates.length });
    if (opts?.signal?.aborted) {
      errors.push("reindex cancelled");
      break;
    }
  }
  if (scan.complete && !opts?.signal?.aborted) {
    for (const slug of indexedSlugs) {
      if (currentSlugs.has(slug) || existsSync2(join4(vaultPath, `${slug}.md`)))
        continue;
      try {
        await vba.deleteSlug(slug, opts?.signal);
        deleted++;
        report({ phase: "delete", completed: deleted, total: indexedSlugs.size });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${slug}: ${message}`);
      }
    }
  }
  const result = { indexed, total: candidates.length, skipped, deleted, errors };
  report({ phase: "complete", completed: indexed + skipped, total: candidates.length });
  await persist({
    ...result,
    status: errors.length === 0 && scan.complete ? "complete" : "incomplete",
    startedAt,
    finishedAt: Date.now()
  });
  return result;
}
async function ensureBackfill(opts) {
  const vba = _vba;
  if (!vba || !vba.isAvailable)
    return { status: "unavailable" };
  if (_inFlight)
    return { status: "in_progress" };
  let release;
  const lock = new Promise((r) => {
    release = r;
  });
  _inFlight = lock;
  void lock.then(() => {
    if (_inFlight === lock)
      _inFlight = null;
  });
  const done = (o5) => {
    release();
    return o5;
  };
  let count = 0;
  let priorState = null;
  if (!opts?.force) {
    try {
      count = await vba.countChunks();
      priorState = await vba.getReindexState();
    } catch {
      return done({ status: "unavailable" });
    }
    if (count > 0 && (!priorState || priorState.status === "complete")) {
      return done({ status: "populated" });
    }
  }
  const scan = scanVaultMarkdown(_vaultPath);
  if (!scan.complete)
    return done({ status: "unavailable", fileCount: scan.files.length });
  const fileCount = scan.files.length;
  const controller = new AbortController();
  _backfillAbortController = controller;
  const releaseController = () => {
    if (_backfillAbortController === controller)
      _backfillAbortController = null;
  };
  const reindexOpts = { signal: controller.signal };
  const syncCap = opts?.syncCap ?? DEFAULT_SYNC_CAP;
  if (fileCount <= syncCap) {
    try {
      await reindexVault(vba, _vaultPath, reindexOpts);
    } finally {
      releaseController();
      release();
    }
    return { status: "indexed_sync", fileCount };
  }
  void reindexVault(vba, _vaultPath, reindexOpts).then((result) => {
    for (const error of result.errors) {
      process.stderr.write(`obsidian-llm-wiki: [vaultbrain] background reindex warning: ${error}
`);
    }
  }).catch((error) => {
    process.stderr.write(`obsidian-llm-wiki: [vaultbrain] background reindex error: ${error instanceof Error ? error.message : String(error)}
`);
  }).finally(() => {
    releaseController();
    release();
  });
  return { status: "indexing_background", fileCount };
}

// dist/rrf.js
var RRF_K2 = 60;
function fuseRRF(bundles, getKey = (r) => r.path) {
  const scored = /* @__PURE__ */ new Map();
  for (const bundle of bundles) {
    const seenInBundle = /* @__PURE__ */ new Set();
    bundle.results.forEach((r, i3) => {
      const key = getKey(r);
      if (seenInBundle.has(key))
        return;
      seenInBundle.add(key);
      const rank = i3 + 1;
      const contribution = bundle.weight / (RRF_K2 + rank);
      const prev = scored.get(key);
      if (prev) {
        prev.score += contribution;
        prev.sources.add(bundle.source);
      } else {
        scored.set(key, {
          key,
          result: { ...r, source: bundle.source },
          score: contribution,
          sources: /* @__PURE__ */ new Set([bundle.source])
        });
      }
    });
  }
  return _sortCandidates(Array.from(scored.values()));
}
function _sortCandidates(candidates) {
  return candidates.sort((a3, b4) => {
    const delta = b4.score - a3.score;
    if (delta !== 0)
      return delta;
    return a3.key.localeCompare(b4.key);
  }).map((c4) => ({
    ...c4.result,
    score: c4.score,
    metadata: {
      ...c4.result.metadata,
      rrfSources: Array.from(c4.sources)
    }
  }));
}

// dist/unified-query.js
async function unifiedQuery(registry, query, opts) {
  const searchAdapters = registry.getByCapability("search");
  const filtered = opts?.adapters ? searchAdapters.filter((a3) => opts.adapters.includes(a3.name)) : searchAdapters;
  if (filtered.length === 0) {
    return { results: [], sources: {}, totalResults: 0 };
  }
  const weights = opts?.weights ?? {};
  const sources = {};
  const retrievalPlan = buildRetrievalPlan(opts?.intent, opts?.detail);
  const totalMax = opts?.maxResults ?? 50;
  const perAdapterMax = Math.max(totalMax, Math.ceil(totalMax * 1.5 / filtered.length));
  const settled = await Promise.allSettled(filtered.map(async (adapter) => {
    const start2 = Date.now();
    const w4 = weights[adapter.name] ?? 1;
    try {
      const results = await adapter.search(query, { ...opts, maxResults: perAdapterMax });
      sources[adapter.name] = { count: results.length, latencyMs: Date.now() - start2 };
      return {
        source: adapter.name,
        weight: w4,
        results: results.map((r) => normalizeSearchResult({ ...r, source: adapter.name }, adapter.name))
      };
    } catch (e) {
      const diagnosticCode = boundedDiagnosticCode(e);
      sources[adapter.name] = {
        count: 0,
        latencyMs: Date.now() - start2,
        error: diagnosticCode,
        diagnosticCode
      };
      return { source: adapter.name, weight: w4, results: [] };
    }
  }));
  const bundles = [];
  for (const r of settled) {
    if (r.status === "fulfilled")
      bundles.push(r.value);
  }
  const fused = fuseRRF(bundles).map((result) => normalizeSearchResult(result));
  const merged = opts?.tierRouting === false ? fused : routeEvidence(fused, retrievalPlan);
  const maxResults = opts?.maxResults ?? 50;
  return {
    results: merged.slice(0, maxResults),
    sources,
    totalResults: merged.length
  };
}
async function traceUnifiedQuery(registry, query, opts) {
  const searchAdapters = registry.getByCapability("search");
  const selected = opts?.adapters ? searchAdapters.filter((a3) => opts.adapters.includes(a3.name)) : searchAdapters;
  const requestedAdapters = opts?.adapters ?? "all-search-capable";
  const result = await unifiedQuery(registry, query, opts);
  const weights = opts?.weights ?? {};
  const branches = selected.map((adapter) => {
    const stats = result.sources[adapter.name];
    const weight = weights[adapter.name] ?? 1;
    if (!stats) {
      return {
        adapter: adapter.name,
        capabilities: [...adapter.capabilities],
        weight,
        status: "skipped",
        count: 0,
        latencyMs: 0
      };
    }
    return {
      adapter: adapter.name,
      capabilities: [...adapter.capabilities],
      weight,
      status: stats.error ? "error" : "ok",
      count: stats.count,
      latencyMs: stats.latencyMs,
      error: stats.error,
      diagnosticCode: stats.diagnosticCode
    };
  });
  const evidence = result.results.map((item, index) => ({
    rank: index + 1,
    source: item.source,
    path: item.path,
    score: item.score,
    snippet: trimSnippet(item.content),
    rrfSources: readRrfSources(item),
    normalizedIdentifier: item.evidence.normalizedIdentifier,
    evidenceTier: item.evidence.tier,
    freshness: item.evidence.freshness.state,
    provenance: item.evidence.provenance,
    scoreSemantics: item.evidence.scoreSemantics,
    explanation: item.evidence.explanation,
    partial: item.evidence.partial,
    metadata: redactTraceValue(item.metadata)
  }));
  return {
    ...result,
    query,
    mode: opts?.tierRouting === false ? "legacy-rrf" : "tiered-keyword",
    plan: {
      intent: buildRetrievalPlan(opts?.intent, opts?.detail).intent,
      detail: buildRetrievalPlan(opts?.intent, opts?.detail).detail,
      tierOrder: buildRetrievalPlan(opts?.intent, opts?.detail).tierOrder,
      fallbacks: buildRetrievalPlan(opts?.intent, opts?.detail).fallbacks,
      requestedAdapters,
      selectedAdapters: selected.map((adapter) => adapter.name),
      fusion: {
        algorithm: "reciprocal_rank_fusion",
        k: RRF_K2,
        rankBase: 1,
        scoreFormula: "sum(weight / (k + rank_in_source))"
      },
      branches
    },
    evidence,
    limitations: buildTraceLimitations(query, opts, searchAdapters.map((adapter) => adapter.name), selected.map((adapter) => adapter.name), result)
  };
}
async function answerQuery(registry, query, opts) {
  const trace = await traceUnifiedQuery(registry, query, opts);
  const citations = trace.evidence.map((item, index) => ({
    id: `C${index + 1}`,
    rank: item.rank,
    source: item.source,
    path: item.path,
    snippet: item.snippet,
    metadata: item.metadata
  }));
  const claims = citations.slice(0, Math.min(5, citations.length)).map((citation) => ({
    text: claimFromCitation(citation),
    citations: [citation.id],
    confidence: claimConfidence(query, citation)
  }));
  const gaps = answerGaps(trace);
  const confidence = answerConfidence(claims, gaps);
  return {
    query,
    answer: renderAnswer(query, claims, gaps),
    claims,
    citations,
    gaps,
    contradictions: [],
    confidence,
    trace
  };
}
function trimSnippet(content, maxLength = 600) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength)
    return normalized;
  return `${normalized.slice(0, maxLength - 1)}\u2026`;
}
function readRrfSources(result) {
  const sources = result.metadata?.rrfSources;
  if (Array.isArray(sources)) {
    return sources.filter((source) => typeof source === "string");
  }
  return [result.source];
}
function buildTraceLimitations(query, opts, availableAdapters, selectedAdapters, result) {
  const limitations = [
    "query.trace explains retrieval and fusion; it does not verify that evidence supports a generated answer."
  ];
  if (query.trim().split(/\s+/).length === 1) {
    limitations.push("single-term queries can over-rank literal matches; use a phrase or more context for better evidence.");
  }
  if (selectedAdapters.includes("filesystem")) {
    limitations.push("filesystem search is literal ripgrep matching, not BM25.");
  }
  if (selectedAdapters.includes("vaultbrain")) {
    limitations.push("vaultbrain keyword search uses pg_trgm similarity plus optional vector search, not a native BM25 scorer.");
  }
  const requested = opts?.adapters ?? [];
  const missing = requested.filter((adapter) => !availableAdapters.includes(adapter));
  if (missing.length > 0) {
    limitations.push(`requested adapters not registered or not search-capable: ${missing.join(", ")}`);
  }
  if (selectedAdapters.length === 0) {
    limitations.push("no search-capable adapters were selected.");
  }
  if (result.results.length === 0) {
    limitations.push("no evidence was retrieved for this query.");
  }
  return limitations;
}
function claimFromCitation(citation) {
  const sentence = firstUsefulSentence(citation.snippet);
  if (sentence)
    return sentence;
  return `Retrieved evidence from ${citation.path}`;
}
function firstUsefulSentence(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized)
    return "";
  const match = normalized.match(/^(.{24,240}?[.!?])(\s|$)/);
  if (match)
    return match[1].trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}\u2026`;
}
function claimConfidence(query, citation) {
  const q2 = query.trim().toLowerCase();
  const snippet = citation.snippet.toLowerCase();
  if (q2 && snippet.includes(q2))
    return "high";
  if (snippet.length > 0)
    return "medium";
  return "low";
}
function answerGaps(trace) {
  const gaps = [];
  if (trace.evidence.length === 0) {
    gaps.push({
      type: "no_evidence",
      message: "No retrieved evidence was available, so no citation-backed answer can be produced."
    });
  }
  for (const branch of trace.plan.branches) {
    if (branch.status === "error") {
      gaps.push({
        type: "adapter_error",
        source: branch.adapter,
        message: branch.diagnosticCode ?? branch.error ?? `${branch.adapter} search failed.`
      });
    }
  }
  for (const limitation of trace.limitations) {
    gaps.push({
      type: "retrieval_limitation",
      message: limitation
    });
  }
  if (trace.evidence.length > 0) {
    gaps.push({
      type: "unknown_recency",
      message: "Evidence freshness is not verified unless timestamps are present in source metadata."
    });
    gaps.push({
      type: "semantic_review_missing",
      message: "Phase A does not perform semantic contradiction detection; contradictions are reported only after a later reviewer/reranker layer exists."
    });
  }
  return gaps;
}
function answerConfidence(claims, gaps) {
  if (claims.length === 0)
    return "low";
  if (gaps.some((gap) => gap.type === "adapter_error") && claims.length < 2)
    return "low";
  if (claims.length >= 3 && claims.every((claim) => claim.confidence === "high"))
    return "high";
  return "medium";
}
function renderAnswer(query, claims, gaps) {
  if (claims.length === 0) {
    return `I could not answer "${query}" from retrieved vault evidence.`;
  }
  const lines = [`Based on retrieved vault evidence for "${query}":`];
  claims.forEach((claim, index) => {
    lines.push(`${index + 1}. ${claim.text} [${claim.citations.join(", ")}]`);
  });
  const topGaps = gaps.filter((gap) => gap.type !== "retrieval_limitation").slice(0, 3).map((gap) => gap.message);
  if (topGaps.length > 0) {
    lines.push("");
    lines.push("Gaps:");
    topGaps.forEach((gap) => lines.push(`- ${gap}`));
  }
  return lines.join("\n");
}

// dist/runtime-env.js
var CANONICAL_VAULT_ENV = "VAULT_MIND_VAULT_PATH";
var LEGACY_VAULT_ENV = "VAULT_BRIDGE_VAULT";
function readVaultEnvironment(environment = process.env) {
  return environment[CANONICAL_VAULT_ENV] || environment[LEGACY_VAULT_ENV];
}

// dist/scripts/vault-cli.js
function parseVaultRecallArgs(argv, environment = process.env) {
  if (argv[0] !== "recall") {
    throw new Error('usage: vault recall "query" [--vault PATH]');
  }
  let query;
  let vaultPath;
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--vault") {
      vaultPath = argv[++index];
      if (!vaultPath)
        throw new Error("--vault requires a path");
      continue;
    }
    if (value.startsWith("--"))
      throw new Error(`unknown option: ${value}`);
    if (query)
      throw new Error("recall accepts exactly one query");
    query = value;
  }
  const resolvedVault = vaultPath ?? readVaultEnvironment(environment);
  if (!query?.trim())
    throw new Error("recall requires a non-empty query");
  if (!resolvedVault)
    throw new Error("vault path not set: pass --vault PATH or set VAULT_MIND_VAULT_PATH");
  return { query: query.trim(), vaultPath: resolve3(resolvedVault) };
}
function renderRecallResult(result) {
  const lines = [`Query: ${result.query}`, "", result.answer, "", "Citations:"];
  if (result.citations.length === 0) {
    lines.push("- none");
  } else {
    for (const citation of result.citations) {
      lines.push(`- [${citation.id}] ${citation.path}: ${citation.snippet}`);
    }
  }
  return `${lines.join("\n")}
`;
}
async function runVaultRecall(args2) {
  await access(args2.vaultPath);
  const registry = new AdapterRegistry();
  const filesystem = new FilesystemAdapter(args2.vaultPath);
  const vaultBrain = new VaultBrainAdapter(args2.brainDataDir);
  await filesystem.init();
  await vaultBrain.init();
  registry.register(filesystem);
  try {
    if (vaultBrain.isAvailable) {
      registry.register(vaultBrain);
      configureLazyIndex(vaultBrain, args2.vaultPath);
      await ensureBackfill({ syncCap: 300 });
    }
    const result = await answerQuery(registry, args2.query, { maxResults: 10 });
    return renderRecallResult(result);
  } finally {
    await vaultBrain.dispose();
    await filesystem.dispose();
  }
}
async function main() {
  try {
    const args2 = parseVaultRecallArgs(process.argv.slice(2));
    process.stdout.write(await runVaultRecall(args2));
  } catch (error) {
    process.stderr.write(`vault: ${error.message}
`);
    process.exitCode = 1;
  }
}
var isEntry = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry)
  void main();
export {
  parseVaultRecallArgs,
  renderRecallResult,
  runVaultRecall
};
